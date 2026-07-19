/**
 * SP-API 限流器
 * 默认使用 Redis 分布式滑动窗口；Redis 不可用时回退到进程内令牌桶。
 */

const logger = require('../utils/logger');
const {
  initRedis,
  getRedisClient,
  isRedisAvailable,
} = require('../config/redis');

// 请求优先级定义
const PRIORITY = {
  MANUAL: 1, // 手动查询（最高优先级）
  SCHEDULED: 2, // 定时任务（中等优先级）
  BATCH: 3, // 批量查询（低优先级）
};

// Operation默认配置（基于SP-API文档）
const DEFAULT_OPERATION_CONFIGS = {
  getCatalogItem: {
    rate: 2,
    burst: 2,
    perMinute: 120,
    perHour: 7200,
  },
  searchCatalogItems: {
    rate: 2,
    burst: 2,
    perMinute: 120,
    perHour: 7200,
  },
  default: {
    rate: 0.5,
    burst: 1,
    perMinute: 30,
    perHour: 500,
  },
};

const RATE_LIMITER_KEY_PREFIX =
  process.env.RATE_LIMITER_KEY_PREFIX || 'spapi:ratelimiter';
const DISTRIBUTED_RETRY_WAIT_CAP_MS = 5000;

let redisFallbackWarned = false;

const DISTRIBUTED_ACQUIRE_SCRIPT = `
local now = tonumber(ARGV[1])
local member = ARGV[2]
local keyCount = tonumber(ARGV[3])
local retryMs = 0

for i = 1, keyCount do
  local base = 3 + ((i - 1) * 3)
  local limitValue = tonumber(ARGV[base + 1])
  local windowMs = tonumber(ARGV[base + 2])
  redis.call('ZREMRANGEBYSCORE', KEYS[i], '-inf', now - windowMs)
  local count = redis.call('ZCARD', KEYS[i])
  if count >= limitValue then
    local oldest = redis.call('ZRANGE', KEYS[i], 0, 0, 'WITHSCORES')
    local oldestScore = tonumber(oldest[2]) or now
    local waitMs = windowMs - (now - oldestScore) + 1
    if waitMs > retryMs then
      retryMs = waitMs
    end
  end
end

if retryMs > 0 then
  return {0, retryMs}
end

for i = 1, keyCount do
  local base = 3 + ((i - 1) * 3)
  local ttlMs = tonumber(ARGV[base + 3])
  redis.call('ZADD', KEYS[i], now, member)
  redis.call('PEXPIRE', KEYS[i], ttlMs)
end

return {1, 0}
`;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildLimiterName(region, operation = null) {
  return operation ? `${region}:operation:${operation}` : `${region}:region`;
}

function buildRedisWindowKey(limiterName, windowLabel) {
  return `${RATE_LIMITER_KEY_PREFIX}:${limiterName}:${windowLabel}`;
}

function buildOperationMetadataKey(region, operation) {
  return `${RATE_LIMITER_KEY_PREFIX}:metadata:${region}:operation:${operation}`;
}

function warnRedisFallback(error) {
  if (redisFallbackWarned) {
    return;
  }

  redisFallbackWarned = true;
  logger.warn(
    `[RateLimiter] Redis 分布式限流不可用，已回退为进程内限流：${
      error?.message || 'Redis unavailable'
    }`,
  );
}

/**
 * 优先级队列（简单的数组实现，按优先级排序）
 */
class PriorityQueue {
  constructor() {
    this.items = [];
  }

  enqueue(item, priority) {
    this.items.push({ item, priority });
    this.items.sort((a, b) => a.priority - b.priority);
  }

  dequeue() {
    if (this.items.length === 0) {
      return null;
    }
    return this.items.shift().item;
  }

  isEmpty() {
    return this.items.length === 0;
  }

  size() {
    return this.items.length;
  }
}

