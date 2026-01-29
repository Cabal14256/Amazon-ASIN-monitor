/**
 * 错误分类和统计服务
 * 提供详细的错误类型分类和统计信息，便于问题诊断
 */
const logger = require('../utils/logger');

// 错误类型定义
const ERROR_TYPES = {
  RATE_LIMIT: 'RATE_LIMIT', // 429限流错误
  AUTH_ERROR: 'AUTH_ERROR', // 401认证错误
  FORBIDDEN: 'FORBIDDEN', // 403权限错误
  NOT_FOUND: 'NOT_FOUND', // 404未找到
  INVALID_INPUT: 'INVALID_INPUT', // 400参数错误
  SERVER_ERROR: 'SERVER_ERROR', // 500/503服务器错误
  NETWORK_ERROR: 'NETWORK_ERROR', // 网络错误
  TIMEOUT: 'TIMEOUT', // 超时错误
  UNKNOWN: 'UNKNOWN', // 未知错误
};

// 错误统计数据结构
const errorStats = {
  // 按错误类型统计
  byType: {},

  // 按区域统计
  byRegion: {
    US: {},
    EU: {},
  },

  // 时间序列统计（最近1000条记录）
  timeSeries: [],

  // 总计
  total: 0,

  // 最近1小时的错误
  recentHour: [],
};

// 初始化错误类型统计
Object.values(ERROR_TYPES).forEach((type) => {
  errorStats.byType[type] = {
    count: 0,
    lastOccurred: null,
    recentWindow: [], // 最近窗口内的错误
  };

  errorStats.byRegion.US[type] = {
    count: 0,
    lastOccurred: null,
  };
  errorStats.byRegion.EU[type] = {
    count: 0,
    lastOccurred: null,
  };
});

/**
 * 从错误对象中提取错误类型
 * @param {Error} error - 错误对象
 * @param {string} region - 区域代码
 * @returns {string} 错误类型
 */
function classifyError(error, region = 'US') {
  if (!error) {
    return ERROR_TYPES.UNKNOWN;
  }

  const statusCode = error.statusCode || error.message.match(/\d{3}/)?.[0];
  const errorMessage = error.message || '';

  // 429限流错误
  if (
    statusCode === 429 ||
    errorMessage.includes('429') ||
    errorMessage.includes('QuotaExceeded') ||
    errorMessage.includes('TooManyRequests')
  ) {
    return ERROR_TYPES.RATE_LIMIT;
  }

  // 401认证错误
  if (
    statusCode === 401 ||
    errorMessage.includes('401') ||
    errorMessage.includes('Unauthorized')
  ) {
    return ERROR_TYPES.AUTH_ERROR;
  }

  // 403权限错误
  if (
    statusCode === 403 ||
    errorMessage.includes('403') ||
    errorMessage.includes('Forbidden')
  ) {
    return ERROR_TYPES.FORBIDDEN;
  }

  // 404未找到
  if (
    statusCode === 404 ||
    errorMessage.includes('404') ||
    errorMessage.includes('NotFound')
  ) {
    return ERROR_TYPES.NOT_FOUND;
  }

  // 400参数错误
  if (
    statusCode === 400 ||
    errorMessage.includes('400') ||
    errorMessage.includes('Bad Request')
  ) {
    return ERROR_TYPES.INVALID_INPUT;
  }

  // 500/503服务器错误
  if (
    statusCode === 500 ||
    statusCode === 503 ||
    errorMessage.includes('500') ||
    errorMessage.includes('503') ||
    errorMessage.includes('Internal Server Error') ||
    errorMessage.includes('Service Unavailable')
  ) {
    return ERROR_TYPES.SERVER_ERROR;
  }

  // 网络错误
  if (
    errorMessage.includes('ECONNRESET') ||
    errorMessage.includes('ENOTFOUND') ||
    errorMessage.includes('ETIMEDOUT') ||
    errorMessage.includes('network')
  ) {
    return ERROR_TYPES.NETWORK_ERROR;
  }

  // 超时错误
  if (errorMessage.includes('timeout') || errorMessage.includes('TIMEOUT')) {
    return ERROR_TYPES.TIMEOUT;
  }

  return ERROR_TYPES.UNKNOWN;
}

/**
 * 记录错误
 * @param {string} errorType - 错误类型
 * @param {string} region - 区域代码
 * @param {Error} error - 错误对象（可选）
 */
