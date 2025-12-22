const AuditLog = require('../models/AuditLog');

/**
 * 操作审计日志中间件
 * 只记录对数据有修改的操作（CREATE, UPDATE, DELETE, EXPORT等）
 * 不记录只读操作（GET请求中的查看操作）
 */
async function auditLogMiddleware(req, res, next) {
  // 保存原始的res.json方法
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  // 获取用户信息（从JWT token中解析或从请求中获取）
  let userId = null;
  let username = null;

  if (req.user) {
    userId = req.user.userId || req.user.id;
    username = req.user.username;
  } else if (req.body && req.body.username) {
    // 对于登录等未认证的请求，从请求体中获取用户名
    username = req.body.username;
  }

  // 获取请求信息
  const method = req.method;
  const path = req.path;
  // 获取IP地址（考虑代理情况）
  const ipAddress =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    req.ip ||
    'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';

  // 确定操作类型和资源类型
  let action = 'UNKNOWN';
  let resource = null;
  let resourceId = null;
  let resourceName = null;

  // 根据路径和方法确定操作类型
  // 只记录修改操作，不记录只读操作（GET请求中的查看操作）
  if (path.includes('/login')) {
    action = 'LOGIN';
    resource = 'auth';
  } else if (path.includes('/logout')) {
    action = 'LOGOUT';
    resource = 'auth';
  } else if (path.includes('/variant-groups')) {
    resource = 'variant_group';
    if (method === 'POST') {
      action = 'CREATE';
      resourceName = req.body?.name || null;
      resourceId = req.body?.id || null;
    } else if (method === 'PUT') {
      action = 'UPDATE';
      resourceId = req.params?.groupId || null;
      // 更新时尝试从请求体获取名称
      resourceName = req.body?.name || null;
    } else if (method === 'DELETE') {
      action = 'DELETE';
      resourceId = req.params?.groupId || null;
      // 删除时使用ID作为资源名称
      resourceName = resourceId
        ? `变体组 ${resourceId.substring(0, 8)}...`
        : null;
    }
    // GET请求不记录（只读操作）
  } else if (path.includes('/asins')) {
    resource = 'asin';
    if (method === 'POST') {
      action = 'CREATE';
      resourceName = req.body?.asin || null;
      resourceId = req.body?.id || null;
    } else if (method === 'PUT') {
      action = 'UPDATE';
      resourceId = req.params?.asinId || null;
      // 更新时尝试从请求体获取ASIN
      resourceName = req.body?.asin || null;
    } else if (method === 'DELETE') {
      action = 'DELETE';
      resourceId = req.params?.asinId || null;
      // 删除时使用ID作为资源名称
      resourceName = resourceId
        ? `ASIN ${resourceId.substring(0, 8)}...`
        : null;
    }
    // GET请求不记录（只读操作）
  } else if (path.includes('/users')) {
    resource = 'user';
    if (method === 'POST') {
      action = 'CREATE';
      resourceName = req.body?.username || null;
      resourceId = req.body?.id || null;
    } else if (method === 'PUT') {
      action = 'UPDATE';
      resourceId = req.params?.userId || null;
      // 更新时尝试从请求体获取用户名
      resourceName = req.body?.username || null;
    } else if (method === 'DELETE') {
      action = 'DELETE';
      resourceId = req.params?.userId || null;
      // 删除时使用ID作为资源名称
      resourceName = resourceId
        ? `用户 ${resourceId.substring(0, 8)}...`
        : null;
    }
    // GET请求不记录（只读操作）
  } else if (path.includes('/roles') && method !== 'GET') {
    resource = 'role';
    action = method; // POST, PUT, DELETE等
  } else if (path.includes('/permissions') && method !== 'GET') {
    resource = 'permission';
    action = method; // POST, PUT, DELETE等
  } else if (path.includes('/feishu-configs')) {
    resource = 'feishu_config';
    if (method === 'POST' || method === 'PUT') {
      action = 'UPDATE';
      // 从请求体获取区域信息
      resourceName = req.body?.country || req.body?.region || '飞书配置';
    }
    // GET请求不记录（只读操作）
  } else if (path.includes('/sp-api-configs')) {
    resource = 'sp_api_config';
    if (method === 'POST' || method === 'PUT') {
      action = 'UPDATE';
      resourceName = 'SP-API配置';
    }
    // GET请求不记录（只读操作）
  } else if (path.includes('/export')) {
    action = 'EXPORT';
    resource = path.includes('/asin')
      ? 'asin'
      : path.includes('/monitor')
      ? 'monitor_history'
      : 'unknown';
  } else if (path.includes('/monitor/trigger')) {
    action = 'TRIGGER_MONITOR';
    resource = 'monitor';
  } else if (
    path.includes('/auth/change-password') ||
    path.includes('/auth/profile')
  ) {
    // 修改密码和更新个人资料也算修改操作
    resource = 'auth';
    if (path.includes('/change-password')) {
      action = 'CHANGE_PASSWORD';
    } else if (path.includes('/profile')) {
      action = 'UPDATE_PROFILE';
    }
  }

  // 准备请求数据（排除敏感信息）
  const requestData = { ...req.body };
  if (requestData.password) {
    requestData.password = '***';
  }
  if (requestData.oldPassword) {
    requestData.oldPassword = '***';
  }
  if (requestData.newPassword) {
    requestData.newPassword = '***';
  }

  // 重写res.json和res.send以捕获响应状态
  let responseStatus = 200;
  let errorMessage = null;

  res.json = function (data) {
    // 检查响应是否已经发送
    if (res.headersSent) {
      return res;
    }
    responseStatus = res.statusCode || 200;
    if (data && data.success === false) {
      errorMessage = data.errorMessage || data.message || 'Unknown error';
    }
    return originalJson(data);
  };

  res.send = function (data) {
    // 检查响应是否已经发送
    if (res.headersSent) {
      return res;
    }
    responseStatus = res.statusCode || 200;
    return originalSend(data);
  };

  // 继续处理请求
  next();

  // 只记录修改操作，跳过只读操作（READ）和未识别的操作（UNKNOWN）
  const shouldLog = action !== 'UNKNOWN' && action !== 'READ';

  // 异步记录审计日志（不阻塞请求）
  if (shouldLog) {
    setImmediate(async () => {
      try {
        await AuditLog.create({
          userId,
          username,
          action,
          resource,
          resourceId,
          resourceName,
          method,
          path,
          ipAddress,
          userAgent,
          requestData: Object.keys(requestData).length > 0 ? requestData : null,
          responseStatus,
          errorMessage,
        });
      } catch (error) {
        // 记录审计日志失败不应该影响主流程
        console.error('记录审计日志失败:', error.message);
      }
    });
  }
}

module.exports = auditLogMiddleware;
