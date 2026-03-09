/**
 * 初始化管理员账户
 * 运行:
 *   INIT_ADMIN_PASSWORD='YourStrongPassword123' node init-admin-user.js
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { query, testConnection } = require('./src/config/database');
const { validatePassword } = require('./src/utils/passwordValidator');
const logger = require('./src/utils/logger');
const { v4: uuidv4 } = require('uuid');

const DEFAULT_PASSWORD_EXPIRE_DAYS =
  Number(process.env.PASSWORD_EXPIRE_DAYS) || 90;

function buildPasswordExpiresAt(days = DEFAULT_PASSWORD_EXPIRE_DAYS) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + days);
  return expiresAt;
}

async function initAdminUser() {
  try {
    logger.info('[init-admin-user] 正在测试数据库连接');
    const connected = await testConnection();
    if (!connected) {
      logger.error('[init-admin-user] 数据库连接失败，请检查配置');
      process.exit(1);
    }

    const adminPassword = process.env.INIT_ADMIN_PASSWORD;
    if (!adminPassword) {
      logger.error(
        '[init-admin-user] 缺少 INIT_ADMIN_PASSWORD 环境变量，已拒绝创建默认管理员',
      );
      process.exit(1);
    }

    const passwordValidation = validatePassword(adminPassword, 'admin');
    if (!passwordValidation.valid) {
      logger.error('[init-admin-user] INIT_ADMIN_PASSWORD 不符合密码策略', {
        errors: passwordValidation.errors,
      });
      process.exit(1);
    }

    const [existing] = await query(
      `SELECT id, username FROM users WHERE username = 'admin'`,
    );

    if (existing) {
      logger.warn('[init-admin-user] 管理员账户已存在', {
        username: existing.username,
        userId: existing.id,
      });
      process.exit(0);
    }

    logger.info('[init-admin-user] 正在创建管理员账户');
    const adminId = uuidv4();
    const hashedPassword = await bcrypt.hash(adminPassword, 10);

    await query(
      `INSERT INTO users (
        id,
        username,
        password,
        real_name,
        status,
        password_expires_at,
        password_changed_at,
        force_password_change
      ) VALUES (?, ?, ?, ?, ?, ?, NOW(), ?)`,
      [
        adminId,
        'admin',
        hashedPassword,
        '系统管理员',
        'ACTIVE',
        buildPasswordExpiresAt(),
        1,
      ],
    );

    const [adminRole] = await query(`SELECT id FROM roles WHERE code = 'ADMIN'`);

    if (adminRole) {
      await query(`INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)`, [
        adminId,
        adminRole.id,
      ]);
    }

    logger.info('[init-admin-user] 管理员账户创建成功', {
      username: 'admin',
      userId: adminId,
    });
    logger.warn(
      '[init-admin-user] 首次登录后需要立即修改密码，请使用你提供的 INIT_ADMIN_PASSWORD 登录',
    );

    process.exit(0);
  } catch (error) {
    logger.error('[init-admin-user] 创建管理员账户失败', {
      message: error.message,
    });
    process.exit(1);
  }
}

initAdminUser();
