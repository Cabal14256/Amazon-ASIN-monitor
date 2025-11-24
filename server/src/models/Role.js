const { query } = require('../config/database');

class Role {
  // 查询所有角色
  static async findAll() {
    const list = await query(
      `SELECT * FROM roles ORDER BY code ASC`,
    );
    return list;
  }

  // 根据ID查找角色
  static async findById(id) {
    const [role] = await query(
      `SELECT * FROM roles WHERE id = ?`,
      [id],
    );
    return role;
  }

  // 根据代码查找角色
  static async findByCode(code) {
    const [role] = await query(
      `SELECT * FROM roles WHERE code = ?`,
      [code],
    );
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
}

module.exports = Role;

