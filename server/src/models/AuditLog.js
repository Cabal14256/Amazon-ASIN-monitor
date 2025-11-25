const { query } = require('../config/database');

class AuditLog {
  /**
   * 创建审计日志
   * @param {Object} data - 日志数据
   * @returns {Promise<Object>} 创建的日志记录
   */
  static async create(data) {
    const {
      userId,
      username,
      action,
      resource,
      resourceId,
      resourceName,
      method,
      path,
      ipAddress,
      userAgent,
      requestData,
      responseStatus,
      errorMessage,
    } = data;

    const result = await query(
      `INSERT INTO audit_logs 
       (user_id, username, action, resource, resource_id, resource_name, method, path, ip_address, user_agent, request_data, response_status, error_message) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId || null,
        username || null,
        action,
        resource || null,
        resourceId || null,
        resourceName || null,
        method || null,
        path || null,
        ipAddress || null,
        userAgent || null,
        requestData ? JSON.stringify(requestData) : null,
        responseStatus || null,
        errorMessage || null,
      ],
    );

    return this.findById(result.insertId);
  }

  /**
   * 根据ID查找日志
   * @param {number} id - 日志ID
   * @returns {Promise<Object>} 日志记录
   */
  static async findById(id) {
    const [log] = await query(`SELECT * FROM audit_logs WHERE id = ?`, [id]);

    if (log) {
      // 转换字段名：数据库下划线命名 -> 前端驼峰命名
      const formatted = {
        ...log,
        userId: log.user_id,
        resourceId: log.resource_id,
        resourceName: log.resource_name,
        ipAddress: log.ip_address,
        userAgent: log.user_agent,
        requestData: null,
        responseStatus: log.response_status,
        errorMessage: log.error_message,
        createTime: log.create_time,
      };

      // 解析request_data JSON
      if (log.request_data) {
        try {
          formatted.requestData = JSON.parse(log.request_data);
        } catch (e) {
          formatted.requestData = log.request_data;
        }
      }

      return formatted;
    }
    return log;
  }

  /**
   * 查询审计日志列表
   * @param {Object} params - 查询参数
   * @returns {Promise<Object>} 日志列表和总数
   */
  static async findAll(params = {}) {
    const {
      userId,
      username,
      action,
      resource,
      resourceId,
      startTime,
      endTime,
      current = 1,
      pageSize = 10,
    } = params;

    let whereClause = 'WHERE 1=1';
    const queryValues = [];

    if (userId) {
      whereClause += ' AND user_id = ?';
      queryValues.push(userId);
    }

    if (username) {
      whereClause += ' AND username LIKE ?';
      queryValues.push(`%${username}%`);
    }

    if (action) {
      whereClause += ' AND action = ?';
      queryValues.push(action);
    }

    if (resource) {
      whereClause += ' AND resource = ?';
      queryValues.push(resource);
    }

    if (resourceId) {
      whereClause += ' AND resource_id = ?';
      queryValues.push(resourceId);
    }

    if (startTime) {
      whereClause += ' AND create_time >= ?';
      queryValues.push(startTime);
    }

    if (endTime) {
      whereClause += ' AND create_time <= ?';
      queryValues.push(endTime);
    }

    const offset = (Number(current) - 1) * Number(pageSize);
    const limit = Number(pageSize);

    // 查询总数
    const [countResult] = await query(
      `SELECT COUNT(*) as total FROM audit_logs ${whereClause}`,
      queryValues,
    );
    const total = countResult.total;

    // 查询列表 - LIMIT 和 OFFSET 不能使用参数绑定，必须直接拼接（确保是整数）
    const list = await query(
      `SELECT * FROM audit_logs ${whereClause} ORDER BY create_time DESC LIMIT ${limit} OFFSET ${offset}`,
      queryValues,
    );

    // 转换字段名：数据库下划线命名 -> 前端驼峰命名
    const formattedList = list.map((log) => {
      const formatted = {
        ...log,
        userId: log.user_id,
        resourceId: log.resource_id,
        resourceName: log.resource_name,
        ipAddress: log.ip_address,
        userAgent: log.user_agent,
        requestData: null,
        responseStatus: log.response_status,
        errorMessage: log.error_message,
        createTime: log.create_time,
      };

      // 解析request_data JSON
      if (log.request_data) {
        try {
          formatted.requestData = JSON.parse(log.request_data);
        } catch (e) {
          formatted.requestData = log.request_data;
        }
      }

      return formatted;
    });

    return {
      list: formattedList,
      total,
      current: Number(current),
      pageSize: Number(pageSize),
    };
  }

  /**
   * 获取操作类型统计
   * @param {Object} params - 查询参数
   * @returns {Promise<Array>} 统计结果
   */
  static async getActionStatistics(params = {}) {
    const { startTime, endTime } = params;

    let whereClause = 'WHERE 1=1';
    const queryValues = [];

    if (startTime) {
      whereClause += ' AND create_time >= ?';
      queryValues.push(startTime);
    }

    if (endTime) {
      whereClause += ' AND create_time <= ?';
      queryValues.push(endTime);
    }

    const results = await query(
      `SELECT action, COUNT(*) as count 
       FROM audit_logs 
       ${whereClause} 
       GROUP BY action 
       ORDER BY count DESC`,
      queryValues,
    );

    return results;
  }

  /**
   * 获取资源类型统计
   * @param {Object} params - 查询参数
   * @returns {Promise<Array>} 统计结果
   */
  static async getResourceStatistics(params = {}) {
    const { startTime, endTime } = params;

    let whereClause = 'WHERE 1=1';
    const queryValues = [];

    if (startTime) {
      whereClause += ' AND create_time >= ?';
      queryValues.push(startTime);
    }

    if (endTime) {
      whereClause += ' AND create_time <= ?';
      queryValues.push(endTime);
    }

    const results = await query(
      `SELECT resource, COUNT(*) as count 
       FROM audit_logs 
       ${whereClause} 
       GROUP BY resource 
       ORDER BY count DESC`,
      queryValues,
    );

    return results;
  }
}

module.exports = AuditLog;
