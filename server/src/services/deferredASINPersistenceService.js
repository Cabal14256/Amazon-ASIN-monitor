const logger = require('../utils/logger');
const { ASIN_NOT_FOUND_ERROR_TYPE } = require('../utils/spApiError');

async function persistDeferredNotFoundResult(
  deferred,
  result,
  dependencies = {},
) {
  if (result?.errorType !== ASIN_NOT_FOUND_ERROR_TYPE) {
    return false;
  }

  const asinModel = dependencies.asinModel || require('../models/ASIN');
  const monitorHistoryModel =
    dependencies.monitorHistoryModel || require('../models/MonitorHistory');
  const variantGroupModel =
    dependencies.variantGroupModel || require('../models/VariantGroup');

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

    let variantGroupName = null;
    if (variantGroupId) {
      await variantGroupModel.updateVariantStatusAndCheckTime(
        variantGroupId,
        true,
      );
      const variantGroup = await variantGroupModel.findById(variantGroupId);
      variantGroupName = variantGroup?.name || null;
    }

    await monitorHistoryModel.create({
      asinId: asinRecord.id,
      asinCode: asinRecord.asin || deferred.asin,
      asinName: asinRecord.name || null,
      siteSnapshot: asinRecord.site || null,
      brandSnapshot: asinRecord.brand || null,
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
    });

    logger.info(
      `[延后队列] ASIN ${deferred.asin} (${deferred.country}) NOT_FOUND 状态已持久化`,
    );
    return true;
  } catch (error) {
    error.preserveDeferred = true;
    throw error;
  }
}

module.exports = {
  persistDeferredNotFoundResult,
};
