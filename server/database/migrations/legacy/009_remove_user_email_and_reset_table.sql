-- 迁移脚本 009: 移除用户表邮箱列与密码重置表
-- 说明: 取消邮箱字段与相关功能，简化用户模型
-- 执行时间: 2025-11-26

USE `amazon_asin_monitor`;

ALTER TABLE `users`
DROP COLUMN `email`;

DROP TABLE IF EXISTS `password_reset_tokens`;

SELECT '完成移除邮箱字段与密码重置表' AS result;

