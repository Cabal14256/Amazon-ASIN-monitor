const {
  ANALYTICS_CACHE_VERSION,
  analyticsCacheService,
  buildEmptyDurationMetrics,
  finalizeAnalyticsResult,
  formatDateToSqlText,
  getAnalyticsBusyContext,
  getBusyFallbackAnalyticsResult,
  logger,
  parseDateTimeInput,
  resolveCachedAnalyticsResult,
  storeAnalyticsResult,
} = require('./shared');
const { canUseAggForRange } = require('./repositories/aggCoverageRepository');
const {
  buildDurationRowsByGroup,
  getDurationSourceGranularity,
} = require('./repositories/durationTransformRepository');
const {
  getDurationSourceRowsFromAgg,
  getDurationSourceRowsFromRaw,
} = require('./repositories/durationSourceRepository');

async function getAllCountriesSummary(params = {}) {
  const {
    startTime = '',
    endTime = '',
    timeSlotGranularity = 'day',
    includeMeta = false,
  } = params;

  const cacheKey = `allCountriesSummary:${ANALYTICS_CACHE_VERSION}:${startTime}:${endTime}:${timeSlotGranularity}`;
  const latestCacheKey = `allCountriesSummary:${timeSlotGranularity}`;
  const ttlMs =
    Number(process.env.ANALYTICS_ALL_COUNTRIES_SUMMARY_TTL_MS) || 300000;
  const cached = await analyticsCacheService.get(cacheKey);
  if (cached !== null) {
    return resolveCachedAnalyticsResult(cached, includeMeta);
  }

  const busyFallbackResult = await getBusyFallbackAnalyticsResult(
    latestCacheKey,
    includeMeta,
    getAnalyticsBusyContext(),
  );
  if (busyFallbackResult) {
    logger.warn(
      `[统计查询] getAllCountriesSummary busy fallback hit, granularity=${timeSlotGranularity}`,
    );
    return busyFallbackResult;
  }

  const sourceGranularity = getDurationSourceGranularity(
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
    canUseAggForRange(sourceGranularity, startTime, endTime);

  if (useAgg) {
    try {
      sourceRows = await getDurationSourceRowsFromAgg({
        startTime,
        endTime,
        sourceGranularity,
      });
      logger.info('[统计查询] getAllCountriesSummary 使用聚合表');
      source = 'agg';
    } catch (error) {
      logger.warn(
        '[统计查询] getAllCountriesSummary 聚合表读取失败，回退原始表',
        {
          message: error?.message || String(error),
        },
      );
      sourceRows = null;
    }
  }

  if (!Array.isArray(sourceRows)) {
    sourceRows = await getDurationSourceRowsFromRaw({
      startTime,
      endTime,
      sourceGranularity,
    });
    source = 'raw';
  }

  const [metrics = {}] = buildDurationRowsByGroup(sourceRows, {
    sourceGranularity,
    targetGranularity: timeSlotGranularity,
    queryStartDate,
    queryEndDate,
    buildGroupKey: () => 'ALL',
    buildGroupMeta: () => ({}),
  });

  const result = {
    timeRange: startTime && endTime ? `${startTime} ~ ${endTime}` : '',
    ...buildEmptyDurationMetrics(),
    ...(metrics || {}),
  };

  const generatedAt = formatDateToSqlText(new Date());
  await storeAnalyticsResult(
    cacheKey,
    latestCacheKey,
    result,
    { source, generatedAt },
    ttlMs,
  );

  return finalizeAnalyticsResult(result, {
    includeMeta,
    source,
    generatedAt,
  });
}

async function getRegionSummary(params = {}) {
  const {
    startTime = '',
    endTime = '',
    timeSlotGranularity = 'day',
    includeMeta = false,
  } = params;

  const cacheKey = `regionSummary:${ANALYTICS_CACHE_VERSION}:${startTime}:${endTime}:${timeSlotGranularity}`;
  const latestCacheKey = `regionSummary:${timeSlotGranularity}`;
  const ttlMs = Number(process.env.ANALYTICS_REGION_SUMMARY_TTL_MS) || 300000;
  const cached = await analyticsCacheService.get(cacheKey);
  if (cached !== null) {
    return resolveCachedAnalyticsResult(cached, includeMeta);
  }

  const busyFallbackResult = await getBusyFallbackAnalyticsResult(
    latestCacheKey,
    includeMeta,
    getAnalyticsBusyContext(),
  );
  if (busyFallbackResult) {
    logger.warn(
      `[统计查询] getRegionSummary busy fallback hit, granularity=${timeSlotGranularity}`,
    );
    return busyFallbackResult;
  }

  const sourceGranularity = getDurationSourceGranularity(
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
    canUseAggForRange(sourceGranularity, startTime, endTime);

  if (useAgg) {
    try {
      sourceRows = await getDurationSourceRowsFromAgg({
        startTime,
        endTime,
        sourceGranularity,
      });
      logger.info('[统计查询] getRegionSummary 使用聚合表');
      source = 'agg';
    } catch (error) {
      logger.warn('[统计查询] getRegionSummary 聚合表读取失败，回退原始表', {
        message: error?.message || String(error),
      });
      sourceRows = null;
    }
  }

  if (!Array.isArray(sourceRows)) {
    sourceRows = await getDurationSourceRowsFromRaw({
      startTime,
      endTime,
      sourceGranularity,
    });
    source = 'raw';
  }

  const supportedRegionCountries = ['US', 'UK', 'DE', 'FR', 'ES', 'IT'];
  const euCountryCodes = ['UK', 'DE', 'FR', 'ES', 'IT'];
  const regionLabelMap = {
    US: '美国',
    EU_TOTAL: '欧洲汇总',
    UK: '英国',
    DE: '德国',
    FR: '法国',
    ES: '西班牙',
    IT: '意大利',
  };
  const timeRangeLabel =
    startTime && endTime ? `${startTime} ~ ${endTime}` : '';
  const regionRows = sourceRows.filter((row) =>
    supportedRegionCountries.includes(String(row.country || '').toUpperCase()),
  );

  const countryRegionResult = buildDurationRowsByGroup(regionRows, {
    sourceGranularity,
    targetGranularity: timeSlotGranularity,
    queryStartDate,
    queryEndDate,
    buildGroupKey: (_, row) => {
      const regionCode = String(row.country || '').toUpperCase();
      return supportedRegionCountries.includes(regionCode) ? regionCode : '';
    },
    buildGroupMeta: (_, row) => {
      const regionCode = String(row.country || '').toUpperCase();
      return {
        region: regionLabelMap[regionCode] || regionCode,
        regionCode,
        timeRange: timeRangeLabel,
      };
    },
  });

  const euSummaryResult = buildDurationRowsByGroup(
    regionRows.filter((row) =>
      euCountryCodes.includes(String(row.country || '').toUpperCase()),
    ),
    {
      sourceGranularity,
      targetGranularity: timeSlotGranularity,
      queryStartDate,
      queryEndDate,
      buildGroupKey: () => 'EU_TOTAL',
      buildGroupMeta: () => ({
        region: regionLabelMap.EU_TOTAL,
        regionCode: 'EU_TOTAL',
        timeRange: timeRangeLabel,
      }),
    },
  );

  const rowByRegion = new Map(
    [...countryRegionResult, ...euSummaryResult].map((item) => [
      item.regionCode,
      item,
    ]),
  );

  const normalizedResult = ['US', 'EU_TOTAL', 'UK', 'DE', 'FR', 'ES', 'IT'].map(
    (regionCode) => ({
      region: regionLabelMap[regionCode] || regionCode,
      regionCode,
      timeRange: timeRangeLabel,
      ...buildEmptyDurationMetrics(),
      ...(rowByRegion.get(regionCode) || {}),
    }),
  );

  const generatedAt = formatDateToSqlText(new Date());
  await storeAnalyticsResult(
    cacheKey,
    latestCacheKey,
    normalizedResult,
    { source, generatedAt },
    ttlMs,
  );

  return finalizeAnalyticsResult(normalizedResult, {
    includeMeta,
    source,
    generatedAt,
  });
}

module.exports = {
  getAllCountriesSummary,
  getRegionSummary,
};
