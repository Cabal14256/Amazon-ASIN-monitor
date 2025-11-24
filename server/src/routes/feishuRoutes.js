const express = require('express');
const router = express.Router();
const feishuController = require('../controllers/feishuController');

// 飞书配置路由
router.get('/feishu-configs', feishuController.getFeishuConfigs);
router.get(
  '/feishu-configs/:country',
  feishuController.getFeishuConfigByCountry,
);
router.post('/feishu-configs', feishuController.upsertFeishuConfig);
router.put('/feishu-configs/:country', feishuController.upsertFeishuConfig);
router.delete('/feishu-configs/:country', feishuController.deleteFeishuConfig);
router.patch(
  '/feishu-configs/:country/toggle',
  feishuController.toggleFeishuConfig,
);

module.exports = router;
