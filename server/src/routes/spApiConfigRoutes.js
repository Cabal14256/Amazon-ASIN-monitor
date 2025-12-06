const express = require('express');
const router = express.Router();
const spApiConfigController = require('../controllers/spApiConfigController');

// SP-API配置路由
// 限流器状态监控API
router.get('/rate-limiter/status', spApiConfigController.getRateLimiterStatus);
router.get('/error-stats', spApiConfigController.getErrorStats);

// SP-API配置路由
router.get('/sp-api-configs', spApiConfigController.getSPAPIConfigForDisplay);
router.get(
  '/sp-api-configs/:configKey',
  spApiConfigController.getSPAPIConfigByKey,
);
router.put('/sp-api-configs', spApiConfigController.updateSPAPIConfig);

module.exports = router;
