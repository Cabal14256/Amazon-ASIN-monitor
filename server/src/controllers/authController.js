const User = require('../models/User');
const AuditLog = require('../models/AuditLog');

/**
 * 用户登录
 */
exports.login = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        errorMessage: '用户名和密码不能为空',
        errorCode: 400,
      });
    }

    // 查找用户
    const user = await User.findByUsername(username);
    const clientIp =
      req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    if (!user) {
      // 记录登录失败审计日志
      setImmediate(async () => {
        try {
          await AuditLog.create({
            username: username,
            action: 'LOGIN',
            resource: 'auth',
            method: 'POST',
            path: '/api/v1/auth/login',
            ipAddress: clientIp,
            userAgent: req.headers['user-agent'] || 'unknown',
            responseStatus: 401,
            errorMessage: '用户不存在',
          });
        } catch (error) {
          console.error('记录登录失败审计日志失败:', error.message);
        }
      });

      return res.status(401).json({
        success: false,
        errorMessage: '用户不存在',
        errorCode: 401,
      });
    }

    // 检查用户状态
    if (user.status !== 1) {
      // 记录登录失败审计日志
      setImmediate(async () => {
        try {
          await AuditLog.create({
            userId: user.id,
            username: user.username,
            action: 'LOGIN',
            resource: 'auth',
            method: 'POST',
            path: '/api/v1/auth/login',
            ipAddress: clientIp,
            userAgent: req.headers['user-agent'] || 'unknown',
            responseStatus: 403,
            errorMessage: '用户已被禁用',
          });
        } catch (error) {
          console.error('记录登录失败审计日志失败:', error.message);
        }
      });

      return res.status(403).json({
        success: false,
        errorMessage: '用户已被禁用',
        errorCode: 403,
      });
    }

    // 验证密码
    const isValidPassword = await User.verifyPassword(user, password);
    if (!isValidPassword) {
      // 记录登录失败审计日志
      setImmediate(async () => {
        try {
          await AuditLog.create({
            userId: user.id,
            username: user.username,
            action: 'LOGIN',
            resource: 'auth',
            method: 'POST',
            path: '/api/v1/auth/login',
            ipAddress: clientIp,
            userAgent: req.headers['user-agent'] || 'unknown',
            responseStatus: 401,
            errorMessage: '用户名或密码错误',
          });
        } catch (error) {
          console.error('记录登录失败审计日志失败:', error.message);
        }
      });

      return res.status(401).json({
        success: false,
        errorMessage: '用户名或密码错误',
        errorCode: 401,
      });
    }

    // 生成Token
    const token = User.generateToken(user.id);

    // 获取用户权限和角色
    const permissions = await User.getUserPermissions(user.id);
    const roles = await User.getUserRoles(user.id);

    // 更新登录信息（clientIp已在上面定义）
    await User.updateLoginInfo(user.id, clientIp);

    // 记录登录审计日志
    setImmediate(async () => {
      try {
        await AuditLog.create({
          userId: user.id,
          username: user.username,
          action: 'LOGIN',
          resource: 'auth',
          method: 'POST',
          path: '/api/v1/auth/login',
          ipAddress: clientIp,
          userAgent: req.headers['user-agent'] || 'unknown',
          responseStatus: 200,
        });
      } catch (error) {
        console.error('记录登录审计日志失败:', error.message);
      }
    });

    // 返回用户信息（不包含密码）
    const { password: _, ...userInfo } = user;

    res.json({
      success: true,
      data: {
        token,
        user: userInfo,
        permissions,
        roles: roles.map((r) => r.code),
      },
      errorCode: 0,
    });
  } catch (error) {
    console.error('登录错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '登录失败',
      errorCode: 500,
    });
  }
};

/**
 * 获取当前用户信息
 */
exports.getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        errorMessage: '用户不存在',
        errorCode: 404,
      });
    }

    const permissions = await User.getUserPermissions(req.userId);
    const roles = await User.getUserRoles(req.userId);

    res.json({
      success: true,
      data: {
        user,
        permissions,
        roles: roles.map((r) => r.code),
      },
      errorCode: 0,
    });
  } catch (error) {
    console.error('获取用户信息错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '获取用户信息失败',
      errorCode: 500,
    });
  }
};

/**
 * 用户登出（前端清除Token即可）
 */
exports.logout = async (req, res) => {
  res.json({
    success: true,
    message: '登出成功',
    errorCode: 0,
  });
};

/**
 * 修改当前用户密码
 */
exports.changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const userId = req.userId;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        errorMessage: '原密码和新密码不能为空',
        errorCode: 400,
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        errorMessage: '新密码长度至少为6位',
        errorCode: 400,
      });
    }

    // 获取用户（包含密码）
    const user = await User.findByIdWithPassword(userId);

    // 验证原密码
    const isValidPassword = await User.verifyPassword(user, oldPassword);
    if (!isValidPassword) {
      return res.status(400).json({
        success: false,
        errorMessage: '原密码错误',
        errorCode: 400,
      });
    }

    // 更新密码
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
 * 更新当前用户信息
 */
exports.updateProfile = async (req, res) => {
  try {
    const userId = req.userId;
    const { email, real_name } = req.body;

    // 检查邮箱是否已被其他用户使用（如果提供了邮箱）
    if (email) {
      const user = await User.findById(userId);
      if (email !== user.email) {
        const existingEmail = await User.findByEmail(email);
        if (existingEmail) {
          return res.status(400).json({
            success: false,
            errorMessage: '邮箱已被使用',
            errorCode: 400,
          });
        }
      }
    }

    // 更新用户信息
    const updateData = {};
    if (email !== undefined) updateData.email = email;
    if (real_name !== undefined) updateData.real_name = real_name;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        errorMessage: '没有要更新的字段',
        errorCode: 400,
      });
    }

    await User.update(userId, updateData);

    // 获取更新后的用户信息
    const updatedUser = await User.findById(userId);
    const permissions = await User.getUserPermissions(userId);
    const roles = await User.getUserRoles(userId);

    res.json({
      success: true,
      data: {
        user: updatedUser,
        permissions,
        roles: roles.map((r) => r.code),
      },
      errorCode: 0,
    });
  } catch (error) {
    console.error('更新用户信息错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '更新用户信息失败',
      errorCode: 500,
    });
  }
};
