const {
  ANALYTICS_CACHE_VERSION,
  analyticsCacheService,
  finalizeAnalyticsResult,
  formatDateToSqlText,
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
const {
  getVariantGroupDurationSourceRowsFromAgg,
  getVariantGroupDurationSourceRowsFromRaw,
} = require('./repositories/variantGroupSourceRepository');

async function getASINStatisticsByCountry(params = {}) {
  const {
    country = '',
    startTime = '',
    endTime = '',
    includeMeta = false,
  } = params;

  const cacheKey = `asinStatisticsByCountry:${ANALYTICS_CACHE_VERSION}:${country}:${startTime}:${endTime}`;
  const latestCacheKey = `asinStatisticsByCountry:${country}`;
  const ttlMs = Number(process.env.ANALYTICS_ASIN_COUNTRY_TTL_MS) || 300000;
  const cached = await analyticsCacheService.get(cacheKey);
  if (cached !== null) {
    return resolveCachedAnalyticsResult(cached, includeMeta);
  }

  const sourceGranularity = getDurationSourceGranularity(
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
    canUseAggForRange(sourceGranularity, startTime, endTime);

  if (useAgg) {
    try {
      sourceRows = await getDurationSourceRowsFromAgg({
        country,
        startTime,
        endTime,
        sourceGranularity,
      });
      source = 'agg';
    } catch (error) {
      logger.warn(
        '[统计查询] getASINStatisticsByCountry 聚合表读取失败，回退原始表',
        { message: error?.message || String(error) },
      );
      sourceRows = null;
    }
  }

  if (!Array.isArray(sourceRows)) {
    sourceRows = await getDurationSourceRowsFromRaw({
      country,
      startTime,
      endTime,
      sourceGranularity,
    });
    source = 'raw';
  }

  const result = buildDurationRowsByGroup(sourceRows, {
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

async function getASINStatisticsByVariantGroup(params = {}) {
  const {
    country = '',
    startTime = '',
    endTime = '',
    limit = 10,
    includeMeta = false,
  } = params;

  const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 100));
  const cacheKey = `asinStatisticsByVariantGroup:${ANALYTICS_CACHE_VERSION}:${country}:${startTime}:${endTime}:${safeLimit}`;
  const latestCacheKey = `asinStatisticsByVariantGroup:${country}:${safeLimit}`;
  const ttlMs =
    Number(process.env.ANALYTICS_ASIN_VARIANT_GROUP_TTL_MS) || 300000;
  const cached = await analyticsCacheService.get(cacheKey);
  if (cached !== null) {
    return resolveCachedAnalyticsResult(cached, includeMeta);
  }

  const sourceGranularity = getDurationSourceGranularity(
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
    canUseAggForRange(sourceGranularity, startTime, endTime);

  if (useAgg) {
    try {
      sourceRows = await getVariantGroupDurationSourceRowsFromAgg({
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
      logger.info('[统计查询] getASINStatisticsByVariantGroup 使用聚合表');
    } catch (error) {
      logger.warn(
        '[统计查询] getASINStatisticsByVariantGroup 聚合表读取失败，回退原始表',
        { message: error?.message || String(error) },
      );
      sourceRows = null;
    }
  }

  if (!Array.isArray(sourceRows)) {
    sourceRows = await getVariantGroupDurationSourceRowsFromRaw({
      country,
      startTime,
      endTime,
      sourceGranularity,
    });
    source = 'raw';
  }

  const result = buildDurationRowsByGroup(sourceRows, {
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

module.exports = {
  getASINStatisticsByCountry,
  getASINStatisticsByVariantGroup,
};
