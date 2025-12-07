/**
 * 密码历史服务
 * 管理用户密码历史记录，防止重复使用旧密码
 */

const { query } = require('../config/database');
const bcrypt = require('bcryptjs');

// 保留的密码历史数量
const MAX_PASSWORD_HISTORY = 5;

/**
 * 保存密码历史
 * @param {string} userId - 用户ID
 * @param {string} passwordHash - 密码哈希值
 * @returns {Promise<void>}
 */
async function savePasswordHistory(userId, passwordHash) {
  // 先检查当前历史记录数量
  const [countResult] = await query(
    `SELECT COUNT(*) as count FROM password_history WHERE user_id = ?`,
    [userId],
  );

  const currentCount = countResult.count || 0;

  // 插入新密码历史
  await query(
    `INSERT INTO password_history (user_id, password_hash) VALUES (?, ?)`,
    [userId, passwordHash],
  );

  // 如果超过最大数量，删除最旧的记录
  if (currentCount >= MAX_PASSWORD_HISTORY) {
    // 注意：LIMIT 不能作为参数绑定，需要直接拼接（确保是整数）
    const limit = parseInt(MAX_PASSWORD_HISTORY, 10);
    await query(
      `DELETE FROM password_history 
       WHERE user_id = ? 
       AND id NOT IN (
         SELECT id FROM (
           SELECT id FROM password_history 
           WHERE user_id = ? 
           ORDER BY created_at DESC 
           LIMIT ${limit}
         ) AS temp
       )`,
      [userId, userId],
    );
  }
}

/**
 * 检查密码是否在历史记录中
 * @param {string} userId - 用户ID
 * @param {string} password - 待检查的密码（明文）
 * @returns {Promise<boolean>} 如果密码在历史记录中返回true
 */
async function checkPasswordHistory(userId, password) {
  // 获取用户最近的密码历史
  // 注意：LIMIT 不能作为参数绑定，需要直接拼接（确保是整数）
  const limit = parseInt(MAX_PASSWORD_HISTORY, 10);
  const history = await query(
    `SELECT password_hash FROM password_history 
     WHERE user_id = ? 
     ORDER BY created_at DESC 
     LIMIT ${limit}`,
    [userId],
  );

  // 检查密码是否与历史密码匹配
  for (const record of history) {
    const isMatch = await bcrypt.compare(password, record.password_hash);
    if (isMatch) {
      return true; // 密码在历史记录中
    }
  }

  return false; // 密码不在历史记录中
}

/**
 * 清理用户的所有密码历史
 * @param {string} userId - 用户ID
 * @returns {Promise<void>}
 */
async function cleanOldPasswords(userId) {
  await query(`DELETE FROM password_history WHERE user_id = ?`, [userId]);
}

/**
 * 获取用户密码历史数量
 * @param {string} userId - 用户ID
 * @returns {Promise<number>} 历史密码数量
 */
async function getPasswordHistoryCount(userId) {
  const [result] = await query(
    `SELECT COUNT(*) as count FROM password_history WHERE user_id = ?`,
    [userId],
  );
  return result.count || 0;
}

module.exports = {
  savePasswordHistory,
  checkPasswordHistory,
  cleanOldPasswords,
  getPasswordHistoryCount,
  MAX_PASSWORD_HISTORY,
};
