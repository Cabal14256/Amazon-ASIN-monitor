/**
 * 数据分析缓存服务
 * 优先使用内存缓存，Redis可用时读写Redis以支持跨实例缓存
 */

const cacheService = require('./cacheService');
const redisConfig = require('../config/redis');
const logger = require('../utils/logger');

const DEFAULT_MEMORY_FALLBACK_TTL_MS = 60 * 1000;
const KEY_PREFIX = 'analytics:';

function buildKey(key) {
  return `${KEY_PREFIX}${key}`;
}

async function getFromRedis(key) {
  if (!redisConfig.isRedisAvailable()) {
    return { value: null, ttlMs: null };
  }

  try {
    const client = redisConfig.getRedisClient();
    const redisKey = buildKey(key);
    const result = await client.multi().get(redisKey).pttl(redisKey).exec();

    const value = result?.[0]?.[1];
    const ttlMs = result?.[1]?.[1];

    if (!value) {
      return { value: null, ttlMs: null };
    }

    return { value: JSON.parse(value), ttlMs };
  } catch (error) {
    logger.warn('从Redis获取统计缓存失败:', error.message);
    return { value: null, ttlMs: null };
  }
}

async function setToRedis(key, value, ttlMs) {
  if (!redisConfig.isRedisAvailable()) {
    return false;
  }

  try {
    const client = redisConfig.getRedisClient();
    const redisKey = buildKey(key);
    if (typeof ttlMs === 'number' && ttlMs > 0) {
      await client.set(redisKey, JSON.stringify(value), 'PX', ttlMs);
    } else {
      await client.set(redisKey, JSON.stringify(value));
    }
    return true;
  } catch (error) {
    logger.warn('设置Redis统计缓存失败:', error.message);
    return false;
  }
}

async function deleteByPrefix(prefix) {
  cacheService.deleteByPrefix(prefix);

  if (!redisConfig.isRedisAvailable()) {
    return;
  }

  try {
    const client = redisConfig.getRedisClient();
    const pattern = buildKey(`${prefix}*`);
    let cursor = '0';
    do {
      const [nextCursor, keys] = await client.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        200,
      );
      cursor = nextCursor;
      if (keys.length > 0) {
        await client.del(...keys);
      }
    } while (cursor !== '0');
  } catch (error) {
    logger.warn('删除Redis统计缓存失败:', error.message);
  }
}

async function get(key) {
  const memoryCached = cacheService.get(key);
  if (memoryCached !== null) {
    return memoryCached;
  }

  const { value, ttlMs } = await getFromRedis(key);
  if (value !== null) {
    const fallbackTtl =
      typeof ttlMs === 'number' && ttlMs > 0
        ? ttlMs
        : DEFAULT_MEMORY_FALLBACK_TTL_MS;
    cacheService.set(key, value, fallbackTtl);
    return value;
  }

  return null;
}

async function set(key, value, ttlMs) {
  if (typeof ttlMs === 'number' && ttlMs > 0) {
    cacheService.set(key, value, ttlMs);
  } else {
    cacheService.set(key, value);
  }
  await setToRedis(key, value, ttlMs);
}

module.exports = {
  get,
  set,
  deleteByPrefix,
};
