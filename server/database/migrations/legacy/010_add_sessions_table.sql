-- 迁移版本: 010
-- 迁移名称: 添加多设备会话记录表
-- 创建时间: 2024-11-XX
-- 说明: 为系统添加多设备登录会话管理功能

USE `amazon_asin_monitor`;

-- 会话表（多设备登录）
CREATE TABLE IF NOT EXISTS `sessions` (
  `id` CHAR(36) NOT NULL,
  `user_id` VARCHAR(50) NOT NULL,
  `user_agent` VARCHAR(255) DEFAULT NULL,
  `ip_address` VARCHAR(64) DEFAULT NULL,
  `status` ENUM('ACTIVE','REVOKED') NOT NULL DEFAULT 'ACTIVE',
  `remember_me` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_active_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  INDEX (`user_id`),
  CONSTRAINT `fk_sessions_user_id`
    FOREIGN KEY (`user_id`)
    REFERENCES `users`(`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='多设备会话表';

