const express = require('express');
const router = express.Router();
const competitorVariantCheckController = require('../controllers/competitorVariantCheckController');
const { authenticateToken, checkPermission } = require('../middleware/auth');

// 竞品变体检查路由
router.post(
  '/competitor/variant-groups/:groupId/check',
  competitorVariantCheckController.checkCompetitorVariantGroup,
);
router.post(
  '/competitor/asins/:asinId/check',
  competitorVariantCheckController.checkCompetitorASIN,
);
router.post(
  '/competitor/variant-groups/batch-check',
  authenticateToken,
  checkPermission('asin:read'),
  competitorVariantCheckController.batchCheckCompetitorVariantGroups,
);

module.exports = router;
