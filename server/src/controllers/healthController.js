/**
 * 健康检查控制器
 * 提供详细的系统健康状态信息
 */

const { testConnection, getPoolStatus } = require('../config/database');
const {
  testConnection: testCompetitorConnection,
  getPoolStatus: getCompetitorPoolStatus,
} = require('../config/competitor-database');
const { getRateLimitStats } = require('../middleware/rateLimit');
const cacheService = require('../services/cacheService');
const errorStatsService = require('../services/errorStatsService');
const riskControlService = require('../services/riskControlService');
const { getUTC8ISOString } = require('../utils/dateTime');
const v8 = require('v8');

function parseThreshold(rawValue, fallback) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return fallback;
  }
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (parsed > 0 && parsed < 1) {
    return parsed;
  }
  if (parsed >= 1 && parsed <= 100) {
    return parsed / 100;
  }
  return fallback;
}

function parsePositiveNumber(rawValue, fallback) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return fallback;
  }
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

const DB_POOL_DEGRADED_THRESHOLD = parseThreshold(
  process.env.HEALTH_DB_POOL_DEGRADED_THRESHOLD,
  0.9,
);
const MEMORY_HEAP_LIMIT_DEGRADED_THRESHOLD = parseThreshold(
  process.env.HEALTH_MEMORY_HEAP_LIMIT_DEGRADED_THRESHOLD,
  0.9,
);
const MEMORY_RSS_DEGRADED_MB = parsePositiveNumber(
  process.env.HEALTH_MEMORY_RSS_DEGRADED_MB,
  0,
);

/**
 * 获取系统健康状态
 */
exports.getHealth = async (req, res) => {
  try {
    const health = {
      status: 'ok',
      timestamp: getUTC8ISOString(),
      uptime: process.uptime(),
    };

    // 检查数据库连接
    try {
      const dbConnected = await testConnection();
      const poolStatus = getPoolStatus();
      const poolUsage =
        poolStatus.activeConnections / poolStatus.config.connectionLimit;
      const isPoolHealthy = poolUsage < 0.9; // 使用率超过90%认为不健康

      health.database = {
        status: dbConnected ? (isPoolHealthy ? 'ok' : 'degraded') : 'error',
        connected: dbConnected,
        pool: poolStatus,
        usagePercent: (poolUsage * 100).toFixed(2),
      };
    } catch (error) {
      health.database = {
        status: 'error',
        connected: false,
        error: error.message,
      };
    }

    // 检查竞品数据库连接
    try {
      const competitorDbConnected = await testCompetitorConnection();
      const competitorPoolStatus = getCompetitorPoolStatus();
      const competitorPoolUsage =
        competitorPoolStatus.activeConnections /
        competitorPoolStatus.config.connectionLimit;
      const isCompetitorPoolHealthy = competitorPoolUsage < 0.9;

      health.competitorDatabase = {
        status: competitorDbConnected
          ? isCompetitorPoolHealthy
            ? 'ok'
            : 'degraded'
          : 'error',
        connected: competitorDbConnected,
        pool: competitorPoolStatus,
        usagePercent: (competitorPoolUsage * 100).toFixed(2),
      };
    } catch (error) {
      health.competitorDatabase = {
        status: 'error',
        connected: false,
        error: error.message,
      };
    }

    // 检查内存使用情况
    const memoryUsage = process.memoryUsage();
    const heapStats = v8.getHeapStatistics();
    const heapLimitBytes = heapStats.heap_size_limit || 0;
    const heapUsedToTotalPercent =
      memoryUsage.heapTotal > 0
        ? (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100
        : 0;
    const heapUsedToLimitPercent =
      heapLimitBytes > 0 ? (memoryUsage.heapUsed / heapLimitBytes) * 100 : 0;

    health.memory = {
      heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024), // MB
      heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024), // MB
      heapLimit: Math.round(heapLimitBytes / 1024 / 1024), // MB
      external: Math.round(memoryUsage.external / 1024 / 1024), // MB
      rss: Math.round(memoryUsage.rss / 1024 / 1024), // MB
      usagePercent: heapUsedToTotalPercent.toFixed(2), // 保留旧字段，兼容现有调用
      heapLimitUsagePercent: heapUsedToLimitPercent.toFixed(2),
      thresholdPercent: (MEMORY_HEAP_LIMIT_DEGRADED_THRESHOLD * 100).toFixed(2),
    };

    // 检查限流器状态
    try {
      const rateLimitStats = getRateLimitStats();
      health.rateLimiter = {
        stats: rateLimitStats,
      };
    } catch (error) {
      health.rateLimiter = {
        status: 'error',
        error: error.message,
      };
    }

    // 检查缓存状态
    try {
      health.cache = cacheService.getMemoryStats();
    } catch (error) {
      health.cache = {
        status: 'error',
        error: error.message,
      };
    }

    // 检查错误统计
    try {
      const errorStats = errorStatsService.getErrorStats({ hours: 1 });
      health.errorStats = {
        recent: errorStats.recent,
        byType: Object.keys(errorStats.byType).reduce((acc, type) => {
          acc[type] = errorStats.byType[type].count;
          return acc;
        }, {}),
      };
    } catch (error) {
      health.errorStats = {
        status: 'error',
        error: error.message,
      };
    }

    // 检查风控指标
    try {
      const metrics = riskControlService.getMetrics();
      health.riskMetrics = {
        errorRate: metrics.errorRate,
        rateLimitCount: metrics.rateLimitCount,
        avgResponseTime: metrics.avgResponseTime,
        recentChecksCount: metrics.recentChecksCount,
      };
    } catch (error) {
      health.riskMetrics = {
        status: 'error',
        error: error.message,
      };
    }

    // 判断整体健康状态
    const databaseUsagePercent = parseFloat(health.database.usagePercent);
    const heapLimitUsagePercent = parseFloat(
      health.memory.heapLimitUsagePercent,
    );
    const rssMb = Number(health.memory.rss || 0);
    const memoryRssDegraded =
      MEMORY_RSS_DEGRADED_MB > 0 && rssMb > MEMORY_RSS_DEGRADED_MB;

    if (
      !health.database.connected ||
      (health.database.pool &&
        databaseUsagePercent > DB_POOL_DEGRADED_THRESHOLD * 100) ||
      heapLimitUsagePercent > MEMORY_HEAP_LIMIT_DEGRADED_THRESHOLD * 100 ||
      memoryRssDegraded
    ) {
      health.status = 'degraded';
    }

    const statusCode = health.status === 'ok' ? 200 : 503;
    res.status(statusCode).json(health);
  } catch (error) {
    res.status(500).json({
      status: 'error',
      timestamp: getUTC8ISOString(),
      error: error.message,
    });
  }
};