class TokenBucket {
  constructor(capacity, refillRate, refillInterval = 60000) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillRate = refillRate;
    this.refillInterval = refillInterval;
    this.lastRefill = Date.now();
    this.pendingQueue = new PriorityQueue();
  }

  refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const tokensToAdd = elapsed * this.refillRate;

    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  async acquire(tokens = 1, priority = PRIORITY.SCHEDULED) {
    this.refill();

    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return;
    }

    return new Promise((resolve) => {
      this.pendingQueue.enqueue(
        {
          tokens,
          resolve,
          priority,
        },
        priority,
      );

      this.processQueue();
    });
  }

  processQueue() {
    this.refill();

    while (!this.pendingQueue.isEmpty() && this.tokens > 0) {
      const request = this.pendingQueue.dequeue();
      if (!request) {
        break;
      }

      if (this.tokens >= request.tokens) {
        this.tokens -= request.tokens;
        request.resolve();
      } else {
        this.pendingQueue.enqueue(
          request,
          request.priority || PRIORITY.SCHEDULED,
        );
        break;
      }
    }

    if (!this.pendingQueue.isEmpty()) {
      const waitTime =
        ((this.pendingQueue.items[0]?.item?.tokens || 1) / this.refillRate) *
        1000;
      setTimeout(() => this.processQueue(), Math.min(waitTime, 1000));
    }
  }

  getAvailableTokens() {
    this.refill();
    return this.tokens;
  }

  reset() {
    this.tokens = this.capacity;
    this.lastRefill = Date.now();
    this.pendingQueue = new PriorityQueue();
  }
}

/**
 * 多级限流器（支持每秒/分钟/小时限制）
 */
class MultiLevelRateLimiter {
  constructor(config = {}) {
    const perMinute = config.perMinute || 60;
    const perHour = config.perHour || 1000;
    const rate = Number(config.rate) || 0;
    const burst = Number(config.burst) || 0;

    this.name = config.name || 'default';
    this.minuteLimiter = new TokenBucket(perMinute, perMinute / 60, 60000);
    this.hourLimiter = new TokenBucket(perHour, perHour / 3600, 3600000);
    this.secondLimiter =
      rate > 0 && burst > 0 ? new TokenBucket(burst, rate, 1000) : null;
    this.lastMode = 'memory';
    this.limitSource = config.limitSource || 'default';
    this.limitUpdatedAt = config.limitUpdatedAt || null;
  }

  getWindowConfigs() {
    const windows = [
      {
        key: buildRedisWindowKey(this.name, 'minute'),
        limit: this.minuteLimiter.capacity,
        windowMs: 60000,
        ttlMs: 120000,
      },
      {
        key: buildRedisWindowKey(this.name, 'hour'),
        limit: this.hourLimiter.capacity,
        windowMs: 3600000,
        ttlMs: 7200000,
      },
    ];

    if (this.secondLimiter) {
      windows.unshift({
        key: buildRedisWindowKey(this.name, 'second'),
        limit: this.secondLimiter.capacity,
        windowMs: 1000,
        ttlMs: 10000,
      });
    }

    return windows;
  }

  async getDistributedRedisClient() {
    if (isRedisAvailable()) {
      return getRedisClient();
    }

    try {
      await initRedis();
    } catch (error) {
      warnRedisFallback(error);
      return null;
    }

    if (!isRedisAvailable()) {
      warnRedisFallback();
      return null;
    }

    return getRedisClient();
  }

