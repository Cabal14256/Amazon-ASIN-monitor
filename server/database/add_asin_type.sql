-- 为ASIN表添加类型字段（主链/副评）
USE `amazon_asin_monitor`;

-- 如果之前添加了main_link和sub_review字段，先删除它们
ALTER TABLE `asins` 
DROP COLUMN IF EXISTS `main_link`,
DROP COLUMN IF EXISTS `sub_review`;

-- 添加ASIN类型字段
ALTER TABLE `asins` 
ADD COLUMN `asin_type` VARCHAR(20) DEFAULT NULL COMMENT 'ASIN类型: MAIN_LINK-主链, SUB_REVIEW-副评' AFTER `name`;

-- 添加索引
ALTER TABLE `asins` 
ADD INDEX `idx_asin_type` (`asin_type`);

