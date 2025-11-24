const User = require('../models/User');

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
    if (!user) {
      return res.status(401).json({
        success: false,
        errorMessage: '用户名或密码错误',
        errorCode: 401,
      });
    }

    // 检查用户状态
    if (user.status !== 1) {
      return res.status(403).json({
        success: false,
        errorMessage: '用户已被禁用',
        errorCode: 403,
      });
    }

    // 验证密码
    const isValidPassword = await User.verifyPassword(user, password);
    if (!isValidPassword) {
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

    // 更新登录信息
    const clientIp =
      req.ip ||
      req.headers['x-forwarded-for'] ||
      req.connection.remoteAddress;
    await User.updateLoginInfo(user.id, clientIp);

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

