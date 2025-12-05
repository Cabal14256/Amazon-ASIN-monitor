const mysql = require('mysql2/promise');
require('dotenv').config();

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
    console.log('✅ 竞品数据库连接成功');
    connection.release();
    return true;
  } catch (error) {
    console.error('❌ 竞品数据库连接失败:', error.message);
    return false;
  }
}

async function query(sql, params = []) {
  try {
    const [results] = await pool.execute(sql, params);
    return results;
  } catch (error) {
    console.error('竞品数据库查询错误:', error);
    throw error;
  }
}

module.exports = {
  pool,
  query,
  testConnection,
};
