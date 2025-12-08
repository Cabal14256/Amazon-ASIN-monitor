// "/root/asin-monitor/backend/utils/db2.js"
require('dotenv').config()
const mysql = require('mysql2/promise')

const ENABLED = process.env.ANALYTICS_DUAL_WRITE === '1'

let pool = null
if (ENABLED) {
  pool = mysql.createPool({
    host: process.env.DB2_HOST,
    port: process.env.DB2_PORT || 3306,
    user: process.env.DB2_USER,
    password: process.env.DB2_PASSWORD,
    database: process.env.DB2_DATABASE || 'asin_analytics',
    connectionLimit: 8,
    timezone: 'Z'
  })
  console.log('[DB2] dual-write ENABLED, connected to asin_analytics')
} else {
  console.log('[DB2] dual-write DISABLED (only writing variant_history)')
}

// 暴露一个 query 包装，关闭时直接返回空结果，避免调用报错
async function query(sql, params) {
  if (!ENABLED) return [[], []]
  return pool.query(sql, params)
}

module.exports = { query, ENABLED }
