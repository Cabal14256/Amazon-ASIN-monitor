const express = require('express');
const router = express.Router();
const monitorController = require('../controllers/monitorController');

// 监控历史路由
// 注意：具体路径必须在参数路径之前，否则会被参数路径匹配
router.get(
  '/monitor-history/statistics/by-time',
  monitorController.getStatisticsByTime,
);
router.get(
  '/monitor-history/statistics/by-country',
  monitorController.getStatisticsByCountry,
);
router.get(
  '/monitor-history/statistics/by-variant-group',
  monitorController.getStatisticsByVariantGroup,
);
router.get(
  '/monitor-history/statistics/peak-hours',
  monitorController.getPeakHoursStatistics,
);
router.get('/monitor-history/statistics', monitorController.getStatistics);
router.get('/monitor-history/:id', monitorController.getMonitorHistoryById);
router.get('/monitor-history', monitorController.getMonitorHistory);

// 手动触发监控检查
router.post('/monitor/trigger', monitorController.triggerManualCheck);

module.exports = router;
