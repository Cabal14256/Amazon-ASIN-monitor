/**
 * 数据库连接测试脚本
 * 运行: node test-db-connection.js
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

async function testConnection() {
  const config = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'amazon_asin_monitor',
  };

  console.log('🔍 正在测试数据库连接...');
  console.log('配置信息:');
  console.log(`  Host: ${config.host}`);
  console.log(`  Port: ${config.port}`);
  console.log(`  User: ${config.user}`);
  console.log(`  Database: ${config.database}`);
  console.log(`  Password: ${config.password ? '***已设置***' : '⚠️ 未设置'}`);

  try {
    const connection = await mysql.createConnection(config);
    console.log('\n✅ 数据库连接成功！');

    // 测试查询
    const [rows] = await connection.execute('SELECT DATABASE() as current_db');
    console.log(`✅ 当前数据库: ${rows[0].current_db}`);

    // 检查表是否存在
    const [tables] = await connection.execute(
      `
      SELECT COUNT(*) as count 
      FROM information_schema.tables 
      WHERE table_schema = ?
    `,
      [config.database],
    );

    console.log(`✅ 数据库中有 ${tables[0].count} 个表`);

    if (tables[0].count === 0) {
      console.log(
        '\n⚠️  警告: 数据库中没有表，请执行 server/database/init.sql 初始化数据库',
      );
    } else {
      // 列出所有表
      const [tableList] = await connection.execute(
        `
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = ?
        ORDER BY table_name
      `,
        [config.database],
      );

      console.log('\n📋 数据库表列表:');
      tableList.forEach((table) => {
        console.log(`  - ${table.table_name}`);
      });
    }

    await connection.end();
    console.log('\n✅ 测试完成！');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ 数据库连接失败！');
    console.error(`错误信息: ${error.message}`);

    if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error(
        '\n💡 提示: 用户名或密码错误，请检查 server/.env 文件中的 DB_USER 和 DB_PASSWORD',
      );
    } else if (error.code === 'ECONNREFUSED') {
      console.error('\n💡 提示: 无法连接到MySQL服务器，请确认:');
      console.error('  1. MySQL服务是否正在运行');
      console.error('  2. DB_HOST 和 DB_PORT 配置是否正确');
    } else if (error.code === 'ER_BAD_DB_ERROR') {
      console.error('\n💡 提示: 数据库不存在，请执行以下命令创建数据库:');
      console.error('  mysql -u root -p < server/database/init.sql');
    } else {
      console.error('\n💡 提示: 请检查 server/.env 文件中的数据库配置');
    }

    process.exit(1);
  }
}

testConnection();
