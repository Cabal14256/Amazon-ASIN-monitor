const logger = require('../utils/logger');
const websocketService = require('./websocketService');
const taskRegistryService = require('./taskRegistryService');
const {
  throwIfTaskCancelled,
  isTaskCancelledError,
} = require('./taskCancellationService');
const { importFromFile } = require('./importService');

/**
 * 更新任务进度
 */
function updateProgress(job, taskId, progress, message, userId = null) {
  job.progress(progress);
  taskRegistryService
    .updateTaskProgress(taskId, progress, message)
    .catch((error) => {
      logger.warn('[导入任务] 更新任务注册表进度失败:', error.message);
    });
  websocketService.sendTaskProgress(taskId, progress, message, userId);
}

/**
 * 处理导入任务
 */
async function processImportTask(job) {
  const {
    taskId,
    taskSubType = 'asin',
    fileBuffer,
    originalFilename,
    userId,
  } = job.data;

  try {
    await taskRegistryService.markTaskProcessing(taskId, {
      taskSubType,
      message: '导入任务开始处理',
    });
    await throwIfTaskCancelled(taskId, '导入任务已取消');

    const result = await importFromFile(
      {
        buffer: fileBuffer,
        originalname: originalFilename,
      },
      {
        mode: taskSubType === 'competitor-asin' ? 'competitor' : 'standard',
        onProgress: async (progress, message) => {
          updateProgress(job, taskId, progress, message, userId);
        },
        checkCancelled: async (message) => {
          await throwIfTaskCancelled(taskId, message);
        },
      },
    );

    updateProgress(job, taskId, 100, '导入完成', userId);
    await taskRegistryService.markTaskCompleted(taskId, result, {
      message: '导入完成',
    });
    websocketService.sendTaskComplete(taskId, null, null, userId);

    return result;
  } catch (error) {
    if (isTaskCancelledError(error)) {
      logger.info(`[导入任务] 任务已取消 (${taskId}): ${error.message}`);
      await taskRegistryService.markTaskCancelled(taskId, {
        message: error.message || '导入任务已取消',
      });
      websocketService.sendTaskCancelled(
        taskId,
        error.message || '导入任务已取消',
        userId,
      );
      return {
        cancelled: true,
        message: error.message || '导入任务已取消',
      };
    }

    logger.error(`[导入任务] 处理失败 (${taskId}):`, error);
    await taskRegistryService.markTaskFailed(
      taskId,
      error.message || '导入失败',
      {
        message: error.message || '导入失败',
      },
    );
    websocketService.sendTaskError(taskId, error.message || '导入失败', userId);
    throw error;
  }
}

module.exports = {
  processImportTask,
};
