-- 目标: amazon_asin_monitor
-- 用途: 清理重复索引，并补齐 canonical 查询索引。
-- 注意: monitor_history 与聚合表可能较大；必须先在恢复出的测试库记录耗时和锁行为。

USE `amazon_asin_monitor`;

DROP PROCEDURE IF EXISTS `_ensure_index`;
DELIMITER $$
CREATE PROCEDURE `_ensure_index`(
  IN p_table VARCHAR(64),
  IN p_index VARCHAR(64),
  IN p_columns TEXT,
  IN p_signature TEXT
)
BEGIN
  DECLARE v_signature TEXT DEFAULT NULL;
  DECLARE v_non_unique INT DEFAULT NULL;

  SELECT GROUP_CONCAT(
           CONCAT(
             COALESCE(s.`COLUMN_NAME`, CONCAT('(', s.`EXPRESSION`, ')')),
             IF(s.`SUB_PART` IS NULL, '', CONCAT('(', s.`SUB_PART`, ')')),
             IF(s.`COLLATION` = 'D', ' DESC', '')
           )
           ORDER BY s.`SEQ_IN_INDEX`
           SEPARATOR ','
         ),
         MIN(s.`NON_UNIQUE`)
  INTO v_signature, v_non_unique
  FROM information_schema.`STATISTICS` s
  WHERE s.`TABLE_SCHEMA` = DATABASE()
    AND s.`TABLE_NAME` = p_table
    AND s.`INDEX_NAME` = p_index;

  IF v_signature IS NULL THEN
    SET @ddl = CONCAT(
      'ALTER TABLE `', p_table, '` ADD INDEX `', p_index, '` ', p_columns,
      ', ALGORITHM=INPLACE, LOCK=NONE'
    );
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  ELSEIF v_non_unique <> 1 OR v_signature <> p_signature THEN
    SET @ddl = CONCAT(
      'ALTER TABLE `', p_table, '` DROP INDEX `', p_index,
      '`, ADD INDEX `', p_index, '` ', p_columns,
      ', ALGORITHM=INPLACE, LOCK=NONE'
    );
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;

-- 修复保留索引后，只有历史索引具有相同签名时才删除它。
DROP PROCEDURE IF EXISTS `_drop_duplicate_index`;
DELIMITER $$
CREATE PROCEDURE `_drop_duplicate_index`(
  IN p_table VARCHAR(64), IN p_index VARCHAR(64), IN p_signature TEXT
)
BEGIN
  DECLARE v_signature TEXT DEFAULT NULL;
  DECLARE v_non_unique INT DEFAULT NULL;
  SELECT GROUP_CONCAT(
    CONCAT(COALESCE(s.`COLUMN_NAME`, CONCAT('(', s.`EXPRESSION`, ')')),
      IF(s.`SUB_PART` IS NULL, '', CONCAT('(', s.`SUB_PART`, ')')),
      IF(s.`COLLATION` = 'D', ' DESC', ''))
    ORDER BY s.`SEQ_IN_INDEX` SEPARATOR ','), MIN(s.`NON_UNIQUE`)
  INTO v_signature, v_non_unique
  FROM information_schema.`STATISTICS` s
  WHERE s.`TABLE_SCHEMA` = DATABASE() AND s.`TABLE_NAME` = p_table AND s.`INDEX_NAME` = p_index;
  IF v_signature IS NOT NULL THEN
    IF v_non_unique <> 1 OR v_signature <> p_signature THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Legacy index signature mismatch; manual reconciliation required';
    END IF;
    SET @ddl = CONCAT('ALTER TABLE `', p_table, '` DROP INDEX `', p_index, '`, ALGORITHM=INPLACE, LOCK=NONE');
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;

CALL `_ensure_index`('asins', 'idx_asin', '(`asin`)', 'asin');
CALL `_drop_duplicate_index`('asins', 'idx_asins_asin', 'asin');
CALL `_ensure_index`('asins', 'idx_variant_group_id', '(`variant_group_id`)', 'variant_group_id');
CALL `_drop_duplicate_index`('asins', 'idx_asins_variant_group_id', 'variant_group_id');
CALL `_ensure_index`('monitor_history_agg_variant_group', 'idx_agg_variant_group_time_slot', '(`time_slot`)', 'time_slot');
CALL `_drop_duplicate_index`('monitor_history_agg_variant_group', 'idx_agg_variant_group_slot', 'time_slot');
CALL `_ensure_index`('monitor_history_agg_variant_group', 'idx_agg_variant_group_country_time_slot', '(`country`, `time_slot`)', 'country,time_slot');
CALL `_drop_duplicate_index`('monitor_history_agg_variant_group', 'idx_agg_variant_group_country_slot', 'country,time_slot');
DROP PROCEDURE IF EXISTS `_drop_duplicate_index`;
CALL `_ensure_index`('asins', 'ix_asins_parent_lookup', '(`country`, `parent_asin`)', 'country,parent_asin');
CALL `_ensure_index`('monitor_history', 'idx_month_country_asin', '(`month_ts`, `country`, `asin_id`, `asin_code`, `is_broken`)', 'month_ts,country,asin_id,asin_code,is_broken');
CALL `_ensure_index`('monitor_history', 'idx_check_type_hour_country_asin', '(`check_type`, `hour_ts`, `country`, `asin_id`, `asin_code`, `is_broken`)', 'check_type,hour_ts,country,asin_id,asin_code,is_broken');
CALL `_ensure_index`('monitor_history', 'idx_check_type_day_country_asin', '(`check_type`, `day_ts`, `country`, `asin_id`, `asin_code`, `is_broken`)', 'check_type,day_ts,country,asin_id,asin_code,is_broken');
CALL `_ensure_index`('monitor_history', 'idx_check_type_time_country_asin_broken', '(`check_type`, `check_time`, `country`, `asin_id`, `asin_code`, `is_broken`)', 'check_type,check_time,country,asin_id,asin_code,is_broken');
CALL `_ensure_index`('monitor_history', 'idx_country_check_time_type_asin', '(`country`, `check_time`, `check_type`, `asin_id`, `asin_code`)', 'country,check_time,check_type,asin_id,asin_code');
CALL `_ensure_index`('monitor_history', 'idx_variant_group_time_asin_broken', '(`variant_group_id`, `check_time`, `asin_id`, `asin_code`, `is_broken`)', 'variant_group_id,check_time,asin_id,asin_code,is_broken');
CALL `_ensure_index`('monitor_history_agg', 'idx_agg_covering_query', '(`granularity`, `time_slot`, `country`, `asin_key`, `check_count`, `broken_count`, `has_peak`)', 'granularity,time_slot,country,asin_key,check_count,broken_count,has_peak');
CALL `_ensure_index`('monitor_history_agg_dim', 'idx_agg_dim_covering_query', '(`granularity`, `time_slot`, `country`, `site`, `brand`, `asin_key`, `check_count`, `broken_count`)', 'granularity,time_slot,country,site,brand,asin_key,check_count,broken_count');
CALL `_ensure_index`('users', 'idx_status', '(`status`)', 'status');

DROP PROCEDURE IF EXISTS `_ensure_index`;
