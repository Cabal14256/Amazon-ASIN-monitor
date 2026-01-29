const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const { authenticateToken } = require('../middleware/auth');
const logger = require('../utils/logger');

// 所有路由都需要认证
router.use(authenticateToken);

// 获取仪表盘数据
router.get(
  '/dashboard',
  (req, res, next) => {
    logger.debug('[Dashboard Route] 收到请求:', req.method, req.path);
    next();
  },
  dashboardController.getDashboardData,
);

module.exports = router;
