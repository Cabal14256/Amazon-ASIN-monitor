-- 迁移脚本 006: 添加操作审计日志表
-- 说明: 记录用户的所有操作，用于审计和追踪
-- 执行时间: 2025-11-25

USE `amazon_asin_monitor`;

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

-- 验证创建结果
SELECT '操作审计日志表已成功创建' AS result;