function recordError(errorType, region = 'US', error = null) {
  const normalizedRegion = region === 'US' ? 'US' : 'EU';
  const timestamp = new Date();

  // 更新全局统计
  if (errorStats.byType[errorType]) {
    errorStats.byType[errorType].count++;
    errorStats.byType[errorType].lastOccurred = timestamp;

    // 添加到最近窗口（保留最近100条）
    errorStats.byType[errorType].recentWindow.push(timestamp);
    if (errorStats.byType[errorType].recentWindow.length > 100) {
      errorStats.byType[errorType].recentWindow.shift();
    }
  }

  // 更新区域统计
  if (
    errorStats.byRegion[normalizedRegion] &&
    errorStats.byRegion[normalizedRegion][errorType]
  ) {
    errorStats.byRegion[normalizedRegion][errorType].count++;
    errorStats.byRegion[normalizedRegion][errorType].lastOccurred = timestamp;
  }

  // 添加到时间序列
  errorStats.timeSeries.push({
    type: errorType,
    region: normalizedRegion,
    timestamp,
    message: error?.message || '',
    statusCode: error?.statusCode || null,
  });

  // 保持时间序列在1000条以内
  if (errorStats.timeSeries.length > 1000) {
    errorStats.timeSeries.shift();
  }

  // 添加到最近1小时
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  errorStats.recentHour = errorStats.recentHour.filter(
    (item) => item.timestamp.getTime() > oneHourAgo,
  );
  errorStats.recentHour.push({
    type: errorType,
    region: normalizedRegion,
    timestamp,
  });

  errorStats.total++;
}

/**
 * 记录错误（自动分类）
 * @param {Error} error - 错误对象
 * @param {string} region - 区域代码
 */
function recordErrorAuto(error, region = 'US') {
  const errorType = classifyError(error, region);
  recordError(errorType, region, error);
}

/**
 * 获取错误统计
 * @param {Object} options - 选项
 * @param {string} options.region - 区域代码（可选）
 * @param {string} options.type - 错误类型（可选）
 * @param {number} options.hours - 最近N小时（可选，默认1）
 * @returns {Object} 错误统计
 */
function getErrorStats(options = {}) {
  const { region, type, hours = 1 } = options;
  const hoursAgo = Date.now() - hours * 60 * 60 * 1000;

  // 过滤时间序列
  const filteredTimeSeries = errorStats.timeSeries.filter(
    (item) => item.timestamp.getTime() > hoursAgo,
  );

  // 按区域过滤
  let filteredByRegion = errorStats.byRegion;
  if (region) {
    const normalizedRegion = region === 'US' ? 'US' : 'EU';
    filteredByRegion = {
      [normalizedRegion]: errorStats.byRegion[normalizedRegion],
    };
  }

  // 按类型过滤
  let filteredByType = errorStats.byType;
  if (type) {
    filteredByType = {
      [type]: errorStats.byType[type] || {},
    };
  }

  // 统计最近N小时的错误
  const recentErrors = filteredTimeSeries.filter((item) => {
    if (region && item.region !== region) return false;
    if (type && item.type !== type) return false;
    return true;
  });

  return {
    total: errorStats.total,
    recent: {
      count: recentErrors.length,
      hours,
      byType: {},
      byRegion: {},
    },
    byType: filteredByType,
    byRegion: filteredByRegion,
    timeSeries: filteredTimeSeries.slice(-100), // 返回最近100条
  };
}

/**
 * 获取错误率（最近N次检查）
 * @param {number} windowSize - 窗口大小，默认50
 * @returns {Object} 错误率统计
 */
function getErrorRate(windowSize = 50) {
  const recent = errorStats.timeSeries.slice(-windowSize);
  const errorCount = recent.length;
  const byType = {};

  recent.forEach((item) => {
    byType[item.type] = (byType[item.type] || 0) + 1;
  });

  return {
    errorCount,
    totalChecks: windowSize,
    errorRate: errorCount / windowSize,
    byType,
  };
}

/**
 * 重置统计
 */
function resetStats() {
  Object.values(ERROR_TYPES).forEach((type) => {
    errorStats.byType[type] = {
      count: 0,
      lastOccurred: null,
      recentWindow: [],
    };
    errorStats.byRegion.US[type] = {
      count: 0,
      lastOccurred: null,
    };
    errorStats.byRegion.EU[type] = {
      count: 0,
      lastOccurred: null,
    };
  });

  errorStats.timeSeries = [];
  errorStats.total = 0;
  errorStats.recentHour = [];

  logger.info('[错误统计服务] 统计已重置');
}

module.exports = {
  ERROR_TYPES,
  recordError,
  recordErrorAuto,
  classifyError,
  getErrorStats,
  getErrorRate,
  resetStats,
};
