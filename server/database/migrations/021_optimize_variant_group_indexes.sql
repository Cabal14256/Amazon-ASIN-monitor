-- 迁移版本: 021
-- 迁移名称: 优化变体组查询索引
-- 创建时间: 2025-01-XX
-- 说明: 为变体组名称添加索引，优化LIKE查询性能

USE `amazon_asin_monitor`;

-- 为变体组名称添加索引（支持LIKE查询）
-- 注意：如果索引已存在，会报错但不会影响其他索引的创建
ALTER TABLE `variant_groups`
ADD INDEX `idx_variant_groups_name` (`name`);

-- 确保 asins 表的 asin 字段有索引（如果不存在）
-- 注意：根据 init.sql，idx_asin 已存在，但这里确保一下
-- 如果已存在会报错，但不影响执行
ALTER TABLE `asins`
ADD INDEX `idx_asins_asin` (`asin`);

-- 确保 asins 表的 variant_group_id 有索引（如果不存在）
-- 注意：根据 init.sql，idx_variant_group_id 已存在，但这里确保一下
-- 如果已存在会报错，但不影响执行
ALTER TABLE `asins`
ADD INDEX `idx_asins_variant_group_id` (`variant_group_id`);

SELECT '变体组查询索引优化完成' AS result;
