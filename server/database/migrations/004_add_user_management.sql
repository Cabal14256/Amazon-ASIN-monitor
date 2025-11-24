-- 迁移版本: 004
-- 迁移名称: 添加用户管理和权限系统
-- 创建时间: 2024-11-24
-- 说明: 创建用户、角色、权限相关的表结构

USE `amazon_asin_monitor`;

-- 用户表
CREATE TABLE IF NOT EXISTS `users` (
  `id` VARCHAR(50) PRIMARY KEY COMMENT '用户ID',
  `username` VARCHAR(50) NOT NULL UNIQUE COMMENT '用户名',
  `email` VARCHAR(100) UNIQUE COMMENT '邮箱',
  `password` VARCHAR(255) NOT NULL COMMENT '密码（加密存储）',
  `real_name` VARCHAR(100) COMMENT '真实姓名',
  `status` TINYINT(1) DEFAULT 1 COMMENT '状态: 0-禁用, 1-启用',
  `last_login_time` DATETIME COMMENT '最后登录时间',
  `last_login_ip` VARCHAR(50) COMMENT '最后登录IP',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  INDEX `idx_username` (`username`),
  INDEX `idx_email` (`email`),
  INDEX `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户表';

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
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `resource` = VALUES(`resource`), `action` = VALUES(`action`), `description` = VALUES(`description`);

-- 分配角色权限
-- 只读用户：只能查看
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES
('role-001', 'perm-001'), -- asin:read
('role-001', 'perm-003'), -- monitor:read
('role-001', 'perm-004')  -- analytics:read
ON DUPLICATE KEY UPDATE `role_id` = VALUES(`role_id`);

-- 编辑用户：查看和编辑ASIN，但不能管理系统设置
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES
('role-002', 'perm-001'), -- asin:read
('role-002', 'perm-002'), -- asin:write
('role-002', 'perm-003'), -- monitor:read
('role-002', 'perm-004')  -- analytics:read
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
('role-003', 'perm-008')  -- user:write
ON DUPLICATE KEY UPDATE `role_id` = VALUES(`role_id`);

