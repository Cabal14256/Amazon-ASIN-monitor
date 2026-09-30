const logger = require('../utils/logger');

function isRelationshipObservation(result) {
  return (
    result?.meta?.source === 'spapi' &&
    result.meta.relationshipsObserved === true
  );
}

async function observeVariantGroupSplit(groupId, observations, model) {
  if (
    !groupId ||
    !observations.some(
      (item) =>
        isRelationshipObservation(item.result) || item.uncertain === true,
    )
  ) {
    return { status: 'UNKNOWN', newEvent: null, asins: [] };
  }
  try {
    const tracker = model || require('../models/VariantSplitState');
    return await tracker.observeGroup(groupId, observations);
  } catch {
    // A failed observation must never become a new split event or phone call.
    logger.error('变体组拆分状态记录失败，请检查数据库迁移', { groupId });
    return { status: 'UNKNOWN', newEvent: null, asins: [] };
  }
}

function applySplitState(result, state) {
  if (!state) return result;
  const splitDetection = {
    status: state.status,
    reason: state.reason,
    baselineParentAsin: state.baselineParentAsin,
    currentParentAsin: state.currentParentAsin,
  };
  if (state.status === 'BROKEN') {
    return {
      ...result,
      hasVariants: false,
      errorType:
        state.reason === 'PARENT_CHANGED'
          ? 'PARENT_CHANGED'
          : result.errorType || 'NO_VARIANTS',
      splitDetection,
    };
  }
  return { ...result, splitDetection };
}

module.exports = {
  isRelationshipObservation,
  observeVariantGroupSplit,
  applySplitState,
};
