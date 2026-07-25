const {
  persistDeferredASINResult,
} = require('./deferredASINPersistenceService');
const logger = require('../utils/logger');

const AUTOMATIC_ERROR_TYPES = new Set([
  'SP_API_ERROR',
  'NOT_FOUND',
  'NO_VARIANTS',
]);

function normalizeOwner(owner) {
  return owner === 'competitor' ? 'competitor' : 'primary';
}

function getASINClassificationKey({
  asin,
  asinId = null,
  variantGroupId = null,
}) {
  const groupKey = variantGroupId
    ? `group:${variantGroupId}`
    : `ungrouped:${asinId || asin}`;
  return `${groupKey}:asin:${asinId || asin}`;
}

function getDeferredGroupKey(item) {
  return item.variantGroupId
    ? `group:${item.variantGroupId}`
    : `ungrouped:${item.asinId || item.asin}`;
}

function getASINCheckOutcome(groupResult, asinInfo) {
  const currentResult = (groupResult?.details?.results || []).find(
    (entry) =>
      String(entry?.asin || '').toUpperCase() ===
      String(asinInfo?.asin || '').toUpperCase(),
  );
  const brokenASIN = (groupResult?.brokenASINs || []).find(
    (entry) =>
      String(typeof entry === 'string' ? entry : entry?.asin).toUpperCase() ===
      String(asinInfo?.asin || '').toUpperCase(),
  );
  const isDeferred = currentResult?.isDeferred === true;
  const currentIsBroken =
    !isDeferred &&
    currentResult != null &&
    (currentResult.isBroken === true ||
      currentResult.hasVariants === false ||
      (currentResult.hasVariants !== true &&
        currentResult.variantCount !== undefined &&
        Number(currentResult.variantCount) === 0));
  const automaticErrorType = isDeferred
    ? null
    : currentResult?.errorType ||
      (currentIsBroken
        ? 'NO_VARIANTS'
        : typeof brokenASIN === 'object'
        ? brokenASIN?.errorType || null
        : null);
  const manualErrorType =
    asinInfo?.statusSource === 'MANUAL' ||
    asinInfo?.statusSource === 'AUTO+MANUAL'
      ? 'MANUAL_MARKED'
      : null;
  const errorType = automaticErrorType || manualErrorType;

  return {
    currentResult: currentResult || null,
    isDeferred,
    errorType,
    classificationErrorType: AUTOMATIC_ERROR_TYPES.has(automaticErrorType)
      ? automaticErrorType
      : null,
  };
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
  const persistResult =
    dependencies.persistDeferredASINResult || persistDeferredASINResult;
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
      deferredResults: [],
    };
  }

  logger.info(
    `[延后队列] 开始处理 ${region}区域的 ${deferredASINs.length} 个 ${normalizedOwner} ASIN`,
  );

  let successCount = 0;
  let failedCount = 0;
  const deferredResults = [];

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

      const persisted = await persistResult(deferred, result);
      if (!persisted) {
        const persistenceError = new Error(
          `延后队列中的 ASIN ${deferred.asin} (${deferred.country}) 结果未持久化`,
        );
        persistenceError.preserveDeferred = true;
        throw persistenceError;
      }
      deferredResults.push(persisted);

      successCount++;
      const outcome = persisted.errorType
        ? `重试确认 ${persisted.errorType} 并已更新状态`
        : '重试成功并已恢复正常';
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
    deferredResults,
  };
}

function removeFirstMatchingGroupName(groupNames, groupName) {
  const index = groupNames.indexOf(groupName);
  if (index >= 0) {
    groupNames.splice(index, 1);
  }
}

