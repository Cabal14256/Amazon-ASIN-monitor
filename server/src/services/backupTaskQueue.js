const Queue = require('bull');
const logger = require('../utils/logger');

// 构建 Redis 连接 URL
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

const backupTaskQueue = new Queue('backup-task-queue', redisUrl, {
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
    duration: 2000, // 备份任务间隔更长
  },
});

let processorRegistered = false;
let processorConcurrency = 0;

function registerProcessor() {
  if (processorRegistered) {
    return false;
  }

  processorConcurrency = 1;

  backupTaskQueue.process(processorConcurrency, async (job) => {
    const { taskId, taskType } = job.data || {};

    if (!taskId || !taskType) {
      throw new Error('任务ID和任务类型不能为空');
    }

    logger.info(`[备份任务] 开始处理任务 ${taskId}, 类型: ${taskType}`);

    const backupTaskProcessor = require('./backupTaskProcessor');
    await backupTaskProcessor.processBackupTask(job);
  });

  processorRegistered = true;
  logger.info(
    `[备份任务队列] 已注册处理器，worker并发=${processorConcurrency}`,
  );
  return true;
}

function getProcessorStatus() {
  return {
    registered: processorRegistered,
    concurrency: processorConcurrency,
  };
}

backupTaskQueue.on('failed', (job, err) => {
  logger.error(
    `[备份任务] 任务失败 (Job ${job?.id}, Task ${job?.data?.taskId}):`,
    err?.message || 'unknown error',
  );

  const websocketService = require('./websocketService');
  if (job?.data?.taskId) {
    websocketService.sendTaskError(
      job.data.taskId,
      err?.message || '任务处理失败',
    );
  }
});

backupTaskQueue.on('completed', (job) => {
  logger.info(`[备份任务] 任务完成 (Job ${job.id}, Task ${job.data?.taskId})`);
});

function enqueue(taskData) {
  if (!taskData || !taskData.taskId || !taskData.taskType) {
    throw new Error('任务数据不完整');
  }
  return backupTaskQueue.add(taskData, {
    jobId: taskData.taskId,
  });
}

function getJob(taskId) {
  return backupTaskQueue.getJob(taskId);
}

async function getJobState(taskId) {
  const job = await getJob(taskId);
  if (!job) {
    return null;
  }

  const state = await job.getState();
  const progress = job.progress || 0;

  return {
    id: job.id,
    taskId: job.data?.taskId,
    state,
    progress,
    data: job.data,
    returnvalue: job.returnvalue,
    failedReason: job.failedReason,
  };
}

module.exports = {
  enqueue,
  getJob,
  getJobState,
  registerProcessor,
  getProcessorStatus,
  queue: backupTaskQueue,
};
