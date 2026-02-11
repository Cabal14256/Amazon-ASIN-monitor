const { query } = require('../config/database');

class Role {
  // 查询所有角色
  static async findAll() {
    const list = await query(`SELECT * FROM roles ORDER BY code ASC`);
    return list;
  }

  // 根据ID查找角色
  static async findById(id) {
    const [role] = await query(`SELECT * FROM roles WHERE id = ?`, [id]);
    return role;
  }

  // 根据代码查找角色
  static async findByCode(code) {
    const [role] = await query(`SELECT * FROM roles WHERE code = ?`, [code]);
    return role;
  }

  // 获取角色的所有权限
  static async getRolePermissions(roleId) {
    const permissions = await query(
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
  static async updateRolePermissions(roleId, permissionIds = []) {
    await query(`DELETE FROM role_permissions WHERE role_id = ?`, [roleId]);

    if (!permissionIds.length) {
      return;
    }

    const values = permissionIds.map((permissionId) => [roleId, permissionId]);
    await query(
      `INSERT INTO role_permissions (role_id, permission_id) VALUES ?`,
      [values],
    );
  }

  // 获取拥有该角色的用户ID
  static async getUserIdsByRoleId(roleId) {
    const users = await query(
      `SELECT user_id FROM user_roles WHERE role_id = ?`,
      [roleId],
    );
    return users.map((item) => item.user_id);
  }
}

module.exports = Role;
