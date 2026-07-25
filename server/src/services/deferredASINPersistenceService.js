const logger = require('../utils/logger');
const { ASIN_NOT_FOUND_ERROR_TYPE } = require('../utils/spApiError');

function isNotificationEnabled(record, defaultValue) {
  const value =
    record?.feishuNotifyEnabled ?? record?.feishu_notify_enabled ?? null;
  return value === null ? defaultValue : Number(value) !== 0;
}

async function persistDeferredNotFoundResult(
  deferred,
  result,
  dependencies = {},
) {
  if (result?.errorType !== ASIN_NOT_FOUND_ERROR_TYPE) {
    return null;
  }

  const owner = deferred.owner === 'competitor' ? 'competitor' : 'primary';
  const isCompetitor = owner === 'competitor';
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

    await asinModel.updateVariantStatusAndCheckTime(asinRecord.id, true);

    let variantGroup = null;
    let variantGroupName = null;
    if (variantGroupId) {
      await variantGroupModel.updateVariantStatusAndCheckTime(
        variantGroupId,
        true,
      );
      variantGroup = await variantGroupModel.findById(variantGroupId);
      variantGroupName = variantGroup?.name || null;
    }

    const historyEntry = {
      asinId: asinRecord.id,
      asinCode: asinRecord.asin || deferred.asin,
      asinName: asinRecord.name || null,
      variantGroupId,
      variantGroupName,
      checkType: 'ASIN',
      country: deferred.country,
      isBroken: 1,
      checkTime,
      checkResult: {
        ...result,
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
      asinRecord,
      defaultNotifyEnabled,
    );

    logger.info(
      `[延后队列] ${owner} ASIN ${deferred.asin} (${deferred.country}) NOT_FOUND 状态已持久化`,
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
      errorType: ASIN_NOT_FOUND_ERROR_TYPE,
    };
  } catch (error) {
    error.preserveDeferred = true;
    throw error;
  }
}

module.exports = {
  persistDeferredNotFoundResult,
};
