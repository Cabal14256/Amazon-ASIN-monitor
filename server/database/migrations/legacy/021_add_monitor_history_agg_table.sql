-- 迁移版本: 021
-- 迁移名称: 添加监控历史聚合表
-- 创建时间: 2026-01-26
-- 说明: 为数据分析统计提供预聚合数据，加速汇总查询

USE `amazon_asin_monitor`;

CREATE TABLE IF NOT EXISTS `monitor_history_agg` (
  `granularity` ENUM('hour','day') NOT NULL COMMENT '时间粒度',
  `time_slot` DATETIME NOT NULL COMMENT '时间槽（按小时或按天对齐）',
  `country` VARCHAR(10) NOT NULL COMMENT '国家',
  `asin_key` VARCHAR(50) NOT NULL COMMENT 'ASIN主键（asin_id或asin_code）',
  `check_count` INT NOT NULL COMMENT '检查次数',
  `broken_count` INT NOT NULL COMMENT '异常次数',
  `has_broken` TINYINT(1) NOT NULL COMMENT '是否存在异常',
  `has_peak` TINYINT(1) NOT NULL COMMENT '是否包含高峰期检查',
  `first_check_time` DATETIME NOT NULL COMMENT '该时间槽内最早检查时间',
  `last_check_time` DATETIME NOT NULL COMMENT '该时间槽内最晚检查时间',
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`granularity`, `time_slot`, `country`, `asin_key`),
  INDEX `idx_time_slot` (`time_slot`),
  INDEX `idx_country_time_slot` (`country`, `time_slot`),
  INDEX `idx_granularity_time_slot` (`granularity`, `time_slot`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='监控历史聚合表（按时间槽/国家/ASIN）';

SELECT '监控历史聚合表已创建' AS result;
