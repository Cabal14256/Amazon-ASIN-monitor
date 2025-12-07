-- 迁移版本: 014
-- 迁移名称: 添加更细粒度的权限
-- 创建时间: 2024-12-XX
-- 说明: 为系统添加更细粒度的权限控制，如删除权限、监控写入权限等

USE `amazon_asin_monitor`;

-- 添加更细粒度的权限
INSERT INTO `permissions` (`id`, `code`, `name`, `resource`, `action`, `description`) VALUES
-- ASIN删除权限
('perm-009', 'asin:delete', '删除ASIN', 'asin', 'delete', '删除ASIN记录'),
-- 监控写入权限
('perm-010', 'monitor:write', '创建监控任务', 'monitor', 'write', '创建和管理监控任务'),
-- 用户删除权限
('perm-011', 'user:delete', '删除用户', 'user', 'delete', '删除用户账户'),
-- 角色管理权限
('perm-012', 'role:read', '查看角色', 'role', 'read', '查看角色列表和详情'),
('perm-013', 'role:write', '管理角色', 'role', 'write', '创建、修改、删除角色和权限分配')
ON DUPLICATE KEY UPDATE 
  `name` = VALUES(`name`), 
  `description` = VALUES(`description`),
  `resource` = VALUES(`resource`),
  `action` = VALUES(`action`);

-- 更新角色权限分配
-- 只读用户：只读权限（不变）
-- 编辑用户：添加删除ASIN、监控写入、系统设置权限
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES
('role-002', 'perm-009'), -- asin:delete
('role-002', 'perm-010'), -- monitor:write
('role-002', 'perm-005'), -- settings:read
('role-002', 'perm-006')  -- settings:write
ON DUPLICATE KEY UPDATE `role_id` = VALUES(`role_id`);

-- 管理员：添加所有新权限
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES
('role-003', 'perm-009'), -- asin:delete
('role-003', 'perm-010'), -- monitor:write
('role-003', 'perm-011'), -- user:delete
('role-003', 'perm-012'), -- role:read
('role-003', 'perm-013')  -- role:write
ON DUPLICATE KEY UPDATE `role_id` = VALUES(`role_id`);

