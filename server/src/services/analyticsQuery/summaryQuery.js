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
  getSummaryDurationSourceGranularity,
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
    forceAgg = false, // 强制使用聚合表，避免原始表全表扫描
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

  const sourceGranularity = getSummaryDurationSourceGranularity(
    timeSlotGranularity,
    startTime,
    endTime,
  );
  const queryStartDate = parseDateTimeInput(startTime);
  const queryEndDate = parseDateTimeInput(endTime);
  let sourceRows = null;
  let source = 'raw';

  // 检查是否可以使用聚合表
  // 如果查询时间范围超出聚合表覆盖范围，记录警告并返回降级数据
  const aggAvailable =
    process.env.ANALYTICS_AGG_ENABLED !== '0' &&
    canUseAggForRange(sourceGranularity, startTime, endTime);

  if (aggAvailable || forceAgg) {
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
  } else {
    logger.warn(
      `[统计查询] getAllCountriesSummary 查询范围超出聚合表覆盖，将使用原始表，性能可能受影响。` +
        `建议：1) 缩小查询时间范围 2) 等待聚合表数据补齐 3) 联系管理员检查聚合任务状态`,
    );
  }

  // 原始表查询作为降级方案，但增加时间范围限制避免超时
  if (!Array.isArray(sourceRows)) {
    // 计算查询时间范围天数
    const dayDiff =
      queryStartDate && queryEndDate
        ? Math.ceil((queryEndDate - queryStartDate) / (1000 * 60 * 60 * 24))
        : 0;

    // 如果查询范围超过7天且没有聚合表支持，限制返回空数据并提示
    const maxRawQueryDays =
      Number(process.env.ANALYTICS_MAX_RAW_QUERY_DAYS) || 7;
    if (
      sourceGranularity === 'hour' &&
      dayDiff > maxRawQueryDays &&
      !aggAvailable
    ) {
      logger.error(
        `[统计查询] getAllCountriesSummary 查询范围过大(${dayDiff}天)且无聚合表支持，返回降级数据以避免超时。` +
          `请缩小时间范围至${maxRawQueryDays}天内，或检查聚合表状态`,
      );
      return finalizeAnalyticsResult(
        {
          timeRange: startTime && endTime ? `${startTime} ~ ${endTime}` : '',
          ...buildEmptyDurationMetrics(),
          _degraded: true,
          _degradedReason: '查询范围过大且无聚合表支持',
        },
        {
          includeMeta,
          source: 'degraded',
          generatedAt: formatDateToSqlText(new Date()),
        },
      );
    }

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

  const sourceGranularity = getSummaryDurationSourceGranularity(
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
