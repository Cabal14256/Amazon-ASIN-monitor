-- 迁移版本: 031
-- 迁移名称: 优化 analytics/overview 接口性能
-- 创建时间: 2026-03-17
-- 说明:
-- 1) 添加缺失的复合索引优化时间范围查询
-- 2) 优化聚合表查询性能
-- 3) 添加覆盖索引减少回表

USE `amazon_asin_monitor`;

-- ============================================
-- 1. monitor_history 表索引优化
-- ============================================

-- 1.1 优化 ASIN 统计查询（用于 getASINStatisticsByCountry）
-- 该查询按 country, check_time 范围过滤，并按 asin 分组
ALTER TABLE `monitor_history`
ADD INDEX `idx_check_type_time_country_asin_broken` (`check_type`, `check_time`, `country`, `asin_id`, `asin_code`, `is_broken`);

-- 1.2 优化变体组 ASIN 统计查询（用于 getASINStatisticsByVariantGroup）
-- 该查询按 variant_group_id, check_time 范围过滤
ALTER TABLE `monitor_history`
ADD INDEX `idx_variant_group_time_asin_broken` (`variant_group_id`, `check_time`, `asin_id`, `asin_code`, `is_broken`);

-- 1.3 优化高峰期统计查询（用于 getPeakHoursStatistics）
-- 该查询需要快速过滤特定国家和时间范围
ALTER TABLE `monitor_history`
ADD INDEX `idx_country_check_time_type_asin` (`country`, `check_time`, `check_type`, `asin_id`, `asin_code`);

-- ============================================
-- 2. 聚合表索引优化
-- ============================================

-- 2.1 优化 monitor_history_agg 表查询
-- 添加覆盖索引减少回表操作
ALTER TABLE `monitor_history_agg`
ADD INDEX `idx_agg_covering_query` (`granularity`, `time_slot`, `country`, `asin_key`, `check_count`, `broken_count`, `has_peak`);

-- 2.2 优化 monitor_history_agg_dim 表查询
ALTER TABLE `monitor_history_agg_dim`
ADD INDEX `idx_agg_dim_covering_query` (`granularity`, `time_slot`, `country`, `site`, `brand`, `asin_key`, `check_count`, `broken_count`);

-- ============================================
-- 3. 查看索引创建结果
-- ============================================

SELECT 
  TABLE_NAME,
  INDEX_NAME,
  COLUMN_NAME,
  CARDINALITY
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = 'amazon_asin_monitor'
  AND TABLE_NAME IN ('monitor_history', 'monitor_history_agg', 'monitor_history_agg_dim')
ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX;

SELECT 'analytics 性能优化索引已创建' AS result;
