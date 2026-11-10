const mysql = require('mysql2/promise');
require('dotenv').config();
const logger = require('../utils/logger');

const dbConfig = {
  host: process.env.COMPETITOR_DB_HOST || process.env.DB_HOST || 'localhost',
  port: process.env.COMPETITOR_DB_PORT || process.env.DB_PORT || 3306,
  user: process.env.COMPETITOR_DB_USER || process.env.DB_USER || 'root',
  password:
    process.env.COMPETITOR_DB_PASSWORD !== undefined
      ? process.env.COMPETITOR_DB_PASSWORD
      : process.env.DB_PASSWORD,
  database:
    process.env.COMPETITOR_DB_NAME ||
    process.env.DB_NAME ||
    'amazon_asin_monitor',
  charset: 'utf8mb4',
  timezone: '+08:00',
  waitForConnections: true,
  connectionLimit:
    Number(
      process.env.COMPETITOR_DB_CONNECTION_LIMIT ||
        process.env.DB_CONNECTION_LIMIT,
    ) || 10,
  queueLimit: Number(process.env.COMPETITOR_DB_QUEUE_LIMIT) || 0,
};

const QUERY_TIMEOUT_MS =
  Number(
    process.env.COMPETITOR_DB_QUERY_TIMEOUT || process.env.DB_QUERY_TIMEOUT,
  ) || 600000;
const SLOW_QUERY_MS =
  Number(
    process.env.COMPETITOR_DB_SLOW_QUERY_MS || process.env.DB_SLOW_QUERY_MS,
  ) || 1500;

const pool = mysql.createPool(dbConfig);

function compactSql(sql) {
  return String(sql).replace(/\s+/g, ' ').trim().slice(0, 240);
}

async function executeWithRunner(runner, sql, params = []) {
  const start = Date.now();
  try {
    const [results] = await runner.query({
      sql,
      values: params,
      timeout: QUERY_TIMEOUT_MS,
    });
    const duration = Date.now() - start;
    if (duration >= SLOW_QUERY_MS) {
      logger.warn(
        `[竞品慢查询] 耗时${duration}ms, 参数数量=${
          params.length
        }, SQL=${compactSql(sql)}`,
      );
    }
    return results;
  } catch (error) {
    logger.error('竞品数据库查询错误:', {
      code: error.code,
      message: error.message,
      sql: compactSql(sql),
    });
    throw error;
  }
}

async function testConnection() {
  if (dbConfig.password === undefined) {
    logger.error(
      '❌ 竞品数据库密码未配置，请设置 COMPETITOR_DB_PASSWORD 或 DB_PASSWORD',
    );
    return false;
  }
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
  return executeWithRunner(pool, sql, params);
}

async function getConnection() {
  return pool.getConnection();
}

function createQueryExecutor(connection) {
  return async (sql, params = []) => {
    return executeWithRunner(connection, sql, params);
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
      logger.error('竞品数据库事务回滚失败:', {
        message: rollbackError.message,
      });
    }
    const transactionLog = {
      message: error.message,
      statusCode: error.statusCode,
    };
    if (error.statusCode && error.statusCode < 500) {
      logger.warn('竞品数据库事务执行被拒绝:', transactionLog);
    } else {
      logger.error('竞品数据库事务执行失败:', transactionLog);
    }
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
  getConnection,
  createQueryExecutor,
  withTransaction,
  testConnection,
  getPoolStatus,
};
