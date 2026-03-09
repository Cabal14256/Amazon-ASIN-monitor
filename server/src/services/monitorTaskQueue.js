const Queue = require('bull');
const monitorTaskRunner = require('./monitorTaskRunner');
const logger = require('../utils/logger');

// 构建 Redis 连接 URL
// 支持两种方式：
// 1. 直接使用 REDIS_URL 或 REDIS_URI（可以在 URL 中包含密码：redis://:password@host:port）
// 2. 使用单独的配置项构建 URL
function buildRedisUrl() {
  // 如果提供了完整的 Redis URL，直接使用
  if (process.env.REDIS_URL || process.env.REDIS_URI) {
    return process.env.REDIS_URL || process.env.REDIS_URI;
  }

  // 否则，使用单独的配置项构建 URL
  const host = process.env.REDIS_HOST || '127.0.0.1';
  const port = process.env.REDIS_PORT || 6379;
  const password = process.env.REDIS_PASSWORD;
  const username = process.env.REDIS_USERNAME; // Redis 6.0+ 支持用户名
  const db = process.env.REDIS_DB || '0';

  // 构建 URL
  let url = 'redis://';
  if (username && password) {
    // Redis 6.0+ 支持用户名和密码
    url += `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`;
  } else if (password) {
    // 只有密码
    url += `:${encodeURIComponent(password)}@`;
  }
  url += `${host}:${port}`;
  if (db !== '0') {
    url += `/${db}`;
  }

  return url;
}

const redisUrl = buildRedisUrl();
const LIMITER_MAX = Number(process.env.MONITOR_QUEUE_LIMITER_MAX) || 1;
const LIMITER_DURATION_MS =
  Number(process.env.MONITOR_QUEUE_LIMITER_DURATION_MS) || 200;
const DEFAULT_WORKER_CONCURRENCY = 1;

const monitorTaskQueue = new Queue('monitor-task-queue', redisUrl, {
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 86400 },
  },
  // 限流器：每 200ms 最多处理 1 个任务（相当于 5 rps）
  limiter: {
    max: LIMITER_MAX,
    duration: LIMITER_DURATION_MS,
  },
});

let processorRegistered = false;
let processorConcurrency = 0;

function getWorkerConcurrency() {
  const configured = Number(process.env.MONITOR_QUEUE_WORKER_CONCURRENCY);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.max(Math.floor(configured), 1);
  }
  return DEFAULT_WORKER_CONCURRENCY;
}

function registerProcessor() {
  if (processorRegistered) {
    return false;
  }

  const concurrency = getWorkerConcurrency();
  monitorTaskQueue.process(concurrency, async (job) => {
    const { countries, batchConfig } = job.data || {};
    if (!countries || !countries.length) {
      return;
    }
    await monitorTaskRunner.runMonitorTask(countries, batchConfig);
  });

  processorRegistered = true;
  processorConcurrency = concurrency;
  logger.info(
    `[监控任务队列] 已注册处理器，worker并发=${processorConcurrency}`,
  );
  return true;
}

function getProcessorStatus() {
  return {
    registered: processorRegistered,
    concurrency: processorConcurrency,
  };
}

monitorTaskQueue.on('failed', (job, err) => {
  logger.error(
    `🚫 监控任务队列失败 (Job ${job.id}):`,
    err?.message || 'unknown error',
  );
});

function enqueue(countries, batchConfig = null, options = {}) {
  if (!countries || !countries.length) {
    return null;
  }

  const taskData = {
    countries,
    batchConfig,
    source: options.source || 'scheduled',
    requestedBy: options.requestedBy || null,
    requestedAt: options.requestedAt || new Date().toISOString(),
  };

  return monitorTaskQueue.add(taskData, options.jobOptions || {});
}

module.exports = {
  enqueue,
  queue: monitorTaskQueue,
  registerProcessor,
  getProcessorStatus,
  limiterConfig: {
    max: LIMITER_MAX,
    duration: LIMITER_DURATION_MS,
  },
};
