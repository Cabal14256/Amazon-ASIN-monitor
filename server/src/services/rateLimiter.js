/**
 * SP-API 令牌桶限流器
 * 实现每分钟和每小时的速率限制，防止超过SP-API的配额限制
 * 支持operation级别的限流管理
 */

const logger = require('../utils/logger');

// 请求优先级定义
const PRIORITY = {
  MANUAL: 1, // 手动查询（最高优先级）
  SCHEDULED: 2, // 定时任务（中等优先级）
  BATCH: 3, // 批量查询（低优先级）
};

// Operation默认配置（基于SP-API文档）
const DEFAULT_OPERATION_CONFIGS = {
  getCatalogItem: {
    rate: 1, // 1 req/s
    burst: 2, // 瞬时最多2个请求
    perMinute: 60,
    perHour: 1000,
  },
  searchCatalogItems: {
    rate: 2, // 2 req/s
    burst: 2, // 瞬时最多2个请求
    perMinute: 120,
    perHour: 2000,
  },
  // 通用默认配置（用于未识别的operation）
  default: {
    rate: 1,
    burst: 2,
    perMinute: 60,
    perHour: 1000,
  },
};

/**
 * 优先级队列（简单的数组实现，按优先级排序）
 */
class PriorityQueue {
  constructor() {
    this.items = [];
  }

  /**
   * 入队
   * @param {any} item - 队列项
   * @param {number} priority - 优先级（数字越小优先级越高）
   */
  enqueue(item, priority) {
    this.items.push({ item, priority });
    // 按优先级排序（优先级小的在前）
    this.items.sort((a, b) => a.priority - b.priority);
  }

  /**
   * 出队
   * @returns {any|null}
   */
  dequeue() {
    if (this.items.length === 0) {
      return null;
    }
    return this.items.shift().item;
  }

  /**
   * 检查队列是否为空
   * @returns {boolean}
   */
  isEmpty() {
    return this.items.length === 0;
  }

  /**
   * 获取队列长度
   * @returns {number}
   */
  size() {
    return this.items.length;
  }
}

class TokenBucket {
  /**
   * 创建令牌桶
   * @param {number} capacity - 桶容量（令牌数量）
   * @param {number} refillRate - 每秒补充的令牌数
   * @param {number} refillInterval - 补充间隔（毫秒），默认60000（1分钟）
   */
  constructor(capacity, refillRate, refillInterval = 60000) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillRate = refillRate;
    this.refillInterval = refillInterval;
    this.lastRefill = Date.now();
    this.pendingQueue = new PriorityQueue(); // 等待令牌的优先级队列
  }

  /**
   * 补充令牌
   */
  refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000; // 经过的秒数
    const tokensToAdd = elapsed * this.refillRate;

    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  /**
   * 获取令牌（如果令牌不足则等待）
   * @param {number} tokens - 需要的令牌数量，默认1
   * @param {number} priority - 优先级（数字越小优先级越高），默认2（SCHEDULED）
   * @returns {Promise<void>}
   */
  async acquire(tokens = 1, priority = PRIORITY.SCHEDULED) {
    this.refill();

    if (this.tokens >= tokens) {
      // 有足够的令牌，直接消耗
      this.tokens -= tokens;
      return;
    }

    // 令牌不足，需要等待（加入优先级队列）
    return new Promise((resolve) => {
      const startTime = Date.now();

      // 将请求加入优先级队列
      this.pendingQueue.enqueue(
        {
          tokens,
          resolve,
          startTime,
        },
        priority,
      );

      // 尝试处理队列
      this.processQueue();
    });
  }

  /**
   * 处理优先级队列
   */
  processQueue() {
    this.refill();

    while (!this.pendingQueue.isEmpty() && this.tokens > 0) {
      const request = this.pendingQueue.dequeue();
      if (!request) break;

      if (this.tokens >= request.tokens) {
        this.tokens -= request.tokens;
        request.resolve();
      } else {
        // 令牌不足，重新入队（保持优先级）
        const priority = this.pendingQueue.isEmpty()
          ? PRIORITY.SCHEDULED
          : request.priority || PRIORITY.SCHEDULED;
        this.pendingQueue.enqueue(request, priority);
        break;
      }
    }

    // 如果队列不为空，继续处理
    if (!this.pendingQueue.isEmpty()) {
      const waitTime =
        ((this.pendingQueue.items[0]?.tokens || 1) / this.refillRate) * 1000;
      setTimeout(() => this.processQueue(), Math.min(waitTime, 1000));
    }
  }

  /**
   * 获取当前可用令牌数
   * @returns {number}
   */
  getAvailableTokens() {
    this.refill();
    return this.tokens;
  }

  /**
   * 重置令牌桶
   */
  reset() {
    this.tokens = this.capacity;
    this.lastRefill = Date.now();
    this.pendingQueue = [];
  }
}

