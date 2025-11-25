const express = require('express');
const router = express.Router();
const exportController = require('../controllers/exportController');
const { authenticateToken, checkPermission } = require('../middleware/auth');

router.use(authenticateToken);

// 导出ASIN数据（需要ASIN查看权限）
router.get(
  '/export/asin',
  checkPermission('asin:read'),
  exportController.exportASINData,
);

// 导出监控历史（需要监控查看权限）
router.get(
  '/export/monitor-history',
  checkPermission('monitor:read'),
  exportController.exportMonitorHistory,
);

module.exports = router;
