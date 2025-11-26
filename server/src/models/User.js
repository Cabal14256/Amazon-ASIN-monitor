const { query } = require('../config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { secret, expiresIn } = require('../config/jwt');
const { v4: uuidv4 } = require('uuid');

class User {
  // 根据ID查找用户（不包含密码）
  static async findById(id) {
    const [user] = await query(
      `SELECT id, username, real_name, status, last_login_time, last_login_ip, create_time, update_time 
       FROM users WHERE id = ?`,
      [id],
    );
    return user;
  }

  // 根据ID查找用户（包含密码，用于登录验证）
  static async findByIdWithPassword(id) {
    const [user] = await query(`SELECT * FROM users WHERE id = ?`, [id]);
    return user;
  }

  // 根据用户名查找用户
  static async findByUsername(username) {
    const [user] = await query(`SELECT * FROM users WHERE username = ?`, [
      username,
    ]);
    return user;
  }

  // 查询所有用户（分页）
  static async findAll(params = {}) {
    const { username = '', status = '', current = 1, pageSize = 10 } = params;

    let sql = `
      SELECT id, username, real_name, status, last_login_time, last_login_ip, create_time, update_time
      FROM users
      WHERE 1=1
    `;
    const conditions = [];

    if (username) {
      sql += ` AND username LIKE ?`;
      conditions.push(`%${username}%`);
    }

    if (status !== '') {
      sql += ` AND status = ?`;
      conditions.push(status === '1' ? 1 : 0);
    }

    // 获取总数
    const countSql = sql.replace(
      /SELECT[\s\S]*?FROM/,
      'SELECT COUNT(*) as total FROM',
    );
    const countResult = await query(countSql, conditions);
    const total = countResult[0]?.total || 0;

    // 分页
    const offset = (Number(current) - 1) * Number(pageSize);
    const limit = Number(pageSize);
    sql += ` ORDER BY create_time DESC LIMIT ${limit} OFFSET ${offset}`;

    const list = await query(sql, conditions);
    return { list, total };
  }

  // 创建用户
  static async create(userData) {
    const { username, password, real_name } = userData;
    const id = uuidv4();
    const hashedPassword = await bcrypt.hash(password, 10);

    await query(
      `INSERT INTO users (id, username, password, real_name) VALUES (?, ?, ?, ?)`,
      [id, username, hashedPassword, real_name || null],
    );

    return this.findById(id);
  }

  // 更新用户
  static async update(id, userData) {
    const { real_name, status } = userData;
    const updates = [];
    const values = [];

    if (real_name !== undefined) {
      updates.push('real_name = ?');
      values.push(real_name);
    }
    if (status !== undefined) {
      updates.push('status = ?');
      values.push(status === '1' ? 1 : 0);
    }

    if (updates.length === 0) {
      return this.findById(id);
    }

    values.push(id);
    await query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);

    return this.findById(id);
  }

  // 更新密码
  static async updatePassword(id, newPassword) {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await query(`UPDATE users SET password = ? WHERE id = ?`, [
      hashedPassword,
      id,
    ]);
    return true;
  }

  // 删除用户
  static async delete(id) {
    await query(`DELETE FROM users WHERE id = ?`, [id]);
    return true;
  }

  // 验证密码
  static async verifyPassword(user, password) {
    return await bcrypt.compare(password, user.password);
  }

  // 生成JWT Token
  static generateToken(userId) {
    return jwt.sign({ userId }, secret, { expiresIn });
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
  static async hasPermission(userId, permissionCode) {
    const [result] = await query(
      `SELECT COUNT(*) as count
       FROM user_roles ur
       JOIN role_permissions rp ON ur.role_id = rp.role_id
       JOIN permissions p ON rp.permission_id = p.id
       WHERE ur.user_id = ? AND p.code = ?`,
      [userId, permissionCode],
    );
    return result.count > 0;
  }

  // 获取用户的所有权限
  static async getUserPermissions(userId) {
    const permissions = await query(
      `SELECT p.code, p.name, p.resource, p.action
       FROM user_roles ur
       JOIN role_permissions rp ON ur.role_id = rp.role_id
       JOIN permissions p ON rp.permission_id = p.id
       WHERE ur.user_id = ?
       ORDER BY p.code`,
      [userId],
    );
    return permissions.map((p) => p.code);
  }

  // 获取用户的角色
  static async getUserRoles(userId) {
    const roles = await query(
      `SELECT r.id, r.code, r.name
       FROM user_roles ur
       JOIN roles r ON ur.role_id = r.id
       WHERE ur.user_id = ?
       ORDER BY r.code`,
      [userId],
    );
    return roles;
  }

  // 分配角色给用户
  static async assignRole(userId, roleId) {
    const existing = await query(
      `SELECT id FROM user_roles WHERE user_id = ? AND role_id = ?`,
      [userId, roleId],
    );

    if (existing.length === 0) {
      await query(`INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)`, [
        userId,
        roleId,
      ]);
    }
    return true;
  }

  // 移除用户角色
  static async removeRole(userId, roleId) {
    await query(`DELETE FROM user_roles WHERE user_id = ? AND role_id = ?`, [
      userId,
      roleId,
    ]);
    return true;
  }

  // 更新用户角色
  static async updateRoles(userId, roleIds) {
    // 先删除所有角色
    await query(`DELETE FROM user_roles WHERE user_id = ?`, [userId]);

    // 添加新角色
    if (roleIds && roleIds.length > 0) {
      for (const roleId of roleIds) {
        await query(`INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)`, [
          userId,
          roleId,
        ]);
      }
    }
    return true;
  }

  // 更新最后登录信息
  static async updateLoginInfo(userId, ip) {
    await query(
      `UPDATE users SET last_login_time = NOW(), last_login_ip = ? WHERE id = ?`,
      [ip || null, userId],
    );
  }
}

module.exports = User;