function mergeDeferredResults(countryResults, deferredResults) {
  let addedGroups = 0;
  let brokenDelta = 0;

  for (const item of deferredResults) {
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
      asinClassifications: {},
      checkedGroupKeys: [],
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
    countryResult.asinClassifications = countryResult.asinClassifications || {};
    countryResult.checkedGroupKeys = countryResult.checkedGroupKeys || [];

    const groupName = item.variantGroupName || '未分组';
    const classificationKey = getASINClassificationKey(item);
    const groupKey = getDeferredGroupKey(item);
    const existingASIN = countryResult.brokenASINs.find(
      (entry) =>
        entry.asin === item.asin &&
        (item.variantGroupId
          ? entry.variantGroupId === item.variantGroupId
          : !entry.variantGroupId),
    );
    const deferredGroupKey = item.asinId || item.asin;
    const existingGroupIndex = countryResult.brokenGroupDetails.findIndex(
      (entry) =>
        item.variantGroupId
          ? entry.variantGroupId === item.variantGroupId
          : !entry.variantGroupId &&
            entry.deferredGroupKey === deferredGroupKey,
    );
    const existingGroup =
      existingGroupIndex >= 0
        ? countryResult.brokenGroupDetails[existingGroupIndex]
        : null;
    const wasChecked =
      countryResult.checkedGroupKeys.includes(groupKey) ||
      existingGroupIndex >= 0;
    const wasBroken = Boolean(existingGroup);
    const isBroken = item.isBroken === true || Number(item.isBroken) === 1;
    const groupIsBroken =
      item.groupIsBroken === true || Number(item.groupIsBroken) === 1;
    const oldErrorType =
      countryResult.asinClassifications[classificationKey] ||
      (AUTOMATIC_ERROR_TYPES.has(existingASIN?.errorType)
        ? existingASIN.errorType
        : null);
    const newErrorType =
      item.autoIsBroken !== false && AUTOMATIC_ERROR_TYPES.has(item.errorType)
        ? item.errorType
        : null;

    if (!wasChecked) {
      countryResult.totalGroups++;
      countryResult.checkedGroupKeys.push(groupKey);
      addedGroups++;
    } else if (!countryResult.checkedGroupKeys.includes(groupKey)) {
      countryResult.checkedGroupKeys.push(groupKey);
    }

    if (!wasBroken && groupIsBroken) {
      countryResult.brokenGroups++;
      countryResult.brokenGroupNames.push(groupName);
      countryResult.brokenGroupDetails.push({
        variantGroupId: item.variantGroupId || null,
        groupName,
        deferredGroupKey: item.variantGroupId ? null : deferredGroupKey,
        statusSource: item.groupStatusSource || 'NORMAL',
        manualBroken: item.groupManualBroken || 0,
        manualBrokenReason: item.groupManualBrokenReason || '',
        manualBrokenUpdatedAt: item.groupManualBrokenUpdatedAt || null,
        manualBrokenUpdatedBy: item.groupManualBrokenUpdatedBy || null,
      });
      brokenDelta++;
    } else if (wasBroken && !groupIsBroken) {
      countryResult.brokenGroups = Math.max(0, countryResult.brokenGroups - 1);
      countryResult.brokenGroupDetails.splice(existingGroupIndex, 1);
      removeFirstMatchingGroupName(
        countryResult.brokenGroupNames,
        existingGroup.groupName || groupName,
      );
      brokenDelta--;
    } else if (existingGroup) {
      Object.assign(existingGroup, {
        groupName,
        statusSource:
          item.groupStatusSource || existingGroup.statusSource || 'NORMAL',
        manualBroken: item.groupManualBroken ?? existingGroup.manualBroken ?? 0,
        manualBrokenReason:
          item.groupManualBrokenReason ||
          existingGroup.manualBrokenReason ||
          '',
        manualBrokenUpdatedAt:
          item.groupManualBrokenUpdatedAt ||
          existingGroup.manualBrokenUpdatedAt ||
          null,
        manualBrokenUpdatedBy:
          item.groupManualBrokenUpdatedBy ||
          existingGroup.manualBrokenUpdatedBy ||
          null,
      });
    }

    if (
      oldErrorType &&
      oldErrorType !== newErrorType &&
      countryResult.brokenByType[oldErrorType] > 0
    ) {
      countryResult.brokenByType[oldErrorType]--;
    }
    if (newErrorType && oldErrorType !== newErrorType) {
      countryResult.brokenByType[newErrorType]++;
    }
    if (newErrorType) {
      countryResult.asinClassifications[classificationKey] = newErrorType;
    } else {
      delete countryResult.asinClassifications[classificationKey];
    }

    if (existingASIN && (!isBroken || !item.notifyEnabled)) {
      countryResult.brokenASINs.splice(
        countryResult.brokenASINs.indexOf(existingASIN),
        1,
      );
    } else if (existingASIN) {
      existingASIN.name = item.asinName || existingASIN.name || '';
      existingASIN.groupName = groupName;
      existingASIN.brand = item.brand || existingASIN.brand || '';
      existingASIN.errorType =
        item.errorType ||
        (item.statusSource === 'MANUAL' || item.statusSource === 'AUTO+MANUAL'
          ? 'MANUAL_MARKED'
          : null);
      existingASIN.asinId = item.asinId || existingASIN.asinId || null;
      existingASIN.variantGroupId =
        item.variantGroupId || existingASIN.variantGroupId || null;
      existingASIN.statusSource = item.statusSource || 'NORMAL';
      existingASIN.manualBroken = item.manualBroken || 0;
      existingASIN.manualBrokenReason = item.manualBrokenReason || '';
      existingASIN.manualBrokenUpdatedAt = item.manualBrokenUpdatedAt || null;
      existingASIN.manualBrokenUpdatedBy = item.manualBrokenUpdatedBy || null;
    } else if (isBroken && item.notifyEnabled) {
      countryResult.brokenASINs.push({
        asin: item.asin,
        asinId: item.asinId || null,
        name: item.asinName || '',
        variantGroupId: item.variantGroupId || null,
        groupName,
        brand: item.brand || '',
        errorType:
          item.errorType ||
          (item.statusSource === 'MANUAL' || item.statusSource === 'AUTO+MANUAL'
            ? 'MANUAL_MARKED'
            : null),
        statusSource: item.statusSource || 'NORMAL',
        manualBroken: item.manualBroken || 0,
        manualBrokenReason: item.manualBrokenReason || '',
        manualBrokenUpdatedAt: item.manualBrokenUpdatedAt || null,
        manualBrokenUpdatedBy: item.manualBrokenUpdatedBy || null,
      });
    }

    if (
      !countryResult.checkTime ||
      new Date(item.checkTime) > new Date(countryResult.checkTime)
    ) {
      countryResult.checkTime = item.checkTime;
    }
  }

  return { addedGroups, brokenDelta };
}

module.exports = {
  getASINCheckOutcome,
  getASINClassificationKey,
  mergeDeferredResults,
  processDeferredASINs,
};
