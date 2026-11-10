-- 迁移版本: 020
-- 迁移名称: 添加状态变化查询优化索引
-- 创建时间: 2025-01-XX
-- 说明: 为状态变化查询添加复合索引，优化窗口函数查询性能

USE `amazon_asin_monitor`;

-- 优化状态变化查询的索引
-- 窗口函数 LAG 需要按 asin_id, country 分区并按 check_time 排序
-- 这个索引可以加速窗口函数的计算
-- 注意：如果索引已存在，会报错但不会影响其他索引的创建
ALTER TABLE `monitor_history`
ADD INDEX `idx_asin_country_check_time_broken` (`asin_id`, `country`, `check_time`, `is_broken`);

-- 确保 asin_id 有索引（如果不存在）
-- 注意：如果索引已存在，会报错但不会影响其他索引的创建
ALTER TABLE `monitor_history`
ADD INDEX `idx_asin_id` (`asin_id`);

SELECT '状态变化查询索引添加完成' AS result;

