const variantCheckService = require('./variantCheckService');
const competitorVariantCheckService = require('./competitorVariantCheckService');
const logger = require('../utils/logger');
const websocketService = require('./websocketService');
const taskRegistryService = require('./taskRegistryService');
const {
  throwIfTaskCancelled,
  isTaskCancelledError,
} = require('./taskCancellationService');
const {
  mapVariantGroupResultWithVariantView,
} = require('./variantCheckResultMapper');

const DEFAULT_BATCH_CHECK_GROUP_CONCURRENCY = 2;

function getBatchCheckGroupConcurrency(total) {
  const configured = Number(process.env.BATCH_CHECK_GROUP_CONCURRENCY);
  const normalized =
    Number.isFinite(configured) && configured > 0
      ? Math.floor(configured)
      : DEFAULT_BATCH_CHECK_GROUP_CONCURRENCY;
  return Math.max(1, Math.min(normalized, total));
}

/**
 * 更新任务进度
 */
function updateProgress(job, taskId, progress, message, userId = null) {
  job.progress(progress);
  taskRegistryService
    .updateTaskProgress(taskId, progress, message)
    .catch((error) => {
      logger.warn('[批量检查任务] 更新任务注册表进度失败:', error.message);
    });
  websocketService.sendTaskProgress(taskId, progress, message, userId);
}

/**
 * 处理批量检查任务
 */
async function processBatchCheckTask(job) {
  const {
    taskId,
    taskSubType = 'variant-group',
    groupIds,
    country,
    forceRefresh,
    userId,
  } = job.data;

  try {
    await taskRegistryService.markTaskProcessing(taskId, {
      taskSubType,
      message: '批量检查任务开始处理',
    });
    await throwIfTaskCancelled(taskId, '批量检查任务已取消');
    updateProgress(job, taskId, 5, '正在初始化...', userId);

    const shouldForceRefresh = forceRefresh !== false;
    const total = groupIds.length;
    const results = new Array(total);
    const concurrency = getBatchCheckGroupConcurrency(total);
    let nextIndex = 0;
    let completedCount = 0;
    const runCheck =
      taskSubType === 'competitor-variant-group'
        ? competitorVariantCheckService.checkCompetitorVariantGroup.bind(
            competitorVariantCheckService,
          )
        : variantCheckService.checkVariantGroup.bind(variantCheckService);

    logger.info(
      `[批量检查任务] 执行并发数: ${concurrency}, 总任务数: ${total}`,
    );

    const runSingleCheck = async (index) => {
      const groupId = groupIds[index];
      try {
        await throwIfTaskCancelled(
          taskId,
          `批量检查任务已取消（在处理第 ${index + 1} 个分组前停止）`,
        );

        const result = await runCheck(groupId, shouldForceRefresh, {
          skipGroupStatus: true,
        });

        results[index] = {
          groupId,
          success: true,
          ...(taskSubType === 'competitor-variant-group'
            ? result
            : mapVariantGroupResultWithVariantView(result)),
        };
      } catch (error) {
        if (isTaskCancelledError(error)) {
          throw error;
        }
        logger.error(`[批量检查] 检查变体组 ${groupId} 失败:`, error);
        results[index] = {
          groupId,
          success: false,
          error: error.message || '检查失败',
        };
      } finally {
        completedCount += 1;
        const progress = Math.min(
          Math.floor((completedCount / total) * 90) + 5,
          95,
        );
        updateProgress(
          job,
          taskId,
          progress,
          `正在检查变体组 ${completedCount}/${total}...`,
          userId,
        );
      }
    };

    const workers = Array.from({ length: concurrency }, async () => {
      while (true) {
        await throwIfTaskCancelled(
          taskId,
          '批量检查任务已取消（等待当前并发批次结束）',
        );
        const currentIndex = nextIndex;
        nextIndex += 1;
        if (currentIndex >= total) {
          break;
        }
        await runSingleCheck(currentIndex);
      }
    });

    await Promise.all(workers);

    updateProgress(job, taskId, 95, '正在汇总结果...', userId);

    const successCount = results.filter((r) => r.success).length;
    const failedCount = results.filter((r) => !r.success).length;

    updateProgress(job, taskId, 100, '批量检查完成', userId);
    const result = {
      success: true,
      total: total,
      successCount,
      failedCount,
      results,
    };
    await taskRegistryService.markTaskCompleted(taskId, result, {
      message: '批量检查完成',
    });

    // 通知任务完成
    websocketService.sendTaskComplete(
      taskId,
      null, // 批量检查不生成文件
      null,
      userId,
    );

    return result;
  } catch (error) {
    if (isTaskCancelledError(error)) {
      logger.info(`[批量检查任务] 任务已取消 (${taskId}): ${error.message}`);
      await taskRegistryService.markTaskCancelled(taskId, {
        message: error.message || '批量检查任务已取消',
      });
      websocketService.sendTaskCancelled(
        taskId,
        error.message || '批量检查任务已取消',
        userId,
      );
      return {
        cancelled: true,
        message: error.message || '批量检查任务已取消',
      };
    }

    logger.error(`[批量检查任务] 处理失败 (${taskId}):`, error);
    await taskRegistryService.markTaskFailed(
      taskId,
      error.message || '批量检查失败',
      {
        message: error.message || '批量检查失败',
      },
    );
    websocketService.sendTaskError(
      taskId,
      error.message || '批量检查失败',
      userId,
    );
    throw error;
  }
}

module.exports = {
  processBatchCheckTask,
};
