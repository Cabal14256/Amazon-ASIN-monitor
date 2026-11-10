-- 迁移版本: 019
-- 迁移名称: 添加自动备份配置表
-- 创建时间: 2025-01-XX
-- 说明: 为系统添加自动备份配置功能

USE `amazon_asin_monitor`;

-- 备份配置表
CREATE TABLE IF NOT EXISTS `backup_config` (
  `id` INT PRIMARY KEY AUTO_INCREMENT,
  `enabled` TINYINT(1) DEFAULT 0 COMMENT '是否启用自动备份',
  `schedule_type` VARCHAR(20) DEFAULT 'daily' COMMENT '备份频率: daily/weekly/monthly',
  `schedule_value` INT DEFAULT NULL COMMENT '周几(1-7, 1=周一)或每月几号(1-31)',
  `backup_time` VARCHAR(10) DEFAULT '02:00' COMMENT '备份时间 HH:mm',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='自动备份配置表';

-- 插入默认配置（禁用状态，如果不存在）
INSERT INTO `backup_config` (`enabled`, `schedule_type`, `backup_time`) 
SELECT 0, 'daily', '02:00'
WHERE NOT EXISTS (SELECT 1 FROM `backup_config` LIMIT 1);

