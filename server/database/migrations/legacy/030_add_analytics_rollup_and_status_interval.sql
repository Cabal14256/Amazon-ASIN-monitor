-- 迁移版本: 030
-- 迁移名称: 扩展分析聚合层并新增状态区间表
-- 创建时间: 2026-03-12
-- 说明:
-- 1) 为 monitor_history 增加月时间槽与相关索引
-- 2) 扩展分析聚合表支持 month 粒度
-- 3) 新增 analytics_refresh_watermark 用于增量刷新
-- 4) 新增 monitor_history_status_interval 用于精确异常时长计算

USE `amazon_asin_monitor`;

ALTER TABLE `monitor_history`
  ADD COLUMN `month_ts` DATETIME GENERATED ALWAYS AS (TIMESTAMP(DATE_FORMAT(`check_time`, '%Y-%m-01 00:00:00'))) STORED COMMENT '月时间槽',
  ADD INDEX `idx_country_month_site_brand` (`country`, `month_ts`, `site_snapshot`, `brand_snapshot`),
  ADD INDEX `idx_month_country_asin` (`month_ts`, `country`, `asin_id`, `asin_code`, `is_broken`);

ALTER TABLE `monitor_history_agg`
  MODIFY COLUMN `granularity` ENUM('hour','day','month') NOT NULL COMMENT '时间粒度';

ALTER TABLE `monitor_history_agg_dim`
  MODIFY COLUMN `granularity` ENUM('hour','day','month') NOT NULL COMMENT '时间粒度';

ALTER TABLE `monitor_history_agg_variant_group`
  MODIFY COLUMN `granularity` ENUM('hour','day','month') NOT NULL COMMENT '时间粒度';

CREATE TABLE IF NOT EXISTS `analytics_refresh_watermark` (
  `processor_name` VARCHAR(100) NOT NULL COMMENT '刷新处理器名称',
  `last_history_id` BIGINT NOT NULL DEFAULT 0 COMMENT '最后处理的 monitor_history.id',
  `last_check_time` DATETIME DEFAULT NULL COMMENT '最后处理的检查时间',
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`processor_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='分析刷新水位表';

CREATE TABLE IF NOT EXISTS `monitor_history_status_interval` (
  `asin_key` VARCHAR(50) NOT NULL COMMENT 'ASIN主键（asin_id或asin_code）',
  `asin_id` VARCHAR(50) DEFAULT NULL COMMENT 'ASIN ID',
  `asin_code` VARCHAR(20) DEFAULT NULL COMMENT 'ASIN编码快照',
  `asin_name` VARCHAR(500) DEFAULT NULL COMMENT 'ASIN名称快照',
  `country` VARCHAR(10) NOT NULL COMMENT '国家',
  `variant_group_id` VARCHAR(50) DEFAULT NULL COMMENT '变体组ID',
  `variant_group_name` VARCHAR(255) DEFAULT NULL COMMENT '变体组名称快照',
  `interval_start` DATETIME NOT NULL COMMENT '状态区间开始时间',
  `interval_end` DATETIME DEFAULT NULL COMMENT '状态区间结束时间，NULL 表示当前仍开放',
  `is_broken` TINYINT(1) NOT NULL COMMENT '区间状态: 0-正常, 1-异常',
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`asin_key`, `country`, `interval_start`),
  INDEX `idx_interval_country_start` (`country`, `interval_start`),
  INDEX `idx_interval_variant_group_start` (`variant_group_id`, `country`, `interval_start`),
  INDEX `idx_interval_range` (`interval_start`, `interval_end`),
  INDEX `idx_interval_broken_range` (`is_broken`, `interval_start`, `interval_end`),
  INDEX `idx_interval_open_lookup` (`asin_key`, `country`, `interval_end`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='监控历史状态区间表（用于精确异常时长计算）';

SELECT '扩展分析聚合层并新增状态区间表完成' AS result;
