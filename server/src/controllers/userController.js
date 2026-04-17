const User = require('../models/User');
const Role = require('../models/Role');
const Session = require('../models/Session');
const { withTransaction } = require('../config/database');
const logger = require('../utils/logger');
const permissionCacheService = require('../services/permissionCacheService');
const passwordHistoryService = require('../services/passwordHistoryService');
const userStatusService = require('../services/userStatusService');
const websocketService = require('../services/websocketService');
const { validatePassword } = require('../utils/passwordValidator');
const { USER_STATUS, normalizeUserStatus } = require('../utils/userStatus');

const DEFAULT_PASSWORD_EXPIRE_DAYS =
  Number(process.env.PASSWORD_EXPIRE_DAYS) || 90;

function buildPasswordExpiresAt(days = DEFAULT_PASSWORD_EXPIRE_DAYS) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + days);
  return expiresAt;
}

async function getValidatedRoles(roleIds, queryExecutor) {
  const uniqueRoleIds = [...new Set((roleIds || []).filter(Boolean))];
  if (!uniqueRoleIds.length) {
    return [];
  }

  const roles = await Role.findByIds(uniqueRoleIds, {
    queryExecutor,
  });
  if (roles.length !== uniqueRoleIds.length) {
    const error = new Error('包含无效角色ID');
    error.statusCode = 400;
    throw error;
  }
  return roles;
}

async function ensureAdminGuard({
  targetUserId,
  currentUser,
  nextStatus,
  nextRoles,
  operatorUserId,
  queryExecutor,
}) {
  const currentRoles = await User.getUserRoles(targetUserId, {
    queryExecutor,
  });
  const currentHasAdmin = currentRoles.some((role) => role.code === 'ADMIN');
  const nextHasAdmin = nextRoles.some((role) => role.code === 'ADMIN');
  const currentStatus = normalizeUserStatus(currentUser.status);
  const targetStatus = normalizeUserStatus(nextStatus);

  if (operatorUserId === targetUserId && currentHasAdmin && !nextHasAdmin) {
    const error = new Error('不能移除自己当前账户的管理员角色');
    error.statusCode = 400;
    throw error;
  }

  if (operatorUserId === targetUserId && targetStatus !== USER_STATUS.ACTIVE) {
    const error = new Error('不能禁用、锁定或停用自己的账户');
    error.statusCode = 400;
    throw error;
  }

  const willLoseActiveAdmin =
    currentHasAdmin &&
    currentStatus === USER_STATUS.ACTIVE &&
    (targetStatus !== USER_STATUS.ACTIVE || !nextHasAdmin);

  if (willLoseActiveAdmin) {
    const otherActiveAdmins = await User.countUsersByRoleCode('ADMIN', {
      activeOnly: true,
      excludeUserId: targetUserId,
      queryExecutor,
    });

    if (otherActiveAdmins === 0) {
      const error = new Error('系统至少需要保留一个启用中的管理员账户');
      error.statusCode = 400;
      throw error;
    }
  }
}

/**
 * 获取用户列表
 */
exports.getUserList = async (req, res) => {
  try {
    logger.debug('[getUserList] 开始获取用户列表', {
      query: req.query,
      userId: req.userId,
    });
    const { username, status, current = 1, pageSize = 10 } = req.query;

    const result = await User.findAll({
      username,
      status,
      current: Number(current),
      pageSize: Number(pageSize),
    });
    logger.debug('[getUserList] 查询结果:', {
      total: result.total,
      listLength: result.list.length,
    });

    const usersWithRoles = await Promise.all(
      result.list.map(async (user) => {
        const roles = await User.getUserRoles(user.id);
        return {
          ...user,
          roles: roles.map((r) => ({ id: r.id, code: r.code, name: r.name })),
        };
      }),
    );

    res.json({
      success: true,
      data: {
        list: usersWithRoles,
        total: result.total,
      },
      errorCode: 0,
    });
  } catch (error) {
    logger.error('获取用户列表错误:', {
      message: error.message,
      userId: req.userId,
    });
    res.status(500).json({
      success: false,
      errorMessage: error.message || '获取用户列表失败',
      errorCode: 500,
    });
  }
};

/**
 * 获取用户详情
 */
exports.getUserDetail = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        errorMessage: '用户不存在',
        errorCode: 404,
      });
    }

    const roles = await User.getUserRoles(userId);
    const permissions = await User.getUserPermissions(userId);
    const statusHistory = await userStatusService.getStatusHistory(userId, 10);

    res.json({
      success: true,
      data: {
        ...user,
        roles: roles.map((r) => ({ id: r.id, code: r.code, name: r.name })),
        permissions,
        statusHistory,
      },
      errorCode: 0,
    });
  } catch (error) {
    logger.error('获取用户详情错误:', {
      message: error.message,
      targetUserId: req.params?.userId,
    });
    res.status(500).json({
      success: false,
      errorMessage: error.message || '获取用户详情失败',
      errorCode: 500,
    });
  }
};

