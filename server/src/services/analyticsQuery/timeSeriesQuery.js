const {
  ANALYTICS_CACHE_VERSION,
  analyticsCacheService,
  finalizeAnalyticsResult,
  formatDateToSqlText,
  getAnalyticsBusyContext,
  getBusyFallbackAnalyticsResult,
  logger,
  resolveCachedAnalyticsResult,
  storeAnalyticsResult,
} = require('./shared');
const {
  canUseAggForRange,
  isAggTableCoveringRange,
} = require('./repositories/aggCoverageRepository');
const {
  getRequestedSourceGranularity,
} = require('./repositories/durationTransformRepository');
const {
  getStatisticsByTimeFromAgg,
  getStatisticsByTimeFromRaw,
  hasHistoryInRange,
} = require('./repositories/timeSeriesRepository');

async function getStatisticsByTime(params = {}) {
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
  const latestCacheKey = `statisticsByTime:${country}:${groupBy}:${
    sourceGranularityOverride || 'auto'
  }`;
  const ttlMs =
    Number(process.env.ANALYTICS_STATISTICS_BY_TIME_TTL_MS) || 300000;
  const cached = await analyticsCacheService.get(cacheKey);
  if (cached !== null) {
    return resolveCachedAnalyticsResult(cached, includeMeta);
  }

  const busyContext = getAnalyticsBusyContext();
  const busyFallbackResult = await getBusyFallbackAnalyticsResult(
    latestCacheKey,
    includeMeta,
    busyContext,
  );
  if (busyFallbackResult) {
    logger.warn(
      `[统计查询] getStatisticsByTime busy fallback hit, country=${country}, groupBy=${groupBy}`,
    );
    return busyFallbackResult;
  }

  const sourceGranularity = getRequestedSourceGranularity(params);
  let list = null;
  let source = 'raw';
  const useAgg =
    process.env.ANALYTICS_AGG_ENABLED !== '0' &&
    canUseAggForRange(sourceGranularity, startTime, endTime);

  if (useAgg) {
    try {
      const isCovered = await isAggTableCoveringRange(
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
        list = await getStatisticsByTimeFromAgg(params);
        if (Array.isArray(list) && list.length === 0) {
          const hasRaw = await hasHistoryInRange(startTime, endTime);
          if (hasRaw) {
            list = null;
          }
        } else {
          logger.info('[统计查询] getStatisticsByTime 使用聚合表');
          source = 'agg';
        }
      }
    } catch (error) {
      logger.warn('[统计查询] getStatisticsByTime 聚合表读取失败，回退原始表', {
        message: error?.message || String(error),
      });
      list = null;
    }
  }

  if (list === null) {
    list = await getStatisticsByTimeFromRaw(params);
    source = 'raw';
  }

  const generatedAt = formatDateToSqlText(new Date());
  await storeAnalyticsResult(
    cacheKey,
    latestCacheKey,
    list,
    { source, generatedAt },
    ttlMs,
  );

  return finalizeAnalyticsResult(list, {
    includeMeta,
    source,
    generatedAt,
  });
}

module.exports = {
  getStatisticsByTime,
};
