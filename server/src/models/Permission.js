const { query } = require('../config/database');

class Permission {
  // 查询所有权限
  static async findAll() {
    const list = await query(
      `SELECT * FROM permissions ORDER BY resource, action`,
    );
    return list;
  }

  // 根据ID查找权限
  static async findById(id) {
    const [permission] = await query(
      `SELECT * FROM permissions WHERE id = ?`,
      [id],
    );
    return permission;
  }

  // 根据代码查找权限
  static async findByCode(code) {
    const [permission] = await query(
      `SELECT * FROM permissions WHERE code = ?`,
      [code],
    );
    return permission;
  }

  // 根据资源查找权限
  static async findByResource(resource) {
    const list = await query(
      `SELECT * FROM permissions WHERE resource = ? ORDER BY action`,
      [resource],
    );
    return list;
  }
}

module.exports = Permission;

