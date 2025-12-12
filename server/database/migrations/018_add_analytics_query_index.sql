-- 迁移脚本 018: 为数据分析查询添加优化索引
-- 说明: 为getAllCountriesSummary等统计查询添加复合索引，优化GROUP BY查询性能
-- 执行时间: 2025-01-XX

USE `amazon_asin_monitor`;

-- 为统计查询添加复合索引
-- 优化按国家、时间、状态、ASIN分组的查询（用于getAllCountriesSummary的GROUP BY查询）
-- 注意：如果索引已存在，会报错但不会影响其他索引的创建
ALTER TABLE `monitor_history`
ADD INDEX `idx_country_time_broken_asin` (`country`, `check_time`, `is_broken`, `asin_id`);

SELECT '数据分析查询索引已创建' AS result;

