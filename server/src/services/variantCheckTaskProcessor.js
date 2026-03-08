const logger = require('../utils/logger');
const variantCheckService = require('./variantCheckService');
const websocketService = require('./websocketService');
const {
  buildVariantViewFromResult,
  mapVariantGroupResultWithVariantView,
} = require('./variantCheckResultMapper');

function updateProgress(job, taskId, progress, message, userId = null) {
  job.progress(progress);
  websocketService.sendTaskProgress(taskId, progress, message, userId);
}

async function processVariantGroupCheckTask(job, taskId, params, userId) {
  const { groupId, forceRefresh } = params || {};

  if (!groupId) {
    throw new Error('变体组ID不能为空');
  }

  updateProgress(job, taskId, 5, '正在初始化变体组检查...', userId);

  const result = await variantCheckService.checkVariantGroup(
    groupId,
    forceRefresh !== false,
  );

  updateProgress(job, taskId, 95, '正在整理变体组检查结果...', userId);

  const mappedResult = mapVariantGroupResultWithVariantView(result);

  updateProgress(job, taskId, 100, '变体组检查完成', userId);
  websocketService.sendTaskComplete(taskId, null, null, userId);

  return mappedResult;
}

async function processAsinCheckTask(job, taskId, params, userId) {
  const { asinId, forceRefresh } = params || {};

  if (!asinId) {
    throw new Error('ASIN ID不能为空');
  }

  updateProgress(job, taskId, 5, '正在初始化ASIN检查...', userId);

  const result = await variantCheckService.checkSingleASIN(
    asinId,
    forceRefresh !== false,
  );

  updateProgress(job, taskId, 95, '正在整理ASIN检查结果...', userId);

  const variantView = buildVariantViewFromResult(result);

  updateProgress(job, taskId, 100, 'ASIN检查完成', userId);
  websocketService.sendTaskComplete(taskId, null, null, userId);

  return variantView;
}

async function processParentAsinQueryTask(job, taskId, params, userId) {
  const { asins, country } = params || {};

  if (!Array.isArray(asins) || asins.length === 0) {
    throw new Error('ASIN列表不能为空');
  }

  if (!country) {
    throw new Error('国家代码不能为空');
  }

  updateProgress(job, taskId, 5, '正在初始化父体查询...', userId);

  const results = await variantCheckService.batchQueryParentAsin(
    asins,
    country,
    {
      onProgress: ({ completed, total, asin }) => {
        const progress = Math.min(
          Math.floor((completed / total) * 85) + 10,
          95,
        );
        const targetAsin = asin ? ` (${asin})` : '';
        updateProgress(
          job,
          taskId,
          progress,
          `正在查询父体 ${completed}/${total}${targetAsin}...`,
          userId,
        );
      },
    },
  );

  updateProgress(job, taskId, 100, '父体查询完成', userId);
  websocketService.sendTaskComplete(taskId, null, null, userId);

  return results;
}

async function processVariantCheckTask(job) {
  const { taskId, taskType, params, userId } = job.data || {};

  if (!taskId || !taskType) {
    throw new Error('任务ID和任务类型不能为空');
  }

  try {
    switch (taskType) {
      case 'variant-group-check':
        return await processVariantGroupCheckTask(job, taskId, params, userId);
      case 'asin-check':
        return await processAsinCheckTask(job, taskId, params, userId);
      case 'parent-asin-query':
        return await processParentAsinQueryTask(job, taskId, params, userId);
      default:
        throw new Error(`不支持的变体检查任务类型: ${taskType}`);
    }
  } catch (error) {
    logger.error(`[变体检查任务] 处理失败 (${taskId}, ${taskType}):`, error);
    throw error;
  }
}

module.exports = {
  processVariantCheckTask,
};
