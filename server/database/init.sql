-- 创建数据库
CREATE DATABASE IF NOT EXISTS `amazon_asin_monitor` 
DEFAULT CHARACTER SET utf8mb4 
COLLATE utf8mb4_unicode_ci;

USE `amazon_asin_monitor`;

-- 变体组表
CREATE TABLE IF NOT EXISTS `variant_groups` (
  `id` VARCHAR(50) PRIMARY KEY COMMENT '变体组ID',
  `name` VARCHAR(255) NOT NULL COMMENT '变体组名称',
  `country` VARCHAR(10) NOT NULL COMMENT '所属国家(US/UK/DE等)',
  `site` VARCHAR(100) NOT NULL COMMENT '站点（内部店铺代号，如"12"）',
  `brand` VARCHAR(100) NOT NULL COMMENT '品牌',
  `is_broken` TINYINT(1) DEFAULT 0 COMMENT '变体状态: 0-正常, 1-异常',
  `variant_status` VARCHAR(20) DEFAULT 'NORMAL' COMMENT '变体状态文本',
  `is_competitor` TINYINT(1) DEFAULT 0 COMMENT '是否竞品: 0-否, 1-是',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `last_check_time` DATETIME DEFAULT NULL COMMENT '监控更新时间（上一次检查的时间）',
  `feishu_notify_enabled` TINYINT(1) DEFAULT 1 COMMENT '飞书通知开关: 0-关闭, 1-开启',
  INDEX `idx_country` (`country`),
  INDEX `idx_site` (`site`),
  INDEX `idx_brand` (`brand`),
  INDEX `idx_is_broken` (`is_broken`),
  INDEX `idx_create_time` (`create_time`),
  INDEX `idx_last_check_time` (`last_check_time`),
  INDEX `idx_feishu_notify_enabled` (`feishu_notify_enabled`),
  INDEX `idx_country_broken` (`country`, `is_broken`),
  INDEX `idx_variant_groups_name` (`name`) COMMENT '变体组名称索引，优化LIKE查询性能'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='变体组表';

-- ASIN表
CREATE TABLE IF NOT EXISTS `asins` (
  `id` VARCHAR(50) PRIMARY KEY COMMENT 'ASIN ID',
  `asin` VARCHAR(20) NOT NULL COMMENT 'ASIN编码',
  `name` VARCHAR(500) COMMENT 'ASIN名称',
  `asin_type` VARCHAR(20) DEFAULT NULL COMMENT 'ASIN类型: MAIN_LINK-主链, SUB_REVIEW-副评',
  `country` VARCHAR(10) NOT NULL COMMENT '所属国家',
  `site` VARCHAR(100) NOT NULL COMMENT '站点（内部店铺代号，如"12"）',
  `brand` VARCHAR(100) NOT NULL COMMENT '品牌',
  `variant_group_id` VARCHAR(50) NOT NULL COMMENT '所属变体组ID',
  `is_broken` TINYINT(1) DEFAULT 0 COMMENT '变体状态: 0-正常, 1-异常',
  `variant_status` VARCHAR(20) DEFAULT 'NORMAL' COMMENT '变体状态文本',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `last_check_time` DATETIME DEFAULT NULL COMMENT '监控更新时间（上一次检查的时间）',
  `feishu_notify_enabled` TINYINT(1) DEFAULT 1 COMMENT '飞书通知开关: 0-关闭, 1-开启',
  INDEX `idx_variant_group_id` (`variant_group_id`),
  INDEX `idx_country` (`country`),
  INDEX `idx_site` (`site`),
  INDEX `idx_brand` (`brand`),
  INDEX `idx_asin` (`asin`),
  INDEX `idx_asin_type` (`asin_type`),
  INDEX `idx_is_broken` (`is_broken`),
  INDEX `idx_last_check_time` (`last_check_time`),
  INDEX `idx_feishu_notify_enabled` (`feishu_notify_enabled`),
  INDEX `idx_variant_group_country_broken` (`variant_group_id`, `country`, `is_broken`),
  UNIQUE INDEX `uk_asin_country` (`asin`, `country`) COMMENT 'ASIN和国家复合唯一索引，允许同一ASIN在不同国家存在',
  FOREIGN KEY (`variant_group_id`) REFERENCES `variant_groups`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='ASIN表';

-- 监控历史表
CREATE TABLE IF NOT EXISTS `monitor_history` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '历史记录ID',
  `variant_group_id` VARCHAR(50) COMMENT '变体组ID',
  `variant_group_name` VARCHAR(255) COMMENT '变体组名称快照（记录时的变体组名称）',
  `asin_id` VARCHAR(50) COMMENT 'ASIN ID',
  `asin_code` VARCHAR(20) COMMENT 'ASIN编码快照（记录时的ASIN编码）',
  `asin_name` VARCHAR(500) COMMENT 'ASIN名称快照（记录时的ASIN名称）',
  `check_type` VARCHAR(20) DEFAULT 'GROUP' COMMENT '检查类型: GROUP-变体组, ASIN-单个ASIN',
  `country` VARCHAR(10) NOT NULL COMMENT '国家',
  `is_broken` TINYINT(1) DEFAULT 0 COMMENT '检查结果: 0-正常, 1-异常',
  `check_time` DATETIME NOT NULL COMMENT '检查时间',
  `check_result` TEXT COMMENT '检查结果详情(JSON格式)',
  `notification_sent` TINYINT(1) DEFAULT 0 COMMENT '是否已发送通知: 0-否, 1-是',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  INDEX `idx_variant_group_id` (`variant_group_id`),
  INDEX `idx_asin_id` (`asin_id`),
  INDEX `idx_asin_code` (`asin_code`),
  INDEX `idx_check_time` (`check_time`),
  INDEX `idx_country` (`country`),
  INDEX `idx_country_check_time` (`country`, `check_time`),
  INDEX `idx_variant_group_check_time_broken` (`variant_group_id`, `check_time`, `is_broken`),
  INDEX `idx_country_check_time_broken` (`country`, `check_time`, `is_broken`),
  INDEX `idx_check_time_country_broken` (`check_time`, `country`, `is_broken`),
  INDEX `idx_asin_code_country_check_time` (`asin_code`, `country`, `check_time`),
  INDEX `idx_country_time_broken_asin` (`country`, `check_time`, `is_broken`, `asin_id`),
  INDEX `idx_asin_country_check_time_broken` (`asin_id`, `country`, `check_time`, `is_broken`) COMMENT '状态变化查询优化索引，优化窗口函数查询性能',
  FOREIGN KEY (`variant_group_id`) REFERENCES `variant_groups`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`asin_id`) REFERENCES `asins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='监控历史表';

-- 监控历史聚合表（用于数据分析加速）
CREATE TABLE IF NOT EXISTS `monitor_history_agg` (
  `granularity` ENUM('hour','day') NOT NULL COMMENT '时间粒度',
  `time_slot` DATETIME NOT NULL COMMENT '时间槽（按小时或按天对齐）',
  `country` VARCHAR(10) NOT NULL COMMENT '国家',
  `asin_key` VARCHAR(50) NOT NULL COMMENT 'ASIN主键（asin_id或asin_code）',
  `check_count` INT NOT NULL COMMENT '检查次数',
  `broken_count` INT NOT NULL COMMENT '异常次数',
  `has_broken` TINYINT(1) NOT NULL COMMENT '是否存在异常',
  `has_peak` TINYINT(1) NOT NULL COMMENT '是否包含高峰期检查',
  `first_check_time` DATETIME NOT NULL COMMENT '该时间槽内最早检查时间',
  `last_check_time` DATETIME NOT NULL COMMENT '该时间槽内最晚检查时间',
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`granularity`, `time_slot`, `country`, `asin_key`),
  INDEX `idx_time_slot` (`time_slot`),
  INDEX `idx_country_time_slot` (`country`, `time_slot`),
  INDEX `idx_granularity_time_slot` (`granularity`, `time_slot`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='监控历史聚合表（按时间槽/国家/ASIN）';

-- 飞书通知配置表（按区域配置：US和EU）
CREATE TABLE IF NOT EXISTS `feishu_config` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `country` VARCHAR(10) NOT NULL UNIQUE COMMENT '区域代码（US或EU）',
  `webhook_url` VARCHAR(500) NOT NULL COMMENT '飞书Webhook URL',
  `enabled` TINYINT(1) DEFAULT 1 COMMENT '是否启用: 0-否, 1-是',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='飞书通知配置表';

-- SP-API配置表
CREATE TABLE IF NOT EXISTS `sp_api_config` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `config_key` VARCHAR(50) NOT NULL UNIQUE COMMENT '配置键',
  `config_value` TEXT COMMENT '配置值（加密存储）',
  `description` VARCHAR(255) COMMENT '配置说明',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_config_key` (`config_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='SP-API配置表';

-- 用户表
CREATE TABLE IF NOT EXISTS `users` (
  `id` VARCHAR(50) PRIMARY KEY COMMENT '用户ID',
  `username` VARCHAR(50) NOT NULL UNIQUE COMMENT '用户名',
  `password` VARCHAR(255) NOT NULL COMMENT '密码（加密存储）',
  `real_name` VARCHAR(100) COMMENT '真实姓名',
  `status` TINYINT(1) DEFAULT 1 COMMENT '状态: 0-禁用, 1-启用',
  `last_login_time` DATETIME COMMENT '最后登录时间',
  `last_login_ip` VARCHAR(50) COMMENT '最后登录IP',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  INDEX `idx_username` (`username`),
  INDEX `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户表';

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

-- 角色表
CREATE TABLE IF NOT EXISTS `roles` (
  `id` VARCHAR(50) PRIMARY KEY COMMENT '角色ID',
  `code` VARCHAR(50) NOT NULL UNIQUE COMMENT '角色代码（READONLY/EDITOR/ADMIN）',
  `name` VARCHAR(100) NOT NULL COMMENT '角色名称',
  `description` VARCHAR(255) COMMENT '角色描述',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  INDEX `idx_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='角色表';

-- 权限表
CREATE TABLE IF NOT EXISTS `permissions` (
  `id` VARCHAR(50) PRIMARY KEY COMMENT '权限ID',
  `code` VARCHAR(50) NOT NULL UNIQUE COMMENT '权限代码',
  `name` VARCHAR(100) NOT NULL COMMENT '权限名称',
  `resource` VARCHAR(100) COMMENT '资源（如：asin, monitor, settings）',
  `action` VARCHAR(50) COMMENT '操作（如：read, write, delete）',
  `description` VARCHAR(255) COMMENT '权限描述',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  INDEX `idx_code` (`code`),
  INDEX `idx_resource` (`resource`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='权限表';

-- 用户角色关联表
CREATE TABLE IF NOT EXISTS `user_roles` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `user_id` VARCHAR(50) NOT NULL COMMENT '用户ID',
  `role_id` VARCHAR(50) NOT NULL COMMENT '角色ID',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  UNIQUE KEY `uk_user_role` (`user_id`, `role_id`),
  INDEX `idx_user_id` (`user_id`),
  INDEX `idx_role_id` (`role_id`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户角色关联表';

-- 角色权限关联表
CREATE TABLE IF NOT EXISTS `role_permissions` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `role_id` VARCHAR(50) NOT NULL COMMENT '角色ID',
  `permission_id` VARCHAR(50) NOT NULL COMMENT '权限ID',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  UNIQUE KEY `uk_role_permission` (`role_id`, `permission_id`),
  INDEX `idx_role_id` (`role_id`),
  INDEX `idx_permission_id` (`permission_id`),
  FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='角色权限关联表';

-- 操作审计日志表
CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '日志ID',
  `user_id` VARCHAR(50) COMMENT '用户ID',
  `username` VARCHAR(50) COMMENT '用户名',
  `action` VARCHAR(50) NOT NULL COMMENT '操作类型（如：CREATE, UPDATE, DELETE, LOGIN, LOGOUT, EXPORT等）',
  `resource` VARCHAR(100) COMMENT '资源类型（如：variant_group, asin, user, settings等）',
  `resource_id` VARCHAR(50) COMMENT '资源ID',
  `resource_name` VARCHAR(255) COMMENT '资源名称（便于查看）',
  `method` VARCHAR(10) COMMENT 'HTTP方法（GET, POST, PUT, DELETE等）',
  `path` VARCHAR(500) COMMENT '请求路径',
  `ip_address` VARCHAR(50) COMMENT 'IP地址',
  `user_agent` VARCHAR(500) COMMENT '用户代理',
  `request_data` TEXT COMMENT '请求数据（JSON格式）',
  `response_status` INT COMMENT '响应状态码',
  `error_message` TEXT COMMENT '错误信息（如果有）',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  INDEX `idx_user_id` (`user_id`),
  INDEX `idx_username` (`username`),
  INDEX `idx_action` (`action`),
  INDEX `idx_resource` (`resource`),
  INDEX `idx_create_time` (`create_time`),
  INDEX `idx_resource_id` (`resource_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='操作审计日志表';

-- 插入默认角色
INSERT INTO `roles` (`id`, `code`, `name`, `description`) VALUES
('role-001', 'READONLY', '只读用户', '只能查看数据，不能修改'),
('role-002', 'EDITOR', '编辑用户', '可以查看和修改数据，但不能管理系统设置'),
('role-003', 'ADMIN', '管理员', '拥有所有权限，包括系统设置')
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `description` = VALUES(`description`);

-- 插入默认权限
INSERT INTO `permissions` (`id`, `code`, `name`, `resource`, `action`, `description`) VALUES
-- ASIN 管理权限
('perm-001', 'asin:read', '查看ASIN', 'asin', 'read', '查看ASIN列表和详情'),
('perm-002', 'asin:write', '编辑ASIN', 'asin', 'write', '创建、修改、删除ASIN'),
-- 监控历史权限
('perm-003', 'monitor:read', '查看监控历史', 'monitor', 'read', '查看监控历史记录'),
-- 数据分析权限
('perm-004', 'analytics:read', '查看数据分析', 'analytics', 'read', '查看数据分析报表'),
-- 系统设置权限
('perm-005', 'settings:read', '查看系统设置', 'settings', 'read', '查看系统配置'),
('perm-006', 'settings:write', '修改系统设置', 'settings', 'write', '修改系统配置'),
-- 用户管理权限
('perm-007', 'user:read', '查看用户', 'user', 'read', '查看用户列表'),
('perm-008', 'user:write', '管理用户', 'user', 'write', '创建、修改、删除用户')
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `description` = VALUES(`description`);

-- 分配角色权限
-- 只读用户：只能查看
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES
('role-001', 'perm-001'), -- asin:read
('role-001', 'perm-003'), -- monitor:read
('role-001', 'perm-004') -- analytics:read
ON DUPLICATE KEY UPDATE `role_id` = VALUES(`role_id`);

-- 编辑用户：查看和编辑ASIN，但不能管理系统设置
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES
('role-002', 'perm-001'), -- asin:read
('role-002', 'perm-002'), -- asin:write
('role-002', 'perm-003'), -- monitor:read
('role-002', 'perm-004') -- analytics:read
ON DUPLICATE KEY UPDATE `role_id` = VALUES(`role_id`);

-- 管理员：所有权限
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES
('role-003', 'perm-001'), -- asin:read
('role-003', 'perm-002'), -- asin:write
('role-003', 'perm-003'), -- monitor:read
('role-003', 'perm-004'), -- analytics:read
('role-003', 'perm-005'), -- settings:read
('role-003', 'perm-006'), -- settings:write
('role-003', 'perm-007'), -- user:read
('role-003', 'perm-008') -- user:write
ON DUPLICATE KEY UPDATE `role_id` = VALUES(`role_id`);

