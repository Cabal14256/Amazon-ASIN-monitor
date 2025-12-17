/**
 * API限流中间件
 * 防止API滥用和DDoS攻击
 * 支持基于角色的限流
 */

let rateLimit = null;

try {
  rateLimit = require('express-rate-limit');
} catch (error) {
  // express-rate-limit未安装，使用简单的内存限流
}

const User = require('../models/User');
const logger = require('../utils/logger');

// 限流统计
const rateLimitStats = {
  totalRequests: 0,
  blockedRequests: 0,
  byRole: {
    ADMIN: { requests: 0, blocked: 0 },
    EDITOR: { requests: 0, blocked: 0 },
    READONLY: { requests: 0, blocked: 0 },
    DEFAULT: { requests: 0, blocked: 0 },
  },
  lastReset: Date.now(),
};

// 基于角色的限流配置
const ROLE_LIMITS = {
  ADMIN: 1000, // 管理员：15分钟内最多1000个请求
  EDITOR: 500, // 编辑用户：15分钟内最多500个请求
  READONLY: 100, // 只读用户：15分钟内最多100个请求
  DEFAULT: 100, // 默认：15分钟内最多100个请求
};

/**
 * 基于角色的API限流器
 * 注意：express-rate-limit 的 max 不支持异步函数
 * 因此我们需要在限流之前通过中间件获取用户角色
 */
function createRoleBasedLimiter() {
  if (!rateLimit) {
    return (req, res, next) => next();
  }

  // 为每个角色创建独立的限流器
  const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: ROLE_LIMITS.ADMIN,
    message: {
      success: false,
      errorMessage: '请求过于频繁，请稍后再试',
      errorCode: 429,
    },
    standardHeaders: true,
    legacyHeaders: false,
    onLimitReached: (req, res, options) => {
      rateLimitStats.blockedRequests++;
      rateLimitStats.byRole.ADMIN.blocked++;
      logger.warn(`限流触发: ADMIN 角色, IP: ${req.ip}`);
    },
  });

  const editorLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: ROLE_LIMITS.EDITOR,
    message: {
      success: false,
      errorMessage: '请求过于频繁，请稍后再试',
      errorCode: 429,
    },
    standardHeaders: true,
    legacyHeaders: false,
    onLimitReached: (req, res, options) => {
      rateLimitStats.blockedRequests++;
      rateLimitStats.byRole.EDITOR.blocked++;
      logger.warn(`限流触发: EDITOR 角色, IP: ${req.ip}`);
    },
  });

  const readonlyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: ROLE_LIMITS.READONLY,
    message: {
      success: false,
      errorMessage: '请求过于频繁，请稍后再试',
      errorCode: 429,
    },
    standardHeaders: true,
    legacyHeaders: false,
    onLimitReached: (req, res, options) => {
      rateLimitStats.blockedRequests++;
      rateLimitStats.byRole.READONLY.blocked++;
      logger.warn(`限流触发: READONLY 角色, IP: ${req.ip}`);
    },
  });

  const defaultLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: ROLE_LIMITS.DEFAULT,
    message: {
      success: false,
      errorMessage: '请求过于频繁，请稍后再试',
      errorCode: 429,
    },
    standardHeaders: true,
    legacyHeaders: false,
    onLimitReached: (req, res, options) => {
      rateLimitStats.blockedRequests++;
      rateLimitStats.byRole.DEFAULT.blocked++;
      logger.warn(`限流触发: DEFAULT 角色, IP: ${req.ip}`);
    },
  });

  // 返回一个中间件，根据用户角色选择对应的限流器
  return async (req, res, next) => {
    // 白名单IP直接通过
    if (isWhitelisted(req)) {
      return next();
    }

    // 如果用户已认证，尝试获取角色
    if (req.userId) {
      try {
        const roles = await User.getUserRoles(req.userId);
        const roleCodes = roles.map((r) => r.code);

        // 根据角色选择限流器
        if (roleCodes.includes('ADMIN')) {
          rateLimitStats.totalRequests++;
          rateLimitStats.byRole.ADMIN.requests++;
          return adminLimiter(req, res, next);
        } else if (roleCodes.includes('EDITOR')) {
          rateLimitStats.totalRequests++;
          rateLimitStats.byRole.EDITOR.requests++;
          return editorLimiter(req, res, next);
        } else if (roleCodes.includes('READONLY')) {
          rateLimitStats.totalRequests++;
          rateLimitStats.byRole.READONLY.requests++;
          return readonlyLimiter(req, res, next);
        }
      } catch (error) {
        logger.error('获取用户角色失败:', error);
        // 出错时使用默认限流器
        rateLimitStats.totalRequests++;
        rateLimitStats.byRole.DEFAULT.requests++;
        return defaultLimiter(req, res, next);
      }
    }

    // 未认证用户使用默认限流器
    rateLimitStats.totalRequests++;
    rateLimitStats.byRole.DEFAULT.requests++;
    return defaultLimiter(req, res, next);
  };
}