  async acquireDistributed(tokens = 1, priority = PRIORITY.SCHEDULED) {
    const client = await this.getDistributedRedisClient();
    if (!client) {
      return false;
    }

    const windows = this.getWindowConfigs();
    if (windows.length === 0) {
      return false;
    }

    for (let tokenIndex = 0; tokenIndex < tokens; tokenIndex += 1) {
      while (true) {
        const now = Date.now();
        const keys = windows.map((window) => window.key);
        const args = [
          now,
          `${process.pid}:${priority}:${tokenIndex}:${now}:${Math.random()
            .toString(16)
            .slice(2)}`,
          windows.length,
          ...windows.flatMap((window) => [
            window.limit,
            window.windowMs,
            window.ttlMs,
          ]),
        ];

        try {
          const result = await client.eval(
            DISTRIBUTED_ACQUIRE_SCRIPT,
            keys.length,
            ...keys,
            ...args,
          );
          const [allowedRaw, retryMsRaw] = Array.isArray(result)
            ? result
            : [0, 1000];
          const allowed = Number(allowedRaw) === 1;

          if (allowed) {
            this.lastMode = 'redis-distributed';
            break;
          }

          const retryMs = Math.max(Number(retryMsRaw) || 100, 25);
          await sleep(Math.min(retryMs, DISTRIBUTED_RETRY_WAIT_CAP_MS));
        } catch (error) {
          warnRedisFallback(error);
          return false;
        }
      }
    }

    return true;
  }

  async acquire(tokens = 1, priority = PRIORITY.SCHEDULED) {
    const usedDistributed = await this.acquireDistributed(tokens, priority);
    if (usedDistributed) {
      return;
    }

    this.lastMode = 'memory';
    const waiters = [
      this.minuteLimiter.acquire(tokens, priority),
      this.hourLimiter.acquire(tokens, priority),
    ];

    if (this.secondLimiter) {
      waiters.push(this.secondLimiter.acquire(tokens, priority));
    }

    await Promise.all(waiters);
  }

  getStatus() {
    const distributed = isRedisAvailable();

    return {
      mode: distributed ? 'redis-distributed' : 'memory',
      lastMode: this.lastMode,
      redisAvailable: distributed,
      name: this.name,
      secondTokens: distributed
        ? null
        : this.secondLimiter
        ? this.secondLimiter.getAvailableTokens()
        : null,
      minuteTokens: distributed
        ? null
        : this.minuteLimiter.getAvailableTokens(),
      hourTokens: distributed ? null : this.hourLimiter.getAvailableTokens(),
      limits: {
        second: this.secondLimiter ? this.secondLimiter.capacity : null,
        minute: this.minuteLimiter.capacity,
        hour: this.hourLimiter.capacity,
      },
      limitSource: this.limitSource,
      limitUpdatedAt: this.limitUpdatedAt,
    };
  }

  buildMemoryStatus(mode = 'memory') {
    const secondTokens = this.secondLimiter
      ? this.secondLimiter.getAvailableTokens()
      : null;
    const minuteTokens = this.minuteLimiter.getAvailableTokens();
    const hourTokens = this.hourLimiter.getAvailableTokens();
    const windows = {
      minute: {
        used: Math.max(this.minuteLimiter.capacity - minuteTokens, 0),
        remaining: minuteTokens,
        limit: this.minuteLimiter.capacity,
        windowMs: 60000,
      },
      hour: {
        used: Math.max(this.hourLimiter.capacity - hourTokens, 0),
        remaining: hourTokens,
        limit: this.hourLimiter.capacity,
        windowMs: 3600000,
      },
    };

    if (this.secondLimiter) {
      windows.second = {
        used: Math.max(this.secondLimiter.capacity - secondTokens, 0),
        remaining: secondTokens,
        limit: this.secondLimiter.capacity,
        windowMs: 1000,
      };
    }

    return {
      mode,
      lastMode: this.lastMode,
      redisAvailable: false,
      name: this.name,
      secondTokens,
      minuteTokens,
      hourTokens,
      limits: {
        second: this.secondLimiter ? this.secondLimiter.capacity : null,
        minute: this.minuteLimiter.capacity,
        hour: this.hourLimiter.capacity,
      },
      windows,
      limitSource: this.limitSource,
      limitUpdatedAt: this.limitUpdatedAt,
    };
  }

