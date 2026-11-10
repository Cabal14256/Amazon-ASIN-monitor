-- 迁移版本: 027
-- 迁移名称: 统一竞品库状态字段与基础时间字段
-- 说明:
-- 1. 为旧版竞品表补齐 is_broken / variant_status / feishu_notify_enabled 等字段
-- 2. 为旧版竞品表补齐 create_time / update_time / last_check_time 等时间字段
-- 3. 仅补齐当前代码依赖的字段和非唯一索引，避免旧数据导致迁移失败

CREATE DATABASE IF NOT EXISTS `amazon_competitor_monitor`
DEFAULT CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;

USE `amazon_competitor_monitor`;

CREATE TABLE IF NOT EXISTS `competitor_variant_groups` (
  `id` VARCHAR(50) PRIMARY KEY COMMENT '变体组ID',
  `name` VARCHAR(255) NOT NULL COMMENT '变体组名称',
  `country` VARCHAR(10) NOT NULL COMMENT '所属国家(US/UK/DE等)',
  `brand` VARCHAR(100) NOT NULL COMMENT '品牌',
  `is_broken` TINYINT(1) DEFAULT 0 COMMENT '变体状态: 0-正常, 1-异常',
  `variant_status` VARCHAR(20) DEFAULT 'NORMAL' COMMENT '变体状态文本',
  `feishu_notify_enabled` TINYINT(1) DEFAULT 0 COMMENT '飞书通知开关: 0-关闭, 1-开启（默认关闭）',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `last_check_time` DATETIME DEFAULT NULL COMMENT '监控更新时间（上一次检查的时间）',
  INDEX `idx_country` (`country`),
  INDEX `idx_brand` (`brand`),
  INDEX `idx_is_broken` (`is_broken`),
  INDEX `idx_create_time` (`create_time`),
  INDEX `idx_last_check_time` (`last_check_time`),
  INDEX `idx_feishu_notify_enabled` (`feishu_notify_enabled`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='竞品变体组表';

CREATE TABLE IF NOT EXISTS `competitor_asins` (
  `id` VARCHAR(50) PRIMARY KEY COMMENT 'ASIN ID',
  `asin` VARCHAR(20) NOT NULL COMMENT 'ASIN编码',
  `name` VARCHAR(500) COMMENT 'ASIN名称',
  `asin_type` VARCHAR(20) DEFAULT NULL COMMENT 'ASIN类型: MAIN_LINK-主链, SUB_REVIEW-副评',
  `country` VARCHAR(10) NOT NULL COMMENT '所属国家',
  `brand` VARCHAR(100) NOT NULL COMMENT '品牌',
  `variant_group_id` VARCHAR(50) NOT NULL COMMENT '所属变体组ID',
  `is_broken` TINYINT(1) DEFAULT 0 COMMENT '变体状态: 0-正常, 1-异常',
  `variant_status` VARCHAR(20) DEFAULT 'NORMAL' COMMENT '变体状态文本',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `last_check_time` DATETIME DEFAULT NULL COMMENT '监控更新时间（上一次检查的时间）',
  `feishu_notify_enabled` TINYINT(1) DEFAULT 0 COMMENT '飞书通知开关: 0-关闭, 1-开启（默认关闭）',
  INDEX `idx_variant_group_id` (`variant_group_id`),
  INDEX `idx_country` (`country`),
  INDEX `idx_brand` (`brand`),
  INDEX `idx_asin` (`asin`),
  INDEX `idx_asin_type` (`asin_type`),
  INDEX `idx_is_broken` (`is_broken`),
  INDEX `idx_last_check_time` (`last_check_time`),
  INDEX `idx_feishu_notify_enabled` (`feishu_notify_enabled`),
  UNIQUE INDEX `uk_asin_country` (`asin`, `country`) COMMENT 'ASIN和国家复合唯一索引，允许同一ASIN在不同国家存在',
  FOREIGN KEY (`variant_group_id`) REFERENCES `competitor_variant_groups`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='竞品ASIN表';

CREATE TABLE IF NOT EXISTS `competitor_monitor_history` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '历史记录ID',
  `variant_group_id` VARCHAR(50) COMMENT '变体组ID',
  `asin_id` VARCHAR(50) COMMENT 'ASIN ID',
  `check_type` VARCHAR(20) DEFAULT 'GROUP' COMMENT '检查类型: GROUP-变体组, ASIN-单个ASIN',
  `country` VARCHAR(10) NOT NULL COMMENT '国家',
  `is_broken` TINYINT(1) DEFAULT 0 COMMENT '检查结果: 0-正常, 1-异常',
  `check_time` DATETIME NOT NULL COMMENT '检查时间',
  `check_result` TEXT COMMENT '检查结果详情(JSON格式)',
  `notification_sent` TINYINT(1) DEFAULT 0 COMMENT '是否已发送通知: 0-否, 1-是',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  INDEX `idx_variant_group_id` (`variant_group_id`),
  INDEX `idx_asin_id` (`asin_id`),
  INDEX `idx_check_time` (`check_time`),
  INDEX `idx_country` (`country`),
  FOREIGN KEY (`variant_group_id`) REFERENCES `competitor_variant_groups`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`asin_id`) REFERENCES `competitor_asins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='竞品监控历史表';

CREATE TABLE IF NOT EXISTS `competitor_feishu_config` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `country` VARCHAR(10) NOT NULL UNIQUE COMMENT '区域代码（US或EU）',
  `webhook_url` VARCHAR(500) NOT NULL COMMENT '飞书Webhook URL',
  `enabled` TINYINT(1) DEFAULT 1 COMMENT '是否启用: 0-否, 1-是',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='竞品飞书通知配置表';

SET @sql = IF(
  (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'competitor_variant_groups'
      AND COLUMN_NAME = 'is_broken'
  ) = 0,
  "ALTER TABLE `competitor_variant_groups` ADD COLUMN `is_broken` TINYINT(1) DEFAULT 0 COMMENT '变体状态: 0-正常, 1-异常' AFTER `brand`",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'competitor_variant_groups'
      AND COLUMN_NAME = 'variant_status'
  ) = 0,
  "ALTER TABLE `competitor_variant_groups` ADD COLUMN `variant_status` VARCHAR(20) DEFAULT 'NORMAL' COMMENT '变体状态文本' AFTER `is_broken`",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'competitor_variant_groups'
      AND COLUMN_NAME = 'feishu_notify_enabled'
  ) = 0,
  "ALTER TABLE `competitor_variant_groups` ADD COLUMN `feishu_notify_enabled` TINYINT(1) DEFAULT 0 COMMENT '飞书通知开关: 0-关闭, 1-开启（默认关闭）' AFTER `variant_status`",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'competitor_variant_groups'
      AND COLUMN_NAME = 'create_time'
  ) = 0,
  "ALTER TABLE `competitor_variant_groups` ADD COLUMN `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间' AFTER `feishu_notify_enabled`",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'competitor_variant_groups'
      AND COLUMN_NAME = 'update_time'
  ) = 0,
  "ALTER TABLE `competitor_variant_groups` ADD COLUMN `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间' AFTER `create_time`",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'competitor_variant_groups'
      AND COLUMN_NAME = 'last_check_time'
  ) = 0,
  "ALTER TABLE `competitor_variant_groups` ADD COLUMN `last_check_time` DATETIME DEFAULT NULL COMMENT '监控更新时间（上一次检查的时间）' AFTER `update_time`",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'competitor_variant_groups'
      AND INDEX_NAME = 'idx_is_broken'
  ) = 0,
  "ALTER TABLE `competitor_variant_groups` ADD INDEX `idx_is_broken` (`is_broken`)",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'competitor_variant_groups'
      AND INDEX_NAME = 'idx_create_time'
  ) = 0,
  "ALTER TABLE `competitor_variant_groups` ADD INDEX `idx_create_time` (`create_time`)",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'competitor_variant_groups'
      AND INDEX_NAME = 'idx_last_check_time'
  ) = 0,
  "ALTER TABLE `competitor_variant_groups` ADD INDEX `idx_last_check_time` (`last_check_time`)",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'competitor_variant_groups'
      AND INDEX_NAME = 'idx_feishu_notify_enabled'
  ) = 0,
  "ALTER TABLE `competitor_variant_groups` ADD INDEX `idx_feishu_notify_enabled` (`feishu_notify_enabled`)",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE `competitor_variant_groups`
