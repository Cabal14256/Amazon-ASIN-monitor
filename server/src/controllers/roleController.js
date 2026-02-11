const Role = require('../models/Role');
const Permission = require('../models/Permission');
const logger = require('../utils/logger');
const permissionCacheService = require('../services/permissionCacheService');

/**
 * 获取所有角色
 */
exports.getRoleList = async (req, res) => {
  try {
    logger.debug('[getRoleList] 开始获取角色列表', {
      userId: req.userId,
    });
    const roles = await Role.findAll();
    logger.debug('[getRoleList] 查询到角色数量:', roles.length);

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
    logger.error('获取角色列表错误:', error);
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
    logger.error('获取角色详情错误:', error);
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
    logger.debug('[getPermissionList] 开始获取权限列表', {
      userId: req.userId,
    });
    const permissions = await Permission.findAll();
    logger.debug('[getPermissionList] 查询到权限数量:', permissions.length);

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
    logger.error('获取权限列表错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '获取权限列表失败',
      errorCode: 500,
    });
  }
};

/**
 * 更新角色权限（仅管理员）
 */
exports.updateRolePermissions = async (req, res) => {
  try {
    const { roleId } = req.params;
    const { permissionIds } = req.body;

    if (!Array.isArray(permissionIds)) {
      return res.status(400).json({
        success: false,
        errorMessage: 'permissionIds 必须是数组',
        errorCode: 400,
      });
    }

    const role = await Role.findById(roleId);
    if (!role) {
      return res.status(404).json({
        success: false,
        errorMessage: '角色不存在',
        errorCode: 404,
      });
    }

    const uniquePermissionIds = [...new Set(permissionIds.filter(Boolean))];

    const allPermissions = await Permission.findAll();
    const validPermissionIdSet = new Set(allPermissions.map((p) => p.id));
    const hasInvalidPermission = uniquePermissionIds.some(
      (id) => !validPermissionIdSet.has(id),
    );

    if (hasInvalidPermission) {
      return res.status(400).json({
        success: false,
        errorMessage: '包含无效权限ID',
        errorCode: 400,
      });
    }

    // 防止当前管理员误操作，导致自己失去用户管理权限
    if (role.code === 'ADMIN' && req.userId) {
      const operatorRoles = await Role.getUserIdsByRoleId(role.id);
      const isOperatorInAdminRole = operatorRoles.includes(req.userId);

      if (isOperatorInAdminRole) {
        const requiredCodes = ['user:read', 'user:write'];
        const permissionCodeMap = new Map(
          allPermissions.map((p) => [p.id, p.code]),
        );
        const selectedCodes = uniquePermissionIds.map((id) =>
          permissionCodeMap.get(id),
        );
        const missingRequired = requiredCodes.filter(
          (code) => !selectedCodes.includes(code),
        );

        if (missingRequired.length > 0) {
          logger.warn('[updateRolePermissions] 阻止管理员误移除关键权限', {
            operatorUserId: req.userId,
            roleId,
            missingRequired,
          });
          return res.status(400).json({
            success: false,
            errorMessage: `ADMIN 角色必须保留权限: ${missingRequired.join(
              ', ',
            )}`,
            errorCode: 400,
          });
        }
      }
    }

    await Role.updateRolePermissions(roleId, uniquePermissionIds);

    const affectedUserIds = await Role.getUserIdsByRoleId(roleId);
    await Promise.all(
      affectedUserIds.map((userId) =>
        permissionCacheService.clearUserCache(userId),
      ),
    );

    logger.info('[updateRolePermissions] 角色权限更新成功', {
      operatorUserId: req.userId,
      roleId,
      permissionCount: uniquePermissionIds.length,
      affectedUsers: affectedUserIds.length,
    });

    const permissions = await Role.getRolePermissions(roleId);
    res.json({
      success: true,
      data: {
        roleId,
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
    logger.error('[updateRolePermissions] 更新角色权限失败', {
      message: error.message,
      roleId: req.params?.roleId,
      operatorUserId: req.userId,
    });
    res.status(500).json({
      success: false,
      errorMessage: error.message || '更新角色权限失败',
      errorCode: 500,
    });
  }
};
