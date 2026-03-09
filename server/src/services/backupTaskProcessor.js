const backupService = require('./backupService');
const logger = require('../utils/logger');
const websocketService = require('./websocketService');
const taskRegistryService = require('./taskRegistryService');
const {
  throwIfTaskCancelled,
  isTaskCancelledError,
} = require('./taskCancellationService');

/**
 * 更新任务进度
 */
function updateProgress(job, taskId, progress, message, userId = null) {
  job.progress(progress);
  taskRegistryService
    .updateTaskProgress(taskId, progress, message)
    .catch((error) => {
      logger.warn('[备份任务] 更新任务注册表进度失败:', error.message);
    });
  websocketService.sendTaskProgress(taskId, progress, message, userId);
}

/**
 * 处理备份任务
 */
async function processBackupTask(job) {
  const { taskId, taskType, params, userId } = job.data;

  try {
    await taskRegistryService.markTaskProcessing(taskId, {
      taskSubType: taskType,
      message: '备份任务开始处理',
    });
    await throwIfTaskCancelled(taskId, '备份任务已取消');
    updateProgress(job, taskId, 5, '正在初始化...', userId);

    let result;
    if (taskType === 'create') {
      updateProgress(job, taskId, 20, '正在创建备份...', userId);
      result = await backupService.createBackup({
        ...params,
        onProgress: async ({ current, total, tableName }) => {
          const progress = 20 + Math.floor((current / Math.max(total, 1)) * 70);
          updateProgress(
            job,
            taskId,
            Math.min(progress, 90),
            `正在备份数据表... (${current}/${total}) ${tableName || ''}`.trim(),
            userId,
          );
        },
        checkCancelled: async (message) => {
          await throwIfTaskCancelled(taskId, message);
        },
      });
      updateProgress(job, taskId, 90, '备份创建完成', userId);
    } else if (taskType === 'restore') {
      updateProgress(job, taskId, 20, '正在恢复备份...', userId);
      await backupService.restoreBackup(params.filepath, {
        onProgress: async ({ current, total }) => {
          const progress = 20 + Math.floor((current / Math.max(total, 1)) * 70);
          updateProgress(
            job,
            taskId,
            Math.min(progress, 90),
            `正在恢复数据... (${current}/${total})`,
            userId,
          );
        },
        checkCancelled: async (message) => {
          await throwIfTaskCancelled(taskId, message);
        },
      });
      result = { message: '恢复成功' };
      updateProgress(job, taskId, 90, '备份恢复完成', userId);
    } else {
      throw new Error(`不支持的备份任务类型: ${taskType}`);
    }

    updateProgress(job, taskId, 100, '任务完成', userId);
    await taskRegistryService.markTaskCompleted(taskId, result, {
      message: taskType === 'create' ? '备份创建完成' : '备份恢复完成',
    });

    websocketService.sendTaskComplete(taskId, null, null, userId);

    return result;
  } catch (error) {
    if (isTaskCancelledError(error)) {
      logger.info(`[备份任务] 任务已取消 (${taskId}): ${error.message}`);
      await taskRegistryService.markTaskCancelled(taskId, {
        message: error.message || '备份任务已取消',
      });
      websocketService.sendTaskCancelled(
        taskId,
        error.message || '备份任务已取消',
        userId,
      );
      return {
        cancelled: true,
        message: error.message || '备份任务已取消',
      };
    }

    logger.error(`[备份任务] 处理失败 (${taskId}):`, error);
    await taskRegistryService.markTaskFailed(
      taskId,
      error.message || '备份任务失败',
      {
        message: error.message || '备份任务失败',
      },
    );
    websocketService.sendTaskError(
      taskId,
      error.message || '备份任务失败',
      userId,
    );
    throw error;
  }
}

module.exports = {
  processBackupTask,
};
