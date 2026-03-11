const { query } = require('../config/database');
const cacheService = require('../services/cacheService');
const analyticsCacheService = require('../services/analyticsCacheService');
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

function resolveCachedAnalyticsResult(cached, includeMeta = false) {
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
    }),
  };
}

function finalizeAnalyticsResult(
  data,
  { includeMeta = false, source = 'raw', generatedAt = '' } = {},
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
    }),
  };
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
    void analyticsCacheService.deleteByPrefix('statisticsByTime:');
    void analyticsCacheService.deleteByPrefix('allCountriesSummary:');
    void analyticsCacheService.deleteByPrefix('regionSummary:');
    void analyticsCacheService.deleteByPrefix('periodSummary:');
    void analyticsCacheService.deleteByPrefix('asinStatisticsByCountry:');
    void analyticsCacheService.deleteByPrefix('asinStatisticsByVariantGroup:');
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

  // 获取统计信息
  static async getStatistics(params = {}) {
    const {
      variantGroupId = '',
      asinId = '',
      country = '',
      checkType = '',
      startTime = '',
      endTime = '',
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
        // EU汇总：包含所有欧洲国家
        sql += ` AND country IN ('UK', 'DE', 'FR', 'IT', 'ES')`;
      } else {
        sql += ` AND country = ?`;
        conditions.push(country);
      }
    }

    if (checkType) {
      if (checkType === 'ASIN') {
        sql += ` AND ${MonitorHistory.getAnalyticsAsinHistoryFilter(
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
      return response;
    }

    const sourceGranularity = MonitorHistory.getDurationSourceGranularity(
      'day',
      startTime,
      endTime,
    );
    const sourceConfig =
      MonitorHistory.getDurationSourceConfig(sourceGranularity);
    const queryStartDate = parseDateTimeInput(startTime);
    const queryEndDate = parseDateTimeInput(endTime);
    const isPeakCase = MonitorHistory.getPeakHourCase(
      'mh.country',
      'mh.check_time',
    );

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

    durationSql += ` AND ${MonitorHistory.getAnalyticsAsinHistoryFilter(
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
    const [durationMetrics = {}] = MonitorHistory.buildDurationRowsByGroup(
      durationRows,
      {
        sourceGranularity,
        targetGranularity: sourceGranularity,
        queryStartDate,
        queryEndDate,
        buildGroupKey: () => 'overall',
        buildGroupMeta: () => ({}),
      },
    );

    return {
      ...response,
      totalDurationHours: durationMetrics.totalDurationHours || 0,
      abnormalDurationHours: durationMetrics.abnormalDurationHours || 0,
      normalDurationHours: durationMetrics.normalDurationHours || 0,
      ratioAllAsin: durationMetrics.ratioAllAsin || 0,
      ratioAllTime: durationMetrics.ratioAllTime || 0,
    };
  }

  static getStatisticsByTimeGroupConfig(groupBy = 'day') {
    if (groupBy === 'hour') {
      return {
        rawPeriodExpr: 'DATE_FORMAT(check_time, "%Y-%m-%d %H:00:00")',
        aggPeriodExpr: "DATE_FORMAT(agg.time_slot, '%Y-%m-%d %H:00:00')",
        aggGranularity: 'hour',
        slotWhereFormat: '%Y-%m-%d %H:00:00',
      };
    }
    if (groupBy === 'week') {
      return {
        rawPeriodExpr: 'DATE_FORMAT(check_time, "%Y-%u")',
        aggPeriodExpr: "DATE_FORMAT(agg.time_slot, '%Y-%u')",
        aggGranularity: 'day',
        slotWhereFormat: '%Y-%m-%d 00:00:00',
      };
    }
    if (groupBy === 'month') {
      return {
        rawPeriodExpr: 'DATE_FORMAT(check_time, "%Y-%m")',
        aggPeriodExpr: "DATE_FORMAT(agg.time_slot, '%Y-%m')",
        aggGranularity: 'day',
        slotWhereFormat: '%Y-%m-%d 00:00:00',
      };
    }
    return {
      rawPeriodExpr: 'DATE_FORMAT(check_time, "%Y-%m-%d")',
      aggPeriodExpr: "DATE_FORMAT(agg.time_slot, '%Y-%m-%d')",
      aggGranularity: 'day',
      slotWhereFormat: '%Y-%m-%d 00:00:00',
    };
  }

  // Analytics 统一统计全部 ASIN 历史：
  // 只要是 ASIN 检查，且存在 asin_id 或 asin_code 其一即可纳入
  static getAnalyticsAsinHistoryFilter(
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

  static getDurationSourceGranularity(
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

  static getDurationSourceConfig(sourceGranularity = 'hour') {
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

  static formatSlotToTargetPeriod(slotPeriod, targetGranularity = 'day') {
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

  static getDurationBucketHours(
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

  static buildDurationRowsByGroup(
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

      const bucketDurationHours = MonitorHistory.getDurationBucketHours(
        slotPeriod,
        sourceGranularity,
        queryStartDate,
        queryEndDate,
      );
      if (bucketDurationHours <= 0) {
        return;
      }

      const targetPeriod = MonitorHistory.formatSlotToTargetPeriod(
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

  static async getDurationSourceRowsFromAgg(params = {}) {
    const {
      startTime = '',
      endTime = '',
      sourceGranularity = 'hour',
      country = '',
      site = '',
      brand = '',
    } = params;
    const config = MonitorHistory.getDurationSourceConfig(sourceGranularity);
    const useDimAgg = Boolean(site || brand);
    const aggTable = useDimAgg
      ? 'monitor_history_agg_dim'
      : 'monitor_history_agg';

    const isCovered = await MonitorHistory.isAggTableCoveringRange(
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

    return await query(sql, conditions);
  }

  static async getDurationSourceRowsFromRaw(params = {}) {
    const {
      startTime = '',
      endTime = '',
      sourceGranularity = 'hour',
      country = '',
      site = '',
      brand = '',
    } = params;
    const config = MonitorHistory.getDurationSourceConfig(sourceGranularity);
    const isPeakCase = MonitorHistory.getPeakHourCase(
      'mh.country',
      'mh.check_time',
    );

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

    whereClause += ` AND ${MonitorHistory.getAnalyticsAsinHistoryFilter(
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

    return await query(sql, conditions);
  }

  static async getVariantGroupDurationSourceRowsFromAgg(params = {}) {
    const {
      startTime = '',
      endTime = '',
      sourceGranularity = 'hour',
      country = '',
    } = params;
    const config = MonitorHistory.getDurationSourceConfig(sourceGranularity);
    const aggTable = 'monitor_history_agg_variant_group';

    const isCovered = await MonitorHistory.isAggTableCoveringRange(
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

    return await query(sql, conditions);
  }

  static async getVariantGroupDurationSourceRowsFromRaw(params = {}) {
    const {
      startTime = '',
      endTime = '',
      sourceGranularity = 'hour',
      country = '',
    } = params;
    const config = MonitorHistory.getDurationSourceConfig(sourceGranularity);
    const isPeakCase = MonitorHistory.getPeakHourCase(
      'mh.country',
      'mh.check_time',
    );

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

    whereClause += ` AND ${MonitorHistory.getAnalyticsAsinHistoryFilter(
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

    return await query(sql, conditions);
  }

  static async getStatisticsByTimeFromRaw(params = {}) {
    const {
      country = '',
      startTime = '',
      endTime = '',
      groupBy = 'day',
    } = params;
    const sourceGranularity =
      MonitorHistory.getRequestedSourceGranularity(params);
    const queryStartDate = parseDateTimeInput(startTime);
    const queryEndDate = parseDateTimeInput(endTime);
    const sourceRows = await MonitorHistory.getDurationSourceRowsFromRaw({
      startTime,
      endTime,
      sourceGranularity,
      country,
    });

    return MonitorHistory.buildDurationRowsByGroup(sourceRows, {
      sourceGranularity,
      targetGranularity: groupBy,
      queryStartDate,
      queryEndDate,
      buildGroupKey: (targetPeriod) => targetPeriod,
      buildGroupMeta: (targetPeriod) => ({
        time_period: targetPeriod,
      }),
    }).map((item) => ({
      ...item,
      total_asins: item.totalAsinsDedup,
      broken_asins: item.brokenAsinsDedup,
      asin_broken_rate: item.ratioAllAsin,
      normal_count: Math.max(0, item.totalChecks - item.brokenCount),
    }));
  }

  static async getStatisticsByTimeFromAgg(params = {}) {
    const {
      country = '',
      startTime = '',
      endTime = '',
      groupBy = 'day',
    } = params;
    const sourceGranularity =
      MonitorHistory.getRequestedSourceGranularity(params);
    const queryStartDate = parseDateTimeInput(startTime);
    const queryEndDate = parseDateTimeInput(endTime);
    const sourceRows = await MonitorHistory.getDurationSourceRowsFromAgg({
      startTime,
      endTime,
      sourceGranularity,
      country,
    });

    return MonitorHistory.buildDurationRowsByGroup(sourceRows, {
      sourceGranularity,
      targetGranularity: groupBy,
      queryStartDate,
      queryEndDate,
      buildGroupKey: (targetPeriod) => targetPeriod,
      buildGroupMeta: (targetPeriod) => ({
        time_period: targetPeriod,
      }),
    }).map((item) => ({
      ...item,
      total_asins: item.totalAsinsDedup,
      broken_asins: item.brokenAsinsDedup,
      asin_broken_rate: item.ratioAllAsin,
      normal_count: Math.max(0, item.totalChecks - item.brokenCount),
    }));
  }

  // 按时间分组统计
  static async getStatisticsByTime(params = {}) {
    const {
      country = '',
      startTime = '',
      endTime = '',
      groupBy = 'day',
      includeMeta = false,
      sourceGranularityOverride = '',
    } = params;

    const cacheKey = `statisticsByTime:${ANALYTICS_CACHE_VERSION}:${country}:${startTime}:${endTime}:${groupBy}:${
      sourceGranularityOverride || 'auto'
    }`;
    const ttlMs =
      Number(process.env.ANALYTICS_STATISTICS_BY_TIME_TTL_MS) || 300000;
    const cached = await analyticsCacheService.get(cacheKey);
    if (cached !== null) {
      return resolveCachedAnalyticsResult(cached, includeMeta);
    }

    const sourceGranularity =
      MonitorHistory.getRequestedSourceGranularity(params);
    let list = null;
    let source = 'raw';
    const useAgg =
      process.env.ANALYTICS_AGG_ENABLED !== '0' &&
      MonitorHistory.canUseAggForRange(sourceGranularity, startTime, endTime);

    if (useAgg) {
      try {
        const isCovered = await MonitorHistory.isAggTableCoveringRange(
          'monitor_history_agg',
          sourceGranularity,
          startTime,
          endTime,
        );
        if (!isCovered) {
          logger.info(
            '[统计查询] getStatisticsByTime 聚合表覆盖不足，回退原始表',
          );
        } else {
          list = await MonitorHistory.getStatisticsByTimeFromAgg(params);
          if (Array.isArray(list) && list.length === 0) {
            const hasRaw = await MonitorHistory.hasHistoryInRange(
              startTime,
              endTime,
            );
            if (hasRaw) {
              list = null;
            }
          } else {
            logger.info('[统计查询] getStatisticsByTime 使用聚合表');
            source = 'agg';
          }
        }
      } catch (error) {
        logger.warn(
          '[统计查询] getStatisticsByTime 聚合表读取失败，回退原始表',
          error?.message || error,
        );
        list = null;
      }
    }

    if (list === null) {
      list = await MonitorHistory.getStatisticsByTimeFromRaw(params);
      source = 'raw';
    }

    const generatedAt = formatDateToSqlText(new Date());
    await analyticsCacheService.set(
      cacheKey,
      buildAnalyticsEnvelope(list, {
        source,
        generatedAt,
      }),
      ttlMs,
    );
    return finalizeAnalyticsResult(list, {
      includeMeta,
      source,
      generatedAt,
    });
  }

  static getRequestedSourceGranularity(params = {}) {
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

    return MonitorHistory.getDurationSourceGranularity(
      groupBy,
      startTime,
      endTime,
    );
  }

  // 按国家分组统计
  static async getStatisticsByCountry(params = {}) {
    const { startTime = '', endTime = '' } = params;

    let sql = `
      SELECT
        country,
        COUNT(*) as total_checks,
        SUM(CASE WHEN is_broken = 1 THEN 1 ELSE 0 END) as broken_count,
        SUM(CASE WHEN is_broken = 0 THEN 1 ELSE 0 END) as normal_count
      FROM monitor_history
      WHERE 1=1
    `;
    const conditions = [];

    if (startTime) {
      sql += ` AND check_time >= ?`;
      conditions.push(startTime);
    }

    if (endTime) {
      sql += ` AND check_time <= ?`;
      conditions.push(endTime);
    }

    sql += ` GROUP BY country ORDER BY country ASC`;

    const list = await query(sql, conditions);
    return list;
  }

  // 高峰期统计
  static async getPeakHoursStatistics(params = {}) {
    const {
      country = '',
      checkType = '',
      startTime = '',
      endTime = '',
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

    const useAgg =
      checkType !== 'GROUP' &&
      process.env.ANALYTICS_AGG_ENABLED !== '0' &&
      MonitorHistory.canUseAggForRange(sourceGranularity, startTime, endTime);

    if (useAgg) {
      try {
        sourceRows = await MonitorHistory.getDurationSourceRowsFromAgg({
          startTime,
          endTime,
          sourceGranularity,
          country,
        });
      } catch (error) {
        logger.warn(
          '[统计查询] getPeakHoursStatistics 聚合表读取失败，回退原始表',
          error?.message || error,
        );
        sourceRows = null;
      }
    }

    if (!Array.isArray(sourceRows)) {
      if (checkType === 'GROUP') {
        sourceRows = [];
      } else {
        sourceRows = await MonitorHistory.getDurationSourceRowsFromRaw({
          startTime,
          endTime,
          sourceGranularity,
          country,
        });
      }
    }

    const accumulator = createDurationMetricsAccumulator();
    sourceRows.forEach((row) => {
      const bucketDurationHours = MonitorHistory.getDurationBucketHours(
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

    return {
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
    };
  }

  // 按变体组分组统计
  static async getStatisticsByVariantGroup(params = {}) {
    const { country = '', startTime = '', endTime = '', limit = 10 } = params;

    let sql = `
      SELECT
        mh.variant_group_id,
        vg.name as variant_group_name,
        COUNT(*) as total_checks,
        SUM(CASE WHEN mh.is_broken = 1 THEN 1 ELSE 0 END) as broken_count,
        SUM(CASE WHEN mh.is_broken = 0 THEN 1 ELSE 0 END) as normal_count
      FROM monitor_history mh
      LEFT JOIN variant_groups vg ON vg.id = mh.variant_group_id
      WHERE mh.variant_group_id IS NOT NULL
    `;
    const conditions = [];

    if (country) {
      if (country === 'EU') {
        // EU汇总：包含所有欧洲国家
        sql += ` AND mh.country IN ('UK', 'DE', 'FR', 'IT', 'ES')`;
      } else {
        sql += ` AND mh.country = ?`;
        conditions.push(country);
      }
    }

    if (startTime) {
      sql += ` AND mh.check_time >= ?`;
      conditions.push(startTime);
    }

    if (endTime) {
      sql += ` AND mh.check_time <= ?`;
      conditions.push(endTime);
    }

    sql += ` GROUP BY mh.variant_group_id, vg.name ORDER BY broken_count DESC, total_checks DESC LIMIT ${Number(
      limit,
    )}`;

    const list = await query(sql, conditions);
    return list;
  }

  // 快速判断某时间范围是否存在原始监控数据（聚合表为空时用于回退）
  static async hasHistoryInRange(startTime = '', endTime = '') {
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

  static canUseAggForRange(timeSlotGranularity, startTime, endTime = '') {
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
    const backfillHours =
      Number(process.env.ANALYTICS_AGG_BACKFILL_HOURS) || 48;
    const backfillDays = Number(process.env.ANALYTICS_AGG_BACKFILL_DAYS) || 30;
    const limitMs =
      timeSlotGranularity === 'hour'
        ? backfillHours * 60 * 60 * 1000
        : backfillDays * 24 * 60 * 60 * 1000;

    return diffMs <= limitMs;
  }

  // 从聚合表读取预聚合数据（用于加速统计查询）
  static async getAggGroupedRecords(params = {}) {
    const {
      startTime = '',
      endTime = '',
      timeSlotGranularity = 'day',
      countries = [],
    } = params;

    const slotSelectFormat =
      timeSlotGranularity === 'hour' ? '%Y-%m-%d %H:00:00' : '%Y-%m-%d';
    const slotWhereFormat =
      timeSlotGranularity === 'hour'
        ? '%Y-%m-%d %H:00:00'
        : '%Y-%m-%d 00:00:00';

    let whereClause = 'WHERE granularity = ?';
    const conditions = [timeSlotGranularity];

    if (startTime) {
      whereClause += ` AND time_slot >= DATE_FORMAT(?, '${slotWhereFormat}')`;
      conditions.push(startTime);
    }

    if (endTime) {
      whereClause += ` AND time_slot <= DATE_FORMAT(?, '${slotWhereFormat}')`;
      conditions.push(endTime);
    }

    if (Array.isArray(countries) && countries.length > 0) {
      const placeholders = countries.map(() => '?').join(',');
      whereClause += ` AND country IN (${placeholders})`;
      conditions.push(...countries);
    }

    const sql = `
      SELECT
        DATE_FORMAT(time_slot, '${slotSelectFormat}') as time_slot,
        country,
        asin_key,
        check_count,
        broken_count,
        has_broken,
        has_peak,
        first_check_time
      FROM monitor_history_agg
      ${whereClause}
      ORDER BY first_check_time ASC
    `;

    return await query(sql, conditions);
  }

  static async getAggRangeCoverage(tableName, granularity) {
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

  static async isAggTableCoveringRange(
    tableName,
    granularity,
    startTime = '',
    endTime = '',
  ) {
    const coverage = await MonitorHistory.getAggRangeCoverage(
      tableName,
      granularity,
    );
    if (!coverage.minSlot || !coverage.maxSlot) {
      return false;
    }

    const alignedStart = alignTimeToSlotText(startTime, granularity);
    const alignedEnd = alignTimeToSlotText(endTime, granularity);
    let alignedEndForCheck = alignedEnd;
    if (alignedEnd) {
      // 当查询endTime落在未来（例如当天23:59:59）时，按当前时间槽做覆盖判断，避免误判回退
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
      // 允许聚合刷新存在小幅滞后，避免因为最后1~2小时未刷新而整体回退原始表
      const lagToleranceMs =
        (Number(process.env.ANALYTICS_AGG_ACCEPTABLE_LAG_MINUTES) || 120) *
        60 *
        1000;
      const maxSlotTime = new Date(
        coverage.maxSlot.replace(' ', 'T'),
      ).getTime();
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

  static buildSummaryMetrics(row = {}) {
    const totalChecks = Number(row.total_checks) || 0;
    const brokenCount = Number(row.broken_count) || 0;
    const peakBroken = Number(row.peak_broken) || 0;
    const peakTotal = Number(row.peak_total) || 0;
    const lowBroken = Number(row.low_broken) || 0;
    const lowTotal = Number(row.low_total) || 0;
    const totalAsinsDedup = Number(row.total_asins_dedup) || 0;
    const brokenAsinsDedup = Number(row.broken_asins_dedup) || 0;

    const ratioAllAsin =
      totalChecks > 0 ? (brokenCount / totalChecks) * 100 : 0;
    const ratioAllTime =
      totalAsinsDedup > 0 ? (brokenAsinsDedup / totalAsinsDedup) * 100 : 0;
    const globalPeakRate =
      totalChecks > 0 ? (peakBroken / totalChecks) * 100 : 0;
    const globalLowRate = totalChecks > 0 ? (lowBroken / totalChecks) * 100 : 0;
    const ratioHigh = peakTotal > 0 ? (peakBroken / peakTotal) * 100 : 0;
    const ratioLow = lowTotal > 0 ? (lowBroken / lowTotal) * 100 : 0;

    return {
      totalChecks,
      ratioAllAsin,
      ratioAllTime,
      globalPeakRate,
      globalLowRate,
      ratioHigh,
      ratioLow,
      brokenCount,
      totalAsinsDedup,
      brokenAsinsDedup,
      peakBroken,
      peakTotal,
      lowBroken,
      lowTotal,
    };
  }

  static getPeakHourCase(countryField, timeField = 'mh.check_time') {
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

  static async getAllCountriesSummaryFromAgg(params = {}) {
    const {
      startTime = '',
      endTime = '',
      timeSlotGranularity = 'day',
    } = params;

    const slotWhereFormat =
      timeSlotGranularity === 'hour'
        ? '%Y-%m-%d %H:00:00'
        : '%Y-%m-%d 00:00:00';

    let whereClause = 'WHERE granularity = ?';
    const conditions = [timeSlotGranularity];

    if (startTime) {
      whereClause += ` AND time_slot >= DATE_FORMAT(?, '${slotWhereFormat}')`;
      conditions.push(startTime);
    }

    if (endTime) {
      whereClause += ` AND time_slot <= DATE_FORMAT(?, '${slotWhereFormat}')`;
      conditions.push(endTime);
    }

    const sql = `
      SELECT
        SUM(check_count) as total_checks,
        SUM(broken_count) as broken_count,
        SUM(CASE WHEN has_peak = 1 THEN check_count ELSE 0 END) as peak_total,
        SUM(CASE WHEN has_peak = 1 THEN broken_count ELSE 0 END) as peak_broken,
        SUM(CASE WHEN has_peak = 0 THEN check_count ELSE 0 END) as low_total,
        SUM(CASE WHEN has_peak = 0 THEN broken_count ELSE 0 END) as low_broken,
        COUNT(*) as total_asins_dedup,
        SUM(CASE WHEN has_broken = 1 THEN 1 ELSE 0 END) as broken_asins_dedup
      FROM monitor_history_agg
      ${whereClause}
    `;

    const [row] = await query(sql, conditions);
    return row || {};
  }

  static async getAllCountriesSummaryFromRaw(params = {}) {
    const {
      startTime = '',
      endTime = '',
      timeSlotGranularity = 'day',
    } = params;

    const slotExpr =
      timeSlotGranularity === 'hour' ? 'mh.hour_ts' : 'mh.day_ts';
    const isPeakCase = MonitorHistory.getPeakHourCase(
      'mh.country',
      'mh.check_time',
    );

    let whereClause = 'WHERE 1=1';
    const conditions = [];

    if (startTime) {
      whereClause += ` AND mh.check_time >= ?`;
      conditions.push(startTime);
    }

    if (endTime) {
      whereClause += ` AND mh.check_time <= ?`;
      conditions.push(endTime);
    }

    whereClause += ` AND ${MonitorHistory.getAnalyticsAsinHistoryFilter(
      'mh.check_type',
      'mh.asin_id',
      'mh.asin_code',
    )}`;

    const sql = `
      SELECT
        SUM(sub.check_count) as total_checks,
        SUM(sub.broken_count) as broken_count,
        SUM(CASE WHEN sub.has_peak = 1 THEN sub.check_count ELSE 0 END) as peak_total,
        SUM(CASE WHEN sub.has_peak = 1 THEN sub.broken_count ELSE 0 END) as peak_broken,
        SUM(CASE WHEN sub.has_peak = 0 THEN sub.check_count ELSE 0 END) as low_total,
        SUM(CASE WHEN sub.has_peak = 0 THEN sub.broken_count ELSE 0 END) as low_broken,
        COUNT(*) as total_asins_dedup,
        SUM(CASE WHEN sub.has_broken = 1 THEN 1 ELSE 0 END) as broken_asins_dedup
      FROM (
        SELECT
          ${slotExpr} as slot_raw,
          mh.country,
          COALESCE(NULLIF(mh.asin_code, ''), CONCAT('ID#', mh.asin_id)) as asin_key,
          COUNT(*) as check_count,
          SUM(CASE WHEN mh.is_broken = 1 THEN 1 ELSE 0 END) as broken_count,
          MAX(mh.is_broken) as has_broken,
          MAX(${isPeakCase}) as has_peak
        FROM monitor_history mh
        ${whereClause}
        AND (mh.asin_id IS NOT NULL OR NULLIF(mh.asin_code, '') IS NOT NULL)
        GROUP BY ${slotExpr}, mh.country, COALESCE(NULLIF(mh.asin_code, ''), CONCAT('ID#', mh.asin_id))
      ) sub
    `;

    const [row] = await query(sql, conditions);
    return row || {};
  }

  // 全部国家汇总统计
  static async getAllCountriesSummary(params = {}) {
    const {
      startTime = '',
      endTime = '',
      timeSlotGranularity = 'day',
      includeMeta = false,
    } = params;

    // 生成缓存键
    const cacheKey = `allCountriesSummary:${ANALYTICS_CACHE_VERSION}:${startTime}:${endTime}:${timeSlotGranularity}`;
    const ttlMs =
      Number(process.env.ANALYTICS_ALL_COUNTRIES_SUMMARY_TTL_MS) || 300000;
    const cached = await analyticsCacheService.get(cacheKey);
    if (cached !== null) {
      return resolveCachedAnalyticsResult(cached, includeMeta);
    }

    const sourceGranularity = MonitorHistory.getDurationSourceGranularity(
      timeSlotGranularity,
      startTime,
      endTime,
    );
    const queryStartDate = parseDateTimeInput(startTime);
    const queryEndDate = parseDateTimeInput(endTime);
    let sourceRows = null;
    let source = 'raw';

    const useAgg =
      process.env.ANALYTICS_AGG_ENABLED !== '0' &&
      MonitorHistory.canUseAggForRange(sourceGranularity, startTime, endTime);

    if (useAgg) {
      try {
        sourceRows = await MonitorHistory.getDurationSourceRowsFromAgg({
          startTime,
          endTime,
          sourceGranularity,
        });
        logger.info('[统计查询] getAllCountriesSummary 使用聚合表');
        source = 'agg';
      } catch (error) {
        logger.warn(
          '[统计查询] getAllCountriesSummary 聚合表读取失败，回退原始表',
          error?.message || error,
        );
        sourceRows = null;
      }
    }

    if (!Array.isArray(sourceRows)) {
      sourceRows = await MonitorHistory.getDurationSourceRowsFromRaw({
        startTime,
        endTime,
        sourceGranularity,
      });
      source = 'raw';
    }

    const [metrics = {}] = MonitorHistory.buildDurationRowsByGroup(sourceRows, {
      sourceGranularity,
      targetGranularity: timeSlotGranularity,
      queryStartDate,
      queryEndDate,
      buildGroupKey: () => 'ALL',
      buildGroupMeta: () => ({}),
    });

    const result = {
      timeRange: startTime && endTime ? `${startTime} ~ ${endTime}` : '',
      ...(metrics || {
        totalDurationHours: 0,
        abnormalDurationHours: 0,
        normalDurationHours: 0,
        ratioAllAsin: 0,
        ratioAllTime: 0,
        globalPeakRate: 0,
        globalLowRate: 0,
        ratioHigh: 0,
        ratioLow: 0,
        totalChecks: 0,
        brokenCount: 0,
        totalAsinsDedup: 0,
        brokenAsinsDedup: 0,
        peakDurationHours: 0,
        peakAbnormalDurationHours: 0,
        lowDurationHours: 0,
        lowAbnormalDurationHours: 0,
      }),
    };

    const generatedAt = formatDateToSqlText(new Date());
    await analyticsCacheService.set(
      cacheKey,
      buildAnalyticsEnvelope(result, {
        source,
        generatedAt,
      }),
      ttlMs,
    );
    return finalizeAnalyticsResult(result, {
      includeMeta,
      source,
      generatedAt,
    });
  }

  // 区域汇总统计（美国/欧洲）
  static async getRegionSummary(params = {}) {
    const {
      startTime = '',
      endTime = '',
      timeSlotGranularity = 'day',
      includeMeta = false,
    } = params;

    // 生成缓存键
    const cacheKey = `regionSummary:${ANALYTICS_CACHE_VERSION}:${startTime}:${endTime}:${timeSlotGranularity}`;
    const ttlMs = Number(process.env.ANALYTICS_REGION_SUMMARY_TTL_MS) || 300000;
    const cached = await analyticsCacheService.get(cacheKey);
    if (cached !== null) {
      return resolveCachedAnalyticsResult(cached, includeMeta);
    }

    const sourceGranularity = MonitorHistory.getDurationSourceGranularity(
      timeSlotGranularity,
      startTime,
      endTime,
    );
    const queryStartDate = parseDateTimeInput(startTime);
    const queryEndDate = parseDateTimeInput(endTime);
    let sourceRows = null;
    let source = 'raw';

    const useAgg =
      process.env.ANALYTICS_AGG_ENABLED !== '0' &&
      MonitorHistory.canUseAggForRange(sourceGranularity, startTime, endTime);

    if (useAgg) {
      try {
        sourceRows = await MonitorHistory.getDurationSourceRowsFromAgg({
          startTime,
          endTime,
          sourceGranularity,
        });
        logger.info('[统计查询] getRegionSummary 使用聚合表');
        source = 'agg';
      } catch (error) {
        logger.warn(
          '[统计查询] getRegionSummary 聚合表读取失败，回退原始表',
          error?.message || error,
        );
        sourceRows = null;
      }
    }

    if (!Array.isArray(sourceRows)) {
      sourceRows = await MonitorHistory.getDurationSourceRowsFromRaw({
        startTime,
        endTime,
        sourceGranularity,
      });
      source = 'raw';
    }

    const regionRows = sourceRows.filter((row) =>
      ['US', 'UK', 'DE', 'FR', 'IT', 'ES'].includes(row.country),
    );
    const result = MonitorHistory.buildDurationRowsByGroup(regionRows, {
      sourceGranularity,
      targetGranularity: timeSlotGranularity,
      queryStartDate,
      queryEndDate,
      buildGroupKey: (_, row) => (row.country === 'US' ? 'US' : 'EU'),
      buildGroupMeta: (_, row) => {
        const regionCode = row.country === 'US' ? 'US' : 'EU';
        return {
          region: regionCode === 'US' ? '美国' : '欧洲',
          regionCode,
          timeRange: startTime && endTime ? `${startTime} ~ ${endTime}` : '',
        };
      },
    });
    const rowByRegion = new Map(result.map((item) => [item.regionCode, item]));
    const defaultMetrics = {
      totalDurationHours: 0,
      abnormalDurationHours: 0,
      normalDurationHours: 0,
      ratioAllAsin: 0,
      ratioAllTime: 0,
      globalPeakRate: 0,
      globalLowRate: 0,
      ratioHigh: 0,
      ratioLow: 0,
      totalChecks: 0,
      brokenCount: 0,
      totalAsinsDedup: 0,
      brokenAsinsDedup: 0,
      peakDurationHours: 0,
      peakAbnormalDurationHours: 0,
      lowDurationHours: 0,
      lowAbnormalDurationHours: 0,
    };
    const normalizedResult = ['US', 'EU'].map((regionCode) => ({
      region: regionCode === 'US' ? '美国' : '欧洲',
      regionCode,
      timeRange: startTime && endTime ? `${startTime} ~ ${endTime}` : '',
      ...defaultMetrics,
      ...(rowByRegion.get(regionCode) || {}),
    }));

    const generatedAt = formatDateToSqlText(new Date());
    await analyticsCacheService.set(
      cacheKey,
      buildAnalyticsEnvelope(normalizedResult, {
        source,
        generatedAt,
      }),
      ttlMs,
    );
    return finalizeAnalyticsResult(normalizedResult, {
      includeMeta,
      source,
      generatedAt,
    });
  }

  // 周期汇总统计（聚合表版本，用于加速大范围查询）
  static async getPeriodSummaryFromAgg(params = {}) {
    const {
      country = '',
      site = '',
      brand = '',
      startTime = '',
      endTime = '',
      timeSlotGranularity = 'day',
      current = 1,
      pageSize = 10,
    } = params;

    const slotSelectFormat =
      timeSlotGranularity === 'hour' ? '%Y-%m-%d %H:00:00' : '%Y-%m-%d';
    const slotWhereFormat =
      timeSlotGranularity === 'hour'
        ? '%Y-%m-%d %H:00:00'
        : '%Y-%m-%d 00:00:00';

    let whereClause = 'WHERE agg.granularity = ?';
    const conditions = [timeSlotGranularity];
    const useDimAgg = Boolean(site || brand);
    const aggTable = useDimAgg
      ? 'monitor_history_agg_dim'
      : 'monitor_history_agg';

    const isCovered = await MonitorHistory.isAggTableCoveringRange(
      aggTable,
      timeSlotGranularity,
      startTime,
      endTime,
    );
    if (!isCovered) {
      throw new Error(`聚合表覆盖不足，回退原始表: ${aggTable}`);
    }

    if (country) {
      if (country === 'EU') {
        whereClause += ` AND agg.country IN ('UK', 'DE', 'FR', 'IT', 'ES')`;
      } else {
        whereClause += ` AND agg.country = ?`;
        conditions.push(country);
      }
    }

    if (startTime) {
      whereClause += ` AND agg.time_slot >= DATE_FORMAT(?, '${slotWhereFormat}')`;
      conditions.push(startTime);
    }

    if (endTime) {
      whereClause += ` AND agg.time_slot <= DATE_FORMAT(?, '${slotWhereFormat}')`;
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

    const selectFields = [
      `DATE_FORMAT(agg.time_slot, '${slotSelectFormat}') as time_slot`,
      'agg.country as country',
      site ? 'agg.site as site' : "'' as site",
      brand ? 'agg.brand as brand' : "'' as brand",
      'SUM(agg.check_count) as total_checks',
      'SUM(agg.broken_count) as broken_count',
      'SUM(CASE WHEN agg.has_peak = 1 THEN agg.check_count ELSE 0 END) as peak_total',
      'SUM(CASE WHEN agg.has_peak = 1 THEN agg.broken_count ELSE 0 END) as peak_broken',
      'SUM(CASE WHEN agg.has_peak = 0 THEN agg.check_count ELSE 0 END) as low_total',
      'SUM(CASE WHEN agg.has_peak = 0 THEN agg.broken_count ELSE 0 END) as low_broken',
      'COUNT(DISTINCT agg.asin_key) as total_asins_dedup',
      'COUNT(DISTINCT CASE WHEN agg.has_broken = 1 THEN agg.asin_key ELSE NULL END) as broken_asins_dedup',
    ];

    const safeCurrent = Math.max(1, Number(current) || 1);
    const safePageSize = Math.max(1, Number(pageSize) || 10);
    const offset = (safeCurrent - 1) * safePageSize;

    const fromClause = `
      FROM ${aggTable} agg
      ${whereClause}
    `;
    const groupByClause = `GROUP BY agg.time_slot, agg.country${
      site ? ', agg.site' : ''
    }${brand ? ', agg.brand' : ''}`;
    const groupedSql = `
      SELECT
        ${selectFields.join(', ')}
      ${fromClause}
      ${groupByClause}
    `;

    const dataSql = `
      SELECT grouped.*, COUNT(1) OVER() as total_rows
      FROM (
        ${groupedSql}
      ) grouped
      ORDER BY grouped.time_slot ASC, grouped.country ASC${
        site ? ', grouped.site ASC' : ''
      }${brand ? ', grouped.brand ASC' : ''}
      LIMIT ${safePageSize} OFFSET ${offset}
    `;

    const queryStartTime = Date.now();
    const groupedRecords = await query(dataSql, conditions);
    let total = Number(groupedRecords?.[0]?.total_rows) || 0;
    if (groupedRecords.length === 0 && offset > 0) {
      const countSql = `
        SELECT COUNT(1) as total
        FROM (
          ${groupedSql}
        ) grouped
      `;
      const countRows = await query(countSql, conditions);
      total = Number(countRows?.[0]?.total) || 0;
    }
    const queryDuration = Date.now() - queryStartTime;
    logger.info(
      `[聚合查询] getPeriodSummaryFromAgg SQL查询完成（${aggTable}），耗时${queryDuration}ms，返回${groupedRecords.length}条记录，总计${total}条`,
    );

    if (total === 0) {
      const hasRaw = await MonitorHistory.hasHistoryInRange(startTime, endTime);
      if (hasRaw) {
        throw new Error('聚合结果为空，触发回退');
      }
    }

    const result = groupedRecords.map((record) => {
      const totalChecks = Number(record.total_checks) || 0;
      const brokenCount = Number(record.broken_count) || 0;
      const peakTotal = Number(record.peak_total) || 0;
      const peakBroken = Number(record.peak_broken) || 0;
      const lowTotal = Number(record.low_total) || 0;
      const lowBroken = Number(record.low_broken) || 0;
      const totalAsinsDedup = Number(record.total_asins_dedup) || 0;
      const brokenAsinsDedup = Number(record.broken_asins_dedup) || 0;

      const ratioAllAsin =
        totalChecks > 0 ? (brokenCount / totalChecks) * 100 : 0;
      const ratioAllTime =
        totalAsinsDedup > 0 ? (brokenAsinsDedup / totalAsinsDedup) * 100 : 0;
      const globalPeakRate =
        totalChecks > 0 ? (peakBroken / totalChecks) * 100 : 0;
      const globalLowRate =
        totalChecks > 0 ? (lowBroken / totalChecks) * 100 : 0;
      const ratioHigh = peakTotal > 0 ? (peakBroken / peakTotal) * 100 : 0;
      const ratioLow = lowTotal > 0 ? (lowBroken / lowTotal) * 100 : 0;

      return {
        timeSlot: record.time_slot,
        country: record.country,
        site: record.site || '',
        brand: record.brand || '',
        totalChecks,
        ratioAllAsin,
        ratioAllTime,
        globalPeakRate,
        globalLowRate,
        ratioHigh,
        ratioLow,
        brokenCount,
        totalAsinsDedup,
        brokenAsinsDedup,
        peakBroken,
        peakTotal,
        lowBroken,
        lowTotal,
      };
    });

    return {
      list: result,
      total,
      current: safeCurrent,
      pageSize: safePageSize,
    };
  }

  // 周期汇总统计（支持国家/站点/品牌筛选和分页）
  static async getPeriodSummary(params = {}) {
    const {
      country = '',
      site = '',
      brand = '',
      startTime = '',
      endTime = '',
      timeSlotGranularity = 'day',
      current = 1,
      pageSize = 10,
      includeMeta = false,
    } = params;

    // 生成缓存键
    const cacheKey = `periodSummary:${ANALYTICS_CACHE_VERSION}:${country}:${site}:${brand}:${startTime}:${endTime}:${timeSlotGranularity}:${current}:${pageSize}`;
    const periodSummaryCacheTtl =
      Number(process.env.ANALYTICS_PERIOD_SUMMARY_TTL_MS) || 300000;
    const cached = await analyticsCacheService.get(cacheKey);
    if (cached !== null) {
      logger.info(`[缓存命中] getPeriodSummary 缓存键: ${cacheKey}`);
      return resolveCachedAnalyticsResult(cached, includeMeta);
    }
    logger.info(
      `[缓存未命中] getPeriodSummary 缓存键: ${cacheKey}，将查询数据库`,
    );

    const sourceGranularity = MonitorHistory.getDurationSourceGranularity(
      timeSlotGranularity,
      startTime,
      endTime,
    );
    const queryStartDate = parseDateTimeInput(startTime);
    const queryEndDate = parseDateTimeInput(endTime);
    const safeCurrent = Math.max(1, Number(current) || 1);
    const safePageSize = Math.max(1, Number(pageSize) || 10);
    const offset = (safeCurrent - 1) * safePageSize;
    let sourceRows = null;
    let source = 'raw';

    const useAgg =
      process.env.ANALYTICS_AGG_ENABLED !== '0' &&
      MonitorHistory.canUseAggForRange(sourceGranularity, startTime, endTime);

    if (useAgg) {
      try {
        sourceRows = await MonitorHistory.getDurationSourceRowsFromAgg({
          startTime,
          endTime,
          sourceGranularity,
          country,
          site,
          brand,
        });
        logger.info('[统计查询] getPeriodSummary 使用聚合表');
        source = 'agg';
      } catch (error) {
        logger.warn(
          '[统计查询] getPeriodSummary 聚合表读取失败，回退原始表',
          error?.message || error,
        );
        sourceRows = null;
      }
    }

    if (!Array.isArray(sourceRows)) {
      sourceRows = await MonitorHistory.getDurationSourceRowsFromRaw({
        startTime,
        endTime,
        sourceGranularity,
        country,
        site,
        brand,
      });
      source = 'raw';
    }

    const fullList = MonitorHistory.buildDurationRowsByGroup(sourceRows, {
      sourceGranularity,
      targetGranularity: timeSlotGranularity,
      queryStartDate,
      queryEndDate,
      buildGroupKey: (targetPeriod, row) =>
        [targetPeriod, row.country || '', row.site || '', row.brand || ''].join(
          '|',
        ),
      buildGroupMeta: (targetPeriod, row) => ({
        timeSlot: targetPeriod,
        country: row.country || '',
        site: row.site || '',
        brand: row.brand || '',
      }),
    }).sort((a, b) => {
      const left = `${a.timeSlot}|${a.country}|${a.site}|${a.brand}`;
      const right = `${b.timeSlot}|${b.country}|${b.site}|${b.brand}`;
      return left.localeCompare(right);
    });
    const total = fullList.length;
    const list = fullList.slice(offset, offset + safePageSize);

    const finalResult = {
      list,
      total,
      current: safeCurrent,
      pageSize: safePageSize,
    };
    const generatedAt = formatDateToSqlText(new Date());

    await analyticsCacheService.set(
      cacheKey,
      buildAnalyticsEnvelope(finalResult, {
        source,
        generatedAt,
      }),
      periodSummaryCacheTtl,
    );
    logger.info(
      `[缓存存储] getPeriodSummary 结果已缓存，键: ${cacheKey}，TTL: ${periodSummaryCacheTtl}ms`,
    );

    return finalizeAnalyticsResult(finalResult, {
      includeMeta,
      source,
      generatedAt,
    });
  }

  // 按国家统计ASIN时长（基于监控历史）
  static async getASINStatisticsByCountry(params = {}) {
    const {
      country = '',
      startTime = '',
      endTime = '',
      includeMeta = false,
    } = params;
    const cacheKey = `asinStatisticsByCountry:${ANALYTICS_CACHE_VERSION}:${country}:${startTime}:${endTime}`;
    const ttlMs = Number(process.env.ANALYTICS_ASIN_COUNTRY_TTL_MS) || 300000;
    const cached = await analyticsCacheService.get(cacheKey);
    if (cached !== null) {
      return resolveCachedAnalyticsResult(cached, includeMeta);
    }

    const sourceGranularity = MonitorHistory.getDurationSourceGranularity(
      'day',
      startTime,
      endTime,
    );
    const queryStartDate = parseDateTimeInput(startTime);
    const queryEndDate = parseDateTimeInput(endTime);

    let sourceRows = null;
    let source = 'raw';
    const useAgg =
      process.env.ANALYTICS_AGG_ENABLED !== '0' &&
      MonitorHistory.canUseAggForRange(sourceGranularity, startTime, endTime);

    if (useAgg) {
      try {
        sourceRows = await MonitorHistory.getDurationSourceRowsFromAgg({
          country,
          startTime,
          endTime,
          sourceGranularity,
        });
        source = 'agg';
      } catch (error) {
        logger.warn(
          '[统计查询] getASINStatisticsByCountry 聚合表读取失败，回退原始表',
          error?.message || error,
        );
        sourceRows = null;
      }
    }

    if (!Array.isArray(sourceRows)) {
      sourceRows = await MonitorHistory.getDurationSourceRowsFromRaw({
        country,
        startTime,
        endTime,
        sourceGranularity,
      });
      source = 'raw';
    }

    const result = MonitorHistory.buildDurationRowsByGroup(sourceRows, {
      sourceGranularity,
      targetGranularity: sourceGranularity,
      queryStartDate,
      queryEndDate,
      buildGroupKey: (_, row) => row.country || '',
      buildGroupMeta: (_, row) => ({
        country: row.country || '',
      }),
    })
      .map((item) => ({
        ...item,
        total_checks: item.totalChecks,
        broken_count: item.brokenCount,
        normal_count: Math.max(0, item.totalChecks - item.brokenCount),
      }))
      .sort((a, b) => {
        if (b.abnormalDurationHours !== a.abnormalDurationHours) {
          return b.abnormalDurationHours - a.abnormalDurationHours;
        }
        return b.ratioAllTime - a.ratioAllTime;
      });

    const generatedAt = formatDateToSqlText(new Date());
    await analyticsCacheService.set(
      cacheKey,
      buildAnalyticsEnvelope(result, {
        source,
        generatedAt,
      }),
      ttlMs,
    );
    return finalizeAnalyticsResult(result, {
      includeMeta,
      source,
      generatedAt,
    });
  }

  // 按变体组统计ASIN时长（基于监控历史）
  static async getASINStatisticsByVariantGroup(params = {}) {
    const {
      country = '',
      startTime = '',
      endTime = '',
      limit = 10,
      includeMeta = false,
    } = params;
    const cacheKey = `asinStatisticsByVariantGroup:${ANALYTICS_CACHE_VERSION}:${country}:${startTime}:${endTime}:${limit}`;
    const ttlMs =
      Number(process.env.ANALYTICS_ASIN_VARIANT_GROUP_TTL_MS) || 300000;
    const cached = await analyticsCacheService.get(cacheKey);
    if (cached !== null) {
      return resolveCachedAnalyticsResult(cached, includeMeta);
    }

    const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 100));
    const sourceGranularity = MonitorHistory.getDurationSourceGranularity(
      'day',
      startTime,
      endTime,
    );
    const queryStartDate = parseDateTimeInput(startTime);
    const queryEndDate = parseDateTimeInput(endTime);
    let sourceRows = null;
    let source = 'raw';
    const useAgg =
      process.env.ANALYTICS_AGG_ENABLED !== '0' &&
      MonitorHistory.canUseAggForRange(sourceGranularity, startTime, endTime);

    if (useAgg) {
      try {
        sourceRows =
          await MonitorHistory.getVariantGroupDurationSourceRowsFromAgg({
            country,
            startTime,
            endTime,
            sourceGranularity,
          });
        if (Array.isArray(sourceRows) && sourceRows.length > 0) {
          source = 'agg';
        } else {
          sourceRows = null;
        }
      } catch (error) {
        logger.warn(
          '[统计查询] getASINStatisticsByVariantGroup 聚合表读取失败，回退原始表',
          error?.message || error,
        );
        sourceRows = null;
      }
    }

    if (!Array.isArray(sourceRows)) {
      sourceRows =
        await MonitorHistory.getVariantGroupDurationSourceRowsFromRaw({
          country,
          startTime,
          endTime,
          sourceGranularity,
        });
      source = 'raw';
    }

    const result = MonitorHistory.buildDurationRowsByGroup(sourceRows, {
      sourceGranularity,
      targetGranularity: sourceGranularity,
      queryStartDate,
      queryEndDate,
      buildGroupKey: (_, row) => row.variant_group_id || '',
      buildGroupMeta: (_, row) => ({
        variant_group_id: row.variant_group_id || '',
        variant_group_name: row.variant_group_name || '',
        country: row.country || '',
      }),
    })
      .filter((item) => item.variant_group_id && item.abnormalDurationHours > 0)
      .map((item) => ({
        ...item,
        total_checks: item.totalChecks,
        broken_count: item.brokenCount,
        normal_count: Math.max(0, item.totalChecks - item.brokenCount),
      }))
      .sort((a, b) => {
        if (b.abnormalDurationHours !== a.abnormalDurationHours) {
          return b.abnormalDurationHours - a.abnormalDurationHours;
        }
        return b.ratioAllTime - a.ratioAllTime;
      })
      .slice(0, safeLimit);

    const generatedAt = formatDateToSqlText(new Date());
    await analyticsCacheService.set(
      cacheKey,
      buildAnalyticsEnvelope(result, {
        source,
        generatedAt,
      }),
      ttlMs,
    );
    return finalizeAnalyticsResult(result, {
      includeMeta,
      source,
      generatedAt,
    });
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
