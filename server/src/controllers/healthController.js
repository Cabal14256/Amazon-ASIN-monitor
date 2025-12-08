/**
 * 健康检查控制器
 * 提供详细的系统健康状态信息
 */

const { testConnection, getPoolStatus } = require('../config/database');
const rateLimiter = require('../services/rateLimiter');
const cacheService = require('../services/cacheService');
const errorStatsService = require('../services/errorStatsService');
const riskControlService = require('../services/riskControlService');
const { getUTC8ISOString } = require('../utils/dateTime');

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
      health.database = {
        status: dbConnected ? 'ok' : 'error',
        connected: dbConnected,
        pool: getPoolStatus(),
      };
    } catch (error) {
      health.database = {
        status: 'error',
        connected: false,
        error: error.message,
      };
    }

    // 检查内存使用情况
    const memoryUsage = process.memoryUsage();
    health.memory = {
      heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024), // MB
      heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024), // MB
      external: Math.round(memoryUsage.external / 1024 / 1024), // MB
      rss: Math.round(memoryUsage.rss / 1024 / 1024), // MB
      usagePercent: (
        (memoryUsage.heapUsed / memoryUsage.heapTotal) *
        100
      ).toFixed(2),
    };

    // 检查限流器状态
    try {
      health.rateLimiter = {
        US: rateLimiter.getStatus('US'),
        EU: rateLimiter.getStatus('EU'),
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
    if (
      !health.database.connected ||
      parseFloat(health.memory.usagePercent) > 90
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
