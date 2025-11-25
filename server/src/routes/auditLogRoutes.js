const express = require('express');
const router = express.Router();
const auditLogController = require('../controllers/auditLogController');
const { authenticateToken, checkPermission } = require('../middleware/auth');

router.use(authenticateToken);

// 只有管理员可以查看审计日志
router.get(
  '/audit-logs',
  checkPermission('user:read'),
  auditLogController.getAuditLogList,
);
router.get(
  '/audit-logs/:id',
  checkPermission('user:read'),
  auditLogController.getAuditLogDetail,
);
router.get(
  '/audit-logs/statistics/actions',
  checkPermission('user:read'),
  auditLogController.getActionStatistics,
);
router.get(
  '/audit-logs/statistics/resources',
  checkPermission('user:read'),
  auditLogController.getResourceStatistics,
);

module.exports = router;