  async getOperationMetadata(client) {
    const match = this.name.match(/^([^:]+):operation:(.+)$/);
    if (!match || !client || typeof client.get !== 'function') {
      return null;
    }

    const [, region, operation] = match;
    const raw = await client.get(buildOperationMetadataKey(region, operation));
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw);
      if (!Number.isFinite(Number(parsed.rate)) || Number(parsed.rate) <= 0) {
        return null;
      }
      return parsed;
    } catch (error) {
      logger.warn('[RateLimiter] Redis operation 配额元数据无法解析:', {
        name: this.name,
        message: error.message,
      });
      return null;
    }
  }

  async getStatusSnapshot() {
    const client = await this.getDistributedRedisClient();
    if (!client) {
      return this.buildMemoryStatus();
    }

    try {
      const metadata = await this.getOperationMetadata(client);
      const windows = this.getWindowConfigs().map((window) => ({ ...window }));

      if (metadata) {
        const rate = Number(metadata.rate);
        const burst = Number(metadata.burst) || 2;
        for (const window of windows) {
          if (window.key.endsWith(':second')) {
            window.limit = burst;
          } else if (window.key.endsWith(':minute')) {
            window.limit = Math.max(Math.floor(rate * 60), 1);
          } else if (window.key.endsWith(':hour')) {
            window.limit = Math.max(Math.floor(rate * 3600), 1);
          }
        }
      }

      const now = Date.now();
      const usageEntries = await Promise.all(
        windows.map(async (window) => {
          await client.zremrangebyscore(
            window.key,
            '-inf',
            now - window.windowMs,
          );
          const used = Number(await client.zcard(window.key)) || 0;
          return [
            window.key.split(':').pop(),
            {
              used,
              remaining: Math.max(window.limit - used, 0),
              limit: window.limit,
              windowMs: window.windowMs,
            },
          ];
        }),
      );
      const usage = Object.fromEntries(usageEntries);

      return {
        mode: 'redis-distributed',
        lastMode: this.lastMode,
        redisAvailable: true,
        name: this.name,
        secondTokens: usage.second?.remaining ?? null,
        minuteTokens: usage.minute.remaining,
        hourTokens: usage.hour.remaining,
        limits: {
          second: usage.second?.limit ?? null,
          minute: usage.minute.limit,
          hour: usage.hour.limit,
        },
        windows: usage,
        limitSource: metadata?.source || this.limitSource,
        limitUpdatedAt: metadata?.updatedAt || this.limitUpdatedAt,
      };
    } catch (error) {
      warnRedisFallback(error);
      return this.buildMemoryStatus('memory-fallback');
    }
  }

  reset() {
    this.minuteLimiter.reset();
    this.hourLimiter.reset();
    if (this.secondLimiter) {
      this.secondLimiter.reset();
    }
  }
}

// 为每个区域创建独立的限流器（向后兼容，区域级别）
const rateLimiters = {
  US: null,
  EU: null,
};

// 为每个operation创建独立的限流器
const operationRateLimiters = {
  US: {},
  EU: {},
};

function initializeRateLimiters() {
  const perMinute = Number(process.env.SP_API_RATE_LIMIT_PER_MINUTE) || 60;
  const perHour = Number(process.env.SP_API_RATE_LIMIT_PER_HOUR) || 1000;

  rateLimiters.US = new MultiLevelRateLimiter({
    name: buildLimiterName('US'),
    perMinute,
    perHour,
  });

  rateLimiters.EU = new MultiLevelRateLimiter({
    name: buildLimiterName('EU'),
    perMinute,
    perHour,
  });

  logger.info(
    `[RateLimiter] 初始化完成 - 每分钟: ${perMinute}, 每小时: ${perHour}, 模式: ${
      isRedisAvailable() ? 'redis-distributed' : 'memory'
    }`,
  );
}

