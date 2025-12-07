/**
 * SP-API响应头分析服务
 * 解析和存储响应头中的配额信息，用于配额管理和优化
 */

const logger = require('../utils/logger');
const operationIdentifier = require('./spApiOperationIdentifier');
const rateLimiter = require('./rateLimiter');

// 内存中存储配额统计信息
const quotaStats = {
  // 格式: { region: { operation: { rateLimit, lastUpdated, count } } }
  stats: {},
};

/**
 * 解析并记录响应头中的配额信息
 * @param {Object} headers - 响应头对象
 * @param {string} method - HTTP方法
 * @param {string} path - API路径
 * @param {string} country - 国家代码
 * @param {string} region - 区域代码（US/EU）
 * @param {string} operation - Operation名称（可选，如果提供则直接使用）
 * @returns {Object|null} 解析后的配额信息，如果无法解析则返回null
 */
function analyzeResponseHeaders(
  headers,
  method,
  path,
  country,
  region,
  operation = null,
) {
  try {
    // 提取关键响应头
    const rateLimitLimit =
      headers['x-amzn-ratelimit-limit'] || headers['x-amzn-RateLimit-Limit'];
    const requestId =
      headers['x-amzn-requestid'] || headers['x-amzn-RequestId'];

    if (!rateLimitLimit) {
      // 没有配额信息，返回null
      return null;
    }

    // 识别operation（如果未提供）
    let operationName = operation;
    if (!operationName) {
      operationName = operationIdentifier.identifyOperation(method, path);
    }

    // 解析rate limit（格式通常是 "requests/second"，例如 "2.0"）
    let rateLimit = null;
    try {
      rateLimit = parseFloat(rateLimitLimit);
      if (isNaN(rateLimit)) {
        logger.warn(
          `[spApiResponseAnalyzer] 无法解析rate limit: ${rateLimitLimit}`,
        );
        return null;
      }
    } catch (e) {
      logger.warn(`[spApiResponseAnalyzer] 解析rate limit失败:`, e.message);
      return null;
    }

    const quotaInfo = {
      operation: operationName,
      region: region,
      country: country,
      rateLimit: rateLimit,
      requestId: requestId,
      timestamp: Date.now(),
      method: method,
      path: path,
    };

    // 更新统计信息
    updateQuotaStats(region, operationName, rateLimit);

    // 自动更新限流器的rate配置（从响应头发现）
    try {
      rateLimiter.updateOperationRateLimit(region, operationName, rateLimit);
    } catch (updateError) {
      logger.warn(
        `[spApiResponseAnalyzer] 更新限流器配额失败:`,
        updateError.message,
      );
    }

    // 记录到日志
    logger.info(`[spApiResponseAnalyzer] 配额信息:`, quotaInfo);

    return quotaInfo;
  } catch (error) {
    logger.error(`[spApiResponseAnalyzer] 分析响应头失败:`, error.message);
    return null;
  }
}

/**
 * 更新配额统计信息
 * @param {string} region - 区域代码
 * @param {string} operation - Operation名称
 * @param {number} rateLimit - Rate limit值
 */
function updateQuotaStats(region, operation, rateLimit) {
  if (!quotaStats.stats[region]) {
    quotaStats.stats[region] = {};
  }

  if (!quotaStats.stats[region][operation]) {
    quotaStats.stats[region][operation] = {
      rateLimit: rateLimit,
      lastUpdated: Date.now(),
      count: 0,
      history: [], // 保留最近的历史记录
    };
  }

  const stat = quotaStats.stats[region][operation];

  // 如果rate limit发生变化，记录历史
  if (stat.rateLimit !== rateLimit) {
    stat.history.push({
      oldRateLimit: stat.rateLimit,
      newRateLimit: rateLimit,
      timestamp: Date.now(),
    });

    // 只保留最近50条历史记录
    if (stat.history.length > 50) {
      stat.history = stat.history.slice(-50);
    }

    logger.info(
      `[spApiResponseAnalyzer] ${region}/${operation} 配额变化: ${stat.rateLimit} -> ${rateLimit}`,
    );
  }

  stat.rateLimit = rateLimit;
  stat.lastUpdated = Date.now();
  stat.count++;
}

/**
 * 获取配额统计信息
 * @param {string} region - 区域代码（可选，如果不提供则返回所有区域）
 * @param {string} operation - Operation名称（可选，如果不提供则返回该区域的所有operation）
 * @returns {Object} 配额统计信息
 */
function getQuotaStats(region = null, operation = null) {
  if (!region) {
    return quotaStats.stats;
  }

  if (!quotaStats.stats[region]) {
    return null;
  }

  if (!operation) {
    return quotaStats.stats[region];
  }

  return quotaStats.stats[region][operation] || null;
}

/**
 * 获取指定operation的最新rate limit
 * @param {string} region - 区域代码
 * @param {string} operation - Operation名称
 * @returns {number|null} Rate limit值，如果未找到则返回null
 */
function getRateLimit(region, operation) {
  const stat = getQuotaStats(region, operation);
  return stat ? stat.rateLimit : null;
}

/**
 * 分析响应对象（从callSPAPI返回的响应）
 * @param {Object} response - API响应对象（可能包含_spApiHeaders字段）
 * @param {string} operation - Operation名称（可选）
 * @returns {Object|null} 解析后的配额信息
 */
function analyzeResponse(response, operation = null) {
  if (!response || !response._spApiHeaders) {
    return null;
  }

  const headers = response._spApiHeaders.allHeaders || {};
  const method = response._spApiHeaders.method;
  const path = response._spApiHeaders.path;
  const country = response._spApiHeaders.country;
  const region = response._spApiHeaders.region;

  return analyzeResponseHeaders(
    headers,
    method,
    path,
    country,
    region,
    operation,
  );
}

/**
 * 分析错误对象（从callSPAPI抛出的错误）
 * @param {Error} error - 错误对象（可能包含配额相关字段）
 * @param {string} operation - Operation名称（可选）
 * @returns {Object|null} 解析后的配额信息
 */
function analyzeError(error, operation = null) {
  if (!error || !error.headers) {
    return null;
  }

  return analyzeResponseHeaders(
    error.headers,
    error.method,
    error.path,
    error.country,
    error.region,
    operation,
  );
}

/**
 * 重置统计信息（用于测试或清理）
 */
function resetStats() {
  quotaStats.stats = {};
  logger.info('[spApiResponseAnalyzer] 统计信息已重置');
}

module.exports = {
  analyzeResponseHeaders,
  analyzeResponse,
  analyzeError,
  getQuotaStats,
  getRateLimit,
  resetStats,
};
