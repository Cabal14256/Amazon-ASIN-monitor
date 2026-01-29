const variantCheckService = require('../services/variantCheckService');
const logger = require('../utils/logger');

// ===============================
// 辅助方法：把 service 返回的数据
// 转成和 variantMonitor.js 中 getVariantData 同一套语义
// ===============================
function buildVariantViewFromResult(serviceResult) {
  if (!serviceResult || typeof serviceResult !== 'object') {
    return {
      asin: null,
      title: '',
      hasVariation: false,
      isBroken: true,
      parentAsin: null,
      brotherAsins: [],
      brand: null,
      raw: serviceResult || null,
    };
  }

  const { isBroken, details } = serviceResult;
  const d = details || {};

  const asin = (d.asin || '').toString().trim().toUpperCase();
  const title = d.title || '';

  // variations: [{ asin, title }]
  const variations = Array.isArray(d.variations)
    ? d.variations.map((v) => ({
        asin: (v.asin || '').toString().trim().toUpperCase(),
        title: v.title || '',
      }))
    : [];

  // 兄弟 ASIN = 变体 ASIN 列表里除去自己
  const brotherAsins = variations
    .map((v) => v.asin)
    .filter((a) => a && a !== asin);

  // 从 relationships 中尽量找出 parentAsin
  // （参考 variantMonitor.js 中的父体兜底逻辑的精简版）
  const relationships = Array.isArray(d.relationships) ? d.relationships : [];
  let parentAsin = null;

  for (const rel of relationships) {
    // Catalog Items 2022-04-01: VARIATION 关系中的 parentAsins 数组
    if (Array.isArray(rel.parentAsins) && rel.parentAsins.length > 0) {
      parentAsin = (rel.parentAsins[0] || '').toString().trim().toUpperCase();
      if (parentAsin) break;
    }
    // 某些旧结构可能是 PARENT 类型关系
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

  // hasVariation：对齐 variantMonitor.js 的逻辑：
  // 1）只要有兄弟 asin 就认为有变体
  // 2）如果兄弟 asin 没有，但拿到了父体，也认为存在变体
  let hasVariation = brotherAsins.length > 0;

  if (parentAsin && !hasVariation) {
    hasVariation = true;
  }

  // brand：variantCheckService 目前没有带 brand，这里先留一个字段，
  // 后续如果在 service 的 details 里加上 brand，这里会自动透传
  const brand = d.brand || null;

  return {
    asin,
    title,
    hasVariation,
    // isBroken 仍然保留给前端（有/无变体的标志）
    isBroken: typeof isBroken === 'boolean' ? isBroken : !hasVariation,
    parentAsin,
    brotherAsins,
    brand,
    // raw：保留原始 service 返回值，方便排查
    raw: serviceResult,
  };
}

// ===============================
// 检查变体组
// ===============================
exports.checkVariantGroup = async (req, res) => {
  try {
    const { groupId } = req.params;
    // 从查询参数或请求体中获取 forceRefresh 标志（默认为 true，表示立即检查时强制刷新）
    const forceRefresh =
      req.query.forceRefresh !== 'false' && req.body.forceRefresh !== false;

    const result = await variantCheckService.checkVariantGroup(
      groupId,
      forceRefresh,
    );

    // 变体组整体结构沿用原来的，
    // 只是给 details.results 里的每个 ASIN 补充一个 variantView 字段
    let mappedResults = result?.details?.results;

    if (Array.isArray(mappedResults)) {
      mappedResults = mappedResults.map((item) => {
        // item 一般会包含 { asin, asinId, country, isBroken, details }
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
    }

    res.json({
      success: true,
      data: {
        ...result,
        details: {
          ...(result?.details || {}),
          results: mappedResults || result?.details?.results || [],
        },
      },
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
    // 从查询参数或请求体中获取 forceRefresh 标志（默认为 true，表示立即检查时强制刷新）
    const forceRefresh =
      req.query.forceRefresh !== 'false' && req.body.forceRefresh !== false;

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
    const { groupIds, country, forceRefresh, useAsync } = req.body;
    const userId = req.user?.userId || req.user?.id;

    if (!groupIds || !Array.isArray(groupIds) || groupIds.length === 0) {
      return res.status(400).json({
        success: false,
        errorMessage: '请提供变体组ID列表',
        errorCode: 400,
      });
    }

    // 如果使用异步模式，创建后台任务
    if (useAsync === true) {
      const { v4: uuidv4 } = require('uuid');
      const batchCheckTaskQueue = require('../services/batchCheckTaskQueue');
      const logger = require('../utils/logger');

      const taskId = uuidv4();
      await batchCheckTaskQueue.enqueue({
        taskId,
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

        // 同样给每个结果里的 ASIN 明细加上 variantView
        let mappedResults = result?.details?.results;
        if (Array.isArray(mappedResults)) {
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
