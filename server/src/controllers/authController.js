const { v4: uuidv4 } = require('uuid');
const User = require('../models/User');
const Session = require('../models/Session');
const AuditLog = require('../models/AuditLog');
const { expiresIn, rememberExpiresIn } = require('../config/jwt');
const { withTransaction } = require('../config/database');
const logger = require('../utils/logger');
const websocketService = require('../services/websocketService');
const loginAttemptService = require('../services/loginAttemptService');
const passwordHistoryService = require('../services/passwordHistoryService');
const { setAuthCookies, clearAuthCookies } = require('../utils/authCookie');
const { validatePassword } = require('../utils/passwordValidator');
const { isPasswordExpired } = require('../utils/passwordPolicy');
const {
  getUserStatusErrorMessage,
  isUserActive,
} = require('../utils/userStatus');

const DEFAULT_PASSWORD_EXPIRE_DAYS =
  Number(process.env.PASSWORD_EXPIRE_DAYS) || 90;

/**
 * 用户登录
 */
const durationToMs = (duration) => {
  if (!duration) {
    return null;
  }
  const normalized = duration.trim();
  const match = normalized.match(/^(\d+)(d|h|m|s)?$/i);
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  const unit = (match[2] || 's').toLowerCase();
  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return value * (multipliers[unit] || 1000);
};

function buildPasswordExpiresAt(days = DEFAULT_PASSWORD_EXPIRE_DAYS) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + days);
  return expiresAt;
}

function getAuthResponseData(user, permissions, roles, sessionId, extra = {}) {
  const { password: _, ...userInfo } = user;
  return {
    token: extra.token,
    sessionId,
    user: userInfo,
    permissions,
    roles: roles.map((role) => role.code),
    mustChangePassword: Boolean(extra.mustChangePassword),
    passwordExpired: Boolean(extra.passwordExpired),
  };
}

function createClientIp(req) {
  return (
    req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress
  );
}

async function recordLoginAudit({
  userId = null,
  username,
  clientIp,
  userAgent,
  responseStatus,
  errorMessage = null,
}) {
  setImmediate(async () => {
    try {
      await AuditLog.create({
        userId,
        username,
        action: 'LOGIN',
        resource: 'auth',
        method: 'POST',
        path: '/api/v1/auth/login',
        ipAddress: clientIp,
        userAgent,
        responseStatus,
        errorMessage,
      });
    } catch (error) {
      logger.error('记录登录审计日志失败:', {
        message: error.message,
      });
    }
  });
}

