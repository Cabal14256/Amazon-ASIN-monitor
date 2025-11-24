const express = require('express');
const router = express.Router();
const variantCheckController = require('../controllers/variantCheckController');

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

module.exports = router;
