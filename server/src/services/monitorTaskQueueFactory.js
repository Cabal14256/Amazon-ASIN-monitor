const Queue = require('bull');
const logger = require('../utils/logger');
const { buildScheduledJobId } = require('./monitorQueuePolicy');
const { processMonitorTaskJob } = require('./monitorTaskProcessor');
const { getBullQueueSettings } = require('./bullQueueSettings');
const monitorTaskRunner = require('./monitorTaskRunner');

function buildRedisUrl() {
  if (process.env.REDIS_URL || process.env.REDIS_URI) {
    return process.env.REDIS_URL || process.env.REDIS_URI;
  }

  const host = process.env.REDIS_HOST || '127.0.0.1';
  const port = process.env.REDIS_PORT || 6379;
  const password = process.env.REDIS_PASSWORD;
  const username = process.env.REDIS_USERNAME;
  const db = process.env.REDIS_DB || '0';

  let url = 'redis://';
  if (username && password) {
    url += `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`;
  } else if (password) {
    url += `:${encodeURIComponent(password)}@`;
  }
  url += `${host}:${port}`;
  if (db !== '0') {
    url += `/${db}`;
  }
  return url;
}

const DEFAULT_WORKER_CONCURRENCY = 1;

function createMonitorTaskQueue({ name, followUpQueue = null }) {
  const redisUrl = buildRedisUrl();
  const bullPrefix = String(process.env.BULL_PREFIX || 'bull').trim() || 'bull';
  const limiterMax = Number(process.env.MONITOR_QUEUE_LIMITER_MAX) || 1;
  const limiterDurationMs =
    Number(process.env.MONITOR_QUEUE_LIMITER_DURATION_MS) || 200;

  const queue = new Queue(name, redisUrl, {
    prefix: bullPrefix,
    settings: getBullQueueSettings(),
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: { age: 3600 },
      removeOnFail: { age: 86400 },
    },
    limiter: {
      max: limiterMax,
      duration: limiterDurationMs,
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
    queue.process(concurrency, async (job) => {
      return processMonitorTaskJob(job, {
        runMonitorTask: monitorTaskRunner.runMonitorTask,
        enqueueCompetitor: followUpQueue?.enqueue,
      });
    });

    processorRegistered = true;
    processorConcurrency = concurrency;
    logger.info(
      `[监控任务队列:${name}] 已注册处理器，worker并发=${processorConcurrency}`,
    );
    return true;
  }

  function getProcessorStatus() {
    return {
      registered: processorRegistered,
      concurrency: processorConcurrency,
    };
  }

  queue.on('failed', (job, err) => {
    logger.error(
      `🚫 监控任务队列失败 (Queue ${name}, Job ${job.id}):`,
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
      followUp: options.followUp || null,
    };

    const jobOptions = { ...(options.jobOptions || {}) };
    const scheduledJobId = buildScheduledJobId(name, taskData);
    if (scheduledJobId && !jobOptions.jobId) {
      jobOptions.jobId = scheduledJobId;
    }

    return queue.add(taskData, jobOptions);
  }

  return {
    enqueue,
    queue,
    registerProcessor,
    getProcessorStatus,
    limiterConfig: {
      max: limiterMax,
      duration: limiterDurationMs,
    },
  };
}

module.exports = {
  buildRedisUrl,
  createMonitorTaskQueue,
};
