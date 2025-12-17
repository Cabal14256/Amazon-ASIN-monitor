const mysql = require('mysql2/promise');
require('dotenv').config();
const logger = require('../utils/logger');

const dbConfig = {
  host: process.env.COMPETITOR_DB_HOST || process.env.DB_HOST || 'localhost',
  port: process.env.COMPETITOR_DB_PORT || process.env.DB_PORT || 3306,
  user: process.env.COMPETITOR_DB_USER || process.env.DB_USER || 'root',
  password:
    process.env.COMPETITOR_DB_PASSWORD ||
    process.env.DB_PASSWORD ||
    'JSBjsb123',
  database: process.env.COMPETITOR_DB_NAME || 'amazon_competitor_monitor',
  charset: 'utf8mb4',
  timezone: '+08:00',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

const pool = mysql.createPool(dbConfig);

async function testConnection() {
  try {
    const connection = await pool.getConnection();
    logger.info('✅ 竞品数据库连接成功');
    connection.release();
    return true;
  } catch (error) {
    logger.error('❌ 竞品数据库连接失败:', error.message);
    return false;
  }
}

async function query(sql, params = []) {
  try {
    const [results] = await pool.execute(sql, params);
    return results;
  } catch (error) {
    logger.error('竞品数据库查询错误:', error);
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
    logger.warn('获取竞品数据库连接池状态失败:', error.message);
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
