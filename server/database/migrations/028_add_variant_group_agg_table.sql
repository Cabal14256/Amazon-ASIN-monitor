USE `amazon_asin_monitor`;

CREATE TABLE IF NOT EXISTS `monitor_history_agg_variant_group` (
  `granularity` ENUM('hour','day') NOT NULL COMMENT '时间粒度',
  `time_slot` DATETIME NOT NULL COMMENT '时间槽（按小时或按天对齐）',
  `country` VARCHAR(10) NOT NULL COMMENT '国家',
  `variant_group_id` VARCHAR(50) NOT NULL COMMENT '变体组ID',
  `variant_group_name` VARCHAR(255) NOT NULL DEFAULT '' COMMENT '变体组名称快照',
  `asin_key` VARCHAR(50) NOT NULL COMMENT 'ASIN主键（asin_id或asin_code）',
  `check_count` INT NOT NULL COMMENT '检查次数',
  `broken_count` INT NOT NULL COMMENT '异常次数',
  `has_broken` TINYINT(1) NOT NULL COMMENT '是否存在异常',
  `has_peak` TINYINT(1) NOT NULL COMMENT '是否包含高峰期检查',
  `first_check_time` DATETIME NOT NULL COMMENT '该时间槽内最早检查时间',
  `last_check_time` DATETIME NOT NULL COMMENT '该时间槽内最晚检查时间',
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`granularity`, `time_slot`, `country`, `variant_group_id`, `asin_key`),
  INDEX `idx_agg_variant_group_slot` (`time_slot`),
  INDEX `idx_agg_variant_group_country_slot` (`country`, `time_slot`),
  INDEX `idx_agg_variant_group_lookup` (`granularity`, `country`, `variant_group_id`, `time_slot`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='监控历史聚合表（按时间槽/国家/变体组/ASIN）';
