const {
  calculateOverlapHours,
  clampValue,
  formatDateToDayText,
  formatDateToHourText,
  formatDateToMonthText,
  formatISOWeekTextFromDate,
  getBucketRangeByPeriod,
  parseDateTimeInput,
} = require('../shared/timeUtils');

function getDurationSourceGranularity(
  targetGranularity = 'day',
  startTime = '',
  endTime = '',
) {
  if (targetGranularity === 'hour') {
    return 'hour';
  }
  if (targetGranularity === 'week' || targetGranularity === 'month') {
    return 'day';
  }

  const startDate = parseDateTimeInput(startTime);
  const endDate = parseDateTimeInput(endTime);
  if (!startDate || !endDate || endDate < startDate) {
    return 'hour';
  }

  const diffHours =
    (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60);
  return diffHours <= 31 * 24 ? 'hour' : 'day';
}

function getSummaryDurationSourceGranularity(
  targetGranularity = 'day',
  startTime = '',
  endTime = '',
) {
  if (targetGranularity !== 'day') {
    return getDurationSourceGranularity(targetGranularity, startTime, endTime);
  }

  const startDate = parseDateTimeInput(startTime);
  const endDate = parseDateTimeInput(endTime);
  if (!startDate || !endDate || endDate < startDate) {
    return getDurationSourceGranularity(targetGranularity, startTime, endTime);
  }

  const diffHours =
    (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60);
  const maxHourlyRangeDays =
    Number(process.env.ANALYTICS_MAX_RAW_QUERY_DAYS) || 7;

  // 汇总表在前端超过 7 天后会强制按天展示，后端同步切到日级源数据，
  // 以便优先命中 day 聚合表，并避免误触发小时级原始查询降级。
  if (diffHours > maxHourlyRangeDays * 24) {
    return 'day';
  }

  return getDurationSourceGranularity(targetGranularity, startTime, endTime);
}

function getDurationSourceConfig(sourceGranularity = 'hour') {
  if (sourceGranularity === 'day') {
    return {
      sourceGranularity: 'day',
      rawSlotExpr: 'mh.day_ts',
      rawSlotFormat: '%Y-%m-%d',
      aggSlotFormat: '%Y-%m-%d',
      slotWhereFormat: '%Y-%m-%d 00:00:00',
    };
  }

  return {
    sourceGranularity: 'hour',
    rawSlotExpr: 'mh.hour_ts',
    rawSlotFormat: '%Y-%m-%d %H:00:00',
    aggSlotFormat: '%Y-%m-%d %H:00:00',
    slotWhereFormat: '%Y-%m-%d %H:00:00',
  };
}

function formatSlotToTargetPeriod(slotPeriod, targetGranularity = 'day') {
  const parsed = parseDateTimeInput(slotPeriod);
  if (!parsed) {
    return '';
  }
  if (targetGranularity === 'hour') {
    return formatDateToHourText(parsed);
  }
  if (targetGranularity === 'day') {
    return formatDateToDayText(parsed);
  }
  if (targetGranularity === 'week') {
    return formatISOWeekTextFromDate(parsed);
  }
  if (targetGranularity === 'month') {
    return formatDateToMonthText(parsed);
  }

  return formatDateToDayText(parsed);
}

function getDurationBucketHours(
  slotPeriod,
  sourceGranularity,
  queryStartDate,
  queryEndDate,
) {
  const { bucketStart, bucketEnd } = getBucketRangeByPeriod(
    slotPeriod,
    sourceGranularity,
  );
  if (!bucketStart || !bucketEnd) {
    return 0;
  }

  if (queryStartDate && queryEndDate) {
    return clampValue(
      calculateOverlapHours(
        bucketStart,
        bucketEnd,
        queryStartDate,
        queryEndDate,
      ),
      0,
      Number.MAX_VALUE,
    );
  }

  return clampValue(
    (bucketEnd.getTime() - bucketStart.getTime()) / (1000 * 60 * 60),
    0,
    Number.MAX_VALUE,
  );
}

