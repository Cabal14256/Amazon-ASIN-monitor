const variantCheckService = require('./variantCheckService');
const logger = require('../utils/logger');
const websocketService = require('./websocketService');

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
    const results = [];
    const total = groupIds.length;

    for (let i = 0; i < groupIds.length; i++) {
      const groupId = groupIds[i];

      try {
        updateProgress(
          job,
          taskId,
          Math.floor((i / total) * 90) + 5,
          `正在检查变体组 ${i + 1}/${total}...`,
          userId,
        );

        const result = await variantCheckService.checkVariantGroup(
          groupId,
          shouldForceRefresh,
        );

        // 构建变体视图
        let mappedResults = result?.details?.results;
        if (Array.isArray(mappedResults)) {
          mappedResults = mappedResults.map((item) => {
            if (!item || typeof item !== 'object') return item;

            const buildVariantViewFromResult = (serviceResult) => {
              const d = serviceResult.details || {};
              const relationships = d.relationships || [];
              const isBroken =
                serviceResult.isBroken === true || serviceResult.isBroken === 1;

              let brotherAsins = [];
              let parentAsin = null;

              for (const rel of relationships) {
                if (
                  Array.isArray(rel.parentAsins) &&
                  rel.parentAsins.length > 0
                ) {
                  parentAsin = (rel.parentAsins[0] || '')
                    .toString()
                    .trim()
                    .toUpperCase();
                  if (parentAsin) break;
                }
                if (
                  (rel.type === 'PARENT' ||
                    rel.relationshipType === 'PARENT') &&
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
                isBroken:
                  typeof isBroken === 'boolean' ? isBroken : !hasVariation,
                parentAsin,
                brotherAsins,
                brand,
                raw: serviceResult,
              };
            };

            const variantView = buildVariantViewFromResult({
              isBroken: item.isBroken,
              details: item.details,
            });

            return {
              ...item,
              variantView,
            };
          });
        }

        results.push({
          groupId,
          success: true,
          ...result,
          details: {
            ...(result?.details || {}),
            results: mappedResults || result?.details?.results || [],
          },
        });
      } catch (error) {
        logger.error(`[批量检查] 检查变体组 ${groupId} 失败:`, error);
        results.push({
          groupId,
          success: false,
          error: error.message || '检查失败',
        });
      }
    }

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
