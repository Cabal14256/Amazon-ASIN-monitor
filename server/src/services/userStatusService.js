/**
 * 用户状态服务
 * 管理用户状态变更和状态历史记录
 */

const { query } = require('../config/database');
const UserStatusHistory = require('../models/UserStatusHistory');
const Session = require('../models/Session');
const permissionCacheService = require('../services/permissionCacheService');

// 用户状态枚举
const USER_STATUS = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  LOCKED: 'LOCKED',
  SUSPENDED: 'SUSPENDED',
  PENDING: 'PENDING',
};

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
) {
  // 验证状态值
  if (!Object.values(USER_STATUS).includes(newStatus)) {
    throw new Error(`无效的用户状态: ${newStatus}`);
  }

  // 获取当前状态
  const [user] = await query(`SELECT status FROM users WHERE id = ?`, [userId]);
  if (!user) {
    throw new Error('用户不存在');
  }

  const oldStatus = user.status;

  // 如果状态相同，不需要变更
  if (
    oldStatus === newStatus ||
    (oldStatus === 1 && newStatus === 'ACTIVE') ||
    (oldStatus === 0 && newStatus === 'INACTIVE')
  ) {
    return;
  }

  // 更新用户状态
  // 为了向后兼容，如果数据库status字段是TINYINT，需要转换
  // ACTIVE -> 1, 其他 -> 0 (INACTIVE) 或保持原值
  let statusValue = newStatus;
  if (newStatus === 'ACTIVE') {
    statusValue = 1;
  } else if (newStatus === 'INACTIVE') {
    statusValue = 0;
  }

  await query(`UPDATE users SET status = ? WHERE id = ?`, [
    statusValue,
    userId,
  ]);

  // 记录状态变更历史
  await UserStatusHistory.create({
    userId,
    oldStatus:
      oldStatus === 1 ? 'ACTIVE' : oldStatus === 0 ? 'INACTIVE' : oldStatus,
    newStatus,
    reason,
    changedBy,
  });

  // 如果状态变更为非活跃状态，清除所有会话
  if (newStatus !== 'ACTIVE' && newStatus !== 1) {
    await Session.revokeAll(userId);
    // 清除权限缓存
    await permissionCacheService.clearUserCache(userId);
  }
}

/**
 * 获取用户状态变更历史
 * @param {string} userId - 用户ID
 * @param {number} limit - 限制数量
 * @returns {Promise<Array>} 状态变更历史记录
 */
async function getStatusHistory(userId, limit = 50) {
  return await UserStatusHistory.findByUserId(userId, limit);
}

/**
 * 获取所有状态变更历史（分页）
 * @param {Object} params - 查询参数
 * @returns {Promise<Object>} 历史记录列表和总数
 */
async function getAllStatusHistory(params = {}) {
  return await UserStatusHistory.findAll(params);
}

module.exports = {
  changeStatus,
  getStatusHistory,
  getAllStatusHistory,
  USER_STATUS,
};