function createDurationMetricsAccumulator() {
  return {
    totalDurationHours: 0,
    abnormalDurationHours: 0,
    normalDurationHours: 0,
    peakDurationHours: 0,
    peakAbnormalDurationHours: 0,
    lowDurationHours: 0,
    lowAbnormalDurationHours: 0,
    totalChecks: 0,
    brokenCount: 0,
    asinMetrics: new Map(),
  };
}

function accumulateDurationMetrics(accumulator, row, bucketDurationHours) {
  if (!accumulator || !bucketDurationHours || bucketDurationHours <= 0) {
    return;
  }

  const totalChecks = Number(row?.total_checks ?? row?.check_count ?? 0);
  const brokenCount = Number(row?.broken_count ?? row?.brokenCount ?? 0);
  const abnormalRatio =
    totalChecks > 0 ? clampValue(brokenCount / totalChecks, 0, 1) : 0;
  const abnormalDurationHours = clampValue(
    bucketDurationHours * abnormalRatio,
    0,
    bucketDurationHours,
  );
  const normalDurationHours = Math.max(
    0,
    bucketDurationHours - abnormalDurationHours,
  );
  const isPeak = Number(row?.has_peak ?? row?.is_peak ?? 0) === 1;
  const asinKey = String(row?.asin_key || row?.asinKey || '').trim();

  accumulator.totalDurationHours += bucketDurationHours;
  accumulator.abnormalDurationHours += abnormalDurationHours;
  accumulator.normalDurationHours += normalDurationHours;
  accumulator.totalChecks += totalChecks;
  accumulator.brokenCount += brokenCount;

  if (isPeak) {
    accumulator.peakDurationHours += bucketDurationHours;
    accumulator.peakAbnormalDurationHours += abnormalDurationHours;
  } else {
    accumulator.lowDurationHours += bucketDurationHours;
    accumulator.lowAbnormalDurationHours += abnormalDurationHours;
  }

  if (!asinKey) {
    return;
  }

  if (!accumulator.asinMetrics.has(asinKey)) {
    accumulator.asinMetrics.set(asinKey, {
      totalDurationHours: 0,
      abnormalDurationHours: 0,
    });
  }

  const asinMetrics = accumulator.asinMetrics.get(asinKey);
  asinMetrics.totalDurationHours += bucketDurationHours;
  asinMetrics.abnormalDurationHours += abnormalDurationHours;
}

