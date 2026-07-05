const { query, withTransaction } = require('../config/database');
const logger = require('../utils/logger');

const AGG_ENABLED = process.env.ANALYTICS_AGG_ENABLED !== '0';
const BACKFILL_HOURS = Number(process.env.ANALYTICS_AGG_BACKFILL_HOURS) || 48;
const BACKFILL_DAYS = Number(process.env.ANALYTICS_AGG_BACKFILL_DAYS) || 30;
const BACKFILL_MONTHS = Number(process.env.ANALYTICS_AGG_BACKFILL_MONTHS) || 24;
const REFRESH_DIM_AGG = process.env.ANALYTICS_AGG_REFRESH_DIM !== '0';
const REFRESH_VARIANT_GROUP_AGG =
  process.env.ANALYTICS_AGG_REFRESH_VARIANT_GROUP !== '0';
const REFRESH_STATUS_INTERVALS =
  process.env.ANALYTICS_STATUS_INTERVAL_ENABLED !== '0';
const ANALYTICS_ASIN_HISTORY_FILTER =
  "mh.check_type = 'ASIN' AND (mh.asin_id IS NOT NULL OR NULLIF(mh.asin_code, '') IS NOT NULL)";
const WATERMARK_TABLE = 'analytics_refresh_watermark';

let isRefreshing = false;

function getSupportedGranularities() {
  return ['hour', 'day', 'month'];
}

function getSlotExpr(granularity) {
  if (granularity === 'day') {
    return 'mh.day_ts';
  }
  if (granularity === 'month') {
    return "TIMESTAMP(DATE_FORMAT(mh.check_time, '%Y-%m-01 00:00:00'))";
  }
  return 'mh.hour_ts';
}

function getBackfillInterval(granularity) {
  if (granularity === 'day') {
    return `${BACKFILL_DAYS} DAY`;
  }
  if (granularity === 'month') {
    return `${BACKFILL_MONTHS} MONTH`;
  }
  return `${BACKFILL_HOURS} HOUR`;
}

function getSlotWhereFormat(granularity) {
  if (granularity === 'day') {
    return '%Y-%m-%d 00:00:00';
  }
  if (granularity === 'month') {
    return '%Y-%m-01 00:00:00';
  }
  return '%Y-%m-%d %H:00:00';
}

