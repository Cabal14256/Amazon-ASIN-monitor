const Queue = require('bull');
const logger = require('../utils/logger');

// 构建 Redis 连接 URL（复用监控任务的逻辑）
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

const batchCheckTaskQueue = new Queue('batch-check-task-queue', redisUrl, {
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: { age: 3600 }, // 保留1小时
    removeOnFail: { age: 86400 }, // 失败任务保留1天
  },
  // 限流器：每 1000ms 最多处理 1 个任务
  limiter: {
    max: 1,
    duration: 1000,
  },
});

// 处理批量检查任务
batchCheckTaskQueue.process(async (job) => {
  const { taskId, groupIds, country, forceRefresh, userId } = job.data || {};

  if (
    !taskId ||
    !groupIds ||
    !Array.isArray(groupIds) ||
    groupIds.length === 0
  ) {
    throw new Error('任务ID和变体组ID列表不能为空');
  }

  logger.info(
    `[批量检查任务] 开始处理任务 ${taskId}, 变体组数量: ${groupIds.length}`,
  );

  const batchCheckTaskProcessor = require('./batchCheckTaskProcessor');
  await batchCheckTaskProcessor.processBatchCheckTask(job);
});

batchCheckTaskQueue.on('failed', (job, err) => {
  logger.error(
    `[批量检查任务] 任务失败 (Job ${job?.id}, Task ${job?.data?.taskId}):`,
    err?.message || 'unknown error',
  );

  // 通过WebSocket通知任务失败
  const websocketService = require('./websocketService');
  if (job?.data?.taskId) {
    websocketService.sendTaskError(
      job.data.taskId,
      err?.message || '任务处理失败',
    );
  }
});

batchCheckTaskQueue.on('completed', (job) => {
  logger.info(
    `[批量检查任务] 任务完成 (Job ${job.id}, Task ${job.data?.taskId})`,
  );
});

function enqueue(taskData) {
  if (!taskData || !taskData.taskId || !taskData.groupIds) {
    throw new Error('任务数据不完整');
  }
  return batchCheckTaskQueue.add(taskData, {
    jobId: taskData.taskId, // 使用taskId作为jobId，避免重复
  });
}

function getJob(taskId) {
  return batchCheckTaskQueue.getJob(taskId);
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
  queue: batchCheckTaskQueue,
};
