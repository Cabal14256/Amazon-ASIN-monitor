/**
 * 风控指标收集和自动调整服务
 * 用于根据 SP-API 的错误率、限流情况等自动调整并发数
 */
const logger = require('../utils/logger');

// 指标收集窗口（最近 N 次检查）
const METRICS_WINDOW_SIZE = 100;

// 指标数据结构
const metrics = {
  // 最近 N 次检查的结果
  recentChecks: [],

  // 限流错误统计
  rateLimitErrors: {
    count: 0,
    lastOccurred: null,
    recentWindow: [], // 最近窗口内的限流次数
  },

  // SP-API 错误统计
  spApiErrors: {
    count: 0,
    recentWindow: [], // 最近窗口内的错误次数
  },

  // 响应时间统计
  responseTimes: [],

  // 成功检查统计
  successfulChecks: {
    count: 0,
    recentWindow: [],
  },
};

// 并发数调整配置
const ADJUSTMENT_CONFIG = {
  // 错误率阈值（超过此值降低并发）
  ERROR_RATE_THRESHOLD: 0.3, // 30%

  // 限流阈值（最近窗口内限流次数超过此值降低并发）
  RATE_LIMIT_THRESHOLD: 5,

  // 低错误率阈值（低于此值可以尝试提高并发）
  LOW_ERROR_RATE_THRESHOLD: 0.1, // 10%

  // 调整步长（每次调整的并发数变化量）
  ADJUSTMENT_STEP: 1,

  // 最小并发数
  MIN_CONCURRENCY: 1,

  // 最大并发数（由环境变量或配置决定）
  MAX_CONCURRENCY:
    Number(process.env.MAX_ALLOWED_CONCURRENT_GROUP_CHECKS) || 10,

  // 调整冷却时间（毫秒）- 避免频繁调整
  ADJUSTMENT_COOLDOWN: 5 * 60 * 1000, // 5分钟
};

let lastAdjustmentTime = 0;
let currentConcurrency = null; // 当前并发数（由外部设置）

/**
 * 记录一次检查结果
 * @param {Object} checkResult - 检查结果
 * @param {boolean} checkResult.success - 是否成功
 * @param {boolean} checkResult.isRateLimit - 是否遇到限流
 * @param {boolean} checkResult.isSpApiError - 是否是 SP-API 错误
 * @param {number} checkResult.responseTime - 响应时间（秒）
 */
function recordCheck(checkResult) {
  const {
    success = false,
    isRateLimit = false,
    isSpApiError = false,
    responseTime = 0,
  } = checkResult;

  const timestamp = Date.now();

  // 记录到最近检查窗口
  metrics.recentChecks.push({
    timestamp,
    success,
    isRateLimit,
    isSpApiError,
    responseTime,
  });

  // 保持窗口大小
  if (metrics.recentChecks.length > METRICS_WINDOW_SIZE) {
    metrics.recentChecks.shift();
  }

  // 记录限流错误
  if (isRateLimit) {
    metrics.rateLimitErrors.count++;
    metrics.rateLimitErrors.lastOccurred = timestamp;
    metrics.rateLimitErrors.recentWindow.push(timestamp);

    // 清理窗口外的数据（保留最近1小时的数据）
    const oneHourAgo = timestamp - 60 * 60 * 1000;
    metrics.rateLimitErrors.recentWindow =
      metrics.rateLimitErrors.recentWindow.filter((t) => t > oneHourAgo);
  }

  // 记录 SP-API 错误
  if (isSpApiError) {
    metrics.spApiErrors.count++;
    metrics.spApiErrors.recentWindow.push(timestamp);

    // 清理窗口外的数据
    const oneHourAgo = timestamp - 60 * 60 * 1000;
    metrics.spApiErrors.recentWindow = metrics.spApiErrors.recentWindow.filter(
      (t) => t > oneHourAgo,
    );
  }

  // 记录成功检查
  if (success && !isRateLimit && !isSpApiError) {
    metrics.successfulChecks.count++;
    metrics.successfulChecks.recentWindow.push(timestamp);

    // 清理窗口外的数据
    const oneHourAgo = timestamp - 60 * 60 * 1000;
    metrics.successfulChecks.recentWindow =
      metrics.successfulChecks.recentWindow.filter((t) => t > oneHourAgo);
  }

  // 记录响应时间
  if (responseTime > 0) {
    metrics.responseTimes.push({
      timestamp,
      responseTime,
    });

    // 保持最近1000个响应时间记录
    if (metrics.responseTimes.length > 1000) {
      metrics.responseTimes.shift();
    }
  }
}

