-- 迁移脚本 012: 添加复合索引优化查询性能
-- 说明: 为频繁查询的字段组合添加复合索引，提升查询性能
-- 执行时间: 2025-01-XX

USE `amazon_asin_monitor`;

-- 为 asins 表添加复合索引
-- 优化按变体组、国家、状态查询的性能
ALTER TABLE `asins`
ADD INDEX `idx_variant_group_country_broken` (`variant_group_id`, `country`, `is_broken`);

-- 为 monitor_history 表添加复合索引
-- 优化按变体组、检查时间、状态查询的性能
ALTER TABLE `monitor_history`
ADD INDEX `idx_variant_group_check_time_broken` (`variant_group_id`, `check_time`, `is_broken`);

-- 优化按国家、检查时间、状态查询的性能（用于统计查询）
ALTER TABLE `monitor_history`
ADD INDEX `idx_country_check_time_broken` (`country`, `check_time`, `is_broken`);

-- 为 variant_groups 表添加复合索引
-- 优化按国家、状态查询的性能
ALTER TABLE `variant_groups`
ADD INDEX `idx_country_broken` (`country`, `is_broken`);

SELECT '复合索引已创建' AS result;

