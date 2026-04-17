const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const { secret } = require('../config/jwt');
const Session = require('../models/Session');
const User = require('../models/User');
const logger = require('../utils/logger');
const { getUTC8ISOString } = require('../utils/dateTime');
const { readAuthToken } = require('../utils/authCookie');
const {
  isUserActive,
  getUserStatusErrorMessage,
} = require('../utils/userStatus');
const {
  PASSWORD_CHANGE_REQUIRED_MESSAGE,
  isPasswordChangeRequired,
} = require('../utils/passwordPolicy');

function normalizeUserId(userId) {
  if (!userId) {
    return null;
  }
  return String(userId);
}

function normalizeHeaderValue(value) {
  if (Array.isArray(value)) {
    return value.join(', ').trim();
  }
  return typeof value === 'string' ? value.trim() : '';
}

function getRequestIpContext(req) {
  const forwardedFor = normalizeHeaderValue(req.headers['x-forwarded-for']);
  const realIp = normalizeHeaderValue(req.headers['x-real-ip']);
  const clientIp =
    forwardedFor
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)[0] ||
    realIp ||
    req.ip ||
    req.socket?.remoteAddress ||
    null;

  return {
    ip: clientIp || null,
    forwardedFor: forwardedFor || null,
    realIp: realIp || null,
    proxyIp: req.socket?.remoteAddress || null,
  };
}

async function authenticateConnection(req) {
  const token = readAuthToken(req);
  if (!token) {
    return {
      success: false,
      code: 4401,
      reason: '未提供认证令牌',
    };
  }

  try {
    const decoded = jwt.verify(token, secret);
    const sessionId = decoded.sessionId;
    const session = sessionId ? await Session.findById(sessionId) : null;

    if (!session) {
      return {
        success: false,
        code: 4401,
        reason: '会话不存在或已过期',
      };
    }

    if (session.user_id !== decoded.userId || session.status !== 'ACTIVE') {
      return {
        success: false,
        code: 4403,
        reason: '会话已失效',
      };
    }

    if (Session.isExpired(session)) {
      await Session.markExpired(sessionId);
      return {
        success: false,
        code: 4401,
        reason: '会话已过期',
      };
    }

    await Session.touch(sessionId);
    const user = await User.findByIdWithPassword(decoded.userId);

    if (!user) {
      return {
        success: false,
        code: 4401,
        reason: '用户不存在',
      };
    }

    if (!isUserActive(user.status, user.locked_until)) {
      return {
        success: false,
        code: 4403,
        reason: getUserStatusErrorMessage(user.status, user.locked_until),
      };
    }

    if (isPasswordChangeRequired(user, session)) {
      return {
        success: false,
        code: 4403,
        reason: PASSWORD_CHANGE_REQUIRED_MESSAGE,
      };
    }

    return {
      success: true,
      userId: normalizeUserId(user.id),
      sessionId,
    };
  } catch (error) {
    return {
      success: false,
      code: error?.name === 'TokenExpiredError' ? 4401 : 4403,
      reason:
        error?.name === 'TokenExpiredError'
          ? '认证令牌已过期'
          : '无效的认证令牌',
    };
  }
}

class WebSocketService {
  constructor() {
    this.wss = null;
    this.clients = new Set();
    this.clientUsers = new Map();
    this.clientSessions = new Map();
  }

  removeClient(ws) {
    this.clients.delete(ws);
    this.clientUsers.delete(ws);
    this.clientSessions.delete(ws);
  }

  closeClient(ws, code = 4403, reason = '会话已失效') {
    if (!ws) {
      return false;
    }

    if (
      ws.readyState !== WebSocket.OPEN &&
      ws.readyState !== WebSocket.CONNECTING
    ) {
      this.removeClient(ws);
      return false;
    }

    try {
      ws.close(code, reason);
      return true;
    } catch (error) {
      logger.warn('[WebSocket] 关闭客户端连接失败', {
        message: error.message,
        userId: this.clientUsers.get(ws) || null,
        sessionId: this.clientSessions.get(ws) || null,
      });
      this.removeClient(ws);
      return false;
    }
  }

  disconnectSession(sessionId, reason = '会话已失效') {
    if (!sessionId) {
      return 0;
    }

    let disconnectedCount = 0;
    Array.from(this.clientSessions.entries()).forEach(
      ([client, clientSessionId]) => {
        if (clientSessionId !== sessionId) {
          return;
        }

        if (this.closeClient(client, 4403, reason)) {
          disconnectedCount += 1;
        }
      },
    );

    return disconnectedCount;
  }

  disconnectUserSessions(userId, options = {}) {
    const targetUserId = normalizeUserId(userId);
    if (!targetUserId) {
      return 0;
    }

    const { excludeSessionId = null, reason = '会话已失效' } = options;
    let disconnectedCount = 0;

    Array.from(this.clientUsers.entries()).forEach(([client, clientUserId]) => {
      if (clientUserId !== targetUserId) {
        return;
      }

      if (
        excludeSessionId &&
        this.clientSessions.get(client) === excludeSessionId
      ) {
        return;
      }

      if (this.closeClient(client, 4403, reason)) {
        disconnectedCount += 1;
      }
    });

    return disconnectedCount;
  }

