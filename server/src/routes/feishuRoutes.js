const express = require('express');
const router = express.Router();
const feishuController = require('../controllers/feishuController');
const { authenticateToken, checkPermission } = require('../middleware/auth');

// 飞书配置路由
router.get(
  '/feishu-configs',
  authenticateToken,
  checkPermission('settings:read'),
  feishuController.getFeishuConfigs,
);
router.get(
  '/feishu-configs/:country',
  authenticateToken,
  checkPermission('settings:read'),
  feishuController.getFeishuConfigByCountry,
);
router.post(
  '/feishu-configs',
  authenticateToken,
  checkPermission('settings:write'),
  feishuController.upsertFeishuConfig,
);
router.put(
  '/feishu-configs/:country',
  authenticateToken,
  checkPermission('settings:write'),
  feishuController.upsertFeishuConfig,
);
router.delete(
  '/feishu-configs/:country',
  authenticateToken,
  checkPermission('settings:write'),
  feishuController.deleteFeishuConfig,
);
router.patch(
  '/feishu-configs/:country/toggle',
  authenticateToken,
  checkPermission('settings:write'),
  feishuController.toggleFeishuConfig,
);

module.exports = router;
