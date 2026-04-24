const multer = require('multer');
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
  let statusCode = 500;

  if (typeof err.statusCode === 'number') {
    statusCode = err.statusCode;
  } else if (typeof err.status === 'number') {
    statusCode = err.status;
  } else if (err instanceof multer.MulterError) {
    statusCode = 400;
  } else if (typeof err.code === 'number') {
    statusCode = err.code;
  }

  // 如果是已知错误类型，返回友好信息
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      errorMessage = '上传文件不能超过 10MB';
    } else {
      errorMessage = err.message || '文件上传失败';
    }
  } else if (statusCode < 500) {
    errorMessage = err.message || errorMessage;
  } else if (!isProduction) {
    // 开发环境返回详细错误
    errorMessage = err.message || errorMessage;
  }

  res.status(statusCode).json({
    success: false,
    errorMessage,
    errorCode: statusCode,
    // 仅在开发环境返回堆栈信息
    ...(!isProduction && { stack: err.stack }),
  });
}

module.exports = errorHandler;
