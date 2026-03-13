const { query } = require('../../config/database');
const {
  finalizeAnalyticsResult,
  formatDateToSqlText,
  parseDateTimeInput,
} = require('./shared');
const logger = require('../../utils/logger');
const { canUseAggForRange } = require('./repositories/aggCoverageRepository');
const {
  accumulateDurationMetrics,
  buildDurationRowsByGroup,
  createDurationMetricsAccumulator,
  finalizeDurationMetrics,
  getDurationBucketHours,
  getDurationSourceConfig,
  getDurationSourceGranularity,
} = require('./repositories/durationTransformRepository');
const {
  getAnalyticsAsinHistoryFilter,
  getDurationSourceRowsFromAgg,
  getDurationSourceRowsFromRaw,
  getPeakHourCase,
} = require('./repositories/durationSourceRepository');

async function getOverallStatistics(params = {}) {
  const {
    variantGroupId = '',
    asinId = '',
    country = '',
    checkType = '',
    startTime = '',
    endTime = '',
    includeMeta = false,
  } = params;

  let sql = `
    SELECT
      COUNT(*) as total_checks,
      SUM(CASE WHEN is_broken = 1 THEN 1 ELSE 0 END) as broken_count,
      SUM(CASE WHEN is_broken = 0 THEN 1 ELSE 0 END) as normal_count,
      COUNT(DISTINCT variant_group_id) as group_count,
      COUNT(DISTINCT asin_id) as asin_count
    FROM monitor_history
    WHERE 1=1
  `;
  const conditions = [];

  if (variantGroupId) {
    sql += ` AND variant_group_id = ?`;
    conditions.push(variantGroupId);
  }

  if (asinId) {
    sql += ` AND asin_id = ?`;
    conditions.push(asinId);
  }

  if (country) {
    if (country === 'EU') {
      sql += ` AND country IN ('UK', 'DE', 'FR', 'IT', 'ES')`;
    } else {
      sql += ` AND country = ?`;
      conditions.push(country);
    }
  }

  if (checkType) {
    if (checkType === 'ASIN') {
      sql += ` AND ${getAnalyticsAsinHistoryFilter(
        'check_type',
        'asin_id',
        'asin_code',
      )}`;
    } else {
      sql += ` AND check_type = ?`;
      conditions.push(checkType);
    }
  }

  if (startTime) {
    sql += ` AND check_time >= ?`;
    conditions.push(startTime);
  }

  if (endTime) {
    sql += ` AND check_time <= ?`;
    conditions.push(endTime);
  }

  const [result] = await query(sql, conditions);
  const generatedAt = formatDateToSqlText(new Date());
  const response = {
    totalChecks: result?.total_checks || 0,
    brokenCount: result?.broken_count || 0,
    normalCount: result?.normal_count || 0,
    groupCount: result?.group_count || 0,
    asinCount: result?.asin_count || 0,
    totalDurationHours: 0,
    abnormalDurationHours: 0,
    normalDurationHours: 0,
    ratioAllAsin: 0,
    ratioAllTime: 0,
  };

  if (checkType === 'GROUP') {
    return finalizeAnalyticsResult(response, {
      includeMeta,
      source: 'raw',
      generatedAt,
    });
  }

  const sourceGranularity = getDurationSourceGranularity(
    'day',
    startTime,
    endTime,
  );
  const sourceConfig = getDurationSourceConfig(sourceGranularity);
  const queryStartDate = parseDateTimeInput(startTime);
  const queryEndDate = parseDateTimeInput(endTime);
  const isPeakCase = getPeakHourCase('mh.country', 'mh.check_time');

  let durationSql = `
    SELECT
      DATE_FORMAT(${sourceConfig.rawSlotExpr}, '${sourceConfig.rawSlotFormat}') as slot_period,
      mh.country,
      COALESCE(NULLIF(mh.asin_code, ''), CONCAT('ID#', mh.asin_id)) as asin_key,
      COUNT(*) as total_checks,
      SUM(CASE WHEN mh.is_broken = 1 THEN 1 ELSE 0 END) as broken_count,
      MAX(${isPeakCase}) as has_peak
    FROM monitor_history mh
    WHERE 1=1
  `;
  const durationConditions = [];

  if (variantGroupId) {
    durationSql += ` AND mh.variant_group_id = ?`;
    durationConditions.push(variantGroupId);
  }

  if (asinId) {
    durationSql += ` AND mh.asin_id = ?`;
    durationConditions.push(asinId);
  }

  if (country) {
    if (country === 'EU') {
      durationSql += ` AND mh.country IN ('UK', 'DE', 'FR', 'IT', 'ES')`;
    } else {
      durationSql += ` AND mh.country = ?`;
      durationConditions.push(country);
    }
  }

  if (startTime) {
    durationSql += ` AND mh.check_time >= ?`;
    durationConditions.push(startTime);
  }

  if (endTime) {
    durationSql += ` AND mh.check_time <= ?`;
    durationConditions.push(endTime);
  }

  durationSql += ` AND ${getAnalyticsAsinHistoryFilter(
    'mh.check_type',
    'mh.asin_id',
    'mh.asin_code',
  )}`;
  durationSql += `
    GROUP BY
      ${sourceConfig.rawSlotExpr},
      mh.country,
      COALESCE(NULLIF(mh.asin_code, ''), CONCAT('ID#', mh.asin_id))
  `;

  const durationRows = await query(durationSql, durationConditions);
  const [durationMetrics = {}] = buildDurationRowsByGroup(durationRows, {
    sourceGranularity,
    targetGranularity: sourceGranularity,
    queryStartDate,
    queryEndDate,
    buildGroupKey: () => 'overall',
    buildGroupMeta: () => ({}),
  });

  return finalizeAnalyticsResult(
    {
      ...response,
      totalDurationHours: durationMetrics.totalDurationHours || 0,
      abnormalDurationHours: durationMetrics.abnormalDurationHours || 0,
      normalDurationHours: durationMetrics.normalDurationHours || 0,
      ratioAllAsin: durationMetrics.ratioAllAsin || 0,
      ratioAllTime: durationMetrics.ratioAllTime || 0,
    },
    {
      includeMeta,
      source: 'raw',
      generatedAt,
    },
  );
}

