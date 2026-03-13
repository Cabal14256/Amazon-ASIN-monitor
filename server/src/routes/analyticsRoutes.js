const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');
const { authenticateToken, checkPermission } = require('../middleware/auth');

router.use(authenticateToken);
router.get(
  '/analytics/monitor-history/summary',
  checkPermission('monitor:read'),
  analyticsController.getMonitorHistorySummary,
);
router.get(
  '/analytics/monitor-history/peak-hours',
  checkPermission('monitor:read'),
  analyticsController.getMonitorHistoryPeakHours,
);
router.use(checkPermission('analytics:read'));

router.get('/analytics/overview', analyticsController.getOverview);
router.get('/analytics/period-summary', analyticsController.getPeriodSummary);
router.get(
  '/analytics/period-summary/details',
  analyticsController.getPeriodSummaryTimeSlotDetails,
);
router.get(
  '/analytics/monthly-breakdown',
  analyticsController.getMonthlyBreakdown,
);

module.exports = router;
