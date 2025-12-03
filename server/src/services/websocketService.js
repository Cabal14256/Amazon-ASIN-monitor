const WebSocket = require('ws');

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
      console.log('[WebSocket] 新客户端连接');
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
          console.log('[WebSocket] 收到客户端消息:', data);
          
          // 可以在这里处理客户端发送的消息
          if (data.type === 'ping') {
            this.sendToClient(ws, { type: 'pong' });
          }
        } catch (error) {
          console.error('[WebSocket] 解析客户端消息失败:', error);
        }
      });

      // 处理连接关闭
      ws.on('close', () => {
        console.log('[WebSocket] 客户端断开连接');
        this.clients.delete(ws);
      });

      // 处理错误
      ws.on('error', (error) => {
        console.error('[WebSocket] 连接错误:', error);
        this.clients.delete(ws);
      });
    });

    console.log('[WebSocket] WebSocket服务器已启动，路径: /ws');
  }

  /**
   * 发送消息给指定客户端
   */
  sendToClient(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(data));
      } catch (error) {
        console.error('[WebSocket] 发送消息失败:', error);
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
          console.error('[WebSocket] 广播消息失败:', error);
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
}

module.exports = new WebSocketService();

