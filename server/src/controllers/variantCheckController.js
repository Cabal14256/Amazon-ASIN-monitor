const variantCheckService = require('../services/variantCheckService');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');
const variantCheckTaskQueue = require('../services/variantCheckTaskQueue');
const {
  buildVariantViewFromResult,
  mapVariantGroupResultWithVariantView,
} = require('../services/variantCheckResultMapper');

// ===============================
// 辅助方法：判断是否显式使用后台任务模式
// ===============================
function shouldUseAsync(req) {
  const normalizeBoolean = (value) => {
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
  };

  const bodyFlag = normalizeBoolean(req.body?.useAsync);
  if (bodyFlag !== null) {
    return bodyFlag;
  }

  const queryFlag = normalizeBoolean(req.query?.useAsync);
  if (queryFlag !== null) {
    return queryFlag;
  }

  // 未显式指定 useAsync 时：
  // - 匿名请求默认同步返回，避免落入受保护的任务查询接口造成调用方无法取回结果
  // - 已认证请求默认异步，保持前端任务队列体验
  return Boolean(req.user?.userId || req.user?.id);
}

async function createVariantCheckTask(taskType, params, userId) {
  const taskId = uuidv4();
  await variantCheckTaskQueue.enqueue({
    taskId,
    taskType,
    params,
    userId: userId || null,
  });

  logger.info(
    `[变体检查任务] 创建任务成功: ${taskId}, 类型: ${taskType}, 用户: ${
      userId || 'anonymous'
    }`,
  );

  return {
    taskId,
    status: 'pending',
    taskType,
  };
}

// ===============================
// 检查变体组
// ===============================
exports.checkVariantGroup = async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user?.userId || req.user?.id;
    // 从查询参数或请求体中获取 forceRefresh 标志（默认为 true，表示立即检查时强制刷新）
    const forceRefresh =
      req.query.forceRefresh !== 'false' && req.body.forceRefresh !== false;

    if (shouldUseAsync(req)) {
      const task = await createVariantCheckTask(
        'variant-group-check',
        { groupId, forceRefresh },
        userId,
      );

      return res.json({
        success: true,
        data: task,
        errorCode: 0,
      });
    }

    const result = await variantCheckService.checkVariantGroup(
      groupId,
      forceRefresh,
    );

    res.json({
      success: true,
      data: mapVariantGroupResultWithVariantView(result),
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

// ===============================
// 检查单个 ASIN（对齐 variantMonitor.js 的 hasVariation 语义）
// ===============================
exports.checkASIN = async (req, res) => {
  try {
    const { asinId } = req.params;
    const userId = req.user?.userId || req.user?.id;
    // 从查询参数或请求体中获取 forceRefresh 标志（默认为 true，表示立即检查时强制刷新）
    const forceRefresh =
      req.query.forceRefresh !== 'false' && req.body.forceRefresh !== false;

    if (shouldUseAsync(req)) {
      const task = await createVariantCheckTask(
        'asin-check',
        { asinId, forceRefresh },
        userId,
      );

      return res.json({
        success: true,
        data: task,
        errorCode: 0,
      });
    }

    const result = await variantCheckService.checkSingleASIN(
      asinId,
      forceRefresh,
    );

    const variantView = buildVariantViewFromResult(result);

    res.json({
      success: true,
      data: variantView,
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

// ===============================
// 批量检查变体组
// ===============================
exports.batchCheckVariantGroups = async (req, res) => {
  try {
    const { groupIds, country, forceRefresh } = req.body;
    const userId = req.user?.userId || req.user?.id;

    if (!groupIds || !Array.isArray(groupIds) || groupIds.length === 0) {
      return res.status(400).json({
        success: false,
        errorMessage: '请提供变体组ID列表',
        errorCode: 400,
      });
    }

    if (shouldUseAsync(req)) {
      const batchCheckTaskQueue = require('../services/batchCheckTaskQueue');
      const taskRegistryService = require('../services/taskRegistryService');

      const taskId = uuidv4();
      await taskRegistryService.createTask({
        taskId,
        taskType: 'batch-check',
        taskSubType: 'variant-group',
        title: '批量变体检查',
        userId,
        message: '批量检查任务已创建，等待处理',
      });
      await batchCheckTaskQueue.enqueue({
        taskId,
        taskSubType: 'variant-group',
        groupIds,
        country,
        forceRefresh,
        userId,
      });

      logger.info(
        `[批量检查任务] 创建任务成功: ${taskId}, 变体组数量: ${groupIds.length}, 用户: ${userId}`,
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

    // 同步模式（原有逻辑）
    // 批量检查时默认也强制刷新（不使用缓存）
    const shouldForceRefresh = forceRefresh !== false;

    const results = [];
    for (const groupId of groupIds) {
      try {
        const result = await variantCheckService.checkVariantGroup(
          groupId,
          shouldForceRefresh,
        );

        results.push({
          groupId,
          success: true,
          ...mapVariantGroupResultWithVariantView(result),
        });
      } catch (error) {
        results.push({
          groupId,
          success: false,
          error: error.message,
        });
      }
    }

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

// ===============================
// 批量查询ASIN的父变体
// ===============================
exports.batchQueryParentAsin = async (req, res) => {
  try {
    const { asins, country } = req.body;
    const userId = req.user?.userId || req.user?.id;

    if (!asins || !Array.isArray(asins) || asins.length === 0) {
      return res.status(400).json({
        success: false,
        errorMessage: '请提供ASIN列表',
        errorCode: 400,
      });
    }

    if (!country || typeof country !== 'string') {
      return res.status(400).json({
        success: false,
        errorMessage: '请提供国家代码',
        errorCode: 400,
      });
    }

    if (shouldUseAsync(req)) {
      const task = await createVariantCheckTask(
        'parent-asin-query',
        { asins, country },
        userId,
      );

      return res.json({
        success: true,
        data: task,
        errorCode: 0,
      });
    }

    const results = await variantCheckService.batchQueryParentAsin(
      asins,
      country,
    );

    res.json({
      success: true,
      data: results,
      errorCode: 0,
    });
  } catch (error) {
    logger.error('批量查询父变体错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '批量查询失败',
      errorCode: 500,
    });
  }
};
