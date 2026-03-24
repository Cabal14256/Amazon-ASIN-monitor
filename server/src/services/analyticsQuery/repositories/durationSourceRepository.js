const { query } = require('../../../config/database');
const { isAggTableCoveringRange } = require('./aggCoverageRepository');
const { getDurationSourceConfig } = require('./durationTransformRepository');

function getAnalyticsAsinHistoryFilter(
  checkTypeField = 'check_type',
  asinIdField = 'asin_id',
  asinCodeField = 'asin_code',
) {
  return `(
    ${checkTypeField} = 'ASIN'
    AND (
      ${asinIdField} IS NOT NULL
      OR NULLIF(${asinCodeField}, '') IS NOT NULL
    )
  )`;
}

function getPeakHourCase(countryField, timeField = 'mh.check_time') {
  const hourExpr = `HOUR(DATE_ADD(${timeField}, INTERVAL 8 HOUR))`;
  return `CASE
    WHEN ${countryField} = 'US' THEN
      (${hourExpr} >= 2 AND ${hourExpr} < 6)
      OR (${hourExpr} >= 9 AND ${hourExpr} < 12)
    WHEN ${countryField} = 'UK' THEN
      ${hourExpr} >= 22
      OR (${hourExpr} >= 0 AND ${hourExpr} < 2)
      OR (${hourExpr} >= 3 AND ${hourExpr} < 6)
    WHEN ${countryField} IN ('DE', 'FR', 'ES', 'IT') THEN
      ${hourExpr} >= 20
      OR (${hourExpr} >= 2 AND ${hourExpr} < 5)
    ELSE 0
  END`;
}

async function getDurationSourceRowsFromAgg(params = {}) {
  const {
    startTime = '',
    endTime = '',
    sourceGranularity = 'hour',
    country = '',
    site = '',
    brand = '',
    withDimensions = false,
  } = params;
  const config = getDurationSourceConfig(sourceGranularity);
  const useDimAgg = withDimensions || Boolean(site || brand);
  const aggTable = useDimAgg
    ? 'monitor_history_agg_dim'
    : 'monitor_history_agg';

  const isCovered = await isAggTableCoveringRange(
    aggTable,
    sourceGranularity,
    startTime,
    endTime,
  );
  if (!isCovered) {
    throw new Error(`聚合表覆盖不足，回退原始表: ${aggTable}`);
  }

  let whereClause = 'WHERE agg.granularity = ?';
  const conditions = [sourceGranularity];

  if (country) {
    if (country === 'EU') {
      whereClause += ` AND agg.country IN ('UK', 'DE', 'FR', 'IT', 'ES')`;
    } else {
      whereClause += ` AND agg.country = ?`;
      conditions.push(country);
    }
  }

  if (startTime) {
    whereClause += ` AND agg.time_slot >= DATE_FORMAT(?, '${config.slotWhereFormat}')`;
    conditions.push(startTime);
  }

  if (endTime) {
    whereClause += ` AND agg.time_slot <= DATE_FORMAT(?, '${config.slotWhereFormat}')`;
    conditions.push(endTime);
  }

  if (useDimAgg && site) {
    whereClause += ` AND agg.site = ?`;
    conditions.push(site);
  }

  if (useDimAgg && brand) {
    whereClause += ` AND agg.brand = ?`;
    conditions.push(brand);
  }

  const sql = `
    SELECT
      DATE_FORMAT(agg.time_slot, '${config.aggSlotFormat}') as slot_period,
      agg.country,
      ${useDimAgg ? 'agg.site' : "''"} as site,
      ${useDimAgg ? 'agg.brand' : "''"} as brand,
      agg.asin_key,
      agg.check_count as total_checks,
      agg.broken_count,
      agg.has_peak
    FROM ${aggTable} agg
    ${whereClause}
    ORDER BY agg.time_slot ASC, agg.country ASC, agg.asin_key ASC
  `;

  return query(sql, conditions);
}

async function getDurationSourceRowsFromRaw(params = {}) {
  const {
    startTime = '',
    endTime = '',
    sourceGranularity = 'hour',
    country = '',
    site = '',
    brand = '',
  } = params;
  const config = getDurationSourceConfig(sourceGranularity);
  const isPeakCase = getPeakHourCase('mh.country', 'mh.check_time');

  let whereClause = 'WHERE 1=1';
  const conditions = [];

  if (country) {
    if (country === 'EU') {
      whereClause += ` AND mh.country IN ('UK', 'DE', 'FR', 'IT', 'ES')`;
    } else {
      whereClause += ` AND mh.country = ?`;
      conditions.push(country);
    }
  }

  if (startTime) {
    whereClause += ` AND mh.check_time >= ?`;
    conditions.push(startTime);
  }

  if (endTime) {
    whereClause += ` AND mh.check_time <= ?`;
    conditions.push(endTime);
  }

  if (site) {
    whereClause += ` AND mh.site_snapshot = ?`;
    conditions.push(site);
  }

  if (brand) {
    whereClause += ` AND mh.brand_snapshot = ?`;
    conditions.push(brand);
  }

  whereClause += ` AND ${getAnalyticsAsinHistoryFilter(
    'mh.check_type',
    'mh.asin_id',
    'mh.asin_code',
  )}`;

  const sql = `
    SELECT
      DATE_FORMAT(${config.rawSlotExpr}, '${config.rawSlotFormat}') as slot_period,
      mh.country,
      COALESCE(mh.site_snapshot, '') as site,
      COALESCE(mh.brand_snapshot, '') as brand,
      COALESCE(NULLIF(mh.asin_code, ''), CONCAT('ID#', mh.asin_id)) as asin_key,
      COUNT(*) as total_checks,
      SUM(CASE WHEN mh.is_broken = 1 THEN 1 ELSE 0 END) as broken_count,
      MAX(${isPeakCase}) as has_peak
    FROM monitor_history mh
    ${whereClause}
    AND (mh.asin_id IS NOT NULL OR NULLIF(mh.asin_code, '') IS NOT NULL)
    GROUP BY
      ${config.rawSlotExpr},
      mh.country,
      COALESCE(mh.site_snapshot, ''),
      COALESCE(mh.brand_snapshot, ''),
      COALESCE(NULLIF(mh.asin_code, ''), CONCAT('ID#', mh.asin_id))
    ORDER BY ${config.rawSlotExpr} ASC, mh.country ASC
  `;

  return query(sql, conditions);
}

async function hasHistoryInRange(startTime = '', endTime = '') {
  let sql = 'SELECT 1 FROM monitor_history WHERE 1=1';
  const conditions = [];

  if (startTime) {
    sql += ' AND check_time >= ?';
    conditions.push(startTime);
  }

  if (endTime) {
    sql += ' AND check_time <= ?';
    conditions.push(endTime);
  }

  sql += ' LIMIT 1';
  const result = await query(sql, conditions);
  return Array.isArray(result) && result.length > 0;
}

module.exports = {
  getAnalyticsAsinHistoryFilter,
  getDurationSourceRowsFromAgg,
  getDurationSourceRowsFromRaw,
  getPeakHourCase,
  hasHistoryInRange,
};
