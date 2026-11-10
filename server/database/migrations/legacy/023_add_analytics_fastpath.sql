-- 迁移版本: 023
-- 迁移名称: 数据分析快路径优化（快照维度、时间槽生成列、聚合维度表）
-- 创建时间: 2026-02-10
-- 说明:
-- 1) 为 monitor_history 增加 site/brand 快照字段，避免统计查询运行时 JOIN asins
-- 2) 增加 hour_ts/day_ts 生成列，减少 DATE_FORMAT 分组开销
-- 3) 增加分析查询复合索引
-- 4) 新增 monitor_history_agg_dim 聚合表，按 国家/站点/品牌/ASIN 预聚合

USE `amazon_asin_monitor`;

ALTER TABLE `monitor_history`
ADD COLUMN `site_snapshot` VARCHAR(100) NULL COMMENT '站点快照（记录时的站点）' AFTER `asin_name`,
ADD COLUMN `brand_snapshot` VARCHAR(255) NULL COMMENT '品牌快照（记录时的品牌）' AFTER `site_snapshot`,
ADD COLUMN `hour_ts` DATETIME GENERATED ALWAYS AS (TIMESTAMP(DATE_FORMAT(`check_time`, '%Y-%m-%d %H:00:00'))) STORED COMMENT '小时时间槽' AFTER `check_time`,
ADD COLUMN `day_ts` DATETIME GENERATED ALWAYS AS (TIMESTAMP(DATE(`check_time`))) STORED COMMENT '天时间槽' AFTER `hour_ts`;

-- 回填历史快照字段，避免旧数据查询走 JOIN
UPDATE `monitor_history` mh
LEFT JOIN `asins` a ON a.id = mh.asin_id
LEFT JOIN `variant_groups` vg ON vg.id = mh.variant_group_id
SET
  mh.site_snapshot = COALESCE(mh.site_snapshot, a.site, vg.site, ''),
  mh.brand_snapshot = COALESCE(mh.brand_snapshot, a.brand, vg.brand, '')
WHERE mh.site_snapshot IS NULL
   OR mh.brand_snapshot IS NULL;

ALTER TABLE `monitor_history`
ADD INDEX `idx_country_hour_site_brand` (`country`, `hour_ts`, `site_snapshot`, `brand_snapshot`),
ADD INDEX `idx_country_day_site_brand` (`country`, `day_ts`, `site_snapshot`, `brand_snapshot`),
ADD INDEX `idx_hour_country_asin` (`hour_ts`, `country`, `asin_id`, `asin_code`, `is_broken`),
ADD INDEX `idx_day_country_asin` (`day_ts`, `country`, `asin_id`, `asin_code`, `is_broken`);

CREATE TABLE IF NOT EXISTS `monitor_history_agg_dim` (
  `granularity` ENUM('hour','day') NOT NULL COMMENT '时间粒度',
  `time_slot` DATETIME NOT NULL COMMENT '时间槽（按小时或按天对齐）',
  `country` VARCHAR(10) NOT NULL COMMENT '国家',
  `site` VARCHAR(100) NOT NULL DEFAULT '' COMMENT '站点',
  `brand` VARCHAR(255) NOT NULL DEFAULT '' COMMENT '品牌',
  `asin_key` VARCHAR(50) NOT NULL COMMENT 'ASIN主键（asin_id或asin_code）',
  `check_count` INT NOT NULL COMMENT '检查次数',
  `broken_count` INT NOT NULL COMMENT '异常次数',
  `has_broken` TINYINT(1) NOT NULL COMMENT '是否存在异常',
  `has_peak` TINYINT(1) NOT NULL COMMENT '是否包含高峰期检查',
  `first_check_time` DATETIME NOT NULL COMMENT '该时间槽内最早检查时间',
  `last_check_time` DATETIME NOT NULL COMMENT '该时间槽内最晚检查时间',
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`granularity`, `time_slot`, `country`, `site`, `brand`, `asin_key`),
  INDEX `idx_agg_dim_time_slot` (`time_slot`),
  INDEX `idx_agg_dim_country_time_slot` (`country`, `time_slot`),
  INDEX `idx_agg_dim_granularity_time_slot` (`granularity`, `time_slot`),
  INDEX `idx_agg_dim_country_site_brand_slot` (`country`, `site`, `brand`, `time_slot`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='监控历史聚合表（按时间槽/国家/站点/品牌/ASIN）';

SELECT '数据分析快路径迁移完成' AS result;
