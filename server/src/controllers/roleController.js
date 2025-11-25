const Role = require('../models/Role');
const Permission = require('../models/Permission');

/**
 * 获取所有角色
 */
exports.getRoleList = async (req, res) => {
  try {
    console.log('[getRoleList] 开始获取角色列表', {
      userId: req.userId,
    });
    const roles = await Role.findAll();
    console.log('[getRoleList] 查询到角色数量:', roles.length);

    // 为每个角色获取权限信息
    const rolesWithPermissions = await Promise.all(
      roles.map(async (role) => {
        const permissions = await Role.getRolePermissions(role.id);
        return {
          ...role,
          permissions: permissions.map((p) => ({
            id: p.id,
            code: p.code,
            name: p.name,
            resource: p.resource,
            action: p.action,
          })),
        };
      }),
    );

    res.json({
      success: true,
      data: rolesWithPermissions,
      errorCode: 0,
    });
  } catch (error) {
    console.error('获取角色列表错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '获取角色列表失败',
      errorCode: 500,
    });
  }
};

/**
 * 获取角色详情
 */
exports.getRoleDetail = async (req, res) => {
  try {
    const { roleId } = req.params;
    const role = await Role.findById(roleId);

    if (!role) {
      return res.status(404).json({
        success: false,
        errorMessage: '角色不存在',
        errorCode: 404,
      });
    }

    // 获取角色权限
    const permissions = await Role.getRolePermissions(roleId);

    res.json({
      success: true,
      data: {
        ...role,
        permissions: permissions.map((p) => ({
          id: p.id,
          code: p.code,
          name: p.name,
          resource: p.resource,
          action: p.action,
        })),
      },
      errorCode: 0,
    });
  } catch (error) {
    console.error('获取角色详情错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '获取角色详情失败',
      errorCode: 500,
    });
  }
};

/**
 * 获取所有权限（用于权限管理页面）
 */
exports.getPermissionList = async (req, res) => {
  try {
    console.log('[getPermissionList] 开始获取权限列表', {
      userId: req.userId,
    });
    const permissions = await Permission.findAll();
    console.log('[getPermissionList] 查询到权限数量:', permissions.length);

    // 按资源分组
    const groupedPermissions = permissions.reduce((acc, perm) => {
      const resource = perm.resource || 'other';
      if (!acc[resource]) {
        acc[resource] = [];
      }
      acc[resource].push({
        id: perm.id,
        code: perm.code,
        name: perm.name,
        resource: perm.resource,
        action: perm.action,
        description: perm.description,
      });
      return acc;
    }, {});

    res.json({
      success: true,
      data: {
        list: permissions,
        grouped: groupedPermissions,
      },
      errorCode: 0,
    });
  } catch (error) {
    console.error('获取权限列表错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '获取权限列表失败',
      errorCode: 500,
    });
  }
};