/**
 * 多级限流器（支持每分钟和每小时限制）
 */
class MultiLevelRateLimiter {
  /**
   * 创建多级限流器
   * @param {Object} config - 配置对象
   * @param {number} config.perMinute - 每分钟限制
   * @param {number} config.perHour - 每小时限制
   */
  constructor(config = {}) {
    const perMinute = config.perMinute || 60;
    const perHour = config.perHour || 1000;

    // 每分钟限流器：每秒补充 perMinute/60 个令牌
    this.minuteLimiter = new TokenBucket(
      perMinute,
      perMinute / 60,
      60000, // 1分钟
    );

    // 每小时限流器：每秒补充 perHour/3600 个令牌
    this.hourLimiter = new TokenBucket(
      perHour,
      perHour / 3600,
      3600000, // 1小时
    );
  }

  /**
   * 获取令牌（需要同时满足每分钟和每小时限制）
   * @param {number} tokens - 需要的令牌数量，默认1
   * @returns {Promise<void>}
   */
  async acquire(tokens = 1) {
    // 同时从两个限流器获取令牌
    await Promise.all([
      this.minuteLimiter.acquire(tokens),
      this.hourLimiter.acquire(tokens),
    ]);
  }

  /**
   * 获取当前状态
   * @returns {Object}
   */
  getStatus() {
    return {
      minuteTokens: this.minuteLimiter.getAvailableTokens(),
      hourTokens: this.hourLimiter.getAvailableTokens(),
    };
  }

  /**
   * 重置所有限流器
   */
  reset() {
    this.minuteLimiter.reset();
    this.hourLimiter.reset();
  }
}

// 为每个区域创建独立的限流器（向后兼容，区域级别）
const rateLimiters = {
  US: null,
  EU: null,
};

// 为每个operation创建独立的限流器（新功能）
// 结构: { region: { operation: MultiLevelRateLimiter } }
const operationRateLimiters = {
  US: {},
  EU: {},
};

/**
 * 初始化限流器
 */
function initializeRateLimiters() {
  const perMinute = Number(process.env.SP_API_RATE_LIMIT_PER_MINUTE) || 60;
  const perHour = Number(process.env.SP_API_RATE_LIMIT_PER_HOUR) || 1000;

  rateLimiters.US = new MultiLevelRateLimiter({
    perMinute,
    perHour,
  });

  rateLimiters.EU = new MultiLevelRateLimiter({
    perMinute,
    perHour,
  });

  console.log(
    `[RateLimiter] 初始化完成 - 每分钟: ${perMinute}, 每小时: ${perHour}`,
  );
}

/**
 * 获取指定区域的限流器
 * @param {string} region - 区域代码 ('US' 或 'EU')
 * @returns {MultiLevelRateLimiter}
 */
function getRateLimiter(region) {
  const normalizedRegion = region === 'US' ? 'US' : 'EU';

  if (!rateLimiters[normalizedRegion]) {
    // 如果未初始化，使用默认配置初始化
    initializeRateLimiters();
  }

  return rateLimiters[normalizedRegion];
}

/**
 * 获取operation限流器
 * @param {string} region - 区域代码
 * @param {string} operation - Operation名称（可选）
 * @returns {MultiLevelRateLimiter} 限流器实例
 */