/**
 * 获取最近的错误率
 * @param {number} windowSize - 窗口大小（检查次数）
 * @returns {number} 错误率（0-1）
 */
function getRecentErrorRate(windowSize = 50) {
  if (metrics.recentChecks.length === 0) {
    return 0;
  }

  const recent = metrics.recentChecks.slice(-windowSize);
  const errorCount = recent.filter(
    (check) => !check.success || check.isRateLimit || check.isSpApiError,
  ).length;

  return errorCount / recent.length;
}

/**
 * 获取最近的限流次数（最近1小时内）
 */
function getRecentRateLimitCount() {
  return metrics.rateLimitErrors.recentWindow.length;
}

/**
 * 获取平均响应时间（最近 N 次）
 */
function getAverageResponseTime(windowSize = 50) {
  if (metrics.responseTimes.length === 0) {
    return 0;
  }

  const recent = metrics.responseTimes.slice(-windowSize);
  const sum = recent.reduce((acc, item) => acc + item.responseTime, 0);
  return sum / recent.length;
}

/**
 * 计算应该调整到的并发数
 * @param {number} currentConcurrency - 当前并发数
 * @returns {number} 建议的并发数
 */
function calculateOptimalConcurrency(currentConcurrency) {
  const now = Date.now();

  // 检查冷却时间
  if (now - lastAdjustmentTime < ADJUSTMENT_CONFIG.ADJUSTMENT_COOLDOWN) {
    return currentConcurrency; // 在冷却期内，不调整
  }

  const errorRate = getRecentErrorRate(50);
  const rateLimitCount = getRecentRateLimitCount();
  const avgResponseTime = getAverageResponseTime(50);

  let newConcurrency = currentConcurrency;

  // 情况1: 错误率高或频繁限流 -> 降低并发
  if (
    errorRate > ADJUSTMENT_CONFIG.ERROR_RATE_THRESHOLD ||
    rateLimitCount > ADJUSTMENT_CONFIG.RATE_LIMIT_THRESHOLD
  ) {
    newConcurrency = Math.max(
      ADJUSTMENT_CONFIG.MIN_CONCURRENCY,
      currentConcurrency - ADJUSTMENT_CONFIG.ADJUSTMENT_STEP,
    );
    logger.info(
      `[风控调整] 检测到高错误率(${(errorRate * 100).toFixed(
        1,
      )}%)或频繁限流(${rateLimitCount}次)，降低并发数: ${currentConcurrency} -> ${newConcurrency}`,
    );
  }
  // 情况2: 错误率低且无限流 -> 可以尝试提高并发
  else if (
    errorRate < ADJUSTMENT_CONFIG.LOW_ERROR_RATE_THRESHOLD &&
    rateLimitCount === 0 &&
    avgResponseTime < 2.0 // 平均响应时间小于2秒
  ) {
    newConcurrency = Math.min(
      ADJUSTMENT_CONFIG.MAX_CONCURRENCY,
      currentConcurrency + ADJUSTMENT_CONFIG.ADJUSTMENT_STEP,
    );

    // 只有在并发数确实增加时才记录
    if (newConcurrency > currentConcurrency) {
      logger.info(
        `[风控调整] 错误率低(${(errorRate * 100).toFixed(
          1,
        )}%)且无限流，提高并发数: ${currentConcurrency} -> ${newConcurrency}`,
      );
    } else {
      newConcurrency = currentConcurrency; // 已达到最大值，不调整
    }
  }

  // 确保在合理范围内
  newConcurrency = Math.max(
    ADJUSTMENT_CONFIG.MIN_CONCURRENCY,
    Math.min(ADJUSTMENT_CONFIG.MAX_CONCURRENCY, newConcurrency),
  );

  // 如果并发数发生变化，更新最后调整时间
  if (newConcurrency !== currentConcurrency) {
    lastAdjustmentTime = now;
  }

  return newConcurrency;
}

