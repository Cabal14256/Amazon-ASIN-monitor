/**
 * 用户状态变更历史模型
 * 封装用户状态变更历史的数据库操作
 */

const { query } = require('../config/database');

class UserStatusHistory {
  /**
   * 创建状态变更记录
   * @param {Object} data - 状态变更数据
   * @returns {Promise<Object>} 创建的记录
   */
  static async create(data) {
    const { userId, oldStatus, newStatus, reason, changedBy } = data;

    await query(
      `INSERT INTO user_status_history (user_id, old_status, new_status, reason, changed_by) 
       VALUES (?, ?, ?, ?, ?)`,
      [userId, oldStatus || null, newStatus, reason || null, changedBy || null],
    );

    return true;
  }

  /**
   * 获取用户的状态变更历史
   * @param {string} userId - 用户ID
   * @param {number} limit - 限制数量
   * @returns {Promise<Array>} 状态变更历史记录
   */
  static async findByUserId(userId, limit = 50) {
    // LIMIT 不能作为参数绑定，需要直接拼接（确保是整数）
    const limitValue = parseInt(limit, 10);
    return await query(
      `SELECT * FROM user_status_history 
       WHERE user_id = ? 
       ORDER BY created_at DESC 
       LIMIT ${limitValue}`,
      [userId],
    );
  }

  /**
   * 获取所有状态变更历史（分页）
   * @param {Object} params - 查询参数
   * @returns {Promise<Object>} 历史记录列表和总数
   */
  static async findAll(params = {}) {
    const {
      userId,
      newStatus,
      startTime,
      endTime,
      current = 1,
      pageSize = 10,
    } = params;

    let whereClause = 'WHERE 1=1';
    const conditions = [];

    if (userId) {
      whereClause += ' AND user_id = ?';
      conditions.push(userId);
    }

    if (newStatus) {
      whereClause += ' AND new_status = ?';
      conditions.push(newStatus);
    }

    if (startTime) {
      whereClause += ' AND created_at >= ?';
      conditions.push(startTime);
    }

    if (endTime) {
      whereClause += ' AND created_at <= ?';
      conditions.push(endTime);
    }

    // 获取总数
    const countResults = await query(
      `SELECT COUNT(*) as total FROM user_status_history ${whereClause}`,
      conditions,
    );
    const [countResult] = countResults;
    const total = countResult.total || 0;

    // 分页
    const offset = (Number(current) - 1) * Number(pageSize);
    const limit = Number(pageSize);
    const list = await query(
      `SELECT * FROM user_status_history 
       ${whereClause} 
       ORDER BY created_at DESC 
       LIMIT ${limit} OFFSET ${offset}`,
      conditions,
    );

    return { list, total };
  }
}

module.exports = UserStatusHistory;
