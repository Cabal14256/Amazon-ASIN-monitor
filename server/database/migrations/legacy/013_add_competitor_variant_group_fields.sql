-- 迁移版本: 013
-- 迁移名称: 添加竞品变体组监控更新时间字段
-- 创建时间: 2024-XX-XX
-- 说明: 为竞品变体组表补充 last_check_time 字段与索引

USE `amazon_competitor_monitor`;

ALTER TABLE `competitor_variant_groups`
ADD COLUMN `last_check_time` DATETIME DEFAULT NULL COMMENT '监控更新时间（上一次检查的时间）' AFTER `update_time`;

ALTER TABLE `competitor_variant_groups`
ADD INDEX `idx_last_check_time` (`last_check_time`);
