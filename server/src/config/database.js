const mysql = require('mysql2/promise');
require('dotenv').config();
const logger = require('../utils/logger');

// 数据库连接配置
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'amazon_asin_monitor',
  charset: 'utf8mb4',
  timezone: '+08:00',
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 50,
  queueLimit: 200,
  connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT) || 10000, // 连接超时时间（毫秒）
};

// 创建连接池
const pool = mysql.createPool(dbConfig);
const QUERY_TIMEOUT_MS = Number(process.env.DB_QUERY_TIMEOUT) || 600000;
const SLOW_QUERY_MS = Number(process.env.DB_SLOW_QUERY_MS) || 1500;

// 测试数据库连接
async function testConnection() {
  if (!process.env.DB_PASSWORD) {
    logger.error('❌ 数据库密码未配置！请在 .env 文件中设置 DB_PASSWORD');
    throw new Error('数据库密码未配置');
  }
  try {
    const connection = await pool.getConnection();
    logger.info('✅ 数据库连接成功');
    connection.release();
    return true;
  } catch (error) {
    logger.error('❌ 数据库连接失败:', error.message);
    return false;
  }
}

// 执行查询的辅助函数
async function query(sql, params = []) {
  try {
    const start = Date.now();
    const [results] = await pool.query({
      sql,
      values: params,
      timeout: QUERY_TIMEOUT_MS,
    });
    const duration = Date.now() - start;
    if (duration >= SLOW_QUERY_MS) {
      const compactSql = String(sql).replace(/\s+/g, ' ').trim().slice(0, 240);
      logger.warn(
        `[慢查询] 耗时${duration}ms, 参数数量=${params.length}, SQL=${compactSql}`,
      );
    }
    return results;
  } catch (error) {
    logger.error('数据库查询错误:', error);
    throw error;
  }
}

/**
 * 获取连接池状态
 * @returns {Object} 连接池状态
 */
function getPoolStatus() {
  try {
    // mysql2/promise的pool对象结构可能不同，使用安全的方式获取状态
    const poolInternal = pool.pool || pool;
    const allConnections = poolInternal._allConnections || [];
    const freeConnections = poolInternal._freeConnections || [];
    const connectionQueue = poolInternal._connectionQueue || [];

    return {
      totalConnections: allConnections.length,
      freeConnections: freeConnections.length,
      activeConnections: allConnections.length - freeConnections.length,
      queueLength: connectionQueue.length,
      config: {
        connectionLimit: dbConfig.connectionLimit,
        queueLimit: dbConfig.queueLimit,
      },
    };
  } catch (error) {
    logger.warn('获取连接池状态失败:', error.message);
    return {
      status: 'error',
      error: error.message,
      config: {
        connectionLimit: dbConfig.connectionLimit,
        queueLimit: dbConfig.queueLimit,
      },
    };
  }
}

module.exports = {
  pool,
  query,
  testConnection,
  getPoolStatus,
};