function getOperationRateLimiter(region, operation = null) {
  const normalizedRegion = region === 'US' ? 'US' : 'EU';

  // 如果没有指定operation，返回区域级别的限流器（向后兼容）
  if (!operation) {
    return getRateLimiter(normalizedRegion);
  }

  // 获取或创建operation级别的限流器
  if (!operationRateLimiters[normalizedRegion][operation]) {
    // 获取operation的配置
    const opConfig =
      DEFAULT_OPERATION_CONFIGS[operation] || DEFAULT_OPERATION_CONFIGS.default;

    // 创建新的限流器
    operationRateLimiters[normalizedRegion][operation] =
      new MultiLevelRateLimiter({
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

/**
 * 更新operation的rate配置（从响应头自动发现）
 * @param {string} region - 区域代码
 * @param {string} operation - Operation名称
 * @param {number} rateLimit - 从响应头发现的rate limit（requests/second）
 */
function updateOperationRateLimit(region, operation, rateLimit) {
  if (!region || !operation || !rateLimit || rateLimit <= 0) {
    return;
  }

  const normalizedRegion = region === 'US' ? 'US' : 'EU';

  // 获取或创建限流器
  const limiter = getOperationRateLimiter(normalizedRegion, operation);

  // 根据rate limit计算perMinute和perHour
  // rate limit是每秒的请求数，我们需要转换为每分钟和每小时
  const newPerMinute = Math.floor(rateLimit * 60);
  const newPerHour = Math.floor(rateLimit * 3600);

  // 获取当前配置
  const currentPerMinute = limiter.minuteLimiter.capacity;
  const currentPerHour = limiter.hourLimiter.capacity;

  // 如果配置发生变化，更新限流器
  if (newPerMinute !== currentPerMinute || newPerHour !== currentPerHour) {
    logger.info(
      `[RateLimiter] 更新operation配额: ${normalizedRegion}/${operation} (${currentPerMinute}/min -> ${newPerMinute}/min, ${currentPerHour}/hour -> ${newPerHour}/hour)`,
    );

    // 重新创建限流器（保持令牌状态可能比较复杂，所以直接重建）
    operationRateLimiters[normalizedRegion][operation] =
      new MultiLevelRateLimiter({
        perMinute: newPerMinute,
        perHour: newPerHour,
        rate: rateLimit,
        burst: DEFAULT_OPERATION_CONFIGS[operation]?.burst || 2,
      });
  }
}

/**
 * 获取令牌（根据区域和operation）
 * @param {string} region - 区域代码
 * @param {number} tokens - 需要的令牌数量，默认1
 * @param {number} priority - 优先级（PRIORITY.MANUAL=1, PRIORITY.SCHEDULED=2, PRIORITY.BATCH=3），默认2
 * @param {string} operation - Operation名称（可选，如果提供则使用operation级别的限流器）
 * @returns {Promise<void>}
 */
async function acquire(
  region,
  tokens = 1,
  priority = PRIORITY.SCHEDULED,
  operation = null,
) {
  const limiter = getOperationRateLimiter(region, operation);
  await limiter.acquire(tokens, priority);
}

/**
 * 获取限流器状态
 * @param {string} region - 区域代码
 * @param {string} operation - Operation名称（可选）
 * @returns {Object}
 */
function getStatus(region, operation = null) {
  const limiter = getOperationRateLimiter(region, operation);
  return limiter.getStatus();
}

/**
 * 获取所有operation限流器状态
 * @param {string} region - 区域代码（可选，如果不提供则返回所有区域）
 * @returns {Object} 所有operation的状态信息
 */
function getAllOperationStatus(region = null) {
  const regions = region ? [region] : ['US', 'EU'];
  const status = {};

  for (const reg of regions) {
    const normalizedRegion = reg === 'US' ? 'US' : 'EU';
    status[normalizedRegion] = {};

    // 区域级别限流器状态
    status[normalizedRegion]._region =
      getRateLimiter(normalizedRegion).getStatus();

    // Operation级别限流器状态
    const opLimiters = operationRateLimiters[normalizedRegion];
    for (const [op, limiter] of Object.entries(opLimiters)) {
      status[normalizedRegion][op] = limiter.getStatus();
    }
  }

  return status;
}

/**
 * 动态调整限流器参数
 * @param {string} region - 区域代码
 * @param {number} recentRateLimitCount - 最近1小时内的限流次数
 * @param {number} errorRate - 最近50次检查的错误率（0-1）
 * @returns {Object} 调整后的配置 { adjusted: boolean, newPerMinute: number, newPerHour: number }
 */
function adjustRateLimit(region, recentRateLimitCount, errorRate = 0) {
  const limiter = getRateLimiter(region);
  const currentPerMinute = limiter.minuteLimiter.capacity;
  const currentPerHour = limiter.hourLimiter.capacity;

  const ERROR_RATE_THRESHOLD = 0.3; // 30%错误率阈值
  const RATE_LIMIT_THRESHOLD = 10; // 限流次数阈值
  const ADJUSTMENT_FACTOR = 0.8; // 降低20%
  const MIN_PER_MINUTE = 30; // 最小每分钟30个请求
  const MIN_PER_HOUR = 500; // 最小每小时500个请求

  let adjusted = false;
  let newPerMinute = currentPerMinute;
  let newPerHour = currentPerHour;

  // 如果错误率高或限流频繁，降低速率
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
      // 重新初始化限流器
      rateLimiters[region] = new MultiLevelRateLimiter({
        perMinute: newPerMinute,
        perHour: newPerHour,
      });

      console.log(
        `[RateLimiter] ${region}区域限流频繁（限流${recentRateLimitCount}次，错误率${(
          errorRate * 100
        ).toFixed(
          1,
        )}%），降低速率: ${currentPerMinute}/分钟 -> ${newPerMinute}/分钟, ${currentPerHour}/小时 -> ${newPerHour}/小时`,
      );
    }
  } else if (
    recentRateLimitCount === 0 &&
    errorRate < 0.1 &&
    currentPerMinute < 60
  ) {
    // 如果无限流且错误率低，可以尝试提高速率（谨慎）
    // 这里暂时不自动提高，避免频繁调整
    // 如果需要，可以手动调整环境变量
  }

  return {
    adjusted,
    newPerMinute,
    newPerHour,
    previousPerMinute: currentPerMinute,
    previousPerHour: currentPerHour,
  };
}

// 初始化限流器
initializeRateLimiters();

module.exports = {
  acquire,
  getStatus,
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
