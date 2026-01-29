/**
 * 缓存服务
 *
 * 缓存键命名规范:
 * - 格式: {module}:{resource}:{params}
 * - 示例:
 *   - variantGroups:US:ALL:pageSize:10 (变体组列表)
 *   - monitorHistoryCount:US:2025-01-01 (监控历史计数)
 *   - variantGroup:{groupId} (变体组详情)
 *   - asin:{asinId} (ASIN详情)
 *
 * 模块前缀:
 * - variantGroups: 变体组相关
 * - monitorHistory: 监控历史相关
 * - asin: ASIN相关
 * - statistics: 统计相关
 */

const DEFAULT_TTL_MS = Number(process.env.CACHE_DEFAULT_TTL_MS) || 30 * 1000;
const DEFAULT_MAX_ENTRIES = Number(process.env.CACHE_MAX_ENTRIES) || 2000;
const DEFAULT_CLEANUP_INTERVAL_MS =
  Number(process.env.CACHE_CLEANUP_INTERVAL_MS) || 60 * 1000;
const redisConfig = require('../config/redis');
const logger = require('../utils/logger');

class CacheService {
  constructor() {
    this.store = new Map();
    this.ttl = DEFAULT_TTL_MS;
    this.maxEntries = DEFAULT_MAX_ENTRIES;
    this.cleanupInterval = DEFAULT_CLEANUP_INTERVAL_MS;
    this._cleanupTimer = null;
    this._startCleanup();
  }

  configure({ ttl, maxEntries, cleanupInterval } = {}) {
    if (typeof ttl === 'number' && ttl > 0) {
      this.ttl = ttl;
    }
    if (typeof maxEntries === 'number' && maxEntries > 0) {
      this.maxEntries = maxEntries;
    }
    if (typeof cleanupInterval === 'number' && cleanupInterval > 0) {
      this.cleanupInterval = cleanupInterval;
      this._restartCleanup();
    }
  }

  _startCleanup() {
    if (this._cleanupTimer) {
      return;
    }
    this._cleanupTimer = setInterval(() => {
      this._evictExpired();
    }, this.cleanupInterval);
    this._cleanupTimer.unref && this._cleanupTimer.unref();
  }

