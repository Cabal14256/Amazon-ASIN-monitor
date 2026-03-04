const cacheService = require('../services/cacheService');
const riskControlService = require('../services/riskControlService');
const schedulerService = require('../services/schedulerService');
const monitorTaskQueue = require('../services/monitorTaskQueue');
const competitorMonitorTaskQueue = require('../services/competitorMonitorTaskQueue');
const analyticsAggService = require('../services/analyticsAggService');
const { getProcessRole, isApiRole } = require('../config/processRole');
const {
  getWorkerRegistrationStatus,
} = require('../services/workerProcessorRegistry');
const logger = require('../utils/logger');

async function getQueueStats(queue, limiterConfig) {
  const counts = await queue.getJobCounts();
  const isPaused = await queue.isPaused();
  return {
    counts,
    isPaused,
    limiter: limiterConfig,
  };
}

exports.getOpsOverview = async (req, res) => {
  try {
    const processRole = getProcessRole();
    const workerStatus = getWorkerRegistrationStatus();
    const schedulerEnabled =
      isApiRole(processRole) && schedulerService.isSchedulerEnabled();

    const [monitorQueueStats, competitorQueueStats] = await Promise.all([
      getQueueStats(monitorTaskQueue.queue, monitorTaskQueue.limiterConfig),
      getQueueStats(
        competitorMonitorTaskQueue.queue,
        competitorMonitorTaskQueue.limiterConfig,
      ),
    ]);

    res.json({
      success: true,
      data: {
        processRole,
        schedulerEnabled,
        workerRegisteredQueues: workerStatus.registeredQueues,
        workerProcessorDetails: workerStatus.details,
        cache: cacheService.getMemoryStats(),
        riskControl: riskControlService.getMetrics(),
        scheduler: schedulerService.getSchedulerStatus(),
        analyticsAgg: analyticsAggService.getAggStatus(),
        queues: {
          monitor: monitorQueueStats,
          competitor: competitorQueueStats,
        },
      },
      errorCode: 0,
    });
  } catch (error) {
    logger.error('[Ops] 获取运行概览失败:', error.message);
    res.status(500).json({
      success: false,
      errorMessage: '获取运行概览失败',
      errorCode: 500,
    });
  }
};

exports.refreshAnalyticsAgg = async (req, res) => {
  try {
    const { granularity, startTime, endTime } = req.body || {};
    const allowed = ['hour', 'day'];
    const aggStatus = analyticsAggService.getAggStatus();

    if (!aggStatus.enabled) {
      return res.status(400).json({
        success: false,
        errorMessage: '聚合刷新未启用（ANALYTICS_AGG_ENABLED=0）',
        errorCode: 400,
      });
    }

    if (granularity && !allowed.includes(granularity)) {
      return res.status(400).json({
        success: false,
        errorMessage: 'granularity 必须为 hour 或 day',
        errorCode: 400,
      });
    }

    const options = {};
    if (startTime) {
      options.startTime = startTime;
    }
    if (endTime) {
      options.endTime = endTime;
    }

    let result;
    if (granularity) {
      result = await analyticsAggService.refreshMonitorHistoryAgg(
        granularity,
        options,
      );
    } else if (startTime || endTime) {
      const hourResult = await analyticsAggService.refreshMonitorHistoryAgg(
        'hour',
        options,
      );
      const dayResult = await analyticsAggService.refreshMonitorHistoryAgg(
        'day',
        options,
      );
      result = { hourResult, dayResult };
    } else {
      result = await analyticsAggService.refreshRecentMonitorHistoryAgg();
    }

    res.json({
      success: true,
      data: result,
      errorCode: 0,
    });
  } catch (error) {
    logger.error('[Ops] 手动刷新聚合失败:', error.message);
    res.status(500).json({
      success: false,
      errorMessage: '手动刷新聚合失败',
      errorCode: 500,
    });
  }
};
