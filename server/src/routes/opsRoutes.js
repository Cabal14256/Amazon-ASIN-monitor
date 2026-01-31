const express = require('express');
const router = express.Router();
const opsController = require('../controllers/opsController');
const { authenticateToken } = require('../middleware/auth');
const logger = require('../utils/logger');

router.use(authenticateToken);

router.get(
  '/ops/overview',
  (req, res, next) => {
    logger.debug('[Ops Route] 收到概览请求:', req.method, req.path);
    next();
  },
  opsController.getOpsOverview,
);

router.post(
  '/ops/analytics/refresh',
  (req, res, next) => {
    logger.info('[Ops Route] 手动触发聚合刷新');
    next();
  },
  opsController.refreshAnalyticsAgg,
);

module.exports = router;
