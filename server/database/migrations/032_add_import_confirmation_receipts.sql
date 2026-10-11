-- Run against each configured database: the main ASIN database and the
-- competitor ASIN database. The table name is intentionally the same because
-- each import transaction must commit its receipt in its own database.
CREATE TABLE IF NOT EXISTS `import_confirmation_receipts` (
  `preview_id` VARCHAR(100) PRIMARY KEY COMMENT '确认预览ID',
  `file_hash` CHAR(64) NOT NULL COMMENT '上传文件SHA-256',
  `digest` CHAR(64) NOT NULL COMMENT '预览差异SHA-256',
  `result_json` JSON NOT NULL COMMENT '已提交的导入结果',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='增量导入提交回执';
