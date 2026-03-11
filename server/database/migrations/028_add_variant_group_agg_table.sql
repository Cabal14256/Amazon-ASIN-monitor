-- 迁移版本: 028
-- 迁移名称: 新增按变体组维度的监控历史聚合表
-- 创建时间: 2026-03-11
-- 说明:
-- 1) 新增 monitor_history_agg_variant_group
-- 2) 用于按变体组统计 ASIN 时长的预聚合加速
-- 3) 建表后建议执行 node server/scripts/rebuild-analytics-agg.js --yes

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
  INDEX `idx_agg_variant_group_time_slot` (`time_slot`),
  INDEX `idx_agg_variant_group_country_time_slot` (`country`, `time_slot`),
  INDEX `idx_agg_variant_group_group_slot` (`variant_group_id`, `time_slot`),
  INDEX `idx_agg_variant_group_granularity_time_slot` (`granularity`, `time_slot`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='监控历史聚合表（按时间槽/国家/变体组/ASIN）';

SELECT '新增变体组聚合表完成' AS result;
