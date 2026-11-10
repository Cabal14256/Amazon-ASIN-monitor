-- 迁移脚本 015: 修改ASIN唯一约束为复合唯一索引(asin + country)
-- 说明: 允许同一ASIN在不同国家存在，将单独的asin唯一约束改为(asin, country)复合唯一索引
-- 执行时间: 2025-01-XX

USE `amazon_asin_monitor`;

-- 删除原有的 asin 字段的 UNIQUE 约束
-- MySQL 中 UNIQUE 约束会创建一个唯一索引，需要先找到并删除该索引
-- 先检查是否存在 asin 的唯一索引
SET @index_name = NULL;
SELECT INDEX_NAME INTO @index_name
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'asins'
  AND COLUMN_NAME = 'asin'
  AND NON_UNIQUE = 0
LIMIT 1;

-- 如果找到了唯一索引，删除它
SET @sql = IF(@index_name IS NOT NULL, 
  CONCAT('ALTER TABLE `asins` DROP INDEX `', @index_name, '`'),
  'SELECT "ASIN唯一索引不存在或已被删除" AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 添加 (asin, country) 的复合唯一索引
ALTER TABLE `asins`
ADD UNIQUE INDEX `uk_asin_country` (`asin`, `country`);

SELECT 'ASIN唯一约束已修改为(asin, country)复合唯一索引' AS result;

