const logger = require('../utils/logger');
const websocketService = require('./websocketService');
const taskRegistryService = require('./taskRegistryService');
const {
  throwIfTaskCancelled,
  isTaskCancelledError,
} = require('./taskCancellationService');
const {
  analyzeBatchDelete,
  executeBatchDelete,
  clearBatchDeleteCache,
  createEmptyAggregateResult,
  addDeleteResult,
  finalizeAggregateResult,
  splitPlanIntoChunks,
} = require('./batchDeleteService');
const { normalizeBatchDeleteTaskResult } = require('./taskResultService');

function updateProgress(job, taskId, progress, message, userId = null) {
  job.progress(progress);
  taskRegistryService
    .updateTaskProgress(taskId, progress, message)
    .catch((error) => {
      logger.warn('[批量删除任务] 更新任务注册表进度失败:', error.message);
    });
  websocketService.sendTaskProgress(taskId, progress, message, userId);
}

async function processBatchDeleteTask(job) {
  const {
    taskId,
    taskSubType = 'variant-group-delete',
    domain = 'asin',
    groupIds = [],
    asinIds = [],
    userId,
  } = job.data;

  try {
    await taskRegistryService.markTaskProcessing(taskId, {
      taskSubType,
      message: '批量删除任务开始处理',
    });
    await throwIfTaskCancelled(taskId, '批量删除任务已取消');
    updateProgress(job, taskId, 5, '正在分析删除目标...', userId);

    const analysis = await analyzeBatchDelete({
      domain,
      groupIds,
      asinIds,
    });
    const chunks = splitPlanIntoChunks(analysis);
    const aggregate = createEmptyAggregateResult(0);
    aggregate.totalRequested = analysis.totalRequested;
    addDeleteResult(aggregate, {
      totalRequested: 0,
      deletedGroupCount: 0,
      deletedDirectAsinCount: 0,
      deletedNestedAsinCount: 0,
      skipped: analysis.skipped,
    });

    if (chunks.length === 0) {
      updateProgress(job, taskId, 100, '批量删除完成', userId);
      const finalResult = normalizeBatchDeleteTaskResult(
        finalizeAggregateResult(aggregate),
      );
      await taskRegistryService.markTaskCompleted(taskId, finalResult, {
        message: '批量删除完成',
      });
      websocketService.sendTaskComplete(taskId, null, null, userId);
      return finalResult;
    }

    logger.info('[批量删除任务] 删除计划已生成', {
      taskId,
      domain,
      chunkCount: chunks.length,
      groupCount: analysis.groupIds.length,
      directAsinCount: analysis.directAsinIds.length,
      nestedAsinCount: analysis.deletedNestedAsinCount,
    });

    for (let index = 0; index < chunks.length; index += 1) {
      await throwIfTaskCancelled(
        taskId,
        `批量删除任务已取消（在处理第 ${index + 1} 个分块前停止）`,
      );

      const chunk = chunks[index];
      try {
        const chunkResult = await executeBatchDelete({
          domain,
          groupIds: chunk.groupIds,
          asinIds: chunk.asinIds,
          clearCache: false,
        });
        addDeleteResult(aggregate, chunkResult);
      } catch (error) {
        aggregate.failedCount += 1;
        aggregate.failedSamples.push({
          index: index + 1,
          groupCount: chunk.groupIds.length,
          asinCount: chunk.asinIds.length,
          error: error.message || '删除失败',
        });
        logger.error('[批量删除任务] 分块删除失败', {
          taskId,
          domain,
          chunkIndex: index + 1,
          message: error.message,
        });
      }

      const progress = Math.min(
        Math.floor(((index + 1) / chunks.length) * 90) + 5,
        95,
      );
      updateProgress(
        job,
        taskId,
        progress,
        `正在删除 ${index + 1}/${chunks.length}...`,
        userId,
      );
    }

    clearBatchDeleteCache(domain);
    updateProgress(job, taskId, 100, '批量删除完成', userId);

    aggregate.totalRequested = analysis.totalRequested;
    const finalResult = normalizeBatchDeleteTaskResult(
      finalizeAggregateResult(aggregate),
    );
    await taskRegistryService.markTaskCompleted(taskId, finalResult, {
      message: '批量删除完成',
    });
    websocketService.sendTaskComplete(taskId, null, null, userId);
    return finalResult;
  } catch (error) {
    if (isTaskCancelledError(error)) {
      logger.info('[批量删除任务] 任务已取消', {
        taskId,
        message: error.message,
      });
      await taskRegistryService.markTaskCancelled(taskId, {
        message: error.message || '批量删除任务已取消',
      });
      websocketService.sendTaskCancelled(
        taskId,
        error.message || '批量删除任务已取消',
        userId,
      );
      return {
        cancelled: true,
        message: error.message || '批量删除任务已取消',
      };
    }

    logger.error('[批量删除任务] 处理失败', {
      taskId,
      message: error.message,
    });
    await taskRegistryService.markTaskFailed(
      taskId,
      error.message || '批量删除失败',
      {
        message: error.message || '批量删除失败',
      },
    );
    websocketService.sendTaskError(
      taskId,
      error.message || '批量删除失败',
      userId,
    );
    throw error;
  }
}

module.exports = {
  processBatchDeleteTask,
};
