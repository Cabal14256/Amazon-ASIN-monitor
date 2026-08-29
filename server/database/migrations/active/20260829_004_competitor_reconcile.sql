-- 目标: amazon_competitor_monitor
-- 用途: 独立竞品历史快照、移除实体外键，并统一 ASIN+国家复合唯一键。

USE `amazon_competitor_monitor`;

DROP PROCEDURE IF EXISTS `_reconcile_competitor_history`;
DELIMITER $$
CREATE PROCEDURE `_reconcile_competitor_history`()
BEGIN
  DECLARE v_rows INT DEFAULT 1;
  DECLARE v_missing BIGINT DEFAULT 0;
  DECLARE v_duplicates BIGINT DEFAULT 0;
  DECLARE v_single_unique VARCHAR(64) DEFAULT NULL;
  DECLARE v_named_signature VARCHAR(1000) DEFAULT NULL;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.`COLUMNS`
    WHERE `TABLE_SCHEMA` = DATABASE() AND `TABLE_NAME` = 'competitor_monitor_history'
      AND `COLUMN_NAME` = 'variant_group_name'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.`COLUMNS`
    WHERE `TABLE_SCHEMA` = DATABASE() AND `TABLE_NAME` = 'competitor_monitor_history'
      AND `COLUMN_NAME` = 'asin_code'
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = '竞品历史表缺少身份快照字段，请先执行对应 legacy 迁移';
  END IF;

  WHILE v_rows > 0 DO
    UPDATE `competitor_monitor_history` mh
    JOIN (
      SELECT `id`
      FROM (
        SELECT `id`
        FROM `competitor_monitor_history`
        WHERE (`variant_group_id` IS NOT NULL AND `variant_group_name` IS NULL)
           OR (`asin_id` IS NOT NULL AND `asin_code` IS NULL)
        ORDER BY `id`
        LIMIT 10000
      ) pending
    ) batch ON batch.`id` = mh.`id`
    LEFT JOIN `competitor_variant_groups` vg ON vg.`id` = mh.`variant_group_id`
    LEFT JOIN `competitor_asins` a ON a.`id` = mh.`asin_id`
    SET mh.`variant_group_name` = COALESCE(mh.`variant_group_name`, vg.`name`),
        mh.`asin_code` = COALESCE(mh.`asin_code`, a.`asin`),
        mh.`asin_name` = COALESCE(mh.`asin_name`, a.`name`);
    SET v_rows = ROW_COUNT();
  END WHILE;

  SELECT COUNT(*)
  INTO v_missing
  FROM `competitor_monitor_history`
  WHERE (`variant_group_id` IS NOT NULL AND `variant_group_name` IS NULL)
     OR (`asin_id` IS NOT NULL AND `asin_code` IS NULL);

  IF v_missing > 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = '竞品历史仍有身份快照缺失，拒绝删除外键';
  END IF;

  SELECT COUNT(*)
  INTO v_duplicates
  FROM (
    SELECT `asin`, `country`
    FROM `competitor_asins`
    GROUP BY `asin`, `country`
    HAVING COUNT(*) > 1
  ) duplicates;

  IF v_duplicates > 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'competitor_asins存在ASIN+国家重复数据，拒绝修改唯一键';
  END IF;

  SELECT s.`INDEX_NAME`
  INTO v_single_unique
  FROM information_schema.`STATISTICS` s
  WHERE s.`TABLE_SCHEMA` = DATABASE()
    AND s.`TABLE_NAME` = 'competitor_asins'
    AND s.`NON_UNIQUE` = 0
    AND s.`INDEX_NAME` <> 'PRIMARY'
  GROUP BY s.`INDEX_NAME`
  HAVING COUNT(*) = 1 AND MAX(s.`COLUMN_NAME`) = 'asin'
  LIMIT 1;

  IF v_single_unique IS NOT NULL THEN
    SET @ddl = CONCAT(
      'ALTER TABLE `competitor_asins` DROP INDEX `',
      REPLACE(v_single_unique, '`', '``'),
      '`, ALGORITHM=INPLACE, LOCK=NONE'
    );
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;

  SELECT GROUP_CONCAT(s.`COLUMN_NAME` ORDER BY s.`SEQ_IN_INDEX`)
  INTO v_named_signature
  FROM information_schema.`STATISTICS` s
  WHERE s.`TABLE_SCHEMA` = DATABASE()
    AND s.`TABLE_NAME` = 'competitor_asins'
    AND s.`INDEX_NAME` = 'uk_asin_country';

  IF v_named_signature IS NOT NULL AND v_named_signature <> 'asin,country' THEN
    ALTER TABLE `competitor_asins`
      DROP INDEX `uk_asin_country`, ALGORITHM=INPLACE, LOCK=NONE;
    SET v_named_signature = NULL;
  END IF;

  IF v_named_signature IS NULL THEN
    ALTER TABLE `competitor_asins`
      ADD UNIQUE INDEX `uk_asin_country` (`asin`, `country`),
      ALGORITHM=INPLACE,
      LOCK=NONE;
  END IF;
END$$
DELIMITER ;

CALL `_reconcile_competitor_history`();
DROP PROCEDURE IF EXISTS `_reconcile_competitor_history`;

SELECT GROUP_CONCAT(
  CONCAT('DROP FOREIGN KEY `', k.`CONSTRAINT_NAME`, '`')
  SEPARATOR ', '
)
INTO @competitor_history_fk_clauses
FROM information_schema.`KEY_COLUMN_USAGE` k
WHERE k.`CONSTRAINT_SCHEMA` = DATABASE()
  AND k.`TABLE_NAME` = 'competitor_monitor_history'
  AND k.`REFERENCED_TABLE_NAME` IN ('competitor_variant_groups', 'competitor_asins');

SET @competitor_history_fk_sql = IF(
  @competitor_history_fk_clauses IS NULL OR @competitor_history_fk_clauses = '',
  'SELECT ''competitor_monitor_history无实体外键'' AS message',
  CONCAT(
    'ALTER TABLE `competitor_monitor_history` ',
    @competitor_history_fk_clauses,
    ', ALGORITHM=INPLACE, LOCK=NONE'
  )
);
PREPARE stmt FROM @competitor_history_fk_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
