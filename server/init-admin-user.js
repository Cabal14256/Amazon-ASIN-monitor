/**
 * 初始化默认管理员账户
 * 运行: node init-admin-user.js
 * 默认用户名: admin, 密码: admin123
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { query } = require('./src/config/database');
const { testConnection } = require('./src/config/database');
const { v4: uuidv4 } = require('uuid');

async function initAdminUser() {
  try {
    // 测试数据库连接
    console.log('🔍 正在测试数据库连接...');
    const connected = await testConnection();
    if (!connected) {
      console.error('❌ 数据库连接失败，请检查配置');
      process.exit(1);
    }

    console.log('✅ 数据库连接成功\n');

    // 检查是否已存在admin用户
    const [existing] = await query(
      `SELECT id, username FROM users WHERE username = 'admin'`,
    );

    if (existing) {
      console.log('⚠️  管理员账户已存在');
      console.log(`   用户名: ${existing.username}`);
      console.log(`   用户ID: ${existing.id}\n`);
      console.log('💡 如需重置密码，请使用以下SQL:');
      console.log(
        `   UPDATE users SET password = ? WHERE id = '${existing.id}';`,
      );
      console.log('   (需要先使用 bcrypt 加密密码)\n');
      process.exit(0);
    }

    // 创建管理员账户
    console.log('📝 正在创建默认管理员账户...');
    const adminId = uuidv4();
    const adminPassword = 'admin123'; // 默认密码
    const hashedPassword = await bcrypt.hash(adminPassword, 10);

    // 插入用户
    await query(
      `INSERT INTO users (id, username, password, real_name, status)
       VALUES (?, ?, ?, ?, ?)`,
      [adminId, 'admin', hashedPassword, '系统管理员', 1],
    );

    // 分配管理员角色
    const [adminRole] = await query(
      `SELECT id FROM roles WHERE code = 'ADMIN'`,
    );

    if (adminRole) {
      await query(`INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)`, [
        adminId,
        adminRole.id,
      ]);
    }

    console.log('✅ 默认管理员账户创建成功！\n');
    console.log('📋 登录信息:');
    console.log(`   用户名: admin`);
    console.log(`   密码: ${adminPassword}`);
    console.log(`   用户ID: ${adminId}\n`);
    console.log('⚠️  重要提示: 请在首次登录后修改密码！\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ 创建管理员账户失败:', error);
    process.exit(1);
  }
}

initAdminUser();
