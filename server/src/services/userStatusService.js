/**
 * 用户状态服务
 * 管理用户状态变更和状态历史记录
 */

const { query, withTransaction } = require('../config/database');
const UserStatusHistory = require('../models/UserStatusHistory');
const Session = require('../models/Session');
const permissionCacheService = require('./permissionCacheService');
const websocketService = require('./websocketService');
const {
  USER_STATUS,
  normalizeUserStatus,
  toDatabaseStatus,
} = require('../utils/userStatus');

async function applyStatusChange(
  userId,
  newStatus,
  reason = null,
  changedBy = null,
  options = {},
) {
  const runQuery = options.queryExecutor || query;
  const [user] = await runQuery(
    `SELECT status, locked_until FROM users WHERE id = ?`,
    [userId],
  );
  if (!user) {
    throw new Error('用户不存在');
  }

  const oldStatus = normalizeUserStatus(user.status, user.locked_until);
  const targetStatus = normalizeUserStatus(newStatus);

  if (!Object.values(USER_STATUS).includes(targetStatus)) {
    throw new Error(`无效的用户状态: ${newStatus}`);
  }

  if (oldStatus === targetStatus) {
    return {
      changed: false,
      oldStatus,
      newStatus: targetStatus,
    };
  }

  const values = [toDatabaseStatus(targetStatus)];
  const updates = ['status = ?'];

  if (targetStatus !== USER_STATUS.LOCKED) {
    updates.push('locked_until = NULL');
  }

  if (targetStatus === USER_STATUS.ACTIVE) {
    updates.push('failed_login_attempts = 0');
    updates.push('last_failed_login = NULL');
  }

  values.push(userId);
  await runQuery(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);

  await UserStatusHistory.create(
    {
      userId,
      oldStatus,
      newStatus: targetStatus,
      reason,
      changedBy,
    },
    {
      queryExecutor: runQuery,
    },
  );

  if (targetStatus !== USER_STATUS.ACTIVE) {
    await Session.revokeAll(userId, {
      queryExecutor: runQuery,
    });
  }

  return {
    changed: true,
    oldStatus,
    newStatus: targetStatus,
  };
}

/**
 * 变更用户状态
 * @param {string} userId - 用户ID
 * @param {string} newStatus - 新状态
 * @param {string} reason - 变更原因
 * @param {string} changedBy - 变更操作人ID
 * @returns {Promise<void>}
 */
async function changeStatus(
  userId,
  newStatus,
  reason = null,
  changedBy = null,
  options = {},
) {
  if (options.queryExecutor) {
    return applyStatusChange(userId, newStatus, reason, changedBy, options);
  }

  const result = await withTransaction(async ({ query: transactionQuery }) =>
    applyStatusChange(userId, newStatus, reason, changedBy, {
      queryExecutor: transactionQuery,
    }),
  );

  await permissionCacheService.clearUserCache(userId);
  if (result.changed && result.newStatus !== USER_STATUS.ACTIVE) {
    websocketService.disconnectUserSessions(userId, {
      reason: '账户状态已变更',
    });
  }
  return result;
}

/**
 * 获取用户状态变更历史
 * @param {string} userId - 用户ID
 * @param {number} limit - 限制数量
 * @returns {Promise<Array>} 状态变更历史记录
 */
async function getStatusHistory(userId, limit = 50) {
  return UserStatusHistory.findByUserId(userId, limit);
}

/**
 * 获取所有状态变更历史（分页）
 * @param {Object} params - 查询参数
 * @returns {Promise<Object>} 历史记录列表和总数
 */
async function getAllStatusHistory(params = {}) {
  return UserStatusHistory.findAll(params);
}

module.exports = {
  changeStatus,
  getStatusHistory,
  getAllStatusHistory,
  USER_STATUS,
};
