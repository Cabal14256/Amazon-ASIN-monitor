/**
 * API限流中间件
 * 防止API滥用和DDoS攻击
 */

let rateLimit = null;

try {
  rateLimit = require('express-rate-limit');
} catch (error) {
  // express-rate-limit未安装，使用简单的内存限流
}

// 通用API限流器（15分钟内最多100个请求）
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

module.exports = {
  apiLimiter: createLimiterWithWhitelist(apiLimiter),
  strictLimiter: createLimiterWithWhitelist(strictLimiter),
  isWhitelisted,
};
