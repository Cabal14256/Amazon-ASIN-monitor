/**
 * 权限缓存服务
 * 支持Redis缓存，如果Redis不可用则降级到内存缓存
 */

const redisConfig = require('../config/redis');
const { query } = require('../config/database');
const logger = require('../utils/logger');

// 内存缓存（降级方案）
const memoryCache = {
  permissions: new Map(), // userId -> permissions array
  roles: new Map(), // userId -> roles array
  timestamps: new Map(), // userId -> timestamp
};

// 缓存过期时间（秒）
const CACHE_TTL = 15 * 60; // 15分钟

/**
 * 获取缓存键
 */
function getCacheKey(type, userId) {
  return `user:${type}:${userId}`;
}

/**
 * 从Redis获取缓存
 * @param {string} key - 缓存键
 * @returns {Promise<any|null>} 缓存值
 */
async function getFromRedis(key) {
  if (!redisConfig.isRedisAvailable()) {
    return null;
  }

  try {
    const client = redisConfig.getRedisClient();
    const value = await client.get(key);
    if (value) {
      return JSON.parse(value);
    }
    return null;
  } catch (error) {
    logger.warn('从Redis获取缓存失败:', error.message);
    return null;
  }
}

/**
 * 设置Redis缓存
 * @param {string} key - 缓存键
 * @param {any} value - 缓存值
 * @param {number} ttl - 过期时间（秒）
 */
async function setToRedis(key, value, ttl = CACHE_TTL) {
  if (!redisConfig.isRedisAvailable()) {
    return false;
  }

  try {
    const client = redisConfig.getRedisClient();
    await client.setex(key, ttl, JSON.stringify(value));
    return true;
  } catch (error) {
    logger.warn('设置Redis缓存失败:', error.message);
    return false;
  }
}

/**
 * 从Redis删除缓存
 * @param {string} key - 缓存键
 */
async function deleteFromRedis(key) {
  if (!redisConfig.isRedisAvailable()) {
    return;
  }

  try {
    const client = redisConfig.getRedisClient();
    await client.del(key);
  } catch (error) {
    logger.warn('删除Redis缓存失败:', error.message);
  }
}

/**
 * 从内存缓存获取
 * @param {string} userId - 用户ID
 * @param {string} type - 类型：'permissions' 或 'roles'
 * @returns {any|null} 缓存值
 */
function getFromMemory(userId, type) {
  const cache = memoryCache[type];
  const timestamps = memoryCache.timestamps;

  if (!cache.has(userId)) {
    return null;
  }

  const timestamp = timestamps.get(userId);
  const now = Date.now();

  // 检查是否过期
  if (timestamp && now - timestamp > CACHE_TTL * 1000) {
    cache.delete(userId);
    timestamps.delete(userId);
    return null;
  }

  return cache.get(userId);
}

/**
 * 设置内存缓存
 * @param {string} userId - 用户ID
 * @param {string} type - 类型：'permissions' 或 'roles'
 * @param {any} value - 缓存值
 */
function setToMemory(userId, type, value) {
  memoryCache[type].set(userId, value);
  memoryCache.timestamps.set(userId, Date.now());
}

/**
 * 从内存缓存删除
 * @param {string} userId - 用户ID
 * @param {string} type - 类型：'permissions' 或 'roles'，如果为null则删除所有
 */
function deleteFromMemory(userId, type = null) {
  if (type) {
    memoryCache[type].delete(userId);
  } else {
    memoryCache.permissions.delete(userId);
    memoryCache.roles.delete(userId);
  }
  memoryCache.timestamps.delete(userId);
}

/**
 * 获取用户权限（先查缓存）
 * @param {string} userId - 用户ID
 * @returns {Promise<Array>} 权限列表
 */
async function getUserPermissions(userId) {
  // 先查Redis缓存
  const redisKey = getCacheKey('permissions', userId);
  const cached = await getFromRedis(redisKey);
  if (cached) {
    return cached;
  }

  // 再查内存缓存
  const memoryCached = getFromMemory(userId, 'permissions');
  if (memoryCached) {
    // 异步回填Redis
    setToRedis(redisKey, memoryCached).catch(() => {});
    return memoryCached;
  }

  // 缓存未命中，从数据库查询（直接查询，避免循环依赖）
  const permissions = await query(
    `SELECT p.code, p.name, p.resource, p.action
     FROM user_roles ur
     JOIN role_permissions rp ON ur.role_id = rp.role_id
     JOIN permissions p ON rp.permission_id = p.id
     WHERE ur.user_id = ?
     ORDER BY p.code`,
    [userId],
  );
  const permissionCodes = permissions.map((p) => p.code);

  // 存入缓存
  await setToRedis(redisKey, permissionCodes);
  setToMemory(userId, 'permissions', permissionCodes);

  return permissionCodes;
}

/**
 * 获取用户角色（先查缓存）
 * @param {string} userId - 用户ID
 * @returns {Promise<Array>} 角色列表
 */
async function getUserRoles(userId) {
  // 先查Redis缓存
  const redisKey = getCacheKey('roles', userId);
  const cached = await getFromRedis(redisKey);
  if (cached) {
    return cached;
  }

  // 再查内存缓存
  const memoryCached = getFromMemory(userId, 'roles');
  if (memoryCached) {
    // 异步回填Redis
    setToRedis(redisKey, memoryCached).catch(() => {});
    return memoryCached;
  }

  // 缓存未命中，从数据库查询（直接查询，避免循环依赖）
  const roles = await query(
    `SELECT r.id, r.code, r.name
     FROM user_roles ur
     JOIN roles r ON ur.role_id = r.id
     WHERE ur.user_id = ?
     ORDER BY r.code`,
    [userId],
  );

  // 存入缓存
  await setToRedis(redisKey, roles);
  setToMemory(userId, 'roles', roles);

  return roles;
}

/**
 * 清除用户缓存
 * @param {string} userId - 用户ID
 */
async function clearUserCache(userId) {
  // 清除Redis缓存
  await deleteFromRedis(getCacheKey('permissions', userId));
  await deleteFromRedis(getCacheKey('roles', userId));

  // 清除内存缓存
  deleteFromMemory(userId);
}

/**
 * 清除所有缓存
 */
async function clearAllCache() {
  if (redisConfig.isRedisAvailable()) {
    try {
      const client = redisConfig.getRedisClient();
      const keys = await client.keys('user:*');
      if (keys.length > 0) {
        await client.del(...keys);
      }
    } catch (error) {
      logger.warn('清除Redis缓存失败:', error.message);
    }
  }

  // 清除内存缓存
  memoryCache.permissions.clear();
  memoryCache.roles.clear();
  memoryCache.timestamps.clear();
}

module.exports = {
  getUserPermissions,
  getUserRoles,
  clearUserCache,
  clearAllCache,
  CACHE_TTL,
};
