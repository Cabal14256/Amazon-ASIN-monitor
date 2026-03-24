-- ============================================
-- Analytics 性能诊断脚本
-- 执行: mysql -h <host> -u <user> -p < diagnose_analytics.sql
-- ============================================

USE `amazon_asin_monitor`;

-- 1. 查看 monitor_history 表基本信息
SELECT 
  'monitor_history 基本信息' AS section,
  COUNT(*) AS total_rows,
  MIN(check_time) AS earliest_check,
  MAX(check_time) AS latest_check,
  COUNT(DISTINCT country) AS country_count,
  COUNT(DISTINCT variant_group_id) AS variant_group_count,
  COUNT(DISTINCT asin_id) AS asin_count
FROM monitor_history;

-- 2. 查看聚合表数据覆盖情况
SELECT 
  '聚合表数据覆盖' AS section,
  'monitor_history_agg' AS table_name,
  COUNT(*) AS total_rows,
  COUNT(DISTINCT granularity) AS granularity_types,
  MIN(time_slot) AS earliest_slot,
  MAX(time_slot) AS latest_slot,
  COUNT(DISTINCT country) AS country_count
FROM monitor_history_agg
UNION ALL
SELECT 
  '聚合表数据覆盖' AS section,
  'monitor_history_agg_dim' AS table_name,
  COUNT(*) AS total_rows,
  COUNT(DISTINCT granularity) AS granularity_types,
  MIN(time_slot) AS earliest_slot,
  MAX(time_slot) AS latest_slot,
  COUNT(DISTINCT country) AS country_count
FROM monitor_history_agg_dim
UNION ALL
SELECT 
  '聚合表数据覆盖' AS section,
  'monitor_history_agg_variant_group' AS table_name,
  COUNT(*) AS total_rows,
  COUNT(DISTINCT granularity) AS granularity_types,
  MIN(time_slot) AS earliest_slot,
  MAX(time_slot) AS latest_slot,
  COUNT(DISTINCT country) AS country_count
FROM monitor_history_agg_variant_group;

-- 3. 查看 monitor_history 表索引信息
SELECT 
  INDEX_NAME,
  COLUMN_NAME,
  CARDINALITY,
  SUB_PART AS prefix_length
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = 'amazon_asin_monitor'
  AND TABLE_NAME = 'monitor_history'
ORDER BY INDEX_NAME, SEQ_IN_INDEX;

-- 4. 查看表大小
SELECT 
  table_name,
  ROUND(data_length / 1024 / 1024, 2) AS data_size_mb,
  ROUND(index_length / 1024 / 1024, 2) AS index_size_mb,
  ROUND((data_length + index_length) / 1024 / 1024, 2) AS total_size_mb,
  table_rows
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = 'amazon_asin_monitor'
  AND TABLE_NAME IN ('monitor_history', 'monitor_history_agg', 'monitor_history_agg_dim', 'monitor_history_agg_variant_group')
ORDER BY total_size_mb DESC;

-- 5. 查看最近7天数据分布（检查聚合刷新是否正常）
SELECT 
  DATE(check_time) AS date,
  COUNT(*) AS row_count,
  COUNT(DISTINCT country) AS countries
FROM monitor_history
WHERE check_time >= DATE_SUB(NOW(), INTERVAL 7 DAY)
GROUP BY DATE(check_time)
ORDER BY date DESC;

-- 6. 检查缺失聚合数据的日期
SELECT 
  '缺失聚合数据的日期（最近7天）' AS section,
  DATE(mh.check_time) AS date,
  COUNT(*) AS raw_count,
  (SELECT COUNT(*) FROM monitor_history_agg 
   WHERE DATE(time_slot) = DATE(mh.check_time) AND granularity = 'day') AS agg_day_count,
  (SELECT COUNT(*) FROM monitor_history_agg 
   WHERE DATE(time_slot) = DATE(mh.check_time) AND granularity = 'hour') AS agg_hour_count
FROM monitor_history mh
WHERE mh.check_time >= DATE_SUB(NOW(), INTERVAL 7 DAY)
GROUP BY DATE(mh.check_time)
HAVING agg_day_count = 0 OR agg_hour_count = 0
ORDER BY date DESC;