/**
 * 创建用户
 */
exports.createUser = async (req, res) => {
  try {
    const {
      username,
      password,
      real_name,
      roleIds,
      forcePasswordChange = true,
    } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        errorMessage: '用户名和密码不能为空',
        errorCode: 400,
      });
    }

    if (!Array.isArray(roleIds) || roleIds.length === 0) {
      return res.status(400).json({
        success: false,
        errorMessage: '请至少选择一个角色',
        errorCode: 400,
      });
    }

    const passwordValidation = validatePassword(password, username);
    if (!passwordValidation.valid) {
      return res.status(400).json({
        success: false,
        errorMessage: passwordValidation.errors.join('；'),
        errorCode: 400,
      });
    }

    const user = await withTransaction(async ({ query: transactionQuery }) => {
      const existingUser = await User.findByUsername(username, {
        queryExecutor: transactionQuery,
      });
      if (existingUser) {
        const error = new Error('用户名已存在');
        error.statusCode = 400;
        throw error;
      }

      await getValidatedRoles(roleIds, transactionQuery);

      const createdUser = await User.create(
        {
          username,
          password,
          real_name,
          status: USER_STATUS.ACTIVE,
          forcePasswordChange,
          passwordExpiresAt: buildPasswordExpiresAt(),
        },
        {
          queryExecutor: transactionQuery,
        },
      );

      await User.updateRoles(createdUser.id, roleIds, {
        queryExecutor: transactionQuery,
      });

      return createdUser;
    });

    const roles = await User.getUserRoles(user.id);

    res.json({
      success: true,
      data: {
        ...user,
        roles: roles.map((r) => ({ id: r.id, code: r.code, name: r.name })),
      },
      errorCode: 0,
    });
  } catch (error) {
    logger.error('创建用户错误:', {
      message: error.message,
      operatorUserId: req.userId,
    });
    res.status(error.statusCode || 500).json({
      success: false,
      errorMessage: error.message || '创建用户失败',
      errorCode: error.statusCode || 500,
    });
  }
};

/**
 * 更新用户
 */
exports.updateUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { real_name, status, roleIds, statusReason } = req.body;

    const { updatedUser, statusChangeResult } = await withTransaction(
      async ({ query: transactionQuery }) => {
        const user = await User.findById(userId, {
          queryExecutor: transactionQuery,
        });
        if (!user) {
          const error = new Error('用户不存在');
          error.statusCode = 404;
          throw error;
        }

        const nextRoles =
          roleIds !== undefined
            ? await getValidatedRoles(roleIds, transactionQuery)
            : await User.getUserRoles(userId, {
                queryExecutor: transactionQuery,
              });

        if (roleIds !== undefined && nextRoles.length === 0) {
          const error = new Error('请至少保留一个角色');
          error.statusCode = 400;
          throw error;
        }

        const nextStatus =
          status !== undefined ? normalizeUserStatus(status) : user.status;

        await ensureAdminGuard({
          targetUserId: userId,
          currentUser: user,
          nextStatus,
          nextRoles,
          operatorUserId: req.userId,
          queryExecutor: transactionQuery,
        });

        const updateData = {};
        if (real_name !== undefined) updateData.real_name = real_name;

        if (Object.keys(updateData).length > 0) {
          await User.update(userId, updateData, {
            queryExecutor: transactionQuery,
          });
        }

        let statusChangeResult = {
          changed: false,
          newStatus: normalizeUserStatus(user.status),
        };
        if (
          status !== undefined &&
          normalizeUserStatus(user.status) !== nextStatus
        ) {
          statusChangeResult = await userStatusService.changeStatus(
            userId,
            nextStatus,
            statusReason || null,
            req.userId,
            {
              queryExecutor: transactionQuery,
            },
          );
        }

        if (roleIds !== undefined) {
          await User.updateRoles(userId, roleIds, {
            queryExecutor: transactionQuery,
          });
        }

        return {
          updatedUser: await User.findById(userId, {
            queryExecutor: transactionQuery,
          }),
          statusChangeResult,
        };
      },
    );

    await permissionCacheService.clearUserCache(userId);
    if (
      statusChangeResult?.changed &&
      statusChangeResult.newStatus !== USER_STATUS.ACTIVE
    ) {
      websocketService.disconnectUserSessions(userId, {
        reason: '账户状态已变更',
      });
    }
    const roles = await User.getUserRoles(userId);

    res.json({
      success: true,
      data: {
        ...updatedUser,
        roles: roles.map((r) => ({ id: r.id, code: r.code, name: r.name })),
      },
      errorCode: 0,
    });
  } catch (error) {
    logger.error('更新用户错误:', {
      message: error.message,
      operatorUserId: req.userId,
      targetUserId: req.params?.userId,
    });
    res.status(error.statusCode || 500).json({
      success: false,
      errorMessage: error.message || '更新用户失败',
      errorCode: error.statusCode || 500,
    });
  }
};

