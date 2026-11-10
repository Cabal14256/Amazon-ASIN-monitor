-- 迁移版本: 031
-- 迁移名称: 优化数据分析刷新索引
-- 说明:
-- 1) 为状态区间增量刷新增加 check_type/check_time/id 索引，避免启动刷新全表排序
-- 2) 补齐变体组聚合表按 granularity/country/variant_group_id/time_slot 查询索引

USE `amazon_asin_monitor`;

SET @index_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'monitor_history'
    AND INDEX_NAME = 'idx_status_interval_refresh'
);
SET @sql = IF(
  @index_exists = 0,
  'ALTER TABLE `monitor_history` ADD INDEX `idx_status_interval_refresh` (`check_type`, `check_time`, `id`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @index_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'monitor_history_agg_variant_group'
    AND INDEX_NAME = 'idx_agg_variant_group_lookup'
);
SET @sql = IF(
  @index_exists = 0,
  'ALTER TABLE `monitor_history_agg_variant_group` ADD INDEX `idx_agg_variant_group_lookup` (`granularity`, `country`, `variant_group_id`, `time_slot`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT '数据分析刷新索引优化完成' AS result;
