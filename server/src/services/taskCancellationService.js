const taskRegistryService = require('./taskRegistryService');

class TaskCancelledError extends Error {
  constructor(message = '任务已取消') {
    super(message);
    this.name = 'TaskCancelledError';
    this.code = 'TASK_CANCELLED';
  }
}

async function throwIfTaskCancelled(taskId, message = '任务已取消') {
  const cancelled = await taskRegistryService.isCancellationRequested(taskId);
  if (cancelled) {
    throw new TaskCancelledError(message);
  }
}

function isTaskCancelledError(error) {
  return (
    error?.code === 'TASK_CANCELLED' ||
    error?.name === 'TaskCancelledError'
  );
}

module.exports = {
  TaskCancelledError,
  throwIfTaskCancelled,
  isTaskCancelledError,
};
