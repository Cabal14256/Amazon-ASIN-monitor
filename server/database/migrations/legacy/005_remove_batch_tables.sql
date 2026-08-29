-- 迁移脚本 005: 删除批次管理相关表
-- 说明: 批次管理功能已不再需要，删除相关数据库表
-- 执行时间: 2025-11-25
-- 注意: 执行前请备份数据库！

USE `amazon_asin_monitor`;

-- 删除批次变体组关联表（先删除，因为有外键依赖）
DROP TABLE IF EXISTS `batch_variant_groups`;

-- 删除批次表
DROP TABLE IF EXISTS `batches`;

-- 验证删除结果
SELECT '批次表已成功删除' AS result;