SET `variant_status` = CASE
  WHEN COALESCE(`is_broken`, 0) = 1 THEN 'BROKEN'
  ELSE 'NORMAL'
END
WHERE `variant_status` IS NULL OR `variant_status` = '';

SET @sql = IF(
  (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'competitor_asins'
      AND COLUMN_NAME = 'is_broken'
  ) = 0,
  "ALTER TABLE `competitor_asins` ADD COLUMN `is_broken` TINYINT(1) DEFAULT 0 COMMENT '变体状态: 0-正常, 1-异常' AFTER `variant_group_id`",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'competitor_asins'
      AND COLUMN_NAME = 'variant_status'
  ) = 0,
  "ALTER TABLE `competitor_asins` ADD COLUMN `variant_status` VARCHAR(20) DEFAULT 'NORMAL' COMMENT '变体状态文本' AFTER `is_broken`",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'competitor_asins'
      AND COLUMN_NAME = 'create_time'
  ) = 0,
  "ALTER TABLE `competitor_asins` ADD COLUMN `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间' AFTER `variant_status`",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'competitor_asins'
      AND COLUMN_NAME = 'update_time'
  ) = 0,
  "ALTER TABLE `competitor_asins` ADD COLUMN `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间' AFTER `create_time`",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'competitor_asins'
      AND COLUMN_NAME = 'last_check_time'
  ) = 0,
  "ALTER TABLE `competitor_asins` ADD COLUMN `last_check_time` DATETIME DEFAULT NULL COMMENT '监控更新时间（上一次检查的时间）' AFTER `update_time`",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'competitor_asins'
      AND COLUMN_NAME = 'feishu_notify_enabled'
  ) = 0,
  "ALTER TABLE `competitor_asins` ADD COLUMN `feishu_notify_enabled` TINYINT(1) DEFAULT 0 COMMENT '飞书通知开关: 0-关闭, 1-开启（默认关闭）' AFTER `last_check_time`",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'competitor_asins'
      AND INDEX_NAME = 'idx_is_broken'
  ) = 0,
  "ALTER TABLE `competitor_asins` ADD INDEX `idx_is_broken` (`is_broken`)",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'competitor_asins'
      AND INDEX_NAME = 'idx_last_check_time'
  ) = 0,
  "ALTER TABLE `competitor_asins` ADD INDEX `idx_last_check_time` (`last_check_time`)",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'competitor_asins'
      AND INDEX_NAME = 'idx_feishu_notify_enabled'
  ) = 0,
  "ALTER TABLE `competitor_asins` ADD INDEX `idx_feishu_notify_enabled` (`feishu_notify_enabled`)",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE `competitor_asins`
