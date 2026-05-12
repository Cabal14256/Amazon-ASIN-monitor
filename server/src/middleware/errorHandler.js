const logger = require('../utils/logger');

function getErrorStatusCode(err) {
  const statusCode = Number(err.statusCode || err.status || err.code);
  if (Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599) {
    return statusCode;
  }

  if (err.name === 'MulterError') {
    return 400;
  }

  return 500;
}

/**
 * 统一的错误处理中间件
 */
function errorHandler(err, req, res, next) {
  const statusCode = getErrorStatusCode(err);
  const logContext = {
    message: err.message,
    url: req.url,
    method: req.method,
    ip: req.ip,
  };

  if (statusCode >= 500) {
    logger.error('服务器错误:', {
      ...logContext,
      stack: err.stack,
    });
  } else {
    logger.warn('请求处理失败:', {
      ...logContext,
      statusCode,
    });
  }

  // 根据环境返回不同错误信息
  const isProduction = process.env.NODE_ENV === 'production';

  // 默认错误信息
  let errorMessage = '服务器内部错误';

  // 如果是已知错误类型，返回友好信息
  if (statusCode < 500) {
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
