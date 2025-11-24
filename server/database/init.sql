-- 创建数据库
CREATE DATABASE IF NOT EXISTS `amazon_asin_monitor` 
DEFAULT CHARACTER SET utf8mb4 
COLLATE utf8mb4_unicode_ci;

USE `amazon_asin_monitor`;

-- 变体组表
CREATE TABLE IF NOT EXISTS `variant_groups` (
  `id` VARCHAR(50) PRIMARY KEY COMMENT '变体组ID',
  `name` VARCHAR(255) NOT NULL COMMENT '变体组名称',
  `country` VARCHAR(10) NOT NULL COMMENT '所属国家(US/UK/DE等)',
  `site` VARCHAR(100) NOT NULL COMMENT '站点（内部店铺代号，如"12"）',
  `brand` VARCHAR(100) NOT NULL COMMENT '品牌',
  `is_broken` TINYINT(1) DEFAULT 0 COMMENT '变体状态: 0-正常, 1-异常',
  `variant_status` VARCHAR(20) DEFAULT 'NORMAL' COMMENT '变体状态文本',
  `is_competitor` TINYINT(1) DEFAULT 0 COMMENT '是否竞品: 0-否, 1-是',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  INDEX `idx_country` (`country`),
  INDEX `idx_site` (`site`),
  INDEX `idx_brand` (`brand`),
  INDEX `idx_is_broken` (`is_broken`),
  INDEX `idx_create_time` (`create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='变体组表';

-- ASIN表
CREATE TABLE IF NOT EXISTS `asins` (
  `id` VARCHAR(50) PRIMARY KEY COMMENT 'ASIN ID',
  `asin` VARCHAR(20) NOT NULL UNIQUE COMMENT 'ASIN编码',
  `name` VARCHAR(500) COMMENT 'ASIN名称',
  `asin_type` VARCHAR(20) DEFAULT NULL COMMENT 'ASIN类型: MAIN_LINK-主链, SUB_REVIEW-副评',
  `country` VARCHAR(10) NOT NULL COMMENT '所属国家',
  `site` VARCHAR(100) NOT NULL COMMENT '站点（内部店铺代号，如"12"）',
  `brand` VARCHAR(100) NOT NULL COMMENT '品牌',
  `variant_group_id` VARCHAR(50) NOT NULL COMMENT '所属变体组ID',
  `is_broken` TINYINT(1) DEFAULT 0 COMMENT '变体状态: 0-正常, 1-异常',
  `variant_status` VARCHAR(20) DEFAULT 'NORMAL' COMMENT '变体状态文本',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `last_check_time` DATETIME DEFAULT NULL COMMENT '监控更新时间（上一次检查的时间）',
  `feishu_notify_enabled` TINYINT(1) DEFAULT 1 COMMENT '飞书通知开关: 0-关闭, 1-开启',
  INDEX `idx_variant_group_id` (`variant_group_id`),
  INDEX `idx_country` (`country`),
  INDEX `idx_site` (`site`),
  INDEX `idx_brand` (`brand`),
  INDEX `idx_asin` (`asin`),
  INDEX `idx_asin_type` (`asin_type`),
  INDEX `idx_is_broken` (`is_broken`),
  INDEX `idx_last_check_time` (`last_check_time`),
  INDEX `idx_feishu_notify_enabled` (`feishu_notify_enabled`),
  FOREIGN KEY (`variant_group_id`) REFERENCES `variant_groups`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='ASIN表';

-- 监控历史表
CREATE TABLE IF NOT EXISTS `monitor_history` (
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
  FOREIGN KEY (`variant_group_id`) REFERENCES `variant_groups`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`asin_id`) REFERENCES `asins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='监控历史表';

-- 批次表
CREATE TABLE IF NOT EXISTS `batches` (
  `id` VARCHAR(50) PRIMARY KEY COMMENT '批次ID',
  `name` VARCHAR(255) NOT NULL COMMENT '批次名称',
  `description` TEXT COMMENT '批次描述',
  `country` VARCHAR(10) COMMENT '国家(可选)',
  `status` VARCHAR(20) DEFAULT 'ACTIVE' COMMENT '批次状态: ACTIVE-活跃, ARCHIVED-已归档',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  INDEX `idx_status` (`status`),
  INDEX `idx_create_time` (`create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='批次表';

-- 批次关联表
CREATE TABLE IF NOT EXISTS `batch_variant_groups` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `batch_id` VARCHAR(50) NOT NULL COMMENT '批次ID',
  `variant_group_id` VARCHAR(50) NOT NULL COMMENT '变体组ID',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_batch_group` (`batch_id`, `variant_group_id`),
  INDEX `idx_batch_id` (`batch_id`),
  INDEX `idx_variant_group_id` (`variant_group_id`),
  FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`variant_group_id`) REFERENCES `variant_groups`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='批次变体组关联表';

-- 飞书通知配置表（按区域配置：US和EU）
CREATE TABLE IF NOT EXISTS `feishu_config` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `country` VARCHAR(10) NOT NULL UNIQUE COMMENT '区域代码（US或EU）',
  `webhook_url` VARCHAR(500) NOT NULL COMMENT '飞书Webhook URL',
  `enabled` TINYINT(1) DEFAULT 1 COMMENT '是否启用: 0-否, 1-是',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='飞书通知配置表';

-- SP-API配置表
CREATE TABLE IF NOT EXISTS `sp_api_config` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `config_key` VARCHAR(50) NOT NULL UNIQUE COMMENT '配置键',
  `config_value` TEXT COMMENT '配置值（加密存储）',
  `description` VARCHAR(255) COMMENT '配置说明',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_config_key` (`config_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='SP-API配置表';

