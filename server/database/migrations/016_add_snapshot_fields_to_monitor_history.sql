-- 迁移脚本 016: 为监控历史表添加快照字段
-- 说明: 添加 asin_code, asin_name, variant_group_name 字段，使监控历史记录独立于ASIN和变体组的删除
-- 执行时间: 2025-01-XX

USE `amazon_asin_monitor`;

-- 添加快照字段
ALTER TABLE `monitor_history`
ADD COLUMN `asin_code` VARCHAR(20) COMMENT 'ASIN编码快照（记录时的ASIN编码）' AFTER `asin_id`,
ADD COLUMN `asin_name` VARCHAR(500) COMMENT 'ASIN名称快照（记录时的ASIN名称）' AFTER `asin_code`,
ADD COLUMN `variant_group_name` VARCHAR(255) COMMENT '变体组名称快照（记录时的变体组名称）' AFTER `variant_group_id`;

-- 为快照字段添加索引，便于搜索
ALTER TABLE `monitor_history`
ADD INDEX `idx_asin_code` (`asin_code`);

-- 为现有记录填充快照字段（基于当前仍存在的关联记录）
UPDATE `monitor_history` mh
LEFT JOIN `asins` a ON a.id = mh.asin_id
LEFT JOIN `variant_groups` vg ON vg.id = mh.variant_group_id
SET 
  mh.asin_code = COALESCE(mh.asin_code, a.asin),
  mh.asin_name = COALESCE(mh.asin_name, a.name),
  mh.variant_group_name = COALESCE(mh.variant_group_name, vg.name)
WHERE mh.asin_code IS NULL OR mh.variant_group_name IS NULL;

SELECT '监控历史表快照字段已添加并填充' AS result;

