const express = require('express');
const multer = require('multer');
const router = express.Router();
const asinController = require('../controllers/asinController');

// 配置multer（内存存储）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'text/csv', // .csv
      'application/csv', // .csv (某些浏览器)
      'text/x-csv', // .csv (某些浏览器)
      'text/comma-separated-values', // .csv (某些浏览器)
    ];
    const allowedExtensions = ['.xlsx', '.xls', '.csv'];
    const fileExtension = file.originalname
      .toLowerCase()
      .substring(file.originalname.lastIndexOf('.'));

    if (
      allowedTypes.includes(file.mimetype) ||
      allowedExtensions.includes(fileExtension)
    ) {
      cb(null, true);
    } else {
      cb(
        new Error(
          `不支持的文件类型: ${file.mimetype}，请上传 .xlsx, .xls 或 .csv 文件`,
        ),
      );
    }
  },
});

// 变体组路由
router.get('/variant-groups', asinController.getVariantGroups);
router.get('/variant-groups/:groupId', asinController.getVariantGroupById);
router.post('/variant-groups', asinController.createVariantGroup);
router.put('/variant-groups/:groupId', asinController.updateVariantGroup);
router.delete('/variant-groups/:groupId', asinController.deleteVariantGroup);

// ASIN路由
router.post('/asins', asinController.createASIN);
router.put('/asins/:asinId', asinController.updateASIN);
router.delete('/asins/:asinId', asinController.deleteASIN);
router.post('/asins/:asinId/move', asinController.moveASIN);
router.put(
  '/asins/:asinId/feishu-notify',
  asinController.updateASINFeishuNotify,
);

// Excel导入路由
router.post(
  '/variant-groups/import-excel',
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          errorMessage: err.message || '文件上传失败',
          errorCode: 400,
        });
      }
      next();
    });
  },
  asinController.importFromExcel,
);

module.exports = router;
