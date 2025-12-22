const express = require('express');
const router = express.Router();
const variantCheckController = require('../controllers/variantCheckController');
const { authenticateToken, checkPermission } = require('../middleware/auth');

// 变体检查路由
router.post(
  '/variant-groups/:groupId/check',
  variantCheckController.checkVariantGroup,
);
router.post('/asins/:asinId/check', variantCheckController.checkASIN);
router.post(
  '/variant-groups/batch-check',
  variantCheckController.batchCheckVariantGroups,
);

// 批量查询ASIN的父变体（需要认证和ASIN查看权限）
router.post(
  '/variant-check/batch-query-parent-asin',
  authenticateToken,
  checkPermission('asin:read'),
  variantCheckController.batchQueryParentAsin,
);

module.exports = router;