/**
 * 获取当前指标统计
 */
function getMetrics() {
  const errorRate = getRecentErrorRate(50);
  const rateLimitCount = getRecentRateLimitCount();
  const avgResponseTime = getAverageResponseTime(50);
  const recentChecksCount = metrics.recentChecks.length;

  return {
    errorRate: errorRate.toFixed(3),
    rateLimitCount,
    avgResponseTime: avgResponseTime.toFixed(2),
    recentChecksCount,
    totalRateLimitErrors: metrics.rateLimitErrors.count,
    totalSpApiErrors: metrics.spApiErrors.count,
    totalSuccessfulChecks: metrics.successfulChecks.count,
    lastRateLimitAt: metrics.rateLimitErrors.lastOccurred,
  };
}

/**
 * 设置当前并发数（由外部调用）
 */
function setCurrentConcurrency(concurrency) {
  currentConcurrency = concurrency;
}

/**
 * 重置指标（用于测试或重置）
 */
function resetMetrics() {
  metrics.recentChecks = [];
  metrics.rateLimitErrors = {
    count: 0,
    lastOccurred: null,
    recentWindow: [],
  };
  metrics.spApiErrors = {
    count: 0,
    recentWindow: [],
  };
  metrics.responseTimes = [];
  metrics.successfulChecks = {
    count: 0,
    recentWindow: [],
  };
  lastAdjustmentTime = 0;
  logger.info('[风控服务] 指标已重置');
}

/**
 * 动态调整限流器参数（根据限流统计）
 * @param {string} region - 区域代码 ('US' 或 'EU')
 */
function adjustRateLimiter(region) {
  const rateLimiter = require('./rateLimiter');
  const errorRate = getRecentErrorRate(50);
  const rateLimitCount = getRecentRateLimitCount();

  // 调用限流器的动态调整函数
  const adjustment = rateLimiter.adjustRateLimit(
    region,
    rateLimitCount,
    errorRate,
  );

  if (adjustment.adjusted) {
    logger.info(
      `[风控服务] ${region}区域限流器已调整: ${adjustment.previousPerMinute}/分钟 -> ${adjustment.newPerMinute}/分钟`,
    );
  }

  return adjustment;
}

/**
 * 定期检查和调整限流器（每5分钟检查一次）
 */
let rateLimiterAdjustmentInterval = null;

function startRateLimiterAutoAdjustment() {
  // 如果已有定时器，先清除
  if (rateLimiterAdjustmentInterval) {
    clearInterval(rateLimiterAdjustmentInterval);
  }

  // 每5分钟检查一次
  rateLimiterAdjustmentInterval = setInterval(() => {
    try {
      adjustRateLimiter('US');
      adjustRateLimiter('EU');
    } catch (error) {
      logger.error('[风控服务] 自动调整限流器失败:', error.message);
    }
  }, 5 * 60 * 1000); // 5分钟

  logger.info('[风控服务] 限流器自动调整已启动（每5分钟检查一次）');
}

function stopRateLimiterAutoAdjustment() {
  if (rateLimiterAdjustmentInterval) {
    clearInterval(rateLimiterAdjustmentInterval);
    rateLimiterAdjustmentInterval = null;
    logger.info('[风控服务] 限流器自动调整已停止');
  }
}

// 启动自动调整
startRateLimiterAutoAdjustment();

module.exports = {
  recordCheck,
  calculateOptimalConcurrency,
  getMetrics,
  setCurrentConcurrency,
  resetMetrics,
  getRecentErrorRate,
  getRecentRateLimitCount,
  getAverageResponseTime,
  adjustRateLimiter,
  startRateLimiterAutoAdjustment,
  stopRateLimiterAutoAdjustment,
  ADJUSTMENT_CONFIG,
};
