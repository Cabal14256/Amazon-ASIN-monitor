const express = require('express');
const multer = require('multer');
const router = express.Router();
const competitorAsinController = require('../controllers/competitorAsinController');

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

// 竞品变体组路由
router.get(
  '/competitor/variant-groups',
  competitorAsinController.getCompetitorVariantGroups,
);
router.get(
  '/competitor/variant-groups/:groupId',
  competitorAsinController.getCompetitorVariantGroupById,
);
router.post(
  '/competitor/variant-groups',
  competitorAsinController.createCompetitorVariantGroup,
);
router.put(
  '/competitor/variant-groups/:groupId',
  competitorAsinController.updateCompetitorVariantGroup,
);
router.delete(
  '/competitor/variant-groups/:groupId',
  competitorAsinController.deleteCompetitorVariantGroup,
);
router.put(
  '/competitor/variant-groups/:groupId/feishu-notify',
  competitorAsinController.updateCompetitorVariantGroupFeishuNotify,
);

// 竞品ASIN路由
router.post('/competitor/asins', competitorAsinController.createCompetitorASIN);
router.put(
  '/competitor/asins/:asinId',
  competitorAsinController.updateCompetitorASIN,
);
router.delete(
  '/competitor/asins/:asinId',
  competitorAsinController.deleteCompetitorASIN,
);
router.post(
  '/competitor/asins/:asinId/move',
  competitorAsinController.moveCompetitorASIN,
);
router.put(
  '/competitor/asins/:asinId/feishu-notify',
  competitorAsinController.updateCompetitorASINFeishuNotify,
);

// Excel导入路由
router.post(
  '/competitor/variant-groups/import-excel',
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
  competitorAsinController.importCompetitorFromExcel,
);

module.exports = router;
