-- 目标: amazon_asin_monitor.asins
-- 用途: 将生产扩展字段纳入本仓库维护的 canonical schema，并保证可选文本字段允许 NULL。
-- 特性: 基于 information_schema 生成单次 ALTER；字段已符合契约时不执行 DDL。

USE `amazon_asin_monitor`;

SET @previous_group_concat_max_len = @@SESSION.group_concat_max_len;
SET SESSION group_concat_max_len = 1024 * 1024;

DROP TEMPORARY TABLE IF EXISTS `_asin_extension_contract`;
CREATE TEMPORARY TABLE `_asin_extension_contract` (
  `ordinal_position` INT NOT NULL,
  `column_name` VARCHAR(64) NOT NULL,
  `expected_type` VARCHAR(255) NOT NULL,
  `expected_nullable` VARCHAR(3) NOT NULL,
  `expected_default` VARCHAR(255) DEFAULT NULL,
  `definition_sql` TEXT NOT NULL,
  PRIMARY KEY (`column_name`)
);

INSERT INTO `_asin_extension_contract`
  (`ordinal_position`, `column_name`, `expected_type`, `expected_nullable`, `expected_default`, `definition_sql`)
VALUES
  (1, 'variant_group', 'varchar(200)', 'NO', '未分组', '`variant_group` VARCHAR(200) NOT NULL DEFAULT ''未分组'' COMMENT ''采集系统变体组标签'' AFTER `feishu_notify_enabled`'),
  (2, 'asin_note', 'text', 'YES', NULL, '`asin_note` TEXT NULL DEFAULT NULL COMMENT ''ASIN备注'' AFTER `variant_group`'),
  (3, 'latest_rating', 'double', 'YES', NULL, '`latest_rating` DOUBLE DEFAULT NULL COMMENT ''最新评分'' AFTER `asin_note`'),
  (4, 'latest_rating_count', 'int', 'YES', NULL, '`latest_rating_count` INT DEFAULT NULL COMMENT ''最新评分数量'' AFTER `latest_rating`'),
  (5, 'previous_rating', 'double', 'YES', NULL, '`previous_rating` DOUBLE DEFAULT NULL COMMENT ''上一次评分'' AFTER `latest_rating_count`'),
  (6, 'previous_rating_count', 'int', 'YES', NULL, '`previous_rating_count` INT DEFAULT NULL COMMENT ''上一次评分数量'' AFTER `previous_rating`'),
  (7, 'last_collection_status', 'varchar(30)', 'NO', 'PENDING', '`last_collection_status` VARCHAR(30) NOT NULL DEFAULT ''PENDING'' COMMENT ''最近采集状态'' AFTER `previous_rating_count`'),
  (8, 'last_error_code', 'varchar(50)', 'YES', NULL, '`last_error_code` VARCHAR(50) DEFAULT NULL COMMENT ''最近采集错误码'' AFTER `last_collection_status`'),
  (9, 'last_error_message', 'text', 'YES', NULL, '`last_error_message` TEXT DEFAULT NULL COMMENT ''最近采集错误信息'' AFTER `last_error_code`'),
  (10, 'last_collected_at', 'datetime', 'YES', NULL, '`last_collected_at` DATETIME DEFAULT NULL COMMENT ''最近采集时间'' AFTER `last_error_message`'),
  (11, 'enabled', 'tinyint(1)', 'NO', '1', '`enabled` TINYINT(1) NOT NULL DEFAULT 1 COMMENT ''采集启用状态: 0-禁用, 1-启用'' AFTER `last_collected_at`'),
  (12, 'deleted', 'tinyint(1)', 'NO', '0', '`deleted` TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''软删除状态: 0-正常, 1-删除'' AFTER `enabled`'),
  (13, 'created_by', 'bigint', 'YES', NULL, '`created_by` BIGINT DEFAULT NULL COMMENT ''创建人ID'' AFTER `deleted`'),
  (14, 'parent_asin', 'varchar(20)', 'YES', NULL, '`parent_asin` VARCHAR(20) DEFAULT NULL COMMENT ''父体ASIN'' AFTER `created_by`'),
  (15, 'parent_title', 'text', 'YES', NULL, '`parent_title` TEXT NULL DEFAULT NULL COMMENT ''父体标题'' AFTER `parent_asin`'),
  (16, 'parent_query_status', 'varchar(30)', 'NO', 'PENDING', '`parent_query_status` VARCHAR(30) NOT NULL DEFAULT ''PENDING'' COMMENT ''父体查询状态'' AFTER `parent_title`'),
  (17, 'parent_query_error', 'text', 'YES', NULL, '`parent_query_error` TEXT DEFAULT NULL COMMENT ''父体查询错误信息'' AFTER `parent_query_status`'),
  (18, 'parent_queried_at', 'datetime', 'YES', NULL, '`parent_queried_at` DATETIME DEFAULT NULL COMMENT ''父体最近查询时间'' AFTER `parent_query_error`');

SELECT GROUP_CONCAT(
  CASE
    WHEN c.`COLUMN_NAME` IS NULL THEN CONCAT('ADD COLUMN ', d.`definition_sql`)
    WHEN LOWER(c.`COLUMN_TYPE`) <> d.`expected_type`
      OR c.`IS_NULLABLE` <> d.`expected_nullable`
      OR NOT (c.`COLUMN_DEFAULT` <=> d.`expected_default`)
      OR c.`EXTRA` LIKE '%VIRTUAL GENERATED%'
      OR c.`EXTRA` LIKE '%STORED GENERATED%'
      THEN CONCAT('MODIFY COLUMN ', d.`definition_sql`)
    ELSE NULL
  END
  ORDER BY d.`ordinal_position`
  SEPARATOR ', '
)
INTO @asin_extension_clauses
FROM `_asin_extension_contract` d
LEFT JOIN information_schema.`COLUMNS` c
  ON c.`TABLE_SCHEMA` = DATABASE()
 AND c.`TABLE_NAME` = 'asins'
 AND c.`COLUMN_NAME` = d.`column_name`;

SET @asin_extension_sql = IF(
  @asin_extension_clauses IS NULL OR @asin_extension_clauses = '',
  'SELECT ''asins扩展字段已符合契约'' AS message',
  CONCAT(
    'ALTER TABLE `asins` ',
    @asin_extension_clauses,
    ', ALGORITHM=INPLACE, LOCK=NONE'
  )
);

PREPARE stmt FROM @asin_extension_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

DROP TEMPORARY TABLE IF EXISTS `_asin_extension_contract`;
SET SESSION group_concat_max_len = @previous_group_concat_max_len;
