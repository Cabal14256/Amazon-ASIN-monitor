const WebSocket = require('ws');
const logger = require('../utils/logger');

class WebSocketService {
  constructor() {
    this.wss = null;
    this.clients = new Set();
  }

  /**
   * 初始化WebSocket服务器
   * @param {http.Server} server HTTP服务器实例
   */
  init(server) {
    this.wss = new WebSocket.Server({ server, path: '/ws' });

    this.wss.on('connection', (ws, req) => {
      logger.info('[WebSocket] 新客户端连接');
      this.clients.add(ws);

      // 发送连接成功消息
      this.sendToClient(ws, {
        type: 'connected',
        message: 'WebSocket连接成功',
      });

      // 处理客户端消息
      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message.toString());
          logger.debug('[WebSocket] 收到客户端消息:', data);

          // 可以在这里处理客户端发送的消息
          if (data.type === 'ping') {
            this.sendToClient(ws, { type: 'pong' });
          }
        } catch (error) {
          logger.error('[WebSocket] 解析客户端消息失败:', error);
        }
      });

      // 处理连接关闭
      ws.on('close', () => {
        logger.info('[WebSocket] 客户端断开连接');
        this.clients.delete(ws);
      });

      // 处理错误
      ws.on('error', (error) => {
        logger.error('[WebSocket] 连接错误:', error);
        this.clients.delete(ws);
      });
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
        logger.error('[WebSocket] 发送消息失败:', error);
      }
    }
  }

  /**
   * 广播消息给所有客户端
   */
  broadcast(data) {
    const message = JSON.stringify(data);
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
        } catch (error) {
          logger.error('[WebSocket] 广播消息失败:', error);
        }
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
      timestamp: new Date().toISOString(),
    };

    if (userId) {
      // 如果指定了用户ID，只发送给该用户（需要客户端在连接时传递用户信息）
      // 这里先广播，后续可以优化为按用户发送
      this.broadcast(data);
    } else {
      this.broadcast(data);
    }
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
      timestamp: new Date().toISOString(),
    };

    if (userId) {
      this.broadcast(data);
    } else {
      this.broadcast(data);
    }
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
      timestamp: new Date().toISOString(),
    };

    if (userId) {
      this.broadcast(data);
    } else {
      this.broadcast(data);
    }
  }
}

module.exports = new WebSocketService();
