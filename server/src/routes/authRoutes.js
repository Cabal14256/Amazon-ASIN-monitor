const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticateToken } = require('../middleware/auth');

// 用户登录（不需要认证）
router.post('/auth/login', authController.login);

// 获取当前用户信息（需要认证）
router.get('/auth/current-user', authenticateToken, authController.getCurrentUser);

// 用户登出（需要认证）
router.post('/auth/logout', authenticateToken, authController.logout);

module.exports = router;

