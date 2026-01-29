const { query } = require('../config/database');
const logger = require('../utils/logger');

const AGG_ENABLED = process.env.ANALYTICS_AGG_ENABLED !== '0';
const BACKFILL_HOURS = Number(process.env.ANALYTICS_AGG_BACKFILL_HOURS) || 48;
const BACKFILL_DAYS = Number(process.env.ANALYTICS_AGG_BACKFILL_DAYS) || 30;

let isRefreshing = false;

function getDateFormat(granularity) {
  return granularity === 'hour' ? '%Y-%m-%d %H:00:00' : '%Y-%m-%d 00:00:00';
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

async function refreshMonitorHistoryAgg(granularity, options = {}) {
  if (!AGG_ENABLED) {
    return { skipped: true, reason: 'disabled' };
  }

  const dateFormat = getDateFormat(granularity);
  const conditions = [];
  let whereClause = 'WHERE (asin_id IS NOT NULL OR asin_code IS NOT NULL)';

  if (options.startTime) {
    whereClause += ' AND check_time >= ?';
    conditions.push(options.startTime);
  } else {
    whereClause += ` AND check_time >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL ${getBackfillInterval(
      granularity,
    )}), '${dateFormat}')`;
  }

  if (options.endTime) {
    whereClause += ' AND check_time <= ?';
    conditions.push(options.endTime);
  } else {
    whereClause += ' AND check_time <= NOW()';
  }

  const isPeakCase = buildPeakHourCase('country', 'check_time');
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
      DATE_FORMAT(check_time, '${dateFormat}') as time_slot,
      country,
      COALESCE(asin_id, asin_code) as asin_key,
      COUNT(*) as check_count,
      SUM(CASE WHEN is_broken = 1 THEN 1 ELSE 0 END) as broken_count,
      MAX(is_broken) as has_broken,
      MAX(${isPeakCase}) as has_peak,
      MIN(check_time) as first_check_time,
      MAX(check_time) as last_check_time
    FROM monitor_history
    ${whereClause}
    GROUP BY DATE_FORMAT(check_time, '${dateFormat}'), country, COALESCE(asin_id, asin_code)
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
    return { success: true, hourResult, dayResult };
  } catch (error) {
    logger.error('[聚合刷新] 执行失败:', error);
    return { success: false, error };
  } finally {
    isRefreshing = false;
  }
}

module.exports = {
  refreshMonitorHistoryAgg,
  refreshRecentMonitorHistoryAgg,
};
