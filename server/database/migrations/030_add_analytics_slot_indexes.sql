-- 迁移脚本 030: 为 analytics 时间槽查询补充复合索引
-- 说明: 优化基于 check_type + day_ts/hour_ts 的统计查询与聚合刷新

USE `amazon_asin_monitor`;

ALTER TABLE `monitor_history`
ADD INDEX `idx_check_type_day_country_asin` (`check_type`, `day_ts`, `country`, `asin_id`, `asin_code`, `is_broken`);

ALTER TABLE `monitor_history`
ADD INDEX `idx_check_type_hour_country_asin` (`check_type`, `hour_ts`, `country`, `asin_id`, `asin_code`, `is_broken`);

SELECT 'analytics 时间槽复合索引已创建' AS result;
