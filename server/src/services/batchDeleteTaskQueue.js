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

const batchDeleteTaskQueue = new Queue('batch-delete-task-queue', redisUrl, {
  prefix: bullPrefix,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 86400 },
  },
  limiter: {
    max: 1,
    duration: 1000,
  },
});

let processorRegistered = false;
let processorConcurrency = 0;

function getWorkerConcurrency() {
  const configured = Number(process.env.BATCH_DELETE_QUEUE_WORKER_CONCURRENCY);
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
  batchDeleteTaskQueue.process(processorConcurrency, async (job) => {
    const { taskId, domain, groupIds, asinIds } = job.data || {};

    if (!taskId || !domain) {
      throw new Error('批量删除任务数据不完整');
    }
    if (
      (!Array.isArray(groupIds) || groupIds.length === 0) &&
      (!Array.isArray(asinIds) || asinIds.length === 0)
    ) {
      throw new Error('批量删除任务缺少删除目标');
    }

    logger.info('[批量删除任务] 开始处理任务', {
      taskId,
      domain,
      groupCount: Array.isArray(groupIds) ? groupIds.length : 0,
      asinCount: Array.isArray(asinIds) ? asinIds.length : 0,
    });

    const batchDeleteTaskProcessor = require('./batchDeleteTaskProcessor');
    return batchDeleteTaskProcessor.processBatchDeleteTask(job);
  });

  processorRegistered = true;
  logger.info(
    `[批量删除任务队列] 已注册处理器，worker并发=${processorConcurrency}`,
  );
  return true;
}

function getProcessorStatus() {
  return {
    registered: processorRegistered,
    concurrency: processorConcurrency,
  };
}

batchDeleteTaskQueue.on('failed', (job, err) => {
  logger.error('[批量删除任务] 任务失败', {
    jobId: job?.id,
    taskId: job?.data?.taskId,
    message: err?.message || 'unknown error',
  });

  const websocketService = require('./websocketService');
  if (job?.data?.taskId) {
    websocketService.sendTaskError(
      job.data.taskId,
      err?.message || '任务处理失败',
      job.data?.userId || null,
    );
  }
});

batchDeleteTaskQueue.on('completed', (job) => {
  logger.info('[批量删除任务] 任务完成', {
    jobId: job.id,
    taskId: job.data?.taskId,
  });
});

function enqueue(taskData) {
  if (!taskData || !taskData.taskId || !taskData.domain) {
    throw new Error('批量删除任务数据不完整');
  }
  return batchDeleteTaskQueue.add(taskData, {
    jobId: taskData.taskId,
  });
}

function getJob(taskId) {
  return batchDeleteTaskQueue.getJob(taskId);
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
  queue: batchDeleteTaskQueue,
};
