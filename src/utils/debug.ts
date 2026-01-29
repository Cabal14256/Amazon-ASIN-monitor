type LogMethod = 'log' | 'warn' | 'error';

const shouldLog = () => process.env.NODE_ENV !== 'production';

const logWithLevel = (level: LogMethod, args: unknown[]) => {
  if (!shouldLog()) {
    return;
  }
  const method = console[level] || console.log;
  method(...args);
};

export const debugLog = (...args: unknown[]) => logWithLevel('log', args);
export const debugWarn = (...args: unknown[]) => logWithLevel('warn', args);
export const debugError = (...args: unknown[]) => logWithLevel('error', args);
