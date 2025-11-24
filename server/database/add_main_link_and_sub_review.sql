-- 为ASIN表添加主链和副评字段
USE `amazon_asin_monitor`;

ALTER TABLE `asins` 
ADD COLUMN `main_link` VARCHAR(500) COMMENT '主链' AFTER `name`,
ADD COLUMN `sub_review` VARCHAR(500) COMMENT '副评' AFTER `main_link`;

