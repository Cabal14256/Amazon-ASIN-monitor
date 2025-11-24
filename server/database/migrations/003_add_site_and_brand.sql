-- 迁移版本: 003
-- 迁移名称: 添加站点和品牌字段
-- 创建时间: 2024-11-24
-- 说明: 为变体组表和ASIN表添加站点(site)和品牌(brand)字段

USE `amazon_asin_monitor`;

-- 为变体组表添加站点和品牌字段
ALTER TABLE `variant_groups` 
ADD COLUMN `site` VARCHAR(100) NOT NULL COMMENT '站点（内部店铺代号，如"12"）' AFTER `country`,
ADD COLUMN `brand` VARCHAR(100) NOT NULL COMMENT '品牌' AFTER `site`;

-- 为ASIN表添加站点和品牌字段
ALTER TABLE `asins` 
ADD COLUMN `site` VARCHAR(100) NOT NULL COMMENT '站点（内部店铺代号，如"12"）' AFTER `country`,
ADD COLUMN `brand` VARCHAR(100) NOT NULL COMMENT '品牌' AFTER `site`;

-- 添加索引
ALTER TABLE `variant_groups` 
ADD INDEX `idx_site` (`site`),
ADD INDEX `idx_brand` (`brand`);

ALTER TABLE `asins` 
ADD INDEX `idx_site` (`site`),
ADD INDEX `idx_brand` (`brand`);

