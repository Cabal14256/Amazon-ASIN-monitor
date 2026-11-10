-- 迁移版本: 013
-- 迁移名称: 添加密码安全和登录安全相关表
-- 创建时间: 2024-12-XX
-- 说明: 为系统添加密码历史、登录尝试记录、用户状态扩展等功能

USE `amazon_asin_monitor`;

-- 密码历史表（存储用户最近5个密码）
CREATE TABLE IF NOT EXISTS `password_history` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '密码历史ID',
  `user_id` VARCHAR(50) NOT NULL COMMENT '用户ID',
  `password_hash` VARCHAR(255) NOT NULL COMMENT '密码哈希值',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  INDEX `idx_user_id` (`user_id`),
  INDEX `idx_user_created` (`user_id`, `created_at`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='密码历史表';

-- 登录尝试记录表
CREATE TABLE IF NOT EXISTS `login_attempts` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '登录尝试ID',
  `username` VARCHAR(50) NOT NULL COMMENT '用户名',
  `ip_address` VARCHAR(64) COMMENT 'IP地址',
  `success` TINYINT(1) NOT NULL COMMENT '是否成功: 0-失败, 1-成功',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  INDEX `idx_username_time` (`username`, `created_at`),
  INDEX `idx_ip_time` (`ip_address`, `created_at`),
  INDEX `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='登录尝试记录表';

-- 用户状态变更历史表
CREATE TABLE IF NOT EXISTS `user_status_history` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '历史记录ID',
  `user_id` VARCHAR(50) NOT NULL COMMENT '用户ID',
  `old_status` VARCHAR(20) COMMENT '旧状态',
  `new_status` VARCHAR(20) NOT NULL COMMENT '新状态',
  `reason` VARCHAR(255) COMMENT '变更原因',
  `changed_by` VARCHAR(50) COMMENT '变更操作人ID',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  INDEX `idx_user_id` (`user_id`),
  INDEX `idx_created_at` (`created_at`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户状态变更历史表';

-- 扩展用户表字段
-- 注意：MySQL不支持ADD COLUMN IF NOT EXISTS，需要先检查字段是否存在
-- 如果字段已存在，这些语句会报错，可以忽略

-- 添加密码过期时间字段
SET @dbname = DATABASE();
SET @tablename = 'users';
SET @columnname = 'password_expires_at';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE
      (TABLE_SCHEMA = @dbname)
      AND (TABLE_NAME = @tablename)
      AND (COLUMN_NAME = @columnname)
  ) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN `', @columnname, '` DATETIME NULL COMMENT ''密码过期时间''')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 添加密码最后修改时间字段
SET @columnname = 'password_changed_at';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE
      (TABLE_SCHEMA = @dbname)
      AND (TABLE_NAME = @tablename)
      AND (COLUMN_NAME = @columnname)
  ) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN `', @columnname, '` DATETIME NULL COMMENT ''密码最后修改时间''')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 添加强制修改密码字段
SET @columnname = 'force_password_change';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE
      (TABLE_SCHEMA = @dbname)
      AND (TABLE_NAME = @tablename)
      AND (COLUMN_NAME = @columnname)
  ) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN `', @columnname, '` TINYINT(1) DEFAULT 0 COMMENT ''是否强制修改密码''')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 添加登录失败次数字段
SET @columnname = 'failed_login_attempts';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE
      (TABLE_SCHEMA = @dbname)
      AND (TABLE_NAME = @tablename)
      AND (COLUMN_NAME = @columnname)
  ) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN `', @columnname, '` INT DEFAULT 0 COMMENT ''登录失败次数''')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 添加账户锁定到期时间字段
SET @columnname = 'locked_until';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE
      (TABLE_SCHEMA = @dbname)
      AND (TABLE_NAME = @tablename)
      AND (COLUMN_NAME = @columnname)
  ) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN `', @columnname, '` DATETIME NULL COMMENT ''账户锁定到期时间''')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 添加最后失败登录时间字段
SET @columnname = 'last_failed_login';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE
      (TABLE_SCHEMA = @dbname)
      AND (TABLE_NAME = @tablename)
      AND (COLUMN_NAME = @columnname)
  ) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN `', @columnname, '` DATETIME NULL COMMENT ''最后失败登录时间''')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 修改用户状态字段为ENUM类型（如果还不是ENUM）
-- 注意：MySQL不支持直接修改为ENUM，需要先检查当前类型
-- 这里使用条件修改，如果已经是ENUM则跳过
-- 如果当前是TINYINT，需要手动执行以下步骤：
-- 1. 备份数据
-- 2. 修改字段类型
-- 3. 更新现有数据

-- 为了安全，我们先检查并添加注释说明
-- 如果status字段是TINYINT(1)，需要执行以下SQL（请根据实际情况调整）：
/*
-- 步骤1: 添加临时列
ALTER TABLE `users` ADD COLUMN `status_new` ENUM('ACTIVE', 'INACTIVE', 'LOCKED', 'SUSPENDED', 'PENDING') DEFAULT 'ACTIVE';

-- 步骤2: 迁移数据（1 -> ACTIVE, 0 -> INACTIVE）
UPDATE `users` SET `status_new` = CASE 
  WHEN `status` = 1 THEN 'ACTIVE'
  WHEN `status` = 0 THEN 'INACTIVE'
  ELSE 'INACTIVE'
END;

-- 步骤3: 删除旧列
ALTER TABLE `users` DROP COLUMN `status`;

-- 步骤4: 重命名新列
ALTER TABLE `users` CHANGE COLUMN `status_new` `status` ENUM('ACTIVE', 'INACTIVE', 'LOCKED', 'SUSPENDED', 'PENDING') DEFAULT 'ACTIVE';
*/

-- 如果status字段已经是ENUM，只需要确保包含所有状态值
-- 这里我们添加一个检查，如果字段不存在这些值，则添加
-- 注意：MySQL不支持直接添加ENUM值，需要ALTER TABLE MODIFY COLUMN

-- 为了向后兼容，我们暂时保持TINYINT类型，但在应用层使用ENUM值
-- 如果将来需要改为ENUM，可以执行上面的注释中的SQL

