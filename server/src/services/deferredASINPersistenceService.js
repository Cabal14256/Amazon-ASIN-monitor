const logger = require('../utils/logger');

function isNotificationEnabled(record, defaultValue) {
  const value =
    record?.feishuNotifyEnabled ?? record?.feishu_notify_enabled ?? null;
  return value === null ? defaultValue : Number(value) !== 0;
}

function isRecordBroken(record, isCompetitor) {
  if (!record) {
    return false;
  }
  const value = isCompetitor
    ? record.isBroken ?? record.is_broken
    : record.autoIsBroken ?? record.isBroken ?? record.is_broken;
  return Number(value) === 1;
}

async function persistDeferredASINResult(deferred, result, dependencies = {}) {
  if (!result || result.hasVariants === undefined) {
    return null;
  }

  const owner = deferred.owner === 'competitor' ? 'competitor' : 'primary';
  const isCompetitor = owner === 'competitor';
  const autoIsBroken =
    result.hasVariants === false ||
    (result.variantCount !== undefined && Number(result.variantCount) === 0);
  const errorType = result.errorType || (autoIsBroken ? 'NO_VARIANTS' : null);
  const asinModel = isCompetitor
    ? dependencies.competitorAsinModel || require('../models/CompetitorASIN')
    : dependencies.asinModel || require('../models/ASIN');
  const monitorHistoryModel = isCompetitor
    ? dependencies.competitorMonitorHistoryModel ||
      require('../models/CompetitorMonitorHistory')
    : dependencies.monitorHistoryModel || require('../models/MonitorHistory');
  const variantGroupModel = isCompetitor
    ? dependencies.competitorVariantGroupModel ||
      require('../models/CompetitorVariantGroup')
    : dependencies.variantGroupModel || require('../models/VariantGroup');

  try {
    const asinRecord = await asinModel.findByASIN(
      deferred.asin,
      deferred.country,
    );
    if (!asinRecord) {
      throw new Error(
        `延后队列中的 ASIN ${deferred.asin} (${deferred.country}) 不存在数据库记录`,
      );
    }

    const checkTime = new Date();
    const variantGroupId =
      asinRecord.variantGroupId || asinRecord.variant_group_id || null;

    await asinModel.updateVariantStatusAndCheckTime(
      asinRecord.id,
      autoIsBroken,
    );

    let variantGroup = null;
    let variantGroupName = null;
    let groupAutoIsBroken = autoIsBroken;
    if (variantGroupId) {
      variantGroup = await variantGroupModel.findById(variantGroupId);
      groupAutoIsBroken = (variantGroup?.children || []).some((child) =>
        isRecordBroken(child, isCompetitor),
      );
      await variantGroupModel.updateVariantStatusAndCheckTime(
        variantGroupId,
        groupAutoIsBroken,
      );
      variantGroup = await variantGroupModel.findById(variantGroupId);
      variantGroupName = variantGroup?.name || null;
    }

    const refreshedASIN =
      typeof asinModel.findById === 'function'
        ? await asinModel.findById(asinRecord.id)
        : null;
    const effectiveASIN = refreshedASIN || asinRecord;
    const effectiveIsBroken =
      Number(
        effectiveASIN.isBroken ??
          effectiveASIN.is_broken ??
          (autoIsBroken ? 1 : 0),
      ) === 1;
    const groupIsBroken = variantGroup
      ? Number(
          variantGroup.isBroken ??
            variantGroup.is_broken ??
            (groupAutoIsBroken ? 1 : 0),
        ) === 1
      : effectiveIsBroken;
    const historyEntry = {
      asinId: asinRecord.id,
      asinCode: asinRecord.asin || deferred.asin,
      asinName: asinRecord.name || null,
      variantGroupId,
      variantGroupName,
      checkType: 'ASIN',
      country: deferred.country,
      isBroken: effectiveIsBroken ? 1 : 0,
      checkTime,
      checkResult: {
        ...result,
        isBroken: autoIsBroken,
        ...(errorType ? { errorType } : {}),
        meta: {
          ...(result.meta || {}),
          trigger: 'deferred_retry',
        },
      },
    };
    if (!isCompetitor) {
      historyEntry.siteSnapshot = asinRecord.site || null;
      historyEntry.brandSnapshot = asinRecord.brand || null;
    }
    await monitorHistoryModel.create(historyEntry);

    const defaultNotifyEnabled = isCompetitor ? false : true;
    const groupNotifyEnabled =
      variantGroupId && variantGroup
        ? isNotificationEnabled(variantGroup, defaultNotifyEnabled)
        : defaultNotifyEnabled;
    const asinNotifyEnabled = isNotificationEnabled(
      effectiveASIN,
      defaultNotifyEnabled,
    );

    logger.info(
      `[延后队列] ${owner} ASIN ${deferred.asin} (${
        deferred.country
      }) 重试结果已持久化: ${errorType || 'NORMAL'}`,
    );
    return {
      owner,
      asin: asinRecord.asin || deferred.asin,
      asinId: asinRecord.id,
      asinName: asinRecord.name || '',
      brand: asinRecord.brand || '',
      country: deferred.country,
      variantGroupId,
      variantGroupName,
      checkTime,
      notifyEnabled: groupNotifyEnabled && asinNotifyEnabled,
      autoIsBroken,
      isBroken: effectiveIsBroken,
      groupIsBroken,
      errorType,
      statusSource: effectiveASIN.statusSource || 'NORMAL',
      manualBroken: Number(effectiveASIN.manualBroken || 0) === 1 ? 1 : 0,
      manualBrokenReason: effectiveASIN.manualBrokenReason || '',
      manualBrokenUpdatedAt: effectiveASIN.manualBrokenUpdatedAt || null,
      manualBrokenUpdatedBy: effectiveASIN.manualBrokenUpdatedBy || null,
      groupStatusSource: variantGroup?.statusSource || 'NORMAL',
      groupManualBroken: Number(variantGroup?.manualBroken || 0) === 1 ? 1 : 0,
      groupManualBrokenReason: variantGroup?.manualBrokenReason || '',
      groupManualBrokenUpdatedAt: variantGroup?.manualBrokenUpdatedAt || null,
      groupManualBrokenUpdatedBy: variantGroup?.manualBrokenUpdatedBy || null,
    };
  } catch (error) {
    error.preserveDeferred = true;
    throw error;
  }
}

module.exports = {
  persistDeferredASINResult,
};
