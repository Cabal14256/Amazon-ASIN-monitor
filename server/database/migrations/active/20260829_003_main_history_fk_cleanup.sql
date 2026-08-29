-- 目标: amazon_asin_monitor.monitor_history
-- 用途: 分批回填历史身份快照，并移除对当前实体的外键依赖。
-- 重要: 大表更新必须先在恢复出的测试库验证；本脚本不会由应用自动执行。

USE `amazon_asin_monitor`;

DROP PROCEDURE IF EXISTS `_reconcile_main_history`;
DELIMITER $$
CREATE PROCEDURE `_reconcile_main_history`()
BEGIN
  DECLARE v_rows INT DEFAULT 1;
  DECLARE v_missing BIGINT DEFAULT 0;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.`COLUMNS`
    WHERE `TABLE_SCHEMA` = DATABASE() AND `TABLE_NAME` = 'monitor_history'
      AND `COLUMN_NAME` = 'variant_group_name'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.`COLUMNS`
    WHERE `TABLE_SCHEMA` = DATABASE() AND `TABLE_NAME` = 'monitor_history'
      AND `COLUMN_NAME` = 'asin_code'
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'monitor_history缺少身份快照字段，请先执行对应 legacy 迁移';
  END IF;

  WHILE v_rows > 0 DO
    UPDATE `monitor_history` mh
    JOIN (
      SELECT `id`
      FROM (
        SELECT `id`
        FROM `monitor_history`
        WHERE (`variant_group_id` IS NOT NULL AND `variant_group_name` IS NULL)
           OR (`asin_id` IS NOT NULL AND `asin_code` IS NULL)
           OR (`asin_id` IS NOT NULL AND `site_snapshot` IS NULL)
           OR (`asin_id` IS NOT NULL AND `brand_snapshot` IS NULL)
        ORDER BY `id`
        LIMIT 10000
      ) pending
    ) batch ON batch.`id` = mh.`id`
    LEFT JOIN `variant_groups` vg ON vg.`id` = mh.`variant_group_id`
    LEFT JOIN `asins` a ON a.`id` = mh.`asin_id`
    SET mh.`variant_group_name` = COALESCE(mh.`variant_group_name`, vg.`name`),
        mh.`asin_code` = COALESCE(mh.`asin_code`, a.`asin`),
        mh.`asin_name` = COALESCE(mh.`asin_name`, a.`name`),
        mh.`site_snapshot` = COALESCE(mh.`site_snapshot`, a.`site`),
        mh.`brand_snapshot` = COALESCE(mh.`brand_snapshot`, a.`brand`);
    SET v_rows = ROW_COUNT();
  END WHILE;

  SELECT COUNT(*)
  INTO v_missing
  FROM `monitor_history`
  WHERE (`variant_group_id` IS NOT NULL AND `variant_group_name` IS NULL)
     OR (`asin_id` IS NOT NULL AND `asin_code` IS NULL)
     OR (`asin_id` IS NOT NULL AND `site_snapshot` IS NULL)
     OR (`asin_id` IS NOT NULL AND `brand_snapshot` IS NULL);

  IF v_missing > 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'monitor_history仍有身份快照缺失，拒绝删除外键';
  END IF;
END$$
DELIMITER ;

CALL `_reconcile_main_history`();
DROP PROCEDURE IF EXISTS `_reconcile_main_history`;

SELECT GROUP_CONCAT(
  CONCAT('DROP FOREIGN KEY `', k.`CONSTRAINT_NAME`, '`')
  SEPARATOR ', '
)
INTO @main_history_fk_clauses
FROM information_schema.`KEY_COLUMN_USAGE` k
WHERE k.`CONSTRAINT_SCHEMA` = DATABASE()
  AND k.`TABLE_NAME` = 'monitor_history'
  AND k.`REFERENCED_TABLE_NAME` IN ('variant_groups', 'asins');

SET @main_history_fk_sql = IF(
  @main_history_fk_clauses IS NULL OR @main_history_fk_clauses = '',
  'SELECT ''monitor_history无实体外键'' AS message',
  CONCAT(
    'ALTER TABLE `monitor_history` ',
    @main_history_fk_clauses,
    ', ALGORITHM=INPLACE, LOCK=NONE'
  )
);
PREPARE stmt FROM @main_history_fk_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
