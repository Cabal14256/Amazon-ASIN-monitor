/**
 * Redis配置模块
 * 复用现有的Redis连接配置，提供统一的Redis客户端实例
 */

const Redis = require('ioredis');
const logger = require('../utils/logger');

// 构建 Redis 连接 URL
// 支持两种方式：
// 1. 直接使用 REDIS_URL 或 REDIS_URI（可以在 URL 中包含密码：redis://:password@host:port）
// 2. 使用单独的配置项构建 URL
function buildRedisUrl() {
  // 如果提供了完整的 Redis URL，直接使用
  if (process.env.REDIS_URL || process.env.REDIS_URI) {
    return process.env.REDIS_URL || process.env.REDIS_URI;
  }

  // 否则，使用单独的配置项构建 URL
  const host = process.env.REDIS_HOST || '127.0.0.1';
  const port = process.env.REDIS_PORT || 6379;
  const password = process.env.REDIS_PASSWORD;
  const username = process.env.REDIS_USERNAME; // Redis 6.0+ 支持用户名
  const db = process.env.REDIS_DB || '0';

  // 构建 URL
  let url = 'redis://';
  if (username && password) {
    // Redis 6.0+ 支持用户名和密码
    url += `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`;
  } else if (password) {
    // 只有密码
    url += `:${encodeURIComponent(password)}@`;
  }
  url += `${host}:${port}`;
  if (db !== '0') {
    url += `/${db}`;
  }

  return url;
}

let redisClient = null;
let redisAvailable = false;

/**
 * 初始化Redis客户端
 * @returns {Promise<Redis|null>} Redis客户端实例，如果连接失败返回null
 */
async function initRedis() {
  if (redisClient) {
    return redisClient;
  }

  try {
    const redisUrl = buildRedisUrl();

    redisClient = new Redis(redisUrl, {
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false, // 自动连接
    });

    // 监听连接事件
    redisClient.on('connect', () => {
      logger.info('✅ Redis连接成功');
      redisAvailable = true;
    });

    redisClient.on('ready', () => {
      logger.info('✅ Redis就绪');
      redisAvailable = true;
    });

    redisClient.on('error', (err) => {
      logger.warn('⚠️  Redis连接错误:', err.message);
      redisAvailable = false;
    });

    redisClient.on('close', () => {
      logger.warn('⚠️  Redis连接关闭');
      redisAvailable = false;
    });

    // 等待连接就绪（通过ping测试）
    try {
      await redisClient.ping();
      redisAvailable = true;
      logger.info('✅ Redis客户端初始化成功');
    } catch (error) {
      // ping失败，但连接可能稍后会建立
      logger.warn('⚠️  Redis ping失败，但将继续尝试:', error.message);
      redisAvailable = false;
    }

    return redisClient;
  } catch (error) {
    logger.warn('⚠️  Redis连接失败，将使用内存缓存:', error.message);
    redisAvailable = false;
    return null;
  }
}

/**
 * 获取Redis客户端
 * @returns {Redis|null} Redis客户端实例
 */
function getRedisClient() {
  return redisClient;
}

/**
 * 检查Redis是否可用
 * @returns {boolean} Redis是否可用
 */
function isRedisAvailable() {
  return redisAvailable && redisClient && redisClient.status === 'ready';
}

/**
 * 关闭Redis连接
 */
async function closeRedis() {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    redisAvailable = false;
  }
}

// 自动初始化（如果环境变量已配置）
if (process.env.REDIS_URL || process.env.REDIS_URI || process.env.REDIS_HOST) {
  initRedis().catch((err) => {
    logger.warn('Redis自动初始化失败:', err.message);
  });
}

module.exports = {
  initRedis,
  getRedisClient,
  isRedisAvailable,
  closeRedis,
  buildRedisUrl,
};
