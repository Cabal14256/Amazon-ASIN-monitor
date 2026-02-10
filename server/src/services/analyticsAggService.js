const { query } = require('../config/database');
const logger = require('../utils/logger');

const AGG_ENABLED = process.env.ANALYTICS_AGG_ENABLED !== '0';
const BACKFILL_HOURS = Number(process.env.ANALYTICS_AGG_BACKFILL_HOURS) || 48;
const BACKFILL_DAYS = Number(process.env.ANALYTICS_AGG_BACKFILL_DAYS) || 30;
const REFRESH_DIM_AGG = process.env.ANALYTICS_AGG_REFRESH_DIM !== '0';

let isRefreshing = false;

function getSlotExpr(granularity) {
  return granularity === 'hour' ? 'mh.hour_ts' : 'mh.day_ts';
}

function getBackfillInterval(granularity) {
  return granularity === 'hour'
    ? `${BACKFILL_HOURS} HOUR`
    : `${BACKFILL_DAYS} DAY`;
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
  let whereClause =
    'WHERE (mh.asin_id IS NOT NULL OR mh.asin_code IS NOT NULL)';

  if (options.startTime) {
    whereClause += ' AND mh.check_time >= ?';
    conditions.push(options.startTime);
  } else {
    whereClause += ` AND mh.check_time >= DATE_SUB(NOW(), INTERVAL ${getBackfillInterval(
      granularity,
    )})`;
  }

  if (options.endTime) {
    whereClause += ' AND mh.check_time <= ?';
    conditions.push(options.endTime);
  } else {
    whereClause += ' AND mh.check_time <= NOW()';
  }

  return { whereClause, conditions };
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
      COALESCE(mh.asin_id, mh.asin_code) as asin_key,
      COUNT(*) as check_count,
      SUM(CASE WHEN mh.is_broken = 1 THEN 1 ELSE 0 END) as broken_count,
      MAX(mh.is_broken) as has_broken,
      MAX(${isPeakCase}) as has_peak,
      MIN(mh.check_time) as first_check_time,
      MAX(mh.check_time) as last_check_time
    FROM monitor_history mh
    ${whereClause}
    GROUP BY ${slotExpr}, mh.country, COALESCE(mh.asin_id, mh.asin_code)
    ON DUPLICATE KEY UPDATE
      check_count = VALUES(check_count),
      broken_count = VALUES(broken_count),
      has_broken = VALUES(has_broken),
      has_peak = VALUES(has_peak),
      first_check_time = VALUES(first_check_time),
      last_check_time = VALUES(last_check_time)
  `;

  const params = [granularity, ...conditions];

  const start = Date.now();
  const result = await query(sql, params);
  const duration = Date.now() - start;
  logger.info(
    `[聚合刷新] granularity=${granularity}, 耗时${duration}ms, 影响行数=${
      result?.affectedRows || 0
    }`,
  );
  return { success: true, duration, affectedRows: result?.affectedRows || 0 };
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
      COALESCE(mh.asin_id, mh.asin_code) as asin_key,
      COUNT(*) as check_count,
      SUM(CASE WHEN mh.is_broken = 1 THEN 1 ELSE 0 END) as broken_count,
      MAX(mh.is_broken) as has_broken,
      MAX(${isPeakCase}) as has_peak,
      MIN(mh.check_time) as first_check_time,
      MAX(mh.check_time) as last_check_time
    FROM monitor_history mh
    ${whereClause}
    GROUP BY ${slotExpr}, mh.country, COALESCE(mh.site_snapshot, ''), COALESCE(mh.brand_snapshot, ''), COALESCE(mh.asin_id, mh.asin_code)
    ON DUPLICATE KEY UPDATE
      check_count = VALUES(check_count),
      broken_count = VALUES(broken_count),
      has_broken = VALUES(has_broken),
      has_peak = VALUES(has_peak),
      first_check_time = VALUES(first_check_time),
      last_check_time = VALUES(last_check_time)
  `;

  const params = [granularity, ...conditions];

  const start = Date.now();
  const result = await query(sql, params);
  const duration = Date.now() - start;
  logger.info(
    `[聚合刷新-dim] granularity=${granularity}, 耗时${duration}ms, 影响行数=${
      result?.affectedRows || 0
    }`,
  );
  return { success: true, duration, affectedRows: result?.affectedRows || 0 };
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
    const hourResult = await refreshMonitorHistoryAgg('hour');
    const dayResult = await refreshMonitorHistoryAgg('day');
    let hourDimResult = { skipped: true, reason: 'disabled' };
    let dayDimResult = { skipped: true, reason: 'disabled' };
    if (REFRESH_DIM_AGG) {
      try {
        hourDimResult = await refreshMonitorHistoryAggDim('hour');
        dayDimResult = await refreshMonitorHistoryAggDim('day');
      } catch (dimError) {
        logger.warn(
          '[聚合刷新-dim] 执行失败，将继续使用基础聚合表',
          dimError.message,
        );
        hourDimResult = { skipped: true, reason: 'dim_refresh_failed' };
        dayDimResult = { skipped: true, reason: 'dim_refresh_failed' };
      }
    }
    return {
      success: true,
      hourResult,
      dayResult,
      hourDimResult,
      dayDimResult,
    };
  } catch (error) {
    logger.error('[聚合刷新] 执行失败:', error.message);
    return { success: false, error: error.message };
  } finally {
    isRefreshing = false;
  }
}

module.exports = {
  refreshMonitorHistoryAgg,
  refreshMonitorHistoryAggDim,
  refreshRecentMonitorHistoryAgg,
  getAggStatus: () => ({
    enabled: AGG_ENABLED,
    refreshDimAgg: REFRESH_DIM_AGG,
    backfillHours: BACKFILL_HOURS,
    backfillDays: BACKFILL_DAYS,
    isRefreshing,
  }),
};
