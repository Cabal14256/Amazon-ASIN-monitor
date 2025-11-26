const jwt = require('jsonwebtoken');
const { secret } = require('../config/jwt');
const User = require('../models/User');
const Session = require('../models/Session');

/**
 * 验证Token中间件
 */
async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      success: false,
      errorMessage: '未提供认证令牌',
      errorCode: 401,
    });
  }

  try {
    const decoded = jwt.verify(token, secret);
    const sessionId = decoded.sessionId;
    const session = sessionId ? await Session.findById(sessionId) : null;
    if (!session) {
      return res.status(401).json({
        success: false,
        errorMessage: '会话不存在或已过期',
        errorCode: 401,
      });
    }
    if (session.user_id !== decoded.userId || session.status !== 'ACTIVE') {
      return res.status(403).json({
        success: false,
        errorMessage: '会话已失效',
        errorCode: 403,
      });
    }
    await Session.touch(sessionId);
    const user = await User.findByIdWithPassword(decoded.userId);

    if (!user) {
      return res.status(401).json({
        success: false,
        errorMessage: '用户不存在',
        errorCode: 401,
      });
    }

    if (user.status !== 1) {
      return res.status(403).json({
        success: false,
        errorMessage: '用户已被禁用',
        errorCode: 403,
      });
    }

    req.user = user;
    req.userId = user.id;
    req.sessionId = sessionId;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        errorMessage: '认证令牌已过期',
        errorCode: 401,
      });
    }

    return res.status(403).json({
      success: false,
      errorMessage: '无效的认证令牌',
      errorCode: 403,
    });
  }
}

/**
 * 权限检查中间件
 * @param {string} permissionCode - 权限代码
 */
function checkPermission(permissionCode) {
  return async (req, res, next) => {
    try {
      if (!req.userId) {
        console.log('[checkPermission] 未认证', { permissionCode });
        return res.status(401).json({
          success: false,
          errorMessage: '未认证',
          errorCode: 401,
        });
      }

      const hasPermission = await User.hasPermission(
        req.userId,
        permissionCode,
      );

      console.log('[checkPermission] 权限检查结果', {
        userId: req.userId,
        permissionCode,
        hasPermission,
      });

      if (!hasPermission) {
        console.log('[checkPermission] 权限不足', {
          userId: req.userId,
          permissionCode,
        });
        return res.status(403).json({
          success: false,
          errorMessage: '没有权限执行此操作',
          errorCode: 403,
        });
      }

      next();
    } catch (error) {
      console.error('[checkPermission] 权限检查错误:', error);
      return res.status(500).json({
        success: false,
        errorMessage: '权限检查失败',
        errorCode: 500,
      });
    }
  };
}

/**
 * 角色检查中间件
 * @param {string|string[]} roleCodes - 角色代码（单个或数组）
 */
function checkRole(roleCodes) {
  const allowedRoles = Array.isArray(roleCodes) ? roleCodes : [roleCodes];

  return async (req, res, next) => {
    try {
      if (!req.userId) {
        return res.status(401).json({
          success: false,
          errorMessage: '未认证',
          errorCode: 401,
        });
      }

      const userRoles = await User.getUserRoles(req.userId);
      const userRoleCodes = userRoles.map((r) => r.code);

      const hasRole = allowedRoles.some((role) => userRoleCodes.includes(role));

      if (!hasRole) {
        return res.status(403).json({
          success: false,
          errorMessage: '没有权限执行此操作',
          errorCode: 403,
        });
      }

      next();
    } catch (error) {
      console.error('角色检查错误:', error);
      return res.status(500).json({
        success: false,
        errorMessage: '角色检查失败',
        errorCode: 500,
      });
    }
  };
}

module.exports = {
  authenticateToken,
  checkPermission,
  checkRole,
};
