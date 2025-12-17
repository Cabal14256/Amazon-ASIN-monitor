const logger = require('../utils/logger');

/**
 * 统一错误处理
 * @param {Error} error - 错误对象
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 */
function handleControllerError(error, req, res) {
  logger.error(`[${req.method} ${req.path}] 错误:`, error);
  const statusCode = error.statusCode || error.code || 500;
  res.status(statusCode).json({
    success: false,
    errorMessage: error.message || '操作失败',
    errorCode: statusCode,
    errorDetails:
      process.env.NODE_ENV === 'development' ? error.stack : undefined,
  });
}

/**
 * 统一成功响应
 * @param {Object} res - Express 响应对象
 * @param {*} data - 响应数据
 * @param {string} message - 可选的成功消息
 */
function sendSuccessResponse(res, data, message) {
  const response = {
    success: true,
    data,
    errorCode: 0,
  };
  if (message) {
    response.message = message;
  }
  res.json(response);
}

/**
 * 统一错误响应
 * @param {Object} res - Express 响应对象
 * @param {number} statusCode - HTTP 状态码
 * @param {string} message - 错误消息
 * @param {number} errorCode - 业务错误码（可选，默认与 statusCode 相同）
 */
function sendErrorResponse(res, statusCode, message, errorCode) {
  res.status(statusCode).json({
    success: false,
    errorMessage: message,
    errorCode: errorCode || statusCode,
  });
}

/**
 * 验证必填字段
 * @param {Object} body - 请求体对象
 * @param {Array<string>} fields - 必填字段列表
 * @throws {Object} 如果缺少必填字段，抛出包含 statusCode 和 message 的错误对象
 */
function validateRequiredFields(body, fields) {
  const missing = fields.filter((field) => !body[field]);
  if (missing.length > 0) {
    const error = new Error(`缺少必填字段: ${missing.join(', ')}`);
    error.statusCode = 400;
    throw error;
  }
}

/**
 * 创建异步控制器包装器，自动处理错误
 * @param {Function} controllerFn - 控制器函数
 * @returns {Function} 包装后的控制器函数
 */
function asyncHandler(controllerFn) {
  return async (req, res, next) => {
    try {
      await controllerFn(req, res, next);
    } catch (error) {
      handleControllerError(error, req, res);
    }
  };
}

module.exports = {
  handleControllerError,
  sendSuccessResponse,
  sendErrorResponse,
  validateRequiredFields,
  asyncHandler,
};
