-- 在每个业务库创建独立的事务回执；幂等执行，保留已有回执。
USE `amazon_asin_monitor`;
CREATE TABLE IF NOT EXISTS `import_confirmation_receipts` (
  `preview_id` VARCHAR(100) PRIMARY KEY COMMENT '确认预览ID',
  `file_hash` CHAR(64) NOT NULL COMMENT '上传文件SHA-256',
  `digest` CHAR(64) NOT NULL COMMENT '预览差异SHA-256',
  `result_json` JSON NOT NULL COMMENT '已提交的导入结果',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='增量导入提交回执';

USE `amazon_competitor_monitor`;
CREATE TABLE IF NOT EXISTS `import_confirmation_receipts` (
  `preview_id` VARCHAR(100) PRIMARY KEY COMMENT '确认预览ID',
  `file_hash` CHAR(64) NOT NULL COMMENT '上传文件SHA-256',
  `digest` CHAR(64) NOT NULL COMMENT '预览差异SHA-256',
  `result_json` JSON NOT NULL COMMENT '已提交的导入结果',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='增量导入提交回执';
