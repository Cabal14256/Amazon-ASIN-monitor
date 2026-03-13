const { query } = require('../../../config/database');
const { isAggTableCoveringRange } = require('./aggCoverageRepository');
const { getDurationSourceConfig } = require('./durationTransformRepository');
const {
  getAnalyticsAsinHistoryFilter,
  getPeakHourCase,
} = require('./durationSourceRepository');

async function getVariantGroupDurationSourceRowsFromAgg(params = {}) {
  const {
    startTime = '',
    endTime = '',
    sourceGranularity = 'day',
    country = '',
  } = params;
  const config = getDurationSourceConfig(sourceGranularity);
  const aggTable = 'monitor_history_agg_variant_group';

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

  const sql = `
    SELECT
      DATE_FORMAT(agg.time_slot, '${config.aggSlotFormat}') as slot_period,
      agg.country,
      agg.variant_group_id,
      agg.variant_group_name,
      agg.asin_key,
      agg.check_count as total_checks,
      agg.broken_count,
      agg.has_peak
    FROM ${aggTable} agg
    ${whereClause}
    ORDER BY
      agg.time_slot ASC,
      agg.country ASC,
      agg.variant_group_id ASC,
      agg.asin_key ASC
  `;

  return query(sql, conditions);
}

async function getVariantGroupDurationSourceRowsFromRaw(params = {}) {
  const {
    country = '',
    startTime = '',
    endTime = '',
    sourceGranularity = 'day',
  } = params;
  const config = getDurationSourceConfig(sourceGranularity);
  const isPeakCase = getPeakHourCase('mh.country', 'mh.check_time');

  let whereClause = 'WHERE mh.variant_group_id IS NOT NULL';
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

  whereClause += ` AND ${getAnalyticsAsinHistoryFilter(
    'mh.check_type',
    'mh.asin_id',
    'mh.asin_code',
  )}`;

  const sql = `
    SELECT
      DATE_FORMAT(${config.rawSlotExpr}, '${config.rawSlotFormat}') as slot_period,
      mh.country,
      mh.variant_group_id,
      COALESCE(mh.variant_group_name, vg.name) as variant_group_name,
      COALESCE(NULLIF(mh.asin_code, ''), CONCAT('ID#', mh.asin_id)) as asin_key,
      COUNT(*) as total_checks,
      SUM(CASE WHEN mh.is_broken = 1 THEN 1 ELSE 0 END) as broken_count,
      MAX(${isPeakCase}) as has_peak
    FROM monitor_history mh
    LEFT JOIN variant_groups vg ON vg.id = mh.variant_group_id
    ${whereClause}
    AND (mh.asin_id IS NOT NULL OR NULLIF(mh.asin_code, '') IS NOT NULL)
    GROUP BY
      ${config.rawSlotExpr},
      mh.country,
      mh.variant_group_id,
      COALESCE(mh.variant_group_name, vg.name),
      COALESCE(NULLIF(mh.asin_code, ''), CONCAT('ID#', mh.asin_id))
    ORDER BY ${config.rawSlotExpr} ASC, mh.country ASC
  `;

  return query(sql, conditions);
}

module.exports = {
  getVariantGroupDurationSourceRowsFromAgg,
  getVariantGroupDurationSourceRowsFromRaw,
};
