const { query } = require('../config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { secret, expiresIn } = require('../config/jwt');
const { v4: uuidv4 } = require('uuid');
const permissionCacheService = require('../services/permissionCacheService');
const { normalizeUserStatus, toDatabaseStatus, USER_STATUS } = require(
  '../utils/userStatus',
);

const USER_PUBLIC_COLUMNS = `
  id,
  username,
  real_name,
  status,
  last_login_time,
  last_login_ip,
  password_expires_at,
  password_changed_at,
  force_password_change,
  failed_login_attempts,
  locked_until,
  create_time,
  update_time
`;

function formatUser(user) {
  if (!user) {
    return user;
  }

  return {
    ...user,
    status: normalizeUserStatus(user.status, user.locked_until),
    force_password_change:
      user.force_password_change === 1 || user.force_password_change === true,
  };
}

function mapStatusFilter(status) {
  if (!status) {
    return null;
  }

  const normalized = normalizeUserStatus(status);
  return normalized;
}

class User {
  // 根据ID查找用户（不包含密码）
  static async findById(id, options = {}) {
    const runQuery = options.queryExecutor || query;
    const [user] = await runQuery(
      `SELECT ${USER_PUBLIC_COLUMNS} FROM users WHERE id = ?`,
      [id],
    );
    return formatUser(user);
  }

  // 根据ID查找用户（包含密码，用于登录验证）
  static async findByIdWithPassword(id, options = {}) {
    const runQuery = options.queryExecutor || query;
    const [user] = await runQuery(`SELECT * FROM users WHERE id = ?`, [id]);
    return formatUser(user);
  }

  // 根据用户名查找用户
  static async findByUsername(username, options = {}) {
    const runQuery = options.queryExecutor || query;
    const [user] = await runQuery(`SELECT * FROM users WHERE username = ?`, [
      username,
    ]);
    return formatUser(user);
  }

  // 查询所有用户（分页）
  static async findAll(params = {}, options = {}) {
    const runQuery = options.queryExecutor || query;
    const {
      username: searchUsername = '',
      status = '',
      current = 1,
      pageSize = 10,
    } = params;

    let sql = `
      SELECT ${USER_PUBLIC_COLUMNS}
      FROM users
      WHERE 1=1
    `;
    const conditions = [];

    if (searchUsername) {
      sql += ` AND username LIKE ?`;
      conditions.push(`%${searchUsername}%`);
    }

    const normalizedStatus = mapStatusFilter(status);
    if (normalizedStatus) {
      sql += ` AND status = ?`;
      conditions.push(normalizedStatus);
    }

    const countSql = sql.replace(
      /SELECT[\s\S]*?FROM/,
      'SELECT COUNT(*) as total FROM',
    );
    const countResult = await runQuery(countSql, conditions);
    const total = countResult[0]?.total || 0;

    const offset = (Number(current) - 1) * Number(pageSize);
    const limit = Number(pageSize);
    sql += ` ORDER BY create_time DESC LIMIT ${limit} OFFSET ${offset}`;

    const list = await runQuery(sql, conditions);
    return {
      list: list.map(formatUser),
      total,
    };
  }

  // 创建用户
  static async create(userData, options = {}) {
    const runQuery = options.queryExecutor || query;
    const {
      username,
      password,
      real_name,
      status = USER_STATUS.ACTIVE,
      forcePasswordChange = false,
      passwordExpiresAt = null,
    } = userData;
    const id = uuidv4();
    const hashedPassword = await bcrypt.hash(password, 10);

    await runQuery(
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
        id,
        username,
        hashedPassword,
        real_name || null,
        toDatabaseStatus(status),
        passwordExpiresAt,
        forcePasswordChange ? 1 : 0,
      ],
    );

    return this.findById(id, options);
  }

  // 更新用户
  static async update(id, userData, options = {}) {
    const runQuery = options.queryExecutor || query;
    const { real_name, status } = userData;
    const updates = [];
    const values = [];

    if (real_name !== undefined) {
      updates.push('real_name = ?');
      values.push(real_name);
    }

    if (status !== undefined) {
      updates.push('status = ?');
      values.push(toDatabaseStatus(status));
    }

    if (updates.length === 0) {
      return this.findById(id, options);
    }

    values.push(id);
    await runQuery(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);

    return this.findById(id, options);
  }

  // 更新密码
  static async updatePassword(id, newPassword, options = {}) {
    const runQuery = options.queryExecutor || query;
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const forcePasswordChange = options.forcePasswordChange ? 1 : 0;
    const passwordExpiresAt = options.passwordExpiresAt || null;

    await runQuery(
      `UPDATE users
       SET password = ?,
           password_changed_at = NOW(),
           password_expires_at = ?,
           force_password_change = ?
       WHERE id = ?`,
      [hashedPassword, passwordExpiresAt, forcePasswordChange, id],
    );
    return true;
  }

  static async updatePasswordPolicy(id, policyData = {}, options = {}) {
    const runQuery = options.queryExecutor || query;
    const updates = [];
    const values = [];

    if (policyData.forcePasswordChange !== undefined) {
      updates.push('force_password_change = ?');
      values.push(policyData.forcePasswordChange ? 1 : 0);
    }

    if (policyData.passwordExpiresAt !== undefined) {
      updates.push('password_expires_at = ?');
      values.push(policyData.passwordExpiresAt || null);
    }

    if (!updates.length) {
      return this.findById(id, options);
    }

    values.push(id);
    await runQuery(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);
    return this.findById(id, options);
  }

  // 删除用户
  static async delete(id, options = {}) {
    const runQuery = options.queryExecutor || query;
    await runQuery(`DELETE FROM users WHERE id = ?`, [id]);
    return true;
  }

  // 验证密码
  static async verifyPassword(user, password) {
    if (!user?.password) {
      return false;
    }
    return bcrypt.compare(password, user.password);
  }

  // 生成JWT Token
  static generateToken(userId, sessionId, customExpiresIn) {
    return jwt.sign({ userId, sessionId: sessionId || uuidv4() }, secret, {
      expiresIn: customExpiresIn || expiresIn,
    });
  }

  // 验证Token
  static verifyToken(token) {
    try {
      return jwt.verify(token, secret);
    } catch (error) {
      return null;
    }
  }

  // 检查用户是否有某个权限
  static async hasPermission(userId, permissionCode, options = {}) {
    const permissions = await this.getUserPermissions(userId, options);
    return permissions.includes(permissionCode);
  }

  // 获取用户的所有权限
  static async getUserPermissions(userId, options = {}) {
    if (options.queryExecutor) {
      const permissions = await options.queryExecutor(
        `SELECT p.code
         FROM user_roles ur
         JOIN role_permissions rp ON ur.role_id = rp.role_id
         JOIN permissions p ON rp.permission_id = p.id
         WHERE ur.user_id = ?
         ORDER BY p.code`,
        [userId],
      );
      return permissions.map((permission) => permission.code);
    }
    return permissionCacheService.getUserPermissions(userId);
  }

  // 获取用户的角色
  static async getUserRoles(userId, options = {}) {
    if (options.queryExecutor) {
      return options.queryExecutor(
        `SELECT r.id, r.code, r.name
         FROM user_roles ur
         JOIN roles r ON ur.role_id = r.id
         WHERE ur.user_id = ?
         ORDER BY r.code`,
        [userId],
      );
    }
    return permissionCacheService.getUserRoles(userId);
  }

  static async hasRole(userId, roleCode, options = {}) {
    const roles = await this.getUserRoles(userId, options);
    return roles.some((role) => role.code === roleCode);
  }

  static async getRoleIdsByUserId(userId, options = {}) {
    const runQuery = options.queryExecutor || query;
    const rows = await runQuery(
      `SELECT role_id FROM user_roles WHERE user_id = ? ORDER BY role_id`,
      [userId],
    );
    return rows.map((row) => row.role_id);
  }

  static async countUsersByRoleCode(roleCode, options = {}) {
    const runQuery = options.queryExecutor || query;
    const { activeOnly = false, excludeUserId = null } = options;
    const conditions = [roleCode];
    let sql = `
      SELECT COUNT(*) as count
      FROM users u
      JOIN user_roles ur ON u.id = ur.user_id
      JOIN roles r ON ur.role_id = r.id
      WHERE r.code = ?
    `;

    if (activeOnly) {
      sql += ` AND u.status = ?`;
      conditions.push(USER_STATUS.ACTIVE);
    }

    if (excludeUserId) {
      sql += ` AND u.id <> ?`;
      conditions.push(excludeUserId);
    }

    const [result] = await runQuery(sql, conditions);
    return result?.count || 0;
  }

  // 分配角色给用户
  static async assignRole(userId, roleId, options = {}) {
    const runQuery = options.queryExecutor || query;
    const existing = await runQuery(
      `SELECT id FROM user_roles WHERE user_id = ? AND role_id = ?`,
      [userId, roleId],
    );

    if (existing.length === 0) {
      await runQuery(`INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)`, [
        userId,
        roleId,
      ]);
    }
    return true;
  }

  // 移除用户角色
  static async removeRole(userId, roleId, options = {}) {
    const runQuery = options.queryExecutor || query;
    await runQuery(`DELETE FROM user_roles WHERE user_id = ? AND role_id = ?`, [
      userId,
      roleId,
    ]);
    return true;
  }

  // 更新用户角色
  static async updateRoles(userId, roleIds, options = {}) {
    const runQuery = options.queryExecutor || query;
    const uniqueRoleIds = [...new Set((roleIds || []).filter(Boolean))];

    await runQuery(`DELETE FROM user_roles WHERE user_id = ?`, [userId]);

    for (const roleId of uniqueRoleIds) {
      await runQuery(`INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)`, [
        userId,
        roleId,
      ]);
    }
    return true;
  }

  // 更新最后登录信息
  static async updateLoginInfo(userId, ip, options = {}) {
    const runQuery = options.queryExecutor || query;
    await runQuery(
      `UPDATE users SET last_login_time = NOW(), last_login_ip = ? WHERE id = ?`,
      [ip || null, userId],
    );
  }
}

module.exports = User;
