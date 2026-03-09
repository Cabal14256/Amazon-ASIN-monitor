const express = require('express');
const router = express.Router();
const asinController = require('../controllers/asinController');
const upload = require('../middleware/fileUpload');
const { authenticateToken, checkPermission } = require('../middleware/auth');

// 文件上传验证中间件（检查文件是否存在）
const validateFileUpload = (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      errorMessage: '请上传文件',
      errorCode: 400,
    });
  }
  next();
};

// 变体组路由
router.get('/variant-groups', asinController.getVariantGroups);
router.get('/variant-groups/:groupId', asinController.getVariantGroupById);
router.post('/variant-groups', asinController.createVariantGroup);
router.put('/variant-groups/:groupId', asinController.updateVariantGroup);
router.delete('/variant-groups/:groupId', asinController.deleteVariantGroup);
router.put(
  '/variant-groups/:groupId/feishu-notify',
  asinController.updateVariantGroupFeishuNotify,
);
router.put(
  '/variant-groups/:groupId/manual-broken',
  authenticateToken,
  checkPermission('asin:write'),
  asinController.updateVariantGroupManualBroken,
);

// ASIN路由
router.post('/asins', asinController.createASIN);
router.put('/asins/:asinId', asinController.updateASIN);
router.delete('/asins/:asinId', asinController.deleteASIN);
router.post('/asins/:asinId/move', asinController.moveASIN);
router.put(
  '/asins/:asinId/feishu-notify',
  asinController.updateASINFeishuNotify,
);
router.put(
  '/asins/:asinId/manual-broken',
  authenticateToken,
  checkPermission('asin:write'),
  asinController.updateASINManualBroken,
);

// Excel导入路由
router.post(
  '/variant-groups/import-excel',
  authenticateToken,
  checkPermission('asin:write'),
  upload.single('file'),
  validateFileUpload,
  asinController.importFromExcel,
);

module.exports = router;
