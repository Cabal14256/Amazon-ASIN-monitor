const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authenticateToken, checkPermission } = require('../middleware/auth');

// 所有路由都需要认证
router.use(authenticateToken);

// 获取用户列表（需要 user:read 权限）
router.get('/users', checkPermission('user:read'), userController.getUserList);

// 获取所有角色（用于下拉选择，需要 user:read 权限）
router.get(
  '/users/roles/all',
  checkPermission('user:read'),
  userController.getAllRoles,
);

// 获取用户详情（需要 user:read 权限）
router.get(
  '/users/:userId',
  checkPermission('user:read'),
  userController.getUserDetail,
);

// 创建用户（需要 user:write 权限）
router.post('/users', checkPermission('user:write'), userController.createUser);

// 更新用户（需要 user:write 权限）
router.put(
  '/users/:userId',
  checkPermission('user:write'),
  userController.updateUser,
);

// 删除用户（需要 user:write 权限）
router.delete(
  '/users/:userId',
  checkPermission('user:write'),
  userController.deleteUser,
);

// 修改用户密码（需要 user:write 权限）
router.put(
  '/users/:userId/password',
  checkPermission('user:write'),
  userController.updateUserPassword,
);

module.exports = router;
