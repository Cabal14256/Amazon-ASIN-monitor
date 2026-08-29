-- 迁移版本: 026
-- 迁移名称: 统一用户状态字段并补齐审计与角色权限
-- 说明:
-- 1. 将 users.status 从旧的 TINYINT 迁移为 ENUM 状态
-- 2. 补齐 audit:read、role:read、role:write 等权限
-- 3. 更新默认角色描述与权限分配

USE `amazon_asin_monitor`;

SET @status_column_type = (
  SELECT DATA_TYPE
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'status'
  LIMIT 1
);

SET @needs_status_copy = IF(@status_column_type = 'enum', 0, 1);

SET @sql = IF(
  @needs_status_copy = 1,
  "ALTER TABLE `users` ADD COLUMN `status_new` ENUM('ACTIVE', 'INACTIVE', 'LOCKED', 'SUSPENDED', 'PENDING') NOT NULL DEFAULT 'ACTIVE' COMMENT '状态: ACTIVE/INACTIVE/LOCKED/SUSPENDED/PENDING'",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  @needs_status_copy = 1,
  "UPDATE `users`
   SET `status_new` = CASE
     WHEN `status` = 1 THEN 'ACTIVE'
     WHEN `status` = 0 THEN 'INACTIVE'
     WHEN UPPER(CAST(`status` AS CHAR)) IN ('ACTIVE', 'INACTIVE', 'LOCKED', 'SUSPENDED', 'PENDING')
       THEN UPPER(CAST(`status` AS CHAR))
     ELSE 'INACTIVE'
   END",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  @needs_status_copy = 1,
  "ALTER TABLE `users` DROP COLUMN `status`",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  @needs_status_copy = 1,
  "ALTER TABLE `users` CHANGE COLUMN `status_new` `status` ENUM('ACTIVE', 'INACTIVE', 'LOCKED', 'SUSPENDED', 'PENDING') NOT NULL DEFAULT 'ACTIVE' COMMENT '状态: ACTIVE/INACTIVE/LOCKED/SUSPENDED/PENDING'",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ALTER TABLE `users`
  MODIFY COLUMN `status` ENUM('ACTIVE', 'INACTIVE', 'LOCKED', 'SUSPENDED', 'PENDING') NOT NULL DEFAULT 'ACTIVE' COMMENT '状态: ACTIVE/INACTIVE/LOCKED/SUSPENDED/PENDING';

UPDATE `users`
SET `status` = 'LOCKED'
WHERE `locked_until` IS NOT NULL
  AND `locked_until` > NOW()
  AND `status` = 'ACTIVE';

UPDATE `users`
SET `status` = 'ACTIVE'
WHERE `status` = 'LOCKED'
  AND (`locked_until` IS NULL OR `locked_until` <= NOW());

INSERT INTO `permissions` (`id`, `code`, `name`, `resource`, `action`, `description`) VALUES
('perm-009', 'asin:delete', '删除ASIN', 'asin', 'delete', '删除ASIN记录'),
('perm-010', 'monitor:write', '管理监控任务', 'monitor', 'write', '创建和管理监控任务'),
('perm-011', 'user:delete', '删除用户', 'user', 'delete', '删除用户账户'),
('perm-012', 'role:read', '查看角色', 'role', 'read', '查看角色列表和详情'),
('perm-013', 'role:write', '管理角色', 'role', 'write', '创建、修改、删除角色和权限分配'),
('perm-014', 'audit:read', '查看审计日志', 'audit', 'read', '查看操作审计日志')
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `description` = VALUES(`description`),
  `resource` = VALUES(`resource`),
  `action` = VALUES(`action`);

UPDATE `roles`
SET `description` = CASE `code`
  WHEN 'READONLY' THEN '只能查看数据，不能修改'
  WHEN 'EDITOR' THEN '可以查看和修改业务数据与系统设置，但不能管理用户、角色和审计'
  WHEN 'ADMIN' THEN '拥有所有权限，包括用户、角色、审计和系统设置'
  ELSE `description`
END
WHERE `code` IN ('READONLY', 'EDITOR', 'ADMIN');

INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES
('role-002', 'perm-009'),
('role-002', 'perm-010'),
('role-002', 'perm-005'),
('role-002', 'perm-006'),
('role-003', 'perm-009'),
('role-003', 'perm-010'),
('role-003', 'perm-011'),
('role-003', 'perm-012'),
('role-003', 'perm-013'),
('role-003', 'perm-014')
ON DUPLICATE KEY UPDATE `role_id` = VALUES(`role_id`);