exports.login = async (req, res) => {
  try {
    const { rememberMe = false } = req.body;
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        errorMessage: '用户名和密码不能为空',
        errorCode: 400,
      });
    }

    const user = await User.findByUsername(username);
    const clientIp = createClientIp(req);
    const userAgent = req.headers['user-agent'] || 'unknown';

    if (!user) {
      await loginAttemptService.recordAttempt(username, clientIp, false);
      await recordLoginAudit({
        username,
        clientIp,
        userAgent,
        responseStatus: 401,
        errorMessage: '用户名或密码错误',
      });

      return res.status(401).json({
        success: false,
        errorMessage: '用户名或密码错误',
        errorCode: 401,
      });
    }

    const accountLocked = await loginAttemptService.isAccountLocked(user.id);
    if (accountLocked) {
      const remainingMinutes =
        await loginAttemptService.getLockoutRemainingMinutes(user.id);
      return res.status(423).json({
        success: false,
        errorMessage: `账户已锁定，请 ${remainingMinutes || 0} 分钟后再试`,
        errorCode: 423,
      });
    }

    if (!isUserActive(user.status, user.locked_until)) {
      const errorMessage = getUserStatusErrorMessage(
        user.status,
        user.locked_until,
      );
      await recordLoginAudit({
        userId: user.id,
        username: user.username,
        clientIp,
        userAgent,
        responseStatus: 403,
        errorMessage,
      });

      return res.status(403).json({
        success: false,
        errorMessage,
        errorCode: 403,
      });
    }

    const isValidPassword = await User.verifyPassword(user, password);
    if (!isValidPassword) {
      await loginAttemptService.recordAttempt(username, clientIp, false);
      const shouldLock = await loginAttemptService.incrementFailedAttempts(
        user.id,
      );
      await recordLoginAudit({
        userId: user.id,
        username: user.username,
        clientIp,
        userAgent,
        responseStatus: 401,
        errorMessage: shouldLock
          ? '账户因登录失败次数过多被锁定'
          : '用户名或密码错误',
      });

      return res.status(401).json({
        success: false,
        errorMessage: '用户名或密码错误',
        errorCode: 401,
      });
    }

    const sessionId = uuidv4();
    const tokenExpiresIn = rememberMe ? rememberExpiresIn : expiresIn;
    const token = User.generateToken(user.id, sessionId, tokenExpiresIn);
    const expiresAtMs = durationToMs(tokenExpiresIn);
    const expiresAt = expiresAtMs ? new Date(Date.now() + expiresAtMs) : null;
    const cookieMaxAge = rememberMe ? expiresAtMs : null;
    const passwordExpired = isPasswordExpired(user);

    if (passwordExpired && !user.force_password_change) {
      await User.updatePasswordPolicy(user.id, {
        forcePasswordChange: true,
      });
      user.force_password_change = true;
    }

    const permissions = await User.getUserPermissions(user.id);
    const roles = await User.getUserRoles(user.id);

    await User.updateLoginInfo(user.id, clientIp);
    await loginAttemptService.recordAttempt(username, clientIp, true);
    await loginAttemptService.resetFailedAttempts(user.id);

    await Session.create({
      id: sessionId,
      userId: user.id,
      userAgent,
      ipAddress: clientIp,
      expiresAt,
      rememberMe: !!rememberMe,
    });

    await recordLoginAudit({
      userId: user.id,
      username: user.username,
      clientIp,
      userAgent,
      responseStatus: 200,
    });

    setAuthCookies(res, req, token, cookieMaxAge);

    res.json({
      success: true,
      data: getAuthResponseData(user, permissions, roles, sessionId, {
        token,
        mustChangePassword: user.force_password_change || passwordExpired,
        passwordExpired,
      }),
      errorCode: 0,
    });
  } catch (error) {
    logger.error('登录错误:', {
      message: error.message,
    });
    res.status(500).json({
      success: false,
      errorMessage: error.message || '登录失败',
      errorCode: 500,
    });
  }
};

/**
 * 获取当前用户信息
 */
exports.getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        errorMessage: '用户不存在',
        errorCode: 404,
      });
    }

    const passwordExpired = isPasswordExpired(user);
    if (passwordExpired && !user.force_password_change) {
      await User.updatePasswordPolicy(req.userId, {
        forcePasswordChange: true,
      });
      user.force_password_change = true;
    }

    const permissions = await User.getUserPermissions(req.userId);
    const roles = await User.getUserRoles(req.userId);

    res.json({
      success: true,
      data: {
        user,
        permissions,
        roles: roles.map((r) => r.code),
        sessionId: req.sessionId,
        mustChangePassword: Boolean(
          user.force_password_change || passwordExpired,
        ),
        passwordExpired,
      },
      errorCode: 0,
    });
  } catch (error) {
    logger.error('获取用户信息错误:', {
      message: error.message,
    });
    res.status(500).json({
      success: false,
      errorMessage: error.message || '获取用户信息失败',
      errorCode: 500,
    });
  }
};

/**
 * 用户登出（前端清除Token即可）
 */
exports.logout = async (req, res) => {
  try {
    if (req.sessionId) {
      await Session.revoke(req.sessionId, req.userId);
      websocketService.disconnectSession(req.sessionId, '会话已登出');
    }
    clearAuthCookies(res, req);
    res.json({
      success: true,
      message: '登出成功',
      errorCode: 0,
    });
  } catch (error) {
    logger.error('登出失败:', {
      message: error.message,
    });
    res.status(500).json({
      success: false,
      errorMessage: '登出失败',
      errorCode: 500,
    });
  }
};

exports.listSessions = async (req, res) => {
  try {
    const sessions = await Session.findByUserId(req.userId);
    res.json({
      success: true,
      data: sessions,
      errorCode: 0,
    });
  } catch (error) {
    logger.error('获取会话列表失败:', {
      message: error.message,
    });
    res.status(500).json({
      success: false,
      errorMessage: '获取会话列表失败',
      errorCode: 500,
    });
  }
};

