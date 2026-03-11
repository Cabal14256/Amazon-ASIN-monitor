ALTER TABLE `asins`
ADD COLUMN `manual_excluded_from_group` TINYINT(1) DEFAULT 0 COMMENT '排除父变体人工标记: 0-否, 1-是' AFTER `manual_broken_updated_by`,
ADD COLUMN `manual_excluded_reason` VARCHAR(500) DEFAULT NULL COMMENT '排除父变体人工标记原因' AFTER `manual_excluded_from_group`,
ADD COLUMN `manual_excluded_updated_at` DATETIME DEFAULT NULL COMMENT '排除父变体人工标记更新时间' AFTER `manual_excluded_reason`,
ADD COLUMN `manual_excluded_updated_by` VARCHAR(100) DEFAULT NULL COMMENT '排除父变体人工标记操作人' AFTER `manual_excluded_updated_at`,
ADD INDEX `idx_manual_excluded_from_group` (`manual_excluded_from_group`);
