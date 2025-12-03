/**
 * 请求去重工具
 * 防止相同参数的请求重复发送
 */

interface PendingRequest {
  promise: Promise<any>;
  timestamp: number;
}

class RequestDedupe {
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private readonly TTL = 5000; // 5秒内的相同请求会被去重

  /**
   * 生成请求的唯一键
   */
  private generateKey(url: string, params: any): string {
    const sortedParams = JSON.stringify(params, Object.keys(params).sort());
    return `${url}:${sortedParams}`;
  }

  /**
   * 清理过期的请求
   */
  private cleanup() {
    const now = Date.now();
    for (const [key, request] of this.pendingRequests.entries()) {
      if (now - request.timestamp > this.TTL) {
        this.pendingRequests.delete(key);
      }
    }
  }

  /**
   * 执行请求（带去重）
   * @param url 请求URL
   * @param params 请求参数
   * @param requestFn 实际的请求函数
   * @returns Promise
   */
  async request<T>(
    url: string,
    params: any,
    requestFn: (params: any) => Promise<T>,
  ): Promise<T> {
    this.cleanup();

    const key = this.generateKey(url, params);
    const existing = this.pendingRequests.get(key);

    if (existing) {
      // 如果存在相同的请求，返回现有的Promise
      return existing.promise;
    }

    // 创建新的请求
    const promise = requestFn(params).finally(() => {
      // 请求完成后移除
      this.pendingRequests.delete(key);
    });

    this.pendingRequests.set(key, {
      promise,
      timestamp: Date.now(),
    });

    return promise;
  }

  /**
   * 清除所有待处理的请求
   */
  clear() {
    this.pendingRequests.clear();
  }
}

export const requestDedupe = new RequestDedupe();