function buildAggDeleteClause(granularity, options = {}) {
  const slotWhereFormat = getSlotWhereFormat(granularity);
  let whereClause = 'WHERE granularity = ?';
  const conditions = [granularity];

  if (options.startTime) {
    whereClause += ` AND time_slot >= DATE_FORMAT(?, '${slotWhereFormat}')`;
    conditions.push(options.startTime);
  } else {
    whereClause += ` AND time_slot >= DATE_SUB(DATE_FORMAT(NOW(), '${slotWhereFormat}'), INTERVAL ${getBackfillInterval(
      granularity,
    )})`;
  }

  if (options.endTime) {
    whereClause += ` AND time_slot <= DATE_FORMAT(?, '${slotWhereFormat}')`;
    conditions.push(options.endTime);
  } else {
    whereClause += ` AND time_slot <= DATE_FORMAT(NOW(), '${slotWhereFormat}')`;
  }

  if (options.extraDeleteWhere) {
    whereClause += ` AND ${options.extraDeleteWhere}`;
  }

  return { whereClause, conditions };
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
  let whereClause = `WHERE ${ANALYTICS_ASIN_HISTORY_FILTER}`;

  if (options.extraWhere) {
    whereClause += ` AND ${options.extraWhere}`;
  }

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

function chunkArray(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function buildProcessorName(tableName, granularity) {
  return `${tableName}:${granularity}`;
}

async function getRefreshWatermark(processorName) {
  const rows = await query(
    `SELECT
       last_history_id,
       DATE_FORMAT(last_check_time, '%Y-%m-%d %H:%i:%s') as last_check_time
     FROM ${WATERMARK_TABLE}
     WHERE processor_name = ?`,
    [processorName],
  );
  const row = rows?.[0];
  return {
    lastHistoryId: Number(row?.last_history_id || 0),
    lastCheckTime: row?.last_check_time || '',
  };
}

async function updateRefreshWatermark(
  processorName,
  lastHistoryId,
  lastCheckTime,
) {
  if (!lastHistoryId) {
    return;
  }

  await query(
    `INSERT INTO ${WATERMARK_TABLE} (
       processor_name,
       last_history_id,
       last_check_time
     )
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       last_history_id = VALUES(last_history_id),
       last_check_time = VALUES(last_check_time)`,
    [processorName, lastHistoryId, lastCheckTime || null],
  );
}

async function getHistoryRefreshMeta(extraWhere = '', options = {}) {
  let whereClause = `WHERE ${ANALYTICS_ASIN_HISTORY_FILTER}`;
  const conditions = [];

  if (extraWhere) {
    whereClause += ` AND ${extraWhere}`;
  }

  if (options.afterHistoryId) {
    whereClause += ' AND mh.id > ?';
    conditions.push(options.afterHistoryId);
  }

  if (options.backfillWindow) {
    whereClause += ` AND mh.check_time >= DATE_SUB(NOW(), INTERVAL ${options.backfillWindow})`;
  }

  const rows = await query(
    `SELECT
       DATE_FORMAT(MIN(mh.check_time), '%Y-%m-%d %H:%i:%s') as min_time,
       DATE_FORMAT(MAX(mh.check_time), '%Y-%m-%d %H:%i:%s') as max_time,
       MAX(mh.id) as max_history_id
     FROM monitor_history mh
     ${whereClause}`,
    conditions,
  );
  const row = rows?.[0];
  return {
    minTime: row?.min_time || '',
    maxTime: row?.max_time || '',
    maxHistoryId: Number(row?.max_history_id || 0),
  };
}

async function getRefreshWindow(
  processorName,
  granularity,
  options = {},
  extraWhere = '',
) {
  if (options.startTime || options.endTime) {
    return {
      mode: 'manual',
      startTime: options.startTime || '',
      endTime: options.endTime || '',
      maxHistoryId: 0,
      maxCheckTime: options.endTime || '',
    };
  }

  const watermark = await getRefreshWatermark(processorName);
  if (watermark.lastHistoryId > 0) {
    const meta = await getHistoryRefreshMeta(extraWhere, {
      afterHistoryId: watermark.lastHistoryId,
    });
    if (!meta.maxHistoryId) {
      return null;
    }
    return {
      mode: 'incremental',
      startTime: meta.minTime,
      endTime: meta.maxTime,
      maxHistoryId: meta.maxHistoryId,
      maxCheckTime: meta.maxTime,
    };
  }

  const meta = await getHistoryRefreshMeta(extraWhere, {
    backfillWindow: granularity === 'hour' ? getBackfillInterval('hour') : '',
  });
  if (!meta.maxHistoryId) {
    return null;
  }
  return {
    mode: granularity === 'hour' ? 'bootstrap-backfill' : 'bootstrap-full',
    startTime: meta.minTime,
    endTime: meta.maxTime,
    maxHistoryId: meta.maxHistoryId,
    maxCheckTime: meta.maxTime,
  };
}

async function refreshAggTable({
  tableName,
  granularity,
  options = {},
  extraWhere = '',
  insertSql,
}) {
  if (!AGG_ENABLED) {
    return { skipped: true, reason: 'disabled' };
  }

  const processorName = buildProcessorName(tableName, granularity);
  const refreshWindow = await getRefreshWindow(
    processorName,
    granularity,
    options,
    extraWhere,
  );
  if (!refreshWindow?.startTime || !refreshWindow?.endTime) {
    return { skipped: true, reason: 'no_new_rows' };
  }

  const rangeOptions = {
    ...options,
    startTime: refreshWindow.startTime,
    endTime: refreshWindow.endTime,
  };
  const deleteRange = buildAggDeleteClause(granularity, rangeOptions);
  const deleteSql = `DELETE FROM ${tableName} ${deleteRange.whereClause}`;
  const deleteResult = await query(deleteSql, deleteRange.conditions);

  const start = Date.now();
  const result = await query(insertSql, [
    granularity,
    refreshWindow.startTime,
    refreshWindow.endTime,
  ]);
  const duration = Date.now() - start;

  if (refreshWindow.mode !== 'manual') {
    await updateRefreshWatermark(
      processorName,
      refreshWindow.maxHistoryId,
      refreshWindow.maxCheckTime,
    );
  }

  logger.info(
    `[聚合刷新] table=${tableName}, granularity=${granularity}, mode=${
      refreshWindow.mode
    }, duration=${duration}ms, removedRows=${
      deleteResult?.affectedRows || 0
    }, affectedRows=${result?.affectedRows || 0}`,
  );

  return {
    success: true,
    duration,
    mode: refreshWindow.mode,
    affectedRows: result?.affectedRows || 0,
    removedRows: deleteResult?.affectedRows || 0,
  };
}

async function refreshMonitorHistoryAgg(granularity, options = {}) {
  const slotExpr = getSlotExpr(granularity);
  const isPeakCase = buildPeakHourCase('mh.country', 'mh.check_time');
  const { whereClause } = buildWhereClause(granularity, {
    ...options,
    extraWhere: '',
  });

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

  return refreshAggTable({
    tableName: 'monitor_history_agg',
    granularity,
    options,
    insertSql: sql,
  });
}

async function refreshMonitorHistoryAggDim(granularity, options = {}) {
  if (!REFRESH_DIM_AGG) {
    return { skipped: true, reason: 'disabled' };
  }

  const slotExpr = getSlotExpr(granularity);
  const isPeakCase = buildPeakHourCase('mh.country', 'mh.check_time');
  const { whereClause } = buildWhereClause(granularity, {
    ...options,
    extraWhere: '',
  });

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

  return refreshAggTable({
    tableName: 'monitor_history_agg_dim',
    granularity,
    options,
    insertSql: sql,
  });
}

async function refreshMonitorHistoryAggVariantGroup(granularity, options = {}) {
  if (!REFRESH_VARIANT_GROUP_AGG) {
    return { skipped: true, reason: 'disabled' };
  }

  const slotExpr = getSlotExpr(granularity);
  const isPeakCase = buildPeakHourCase('mh.country', 'mh.check_time');
  const { whereClause } = buildWhereClause(granularity, {
    ...options,
    extraWhere: 'mh.variant_group_id IS NOT NULL',
  });

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

  return refreshAggTable({
    tableName: 'monitor_history_agg_variant_group',
    granularity,
    options,
    extraWhere: 'mh.variant_group_id IS NOT NULL',
    insertSql: sql,
  });
}

function buildStatusIntervalInsertParams(item) {
  return [
    item.asinKey,
    item.asinId || null,
    item.asinCode || null,
    item.asinName || null,
    item.country,
    item.variantGroupId || null,
    item.variantGroupName || null,
    item.intervalStart,
    item.intervalEnd || null,
    item.isBroken ? 1 : 0,
  ];
}

async function loadOpenStatusIntervals(keyPairs) {
  if (!Array.isArray(keyPairs) || keyPairs.length === 0) {
    return [];
  }

  const chunks = chunkArray(keyPairs, 200);
  const results = [];

  for (const chunk of chunks) {
    const tuplePlaceholders = chunk.map(() => '(?, ?)').join(', ');
    const conditions = chunk.flatMap((item) => [item.asinKey, item.country]);
    const rows = await query(
      `SELECT
         asin_key,
         asin_id,
         asin_code,
         asin_name,
         country,
         variant_group_id,
         variant_group_name,
         DATE_FORMAT(interval_start, '%Y-%m-%d %H:%i:%s') as interval_start,
         is_broken
       FROM monitor_history_status_interval
       WHERE interval_end IS NULL
         AND (asin_key, country) IN (${tuplePlaceholders})`,
      conditions,
    );
    results.push(...rows);
  }

  return results;
}

async function refreshMonitorHistoryStatusIntervals() {
  if (!AGG_ENABLED || !REFRESH_STATUS_INTERVALS) {
    return { skipped: true, reason: 'disabled' };
  }

  const processorName = 'monitor_history_status_interval';
  const watermark = await getRefreshWatermark(processorName);
  const rows = await query(
    `SELECT
       mh.id,
       DATE_FORMAT(mh.check_time, '%Y-%m-%d %H:%i:%s') as check_time,
       mh.country,
       mh.asin_id,
       COALESCE(NULLIF(mh.asin_code, ''), CONCAT('ID#', mh.asin_id)) as asin_key,
       NULLIF(mh.asin_code, '') as asin_code,
       NULLIF(mh.asin_name, '') as asin_name,
       mh.variant_group_id,
       NULLIF(mh.variant_group_name, '') as variant_group_name,
       mh.is_broken
     FROM monitor_history mh
     WHERE ${ANALYTICS_ASIN_HISTORY_FILTER}
       ${watermark.lastHistoryId > 0 ? 'AND mh.id > ?' : ''}
     ORDER BY mh.country ASC, asin_key ASC, mh.check_time ASC, mh.id ASC`,
    watermark.lastHistoryId > 0 ? [watermark.lastHistoryId] : [],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return { skipped: true, reason: 'no_new_rows' };
  }

  const keyPairs = Array.from(
    new Map(
      rows.map((item) => [
        `${item.asin_key}|${item.country}`,
        { asinKey: item.asin_key, country: item.country },
      ]),
    ).values(),
  );
  const existingOpenRows = await loadOpenStatusIntervals(keyPairs);
  const openMap = new Map(
    existingOpenRows.map((item) => [
      `${item.asin_key}|${item.country}`,
      {
        asinKey: item.asin_key,
        asinId: item.asin_id,
        asinCode: item.asin_code,
        asinName: item.asin_name,
        country: item.country,
        variantGroupId: item.variant_group_id,
        variantGroupName: item.variant_group_name,
        intervalStart: item.interval_start,
        intervalEnd: null,
        isBroken: Number(item.is_broken) === 1,
        persisted: true,
      },
    ]),
  );
  const intervalsToInsert = [];
  const persistedClosures = [];

  rows.forEach((item) => {
    const stateKey = `${item.asin_key}|${item.country}`;
    const currentOpen = openMap.get(stateKey);
    const nextInterval = {
      asinKey: item.asin_key,
      asinId: item.asin_id,
      asinCode: item.asin_code,
      asinName: item.asin_name,
      country: item.country,
      variantGroupId: item.variant_group_id,
      variantGroupName: item.variant_group_name,
      intervalStart: item.check_time,
      intervalEnd: null,
      isBroken: Number(item.is_broken) === 1,
      persisted: false,
    };

    if (!currentOpen) {
      openMap.set(stateKey, nextInterval);
      return;
    }

    if (Boolean(currentOpen.isBroken) === Boolean(nextInterval.isBroken)) {
      return;
    }

    if (currentOpen.persisted) {
      persistedClosures.push({
        asinKey: currentOpen.asinKey,
        country: currentOpen.country,
        intervalStart: currentOpen.intervalStart,
        intervalEnd: item.check_time,
      });
    } else {
      currentOpen.intervalEnd = item.check_time;
      intervalsToInsert.push(currentOpen);
    }

    openMap.set(stateKey, nextInterval);
  });

  openMap.forEach((item) => {
    if (!item.persisted) {
      intervalsToInsert.push(item);
    }
  });

  const maxHistoryId = Number(rows[rows.length - 1]?.id || 0);
  const maxCheckTime = rows[rows.length - 1]?.check_time || '';
  const insertChunks = chunkArray(intervalsToInsert, 500);
  const closeChunks = chunkArray(persistedClosures, 500);
  const startedAt = Date.now();

  await withTransaction(async ({ query: transactionQuery }) => {
    for (const chunk of closeChunks) {
      for (const item of chunk) {
        await transactionQuery(
          `UPDATE monitor_history_status_interval
           SET interval_end = ?
           WHERE asin_key = ?
             AND country = ?
             AND interval_start = ?
             AND interval_end IS NULL`,
          [item.intervalEnd, item.asinKey, item.country, item.intervalStart],
        );
      }
    }

    for (const chunk of insertChunks) {
      if (chunk.length === 0) {
        continue;
      }
      const placeholders = chunk
        .map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .join(', ');
      const conditions = chunk.flatMap((item) =>
        buildStatusIntervalInsertParams(item),
      );
      await transactionQuery(
        `INSERT INTO monitor_history_status_interval (
           asin_key,
           asin_id,
           asin_code,
           asin_name,
           country,
           variant_group_id,
           variant_group_name,
           interval_start,
           interval_end,
           is_broken
         )
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE
           asin_id = VALUES(asin_id),
           asin_code = VALUES(asin_code),
           asin_name = VALUES(asin_name),
           variant_group_id = VALUES(variant_group_id),
           variant_group_name = VALUES(variant_group_name),
           interval_end = VALUES(interval_end),
           is_broken = VALUES(is_broken)`,
        conditions,
      );
    }
  });

  await updateRefreshWatermark(processorName, maxHistoryId, maxCheckTime);

  const duration = Date.now() - startedAt;
  logger.info(
    `[状态区间刷新] duration=${duration}ms, sourceRows=${rows.length}, closedIntervals=${persistedClosures.length}, insertedIntervals=${intervalsToInsert.length}`,
  );

  return {
    success: true,
    duration,
    sourceRows: rows.length,
    closedIntervals: persistedClosures.length,
    insertedIntervals: intervalsToInsert.length,
  };
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
    const bundles = {};
    for (const granularity of getSupportedGranularities()) {
      bundles[granularity] = await refreshAnalyticsAggBundle(granularity);
    }

    const statusIntervalResult = await refreshMonitorHistoryStatusIntervals();
    return {
      success: true,
      hourResult: bundles.hour.baseResult,
      dayResult: bundles.day.baseResult,
      monthResult: bundles.month.baseResult,
      hourDimResult: bundles.hour.dimResult,
      dayDimResult: bundles.day.dimResult,
      monthDimResult: bundles.month.dimResult,
      hourVariantGroupResult: bundles.hour.variantGroupResult,
      dayVariantGroupResult: bundles.day.variantGroupResult,
      monthVariantGroupResult: bundles.month.variantGroupResult,
      statusIntervalResult,
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
    refreshStatusIntervals: REFRESH_STATUS_INTERVALS,
    backfillHours: BACKFILL_HOURS,
    backfillDays: BACKFILL_DAYS,
    backfillMonths: BACKFILL_MONTHS,
    granularities: getSupportedGranularities(),
    isRefreshing,
  };
}

module.exports = {
  refreshMonitorHistoryAgg,
  refreshMonitorHistoryAggDim,
  refreshMonitorHistoryAggVariantGroup,
  refreshMonitorHistoryStatusIntervals,
  refreshAnalyticsAggBundle,
  refreshRecentMonitorHistoryAgg,
  getAggStatus,
};
