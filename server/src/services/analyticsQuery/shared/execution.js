const { query } = require('../../../config/database');
const metricsService = require('../../metricsService');
const logger = require('../../../utils/logger');
const {
  RequestCancelledError,
  getRequestContext,
  isRequestCancelled,
  throwIfRequestCancelled,
} = require('../../../utils/requestContext');

class AnalyticsBusyError extends Error {
  constructor(message = '数据库繁忙，请稍后重试') {
    super(message);
    this.name = 'AnalyticsBusyError';
    this.code = 'ANALYTICS_BUSY';
    this.statusCode = 503;
  }
}

function getAnalyticsQueryTimeoutMs(timeoutType = 'default') {
  if (timeoutType === 'periodSummary') {
    return (
      Number(process.env.ANALYTICS_PERIOD_SUMMARY_QUERY_TIMEOUT_MS) || 240000
    );
  }

  return Number(process.env.ANALYTICS_QUERY_TIMEOUT_MS) || 300000;
}

function isAnalyticsQueryTimeoutError(error) {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '');

  return (
    code === 'PROTOCOL_SEQUENCE_TIMEOUT' ||
    code === 'ETIMEDOUT' ||
    message.includes('timeout') ||
    message.includes('Query inactivity timeout')
  );
}

async function executeAnalyticsQuery(sql, params = [], options = {}) {
  const requestContext = options.requestContext || getRequestContext();
  throwIfRequestCancelled(requestContext);

  try {
    return await query(sql, params, {
      timeoutMs:
        Number(options.timeoutMs) ||
        getAnalyticsQueryTimeoutMs(options.timeoutType),
    });
  } catch (error) {
    if (
      error instanceof RequestCancelledError ||
      isRequestCancelled(requestContext)
    ) {
      throw new RequestCancelledError(
        requestContext?.cancelReason === 'timeout'
          ? '请求已超时取消'
          : '请求已取消',
        requestContext?.cancelReason || 'cancelled',
      );
    }

    if (isAnalyticsQueryTimeoutError(error)) {
      metricsService.recordAnalyticsQueryTimeout(
        options.queryName || 'unknown',
      );
      logger.warn('[Analytics] query timeout detected', {
        queryName: options.queryName || 'unknown',
        message: error.message,
      });
    }
    throw error;
  }
}

module.exports = {
  AnalyticsBusyError,
  executeAnalyticsQuery,
  getAnalyticsQueryTimeoutMs,
  isAnalyticsQueryTimeoutError,
};