SET `variant_status` = CASE
  WHEN COALESCE(`is_broken`, 0) = 1 THEN 'BROKEN'
  ELSE 'NORMAL'
END
WHERE `variant_status` IS NULL OR `variant_status` = '';

SET @sql = IF(
  (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'competitor_monitor_history'
      AND COLUMN_NAME = 'notification_sent'
  ) = 0,
  "ALTER TABLE `competitor_monitor_history` ADD COLUMN `notification_sent` TINYINT(1) DEFAULT 0 COMMENT '是否已发送通知: 0-否, 1-是' AFTER `check_result`",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'competitor_monitor_history'
      AND COLUMN_NAME = 'create_time'
  ) = 0,
  "ALTER TABLE `competitor_monitor_history` ADD COLUMN `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间' AFTER `notification_sent`",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'competitor_feishu_config'
      AND COLUMN_NAME = 'enabled'
  ) = 0,
  "ALTER TABLE `competitor_feishu_config` ADD COLUMN `enabled` TINYINT(1) DEFAULT 1 COMMENT '是否启用: 0-否, 1-是' AFTER `webhook_url`",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'competitor_feishu_config'
      AND COLUMN_NAME = 'create_time'
  ) = 0,
  "ALTER TABLE `competitor_feishu_config` ADD COLUMN `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP AFTER `enabled`",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'competitor_feishu_config'
      AND COLUMN_NAME = 'update_time'
  ) = 0,
  "ALTER TABLE `competitor_feishu_config` ADD COLUMN `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER `create_time`",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
