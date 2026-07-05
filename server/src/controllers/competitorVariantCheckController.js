const competitorVariantCheckService = require('../services/competitorVariantCheckService');
const logger = require('../utils/logger');

function normalizeBoolean(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return null;
}

function getBatchCheckSyncMaxGroups() {
  const configured = Number(process.env.BATCH_CHECK_SYNC_MAX_GROUPS);
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : 20;
}

function getBatchCheckSyncConcurrency(total) {
  const configured = Number(process.env.BATCH_CHECK_SYNC_CONCURRENCY);
  const concurrency =
    Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 3;
  return Math.max(1, Math.min(concurrency, total || 1));
}

function shouldUseAsyncForBatchCheck(req, total) {
  if (total > getBatchCheckSyncMaxGroups()) {
    return true;
  }

  const bodyFlag = normalizeBoolean(req.body?.useAsync);
  if (bodyFlag !== null) {
    return bodyFlag;
  }

  const queryFlag = normalizeBoolean(req.query?.useAsync);
  if (queryFlag !== null) {
    return queryFlag;
  }

  return true;
}

async function runWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await worker(items[currentIndex], currentIndex);
      }
    },
  );

  await Promise.all(workers);
  return results;
}

// 检查变体组
exports.checkCompetitorVariantGroup = async (req, res) => {
  try {
    const { groupId } = req.params;
    // 从查询参数或请求体中获取 forceRefresh 标志（默认为 true，表示立即检查时强制刷新）
    const forceRefresh =
      req.query.forceRefresh !== 'false' && req.body.forceRefresh !== false;
    const result =
      await competitorVariantCheckService.checkCompetitorVariantGroup(
        groupId,
        forceRefresh,
      );

    res.json({
      success: true,
      data: result,
      errorCode: 0,
    });
  } catch (error) {
    logger.error('检查变体组错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '检查失败',
      errorCode: 500,
    });
  }
};

// 检查单个ASIN
exports.checkCompetitorASIN = async (req, res) => {
  try {
    const { asinId } = req.params;
    // 从查询参数或请求体中获取 forceRefresh 标志（默认为 true，表示立即检查时强制刷新）
    const forceRefresh =
      req.query.forceRefresh !== 'false' && req.body.forceRefresh !== false;
    const result =
      await competitorVariantCheckService.checkSingleCompetitorASIN(
        asinId,
        forceRefresh,
      );

    res.json({
      success: true,
      data: result,
      errorCode: 0,
    });
  } catch (error) {
    logger.error('检查ASIN错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '检查失败',
      errorCode: 500,
    });
  }
};

// 批量检查变体组
exports.batchCheckCompetitorVariantGroups = async (req, res) => {
  try {
    const { groupIds, country, forceRefresh } = req.body;
    const shouldForceRefresh = forceRefresh !== false;
    const userId = req.user?.userId || req.user?.id;

    if (!groupIds || !Array.isArray(groupIds) || groupIds.length === 0) {
      return res.status(400).json({
        success: false,
        errorMessage: '请提供竞品变体组ID列表',
        errorCode: 400,
      });
    }

    if (shouldUseAsyncForBatchCheck(req, groupIds.length)) {
      const { v4: uuidv4 } = require('uuid');
      const batchCheckTaskQueue = require('../services/batchCheckTaskQueue');
      const taskRegistryService = require('../services/taskRegistryService');

      const taskId = uuidv4();
      await taskRegistryService.createTask({
        taskId,
        taskType: 'batch-check',
        taskSubType: 'competitor-variant-group',
        title: '竞品批量变体检查',
        userId,
        message: '竞品批量检查任务已创建，等待处理',
      });
      await batchCheckTaskQueue.enqueue({
        taskId,
        taskSubType: 'competitor-variant-group',
        groupIds,
        country,
        forceRefresh,
        userId,
      });

      logger.info(
        `[批量检查任务] 创建竞品任务成功: ${taskId}, 变体组数量: ${groupIds.length}, 用户: ${userId}`,
      );

      return res.json({
        success: true,
        data: {
          taskId,
          status: 'pending',
          total: groupIds.length,
        },
        errorCode: 0,
      });
    }

    const concurrency = getBatchCheckSyncConcurrency(groupIds.length);
    const results = await runWithConcurrency(
      groupIds,
      concurrency,
      async (groupId) => {
        try {
          const result =
            await competitorVariantCheckService.checkCompetitorVariantGroup(
              groupId,
              shouldForceRefresh,
            );
          return {
            groupId,
            success: true,
            ...result,
          };
        } catch (error) {
          return {
            groupId,
            success: false,
            error: error.message,
          };
        }
      },
    );

    res.json({
      success: true,
      data: {
        total: groupIds.length,
        results,
      },
      errorCode: 0,
    });
  } catch (error) {
    logger.error('批量检查错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '批量检查失败',
      errorCode: 500,
    });
  }
};
