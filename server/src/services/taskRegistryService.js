const logger = require('../utils/logger');
const redisConfig = require('../config/redis');

const TASK_META_KEY_PREFIX = 'task:meta:';
const USER_TASK_INDEX_PREFIX = 'task:user:';
const TASK_TTL_SECONDS = Number(process.env.TASK_META_TTL_SECONDS) || 86400 * 7;
const USER_TASK_MAX_ITEMS = Number(process.env.TASK_USER_MAX_ITEMS) || 200;

const memoryTasks = new Map();
const memoryUserTasks = new Map();

function getNowISOString() {
  return new Date().toISOString();
}

function getTaskKey(taskId) {
  return `${TASK_META_KEY_PREFIX}${taskId}`;
}

function getUserTaskKey(userId) {
  return `${USER_TASK_INDEX_PREFIX}${userId}`;
}

function cloneTask(task) {
  if (!task) {
    return null;
  }
  return JSON.parse(JSON.stringify(task));
}

function getRedisClient() {
  if (
    ['true', '1', 'yes', 'on'].includes(
      String(process.env.TASK_REGISTRY_MEMORY_ONLY || '')
        .trim()
        .toLowerCase(),
    )
  ) {
    return null;
  }

  if (!redisConfig.isRedisAvailable()) {
    return null;
  }
  return redisConfig.getRedisClient();
}

function sortTasksByUpdatedAtDesc(tasks) {
  return tasks.sort((a, b) => {
    const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return bTime - aTime;
  });
}

function syncMemoryIndex(task) {
  memoryTasks.set(task.taskId, cloneTask(task));

  if (!task.userId) {
    return;
  }

  const existingTaskIds = memoryUserTasks.get(task.userId) || [];
  const nextTaskIds = [task.taskId].concat(
    existingTaskIds.filter((taskId) => taskId !== task.taskId),
  );
  memoryUserTasks.set(task.userId, nextTaskIds.slice(0, USER_TASK_MAX_ITEMS));
}

async function persistTask(task) {
  const redisClient = getRedisClient();
  const currentTask = memoryTasks.get(task.taskId);
  const nextStatus = task?.status;
  const currentStatus = currentTask?.status;

  // 防止并发更新把终态（completed/failed/cancelled）回写成处理中状态
  if (
    currentTask &&
    isTerminalTaskStatus(currentStatus) &&
    !isTerminalTaskStatus(nextStatus)
  ) {
    return cloneTask(currentTask);
  }

  syncMemoryIndex(task);

  if (!redisClient) {
    return cloneTask(task);
  }

  try {
    await redisClient.set(
      getTaskKey(task.taskId),
      JSON.stringify(task),
      'EX',
      TASK_TTL_SECONDS,
    );

    if (task.userId) {
      const userTaskKey = getUserTaskKey(task.userId);
      await redisClient.zadd(
        userTaskKey,
        new Date(
          task.updatedAt || task.createdAt || getNowISOString(),
        ).getTime(),
        task.taskId,
      );
      await redisClient.expire(userTaskKey, TASK_TTL_SECONDS);

      if (USER_TASK_MAX_ITEMS > 0) {
        const count = await redisClient.zcard(userTaskKey);
        if (count > USER_TASK_MAX_ITEMS) {
          await redisClient.zremrangebyrank(
            userTaskKey,
            0,
            count - USER_TASK_MAX_ITEMS - 1,
          );
        }
      }
    }
  } catch (error) {
    logger.warn('[任务注册表] Redis持久化失败，已回退内存:', error.message);
  }

  return cloneTask(task);
}

async function readTask(taskId) {
  const redisClient = getRedisClient();

  if (redisClient) {
    try {
      const raw = await redisClient.get(getTaskKey(taskId));
      if (raw) {
        const parsed = JSON.parse(raw);
        syncMemoryIndex(parsed);
        return parsed;
      }
    } catch (error) {
      logger.warn('[任务注册表] Redis读取失败，已回退内存:', error.message);
    }
  }

  return cloneTask(memoryTasks.get(taskId) || null);
}

async function createTask(task) {
  const now = getNowISOString();
  return persistTask({
    progress: 0,
    status: 'pending',
    message: '任务已创建，等待处理',
    createdAt: now,
    updatedAt: now,
    cancelRequestedAt: null,
    cancelledAt: null,
    completedAt: null,
    error: null,
    result: null,
    ...task,
  });
}

async function updateTask(taskId, patch = {}) {
  const existingTask = (await readTask(taskId)) || {
    taskId,
    createdAt: getNowISOString(),
  };
  if (
    existingTask &&
    isTerminalTaskStatus(existingTask.status) &&
    (!patch.status || !isTerminalTaskStatus(patch.status))
  ) {
    return existingTask;
  }
  const nextTask = {
    ...existingTask,
    ...patch,
    taskId,
    createdAt: existingTask.createdAt || patch.createdAt || getNowISOString(),
    updatedAt: patch.updatedAt || getNowISOString(),
  };
  return persistTask(nextTask);
}

