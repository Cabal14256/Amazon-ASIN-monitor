-- 目标: 两个 canonical 数据库及其业务表
-- 用途: 统一到 MySQL 8 的 utf8mb4_0900_ai_ci。
-- 注意: 字符集转换可能重建大表；生产当前已符合，本脚本应为 no-op。

ALTER DATABASE `amazon_asin_monitor`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
ALTER DATABASE `amazon_competitor_monitor`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

USE `amazon_asin_monitor`;

DROP TEMPORARY TABLE IF EXISTS `_canonical_tables`;
CREATE TEMPORARY TABLE `_canonical_tables` (
  `schema_name` VARCHAR(64) NOT NULL,
  `table_name` VARCHAR(64) NOT NULL,
  PRIMARY KEY (`schema_name`, `table_name`)
);

INSERT INTO `_canonical_tables` (`schema_name`, `table_name`) VALUES
  ('amazon_asin_monitor', 'variant_groups'),
  ('amazon_asin_monitor', 'asins'),
  ('amazon_asin_monitor', 'monitor_history'),
  ('amazon_asin_monitor', 'monitor_history_agg'),
  ('amazon_asin_monitor', 'monitor_history_agg_dim'),
  ('amazon_asin_monitor', 'monitor_history_agg_variant_group'),
  ('amazon_asin_monitor', 'analytics_refresh_watermark'),
  ('amazon_asin_monitor', 'monitor_history_status_interval'),
  ('amazon_asin_monitor', 'feishu_config'),
  ('amazon_asin_monitor', 'sp_api_config'),
  ('amazon_asin_monitor', 'backup_config'),
  ('amazon_asin_monitor', 'users'),
  ('amazon_asin_monitor', 'password_history'),
  ('amazon_asin_monitor', 'login_attempts'),
  ('amazon_asin_monitor', 'user_status_history'),
  ('amazon_asin_monitor', 'sessions'),
  ('amazon_asin_monitor', 'roles'),
  ('amazon_asin_monitor', 'permissions'),
  ('amazon_asin_monitor', 'user_roles'),
  ('amazon_asin_monitor', 'role_permissions'),
  ('amazon_asin_monitor', 'audit_logs'),
  ('amazon_competitor_monitor', 'competitor_variant_groups'),
  ('amazon_competitor_monitor', 'competitor_asins'),
  ('amazon_competitor_monitor', 'competitor_monitor_history'),
  ('amazon_competitor_monitor', 'competitor_feishu_config');

DROP PROCEDURE IF EXISTS `_normalize_canonical_collation`;
DELIMITER $$
CREATE PROCEDURE `_normalize_canonical_collation`()
BEGIN
  DECLARE done INT DEFAULT 0;
  DECLARE v_schema VARCHAR(64);
  DECLARE v_table VARCHAR(64);
  DECLARE table_cursor CURSOR FOR
    SELECT c.`schema_name`, c.`table_name`
    FROM `_canonical_tables` c
    JOIN information_schema.`TABLES` t
      ON t.`TABLE_SCHEMA` = c.`schema_name`
     AND t.`TABLE_NAME` = c.`table_name`
    WHERE t.`TABLE_COLLATION` <> 'utf8mb4_0900_ai_ci'
       OR EXISTS (
         SELECT 1
         FROM information_schema.`COLUMNS` col
         WHERE col.`TABLE_SCHEMA` = c.`schema_name`
           AND col.`TABLE_NAME` = c.`table_name`
           AND col.`CHARACTER_SET_NAME` IS NOT NULL
           AND (
             col.`CHARACTER_SET_NAME` <> 'utf8mb4'
             OR col.`COLLATION_NAME` <> 'utf8mb4_0900_ai_ci'
           )
       )
    ORDER BY c.`schema_name`, c.`table_name`;
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

  OPEN table_cursor;
  table_loop: LOOP
    FETCH table_cursor INTO v_schema, v_table;
    IF done = 1 THEN
      LEAVE table_loop;
    END IF;

    SET @ddl = CONCAT(
      'ALTER TABLE `', REPLACE(v_schema, '`', '``'), '`.`',
      REPLACE(v_table, '`', '``'),
      '` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci'
    );
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END LOOP;
  CLOSE table_cursor;
END$$
DELIMITER ;

SET @previous_foreign_key_checks = @@SESSION.foreign_key_checks;
SET SESSION foreign_key_checks = 0;
CALL `_normalize_canonical_collation`();
SET SESSION foreign_key_checks = @previous_foreign_key_checks;

DROP PROCEDURE IF EXISTS `_normalize_canonical_collation`;
DROP TEMPORARY TABLE IF EXISTS `_canonical_tables`;
