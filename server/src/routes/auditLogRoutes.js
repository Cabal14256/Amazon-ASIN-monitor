const express = require('express');
const router = express.Router();
const auditLogController = require('../controllers/auditLogController');
const { authenticateToken, checkPermission } = require('../middleware/auth');

router.use(authenticateToken);

// 需要审计查看权限
router.get(
  '/audit-logs',
  checkPermission('audit:read'),
  auditLogController.getAuditLogList,
);
router.get(
  '/audit-logs/:id',
  checkPermission('audit:read'),
  auditLogController.getAuditLogDetail,
);
router.get(
  '/audit-logs/statistics/actions',
  checkPermission('audit:read'),
  auditLogController.getActionStatistics,
);
router.get(
  '/audit-logs/statistics/resources',
  checkPermission('audit:read'),
  auditLogController.getResourceStatistics,
);

module.exports = router;
