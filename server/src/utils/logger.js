/**
 * 日志工具模块
 * 根据环境变量控制日志级别，减少生产环境日志
 */

const { getUTC8ISOString } = require('./dateTime');

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

// 从环境变量读取日志级别，默认为INFO
const LOG_LEVEL_NAME = (process.env.LOG_LEVEL || 'INFO').toUpperCase();
const LOG_LEVEL =
  LOG_LEVELS[LOG_LEVEL_NAME] !== undefined
    ? LOG_LEVELS[LOG_LEVEL_NAME]
    : LOG_LEVELS.INFO;

// 敏感字段列表
const SENSITIVE_FIELDS = [
  'password',
  'pwd',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'apiKey',
  'apikey',
  'authorization',
  'auth',
];

/**
 * 脱敏对象中的敏感字段
 */
function sanitizeData(data) {
  if (!data || typeof data !== 'object') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(sanitizeData);
  }

  const sanitized = { ...data };
  for (const key in sanitized) {
    if (Object.prototype.hasOwnProperty.call(sanitized, key)) {
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_FIELDS.some((field) => lowerKey.includes(field))) {
        sanitized[key] = '***REDACTED***';
      } else if (typeof sanitized[key] === 'object') {
        sanitized[key] = sanitizeData(sanitized[key]);
      }
    }
  }
  return sanitized;
}

/**
 * 日志函数
 * @param {string} level - 日志级别
 * @param {string} message - 日志消息
 * @param {...any} args - 其他参数
 */
function log(level, message, ...args) {
  const levelValue = LOG_LEVELS[level.toUpperCase()];
  if (levelValue === undefined) {
    return; // 无效的日志级别
  }

  if (levelValue >= LOG_LEVEL) {
    const timestamp = getUTC8ISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

    // 对参数进行脱敏处理（生产环境强制，开发环境可选）
    const shouldSanitize =
      process.env.NODE_ENV === 'production' ||
      process.env.LOG_SANITIZE !== 'false';

    const sanitizedArgs = shouldSanitize
      ? args.map((arg) => (typeof arg === 'object' ? sanitizeData(arg) : arg))
      : args;

    switch (level.toUpperCase()) {
      case 'DEBUG':
        console.debug(prefix, message, ...sanitizedArgs);
        break;
      case 'INFO':
        console.info(prefix, message, ...sanitizedArgs);
        break;
      case 'WARN':
        console.warn(prefix, message, ...sanitizedArgs);
        break;
      case 'ERROR':
        console.error(prefix, message, ...sanitizedArgs);
        break;
      default:
        console.log(prefix, message, ...sanitizedArgs);
    }
  }
}

/**
 * 调试日志
 */
function debug(message, ...args) {
  log('DEBUG', message, ...args);
}

/**
 * 信息日志
 */
function info(message, ...args) {
  log('INFO', message, ...args);
}

/**
 * 警告日志
 */
function warn(message, ...args) {
  log('WARN', message, ...args);
}

/**
 * 错误日志
 */
function error(message, ...args) {
  log('ERROR', message, ...args);
}

module.exports = {
  log,
  debug,
  info,
  warn,
  error,
  LOG_LEVELS,
  LOG_LEVEL,
  LOG_LEVEL_NAME,
};
