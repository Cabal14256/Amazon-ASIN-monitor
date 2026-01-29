const multer = require('multer');
const path = require('path');
const logger = require('../utils/logger');

// 允许的文件类型
const ALLOWED_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'application/csv',
  'text/x-csv',
  'text/comma-separated-values',
];

const ALLOWED_EXTENSIONS = ['.xlsx', '.csv'];

// 文件大小限制（10MB）
const MAX_FILE_SIZE = 10 * 1024 * 1024;

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();

  // 验证扩展名
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    logger.warn('文件上传被拒绝: 不支持的扩展名', {
      filename: file.originalname,
      extension: ext,
    });
    return cb(
      new Error(`不支持的文件类型。仅支持: ${ALLOWED_EXTENSIONS.join(', ')}`),
    );
  }

  // 验证 MIME 类型
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    logger.warn('文件上传被拒绝: 不支持的MIME类型', {
      filename: file.originalname,
      mimetype: file.mimetype,
    });
    return cb(new Error(`不支持的文件 MIME 类型: ${file.mimetype}`));
  }

  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
  },
});

module.exports = upload;
