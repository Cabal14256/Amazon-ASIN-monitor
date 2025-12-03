/**
 * 节流函数
 * @param func 要执行的函数
 * @param wait 等待时间（毫秒）
 * @param options 选项配置
 * @returns 节流后的函数
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  wait: number,
  options: { leading?: boolean; trailing?: boolean } = {},
): (...args: Parameters<T>) => void {
  const { leading = true, trailing = true } = options;
  let timeout: NodeJS.Timeout | null = null;
  let previous = 0;
  let result: ReturnType<T>;

  return function (this: any, ...args: Parameters<T>) {
    const context = this;
    const now = Date.now();

    if (!previous && !leading) {
      previous = now;
    }

    const remaining = wait - (now - previous);

    if (remaining <= 0 || remaining > wait) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      previous = now;
      result = func.apply(context, args);
    } else if (!timeout && trailing) {
      timeout = setTimeout(() => {
        previous = leading ? Date.now() : 0;
        timeout = null;
        result = func.apply(context, args);
      }, remaining);
    }

    return result;
  };
}

/**
 * 节流装饰器（用于类方法）
 */
export function Throttle(
  wait: number,
  options: { leading?: boolean; trailing?: boolean } = {},
) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;
    descriptor.value = throttle(originalMethod, wait, options);
    return descriptor;
  };
}