function getRateLimiter(region) {
  const normalizedRegion = region === 'US' ? 'US' : 'EU';

  if (!rateLimiters[normalizedRegion]) {
    initializeRateLimiters();
  }

  return rateLimiters[normalizedRegion];
}

function getOperationRateLimiter(region, operation = null) {
  const normalizedRegion = region === 'US' ? 'US' : 'EU';

  if (!operation) {
    return getRateLimiter(normalizedRegion);
  }

  if (!operationRateLimiters[normalizedRegion][operation]) {
    const opConfig =
      DEFAULT_OPERATION_CONFIGS[operation] || DEFAULT_OPERATION_CONFIGS.default;

    operationRateLimiters[normalizedRegion][operation] =
      new MultiLevelRateLimiter({
        name: buildLimiterName(normalizedRegion, operation),
        perMinute: opConfig.perMinute,
        perHour: opConfig.perHour,
        rate: opConfig.rate,
        burst: opConfig.burst,
      });

    logger.info(
      `[RateLimiter] 创建operation限流器: ${normalizedRegion}/${operation} (rate: ${opConfig.rate}/s, burst: ${opConfig.burst})`,
    );
  }

  return operationRateLimiters[normalizedRegion][operation];
}

function updateOperationRateLimit(region, operation, rateLimit) {
  if (!region || !operation || !rateLimit || rateLimit <= 0) {
    return;
  }

  const normalizedRegion = region === 'US' ? 'US' : 'EU';
  const limiter = getOperationRateLimiter(normalizedRegion, operation);
  const newPerMinute = Math.floor(rateLimit * 60);
  const newPerHour = Math.floor(rateLimit * 3600);
  const currentPerMinute = limiter.minuteLimiter.capacity;
  const currentPerHour = limiter.hourLimiter.capacity;
  const limitUpdatedAt = new Date().toISOString();
  const shouldPersist =
    limiter.limitSource !== 'response_header' ||
    newPerMinute !== currentPerMinute ||
    newPerHour !== currentPerHour;

  if (newPerMinute !== currentPerMinute || newPerHour !== currentPerHour) {
    logger.info(
      `[RateLimiter] 更新operation配额: ${normalizedRegion}/${operation} (${currentPerMinute}/min -> ${newPerMinute}/min, ${currentPerHour}/hour -> ${newPerHour}/hour)`,
    );

    operationRateLimiters[normalizedRegion][operation] =
      new MultiLevelRateLimiter({
        name: buildLimiterName(normalizedRegion, operation),
        perMinute: newPerMinute,
        perHour: newPerHour,
        rate: rateLimit,
        burst: DEFAULT_OPERATION_CONFIGS[operation]?.burst || 2,
        limitSource: 'response_header',
        limitUpdatedAt,
      });
  } else {
    limiter.limitSource = 'response_header';
    limiter.limitUpdatedAt = limitUpdatedAt;
  }

  if (shouldPersist) {
    void persistOperationRateLimitMetadata(
      normalizedRegion,
      operation,
      rateLimit,
      DEFAULT_OPERATION_CONFIGS[operation]?.burst || 2,
      limitUpdatedAt,
    );
  }
}

async function persistOperationRateLimitMetadata(
  region,
  operation,
  rateLimit,
  burst,
  updatedAt,
) {
  if (!isRedisAvailable()) {
    return;
  }

  try {
    const client = getRedisClient();
    await client.set(
      buildOperationMetadataKey(region, operation),
      JSON.stringify({
        rate: Number(rateLimit),
        burst: Number(burst),
        source: 'response_header',
        updatedAt,
      }),
    );
  } catch (error) {
    logger.warn('[RateLimiter] 写入 operation 配额元数据失败:', {
      region,
      operation,
      message: error.message,
    });
  }
}

async function acquire(
  region,
  tokens = 1,
  priority = PRIORITY.SCHEDULED,
  operation = null,
) {
  const regionLimiter = getRateLimiter(region);
  const operationLimiter = operation
    ? getOperationRateLimiter(region, operation)
    : null;
  await acquireWithLimiters(regionLimiter, operationLimiter, tokens, priority);
}

