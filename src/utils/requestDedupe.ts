/**
 * 请求去重工具
 * 防止相同参数的请求重复发送
 */

interface PendingRequest {
  promise: Promise<any>;
  timestamp: number;
}

type Primitive = string | number | boolean | null;
type NormalizedValue =
  | Primitive
  | undefined
  | NormalizedValue[]
  | { [key: string]: NormalizedValue };

class RequestDedupe {
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private readonly TTL = 5000; // 5秒内的相同请求会被去重

  /**
   * 生成请求的唯一键
   */
  private generateKey(url: string, params: unknown): string {
    return `${url}:${this.stableStringify(params)}`;
  }

  /**
   * 稳定序列化（对象按 key 排序，防止同参不同序导致重复请求）
   * 同时兼容 Date / Map / Set / BigInt，并避免循环引用导致异常。
   */
  private stableStringify(value: unknown): string {
    if (value === undefined) {
      return 'undefined';
    }

    if (typeof value === 'bigint') {
      return `bigint:${value.toString()}`;
    }

    if (typeof value === 'function') {
      return '[Function]';
    }

    if (typeof value === 'symbol') {
      return value.toString();
    }

    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }

    const seen = new WeakSet<object>();
    const normalized = this.normalizeValue(value, seen);
    return JSON.stringify(normalized);
  }

  private normalizeValue(
    value: unknown,
    seen: WeakSet<object>,
  ): NormalizedValue {
    if (value === null) {
      return null;
    }

    if (value === undefined) {
      return undefined;
    }

    if (typeof value === 'bigint') {
      return `bigint:${value.toString()}`;
    }

    if (typeof value !== 'object') {
      return value as Primitive;
    }

    if (seen.has(value)) {
      return '[Circular]';
    }

    seen.add(value);

    if (value instanceof Date) {
      return `date:${value.toISOString()}`;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeValue(item, seen));
    }

    if (value instanceof Map) {
      return Array.from(value.entries())
        .map(([k, v]) => [String(k), this.normalizeValue(v, seen)] as const)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => ({ key: k, value: v }));
    }

    if (value instanceof Set) {
      return Array.from(value.values())
        .map((item) => this.stableStringify(item))
        .sort();
    }

    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, NormalizedValue>>((result, key) => {
        result[key] = this.normalizeValue(
          (value as Record<string, unknown>)[key],
          seen,
        );
        return result;
      }, {});
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
    params: unknown,
    requestFn: (params: unknown) => Promise<T>,
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
