-- 为变体组表添加 last_check_time 和 feishu_notify_enabled 字段
-- 迁移编号: 011
-- 创建时间: 2024

USE `amazon_asin_monitor`;

-- 添加监控更新时间字段
ALTER TABLE `variant_groups` 
ADD COLUMN `last_check_time` DATETIME DEFAULT NULL COMMENT '监控更新时间（上一次检查的时间）' AFTER `update_time`;

-- 添加飞书通知开关字段
ALTER TABLE `variant_groups` 
ADD COLUMN `feishu_notify_enabled` TINYINT(1) DEFAULT 1 COMMENT '飞书通知开关: 0-关闭, 1-开启' AFTER `last_check_time`;

-- 添加索引
ALTER TABLE `variant_groups` 
ADD INDEX `idx_last_check_time` (`last_check_time`),
ADD INDEX `idx_feishu_notify_enabled` (`feishu_notify_enabled`);

