// DB3: 竞品监控库（asin_competitor）
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:     process.env.DB3_HOST     || process.env.DB_HOST || '127.0.0.1',
  port:     +(process.env.DB3_PORT   || process.env.DB_PORT || 3306),
  user:     process.env.DB3_USER     || process.env.DB_USER,
  password: process.env.DB3_PASSWORD || process.env.DB_PASSWORD,
  database: process.env.DB3_NAME     || 'asin_competitor',
  waitForConnections: true,
  connectionLimit: 10,
});

module.exports = pool;
