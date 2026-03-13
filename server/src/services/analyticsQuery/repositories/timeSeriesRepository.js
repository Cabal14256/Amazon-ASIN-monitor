const {
  buildDurationRowsByGroup,
  getRequestedSourceGranularity,
} = require('./durationTransformRepository');
const {
  getDurationSourceRowsFromAgg,
  getDurationSourceRowsFromRaw,
  hasHistoryInRange,
} = require('./durationSourceRepository');
const { parseDateTimeInput } = require('../shared/timeUtils');

async function getStatisticsByTimeFromRaw(params = {}) {
  const {
    country = '',
    startTime = '',
    endTime = '',
    groupBy = 'day',
  } = params;
  const sourceGranularity = getRequestedSourceGranularity(params);
  const queryStartDate = parseDateTimeInput(startTime);
  const queryEndDate = parseDateTimeInput(endTime);
  const sourceRows = await getDurationSourceRowsFromRaw({
    startTime,
    endTime,
    sourceGranularity,
    country,
  });

  return buildDurationRowsByGroup(sourceRows, {
    sourceGranularity,
    targetGranularity: groupBy,
    queryStartDate,
    queryEndDate,
    buildGroupKey: (targetPeriod) => targetPeriod,
    buildGroupMeta: (targetPeriod) => ({
      time_period: targetPeriod,
    }),
  }).map((item) => ({
    ...item,
    total_asins: item.totalAsinsDedup,
    broken_asins: item.brokenAsinsDedup,
    asin_broken_rate: item.ratioAllAsin,
    normal_count: Math.max(0, item.totalChecks - item.brokenCount),
  }));
}

async function getStatisticsByTimeFromAgg(params = {}) {
  const {
    country = '',
    startTime = '',
    endTime = '',
    groupBy = 'day',
  } = params;
  const sourceGranularity = getRequestedSourceGranularity(params);
  const queryStartDate = parseDateTimeInput(startTime);
  const queryEndDate = parseDateTimeInput(endTime);
  const sourceRows = await getDurationSourceRowsFromAgg({
    startTime,
    endTime,
    sourceGranularity,
    country,
  });

  return buildDurationRowsByGroup(sourceRows, {
    sourceGranularity,
    targetGranularity: groupBy,
    queryStartDate,
    queryEndDate,
    buildGroupKey: (targetPeriod) => targetPeriod,
    buildGroupMeta: (targetPeriod) => ({
      time_period: targetPeriod,
    }),
  }).map((item) => ({
    ...item,
    total_asins: item.totalAsinsDedup,
    broken_asins: item.brokenAsinsDedup,
    asin_broken_rate: item.ratioAllAsin,
    normal_count: Math.max(0, item.totalChecks - item.brokenCount),
  }));
}

module.exports = {
  getStatisticsByTimeFromAgg,
  getStatisticsByTimeFromRaw,
  hasHistoryInRange,
};