async function acquireWithLimiters(
  regionLimiter,
  operationLimiter,
  tokens,
  priority,
) {
  await regionLimiter.acquire(tokens, priority);
  if (operationLimiter) {
    await operationLimiter.acquire(tokens, priority);
  }
}

function getStatus(region, operation = null) {
  const limiter = getOperationRateLimiter(region, operation);
  return limiter.getStatus();
}

async function getStatusSnapshot(region, operation = null) {
  const limiter = getOperationRateLimiter(region, operation);
  return limiter.getStatusSnapshot();
}

function getAllOperationStatus(region = null) {
  const regions = region ? [region] : ['US', 'EU'];
  const status = {};

  for (const reg of regions) {
    const normalizedRegion = reg === 'US' ? 'US' : 'EU';
    status[normalizedRegion] = {};
    status[normalizedRegion]._region =
      getRateLimiter(normalizedRegion).getStatus();

    const opLimiters = operationRateLimiters[normalizedRegion];
    for (const [op, limiter] of Object.entries(opLimiters)) {
      status[normalizedRegion][op] = limiter.getStatus();
    }
  }

  return status;
}

function adjustRateLimit(region, recentRateLimitCount, errorRate = 0) {
  const normalizedRegion = region === 'US' ? 'US' : 'EU';
  const limiter = getRateLimiter(normalizedRegion);
  const currentPerMinute = limiter.minuteLimiter.capacity;
  const currentPerHour = limiter.hourLimiter.capacity;

  const ERROR_RATE_THRESHOLD = 0.3;
  const RATE_LIMIT_THRESHOLD = 10;
  const ADJUSTMENT_FACTOR = 0.8;
  const MIN_PER_MINUTE = 30;
  const MIN_PER_HOUR = 500;

  let adjusted = false;
  let newPerMinute = currentPerMinute;
  let newPerHour = currentPerHour;

  if (
    errorRate > ERROR_RATE_THRESHOLD ||
    recentRateLimitCount > RATE_LIMIT_THRESHOLD
  ) {
    newPerMinute = Math.max(
      MIN_PER_MINUTE,
      Math.floor(currentPerMinute * ADJUSTMENT_FACTOR),
    );
    newPerHour = Math.max(
      MIN_PER_HOUR,
      Math.floor(currentPerHour * ADJUSTMENT_FACTOR),
    );

    if (newPerMinute !== currentPerMinute || newPerHour !== currentPerHour) {
      adjusted = true;
      rateLimiters[normalizedRegion] = new MultiLevelRateLimiter({
        name: buildLimiterName(normalizedRegion),
        perMinute: newPerMinute,
        perHour: newPerHour,
      });

      logger.info(
        `[RateLimiter] ${normalizedRegion}区域限流频繁（限流${recentRateLimitCount}次，错误率${(
          errorRate * 100
        ).toFixed(
          1,
        )}%），降低速率: ${currentPerMinute}/分钟 -> ${newPerMinute}/分钟, ${currentPerHour}/小时 -> ${newPerHour}/小时`,
      );
    }
  }

  return {
    adjusted,
    newPerMinute,
    newPerHour,
    previousPerMinute: currentPerMinute,
    previousPerHour: currentPerHour,
  };
}

initializeRateLimiters();

module.exports = {
  acquire,
  acquireWithLimiters,
  getStatus,
  getStatusSnapshot,
  getAllOperationStatus,
  getRateLimiter,
  getOperationRateLimiter,
  updateOperationRateLimit,
  initializeRateLimiters,
  adjustRateLimit,
  PRIORITY,
  TokenBucket,
  MultiLevelRateLimiter,
  PriorityQueue,
  DEFAULT_OPERATION_CONFIGS,
};
