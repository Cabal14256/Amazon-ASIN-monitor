const multer = require('multer');
const path = require('path');
const logger = require('../utils/logger');

const ALLOWED_EXTENSIONS = ['.xlsx', '.csv'];
const ALLOWED_MIME_TYPES_BY_EXTENSION = {
  '.xlsx': [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
  '.csv': [
    'text/csv',
    'application/csv',
    'text/x-csv',
    'text/comma-separated-values',
    'application/vnd.ms-excel',
  ],
};

// 文件大小限制（10MB）
const MAX_FILE_SIZE = 10 * 1024 * 1024;

const storage = multer.memoryStorage();

function createUploadValidationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function normalizeMimeType(mimetype) {
  return String(mimetype || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
}

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const normalizedMimeType = normalizeMimeType(file.mimetype);

  // 验证扩展名
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    logger.warn('文件上传被拒绝: 不支持的扩展名', {
      filename: file.originalname,
      extension: ext,
    });
    return cb(
      createUploadValidationError(
        `不支持的文件类型。仅支持: ${ALLOWED_EXTENSIONS.join(', ')}`,
      ),
    );
  }

  const allowedMimeTypes = ALLOWED_MIME_TYPES_BY_EXTENSION[ext] || [];

  // 规范化 MIME；浏览器可能会为 CSV 追加 charset 参数，缺失 MIME 时由扩展名兜底。
  if (normalizedMimeType && !allowedMimeTypes.includes(normalizedMimeType)) {
    logger.warn('文件上传被拒绝: 不支持的MIME类型', {
      filename: file.originalname,
      mimetype: normalizedMimeType || file.mimetype,
      extension: ext,
    });
    return cb(
      createUploadValidationError(`不支持的文件 MIME 类型: ${file.mimetype}`),
    );
  }

  if (normalizedMimeType && normalizedMimeType !== file.mimetype) {
    logger.debug('文件上传MIME已标准化', {
      filename: file.originalname,
      mimetype: file.mimetype,
      normalizedMimeType,
    });
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
