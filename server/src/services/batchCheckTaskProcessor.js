const variantCheckService = require('./variantCheckService');
const logger = require('../utils/logger');
const websocketService = require('./websocketService');

const DEFAULT_BATCH_CHECK_GROUP_CONCURRENCY = 2;

function getBatchCheckGroupConcurrency(total) {
  const configured = Number(process.env.BATCH_CHECK_GROUP_CONCURRENCY);
  const normalized =
    Number.isFinite(configured) && configured > 0
      ? Math.floor(configured)
      : DEFAULT_BATCH_CHECK_GROUP_CONCURRENCY;
  return Math.max(1, Math.min(normalized, total));
}

function buildVariantViewFromResult(serviceResult) {
  const d = serviceResult.details || {};
  const relationships = d.relationships || [];
  const isBroken =
    serviceResult.isBroken === true || serviceResult.isBroken === 1;

  let brotherAsins = [];
  let parentAsin = null;

  for (const rel of relationships) {
    if (Array.isArray(rel.parentAsins) && rel.parentAsins.length > 0) {
      parentAsin = (rel.parentAsins[0] || '').toString().trim().toUpperCase();
      if (parentAsin) break;
    }
    if (
      (rel.type === 'PARENT' || rel.relationshipType === 'PARENT') &&
      (rel.asin || rel.parentAsin)
    ) {
      parentAsin = (rel.asin || rel.parentAsin || '')
        .toString()
        .trim()
        .toUpperCase();
      if (parentAsin) break;
    }
  }

  let hasVariation = brotherAsins.length > 0;
  if (parentAsin && !hasVariation) {
    hasVariation = true;
  }

  const brand = d.brand || null;

  return {
    asin: d.asin || '',
    title: d.title || '',
    hasVariation,
    isBroken: typeof isBroken === 'boolean' ? isBroken : !hasVariation,
    parentAsin,
    brotherAsins,
    brand,
    raw: serviceResult,
  };
}

function mapResultWithVariantView(result) {
  let mappedResults = result?.details?.results;
  if (!Array.isArray(mappedResults)) {
    return result;
  }

  mappedResults = mappedResults.map((item) => {
    if (!item || typeof item !== 'object') return item;

    const variantView = buildVariantViewFromResult({
      isBroken: item.isBroken,
      details: item.details,
    });

    return {
      ...item,
      variantView,
    };
  });

  return {
    ...result,
    details: {
      ...(result?.details || {}),
      results: mappedResults || result?.details?.results || [],
    },
  };
}

/**
 * 更新任务进度
 */
function updateProgress(job, taskId, progress, message, userId = null) {
  job.progress(progress);
  websocketService.sendTaskProgress(taskId, progress, message, userId);
}

/**
 * 处理批量检查任务
 */
async function processBatchCheckTask(job) {
  const { taskId, groupIds, country, forceRefresh, userId } = job.data;

  try {
    updateProgress(job, taskId, 5, '正在初始化...', userId);

    const shouldForceRefresh = forceRefresh !== false;
    const total = groupIds.length;
    const results = new Array(total);
    const concurrency = getBatchCheckGroupConcurrency(total);
    let nextIndex = 0;
    let completedCount = 0;

    logger.info(
      `[批量检查任务] 执行并发数: ${concurrency}, 总任务数: ${total}`,
    );

    const runSingleCheck = async (index) => {
      const groupId = groupIds[index];
      try {
        const result = await variantCheckService.checkVariantGroup(
          groupId,
          shouldForceRefresh,
          { skipGroupStatus: true },
        );

        results[index] = {
          groupId,
          success: true,
          ...mapResultWithVariantView(result),
        };
      } catch (error) {
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

    // 通知任务完成
    websocketService.sendTaskComplete(
      taskId,
      null, // 批量检查不生成文件
      null,
      userId,
    );

    return {
      success: true,
      total: total,
      successCount,
      failedCount,
      results,
    };
  } catch (error) {
    logger.error(`[批量检查任务] 处理失败 (${taskId}):`, error);
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
