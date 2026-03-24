const { query } = require('../config/database');
const metricsService = require('./metricsService');
const logger = require('../utils/logger');
const {
  alignTimeToSlotText,
  formatDateToSqlText,
} = require('./analyticsQuery/shared/timeUtils');

const AGG_ENABLED = process.env.ANALYTICS_AGG_ENABLED !== '0';
const BACKFILL_HOURS = Number(process.env.ANALYTICS_AGG_BACKFILL_HOURS) || 48;
const BACKFILL_DAYS = Number(process.env.ANALYTICS_AGG_BACKFILL_DAYS) || 30;
const REFRESH_HOURS_WINDOW =
  Number(process.env.ANALYTICS_AGG_REFRESH_HOURS_WINDOW) || 72;
const REFRESH_DAYS_WINDOW =
  Number(process.env.ANALYTICS_AGG_REFRESH_DAYS_WINDOW) || 35;
const REFRESH_DIM_AGG = process.env.ANALYTICS_AGG_REFRESH_DIM !== '0';
const REFRESH_VARIANT_GROUP_AGG =
  process.env.ANALYTICS_AGG_REFRESH_VARIANT_GROUP !== '0';
const ANALYTICS_ASIN_HISTORY_FILTER =
  "mh.check_type = 'ASIN' AND (mh.asin_id IS NOT NULL OR NULLIF(mh.asin_code, '') IS NOT NULL)";

let isRefreshing = false;

function getSlotExpr(granularity) {
  return granularity === 'hour' ? 'mh.hour_ts' : 'mh.day_ts';
}

function getBackfillInterval(granularity) {
  return granularity === 'hour'
    ? `${REFRESH_HOURS_WINDOW} HOUR`
    : `${REFRESH_DAYS_WINDOW} DAY`;
}

function buildDefaultRangeBound(granularity, boundary) {
  if (boundary === 'end') {
    return alignTimeToSlotText(formatDateToSqlText(new Date()), granularity);
  }

  const now = new Date();
  const shifted = new Date(now);
  if (granularity === 'hour') {
    shifted.setHours(shifted.getHours() - REFRESH_HOURS_WINDOW);
  } else {
    shifted.setDate(shifted.getDate() - REFRESH_DAYS_WINDOW);
    shifted.setHours(0, 0, 0, 0);
  }
  return alignTimeToSlotText(formatDateToSqlText(shifted), granularity);
}

