const logger = require('../utils/logger');

/**
 * 统一的错误处理中间件
 */
function errorHandler(err, req, res, next) {
  // 记录完整错误信息到日志
  logger.error('服务器错误:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
  });

  // 根据环境返回不同错误信息
  const isProduction = process.env.NODE_ENV === 'production';

  // 默认错误信息
  let errorMessage = '服务器内部错误';
  let errorCode = err.statusCode || err.code || 500;

  // 如果是已知错误类型，返回友好信息
  if (err.statusCode && err.statusCode < 500) {
    errorMessage = err.message || errorMessage;
  } else if (!isProduction) {
    // 开发环境返回详细错误
    errorMessage = err.message || errorMessage;
  }

  res.status(errorCode).json({
    success: false,
    errorMessage,
    errorCode,
    // 仅在开发环境返回堆栈信息
    ...(!isProduction && { stack: err.stack }),
  });
}

module.exports = errorHandler;
