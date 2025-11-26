-- 迁移脚本 008: 为监控历史添加国家+检查时间索引
-- 说明: 改善按国家查询监控历史时的性能，配合仪表盘与导出
-- 执行时间: 2025-11-26

USE `amazon_asin_monitor`;

ALTER TABLE `monitor_history`
ADD INDEX `idx_country_check_time` (`country`, `check_time`);

SELECT '监控历史索引已创建' AS result;

