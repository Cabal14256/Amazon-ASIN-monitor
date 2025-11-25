const express = require('express');
const router = express.Router();
const roleController = require('../controllers/roleController');
const { authenticateToken, checkPermission } = require('../middleware/auth');

// 所有路由都需要认证
router.use(authenticateToken);

// 获取角色列表（需要 user:read 权限）
router.get('/roles', checkPermission('user:read'), roleController.getRoleList);

// 获取角色详情（需要 user:read 权限）
router.get(
  '/roles/:roleId',
  checkPermission('user:read'),
  roleController.getRoleDetail,
);

// 获取权限列表（需要 user:read 权限）
router.get(
  '/permissions',
  checkPermission('user:read'),
  roleController.getPermissionList,
);

module.exports = router;
