const analyticsViewService = require('./analyticsViewService');
const analyticsQueryService = require('./analyticsQueryService');
const logger = require('../utils/logger');

function normalizeAnalyticsEnvelope(result) {
  return {
    data: result?.data ?? result,
    meta: result?.meta,
  };
}

function resolveMonthlyWindow({
  month = '',
  startTime: startTimeParam = '',
  endTime: endTimeParam = '',
} = {}) {
  const now = new Date();
  const fallbackMonth = `${now.getFullYear()}-${String(
    now.getMonth() + 1,
  ).padStart(2, '0')}`;
  const monthTokenCandidate = month || String(startTimeParam || '').slice(0, 7);
  const monthToken = /^\d{4}-\d{2}$/.test(monthTokenCandidate)
    ? monthTokenCandidate
    : fallbackMonth;
  const [yearText, monthText] = monthToken.split('-');
  const year = Number(yearText) || now.getFullYear();
  const monthNumber = Math.min(
    12,
    Math.max(1, Number(monthText) || now.getMonth() + 1),
  );
  const normalizedMonthToken = `${year}-${String(monthNumber).padStart(
    2,
    '0',
  )}`;
  const daysInMonth = new Date(year, monthNumber, 0).getDate();

  return {
    monthToken: normalizedMonthToken,
    startTime: startTimeParam || `${normalizedMonthToken}-01 00:00:00`,
    endTime:
      endTimeParam ||
      `${normalizedMonthToken}-${String(daysInMonth).padStart(
        2,
        '0',
      )} 23:59:59`,
  };
}

/**
 * 带超时的 Promise 包装器
 * @param {Promise} promise - 原始 Promise
 * @param {number} timeoutMs - 超时时间（毫秒）
 * @param {string} taskName - 任务名称（用于日志）
 * @returns {Promise} - 带超时的 Promise
 */