  _restartCleanup() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
    this._startCleanup();
  }

  _evictExpired() {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiry) {
        this.store.delete(key);
      }
    }
  }

  _ensureCapacity() {
    if (this.store.size < this.maxEntries) {
      return;
    }
    const oldestKey = this.store.keys().next().value;
    if (oldestKey) {
      this.store.delete(oldestKey);
    }
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) {
      return null;
    }
    if (Date.now() > entry.expiry) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value, ttl = this.ttl) {
    this._ensureCapacity();
    const expiry = Date.now() + ttl;
    this.store.set(key, { value, expiry });
  }

  async getAsync(key) {
    const memoryValue = this.get(key);
    if (memoryValue !== null) {
      return memoryValue;
    }

    if (!redisConfig.isRedisAvailable()) {
      return null;
    }

    try {
      const client = redisConfig.getRedisClient();
      if (!client) {
        return null;
      }
      const result = await client.multi().get(key).pttl(key).exec();
      const rawValue = result?.[0]?.[1];
      const ttlMs = result?.[1]?.[1];
      if (!rawValue) {
        return null;
      }
      const parsed = JSON.parse(rawValue);
      const fallbackTtl =
        typeof ttlMs === 'number' && ttlMs > 0 ? ttlMs : this.ttl;
      this.set(key, parsed, fallbackTtl);
      return parsed;
    } catch (error) {
      logger.warn('Redis缓存读取失败:', error.message);
      return null;
    }
  }

  async setAsync(key, value, ttl = this.ttl) {
    this.set(key, value, ttl);
    if (!redisConfig.isRedisAvailable()) {
      return;
    }
    try {
      const client = redisConfig.getRedisClient();
      if (!client) {
        return;
      }
      const payload = JSON.stringify(value);
      if (typeof ttl === 'number' && ttl > 0) {
        await client.set(key, payload, 'PX', ttl);
      } else {
        await client.set(key, payload);
      }
    } catch (error) {
      logger.warn('Redis缓存写入失败:', error.message);
    }
  }

  delete(key) {
    this.store.delete(key);
  }

  async deleteAsync(key) {
    this.delete(key);
    if (!redisConfig.isRedisAvailable()) {
      return;
    }
    try {
      const client = redisConfig.getRedisClient();
      if (client) {
        await client.del(key);
      }
    } catch (error) {
      logger.warn('Redis缓存删除失败:', error.message);
    }
  }

  deleteByPrefix(prefix) {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  async deleteByPrefixAsync(prefix) {
    this.deleteByPrefix(prefix);
    if (!redisConfig.isRedisAvailable()) {
      return;
    }
    try {
      const client = redisConfig.getRedisClient();
      if (!client) {
        return;
      }
      let cursor = '0';
      do {
        const [nextCursor, keys] = await client.scan(
          cursor,
          'MATCH',
          `${prefix}*`,
          'COUNT',
          200,
        );
        cursor = nextCursor;
        if (keys.length > 0) {
          await client.del(...keys);
        }
      } while (cursor !== '0');
    } catch (error) {
      logger.warn('Redis缓存前缀删除失败:', error.message);
    }
  }

  /**
   * 获取所有缓存键（用于缓存预热）
   * @param {string} prefix - 键前缀（可选）
   * @returns {Array<string>}
   */
  getKeys(prefix = null) {
    const keys = Array.from(this.store.keys());
    if (prefix) {
      return keys.filter((key) => key.startsWith(prefix));
    }
    return keys;
  }

  /**
   * 获取缓存条目的过期时间
   * @param {string} key - 缓存键
   * @returns {number|null} 过期时间戳，如果不存在则返回null
   */
  getExpiry(key) {
    const entry = this.store.get(key);
    if (!entry) {
      return null;
    }
    return entry.expiry;
  }

  /**
   * 获取剩余时间（毫秒）
   * @param {string} key - 缓存键
   * @returns {number|null} 剩余时间（毫秒），如果不存在或已过期则返回null
   */
  getTimeToExpiry(key) {
    const expiry = this.getExpiry(key);
    if (!expiry) {
      return null;
    }
    const remaining = expiry - Date.now();
    return remaining > 0 ? remaining : null;
  }

  /**
   * 获取内存统计信息
   * @returns {Object} 内存统计
   */
  getMemoryStats() {
    const now = Date.now();
    let expiredCount = 0;
    let activeCount = 0;
    let totalSize = 0;

    for (const [key, entry] of this.store) {
      if (now > entry.expiry) {
        expiredCount++;
      } else {
        activeCount++;
        // 估算每个条目的内存大小（粗略估算）
        const keySize = key.length * 2; // UTF-16编码，每个字符2字节
        const valueSize = JSON.stringify(entry.value).length * 2;
        totalSize += keySize + valueSize + 100; // 加上对象开销
      }
    }

    const memoryUsage = process.memoryUsage();
    const memoryMB = memoryUsage.heapUsed / 1024 / 1024;
    const cacheMemoryMB = totalSize / 1024 / 1024;

    return {
      totalEntries: this.store.size,
      activeEntries: activeCount,
      expiredEntries: expiredCount,
      maxEntries: this.maxEntries,
      usagePercent: ((this.store.size / this.maxEntries) * 100).toFixed(2),
      estimatedCacheMemoryMB: cacheMemoryMB.toFixed(2),
      totalHeapMemoryMB: memoryMB.toFixed(2),
      cacheMemoryPercent: ((cacheMemoryMB / memoryMB) * 100).toFixed(2),
    };
  }
}

module.exports = new CacheService();
