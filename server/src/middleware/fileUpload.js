const multer = require('multer');
const path = require('path');
const logger = require('../utils/logger');

// 允许的文件类型
const ALLOWED_MIME_TYPES_BY_EXTENSION = {
  '.xlsx': [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
  '.csv': [
    'text/csv',
    'application/csv',
    'text/x-csv',
    'text/comma-separated-values',
    'text/plain',
    'application/vnd.ms-excel',
  ],
};

const ALLOWED_EXTENSIONS = Object.keys(ALLOWED_MIME_TYPES_BY_EXTENSION);

// 文件大小限制（10MB）
const MAX_FILE_SIZE = 10 * 1024 * 1024;

const storage = multer.memoryStorage();

const createUploadError = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();

  // 验证扩展名
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    logger.warn('文件上传被拒绝: 不支持的扩展名', {
      filename: file.originalname,
      extension: ext,
    });
    return cb(
      createUploadError(
        `不支持的文件类型。仅支持: ${ALLOWED_EXTENSIONS.join(', ')}`,
      ),
    );
  }

  // 验证 MIME 类型
  const allowedMimeTypes = ALLOWED_MIME_TYPES_BY_EXTENSION[ext];
  if (!allowedMimeTypes.includes(file.mimetype)) {
    logger.warn('文件上传被拒绝: 不支持的MIME类型', {
      filename: file.originalname,
      mimetype: file.mimetype,
      extension: ext,
    });
    return cb(createUploadError(`不支持的文件 MIME 类型: ${file.mimetype}`));
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
