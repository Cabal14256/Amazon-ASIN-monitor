-- 迁移版本: 022
-- 迁移名称: 为监控历史聚合表添加高峰期字段
-- 创建时间: 2026-01-26
-- 说明: 为聚合表补充 has_peak 字段，用于 period-summary 统计

USE `amazon_asin_monitor`;

ALTER TABLE `monitor_history_agg`
ADD COLUMN `has_peak` TINYINT(1) NOT NULL COMMENT '是否包含高峰期检查' AFTER `has_broken`;

SELECT '监控历史聚合表已添加 has_peak 字段' AS result;
