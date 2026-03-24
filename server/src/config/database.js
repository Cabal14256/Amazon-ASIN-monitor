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

function compactSql(sql) {
  return String(sql).replace(/\s+/g, ' ').trim().slice(0, 240);
}

async function executeWithRunner(runner, sql, params = [], options = {}) {
  const start = Date.now();
  const timeoutMs =
    Number(options.timeoutMs) > 0
      ? Number(options.timeoutMs)
      : QUERY_TIMEOUT_MS;
  const [results] = await runner.query({
    sql,
    values: params,
    timeout: timeoutMs,
  });
  const duration = Date.now() - start;
  if (duration >= SLOW_QUERY_MS) {
    logger.warn(
      `[慢查询] 耗时${duration}ms, 参数数量=${params.length}, SQL=${compactSql(
        sql,
      )}`,
    );
  }
  return results;
}

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
async function query(sql, params = [], options = {}) {
  try {
    return await executeWithRunner(pool, sql, params, options);
  } catch (error) {
    logger.error('数据库查询错误:', error);
    throw error;
  }
}

async function getConnection() {
  return pool.getConnection();
}

function createQueryExecutor(connection) {
  return async (sql, params = [], options = {}) => {
    try {
      return await executeWithRunner(connection, sql, params, options);
    } catch (error) {
      logger.error('数据库事务查询错误:', {
        message: error.message,
        sql: compactSql(sql),
      });
      throw error;
    }
  };
}

async function withTransaction(handler) {
  const connection = await getConnection();
  const execute = createQueryExecutor(connection);

  try {
    await connection.beginTransaction();
    const result = await handler({
      connection,
      query: execute,
    });
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      logger.error('数据库事务回滚失败:', {
        message: rollbackError.message,
      });
    }
    logger.error('数据库事务执行失败:', {
      message: error.message,
    });
    throw error;
  } finally {
    connection.release();
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
  getConnection,
  createQueryExecutor,
  withTransaction,
  testConnection,
  getPoolStatus,
};