exports.revokeSession = async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        errorMessage: '缺少 sessionId',
        errorCode: 400,
      });
    }
    const revoked = await Session.revoke(sessionId, req.userId);
    if (!revoked) {
      return res.status(404).json({
        success: false,
        errorMessage: '会话不存在或已被拒绝',
        errorCode: 404,
      });
    }
    websocketService.disconnectSession(sessionId, '会话已被移除');
    res.json({
      success: true,
      message: '已踢出会话',
      errorCode: 0,
    });
  } catch (error) {
    logger.error('踢出会话失败:', {
      message: error.message,
    });
    res.status(500).json({
      success: false,
      errorMessage: '踢出会话失败',
      errorCode: 500,
    });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword, revokeOtherSessions = true } = req.body;
    const userId = req.userId;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        errorMessage: '原密码和新密码不能为空',
        errorCode: 400,
      });
    }

    await withTransaction(async ({ query: transactionQuery }) => {
      const user = await User.findByIdWithPassword(userId, {
        queryExecutor: transactionQuery,
      });

      if (!user) {
        const error = new Error('用户不存在');
        error.statusCode = 404;
        throw error;
      }

      const validationResult = validatePassword(newPassword, user.username);
      if (!validationResult.valid) {
        const error = new Error(validationResult.errors.join('；'));
        error.statusCode = 400;
        throw error;
      }

      const isValidPassword = await User.verifyPassword(user, oldPassword);
      if (!isValidPassword) {
        const error = new Error('原密码错误');
        error.statusCode = 400;
        throw error;
      }

      const isSameAsCurrent = await User.verifyPassword(user, newPassword);
      if (isSameAsCurrent) {
        const error = new Error('新密码不能与当前密码相同');
        error.statusCode = 400;
        throw error;
      }

      const isPasswordReused =
        await passwordHistoryService.checkPasswordHistoryWithOptions(
          userId,
          newPassword,
          {
            queryExecutor: transactionQuery,
          },
        );
      if (isPasswordReused) {
        const error = new Error(
          `新密码不能与最近 ${passwordHistoryService.MAX_PASSWORD_HISTORY} 次使用过的密码相同`,
        );
        error.statusCode = 400;
        throw error;
      }

      await passwordHistoryService.savePasswordHistoryWithOptions(
        userId,
        user.password,
        {
          queryExecutor: transactionQuery,
        },
      );

      await User.updatePassword(userId, newPassword, {
        queryExecutor: transactionQuery,
        forcePasswordChange: false,
        passwordExpiresAt: buildPasswordExpiresAt(),
      });

      if (revokeOtherSessions) {
        await Session.revokeAll(userId, {
          queryExecutor: transactionQuery,
          excludeSessionId: req.sessionId,
        });
      }
    });

    if (revokeOtherSessions) {
      websocketService.disconnectUserSessions(userId, {
        excludeSessionId: req.sessionId,
        reason: '密码已修改，请重新登录',
      });
    }

    res.json({
      success: true,
      message: revokeOtherSessions
        ? '密码修改成功，其他会话已下线'
        : '密码修改成功',
      errorCode: 0,
    });
  } catch (error) {
    logger.error('修改密码错误:', {
      message: error.message,
      userId: req.userId,
    });
    res.status(error.statusCode || 500).json({
      success: false,
      errorMessage: error.message || '修改密码失败',
      errorCode: error.statusCode || 500,
    });
  }
};

/**
 * 更新当前用户信息
 */
exports.updateProfile = async (req, res) => {
  try {
    const userId = req.userId;
    const { real_name } = req.body;

    const updateData = {};
    if (real_name !== undefined) updateData.real_name = real_name;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        errorMessage: '没有要更新的字段',
        errorCode: 400,
      });
    }

    await User.update(userId, updateData);

    const updatedUser = await User.findById(userId);
    const permissions = await User.getUserPermissions(userId);
    const roles = await User.getUserRoles(userId);

    res.json({
      success: true,
      data: {
        user: updatedUser,
        permissions,
        roles: roles.map((r) => r.code),
      },
      errorCode: 0,
    });
  } catch (error) {
    logger.error('更新用户信息错误:', {
      message: error.message,
      userId: req.userId,
    });
    res.status(500).json({
      success: false,
      errorMessage: error.message || '更新用户信息失败',
      errorCode: 500,
    });
  }
};
