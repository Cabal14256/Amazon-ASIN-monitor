const { query, getPoolStatus } = require('../config/database');
const cacheService = require('../services/cacheService');
const analyticsCacheService = require('../services/analyticsCacheService');
const analyticsAggService = require('../services/analyticsAggService');
const logger = require('../utils/logger');

const AGG_COVERAGE_CACHE = new Map();
const ANALYTICS_CACHE_VERSION = 'full-history-v2';

function alignTimeToSlotText(value, granularity) {
  if (!value) {
    return '';
  }
  const normalized = String(value).trim().replace('T', ' ');
  const datePart = normalized.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    return '';
  }
  if (granularity === 'day') {
    return `${datePart} 00:00:00`;
  }
  const hourPart = normalized.length >= 13 ? normalized.slice(11, 13) : '00';
  if (!/^\d{2}$/.test(hourPart)) {
    return '';
  }
  return `${datePart} ${hourPart}:00:00`;
}

function formatDateToSqlText(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function clampValue(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

function parseDateTimeInput(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const normalized = String(value).trim().replace('T', ' ');
  if (!normalized) {
    return null;
  }
  const match = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (match) {
    const [, year, month, day, hour = '00', minute = '00', second = '00'] =
      match;
    const parsed = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      0,
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildAnalyticsMeta({
  source = 'raw',
  cacheHit = false,
  generatedAt = '',
  lastUpdatedAt = '',
  busyFallback = false,
  busyReason = '',
} = {}) {
  const normalizedSource = String(source || 'raw').trim() || 'raw';
  const effectiveSource =
    cacheHit && !normalizedSource.startsWith('cache')
      ? `cache+${normalizedSource}`
      : normalizedSource;
  const normalizedUpdatedAt = lastUpdatedAt || generatedAt || null;

  return {
    source: effectiveSource,
    cacheHit: Boolean(cacheHit),
    cacheTime: cacheHit ? normalizedUpdatedAt : null,
    dataFreshness: cacheHit ? 'cached' : 'fresh',
    lastUpdatedAt: normalizedUpdatedAt,
    busyFallback: Boolean(busyFallback),
    busyReason: busyFallback ? busyReason || null : null,
  };
}

function buildAnalyticsEnvelope(
  data,
  { source = 'raw', generatedAt = '' } = {},
) {
  return {
    __analyticsEnvelope: true,
    data,
    meta: {
      source,
      generatedAt: generatedAt || formatDateToSqlText(new Date()),
    },
  };
}

function unpackAnalyticsEnvelope(payload) {
  if (
    payload &&
    typeof payload === 'object' &&
    payload.__analyticsEnvelope === true &&
    'data' in payload
  ) {
    return payload;
  }
  return null;
}

function resolveCachedAnalyticsResult(
  cached,
  includeMeta = false,
  metaPatch = {},
) {
  const envelope = unpackAnalyticsEnvelope(cached);
  if (envelope) {
    const data = envelope.data;
    if (!includeMeta) {
      return data;
    }
    return {
      data,
      meta: buildAnalyticsMeta({
        source: envelope.meta?.source || 'cache',
        cacheHit: true,
        generatedAt: envelope.meta?.generatedAt || '',
        lastUpdatedAt: envelope.meta?.lastUpdatedAt || '',
        busyFallback: metaPatch.busyFallback === true,
        busyReason: metaPatch.busyReason || '',
      }),
    };
  }

  if (!includeMeta) {
    return cached;
  }

  return {
    data: cached,
    meta: buildAnalyticsMeta({
      source: 'cache',
      cacheHit: true,
      busyFallback: metaPatch.busyFallback === true,
      busyReason: metaPatch.busyReason || '',
    }),
  };
}

function finalizeAnalyticsResult(
  data,
  {
    includeMeta = false,
    source = 'raw',
    generatedAt = '',
    busyFallback = false,
    busyReason = '',
  } = {},
) {
  if (!includeMeta) {
    return data;
  }

  return {
    data,
    meta: buildAnalyticsMeta({
      source,
      cacheHit: false,
      generatedAt,
      lastUpdatedAt: generatedAt,
      busyFallback,
      busyReason,
    }),
  };
}

function getAnalyticsBusyContext() {
  const poolStatus = getPoolStatus();
  const aggStatus = analyticsAggService.getAggStatus();
  const connectionLimit = Number(poolStatus?.config?.connectionLimit) || 0;
  const activeConnections = Number(poolStatus?.activeConnections) || 0;
  const queueLength = Number(poolStatus?.queueLength) || 0;
  const activeRatio =
    connectionLimit > 0 ? activeConnections / connectionLimit : 0;
  const queueThreshold =
    Number(process.env.ANALYTICS_BUSY_QUEUE_THRESHOLD) || 10;
  const ratioThreshold =
    Number(process.env.ANALYTICS_BUSY_ACTIVE_CONNECTION_RATIO) || 0.85;

  if (aggStatus?.isRefreshing) {
    return {
      busy: true,
      reason: '聚合刷新进行中，优先返回最近一次缓存结果',
      poolStatus,
      aggStatus,
    };
  }

  if (queueLength >= queueThreshold || activeRatio >= ratioThreshold) {
    return {
      busy: true,
      reason: '数据库连接池繁忙，优先返回最近一次缓存结果',
      poolStatus,
      aggStatus,
    };
  }

  return {
    busy: false,
    reason: '',
    poolStatus,
    aggStatus,
  };
}

async function getBusyFallbackAnalyticsResult(
  latestKey,
  includeMeta = false,
  busyContext = {},
) {
  if (!busyContext?.busy || !latestKey) {
    return null;
  }

  const cached = await analyticsCacheService.getLatest(latestKey);
  if (cached === null) {
    return null;
  }

  return resolveCachedAnalyticsResult(cached, includeMeta, {
    busyFallback: true,
    busyReason: busyContext.reason || '',
  });
}

async function storeAnalyticsResult(cacheKey, latestKey, data, meta, ttlMs) {
  const envelope = buildAnalyticsEnvelope(data, meta);
  await analyticsCacheService.set(cacheKey, envelope, ttlMs);
  if (latestKey) {
    await analyticsCacheService.rememberLatest(latestKey, envelope, ttlMs);
  }
}

function formatDateToDayText(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatDateToMonthText(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

function formatDateToHourText(date) {
  return `${formatDateToSqlText(date).slice(0, 13)}:00:00`;
}

function getISOWeekInfo(date) {
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const dayNumber = (target.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNumber + 3); // 调整到周四

  const isoYear = target.getFullYear();
  const firstThursday = new Date(isoYear, 0, 4);
  firstThursday.setHours(0, 0, 0, 0);
  const firstDayNumber = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDayNumber + 3);

  const week =
    1 + Math.round((target - firstThursday) / (7 * 24 * 3600 * 1000));
  return { year: isoYear, week };
}

function formatISOWeekTextFromDate(date) {
  const { year, week } = getISOWeekInfo(date);
  return `${year}-${String(week).padStart(2, '0')}`;
}

function getISOWeekStartDate(year, week) {
  const jan4 = new Date(year, 0, 4, 0, 0, 0, 0);
  const jan4Day = jan4.getDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - jan4Day + 1);
  week1Monday.setHours(0, 0, 0, 0);

  const weekStart = new Date(week1Monday);
  weekStart.setDate(week1Monday.getDate() + (week - 1) * 7);
  return weekStart;
}

function getBucketRangeByPeriod(timePeriod, granularity) {
  const period = String(timePeriod || '').trim();
  if (!period) {
    return { bucketStart: null, bucketEnd: null };
  }

  let bucketStart = null;
  let bucketEnd = null;

  if (granularity === 'hour') {
    bucketStart = parseDateTimeInput(period);
    if (bucketStart) {
      bucketEnd = new Date(bucketStart);
      bucketEnd.setHours(bucketEnd.getHours() + 1);
    }
  } else if (granularity === 'day') {
    bucketStart = parseDateTimeInput(`${period} 00:00:00`);
    if (bucketStart) {
      bucketEnd = new Date(bucketStart);
      bucketEnd.setDate(bucketEnd.getDate() + 1);
    }
  } else if (granularity === 'week') {
    const match = period.match(/^(\d{4})-(\d{2})$/);
    if (match) {
      const year = Number(match[1]);
      const week = Number(match[2]);
      bucketStart = getISOWeekStartDate(year, week);
      bucketEnd = new Date(bucketStart);
      bucketEnd.setDate(bucketEnd.getDate() + 7);
    }
  }

  return { bucketStart, bucketEnd };
}

function calculateOverlapHours(bucketStart, bucketEnd, queryStart, queryEnd) {
  if (!bucketStart || !bucketEnd || !queryStart || !queryEnd) {
    return 0;
  }
  const overlapStart = Math.max(bucketStart.getTime(), queryStart.getTime());
  const overlapEnd = Math.min(bucketEnd.getTime(), queryEnd.getTime());
  if (overlapEnd <= overlapStart) {
    return 0;
  }
  return (overlapEnd - overlapStart) / (1000 * 60 * 60);
}

function buildAbnormalDurationSummary(data, startTime, endTime) {
  const queryTimeRange =
    startTime && endTime ? `${startTime} ~ ${endTime}` : '-';
  const summaryMap = new Map();

  for (const item of data) {
    if (!item?.asin && !item?.asinId) {
      continue;
    }
    const asin = item.asin || `ASIN-${item.asinId}`;
    const country = item.country || '';
    const key = `${item.asinId || asin}-${country}`;

    if (!summaryMap.has(key)) {
      summaryMap.set(key, {
        key,
        asin,
        country,
        queryTimeRange,
        abnormalCount: 0,
        totalAbnormalDuration: 0,
        minAbnormalDuration: Number.POSITIVE_INFINITY,
        maxAbnormalDuration: 0,
        maxAbnormalTime: '-',
      });
    }

    const summary = summaryMap.get(key);
    const brokenCount = Number(item.brokenCount || 0);
    const abnormalDuration = Number(item.abnormalDuration || 0);

    summary.abnormalCount += brokenCount;
    summary.totalAbnormalDuration += abnormalDuration;

    if (brokenCount > 0 && abnormalDuration > 0) {
      const perAbnormalDuration = abnormalDuration / brokenCount;
      summary.minAbnormalDuration = Math.min(
        summary.minAbnormalDuration,
        perAbnormalDuration,
      );
      if (perAbnormalDuration > summary.maxAbnormalDuration) {
        summary.maxAbnormalDuration = perAbnormalDuration;
        summary.maxAbnormalTime = item.timePeriod || '-';
      }
    }
  }

  return Array.from(summaryMap.values())
    .map((item) => {
      const averageAbnormalDuration =
        item.abnormalCount > 0
          ? item.totalAbnormalDuration / item.abnormalCount
          : 0;
      const minAbnormalDuration =
        item.minAbnormalDuration === Number.POSITIVE_INFINITY
          ? 0
          : item.minAbnormalDuration;
      return {
        key: item.key,
        asin: item.asin,
        country: item.country,
        queryTimeRange: item.queryTimeRange,
        abnormalCount: item.abnormalCount,
        averageAbnormalDuration: Number(averageAbnormalDuration.toFixed(2)),
        minAbnormalDuration: Number(minAbnormalDuration.toFixed(2)),
        maxAbnormalDuration: Number(item.maxAbnormalDuration.toFixed(2)),
        maxAbnormalTime: item.maxAbnormalTime,
      };
    })
    .sort((a, b) => {
      if (b.abnormalCount !== a.abnormalCount) {
        return b.abnormalCount - a.abnormalCount;
      }
      return b.maxAbnormalDuration - a.maxAbnormalDuration;
    });
}

function buildQueryTimeRangeText(startTime, endTime) {
  const normalizedStart = String(startTime || '').trim();
  const normalizedEnd = String(endTime || '').trim();
  if (normalizedStart && normalizedEnd) {
    return `${normalizedStart} ~ ${normalizedEnd}`;
  }
  return normalizedStart || normalizedEnd || '-';
}

function buildPeriodSummaryGroupKey(country = '', site = '', brand = '') {
  return [country || '', site || '', brand || ''].join('|');
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

class MonitorHistory {
  static getInsertSql() {
    return `INSERT INTO monitor_history
       (variant_group_id, variant_group_name, asin_id, asin_code, asin_name, site_snapshot, brand_snapshot, check_type, country, is_broken, check_time, check_result)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  }

  static buildInsertParams(data = {}) {
    return [
      data.variantGroupId || null,
      data.variantGroupName || null,
      data.asinId || null,
      data.asinCode || null,
      data.asinName || null,
      data.siteSnapshot || null,
      data.brandSnapshot || null,
      data.checkType || 'GROUP',
      data.country || null,
      data.isBroken ? 1 : 0,
      data.checkTime || new Date(),
      data.checkResult ? JSON.stringify(data.checkResult) : null,
    ];
  }

  static invalidateCaches() {
    cacheService.deleteByPrefix('monitorHistoryCount:');
    void cacheService.deleteByPrefixAsync('monitorHistoryCount:');
    cacheService.deleteByPrefix('statusChangesCount:');
    void cacheService.deleteByPrefixAsync('statusChangesCount:');
    void analyticsCacheService.deleteByPrefix('overallStatistics:');
    void analyticsCacheService.deleteByPrefix('peakHoursStatistics:');
    void analyticsCacheService.deleteByPrefix('statisticsByTime:');
    void analyticsCacheService.deleteByPrefix('allCountriesSummary:');
    void analyticsCacheService.deleteByPrefix('regionSummary:');
    void analyticsCacheService.deleteByPrefix('periodSummary:');
    void analyticsCacheService.deleteByPrefix('asinStatisticsByCountry:');
    void analyticsCacheService.deleteByPrefix('asinStatisticsByVariantGroup:');
    analyticsCacheService.deleteByPrefix('statisticsByTime:');
    analyticsCacheService.deleteByPrefix('allCountriesSummary:');
    analyticsCacheService.deleteByPrefix('regionSummary:');
    analyticsCacheService.deleteByPrefix('periodSummary:');
    analyticsCacheService.deleteByPrefix('asinStatisticsByCountry:');
    analyticsCacheService.deleteByPrefix('asinStatisticsByVariantGroup:');
  }

  // 查询监控历史列表
  static async findAll(params = {}) {
    const {
      variantGroupId = '',
      asinId = '',
      asin = '',
      variantGroupName = '',
      asinName = '',
      asinType = '',
      country = '',
      checkType = '',
      isBroken = '',
      startTime = '',
      endTime = '',
      current = 1,
      pageSize = 10,
      skipCount = false,
    } = params;
    const normalizedAsinType = asinType ? String(asinType).trim() : '';
    const normalizedCheckType = checkType ? String(checkType).trim() : '';

    let sql = `
      SELECT
        mh.id,
        mh.variant_group_id,
        mh.asin_id,
        mh.check_type,
        mh.country,
        mh.is_broken,
        mh.check_time,
        mh.check_result,
        mh.notification_sent,
        mh.create_time,
        COALESCE(mh.variant_group_name, vg.name) as variant_group_name,
        COALESCE(mh.asin_code, a.asin) as asin,
        COALESCE(mh.asin_name, a.name) as asin_name,
        a.asin_type as asin_type
      FROM monitor_history mh
      LEFT JOIN variant_groups vg ON vg.id = mh.variant_group_id
      LEFT JOIN asins a ON a.id = mh.asin_id
      WHERE 1=1
    `;
    const conditions = [];

    if (variantGroupId) {
      sql += ` AND mh.variant_group_id = ?`;
      conditions.push(variantGroupId);
    }

    if (asinId) {
      sql += ` AND mh.asin_id = ?`;
      conditions.push(asinId);
    }

    if (asin) {
      // 支持多ASIN查询：如果asin是数组，使用IN查询；否则使用LIKE查询（向后兼容）
      if (Array.isArray(asin) && asin.length > 0) {
        const placeholders = asin.map(() => '?').join(',');
        sql += ` AND (COALESCE(mh.asin_code, a.asin) IN (${placeholders}))`;
        conditions.push(...asin);
      } else if (typeof asin === 'string') {
        // 优先在快照字段中搜索，如果没有则搜索关联表
        sql += ` AND (COALESCE(mh.asin_code, a.asin) LIKE ?)`;
        conditions.push(`%${asin}%`);
      }
    }

    if (variantGroupName) {
      sql += ` AND (COALESCE(mh.variant_group_name, vg.name) LIKE ?)`;
      conditions.push(`%${variantGroupName}%`);
    }

    if (asinName) {
      sql += ` AND (COALESCE(mh.asin_name, a.name) LIKE ?)`;
      conditions.push(`%${asinName}%`);
    }

    if (normalizedAsinType) {
      if (normalizedAsinType === '1' || normalizedAsinType === 'MAIN_LINK') {
        sql += ` AND a.asin_type IN ('1', 'MAIN_LINK')`;
      } else if (
        normalizedAsinType === '2' ||
        normalizedAsinType === 'SUB_REVIEW'
      ) {
        sql += ` AND a.asin_type IN ('2', 'SUB_REVIEW')`;
      } else {
        sql += ` AND a.asin_type = ?`;
        conditions.push(normalizedAsinType);
      }
    }

    if (country) {
      if (country === 'EU') {
        // EU汇总：包含所有欧洲国家
        sql += ` AND mh.country IN ('UK', 'DE', 'FR', 'IT', 'ES')`;
      } else {
        sql += ` AND mh.country = ?`;
        conditions.push(country);
      }
    }

    if (normalizedCheckType) {
      sql += ` AND mh.check_type = ?`;
      conditions.push(normalizedCheckType);
    }

    if (isBroken !== '') {
      sql += ` AND mh.is_broken = ?`;
      conditions.push(isBroken === '1' || isBroken === 1 ? 1 : 0);
    }

    if (startTime) {
      sql += ` AND mh.check_time >= ?`;
      conditions.push(startTime);
    }

    if (endTime) {
      sql += ` AND mh.check_time <= ?`;
      conditions.push(endTime);
    }

    let total = null;
    if (!skipCount) {
      const countKey = `monitorHistoryCount:${variantGroupId || 'ALL'}:${
        asinId || 'ALL'
      }:${asin || 'ALL'}:${variantGroupName || 'ALL'}:${asinName || 'ALL'}:${
        normalizedAsinType || 'ALL'
      }:${country || 'ALL'}:${normalizedCheckType || 'ALL'}:${
        isBroken || 'ALL'
      }:${startTime || 'ALL'}:${endTime || 'ALL'}`;
      total = await cacheService.getAsync(countKey);
      if (total === null) {
        // COUNT查询必须和列表查询保持同样的筛选语义，否则分页总数可能不准确
        let countSql = `SELECT COUNT(*) as total FROM monitor_history mh`;
        if (variantGroupName) {
          countSql += ` LEFT JOIN variant_groups vg ON vg.id = mh.variant_group_id`;
        }
        if (asin || asinName || normalizedAsinType) {
          countSql += ` LEFT JOIN asins a ON a.id = mh.asin_id`;
        }
        countSql += ` WHERE 1=1`;
        const countConditions = [];

        if (variantGroupId) {
          countSql += ` AND mh.variant_group_id = ?`;
          countConditions.push(variantGroupId);
        }

        if (asinId) {
          countSql += ` AND mh.asin_id = ?`;
          countConditions.push(asinId);
        }

        if (asin) {
          // 与列表查询保持一致：优先快照字段，缺失时回退到关联表
          if (Array.isArray(asin) && asin.length > 0) {
            const placeholders = asin.map(() => '?').join(',');
            countSql += ` AND (COALESCE(mh.asin_code, a.asin) IN (${placeholders}))`;
            countConditions.push(...asin);
          } else if (typeof asin === 'string') {
            countSql += ` AND (COALESCE(mh.asin_code, a.asin) LIKE ?)`;
            countConditions.push(`%${asin}%`);
          }
        }

        if (variantGroupName) {
          countSql += ` AND (COALESCE(mh.variant_group_name, vg.name) LIKE ?)`;
          countConditions.push(`%${variantGroupName}%`);
        }

        if (asinName) {
          countSql += ` AND (COALESCE(mh.asin_name, a.name) LIKE ?)`;
          countConditions.push(`%${asinName}%`);
        }

        if (normalizedAsinType) {
          if (
            normalizedAsinType === '1' ||
            normalizedAsinType === 'MAIN_LINK'
          ) {
            countSql += ` AND a.asin_type IN ('1', 'MAIN_LINK')`;
          } else if (
            normalizedAsinType === '2' ||
            normalizedAsinType === 'SUB_REVIEW'
          ) {
            countSql += ` AND a.asin_type IN ('2', 'SUB_REVIEW')`;
          } else {
            countSql += ` AND a.asin_type = ?`;
            countConditions.push(normalizedAsinType);
          }
        }

        if (country) {
          if (country === 'EU') {
            countSql += ` AND mh.country IN ('UK', 'DE', 'FR', 'IT', 'ES')`;
          } else {
            countSql += ` AND mh.country = ?`;
            countConditions.push(country);
          }
        }

        if (normalizedCheckType) {
          countSql += ` AND mh.check_type = ?`;
          countConditions.push(normalizedCheckType);
        }

        if (isBroken !== '') {
          countSql += ` AND mh.is_broken = ?`;
          countConditions.push(isBroken === '1' || isBroken === 1 ? 1 : 0);
        }

        if (startTime) {
          countSql += ` AND mh.check_time >= ?`;
          countConditions.push(startTime);
        }

        if (endTime) {
          countSql += ` AND mh.check_time <= ?`;
          countConditions.push(endTime);
        }

        const countResult = await query(countSql, countConditions);
        total = countResult[0]?.total || 0;
        await cacheService.setAsync(countKey, total, 60 * 1000);
      } else {
        logger.info('MonitorHistory.findAll 使用缓存总数:', countKey);
      }
    }

    // 分页 - LIMIT 和 OFFSET 不能使用参数绑定，必须直接拼接（确保是整数）
    const offset = (Number(current) - 1) * Number(pageSize);
    const limit = Number(pageSize);
    sql += ` ORDER BY mh.check_time DESC, mh.id DESC LIMIT ${limit} OFFSET ${offset}`;

    const list = await query(sql, conditions);

    // 转换字段名：数据库下划线命名 -> 前端驼峰命名
    const formattedList = list.map((item) => ({
      ...item,
      checkTime: item.check_time,
      checkType: item.check_type,
      isBroken: item.is_broken,
      checkResult: item.check_result,
      notificationSent: item.notification_sent,
      variantGroupName: item.variant_group_name,
      asinName: item.asin_name,
      asinType: item.asin_type,
      createTime: item.create_time,
    }));

    return {
      list: formattedList,
      total: skipCount ? null : total,
      current: Number(current),
      pageSize: Number(pageSize),
    };
  }

  // 根据ID查询监控历史
  static async findById(id) {
    const [history] = await query(
      `SELECT
        mh.id,
        mh.variant_group_id,
        mh.asin_id,
        mh.check_type,
        mh.country,
        mh.is_broken,
        mh.check_time,
        mh.check_result,
        mh.notification_sent,
        mh.create_time,
        COALESCE(mh.variant_group_name, vg.name) as variant_group_name,
        COALESCE(mh.asin_code, a.asin) as asin,
        COALESCE(mh.asin_name, a.name) as asin_name,
        a.asin_type as asin_type
      FROM monitor_history mh
      LEFT JOIN variant_groups vg ON vg.id = mh.variant_group_id
      LEFT JOIN asins a ON a.id = mh.asin_id
      WHERE mh.id = ?`,
      [id],
    );

    if (history) {
      // 转换字段名：数据库下划线命名 -> 前端驼峰命名
      return {
        ...history,
        checkTime: history.check_time,
        checkType: history.check_type,
        isBroken: history.is_broken,
        checkResult: history.check_result,
        notificationSent: history.notification_sent,
        variantGroupName: history.variant_group_name,
        asinName: history.asin_name,
        asinType: history.asin_type,
        createTime: history.create_time,
      };
    }
    return history;
  }

  // 创建监控历史记录
  static async create(data) {
    const result = await query(
      MonitorHistory.getInsertSql(),
      MonitorHistory.buildInsertParams(data),
    );

    MonitorHistory.invalidateCaches();
    return this.findById(result.insertId);
  }

  static async bulkCreate(entries = []) {
    if (!Array.isArray(entries) || entries.length === 0) {
      return;
    }

    const placeholders = [];
    const values = [];
    for (const entry of entries) {
      placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      values.push(...MonitorHistory.buildInsertParams(entry));
    }

    const sql = `INSERT INTO monitor_history
      (variant_group_id, variant_group_name, asin_id, asin_code, asin_name, site_snapshot, brand_snapshot, check_type, country, is_broken, check_time, check_result)
      VALUES ${placeholders.join(', ')}`;

    await query(sql, values);
    MonitorHistory.invalidateCaches();
  }

  // 获取异常时长统计
  static async getAbnormalDurationStatistics(params = {}) {
    const {
      asinIds = [],
      asinCodes = [],
      variantGroupId = '',
      country = '',
      startTime = '',
      endTime = '',
      includeSeries = '1',
      asinType = '',
      asinName = '',
      variantGroupName = '',
    } = params;
    const normalizedAsinIds = Array.isArray(asinIds)
      ? asinIds
      : String(asinIds || '')
          .split(',')
          .map((item) => item.trim())
          .filter((item) => item.length > 0);
    const normalizedAsinCodes = Array.isArray(asinCodes)
      ? asinCodes
      : String(asinCodes || '')
          .split(',')
          .map((item) => item.trim())
          .filter((item) => item.length > 0);
    const normalizedAsinType = asinType ? String(asinType).trim() : '';
    const shouldIncludeSeries = String(includeSeries || '1') !== '0';

    const queryStartDate = parseDateTimeInput(startTime);
    const queryEndDate = parseDateTimeInput(endTime);

    // 根据时间范围自动选择时间粒度
    let groupBy = 'day';
    let groupByExpr = 'DATE_FORMAT(mh.check_time, "%Y-%m-%d")';
    let defaultBucketDurationHours = 24;

    if (queryStartDate && queryEndDate && queryEndDate >= queryStartDate) {
      const diffHours =
        (queryEndDate.getTime() - queryStartDate.getTime()) / (1000 * 60 * 60);
      if (diffHours <= 7 * 24) {
        groupBy = 'hour';
        groupByExpr = 'DATE_FORMAT(mh.check_time, "%Y-%m-%d %H:00:00")';
        defaultBucketDurationHours = 1;
      } else if (diffHours <= 30 * 24) {
        groupBy = 'day';
        groupByExpr = 'DATE_FORMAT(mh.check_time, "%Y-%m-%d")';
        defaultBucketDurationHours = 24;
      } else {
        groupBy = 'week';
        groupByExpr =
          'CONCAT(SUBSTRING(YEARWEEK(mh.check_time, 3), 1, 4), "-", LPAD(SUBSTRING(YEARWEEK(mh.check_time, 3), 5), 2, "0"))';
        defaultBucketDurationHours = 24 * 7;
      }
    }

    // 构建WHERE条件
    let whereClause = 'WHERE 1=1';
    const conditions = [];

    if (variantGroupId) {
      whereClause += ` AND mh.variant_group_id = ?`;
      conditions.push(variantGroupId);
    }

    if (normalizedAsinIds.length > 0) {
      const placeholders = normalizedAsinIds.map(() => '?').join(',');
      whereClause += ` AND mh.asin_id IN (${placeholders})`;
      conditions.push(...normalizedAsinIds);
    }

    if (normalizedAsinCodes.length > 0) {
      const placeholders = normalizedAsinCodes.map(() => '?').join(',');
      whereClause += ` AND COALESCE(mh.asin_code, a.asin) IN (${placeholders})`;
      conditions.push(...normalizedAsinCodes);
    }

    if (variantGroupName) {
      whereClause += ` AND (COALESCE(mh.variant_group_name, vg.name) LIKE ?)`;
      conditions.push(`%${variantGroupName}%`);
    }

    if (asinName) {
      whereClause += ` AND (COALESCE(mh.asin_name, a.name) LIKE ?)`;
      conditions.push(`%${asinName}%`);
    }

    if (normalizedAsinType) {
      if (normalizedAsinType === '1' || normalizedAsinType === 'MAIN_LINK') {
        whereClause += ` AND a.asin_type IN ('1', 'MAIN_LINK')`;
      } else if (
        normalizedAsinType === '2' ||
        normalizedAsinType === 'SUB_REVIEW'
      ) {
        whereClause += ` AND a.asin_type IN ('2', 'SUB_REVIEW')`;
      } else {
        whereClause += ` AND a.asin_type = ?`;
        conditions.push(normalizedAsinType);
      }
    }

    if (country) {
      if (country === 'EU') {
        whereClause += ` AND COALESCE(mh.country, a.country) IN ('UK', 'DE', 'FR', 'IT', 'ES')`;
      } else {
        whereClause += ` AND COALESCE(mh.country, a.country) = ?`;
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

    const sql = `
      SELECT
        ${groupByExpr} as time_period,
        mh.asin_id,
        COALESCE(mh.asin_code, a.asin) as asin,
        COALESCE(mh.country, a.country) as country,
        COUNT(*) as total_checks,
        SUM(CASE WHEN mh.is_broken = 1 THEN 1 ELSE 0 END) as broken_count
      FROM monitor_history mh
      LEFT JOIN asins a ON a.id = mh.asin_id
      LEFT JOIN variant_groups vg ON vg.id = mh.variant_group_id
      ${whereClause}
      AND mh.asin_id IS NOT NULL
      GROUP BY ${groupByExpr}, mh.asin_id, COALESCE(mh.asin_code, a.asin), COALESCE(mh.country, a.country)
      ORDER BY time_period ASC, country ASC, mh.asin_id ASC
    `;

    const results = await query(sql, conditions);

    // 处理数据：桶占比法（异常时长 = 桶时长 × 异常次数/总检查次数）
    const processedData = results.map((row) => {
      const brokenCount = Number(row.broken_count || 0);
      const totalChecks = Number(row.total_checks || 0);
      const { bucketStart, bucketEnd } = getBucketRangeByPeriod(
        row.time_period,
        groupBy,
      );

      let bucketDurationHours = defaultBucketDurationHours;
      if (bucketStart && bucketEnd) {
        if (queryStartDate && queryEndDate) {
          bucketDurationHours = calculateOverlapHours(
            bucketStart,
            bucketEnd,
            queryStartDate,
            queryEndDate,
          );
        } else {
          bucketDurationHours =
            (bucketEnd.getTime() - bucketStart.getTime()) / (1000 * 60 * 60);
        }
      }
      bucketDurationHours = clampValue(
        bucketDurationHours,
        0,
        Number.MAX_VALUE,
      );

      const abnormalRatioRaw =
        totalChecks > 0 ? clampValue(brokenCount / totalChecks, 0, 1) : 0;
      const abnormalDuration = clampValue(
        bucketDurationHours * abnormalRatioRaw,
        0,
        bucketDurationHours,
      );

      return {
        timePeriod: row.time_period,
        asinId: row.asin_id,
        asin: row.asin,
        country: row.country,
        abnormalDuration: Number(abnormalDuration.toFixed(4)),
        totalDuration: Number(bucketDurationHours.toFixed(4)),
        abnormalRatio: Number((abnormalRatioRaw * 100).toFixed(2)),
        brokenCount,
        totalChecks,
      };
    });

    const summary = buildAbnormalDurationSummary(
      processedData,
      startTime,
      endTime,
    );

    // 仅返回汇总，不返回序列明细（提升性能）
    if (!shouldIncludeSeries) {
      return {
        timeGranularity: groupBy,
        data: [],
        summary,
      };
    }

    // 需要序列时才做补零
    if (queryStartDate && queryEndDate) {
      const asinSet = new Set();
      processedData.forEach((item) => {
        if (item.asinId) {
          asinSet.add(
            JSON.stringify({
              asinId: item.asinId,
              asin: item.asin,
              country: item.country || '',
            }),
          );
        }
      });

      const timeSeries = [];
      const current = new Date(queryStartDate);
      if (groupBy === 'hour') {
        current.setMinutes(0, 0, 0);
      } else if (groupBy === 'day') {
        current.setHours(0, 0, 0, 0);
      } else if (groupBy === 'week') {
        const { year, week } = getISOWeekInfo(current);
        const weekStart = getISOWeekStartDate(year, week);
        current.setTime(weekStart.getTime());
      }

      while (current <= queryEndDate) {
        if (groupBy === 'hour') {
          timeSeries.push(formatDateToHourText(current));
          current.setHours(current.getHours() + 1);
        } else if (groupBy === 'day') {
          timeSeries.push(formatDateToDayText(current));
          current.setDate(current.getDate() + 1);
        } else if (groupBy === 'week') {
          timeSeries.push(formatISOWeekTextFromDate(current));
          current.setDate(current.getDate() + 7);
        }
      }

      const existingDataMap = new Map();
      processedData.forEach((item) => {
        existingDataMap.set(
          `${item.timePeriod}|${item.asinId}|${item.country || ''}`,
          item,
        );
      });

      const filledData = [];
      asinSet.forEach((asinKey) => {
        const { asinId, asin, country: asinCountry } = JSON.parse(asinKey);
        timeSeries.forEach((timePeriod) => {
          const dataKey = `${timePeriod}|${asinId}|${asinCountry || ''}`;
          const existingData = existingDataMap.get(dataKey);
          if (existingData) {
            filledData.push(existingData);
            return;
          }

          const { bucketStart, bucketEnd } = getBucketRangeByPeriod(
            timePeriod,
            groupBy,
          );
          const bucketDurationHours =
            bucketStart && bucketEnd
              ? calculateOverlapHours(
                  bucketStart,
                  bucketEnd,
                  queryStartDate,
                  queryEndDate,
                )
              : defaultBucketDurationHours;

          filledData.push({
            timePeriod,
            asinId,
            asin,
            country: asinCountry,
            abnormalDuration: 0,
            totalDuration: Number(bucketDurationHours.toFixed(4)),
            abnormalRatio: 0,
            brokenCount: 0,
            totalChecks: 0,
          });
        });
      });

      // 没有ASIN时返回空序列占位（兼容旧逻辑）
      if (filledData.length === 0 && timeSeries.length > 0) {
        timeSeries.forEach((timePeriod) => {
          const { bucketStart, bucketEnd } = getBucketRangeByPeriod(
            timePeriod,
            groupBy,
          );
          const bucketDurationHours =
            bucketStart && bucketEnd
              ? calculateOverlapHours(
                  bucketStart,
                  bucketEnd,
                  queryStartDate,
                  queryEndDate,
                )
              : defaultBucketDurationHours;
          filledData.push({
            timePeriod,
            asinId: null,
            asin: null,
            country: null,
            abnormalDuration: 0,
            totalDuration: Number(bucketDurationHours.toFixed(4)),
            abnormalRatio: 0,
            brokenCount: 0,
            totalChecks: 0,
          });
        });
      }

      return {
        timeGranularity: groupBy,
        data: filledData,
        summary,
      };
    }

    return {
      timeGranularity: groupBy,
      data: processedData,
      summary,
    };
  }

  // 更新监控历史记录的通知状态
  // 更新指定国家、检查时间段内，异常（is_broken = 1）的监控历史记录的通知状态
  static async updateNotificationStatusByRange(
    country,
    startTime,
    endTime,
    notificationSent = 1,
  ) {
    if (!country || !startTime || !endTime) {
      return 0;
    }

    const startDate =
      startTime instanceof Date ? startTime : new Date(startTime);
    const endDate = endTime instanceof Date ? endTime : new Date(endTime);

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return 0;
    }

    const rangeStart = startDate <= endDate ? startDate : endDate;
    const rangeEnd = startDate <= endDate ? endDate : startDate;
    const normalizedRangeStart = new Date(rangeStart);
    const normalizedRangeEnd = new Date(rangeEnd);

    normalizedRangeStart.setMilliseconds(0);
    normalizedRangeEnd.setMilliseconds(0);

    const result = await query(
      `UPDATE monitor_history
       SET notification_sent = ?
       WHERE country = ?
         AND check_time >= ?
         AND check_time <= ?
         AND is_broken = 1
         AND notification_sent = 0`,
      [
        notificationSent ? 1 : 0,
        country,
        formatDateToSqlText(normalizedRangeStart),
        formatDateToSqlText(normalizedRangeEnd),
      ],
    );

    cacheService.deleteByPrefix('monitorHistoryCount:');
    void cacheService.deleteByPrefixAsync('monitorHistoryCount:');

    return result.affectedRows || 0;
  }

  // 兼容旧调用：按单个检查时间点更新通知状态
  static async updateNotificationStatus(
    country,
    checkTime,
    notificationSent = 1,
  ) {
    // 将 checkTime 转换为 Date 对象（如果还不是）
    const checkTimeDate =
      checkTime instanceof Date ? checkTime : new Date(checkTime);

    // 计算时间范围：从检查时间前1分钟到后2分钟（允许一定的误差）
    const timeStart = new Date(checkTimeDate.getTime() - 60 * 1000); // 前1分钟
    const timeEnd = new Date(checkTimeDate.getTime() + 2 * 60 * 1000); // 后2分钟

    return await MonitorHistory.updateNotificationStatusByRange(
      country,
      timeStart,
      timeEnd,
      notificationSent,
    );
  }

  // 查询ASIN状态变动记录
  // 使用窗口函数 LAG 来识别状态变化
  static async findStatusChanges(params = {}) {
    const {
      variantGroupId = '',
      asinId = '',
      asin = '',
      variantGroupName = '',
      asinName = '',
      asinType = '',
      country = '',
      checkType = '',
      startTime = '',
      endTime = '',
      current = 1,
      pageSize = 10,
      skipCount = false,
    } = params;
    const normalizedAsinType = asinType ? String(asinType).trim() : '';
    const includeAsinRowsForGroupFilter =
      checkType === 'GROUP' && (variantGroupId || variantGroupName);
    const effectiveCheckType = includeAsinRowsForGroupFilter ? '' : checkType;

    // 构建基础查询，使用窗口函数识别状态变化
    let sql = `
      WITH status_history AS (
        SELECT
          mh.id,
          mh.variant_group_id,
          mh.asin_id,
          mh.check_type,
          mh.country,
          mh.is_broken,
          mh.check_time,
          mh.check_result,
          mh.notification_sent,
          mh.create_time,
          COALESCE(mh.variant_group_name, vg.name) as variant_group_name,
          COALESCE(mh.asin_code, a.asin) as asin,
          COALESCE(mh.asin_name, a.name) as asin_name,
          a.asin_type as asin_type,
          LAG(mh.is_broken) OVER (
            PARTITION BY mh.asin_id, mh.country
            ORDER BY mh.check_time, mh.id
          ) as prev_is_broken
        FROM monitor_history mh
        LEFT JOIN variant_groups vg ON vg.id = mh.variant_group_id
        LEFT JOIN asins a ON a.id = mh.asin_id
        WHERE 1=1
    `;
    const conditions = [];

    if (variantGroupId) {
      sql += ` AND mh.variant_group_id = ?`;
      conditions.push(variantGroupId);
    }

    if (asinId) {
      sql += ` AND mh.asin_id = ?`;
      conditions.push(asinId);
    }

    if (asin) {
      if (Array.isArray(asin) && asin.length > 0) {
        const placeholders = asin.map(() => '?').join(',');
        sql += ` AND (COALESCE(mh.asin_code, a.asin) IN (${placeholders}))`;
        conditions.push(...asin);
      } else if (typeof asin === 'string') {
        sql += ` AND (COALESCE(mh.asin_code, a.asin) LIKE ?)`;
        conditions.push(`%${asin}%`);
      }
    }

    if (variantGroupName) {
      sql += ` AND (COALESCE(mh.variant_group_name, vg.name) LIKE ?)`;
      conditions.push(`%${variantGroupName}%`);
    }

    if (asinName) {
      sql += ` AND (COALESCE(mh.asin_name, a.name) LIKE ?)`;
      conditions.push(`%${asinName}%`);
    }

    if (normalizedAsinType) {
      if (normalizedAsinType === '1' || normalizedAsinType === 'MAIN_LINK') {
        sql += ` AND a.asin_type IN ('1', 'MAIN_LINK')`;
      } else if (
        normalizedAsinType === '2' ||
        normalizedAsinType === 'SUB_REVIEW'
      ) {
        sql += ` AND a.asin_type IN ('2', 'SUB_REVIEW')`;
      } else {
        sql += ` AND a.asin_type = ?`;
        conditions.push(normalizedAsinType);
      }
    }

    if (country) {
      if (country === 'EU') {
        sql += ` AND mh.country IN ('UK', 'DE', 'FR', 'IT', 'ES')`;
      } else {
        sql += ` AND mh.country = ?`;
        conditions.push(country);
      }
    }

    if (effectiveCheckType) {
      sql += ` AND mh.check_type = ?`;
      conditions.push(effectiveCheckType);
    }

    if (startTime) {
      sql += ` AND mh.check_time >= ?`;
      conditions.push(startTime);
    }

    if (endTime) {
      sql += ` AND mh.check_time <= ?`;
      conditions.push(endTime);
    }

    // 只选择状态发生变化的记录（排除第一条记录，因为 prev_is_broken 为 NULL）
    sql += `
      )
      SELECT * FROM status_history
      WHERE prev_is_broken IS NOT NULL
        AND prev_is_broken != is_broken
      ORDER BY check_time DESC, id DESC
    `;

    let total = null;
    if (!skipCount) {
      // 计算总数（先查询总数）
      const countKey = `statusChangesCount:${variantGroupId || 'ALL'}:${
        asinId || 'ALL'
      }:${asin || 'ALL'}:${variantGroupName || 'ALL'}:${asinName || 'ALL'}:${
        normalizedAsinType || 'ALL'
      }:${country || 'ALL'}:${effectiveCheckType || 'ALL'}:${
        startTime || 'ALL'
      }:${endTime || 'ALL'}`;
      total = await cacheService.getAsync(countKey);
      if (total === null) {
        let countSql = `
          WITH status_history AS (
            SELECT
              mh.id,
              mh.asin_id,
              mh.country,
              mh.is_broken,
              LAG(mh.is_broken) OVER (
                PARTITION BY mh.asin_id, mh.country
                ORDER BY mh.check_time, mh.id
              ) as prev_is_broken
            FROM monitor_history mh
        `;
        if (variantGroupName) {
          countSql += ` LEFT JOIN variant_groups vg ON vg.id = mh.variant_group_id`;
        }
        if (asin || asinName || normalizedAsinType) {
          countSql += ` LEFT JOIN asins a ON a.id = mh.asin_id`;
        }
        countSql += ` WHERE 1=1`;
        const countConditions = [];

        if (variantGroupId) {
          countSql += ` AND mh.variant_group_id = ?`;
          countConditions.push(variantGroupId);
        }

        if (asinId) {
          countSql += ` AND mh.asin_id = ?`;
          countConditions.push(asinId);
        }

        if (asin) {
          if (Array.isArray(asin) && asin.length > 0) {
            const placeholders = asin.map(() => '?').join(',');
            countSql += ` AND (COALESCE(mh.asin_code, a.asin) IN (${placeholders}))`;
            countConditions.push(...asin);
          } else if (typeof asin === 'string') {
            countSql += ` AND (COALESCE(mh.asin_code, a.asin) LIKE ?)`;
            countConditions.push(`%${asin}%`);
          }
        }

        if (variantGroupName) {
          countSql += ` AND (COALESCE(mh.variant_group_name, vg.name) LIKE ?)`;
          countConditions.push(`%${variantGroupName}%`);
        }

        if (asinName) {
          countSql += ` AND (COALESCE(mh.asin_name, a.name) LIKE ?)`;
          countConditions.push(`%${asinName}%`);
        }

        if (normalizedAsinType) {
          if (
            normalizedAsinType === '1' ||
            normalizedAsinType === 'MAIN_LINK'
          ) {
            countSql += ` AND a.asin_type IN ('1', 'MAIN_LINK')`;
          } else if (
            normalizedAsinType === '2' ||
            normalizedAsinType === 'SUB_REVIEW'
          ) {
            countSql += ` AND a.asin_type IN ('2', 'SUB_REVIEW')`;
          } else {
            countSql += ` AND a.asin_type = ?`;
            countConditions.push(normalizedAsinType);
          }
        }

        if (country) {
          if (country === 'EU') {
            countSql += ` AND mh.country IN ('UK', 'DE', 'FR', 'IT', 'ES')`;
          } else {
            countSql += ` AND mh.country = ?`;
            countConditions.push(country);
          }
        }

        if (effectiveCheckType) {
          countSql += ` AND mh.check_type = ?`;
          countConditions.push(effectiveCheckType);
        }

        if (startTime) {
          countSql += ` AND mh.check_time >= ?`;
          countConditions.push(startTime);
        }

        if (endTime) {
          countSql += ` AND mh.check_time <= ?`;
          countConditions.push(endTime);
        }

        countSql += `
          )
          SELECT COUNT(*) as total FROM status_history
          WHERE prev_is_broken IS NOT NULL
            AND prev_is_broken != is_broken
        `;

        const countResult = await query(countSql, countConditions);
        total = countResult[0]?.total || 0;
        await cacheService.setAsync(countKey, total, 60 * 1000);
      }
    }

    // 分页
    const offset = (Number(current) - 1) * Number(pageSize);
    const limit = Number(pageSize);
    sql += ` LIMIT ${limit} OFFSET ${offset}`;

    const list = await query(sql, conditions);

    // 转换字段名
    const formattedList = list.map((item) => ({
      ...item,
      checkTime: item.check_time,
      checkType: item.check_type,
      isBroken: item.is_broken,
      checkResult: item.check_result,
      prevIsBroken: item.prev_is_broken,
      notificationSent: item.notification_sent,
      variantGroupName: item.variant_group_name,
      asinName: item.asin_name,
      asinType: item.asin_type,
      createTime: item.create_time,
      statusChange: item.prev_is_broken === 0 ? '正常→异常' : '异常→正常',
    }));

    return {
      list: formattedList,
      total: skipCount ? null : total,
      current: Number(current),
      pageSize: Number(pageSize),
    };
  }

  // 流式查询状态变动记录（用于大数据量导出）
  // 使用分页批量查询，避免一次性加载所有数据
  static async findStatusChangesStream(params = {}, onRow, batchSize = 10000) {
    const {
      variantGroupId = '',
      asinId = '',
      asin = '',
      variantGroupName = '',
      asinName = '',
      asinType = '',
      country = '',
      checkType = '',
      startTime = '',
      endTime = '',
    } = params;
    const normalizedAsinType = asinType ? String(asinType).trim() : '';
    const includeAsinRowsForGroupFilter =
      checkType === 'GROUP' && (variantGroupId || variantGroupName);
    const effectiveCheckType = includeAsinRowsForGroupFilter ? '' : checkType;

    // 先获取总数
    const countKey = `statusChangesCount:${variantGroupId || 'ALL'}:${
      asinId || 'ALL'
    }:${asin || 'ALL'}:${variantGroupName || 'ALL'}:${asinName || 'ALL'}:${
      normalizedAsinType || 'ALL'
    }:${country || 'ALL'}:${effectiveCheckType || 'ALL'}:${
      startTime || 'ALL'
    }:${endTime || 'ALL'}`;
    let total = await cacheService.getAsync(countKey);

    if (total === null) {
      // 使用与 findStatusChanges 相同的计数逻辑
      let countSql = `
        WITH status_history AS (
          SELECT
            mh.id,
            mh.asin_id,
            mh.country,
            mh.is_broken,
            LAG(mh.is_broken) OVER (
              PARTITION BY mh.asin_id, mh.country
              ORDER BY mh.check_time, mh.id
            ) as prev_is_broken
          FROM monitor_history mh
      `;
      if (variantGroupName) {
        countSql += ` LEFT JOIN variant_groups vg ON vg.id = mh.variant_group_id`;
      }
      if (asin || asinName || normalizedAsinType) {
        countSql += ` LEFT JOIN asins a ON a.id = mh.asin_id`;
      }
      countSql += ` WHERE 1=1`;
      const countConditions = [];

      if (variantGroupId) {
        countSql += ` AND mh.variant_group_id = ?`;
        countConditions.push(variantGroupId);
      }

      if (asinId) {
        countSql += ` AND mh.asin_id = ?`;
        countConditions.push(asinId);
      }

      if (asin) {
        if (Array.isArray(asin) && asin.length > 0) {
          const placeholders = asin.map(() => '?').join(',');
          countSql += ` AND (COALESCE(mh.asin_code, a.asin) IN (${placeholders}))`;
          countConditions.push(...asin);
        } else if (typeof asin === 'string') {
          countSql += ` AND (COALESCE(mh.asin_code, a.asin) LIKE ?)`;
          countConditions.push(`%${asin}%`);
        }
      }

      if (variantGroupName) {
        countSql += ` AND (COALESCE(mh.variant_group_name, vg.name) LIKE ?)`;
        countConditions.push(`%${variantGroupName}%`);
      }

      if (asinName) {
        countSql += ` AND (COALESCE(mh.asin_name, a.name) LIKE ?)`;
        countConditions.push(`%${asinName}%`);
      }

      if (normalizedAsinType) {
        if (normalizedAsinType === '1' || normalizedAsinType === 'MAIN_LINK') {
          countSql += ` AND a.asin_type IN ('1', 'MAIN_LINK')`;
        } else if (
          normalizedAsinType === '2' ||
          normalizedAsinType === 'SUB_REVIEW'
        ) {
          countSql += ` AND a.asin_type IN ('2', 'SUB_REVIEW')`;
        } else {
          countSql += ` AND a.asin_type = ?`;
          countConditions.push(normalizedAsinType);
        }
      }

      if (country) {
        if (country === 'EU') {
          countSql += ` AND mh.country IN ('UK', 'DE', 'FR', 'IT', 'ES')`;
        } else {
          countSql += ` AND mh.country = ?`;
          countConditions.push(country);
        }
      }

      if (effectiveCheckType) {
        countSql += ` AND mh.check_type = ?`;
        countConditions.push(effectiveCheckType);
      }

      if (startTime) {
        countSql += ` AND mh.check_time >= ?`;
        countConditions.push(startTime);
      }

      if (endTime) {
        countSql += ` AND mh.check_time <= ?`;
        countConditions.push(endTime);
      }

      countSql += `
        )
        SELECT COUNT(*) as total FROM status_history
        WHERE prev_is_broken IS NOT NULL
          AND prev_is_broken != is_broken
      `;

      const countResult = await query(countSql, countConditions);
      total = countResult[0]?.total || 0;
      await cacheService.setAsync(countKey, total, 60 * 1000);
    }

    // 分页批量查询
    const totalPages = Math.ceil(total / batchSize);
    for (let page = 1; page <= totalPages; page++) {
      const offset = (page - 1) * batchSize;
      const limit = batchSize;

      let sql = `
        WITH status_history AS (
          SELECT
            mh.id,
            mh.variant_group_id,
            mh.asin_id,
            mh.check_type,
            mh.country,
            mh.is_broken,
            mh.check_time,
            mh.check_result,
            mh.notification_sent,
            mh.create_time,
            COALESCE(mh.variant_group_name, vg.name) as variant_group_name,
            COALESCE(mh.asin_code, a.asin) as asin,
            COALESCE(mh.asin_name, a.name) as asin_name,
            a.asin_type as asin_type,
            LAG(mh.is_broken) OVER (
              PARTITION BY mh.asin_id, mh.country
              ORDER BY mh.check_time, mh.id
            ) as prev_is_broken
          FROM monitor_history mh
          LEFT JOIN variant_groups vg ON vg.id = mh.variant_group_id
          LEFT JOIN asins a ON a.id = mh.asin_id
          WHERE 1=1
      `;
      const conditions = [];

      if (variantGroupId) {
        sql += ` AND mh.variant_group_id = ?`;
        conditions.push(variantGroupId);
      }

      if (asinId) {
        sql += ` AND mh.asin_id = ?`;
        conditions.push(asinId);
      }

      if (asin) {
        if (Array.isArray(asin) && asin.length > 0) {
          const placeholders = asin.map(() => '?').join(',');
          sql += ` AND (COALESCE(mh.asin_code, a.asin) IN (${placeholders}))`;
          conditions.push(...asin);
        } else if (typeof asin === 'string') {
          sql += ` AND (COALESCE(mh.asin_code, a.asin) LIKE ?)`;
          conditions.push(`%${asin}%`);
        }
      }

      if (variantGroupName) {
        sql += ` AND (COALESCE(mh.variant_group_name, vg.name) LIKE ?)`;
        conditions.push(`%${variantGroupName}%`);
      }

      if (asinName) {
        sql += ` AND (COALESCE(mh.asin_name, a.name) LIKE ?)`;
        conditions.push(`%${asinName}%`);
      }

      if (normalizedAsinType) {
        if (normalizedAsinType === '1' || normalizedAsinType === 'MAIN_LINK') {
          sql += ` AND a.asin_type IN ('1', 'MAIN_LINK')`;
        } else if (
          normalizedAsinType === '2' ||
          normalizedAsinType === 'SUB_REVIEW'
        ) {
          sql += ` AND a.asin_type IN ('2', 'SUB_REVIEW')`;
        } else {
          sql += ` AND a.asin_type = ?`;
          conditions.push(normalizedAsinType);
        }
      }

      if (country) {
        if (country === 'EU') {
          sql += ` AND mh.country IN ('UK', 'DE', 'FR', 'IT', 'ES')`;
        } else {
          sql += ` AND mh.country = ?`;
          conditions.push(country);
        }
      }

      if (effectiveCheckType) {
        sql += ` AND mh.check_type = ?`;
        conditions.push(effectiveCheckType);
      }

      if (startTime) {
        sql += ` AND mh.check_time >= ?`;
        conditions.push(startTime);
      }

      if (endTime) {
        sql += ` AND mh.check_time <= ?`;
        conditions.push(endTime);
      }

      sql += `
        )
        SELECT * FROM status_history
        WHERE prev_is_broken IS NOT NULL
          AND prev_is_broken != is_broken
        ORDER BY check_time DESC, id DESC
        LIMIT ${limit} OFFSET ${offset}
      `;

      const rows = await query(sql, conditions);

      // 处理每一行
      for (const row of rows) {
        const formattedRow = {
          ...row,
          checkTime: row.check_time,
          checkType: row.check_type,
          isBroken: row.is_broken,
          checkResult: row.check_result,
          prevIsBroken: row.prev_is_broken,
          notificationSent: row.notification_sent,
          variantGroupName: row.variant_group_name,
          asinName: row.asin_name,
          asinType: row.asin_type,
          createTime: row.create_time,
          statusChange: row.prev_is_broken === 0 ? '正常→异常' : '异常→正常',
        };
        await onRow(formattedRow);
      }
    }
  }
}

module.exports = MonitorHistory;
