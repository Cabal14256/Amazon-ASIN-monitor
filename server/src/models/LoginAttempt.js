/**
 * 登录尝试模型
 * 封装登录尝试记录的数据库操作
 */

const { query } = require('../config/database');

class LoginAttempt {
  /**
   * 记录登录尝试
   * @param {string} username - 用户名
   * @param {string} ipAddress - IP地址
   * @param {boolean} success - 是否成功
   * @returns {Promise<Object>} 创建的记录
   */
  static async create(username, ipAddress, success) {
    await query(
      `INSERT INTO login_attempts (username, ip_address, success) VALUES (?, ?, ?)`,
      [username, ipAddress || null, success ? 1 : 0],
    );
    return true;
  }

  /**
   * 获取最近的失败登录尝试次数
   * @param {string} username - 用户名
   * @param {number} minutes - 时间窗口（分钟）
   * @returns {Promise<number>} 失败次数
   */
  static async getRecentFailedAttempts(username, minutes = 30) {
    const results = await query(
      `SELECT COUNT(*) as count 
       FROM login_attempts 
       WHERE username = ? 
       AND success = 0 
       AND created_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
      [username, minutes],
    );
    const [result] = results;
    return result.count || 0;
  }

  /**
   * 获取最近的登录尝试记录
   * @param {string} username - 用户名（可选）
   * @param {number} limit - 限制数量
   * @returns {Promise<Array>} 登录尝试记录
   */
  static async getRecentAttempts(username = null, limit = 10) {
    let sql = `SELECT * FROM login_attempts WHERE 1=1`;
    const params = [];

    if (username) {
      sql += ` AND username = ?`;
      params.push(username);
    }

    // LIMIT 不能作为参数绑定，需要直接拼接（确保是整数）
    const limitValue = parseInt(limit, 10);
    sql += ` ORDER BY created_at DESC LIMIT ${limitValue}`;

    return await query(sql, params);
  }

  /**
   * 清理旧的登录尝试记录（超过指定天数）
   * @param {number} days - 保留天数
   * @returns {Promise<number>} 删除的记录数
   */
  static async cleanOldAttempts(days = 90) {
    const result = await query(
      `DELETE FROM login_attempts 
       WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [days],
    );
    return result.affectedRows || 0;
  }
}

module.exports = LoginAttempt;