function withTimeout(promise, timeoutMs, taskName) {
  let timer = null;

  return Promise.race([
    Promise.resolve(promise).finally(() => {
      if (timer) {
        clearTimeout(timer);
      }
    }),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`查询超时: ${taskName} (${timeoutMs}ms)`));
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

/**
 * 带错误处理的查询包装器
 * @param {Function} queryFn - 查询函数
 * @param {string} taskName - 任务名称
 * @param {any} fallbackValue - 失败时的默认值
 * @returns {Promise} - 查询结果
 */
async function safeQuery(queryFn, taskName, fallbackValue = null) {
  try {
    return await queryFn();
  } catch (error) {
    logger.warn(`[Analytics] ${taskName} 查询失败`, {
      message: error?.message || String(error),
    });
    return fallbackValue;
  }
}

async function safeTimedQuery(
  queryFn,
  taskName,
  timeoutMs,
  fallbackValue = null,
) {
  return safeQuery(
    () => withTimeout(Promise.resolve().then(queryFn), timeoutMs, taskName),
    taskName,
    fallbackValue,
  );
}

async function getOverview({
  country = '',
  startTime = '',
  endTime = '',
  groupBy = 'day',
  timeSlotGranularity = 'day',
  allCountriesTimeSlotGranularity = '',
  regionTimeSlotGranularity = '',
  variantGroupLimit = 10,
} = {}) {
  const allCountriesGranularity =
    allCountriesTimeSlotGranularity || timeSlotGranularity;
  const regionGranularity = regionTimeSlotGranularity || timeSlotGranularity;

  // 单个查询超时时间（毫秒）- 根据应用层超时 15分钟 分配到各个查询
  // 增加超时时间以应对大数据量查询场景，支持查询近30天数据
  const QUERY_TIMEOUT_MS =
    Number(process.env.ANALYTICS_QUERY_TIMEOUT_MS) || 300000;

  // 分阶段执行查询，优先加载核心数据
  // 第一阶段：核心统计（必须）
  const coreStartTime = Date.now();
  const [overallStatistics, timeSeriesResult] = await Promise.all([
    safeTimedQuery(
      () =>
        analyticsQueryService.getOverallStatistics({
          country,
          startTime,
          endTime,
        }),
      'getOverallStatistics',
      QUERY_TIMEOUT_MS,
      {
        totalChecks: 0,
        brokenCount: 0,
        normalCount: 0,
        groupCount: 0,
        asinCount: 0,
      },
    ),
    safeTimedQuery(
      () =>
        analyticsQueryService.getStatisticsByTime({
          country,
          startTime,
          endTime,
          groupBy,
          includeMeta: true,
        }),
      'getStatisticsByTime',
      QUERY_TIMEOUT_MS,
      { data: [], meta: { source: 'raw' } },
    ),
  ]);
  logger.info(`[Analytics] 核心查询完成，耗时 ${Date.now() - coreStartTime}ms`);

  // 第二阶段：分布统计（次要，可降级）
  const distStartTime = Date.now();
  const [countryDurationResult, variantGroupTopResult] = await Promise.all([
    safeTimedQuery(
      () =>
        analyticsQueryService.getASINStatisticsByCountry({
          country,
          startTime,
          endTime,
          includeMeta: true,
        }),
      'getASINStatisticsByCountry',
      QUERY_TIMEOUT_MS,
      { data: [], meta: { source: 'raw' } },
    ),
    safeTimedQuery(
      () =>
        analyticsQueryService.getASINStatisticsByVariantGroup({
          country,
          startTime,
          endTime,
          limit: variantGroupLimit,
          includeMeta: true,
        }),
      'getASINStatisticsByVariantGroup',
      QUERY_TIMEOUT_MS,
      { data: [], meta: { source: 'raw' } },
    ),
  ]);
  logger.info(`[Analytics] 分布查询完成，耗时 ${Date.now() - distStartTime}ms`);

  // 第三阶段：汇总统计（可异步/降级）
  const summaryStartTime = Date.now();
  const [allCountriesSummaryResult, regionSummaryResult] = await Promise.all([
    safeTimedQuery(
      () =>
        analyticsQueryService.getAllCountriesSummary({
          startTime,
          endTime,
          timeSlotGranularity: allCountriesGranularity,
          includeMeta: true,
        }),
      'getAllCountriesSummary',
      QUERY_TIMEOUT_MS,
      { data: [], meta: { source: 'raw' } },
    ),
    safeTimedQuery(
      () =>
        analyticsQueryService.getRegionSummary({
          startTime,
          endTime,
          timeSlotGranularity: regionGranularity,
          includeMeta: true,
        }),
      'getRegionSummary',
      QUERY_TIMEOUT_MS,
      { data: [], meta: { source: 'raw' } },
    ),
  ]);
  logger.info(
    `[Analytics] 汇总查询完成，耗时 ${Date.now() - summaryStartTime}ms`,
  );

  // 第四阶段：高峰期统计（可选，仅在指定国家时）
  let peakHoursStatistics = null;
  if (country) {
    peakHoursStatistics = await safeTimedQuery(
      () =>
        analyticsQueryService.getPeakHoursStatistics({
          country,
          startTime,
          endTime,
        }),
      'getPeakHoursStatistics',
      QUERY_TIMEOUT_MS,
      null,
    );
  }

  const timeSeries = normalizeAnalyticsEnvelope(timeSeriesResult);
  const countryDuration = normalizeAnalyticsEnvelope(countryDurationResult);
  const variantGroupTop = normalizeAnalyticsEnvelope(variantGroupTopResult);
  const allCountriesSummary = normalizeAnalyticsEnvelope(
    allCountriesSummaryResult,
  );
  const regionSummary = normalizeAnalyticsEnvelope(regionSummaryResult);

  return {
    data: {
      overallStatistics,
      timeSeries: timeSeries.data,
      countryDuration: countryDuration.data,
      variantGroupTop: variantGroupTop.data,
      allCountriesSummary: allCountriesSummary.data,
      regionSummary: regionSummary.data,
      peakHoursStatistics: peakHoursStatistics || null,
      peakMarkAreas: analyticsViewService.buildPeakHoursMarkAreas({
        groupBy,
        country,
        startTime,
        endTime,
      }),
    },
    meta: {
      timeSeries: timeSeries.meta,
      countryDuration: countryDuration.meta,
      variantGroupTop: variantGroupTop.meta,
      allCountriesSummary: allCountriesSummary.meta,
      regionSummary: regionSummary.meta,
    },
  };
}

async function getPeriodSummary(params = {}) {
  return normalizeAnalyticsEnvelope(
    await analyticsQueryService.getPeriodSummary({
      ...params,
      includeMeta: true,
    }),
  );
}

async function getPeriodSummaryTimeSlotDetails(params = {}) {
  return normalizeAnalyticsEnvelope(
    await analyticsQueryService.getPeriodSummaryTimeSlotDetails({
      ...params,
      includeMeta: true,
    }),
  );
}

async function getMonitorHistorySummary(params = {}) {
  return normalizeAnalyticsEnvelope(
    await analyticsQueryService.getOverallStatistics({
      ...params,
      includeMeta: true,
    }),
  );
}

async function getMonitorHistoryPeakHours(params = {}) {
  return normalizeAnalyticsEnvelope(
    await analyticsQueryService.getPeakHoursStatistics({
      ...params,
      includeMeta: true,
    }),
  );
}

async function getMonthlyBreakdown(params = {}) {
  const { country = '' } = params;
  const window = resolveMonthlyWindow(params);
  const statistics = normalizeAnalyticsEnvelope(
    await analyticsQueryService.getStatisticsByTime({
      country,
      startTime: window.startTime,
      endTime: window.endTime,
      groupBy: 'day',
      includeMeta: true,
      sourceGranularityOverride: 'day',
    }),
  );

  return {
    data: analyticsViewService.buildMonthlyBreakdownRows(
      statistics.data,
      window.monthToken,
    ),
    meta: statistics.meta,
  };
}

module.exports = {
  getOverview,
  getMonitorHistoryPeakHours,
  getMonitorHistorySummary,
  getPeriodSummary,
  getPeriodSummaryTimeSlotDetails,
  getMonthlyBreakdown,
  resolveMonthlyWindow,
};
