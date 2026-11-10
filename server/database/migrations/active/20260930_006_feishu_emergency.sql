-- 为主营飞书通知添加电话加急规则和跨进程冷却时间。
-- 按列检查，允许安全重复执行；不回填、不覆盖已有配置。
USE `amazon_asin_monitor`;

SET @column_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'feishu_config'
    AND COLUMN_NAME = 'emergency_config'
);
SET @sql = IF(
  @column_exists = 0,
  'ALTER TABLE `feishu_config` ADD COLUMN `emergency_config` JSON DEFAULT NULL COMMENT ''电话加急规则、时间范围、阈值和联系人''',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'feishu_config'
    AND COLUMN_NAME = 'last_emergency_at'
);
SET @sql = IF(
  @column_exists = 0,
  'ALTER TABLE `feishu_config` ADD COLUMN `last_emergency_at` DATETIME DEFAULT NULL COMMENT ''最近一次电话加急抢占时间（UTC）''',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT '飞书电话加急配置字段已就绪' AS result;
