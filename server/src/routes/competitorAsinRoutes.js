const express = require('express');
const multer = require('multer');
const router = express.Router();
const competitorAsinController = require('../controllers/competitorAsinController');
const { authenticateToken, checkPermission } = require('../middleware/auth');

router.use(authenticateToken);

// 配置multer（内存存储）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'text/csv', // .csv
      'application/csv', // .csv (某些浏览器)
      'text/x-csv', // .csv (某些浏览器)
      'text/comma-separated-values', // .csv (某些浏览器)
    ];
    const allowedExtensions = ['.xlsx', '.csv'];
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
          `不支持的文件类型: ${file.mimetype}，请上传 .xlsx 或 .csv 文件`,
        ),
      );
    }
  },
});

// 竞品变体组路由
router.get(
  '/competitor/variant-groups',
  checkPermission('asin:read'),
  competitorAsinController.getCompetitorVariantGroups,
);
router.get(
  '/competitor/variant-groups/:groupId',
  checkPermission('asin:read'),
  competitorAsinController.getCompetitorVariantGroupById,
);
router.post(
  '/competitor/variant-groups',
  checkPermission('asin:write'),
  competitorAsinController.createCompetitorVariantGroup,
);
router.put(
  '/competitor/variant-groups/:groupId',
  checkPermission('asin:write'),
  competitorAsinController.updateCompetitorVariantGroup,
);
router.delete(
  '/competitor/variant-groups/:groupId',
  checkPermission('asin:write'),
  competitorAsinController.deleteCompetitorVariantGroup,
);
router.put(
  '/competitor/variant-groups/:groupId/feishu-notify',
  checkPermission('asin:write'),
  competitorAsinController.updateCompetitorVariantGroupFeishuNotify,
);

// 竞品ASIN路由
router.post(
  '/competitor/asins',
  checkPermission('asin:write'),
  competitorAsinController.createCompetitorASIN,
);
router.put(
  '/competitor/asins/:asinId',
  checkPermission('asin:write'),
  competitorAsinController.updateCompetitorASIN,
);
router.delete(
  '/competitor/asins/:asinId',
  checkPermission('asin:write'),
  competitorAsinController.deleteCompetitorASIN,
);
router.post(
  '/competitor/asins/:asinId/move',
  checkPermission('asin:write'),
  competitorAsinController.moveCompetitorASIN,
);
router.put(
  '/competitor/asins/:asinId/feishu-notify',
  checkPermission('asin:write'),
  competitorAsinController.updateCompetitorASINFeishuNotify,
);

// Excel导入路由
router.post(
  '/competitor/variant-groups/import-excel',
  checkPermission('asin:write'),
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