/**
 * 删除用户
 */
exports.deleteUser = async (req, res) => {
  try {
    const { userId } = req.params;

    if (userId === req.userId) {
      return res.status(400).json({
        success: false,
        errorMessage: '不能删除自己的账户',
        errorCode: 400,
      });
    }

    await withTransaction(async ({ query: transactionQuery }) => {
      const user = await User.findById(userId, {
        queryExecutor: transactionQuery,
      });
      if (!user) {
        const error = new Error('用户不存在');
        error.statusCode = 404;
        throw error;
      }

      const roles = await User.getUserRoles(userId, {
        queryExecutor: transactionQuery,
      });
      const isActiveAdmin =
        normalizeUserStatus(user.status) === USER_STATUS.ACTIVE &&
        roles.some((role) => role.code === 'ADMIN');

      if (isActiveAdmin) {
        const otherActiveAdmins = await User.countUsersByRoleCode('ADMIN', {
          activeOnly: true,
          excludeUserId: userId,
          queryExecutor: transactionQuery,
        });

        if (otherActiveAdmins === 0) {
          const error = new Error('系统至少需要保留一个启用中的管理员账户');
          error.statusCode = 400;
          throw error;
        }
      }

      await User.delete(userId, {
        queryExecutor: transactionQuery,
      });
    });

    await permissionCacheService.clearUserCache(userId);
    websocketService.disconnectUserSessions(userId, {
      reason: '账户已删除',
    });

    res.json({
      success: true,
      message: '删除成功',
      errorCode: 0,
    });
  } catch (error) {
    logger.error('删除用户错误:', {
      message: error.message,
      operatorUserId: req.userId,
      targetUserId: req.params?.userId,
    });
    res.status(error.statusCode || 500).json({
      success: false,
      errorMessage: error.message || '删除用户失败',
      errorCode: error.statusCode || 500,
    });
  }
};

/**
 * 修改密码（管理员修改其他用户密码）
 */
exports.updateUserPassword = async (req, res) => {
  try {
    const { userId } = req.params;
    const {
      newPassword,
      forceChangeOnNextLogin = true,
      revokeAllSessions = true,
    } = req.body;

    if (userId === req.userId) {
      return res.status(400).json({
        success: false,
        errorMessage: '请使用个人中心修改自己的密码',
        errorCode: 400,
      });
    }

    if (!newPassword) {
      return res.status(400).json({
        success: false,
        errorMessage: '新密码不能为空',
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

      const passwordValidation = validatePassword(newPassword, user.username);
      if (!passwordValidation.valid) {
        const error = new Error(passwordValidation.errors.join('；'));
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
        forcePasswordChange: forceChangeOnNextLogin,
        passwordExpiresAt: buildPasswordExpiresAt(),
      });

      if (revokeAllSessions) {
        await Session.revokeAll(userId, {
          queryExecutor: transactionQuery,
        });
      }
    });

    if (revokeAllSessions) {
      websocketService.disconnectUserSessions(userId, {
        reason: '密码已被重置，请重新登录',
      });
    }

    res.json({
      success: true,
      message:
        revokeAllSessions && forceChangeOnNextLogin
          ? '密码修改成功，用户会话已全部下线，下次登录需修改密码'
          : '密码修改成功',
      errorCode: 0,
    });
  } catch (error) {
    logger.error('修改密码错误:', {
      message: error.message,
      operatorUserId: req.userId,
      targetUserId: req.params?.userId,
    });
    res.status(error.statusCode || 500).json({
      success: false,
      errorMessage: error.message || '修改密码失败',
      errorCode: error.statusCode || 500,
    });
  }
};

/**
 * 获取所有角色（用于下拉选择）
 */
exports.getAllRoles = async (req, res) => {
  try {
    const roles = await Role.findAll();
    res.json({
      success: true,
      data: roles,
      errorCode: 0,
    });
  } catch (error) {
    logger.error('获取角色列表错误:', {
      message: error.message,
      operatorUserId: req.userId,
    });
    res.status(500).json({
      success: false,
      errorMessage: error.message || '获取角色列表失败',
      errorCode: 500,
    });
  }
};
