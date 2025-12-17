const logger = require('../utils/logger');

/**
 * 请求超时中间件
 * @param {number} timeout - 超时时间（毫秒），默认30秒
 * @returns {Function} Express 中间件函数
 */
function timeoutMiddleware(timeout = 30000) {
  return (req, res, next) => {
    const timer = setTimeout(() => {
      // 检查响应是否已经发送或连接已关闭
      if (!res.headersSent && !res.destroyed && res.writable) {
        logger.warn(
          `请求超时: ${req.method} ${req.url} (超时时间: ${timeout}ms)`,
        );

        // 检查是否是SSE响应
        const contentType = res.getHeader('Content-Type');
        if (contentType === 'text/event-stream') {
          // SSE响应，发送错误消息
          try {
            res.write(
              `data: ${JSON.stringify({
                type: 'error',
                errorMessage: '请求超时，请稍后重试',
              })}\n\n`,
            );
            res.end();
          } catch (e) {
            logger.error('SSE超时响应发送失败:', e);
            try {
              res.end();
            } catch (e2) {
              // 忽略关闭错误
            }
          }
        } else {
          // 普通HTTP响应
          try {
            res.status(504).json({
              success: false,
              errorMessage: '请求超时，请稍后重试',
              errorCode: 504,
            });
          } catch (e) {
            logger.error('超时响应发送失败:', e);
            try {
              res.end();
            } catch (e2) {
              // 忽略关闭错误
            }
          }
        }
      }
    }, timeout);

    // 请求完成后清除定时器
    res.on('finish', () => {
      if (timer) clearTimeout(timer);
    });
    res.on('close', () => {
      if (timer) clearTimeout(timer);
    });

    next();
  };
}

module.exports = timeoutMiddleware;
