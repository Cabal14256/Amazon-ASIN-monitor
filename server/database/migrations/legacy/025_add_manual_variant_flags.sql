ALTER TABLE `variant_groups`
ADD COLUMN `manual_broken` TINYINT(1) DEFAULT 0 COMMENT '人工标记异常: 0-否, 1-是' AFTER `variant_status`,
ADD COLUMN `manual_broken_reason` VARCHAR(500) DEFAULT NULL COMMENT '人工标记异常原因' AFTER `manual_broken`,
ADD COLUMN `manual_broken_updated_at` DATETIME DEFAULT NULL COMMENT '人工标记异常更新时间' AFTER `manual_broken_reason`,
ADD COLUMN `manual_broken_updated_by` VARCHAR(100) DEFAULT NULL COMMENT '人工标记异常操作人' AFTER `manual_broken_updated_at`,
ADD INDEX `idx_manual_broken` (`manual_broken`);

ALTER TABLE `asins`
ADD COLUMN `manual_broken` TINYINT(1) DEFAULT 0 COMMENT '人工标记异常: 0-否, 1-是' AFTER `variant_status`,
ADD COLUMN `manual_broken_reason` VARCHAR(500) DEFAULT NULL COMMENT '人工标记异常原因' AFTER `manual_broken`,
ADD COLUMN `manual_broken_updated_at` DATETIME DEFAULT NULL COMMENT '人工标记异常更新时间' AFTER `manual_broken_reason`,
ADD COLUMN `manual_broken_updated_by` VARCHAR(100) DEFAULT NULL COMMENT '人工标记异常操作人' AFTER `manual_broken_updated_at`,
ADD INDEX `idx_manual_broken` (`manual_broken`);
