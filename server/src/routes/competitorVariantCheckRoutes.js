const express = require('express');
const router = express.Router();
const competitorVariantCheckController = require('../controllers/competitorVariantCheckController');
const { authenticateToken, checkPermission } = require('../middleware/auth');

router.use(authenticateToken);

// 竞品变体检查路由
router.post(
  '/competitor/variant-groups/:groupId/check',
  checkPermission('asin:read'),
  competitorVariantCheckController.checkCompetitorVariantGroup,
);
router.post(
  '/competitor/asins/:asinId/check',
  checkPermission('asin:read'),
  competitorVariantCheckController.checkCompetitorASIN,
);
router.post(
  '/competitor/variant-groups/batch-check',
  checkPermission('asin:read'),
  competitorVariantCheckController.batchCheckCompetitorVariantGroups,
);

module.exports = router;
