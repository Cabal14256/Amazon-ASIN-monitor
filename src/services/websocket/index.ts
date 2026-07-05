import { debugError, debugLog } from '@/utils/debug';
import { hasAuthSession } from '@/utils/token';

type WebSocketMessage =
  | { type: 'connected'; message: string }
  | {
      type: 'monitor_progress';
      status: string;
      country?: string;
      current?: number;
      total?: number;
      progress?: number;
      timestamp: string;
    }
  | {
      type: 'monitor_complete';
      success: boolean;
      totalChecked: number;
      totalBroken: number;
      totalNormal: number;
      duration: string;
      countryResults: any;
      timestamp: string;
    }
  | { type: 'stats_update'; data: any }
  | {
      type: 'task_progress';
      taskId: string;
      progress: number;
      message: string;
      timestamp: string;
    }
  | {
      type: 'task_complete';
      taskId: string;
      downloadUrl: string | null;
      filename: string | null;
      timestamp: string;
    }
  | {
      type: 'task_cancelled';
      taskId: string;
      message: string;
      timestamp: string;
    }
  | { type: 'task_error'; taskId: string; error: string; timestamp: string }
  | { type: 'pong' };

type MessageHandler = (message: WebSocketMessage) => void;

class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private messageHandlers: Set<MessageHandler> = new Set();
  private pingInterval: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private manualDisconnect = false;

  constructor(url: string) {
    // 将 http:// 或 https:// 转换为 ws:// 或 wss://
    this.url = url.replace(/^http/, 'ws') + '/ws';
  }

  connect() {
    if (
      this.ws?.readyState === WebSocket.OPEN ||
      this.ws?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }

    if (!hasAuthSession()) {
      debugLog('[WebSocket] 无可用会话，跳过连接');
      return;
    }

    try {
      this.manualDisconnect = false;
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        debugLog('[WebSocket] 连接成功');
        this.reconnectAttempts = 0;
        this.startPing();
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WebSocketMessage;
          this.messageHandlers.forEach((handler) => handler(message));
        } catch (error) {
          debugError('[WebSocket] 解析消息失败:', error);
        }
      };

      this.ws.onerror = (error) => {
        debugError('[WebSocket] 连接错误:', error);
      };

      this.ws.onclose = (event) => {
        debugLog('[WebSocket] 连接关闭', {
          code: event.code,
          reason: event.reason || null,
        });
        this.stopPing();

        if (this.manualDisconnect) {
          this.manualDisconnect = false;
          return;
        }

        if (this.isAuthCloseCode(event.code)) {
          debugLog('[WebSocket] 鉴权失败，停止自动重连', {
            code: event.code,
            reason: event.reason || null,
          });
          return;
        }

        this.attemptReconnect();
      };
    } catch (error) {
      debugError('[WebSocket] 连接失败:', error);
      this.attemptReconnect();
    }
  }

  disconnect() {
    this.stopPing();
    this.manualDisconnect = true;
    this.reconnectAttempts = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.messageHandlers.clear();
  }

  send(message: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  onMessage(handler: MessageHandler) {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  private startPing() {
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send({ type: 'ping' });
      }
    }, 30000); // 每30秒发送一次ping
  }

  private stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private attemptReconnect() {
    if (!hasAuthSession()) {
      debugLog('[WebSocket] 无可用会话，停止重连');
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      debugError('[WebSocket] 达到最大重连次数，停止重连');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    debugLog(
      `[WebSocket] ${delay}ms后尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})`,
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private isAuthCloseCode(code: number) {
    return code === 4401 || code === 4403;
  }

  getReadyState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// 创建单例
const getWebSocketUrl = () => {
  // 开发环境：直接连接到后端端口（不包含 /ws，构造函数会自动添加）
  if (process.env.NODE_ENV === 'development') {
    return 'http://localhost:3001';
  }

  // 生产环境：从当前页面URL构建WebSocket URL（不包含 /ws，构造函数会自动添加）
  return window.location.origin;
};

export const wsClient = new WebSocketClient(getWebSocketUrl());
