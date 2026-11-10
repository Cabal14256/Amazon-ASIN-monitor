-- 迁移版本: 030
-- 迁移名称: 优化批量删除历史表外键依赖
-- 说明:
-- 1. 主营监控历史保留快照字段，移除删除变体组/ASIN时触发的 ON DELETE SET NULL 外键
-- 2. 竞品监控历史补齐快照字段并回填，再移除同类外键
-- 3. 外键名称通过 INFORMATION_SCHEMA 动态定位，兼容不同环境的自动命名

USE `amazon_asin_monitor`;

SET @fk_name = (
  SELECT CONSTRAINT_NAME
  FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'monitor_history'
    AND COLUMN_NAME = 'variant_group_id'
    AND REFERENCED_TABLE_NAME = 'variant_groups'
  LIMIT 1
);
SET @sql = IF(
  @fk_name IS NULL,
  'SELECT 1',
  CONCAT('ALTER TABLE `monitor_history` DROP FOREIGN KEY `', REPLACE(@fk_name, '`', '``'), '`')
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @fk_name = (
  SELECT CONSTRAINT_NAME
  FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'monitor_history'
    AND COLUMN_NAME = 'asin_id'
    AND REFERENCED_TABLE_NAME = 'asins'
  LIMIT 1
);
SET @sql = IF(
  @fk_name IS NULL,
  'SELECT 1',
  CONCAT('ALTER TABLE `monitor_history` DROP FOREIGN KEY `', REPLACE(@fk_name, '`', '``'), '`')
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 兼容竞品表与主库同库部署的环境；表不存在时自动跳过。
SET @sql = IF(
  (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'competitor_monitor_history'
  ) > 0 AND (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'competitor_monitor_history'
      AND COLUMN_NAME = 'variant_group_name'
  ) = 0,
  "ALTER TABLE `competitor_monitor_history` ADD COLUMN `variant_group_name` VARCHAR(255) COMMENT '变体组名称快照（记录时的变体组名称）' AFTER `variant_group_id`",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'competitor_monitor_history'
  ) > 0 AND (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'competitor_monitor_history'
      AND COLUMN_NAME = 'asin_code'
  ) = 0,
  "ALTER TABLE `competitor_monitor_history` ADD COLUMN `asin_code` VARCHAR(20) COMMENT 'ASIN编码快照（记录时的ASIN编码）' AFTER `asin_id`",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'competitor_monitor_history'
  ) > 0 AND (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'competitor_monitor_history'
      AND COLUMN_NAME = 'asin_name'
  ) = 0,
  "ALTER TABLE `competitor_monitor_history` ADD COLUMN `asin_name` VARCHAR(500) COMMENT 'ASIN名称快照（记录时的ASIN名称）' AFTER `asin_code`",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'competitor_monitor_history'
  ) = 0,
  'SELECT 1',
  'UPDATE `competitor_monitor_history` mh
   LEFT JOIN `competitor_variant_groups` vg ON vg.id = mh.variant_group_id
   LEFT JOIN `competitor_asins` a ON a.id = mh.asin_id
   SET
     mh.variant_group_name = COALESCE(mh.variant_group_name, vg.name),
     mh.asin_code = COALESCE(mh.asin_code, a.asin),
     mh.asin_name = COALESCE(mh.asin_name, a.name)
   WHERE mh.variant_group_name IS NULL
      OR mh.asin_code IS NULL
      OR mh.asin_name IS NULL'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @fk_name = (
  SELECT CONSTRAINT_NAME
  FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'competitor_monitor_history'
    AND COLUMN_NAME = 'variant_group_id'
    AND REFERENCED_TABLE_NAME = 'competitor_variant_groups'
  LIMIT 1
);
SET @sql = IF(
  @fk_name IS NULL,
  'SELECT 1',
  CONCAT('ALTER TABLE `competitor_monitor_history` DROP FOREIGN KEY `', REPLACE(@fk_name, '`', '``'), '`')
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @fk_name = (
  SELECT CONSTRAINT_NAME
  FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'competitor_monitor_history'
    AND COLUMN_NAME = 'asin_id'
    AND REFERENCED_TABLE_NAME = 'competitor_asins'
  LIMIT 1
);
SET @sql = IF(
  @fk_name IS NULL,
  'SELECT 1',
  CONCAT('ALTER TABLE `competitor_monitor_history` DROP FOREIGN KEY `', REPLACE(@fk_name, '`', '``'), '`')
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE DATABASE IF NOT EXISTS `amazon_competitor_monitor`
DEFAULT CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;

USE `amazon_competitor_monitor`;

SET @sql = IF(
  (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'competitor_monitor_history'
  ) > 0 AND (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'competitor_monitor_history'
      AND COLUMN_NAME = 'variant_group_name'
  ) = 0,
  "ALTER TABLE `competitor_monitor_history` ADD COLUMN `variant_group_name` VARCHAR(255) COMMENT '变体组名称快照（记录时的变体组名称）' AFTER `variant_group_id`",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'competitor_monitor_history'
  ) > 0 AND (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'competitor_monitor_history'
      AND COLUMN_NAME = 'asin_code'
  ) = 0,
  "ALTER TABLE `competitor_monitor_history` ADD COLUMN `asin_code` VARCHAR(20) COMMENT 'ASIN编码快照（记录时的ASIN编码）' AFTER `asin_id`",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'competitor_monitor_history'
  ) > 0 AND (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'competitor_monitor_history'
      AND COLUMN_NAME = 'asin_name'
  ) = 0,
  "ALTER TABLE `competitor_monitor_history` ADD COLUMN `asin_name` VARCHAR(500) COMMENT 'ASIN名称快照（记录时的ASIN名称）' AFTER `asin_code`",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'competitor_monitor_history'
  ) = 0,
  'SELECT 1',
  'UPDATE `competitor_monitor_history` mh
   LEFT JOIN `competitor_variant_groups` vg ON vg.id = mh.variant_group_id
   LEFT JOIN `competitor_asins` a ON a.id = mh.asin_id
   SET
     mh.variant_group_name = COALESCE(mh.variant_group_name, vg.name),
     mh.asin_code = COALESCE(mh.asin_code, a.asin),
     mh.asin_name = COALESCE(mh.asin_name, a.name)
   WHERE mh.variant_group_name IS NULL
      OR mh.asin_code IS NULL
      OR mh.asin_name IS NULL'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @fk_name = (
  SELECT CONSTRAINT_NAME
  FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'competitor_monitor_history'
    AND COLUMN_NAME = 'variant_group_id'
    AND REFERENCED_TABLE_NAME = 'competitor_variant_groups'
  LIMIT 1
);
SET @sql = IF(
  @fk_name IS NULL,
  'SELECT 1',
  CONCAT('ALTER TABLE `competitor_monitor_history` DROP FOREIGN KEY `', REPLACE(@fk_name, '`', '``'), '`')
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @fk_name = (
  SELECT CONSTRAINT_NAME
  FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'competitor_monitor_history'
    AND COLUMN_NAME = 'asin_id'
    AND REFERENCED_TABLE_NAME = 'competitor_asins'
  LIMIT 1
);
SET @sql = IF(
  @fk_name IS NULL,
  'SELECT 1',
  CONCAT('ALTER TABLE `competitor_monitor_history` DROP FOREIGN KEY `', REPLACE(@fk_name, '`', '``'), '`')
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT '批量删除历史表外键优化完成' AS result;