async function getPeakHoursStatistics(params = {}) {
  const {
    country = '',
    checkType = '',
    startTime = '',
    endTime = '',
    includeMeta = false,
  } = params;

  if (!country) {
    throw new Error('高峰期统计需要指定国家');
  }

  let peakBroken = 0;
  let peakTotal = 0;
  let offPeakBroken = 0;
  let offPeakTotal = 0;
  const queryStartDate = parseDateTimeInput(startTime);
  const queryEndDate = parseDateTimeInput(endTime);
  const sourceGranularity = 'hour';
  let sourceRows = null;
  let source = 'raw';
  const generatedAt = formatDateToSqlText(new Date());

  const useAgg =
    checkType !== 'GROUP' &&
    process.env.ANALYTICS_AGG_ENABLED !== '0' &&
    canUseAggForRange(sourceGranularity, startTime, endTime);

  if (useAgg) {
    try {
      sourceRows = await getDurationSourceRowsFromAgg({
        startTime,
        endTime,
        sourceGranularity,
        country,
      });
      source = 'agg';
    } catch (error) {
      logger.warn(
        '[统计查询] getPeakHoursStatistics 聚合表读取失败，回退原始表',
        {
          message: error?.message || String(error),
        },
      );
      sourceRows = null;
    }
  }

  if (!Array.isArray(sourceRows)) {
    if (checkType === 'GROUP') {
      sourceRows = [];
    } else {
      sourceRows = await getDurationSourceRowsFromRaw({
        startTime,
        endTime,
        sourceGranularity,
        country,
      });
    }
    source = 'raw';
  }

  const accumulator = createDurationMetricsAccumulator();
  sourceRows.forEach((row) => {
    const bucketDurationHours = getDurationBucketHours(
      row.slot_period,
      sourceGranularity,
      queryStartDate,
      queryEndDate,
    );
    if (bucketDurationHours <= 0) {
      return;
    }

    accumulateDurationMetrics(accumulator, row, bucketDurationHours);

    const totalChecks = Number(row.total_checks || 0);
    const brokenCount = Number(row.broken_count || 0);
    if (Number(row.has_peak || 0) === 1) {
      peakTotal += totalChecks;
      peakBroken += brokenCount;
    } else {
      offPeakTotal += totalChecks;
      offPeakBroken += brokenCount;
    }
  });
  const durationMetrics = finalizeDurationMetrics(accumulator);

  return finalizeAnalyticsResult(
    {
      peakBroken,
      peakTotal,
      peakRate: peakTotal > 0 ? (peakBroken / peakTotal) * 100 : 0,
      offPeakBroken,
      offPeakTotal,
      offPeakRate: offPeakTotal > 0 ? (offPeakBroken / offPeakTotal) * 100 : 0,
      peakAbnormalDurationHours: durationMetrics.peakAbnormalDurationHours || 0,
      peakDurationHours: durationMetrics.peakDurationHours || 0,
      peakDurationRate: durationMetrics.ratioHigh || 0,
      offPeakAbnormalDurationHours:
        durationMetrics.lowAbnormalDurationHours || 0,
      offPeakDurationHours: durationMetrics.lowDurationHours || 0,
      offPeakDurationRate: durationMetrics.ratioLow || 0,
    },
    {
      includeMeta,
      source,
      generatedAt,
    },
  );
}

module.exports = {
  getOverallStatistics,
  getPeakHoursStatistics,
};
