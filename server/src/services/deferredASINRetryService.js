const {
  persistDeferredNotFoundResult,
} = require('./deferredASINPersistenceService');
const logger = require('../utils/logger');

function normalizeOwner(owner) {
  return owner === 'competitor' ? 'competitor' : 'primary';
}

async function processDeferredASINs(
  region,
  owner = 'primary',
  dependencies = {},
) {
  const normalizedOwner = normalizeOwner(owner);
  let variantCheckService;
  const getVariantCheckService = () => {
    variantCheckService =
      variantCheckService || require('./variantCheckService');
    return variantCheckService;
  };
  const getDeferred =
    dependencies.getDeferredASINs || getVariantCheckService().getDeferredASINs;
  const clearDeferred =
    dependencies.clearDeferredASINCheck ||
    getVariantCheckService().clearDeferredASINCheck;
  const checkVariants =
    dependencies.checkASINVariants ||
    getVariantCheckService().checkASINVariants;
  const persistNotFound =
    dependencies.persistDeferredNotFoundResult || persistDeferredNotFoundResult;
  const priority =
    dependencies.priority || require('./rateLimiter').PRIORITY.SCHEDULED;
  const deferredByASIN = new Map();
  for (const item of getDeferred(region)) {
    if (normalizeOwner(item.owner) !== normalizedOwner) {
      continue;
    }
    const key = `${item.country}:${item.asin}`;
    const previous = deferredByASIN.get(key);
    const deferredAt = Number(item.deferredAt) || 0;
    const previousDeferredAt = Number(previous?.deferredAt) || 0;
    if (!previous || deferredAt >= previousDeferredAt) {
      deferredByASIN.set(key, item);
    }
  }
  const deferredASINs = Array.from(deferredByASIN.values());

  if (deferredASINs.length === 0) {
    logger.info(
      `[延后队列] ${region}区域没有需要处理的 ${normalizedOwner} ASIN`,
    );
    return {
      total: 0,
      success: 0,
      failed: 0,
      notFoundResults: [],
    };
  }

  logger.info(
    `[延后队列] 开始处理 ${region}区域的 ${deferredASINs.length} 个 ${normalizedOwner} ASIN`,
  );

  let successCount = 0;
  let failedCount = 0;
  const notFoundResults = [];

  for (const deferred of deferredASINs) {
    if (deferred.retryCount >= 1) {
      logger.warn(
        `[延后队列] ${normalizedOwner} ASIN ${deferred.asin} (${deferred.country}) 已达到最大重试次数，跳过`,
      );
      failedCount++;
      clearDeferred(deferred.asin, deferred.country, region, normalizedOwner);
      continue;
    }

    let shouldClearDeferred = true;
    try {
      logger.info(
        `[延后队列] 重试检查 ${normalizedOwner} ASIN ${deferred.asin} (${deferred.country})`,
      );
      const result = await checkVariants(
        deferred.asin,
        deferred.country,
        true,
        priority,
        { owner: normalizedOwner },
      );

      if (!result || result.hasVariants === undefined) {
        failedCount++;
        logger.warn(
          `[延后队列] ${normalizedOwner} ASIN ${deferred.asin} (${deferred.country}) 重试失败：结果无效`,
        );
        continue;
      }

      if (result.errorType === 'NOT_FOUND') {
        const persisted = await persistNotFound(deferred, result);
        if (persisted) {
          notFoundResults.push(persisted);
        }
      }

      successCount++;
      const outcome =
        result.errorType === 'NOT_FOUND'
          ? '重试确认不存在并已标记异常'
          : '重试成功';
      logger.info(
        `[延后队列] ${normalizedOwner} ASIN ${deferred.asin} (${deferred.country}) ${outcome}`,
      );
    } catch (error) {
      shouldClearDeferred = !error.preserveDeferred;
      failedCount++;
      const message = error.message || String(error);
      if (error.isDeferred) {
        logger.warn(
          `[延后队列] ${normalizedOwner} ASIN ${deferred.asin} (${deferred.country}) 重试再次失败，已标记为最终失败: ${message}`,
        );
      } else {
        logger.error(
          `[延后队列] ${normalizedOwner} ASIN ${deferred.asin} (${deferred.country}) 重试失败:`,
          message,
        );
      }
    } finally {
      if (shouldClearDeferred) {
        clearDeferred(deferred.asin, deferred.country, region, normalizedOwner);
      }
    }
  }

  logger.info(
    `[延后队列] ${region}区域 ${normalizedOwner} 延后队列处理完成: 总计 ${deferredASINs.length}, 成功 ${successCount}, 失败 ${failedCount}`,
  );

  return {
    total: deferredASINs.length,
    success: successCount,
    failed: failedCount,
    notFoundResults,
  };
}

function mergeDeferredNotFoundResults(countryResults, notFoundResults) {
  let addedGroups = 0;

  for (const item of notFoundResults) {
    const countryResult = (countryResults[item.country] = countryResults[
      item.country
    ] || {
      country: item.country,
      totalGroups: 0,
      brokenGroups: 0,
      brokenGroupNames: [],
      brokenGroupDetails: [],
      brokenASINs: [],
      brokenByType: {
        SP_API_ERROR: 0,
        NOT_FOUND: 0,
        NO_VARIANTS: 0,
      },
      checkTime: item.checkTime,
    });
    countryResult.brokenByType = {
      SP_API_ERROR: 0,
      NOT_FOUND: 0,
      NO_VARIANTS: 0,
      ...(countryResult.brokenByType || {}),
    };
    countryResult.brokenGroupNames = countryResult.brokenGroupNames || [];
    countryResult.brokenGroupDetails = countryResult.brokenGroupDetails || [];
    countryResult.brokenASINs = countryResult.brokenASINs || [];

    const groupName = item.variantGroupName || '未分组';
    const existingASIN = countryResult.brokenASINs.find(
      (entry) => entry.asin === item.asin,
    );
    const existingGroup =
      countryResult.brokenGroupNames.includes(groupName) ||
      countryResult.brokenGroupDetails.some(
        (entry) => entry.groupName === groupName,
      );
    const alreadyNotFound = existingASIN?.errorType === 'NOT_FOUND';

    if (!existingGroup) {
      countryResult.totalGroups++;
      countryResult.brokenGroups++;
      countryResult.brokenGroupNames.push(groupName);
      countryResult.brokenGroupDetails.push({ groupName });
      addedGroups++;
    }

    if (!alreadyNotFound) {
      if (
        (existingASIN || existingGroup) &&
        countryResult.brokenByType.SP_API_ERROR > 0
      ) {
        countryResult.brokenByType.SP_API_ERROR--;
      }
      countryResult.brokenByType.NOT_FOUND++;
    }

    if (existingASIN) {
      existingASIN.name = item.asinName || existingASIN.name || '';
      existingASIN.groupName = groupName;
      existingASIN.brand = item.brand || existingASIN.brand || '';
      existingASIN.errorType = 'NOT_FOUND';
    } else if (item.notifyEnabled) {
      countryResult.brokenASINs.push({
        asin: item.asin,
        name: item.asinName || '',
        groupName,
        brand: item.brand || '',
        errorType: 'NOT_FOUND',
      });
    }

    if (
      !countryResult.checkTime ||
      new Date(item.checkTime) > new Date(countryResult.checkTime)
    ) {
      countryResult.checkTime = item.checkTime;
    }
  }

  return { addedGroups };
}

module.exports = {
  mergeDeferredNotFoundResults,
  processDeferredASINs,
};
