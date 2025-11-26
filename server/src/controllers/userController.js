const User = require('../models/User');
const Role = require('../models/Role');

/**
 * 获取用户列表
 */
exports.getUserList = async (req, res) => {
  try {
    console.log('[getUserList] 开始获取用户列表', {
      query: req.query,
      userId: req.userId,
    });
    const { username, status, current = 1, pageSize = 10 } = req.query;

    const result = await User.findAll({
      username,
      status,
      current: Number(current),
      pageSize: Number(pageSize),
    });
    console.log('[getUserList] 查询结果:', {
      total: result.total,
      listLength: result.list.length,
    });

    // 为每个用户获取角色信息
    const usersWithRoles = await Promise.all(
      result.list.map(async (user) => {
        const roles = await User.getUserRoles(user.id);
        return {
          ...user,
          roles: roles.map((r) => ({ id: r.id, code: r.code, name: r.name })),
        };
      }),
    );

    res.json({
      success: true,
      data: {
        list: usersWithRoles,
        total: result.total,
      },
      errorCode: 0,
    });
  } catch (error) {
    console.error('获取用户列表错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '获取用户列表失败',
      errorCode: 500,
    });
  }
};

/**
 * 获取用户详情
 */
exports.getUserDetail = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        errorMessage: '用户不存在',
        errorCode: 404,
      });
    }

    // 获取用户角色
    const roles = await User.getUserRoles(userId);
    const permissions = await User.getUserPermissions(userId);

    res.json({
      success: true,
      data: {
        ...user,
        roles: roles.map((r) => ({ id: r.id, code: r.code, name: r.name })),
        permissions,
      },
      errorCode: 0,
    });
  } catch (error) {
    console.error('获取用户详情错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '获取用户详情失败',
      errorCode: 500,
    });
  }
};

/**
 * 创建用户
 */
exports.createUser = async (req, res) => {
  try {
    const { username, password, real_name, roleIds } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        errorMessage: '用户名和密码不能为空',
        errorCode: 400,
      });
    }

    // 检查用户名是否已存在
    const existingUser = await User.findByUsername(username);
    if (existingUser) {
      return res.status(400).json({
        success: false,
        errorMessage: '用户名已存在',
        errorCode: 400,
      });
    }

    // 检查邮箱是否已存在（如果提供了邮箱）
    // 创建用户
    const user = await User.create({
      username,
      password,
      real_name,
    });

    // 分配角色
    if (roleIds && roleIds.length > 0) {
      await User.updateRoles(user.id, roleIds);
    }

    // 获取用户角色
    const roles = await User.getUserRoles(user.id);

    res.json({
      success: true,
      data: {
        ...user,
        roles: roles.map((r) => ({ id: r.id, code: r.code, name: r.name })),
      },
      errorCode: 0,
    });
  } catch (error) {
    console.error('创建用户错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '创建用户失败',
      errorCode: 500,
    });
  }
};

/**
 * 更新用户
 */
exports.updateUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { real_name, status, roleIds } = req.body;

    // 检查用户是否存在
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        errorMessage: '用户不存在',
        errorCode: 404,
      });
    }

    // 检查邮箱是否已被其他用户使用（如果提供了邮箱）
    // 更新用户信息
    const updateData = {};
    if (real_name !== undefined) updateData.real_name = real_name;
    if (status !== undefined) updateData.status = status;

    if (Object.keys(updateData).length > 0) {
      await User.update(userId, updateData);
    }

    // 更新角色
    if (roleIds !== undefined) {
      await User.updateRoles(userId, roleIds);
    }

    // 获取更新后的用户信息
    const updatedUser = await User.findById(userId);
    const roles = await User.getUserRoles(userId);

    res.json({
      success: true,
      data: {
        ...updatedUser,
        roles: roles.map((r) => ({ id: r.id, code: r.code, name: r.name })),
      },
      errorCode: 0,
    });
  } catch (error) {
    console.error('更新用户错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '更新用户失败',
      errorCode: 500,
    });
  }
};

/**
 * 删除用户
 */
exports.deleteUser = async (req, res) => {
  try {
    const { userId } = req.params;

    // 不能删除自己
    if (userId === req.userId) {
      return res.status(400).json({
        success: false,
        errorMessage: '不能删除自己的账户',
        errorCode: 400,
      });
    }

    // 检查用户是否存在
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        errorMessage: '用户不存在',
        errorCode: 404,
      });
    }

    await User.delete(userId);

    res.json({
      success: true,
      message: '删除成功',
      errorCode: 0,
    });
  } catch (error) {
    console.error('删除用户错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '删除用户失败',
      errorCode: 500,
    });
  }
};

/**
 * 修改密码（管理员修改其他用户密码）
 */
exports.updateUserPassword = async (req, res) => {
  try {
    const { userId } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        errorMessage: '密码长度至少为6位',
        errorCode: 400,
      });
    }

    // 检查用户是否存在
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        errorMessage: '用户不存在',
        errorCode: 404,
      });
    }

    await User.updatePassword(userId, newPassword);

    res.json({
      success: true,
      message: '密码修改成功',
      errorCode: 0,
    });
  } catch (error) {
    console.error('修改密码错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '修改密码失败',
      errorCode: 500,
    });
  }
};

/**
 * 获取所有角色（用于下拉选择）
 */
exports.getAllRoles = async (req, res) => {
  try {
    const roles = await Role.findAll();
    res.json({
      success: true,
      data: roles,
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
