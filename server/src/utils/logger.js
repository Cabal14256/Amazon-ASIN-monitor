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

    switch (level.toUpperCase()) {
      case 'DEBUG':
        console.debug(prefix, message, ...args);
        break;
      case 'INFO':
        console.info(prefix, message, ...args);
        break;
      case 'WARN':
        console.warn(prefix, message, ...args);
        break;
      case 'ERROR':
        console.error(prefix, message, ...args);
        break;
      default:
        console.log(prefix, message, ...args);
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