async function markTaskProcessing(taskId, patch = {}) {
  const existingTask = await readTask(taskId);
  const now = getNowISOString();
  return updateTask(taskId, {
    status:
      existingTask?.status === 'cancelling' || existingTask?.cancelRequestedAt
        ? 'cancelling'
        : 'processing',
    startedAt: existingTask?.startedAt || patch.startedAt || now,
    ...patch,
  });
}

async function updateTaskProgress(taskId, progress, message, patch = {}) {
  const existingTask = await readTask(taskId);
  if (existingTask && isTerminalTaskStatus(existingTask.status)) {
    return existingTask;
  }
  return updateTask(taskId, {
    progress,
    message,
    status:
      existingTask?.status === 'cancelling' || existingTask?.cancelRequestedAt
        ? 'cancelling'
        : 'processing',
    ...patch,
  });
}

async function requestTaskCancellation(
  taskId,
  message = '已请求取消，等待当前批次结束',
) {
  const existingTask = await readTask(taskId);
  if (!existingTask) {
    return null;
  }
  if (['completed', 'failed', 'cancelled'].includes(existingTask.status)) {
    return existingTask;
  }
  return updateTask(taskId, {
    status: 'cancelling',
    message,
    cancelRequestedAt: existingTask.cancelRequestedAt || getNowISOString(),
  });
}

async function markTaskCancelled(taskId, patch = {}) {
  const now = getNowISOString();
  return updateTask(taskId, {
    status: 'cancelled',
    message: patch.message || '任务已取消',
    cancelledAt: patch.cancelledAt || now,
    completedAt: patch.completedAt || now,
    error: null,
    ...patch,
  });
}

async function markTaskCompleted(taskId, result = null, patch = {}) {
  const now = getNowISOString();
  return updateTask(taskId, {
    status: 'completed',
    progress: 100,
    message: patch.message || '任务已完成',
    completedAt: patch.completedAt || now,
    error: null,
    result,
    ...patch,
  });
}

async function markTaskFailed(taskId, errorMessage, patch = {}) {
  const now = getNowISOString();
  return updateTask(taskId, {
    status: 'failed',
    message: patch.message || errorMessage || '任务失败',
    error: errorMessage || patch.error || '任务失败',
    completedAt: patch.completedAt || now,
    ...patch,
  });
}

async function isCancellationRequested(taskId) {
  const task = await readTask(taskId);
  return Boolean(
    task &&
      (task.cancelRequestedAt ||
        task.status === 'cancelling' ||
        task.status === 'cancelled'),
  );
}

async function listUserTasks(userId, options = {}) {
  const { limit = 50, status = 'all' } = options;
  const redisClient = getRedisClient();
  let tasks = [];

  if (redisClient) {
    try {
      const taskIds = await redisClient.zrevrange(
        getUserTaskKey(userId),
        0,
        Math.max(limit * 3, limit) - 1,
      );
      if (taskIds.length > 0) {
        const rawTasks = await redisClient.mget(
          taskIds.map((taskId) => getTaskKey(taskId)),
        );
        tasks = rawTasks
          .filter(Boolean)
          .map((item) => JSON.parse(item))
          .filter((task) => !userId || task.userId === userId);
        tasks.forEach((task) => syncMemoryIndex(task));
      }
    } catch (error) {
      logger.warn('[任务注册表] Redis列表读取失败，已回退内存:', error.message);
      tasks = [];
    }
  }

  if (tasks.length === 0) {
    const taskIds = memoryUserTasks.get(userId) || [];
    tasks = taskIds
      .map((taskId) => cloneTask(memoryTasks.get(taskId)))
      .filter(Boolean);
  }

  tasks = sortTasksByUpdatedAtDesc(tasks);

  if (status === 'active') {
    tasks = tasks.filter((task) =>
      ['pending', 'processing', 'cancelling'].includes(task.status),
    );
  } else if (status && status !== 'all') {
    tasks = tasks.filter((task) => task.status === status);
  }

  return tasks.slice(0, limit);
}

function isTerminalTaskStatus(status) {
  return ['completed', 'failed', 'cancelled'].includes(status);
}

function serializeTaskForClient(task) {
  if (!task) {
    return null;
  }

  const result = task.result || null;
  return {
    ...cloneTask(task),
    canCancel: !isTerminalTaskStatus(task.status),
    downloadUrl: result?.downloadUrl || task.downloadUrl || null,
    filename: result?.filename || task.filename || null,
  };
}

module.exports = {
  createTask,
  updateTask,
  readTask,
  listUserTasks,
  markTaskProcessing,
  updateTaskProgress,
  requestTaskCancellation,
  markTaskCancelled,
  markTaskCompleted,
  markTaskFailed,
  isCancellationRequested,
  isTerminalTaskStatus,
  serializeTaskForClient,
};
