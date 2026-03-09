const { query } = require('../config/database');

class Role {
  // 查询所有角色
  static async findAll(options = {}) {
    const runQuery = options.queryExecutor || query;
    const list = await runQuery(`SELECT * FROM roles ORDER BY code ASC`);
    return list;
  }

  // 根据ID查找角色
  static async findById(id, options = {}) {
    const runQuery = options.queryExecutor || query;
    const [role] = await runQuery(`SELECT * FROM roles WHERE id = ?`, [id]);
    return role;
  }

  // 根据代码查找角色
  static async findByCode(code, options = {}) {
    const runQuery = options.queryExecutor || query;
    const [role] = await runQuery(`SELECT * FROM roles WHERE code = ?`, [code]);
    return role;
  }

  static async findByIds(roleIds = [], options = {}) {
    const runQuery = options.queryExecutor || query;
    const uniqueRoleIds = [...new Set((roleIds || []).filter(Boolean))];
    if (!uniqueRoleIds.length) {
      return [];
    }

    const placeholders = uniqueRoleIds.map(() => '?').join(', ');
    return runQuery(
      `SELECT * FROM roles WHERE id IN (${placeholders}) ORDER BY code ASC`,
      uniqueRoleIds,
    );
  }

  // 获取角色的所有权限
  static async getRolePermissions(roleId, options = {}) {
    const runQuery = options.queryExecutor || query;
    const permissions = await runQuery(
      `SELECT p.*
       FROM role_permissions rp
       JOIN permissions p ON rp.permission_id = p.id
       WHERE rp.role_id = ?
       ORDER BY p.code`,
      [roleId],
    );
    return permissions;
  }

  // 更新角色权限
  static async updateRolePermissions(roleId, permissionIds = [], options = {}) {
    const runQuery = options.queryExecutor || query;
    await runQuery(`DELETE FROM role_permissions WHERE role_id = ?`, [roleId]);

    if (!permissionIds.length) {
      return;
    }

    for (const permissionId of permissionIds) {
      await runQuery(
        `INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)`,
        [roleId, permissionId],
      );
    }
  }

  // 获取拥有该角色的用户ID
  static async getUserIdsByRoleId(roleId, options = {}) {
    const runQuery = options.queryExecutor || query;
    const users = await runQuery(
      `SELECT user_id FROM user_roles WHERE role_id = ?`,
      [roleId],
    );
    return users.map((item) => item.user_id);
  }
}

module.exports = Role;