const roleBasedLimiter = createRoleBasedLimiter();

// 通用API限流器（15分钟内最多100个请求，用于未认证的请求）
const apiLimiter = rateLimit
  ? rateLimit({
      windowMs: 15 * 60 * 1000, // 15分钟
      max: 100, // 最多100个请求
      message: {
        success: false,
        errorMessage: '请求过于频繁，请稍后再试',
        errorCode: 429,
      },
      standardHeaders: true, // 返回RateLimit-* headers
      legacyHeaders: false, // 禁用X-RateLimit-* headers
      onLimitReached: (req, res, options) => {
        rateLimitStats.blockedRequests++;
        rateLimitStats.byRole.DEFAULT.blocked++;
        logger.warn(`限流触发: API限流器, IP: ${req.ip}`);
      },
    })
  : (req, res, next) => next(); // 如果未安装，直接通过

// 严格限流器（15分钟内最多20个请求，用于敏感操作）
const strictLimiter = rateLimit
  ? rateLimit({
      windowMs: 15 * 60 * 1000, // 15分钟
      max: 20, // 最多20个请求
      message: {
        success: false,
        errorMessage: '请求过于频繁，请稍后再试',
        errorCode: 429,
      },
      standardHeaders: true,
      legacyHeaders: false,
    })
  : (req, res, next) => next();

// IP白名单（从环境变量读取）
const WHITELIST_IPS = (process.env.RATE_LIMIT_WHITELIST_IPS || '')
  .split(',')
  .filter((ip) => ip.trim().length > 0);

// 检查IP是否在白名单中
function isWhitelisted(req) {
  const ip = req.ip || req.connection.remoteAddress;
  return WHITELIST_IPS.includes(ip);
}

// 带白名单的限流器
function createLimiterWithWhitelist(limiter) {
  return (req, res, next) => {
    if (isWhitelisted(req)) {
      return next(); // 白名单IP直接通过
    }
    return limiter(req, res, next);
  };
}

/**
 * 获取限流统计信息
 * @returns {Object} 限流统计
 */
function getRateLimitStats() {
  return {
    ...rateLimitStats,
    blockRate:
      rateLimitStats.totalRequests > 0
        ? (
            (rateLimitStats.blockedRequests / rateLimitStats.totalRequests) *
            100
          ).toFixed(2)
        : '0.00',
  };
}

/**
 * 重置限流统计
 */
function resetRateLimitStats() {
  rateLimitStats.totalRequests = 0;
  rateLimitStats.blockedRequests = 0;
  rateLimitStats.byRole = {
    ADMIN: { requests: 0, blocked: 0 },
    EDITOR: { requests: 0, blocked: 0 },
    READONLY: { requests: 0, blocked: 0 },
    DEFAULT: { requests: 0, blocked: 0 },
  };
  rateLimitStats.lastReset = Date.now();
}

module.exports = {
  apiLimiter: createLimiterWithWhitelist(apiLimiter),
  roleBasedLimiter: createLimiterWithWhitelist(roleBasedLimiter),
  strictLimiter: createLimiterWithWhitelist(strictLimiter),
  isWhitelisted,
  ROLE_LIMITS,
  getRateLimitStats,
  resetRateLimitStats,
};