function buildPeakHourCase(countryField, timeField) {
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

function buildWhereClause(granularity, options = {}) {
  const conditions = [];
  const slotExpr = getSlotExpr(granularity);
  let whereClause = `WHERE ${ANALYTICS_ASIN_HISTORY_FILTER}`;

  if (options.startTime) {
    whereClause += ` AND ${slotExpr} >= ?`;
    conditions.push(
      alignTimeToSlotText(options.startTime, granularity) || options.startTime,
    );
  } else {
    whereClause += ` AND ${slotExpr} >= ?`;
    conditions.push(buildDefaultRangeBound(granularity, 'start'));
  }

  if (options.endTime) {
    whereClause += ` AND ${slotExpr} <= ?`;
    conditions.push(
      alignTimeToSlotText(options.endTime, granularity) || options.endTime,
    );
  } else {
    whereClause += ` AND ${slotExpr} <= ?`;
    conditions.push(buildDefaultRangeBound(granularity, 'end'));
  }

  return { whereClause, conditions };
}

function recordAggRefreshMetric(table, granularity, status, durationMs) {
  metricsService.recordAnalyticsAggRefresh({
    table,
    granularity,
    status,
    durationSec: Math.max(0, durationMs) / 1000,
  });
}

async function refreshMonitorHistoryAgg(granularity, options = {}) {
  if (!AGG_ENABLED) {
    return { skipped: true, reason: 'disabled' };
  }

  const slotExpr = getSlotExpr(granularity);
  const { whereClause, conditions } = buildWhereClause(granularity, options);
  const isPeakCase = buildPeakHourCase('mh.country', 'mh.check_time');

  const sql = `
    INSERT INTO monitor_history_agg (
      granularity,
      time_slot,
      country,
      asin_key,
      check_count,
      broken_count,
      has_broken,
      has_peak,
      first_check_time,
      last_check_time
    )
    SELECT
      ? as granularity,
      ${slotExpr} as time_slot,
      mh.country,
      COALESCE(NULLIF(mh.asin_code, ''), CONCAT('ID#', mh.asin_id)) as asin_key,
      COUNT(*) as check_count,
      SUM(CASE WHEN mh.is_broken = 1 THEN 1 ELSE 0 END) as broken_count,
      MAX(mh.is_broken) as has_broken,
      MAX(${isPeakCase}) as has_peak,
      MIN(mh.check_time) as first_check_time,
      MAX(mh.check_time) as last_check_time
    FROM monitor_history mh
    ${whereClause}
    GROUP BY ${slotExpr}, mh.country, COALESCE(NULLIF(mh.asin_code, ''), CONCAT('ID#', mh.asin_id))
    ON DUPLICATE KEY UPDATE
      check_count = VALUES(check_count),
      broken_count = VALUES(broken_count),
      has_broken = VALUES(has_broken),
      has_peak = VALUES(has_peak),
      first_check_time = VALUES(first_check_time),
      last_check_time = VALUES(last_check_time)
  `;

  const start = Date.now();
  try {
    const result = await query(sql, [granularity, ...conditions]);
    const duration = Date.now() - start;
    logger.info(
      `[聚合刷新] table=monitor_history_agg, granularity=${granularity}, duration=${duration}ms, affectedRows=${
        result?.affectedRows || 0
      }`,
    );
    recordAggRefreshMetric(
      'monitor_history_agg',
      granularity,
      'success',
      duration,
    );
    return { success: true, duration, affectedRows: result?.affectedRows || 0 };
  } catch (error) {
    const duration = Date.now() - start;
    recordAggRefreshMetric(
      'monitor_history_agg',
      granularity,
      'error',
      duration,
    );
    throw error;
  }
}

async function refreshMonitorHistoryAggDim(granularity, options = {}) {
  if (!AGG_ENABLED || !REFRESH_DIM_AGG) {
    return { skipped: true, reason: 'disabled' };
  }

  const slotExpr = getSlotExpr(granularity);
  const { whereClause, conditions } = buildWhereClause(granularity, options);
  const isPeakCase = buildPeakHourCase('mh.country', 'mh.check_time');

  const sql = `
    INSERT INTO monitor_history_agg_dim (
      granularity,
      time_slot,
      country,
      site,
      brand,
      asin_key,
      check_count,
      broken_count,
      has_broken,
      has_peak,
      first_check_time,
      last_check_time
    )
    SELECT
      ? as granularity,
      ${slotExpr} as time_slot,
      mh.country,
      COALESCE(mh.site_snapshot, '') as site,
      COALESCE(mh.brand_snapshot, '') as brand,
      COALESCE(NULLIF(mh.asin_code, ''), CONCAT('ID#', mh.asin_id)) as asin_key,
      COUNT(*) as check_count,
      SUM(CASE WHEN mh.is_broken = 1 THEN 1 ELSE 0 END) as broken_count,
      MAX(mh.is_broken) as has_broken,
      MAX(${isPeakCase}) as has_peak,
      MIN(mh.check_time) as first_check_time,
      MAX(mh.check_time) as last_check_time
    FROM monitor_history mh
    ${whereClause}
    GROUP BY
      ${slotExpr},
      mh.country,
      COALESCE(mh.site_snapshot, ''),
      COALESCE(mh.brand_snapshot, ''),
      COALESCE(NULLIF(mh.asin_code, ''), CONCAT('ID#', mh.asin_id))
    ON DUPLICATE KEY UPDATE
      check_count = VALUES(check_count),
      broken_count = VALUES(broken_count),
      has_broken = VALUES(has_broken),
      has_peak = VALUES(has_peak),
      first_check_time = VALUES(first_check_time),
      last_check_time = VALUES(last_check_time)
  `;

  const start = Date.now();
  try {
    const result = await query(sql, [granularity, ...conditions]);
    const duration = Date.now() - start;
    logger.info(
      `[聚合刷新] table=monitor_history_agg_dim, granularity=${granularity}, duration=${duration}ms, affectedRows=${
        result?.affectedRows || 0
      }`,
    );
    recordAggRefreshMetric(
      'monitor_history_agg_dim',
      granularity,
      'success',
      duration,
    );
    return { success: true, duration, affectedRows: result?.affectedRows || 0 };
  } catch (error) {
    const duration = Date.now() - start;
    recordAggRefreshMetric(
      'monitor_history_agg_dim',
      granularity,
      'error',
      duration,
    );
    throw error;
  }
}

async function refreshMonitorHistoryAggVariantGroup(granularity, options = {}) {
  if (!AGG_ENABLED || !REFRESH_VARIANT_GROUP_AGG) {
    return { skipped: true, reason: 'disabled' };
  }

  const slotExpr = getSlotExpr(granularity);
  const { whereClause, conditions } = buildWhereClause(granularity, options);
  const isPeakCase = buildPeakHourCase('mh.country', 'mh.check_time');

  const sql = `
    INSERT INTO monitor_history_agg_variant_group (
      granularity,
      time_slot,
      country,
      variant_group_id,
      variant_group_name,
      asin_key,
      check_count,
      broken_count,
      has_broken,
      has_peak,
      first_check_time,
      last_check_time
    )
    SELECT
      ? as granularity,
      ${slotExpr} as time_slot,
      mh.country,
      mh.variant_group_id,
      COALESCE(MAX(NULLIF(mh.variant_group_name, '')), MAX(vg.name), '') as variant_group_name,
      COALESCE(NULLIF(mh.asin_code, ''), CONCAT('ID#', mh.asin_id)) as asin_key,
      COUNT(*) as check_count,
      SUM(CASE WHEN mh.is_broken = 1 THEN 1 ELSE 0 END) as broken_count,
      MAX(mh.is_broken) as has_broken,
      MAX(${isPeakCase}) as has_peak,
      MIN(mh.check_time) as first_check_time,
      MAX(mh.check_time) as last_check_time
    FROM monitor_history mh
    LEFT JOIN variant_groups vg ON vg.id = mh.variant_group_id
    ${whereClause}
      AND mh.variant_group_id IS NOT NULL
    GROUP BY
      ${slotExpr},
      mh.country,
      mh.variant_group_id,
      COALESCE(NULLIF(mh.asin_code, ''), CONCAT('ID#', mh.asin_id))
    ON DUPLICATE KEY UPDATE
      variant_group_name = VALUES(variant_group_name),
      check_count = VALUES(check_count),
      broken_count = VALUES(broken_count),
      has_broken = VALUES(has_broken),
      has_peak = VALUES(has_peak),
      first_check_time = VALUES(first_check_time),
      last_check_time = VALUES(last_check_time)
  `;

  const start = Date.now();
  try {
    const result = await query(sql, [granularity, ...conditions]);
    const duration = Date.now() - start;
    logger.info(
      `[聚合刷新] table=monitor_history_agg_variant_group, granularity=${granularity}, duration=${duration}ms, affectedRows=${
        result?.affectedRows || 0
      }`,
    );
    recordAggRefreshMetric(
      'monitor_history_agg_variant_group',
      granularity,
      'success',
      duration,
    );
    return { success: true, duration, affectedRows: result?.affectedRows || 0 };
  } catch (error) {
    const duration = Date.now() - start;
    recordAggRefreshMetric(
      'monitor_history_agg_variant_group',
      granularity,
      'error',
      duration,
    );
    throw error;
  }
}

async function refreshAnalyticsAggBundle(granularity, options = {}) {
  const baseResult = await refreshMonitorHistoryAgg(granularity, options);
  let dimResult = { skipped: true, reason: 'disabled' };
  let variantGroupResult = { skipped: true, reason: 'disabled' };

  if (REFRESH_DIM_AGG) {
    try {
      dimResult = await refreshMonitorHistoryAggDim(granularity, options);
    } catch (error) {
      logger.warn(
        `[聚合刷新] table=monitor_history_agg_dim, granularity=${granularity} failed, fallback to base agg only`,
        error?.message || error,
      );
      dimResult = { skipped: true, reason: 'dim_refresh_failed' };
    }
  }

  if (REFRESH_VARIANT_GROUP_AGG) {
    try {
      variantGroupResult = await refreshMonitorHistoryAggVariantGroup(
        granularity,
        options,
      );
    } catch (error) {
      logger.warn(
        `[聚合刷新] table=monitor_history_agg_variant_group, granularity=${granularity} failed, fallback to other sources`,
        error?.message || error,
      );
      variantGroupResult = {
        skipped: true,
        reason: 'variant_group_refresh_failed',
      };
    }
  }

  return {
    baseResult,
    dimResult,
    variantGroupResult,
  };
}

async function refreshRecentMonitorHistoryAgg() {
  if (!AGG_ENABLED) {
    return { skipped: true, reason: 'disabled' };
  }
  if (isRefreshing) {
    return { skipped: true, reason: 'already_running' };
  }

  isRefreshing = true;
  try {
    const hourBundle = await refreshAnalyticsAggBundle('hour');
    const dayBundle = await refreshAnalyticsAggBundle('day');
    return {
      success: true,
      hourResult: hourBundle.baseResult,
      dayResult: dayBundle.baseResult,
      hourDimResult: hourBundle.dimResult,
      dayDimResult: dayBundle.dimResult,
      hourVariantGroupResult: hourBundle.variantGroupResult,
      dayVariantGroupResult: dayBundle.variantGroupResult,
    };
  } catch (error) {
    logger.error(
      '[聚合刷新] refreshRecentMonitorHistoryAgg failed:',
      error.message,
    );
    return { success: false, error: error.message };
  } finally {
    isRefreshing = false;
  }
}

function getAggStatus() {
  return {
    enabled: AGG_ENABLED,
    refreshDimAgg: REFRESH_DIM_AGG,
    refreshVariantGroupAgg: REFRESH_VARIANT_GROUP_AGG,
    backfillHours: BACKFILL_HOURS,
    backfillDays: BACKFILL_DAYS,
    refreshHoursWindow: REFRESH_HOURS_WINDOW,
    refreshDaysWindow: REFRESH_DAYS_WINDOW,
    isRefreshing,
  };
}

module.exports = {
  refreshMonitorHistoryAgg,
  refreshMonitorHistoryAggDim,
  refreshMonitorHistoryAggVariantGroup,
  refreshAnalyticsAggBundle,
  refreshRecentMonitorHistoryAgg,
  getAggStatus,
};
