-- 迁移脚本 017: 优化监控历史表索引以提升查询性能
-- 说明: 根据优化后的COUNT查询和常见查询模式，添加复合索引
-- 执行时间: 2025-12-XX

USE `amazon_asin_monitor`;

-- 优化时间范围+国家+状态查询（用于COUNT查询和统计查询）
-- 注意：check_time在前可以更好地利用时间范围查询
-- 如果索引已存在，会报错但不会影响其他索引的创建
ALTER TABLE `monitor_history`
ADD INDEX `idx_check_time_country_broken` (`check_time`, `country`, `is_broken`);

-- 优化ASIN搜索查询（用于按ASIN编码搜索）
-- 支持按asin_code、country和时间范围查询
ALTER TABLE `monitor_history`
ADD INDEX `idx_asin_code_country_check_time` (`asin_code`, `country`, `check_time`);

SELECT '监控历史索引优化完成' AS result;

