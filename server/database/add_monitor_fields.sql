-- 为ASIN表添加监控更新时间和飞书通知字段
USE `amazon_asin_monitor`;

-- 添加监控更新时间字段
ALTER TABLE `asins` 
ADD COLUMN `last_check_time` DATETIME DEFAULT NULL COMMENT '监控更新时间（上一次检查的时间）' AFTER `update_time`;

-- 添加飞书通知开关字段
ALTER TABLE `asins` 
ADD COLUMN `feishu_notify_enabled` TINYINT(1) DEFAULT 1 COMMENT '飞书通知开关: 0-关闭, 1-开启' AFTER `last_check_time`;

-- 添加索引
ALTER TABLE `asins` 
ADD INDEX `idx_last_check_time` (`last_check_time`),
ADD INDEX `idx_feishu_notify_enabled` (`feishu_notify_enabled`);

