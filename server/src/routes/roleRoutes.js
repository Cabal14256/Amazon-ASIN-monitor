const express = require('express');
const router = express.Router();
const roleController = require('../controllers/roleController');
const { authenticateToken, checkPermission } = require('../middleware/auth');

// 所有路由都需要认证
router.use(authenticateToken);

// 获取角色列表（需要 role:read 权限）
router.get('/roles', checkPermission('role:read'), roleController.getRoleList);

// 获取角色详情（需要 role:read 权限）
router.get(
  '/roles/:roleId',
  checkPermission('role:read'),
  roleController.getRoleDetail,
);

// 获取权限列表（需要 role:read 权限）
router.get(
  '/permissions',
  checkPermission('role:read'),
  roleController.getPermissionList,
);

// 更新角色权限（需要 role:write 权限）
router.put(
  '/roles/:roleId/permissions',
  checkPermission('role:write'),
  roleController.updateRolePermissions,
);

module.exports = router;
