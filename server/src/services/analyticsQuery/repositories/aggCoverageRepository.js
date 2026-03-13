const { query } = require('../../../config/database');
const {
  alignTimeToSlotText,
  formatDateToSqlText,
} = require('../shared/timeUtils');

const AGG_COVERAGE_CACHE = new Map();

function canUseAggForRange(timeSlotGranularity, startTime, endTime = '') {
  const baseTime = startTime || endTime;
  if (!baseTime) {
    return false;
  }

  const parsed = new Date(String(baseTime).replace(' ', 'T'));
  if (!Number.isFinite(parsed.getTime())) {
    return false;
  }

  const now = new Date();
  const diffMs = now.getTime() - parsed.getTime();
  const backfillHours = Number(process.env.ANALYTICS_AGG_BACKFILL_HOURS) || 48;
  const backfillDays = Number(process.env.ANALYTICS_AGG_BACKFILL_DAYS) || 30;
  const limitMs =
    timeSlotGranularity === 'hour'
      ? backfillHours * 60 * 60 * 1000
      : backfillDays * 24 * 60 * 60 * 1000;

  return diffMs <= limitMs;
}

async function getAggRangeCoverage(tableName, granularity) {
  const allowedTables = new Set([
    'monitor_history_agg',
    'monitor_history_agg_dim',
    'monitor_history_agg_variant_group',
  ]);
  if (!allowedTables.has(tableName)) {
    throw new Error(`不支持的聚合表: ${tableName}`);
  }

  const cacheTtlMs =
    Number(process.env.ANALYTICS_AGG_COVERAGE_CACHE_TTL_MS) || 60000;
  const cacheKey = `${tableName}:${granularity}`;
  const now = Date.now();
  const cached = AGG_COVERAGE_CACHE.get(cacheKey);
  if (cached && now - cached.cachedAt < cacheTtlMs) {
    return cached;
  }

  const sql = `
    SELECT
      DATE_FORMAT(MIN(time_slot), '%Y-%m-%d %H:%i:%s') as min_slot,
      DATE_FORMAT(MAX(time_slot), '%Y-%m-%d %H:%i:%s') as max_slot
    FROM ${tableName}
    WHERE granularity = ?
  `;
  const [row] = await query(sql, [granularity]);
  const coverage = {
    minSlot: row?.min_slot || '',
    maxSlot: row?.max_slot || '',
    cachedAt: now,
  };
  AGG_COVERAGE_CACHE.set(cacheKey, coverage);
  return coverage;
}

async function isAggTableCoveringRange(
  tableName,
  granularity,
  startTime = '',
  endTime = '',
) {
  const coverage = await getAggRangeCoverage(tableName, granularity);
  if (!coverage.minSlot || !coverage.maxSlot) {
    return false;
  }

  const alignedStart = alignTimeToSlotText(startTime, granularity);
  const alignedEnd = alignTimeToSlotText(endTime, granularity);
  let alignedEndForCheck = alignedEnd;
  if (alignedEnd) {
    const nowAligned = alignTimeToSlotText(
      formatDateToSqlText(new Date()),
      granularity,
    );
    if (nowAligned && alignedEndForCheck > nowAligned) {
      alignedEndForCheck = nowAligned;
    }
  }

  if (alignedStart && coverage.minSlot > alignedStart) {
    return false;
  }
  if (alignedEndForCheck && coverage.maxSlot < alignedEndForCheck) {
    const lagToleranceMs =
      (Number(process.env.ANALYTICS_AGG_ACCEPTABLE_LAG_MINUTES) || 120) *
      60 *
      1000;
    const maxSlotTime = new Date(coverage.maxSlot.replace(' ', 'T')).getTime();
    const endSlotTime = new Date(
      alignedEndForCheck.replace(' ', 'T'),
    ).getTime();
    if (
      !Number.isFinite(maxSlotTime) ||
      !Number.isFinite(endSlotTime) ||
      endSlotTime - maxSlotTime > lagToleranceMs
    ) {
      return false;
    }
  }

  return true;
}

module.exports = {
  canUseAggForRange,
  getAggRangeCoverage,
  isAggTableCoveringRange,
};