  async handleConnection(ws, req) {
    const authResult = await authenticateConnection(req);
    if (!authResult.success) {
      const ipContext = getRequestIpContext(req);
      logger.warn('[WebSocket] 已拒绝未授权连接', {
        reason: authResult.reason,
        ...ipContext,
      });
      ws.close(authResult.code, authResult.reason);
      return;
    }

    const userId = normalizeUserId(authResult.userId);
    this.clients.add(ws);
    this.clientUsers.set(ws, userId);
    this.clientSessions.set(ws, authResult.sessionId || null);

    logger.info('[WebSocket] 新客户端连接', {
      userId,
      sessionId: authResult.sessionId,
    });

    this.sendToClient(ws, {
      type: 'connected',
      message: 'WebSocket连接成功',
    });

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        logger.debug('[WebSocket] 收到客户端消息:', {
          type: data?.type,
          userId,
        });

        if (data.type === 'ping') {
          this.sendToClient(ws, { type: 'pong' });
        }
      } catch (error) {
        logger.error('[WebSocket] 解析客户端消息失败:', {
          message: error.message,
          userId,
        });
      }
    });

    ws.on('close', () => {
      logger.info('[WebSocket] 客户端断开连接', {
        userId,
      });
      this.removeClient(ws);
    });

    ws.on('error', (error) => {
      logger.error('[WebSocket] 连接错误:', {
        message: error.message,
        userId,
      });
      this.removeClient(ws);
    });
  }

  /**
   * 初始化WebSocket服务器
   * @param {http.Server} server HTTP服务器实例
   */
  init(server) {
    this.wss = new WebSocket.Server({ server, path: '/ws' });

    this.wss.on('connection', (ws, req) => {
      void this.handleConnection(ws, req);
    });

    logger.info('[WebSocket] WebSocket服务器已启动，路径: /ws');
  }

  /**
   * 发送消息给指定客户端
   */
  sendToClient(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(data));
      } catch (error) {
        logger.error('[WebSocket] 发送消息失败:', {
          message: error.message,
          userId: this.clientUsers.get(ws) || null,
        });
      }
    }
  }

  /**
   * 广播消息给所有客户端
   */
  broadcast(data) {
    const message = JSON.stringify(data);
    this.clients.forEach((client) => {
      if (client.readyState !== WebSocket.OPEN) {
        return;
      }

      try {
        client.send(message);
      } catch (error) {
        logger.error('[WebSocket] 广播消息失败:', {
          message: error.message,
          userId: this.clientUsers.get(client) || null,
        });
      }
    });
  }

  broadcastToUser(userId, data) {
    const targetUserId = normalizeUserId(userId);
    const message = JSON.stringify(data);

    this.clients.forEach((client) => {
      if (client.readyState !== WebSocket.OPEN) {
        return;
      }

      if (this.clientUsers.get(client) !== targetUserId) {
        return;
      }

      try {
        client.send(message);
      } catch (error) {
        logger.error('[WebSocket] 定向发送消息失败:', {
          message: error.message,
          userId: targetUserId,
        });
      }
    });
  }

  /**
   * 发送监控任务进度
   */
  sendMonitorProgress(data) {
    this.broadcast({
      type: 'monitor_progress',
      ...data,
    });
  }

  /**
   * 发送监控任务完成
   */
  sendMonitorComplete(data) {
    this.broadcast({
      type: 'monitor_complete',
      ...data,
    });
  }

  /**
   * 发送统计数据更新
   */
  sendStatsUpdate(data) {
    this.broadcast({
      type: 'stats_update',
      ...data,
    });
  }

  /**
   * 获取连接数
   */
  getClientCount() {
    return this.clients.size;
  }

  /**
   * 发送任务进度（支持按用户ID发送）
   * @param {string} taskId - 任务ID
   * @param {number} progress - 进度百分比 (0-100)
   * @param {string} message - 进度消息
   * @param {string} userId - 用户ID（可选，如果提供则只发送给该用户）
   */
  sendTaskProgress(taskId, progress, message, userId = null) {
    const data = {
      type: 'task_progress',
      taskId,
      progress,
      message,
      timestamp: getUTC8ISOString(),
    };

    if (userId) {
      this.broadcastToUser(userId, data);
      return;
    }

    this.broadcast(data);
  }

  /**
   * 发送任务完成通知
   * @param {string} taskId - 任务ID
   * @param {string} downloadUrl - 下载URL
   * @param {string} filename - 文件名
   * @param {string} userId - 用户ID（可选）
   */
  sendTaskComplete(taskId, downloadUrl, filename, userId = null) {
    const data = {
      type: 'task_complete',
      taskId,
      downloadUrl,
      filename,
      timestamp: getUTC8ISOString(),
    };

    if (userId) {
      this.broadcastToUser(userId, data);
      return;
    }

    this.broadcast(data);
  }

  /**
   * 发送任务错误通知
   * @param {string} taskId - 任务ID
   * @param {string} error - 错误信息
   * @param {string} userId - 用户ID（可选）
   */
  sendTaskError(taskId, error, userId = null) {
    const data = {
      type: 'task_error',
      taskId,
      error,
      timestamp: getUTC8ISOString(),
    };

    if (userId) {
      this.broadcastToUser(userId, data);
      return;
    }

    this.broadcast(data);
  }

  /**
   * 发送任务取消通知
   * @param {string} taskId - 任务ID
   * @param {string} message - 取消说明
   * @param {string} userId - 用户ID（可选）
   */
  sendTaskCancelled(taskId, message = '任务已取消', userId = null) {
    const data = {
      type: 'task_cancelled',
      taskId,
      message,
      timestamp: getUTC8ISOString(),
    };

    if (userId) {
      this.broadcastToUser(userId, data);
      return;
    }

    this.broadcast(data);
  }
}

module.exports = new WebSocketService();
