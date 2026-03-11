const Queue = require('bull');
const logger = require('../utils/logger');

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

const redisUrl = buildRedisUrl();
const bullPrefix = String(process.env.BULL_PREFIX || 'bull').trim() || 'bull';
const DEFAULT_WORKER_CONCURRENCY = 1;

const variantCheckTaskQueue = new Queue('variant-check-task-queue', redisUrl, {
  prefix: bullPrefix,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 86400 },
  },
  limiter: {
    max: 1,
    duration: 500,
  },
});

let processorRegistered = false;
let processorConcurrency = 0;

function getWorkerConcurrency() {
  const configured = Number(process.env.VARIANT_CHECK_QUEUE_WORKER_CONCURRENCY);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.max(Math.floor(configured), 1);
  }
  return DEFAULT_WORKER_CONCURRENCY;
}

function registerProcessor() {
  if (processorRegistered) {
    return false;
  }

  processorConcurrency = getWorkerConcurrency();

  variantCheckTaskQueue.process(processorConcurrency, async (job) => {
    const { taskId, taskType } = job.data || {};

    if (!taskId || !taskType) {
      throw new Error('任务ID和任务类型不能为空');
    }

    logger.info(`[变体检查任务] 开始处理任务 ${taskId}, 类型: ${taskType}`);

    const variantCheckTaskProcessor = require('./variantCheckTaskProcessor');
    return variantCheckTaskProcessor.processVariantCheckTask(job);
  });

  processorRegistered = true;
  logger.info(
    `[变体检查任务队列] 已注册处理器，worker并发=${processorConcurrency}`,
  );
  return true;
}

function getProcessorStatus() {
  return {
    registered: processorRegistered,
    concurrency: processorConcurrency,
  };
}

variantCheckTaskQueue.on('failed', (job, err) => {
  logger.error(
    `[变体检查任务] 任务失败 (Job ${job?.id}, Task ${job?.data?.taskId}):`,
    err?.message || 'unknown error',
  );

  const websocketService = require('./websocketService');
  if (job?.data?.taskId) {
    websocketService.sendTaskError(
      job.data.taskId,
      err?.message || '任务处理失败',
      job.data.userId || null,
    );
  }
});

variantCheckTaskQueue.on('completed', (job) => {
  logger.info(
    `[变体检查任务] 任务完成 (Job ${job.id}, Task ${job.data?.taskId})`,
  );
});

function enqueue(taskData) {
  if (!taskData || !taskData.taskId || !taskData.taskType || !taskData.params) {
    throw new Error('任务数据不完整');
  }

  return variantCheckTaskQueue.add(taskData, {
    jobId: taskData.taskId,
  });
}

function getJob(taskId) {
  return variantCheckTaskQueue.getJob(taskId);
}

async function getJobState(taskId) {
  const job = await getJob(taskId);
  if (!job) {
    return null;
  }

  const state = await job.getState();
  const progress =
    typeof job.progress === 'function'
      ? await job.progress()
      : job.progress || 0;
  let returnvalue = job.returnvalue;
  if (
    (returnvalue === null || returnvalue === undefined) &&
    state === 'completed'
  ) {
    try {
      returnvalue = await job.finished();
    } catch (error) {
      returnvalue = null;
    }
  }

  return {
    id: job.id,
    taskId: job.data?.taskId,
    state,
    progress,
    data: job.data,
    returnvalue,
    failedReason: job.failedReason,
  };
}

module.exports = {
  enqueue,
  getJob,
  getJobState,
  registerProcessor,
  getProcessorStatus,
  queue: variantCheckTaskQueue,
};
