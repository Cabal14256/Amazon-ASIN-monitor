const logger = require('../utils/logger');
const websocketService = require('./websocketService');
const taskRegistryService = require('./taskRegistryService');
const { normalizeImportTaskResult } = require('./taskResultService');
const {
  throwIfTaskCancelled,
  isTaskCancelledError,
} = require('./taskCancellationService');
const { importFromFile } = require('./importService');
const { applyIncrementalImport } = require('./incrementalImportService');
const {
  attemptLimit,
  attemptsMade,
  willRetryAfterFailure,
} = require('./importTaskAttempts');

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
    incremental = false,
    previewId,
    expectedDigest,
  } = job.data;

  try {
    await taskRegistryService.markTaskProcessing(taskId, {
      taskSubType,
      message: '导入任务开始处理',
    });
    if (!incremental) {
      await throwIfTaskCancelled(taskId, '导入任务已取消');
    }

    const importHandler = incremental ? applyIncrementalImport : importFromFile;
    const result = await importHandler(
      {
        buffer: fileBuffer,
        originalname: originalFilename,
      },
      {
        mode: taskSubType === 'competitor-asin' ? 'competitor' : 'standard',
        ...(incremental ? { previewId, expectedDigest } : {}),
        onProgress: async (progress, message) => {
          updateProgress(job, taskId, progress, message, userId);
        },
        checkCancelled: async (message) => {
          await throwIfTaskCancelled(taskId, message);
        },
      },
    );

    job.progress(100);
    const completedResult = normalizeImportTaskResult(result, {
      originalFilename,
      taskSubType,
    });
    await taskRegistryService.markTaskCompleted(taskId, completedResult, {
      message: '导入完成',
    });
    websocketService.sendTaskComplete(taskId, null, null, userId);

    return completedResult;
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

    if (willRetryAfterFailure(job)) {
      const nextAttempt = attemptsMade(job) + 2;
      const retryMessage = `导入失败，等待第 ${nextAttempt}/${attemptLimit(
        job,
      )} 次重试`;
      logger.warn(`[导入任务] 本次处理失败，等待重试 (${taskId}):`, {
        message: error.message,
        nextAttempt,
      });
      try {
        const progress =
          Number(
            typeof job.progress === 'function' ? job.progress() : job.progress,
          ) || 0;
        await taskRegistryService.updateTaskProgress(
          taskId,
          progress,
          retryMessage,
        );
        websocketService.sendTaskProgress(
          taskId,
          progress,
          retryMessage,
          userId,
        );
      } catch (statusError) {
        logger.warn('[导入任务] 更新重试状态失败:', {
          message: statusError.message,
          taskId,
        });
      }
      throw error;
    }

    logger.error(`[导入任务] 处理失败 (${taskId}):`, {
      message: error.message,
      code: error.code || null,
    });
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
