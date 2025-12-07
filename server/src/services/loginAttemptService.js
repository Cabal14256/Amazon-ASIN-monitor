/**
 * 登录尝试服务
 * 管理登录尝试记录、账户锁定等功能
 */

const { query } = require('../config/database');
const LoginAttempt = require('../models/LoginAttempt');

// 登录失败锁定配置
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 30;

/**
 * 记录登录尝试
 * @param {string} username - 用户名
 * @param {string} ipAddress - IP地址
 * @param {boolean} success - 是否成功
 * @returns {Promise<void>}
 */
async function recordAttempt(username, ipAddress, success) {
  await LoginAttempt.create(username, ipAddress, success);
}

/**
 * 获取最近的失败登录尝试次数
 * @param {string} username - 用户名
 * @param {number} minutes - 时间窗口（分钟）
 * @returns {Promise<number>} 失败次数
 */
async function getRecentFailedAttempts(username, minutes = 30) {
  return await LoginAttempt.getRecentFailedAttempts(username, minutes);
}

/**
 * 检查账户是否锁定
 * @param {string} userId - 用户ID
 * @returns {Promise<boolean>} 是否锁定
 */
async function isAccountLocked(userId) {
  const [user] = await query(
    `SELECT locked_until, failed_login_attempts FROM users WHERE id = ?`,
    [userId],
  );

  if (!user) return false;

  // 检查锁定时间是否已过期
  if (user.locked_until) {
    const lockedUntil = new Date(user.locked_until);
    const now = new Date();
    if (now < lockedUntil) {
      return true; // 仍在锁定期内
    } else {
      // 锁定已过期，清除锁定状态
      await unlockAccount(userId);
      return false;
    }
  }

  // 检查失败次数
  return user.failed_login_attempts >= MAX_FAILED_ATTEMPTS;
}

/**
 * 锁定账户
 * @param {string} userId - 用户ID
 * @param {number} minutes - 锁定时长（分钟）
 * @returns {Promise<void>}
 */
async function lockAccount(userId, minutes = LOCKOUT_DURATION_MINUTES) {
  const lockedUntil = new Date();
  lockedUntil.setMinutes(lockedUntil.getMinutes() + minutes);

  await query(
    `UPDATE users 
     SET locked_until = ?, failed_login_attempts = ? 
     WHERE id = ?`,
    [lockedUntil, MAX_FAILED_ATTEMPTS, userId],
  );
}

/**
 * 解锁账户
 * @param {string} userId - 用户ID
 * @returns {Promise<void>}
 */
async function unlockAccount(userId) {
  await query(
    `UPDATE users 
     SET locked_until = NULL, failed_login_attempts = 0, last_failed_login = NULL 
     WHERE id = ?`,
    [userId],
  );
}

/**
 * 重置失败次数
 * @param {string} userId - 用户ID
 * @returns {Promise<void>}
 */
async function resetFailedAttempts(userId) {
  await query(
    `UPDATE users 
     SET failed_login_attempts = 0, last_failed_login = NULL 
     WHERE id = ?`,
    [userId],
  );
}

/**
 * 增加失败次数
 * @param {string} userId - 用户ID
 * @returns {Promise<boolean>} 是否应该锁定账户
 */
async function incrementFailedAttempts(userId) {
  // 获取当前失败次数
  const [user] = await query(
    `SELECT failed_login_attempts FROM users WHERE id = ?`,
    [userId],
  );

  if (!user) return false;

  const newAttempts = (user.failed_login_attempts || 0) + 1;

  // 更新失败次数和最后失败时间
  await query(
    `UPDATE users 
     SET failed_login_attempts = ?, last_failed_login = NOW() 
     WHERE id = ?`,
    [newAttempts, userId],
  );

  // 如果达到最大失败次数，锁定账户
  if (newAttempts >= MAX_FAILED_ATTEMPTS) {
    await lockAccount(userId);
    return true;
  }

  return false;
}

/**
 * 获取账户锁定剩余时间（分钟）
 * @param {string} userId - 用户ID
 * @returns {Promise<number|null>} 剩余分钟数，如果未锁定返回null
 */
async function getLockoutRemainingMinutes(userId) {
  const [user] = await query(`SELECT locked_until FROM users WHERE id = ?`, [
    userId,
  ]);

  if (!user || !user.locked_until) {
    return null;
  }

  const lockedUntil = new Date(user.locked_until);
  const now = new Date();

  if (now >= lockedUntil) {
    return null; // 已过期
  }

  const diffMs = lockedUntil - now;
  return Math.ceil(diffMs / (1000 * 60)); // 转换为分钟
}

module.exports = {
  recordAttempt,
  getRecentFailedAttempts,
  isAccountLocked,
  lockAccount,
  unlockAccount,
  resetFailedAttempts,
  incrementFailedAttempts,
  getLockoutRemainingMinutes,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_DURATION_MINUTES,
};
