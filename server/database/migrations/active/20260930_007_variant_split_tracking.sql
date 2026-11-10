-- 只从上线后的可信变体关系建立基准，不把旧异常历史回填为新增拆分。
-- 幂等建表；无外键，兼容已有生产库的 ID 字符集和排序规则。
USE `amazon_asin_monitor`;

CREATE TABLE IF NOT EXISTS `variant_group_split_state` (
  `group_id` VARCHAR(50) NOT NULL PRIMARY KEY COMMENT '变体组ID',
  `country` VARCHAR(10) NOT NULL COMMENT '所属国家',
  `members` JSON NOT NULL COMMENT '成员、原父体基准及最近可信关系观测',
  `status` VARCHAR(10) NOT NULL DEFAULT 'UNKNOWN' COMMENT 'UNKNOWN/NORMAL/BROKEN',
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='变体组拆分检测状态';

CREATE TABLE IF NOT EXISTS `variant_group_split_events` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `variant_group_id` VARCHAR(50) NOT NULL COMMENT '变体组ID',
  `country` VARCHAR(10) NOT NULL COMMENT '所属国家',
  `occurred_at` DATETIME(3) NOT NULL COMMENT '正常转拆分的观测时间（北京时间）',
  `reason` VARCHAR(32) NOT NULL COMMENT 'RELATIONSHIP_LOST/PARENT_CHANGED',
  `details` JSON NOT NULL COMMENT '触发成员及父体变化',
  `notify_enabled` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '事件发生时通知是否开启',
  `phone_attempted_at` DATETIME(3) DEFAULT NULL COMMENT '电话加急占用时间（UTC）',
  INDEX `idx_split_country_time` (`country`, `occurred_at`),
  INDEX `idx_split_group_time` (`variant_group_id`, `occurred_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='变体组新增拆分事件';