function finalizeDurationMetrics(accumulator) {
  const totalDurationHours = Number(accumulator.totalDurationHours.toFixed(4));
  const abnormalDurationHours = Number(
    accumulator.abnormalDurationHours.toFixed(4),
  );
  const normalDurationHours = Number(
    accumulator.normalDurationHours.toFixed(4),
  );
  const peakDurationHours = Number(accumulator.peakDurationHours.toFixed(4));
  const peakAbnormalDurationHours = Number(
    accumulator.peakAbnormalDurationHours.toFixed(4),
  );
  const lowDurationHours = Number(accumulator.lowDurationHours.toFixed(4));
  const lowAbnormalDurationHours = Number(
    accumulator.lowAbnormalDurationHours.toFixed(4),
  );

  let totalAsinsDedup = 0;
  let brokenAsinsDedup = 0;
  let sumAsinDurationRate = 0;

  accumulator.asinMetrics.forEach((asinMetrics) => {
    if (asinMetrics.totalDurationHours <= 0) {
      return;
    }
    totalAsinsDedup += 1;
    const asinDurationRate = clampValue(
      asinMetrics.abnormalDurationHours / asinMetrics.totalDurationHours,
      0,
      1,
    );
    sumAsinDurationRate += asinDurationRate;
    if (asinMetrics.abnormalDurationHours > 0) {
      brokenAsinsDedup += 1;
    }
  });

  const ratioAllAsin =
    totalAsinsDedup > 0
      ? Number(((sumAsinDurationRate / totalAsinsDedup) * 100).toFixed(4))
      : 0;
  const ratioAllTime =
    totalDurationHours > 0
      ? Number(((abnormalDurationHours / totalDurationHours) * 100).toFixed(4))
      : 0;
  const globalPeakRate =
    totalDurationHours > 0
      ? Number(
          ((peakAbnormalDurationHours / totalDurationHours) * 100).toFixed(4),
        )
      : 0;
  const globalLowRate =
    totalDurationHours > 0
      ? Number(
          ((lowAbnormalDurationHours / totalDurationHours) * 100).toFixed(4),
        )
      : 0;
  const ratioHigh =
    peakDurationHours > 0
      ? Number(
          ((peakAbnormalDurationHours / peakDurationHours) * 100).toFixed(4),
        )
      : 0;
  const ratioLow =
    lowDurationHours > 0
      ? Number(((lowAbnormalDurationHours / lowDurationHours) * 100).toFixed(4))
      : 0;

  return {
    totalDurationHours,
    abnormalDurationHours,
    normalDurationHours,
    peakDurationHours,
    peakAbnormalDurationHours,
    lowDurationHours,
    lowAbnormalDurationHours,
    ratioAllAsin,
    ratioAllTime,
    globalPeakRate,
    globalLowRate,
    ratioHigh,
    ratioLow,
    totalChecks: Number(accumulator.totalChecks || 0),
    brokenCount: Number(accumulator.brokenCount || 0),
    totalAsinsDedup,
    brokenAsinsDedup,
  };
}

function buildDurationRowsByGroup(
  sourceRows = [],
  {
    sourceGranularity = 'hour',
    targetGranularity = 'day',
    queryStartDate = null,
    queryEndDate = null,
    buildGroupKey,
    buildGroupMeta,
  } = {},
) {
  const grouped = new Map();

  sourceRows.forEach((row) => {
    const slotPeriod = String(row?.slot_period || '').trim();
    if (!slotPeriod) {
      return;
    }

    const bucketDurationHours = getDurationBucketHours(
      slotPeriod,
      sourceGranularity,
      queryStartDate,
      queryEndDate,
    );
    if (bucketDurationHours <= 0) {
      return;
    }

    const targetPeriod = formatSlotToTargetPeriod(
      slotPeriod,
      targetGranularity,
    );
    const groupKey = buildGroupKey(targetPeriod, row);
    if (!groupKey) {
      return;
    }

    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        meta: buildGroupMeta(targetPeriod, row),
        accumulator: createDurationMetricsAccumulator(),
      });
    }

    const item = grouped.get(groupKey);
    accumulateDurationMetrics(item.accumulator, row, bucketDurationHours);
  });

  return Array.from(grouped.values()).map((item) => {
    const metrics = finalizeDurationMetrics(item.accumulator);
    return {
      ...item.meta,
      ...metrics,
      ratio_all_asin: metrics.ratioAllAsin,
      ratio_all_time: metrics.ratioAllTime,
      total_asins_dedup: metrics.totalAsinsDedup,
      broken_asins_dedup: metrics.brokenAsinsDedup,
    };
  });
}

function getRequestedSourceGranularity(params = {}) {
  const {
    groupBy = 'day',
    startTime = '',
    endTime = '',
    sourceGranularityOverride = '',
  } = params;

  if (
    sourceGranularityOverride === 'hour' ||
    sourceGranularityOverride === 'day'
  ) {
    return sourceGranularityOverride;
  }

  return getSummaryDurationSourceGranularity(groupBy, startTime, endTime);
}

module.exports = {
  accumulateDurationMetrics,
  buildDurationRowsByGroup,
  createDurationMetricsAccumulator,
  finalizeDurationMetrics,
  formatSlotToTargetPeriod,
  getDurationBucketHours,
  getDurationSourceConfig,
  getDurationSourceGranularity,
  getSummaryDurationSourceGranularity,
  getRequestedSourceGranularity,
};
