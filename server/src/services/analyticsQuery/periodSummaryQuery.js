const {
  ANALYTICS_CACHE_VERSION,
  analyticsCacheService,
  buildPeriodSummaryGroupKey,
  buildQueryTimeRangeText,
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

async function getPeriodSummary(params = {}) {
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

  const cacheKey = `periodSummary:${ANALYTICS_CACHE_VERSION}:${country}:${site}:${brand}:${startTime}:${endTime}:${timeSlotGranularity}:${current}:${pageSize}`;
  const latestCacheKey = `periodSummary:${country}:${site}:${brand}:${timeSlotGranularity}:${current}:${pageSize}`;
  const periodSummaryCacheTtl =
    Number(process.env.ANALYTICS_PERIOD_SUMMARY_TTL_MS) || 300000;
  const cached = await analyticsCacheService.get(cacheKey);
  if (cached !== null) {
    logger.info(`[缓存命中] getPeriodSummary 缓存键: ${cacheKey}`);
    return resolveCachedAnalyticsResult(cached, includeMeta);
  }

  const busyFallbackResult = await getBusyFallbackAnalyticsResult(
    latestCacheKey,
    includeMeta,
    getAnalyticsBusyContext(),
  );
  if (busyFallbackResult) {
    logger.warn(
      `[统计查询] getPeriodSummary busy fallback hit, country=${country}, site=${site}, brand=${brand}`,
    );
    return busyFallbackResult;
  }
  logger.info(
    `[缓存未命中] getPeriodSummary 缓存键: ${cacheKey}，将查询数据库`,
  );

  const sourceGranularity = getDurationSourceGranularity(
    timeSlotGranularity,
    startTime,
    endTime,
  );
  const queryStartDate = parseDateTimeInput(startTime);
  const queryEndDate = parseDateTimeInput(endTime);
  const queryTimeRange = buildQueryTimeRangeText(startTime, endTime);
  const safeCurrent = Math.max(1, Number(current) || 1);
  const safePageSize = Math.max(1, Number(pageSize) || 10);
  const offset = (safeCurrent - 1) * safePageSize;
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
        country,
        site,
        brand,
        withDimensions: true,
      });
      logger.info('[统计查询] getPeriodSummary 使用聚合表');
      source = 'agg';
    } catch (error) {
      logger.warn('[统计查询] getPeriodSummary 聚合表读取失败，回退原始表', {
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
      country,
      site,
      brand,
    });
    source = 'raw';
  }

  const timeSlotDetails = buildDurationRowsByGroup(sourceRows, {
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
    const left = `${a.country}|${a.site}|${a.brand}|${a.timeSlot}`;
    const right = `${b.country}|${b.site}|${b.brand}|${b.timeSlot}`;
    return left.localeCompare(right);
  });

  const timeSlotMap = new Map();
  timeSlotDetails.forEach((item) => {
    const groupKey = buildPeriodSummaryGroupKey(
      item.country,
      item.site,
      item.brand,
    );
    if (!timeSlotMap.has(groupKey)) {
      timeSlotMap.set(groupKey, []);
    }
    timeSlotMap.get(groupKey).push(item);
  });

  const fullList = buildDurationRowsByGroup(sourceRows, {
    sourceGranularity,
    targetGranularity: sourceGranularity,
    queryStartDate,
    queryEndDate,
    buildGroupKey: (_, row) =>
      buildPeriodSummaryGroupKey(row.country, row.site, row.brand),
    buildGroupMeta: (_, row) => ({
      timeRange: queryTimeRange,
      country: row.country || '',
      site: row.site || '',
      brand: row.brand || '',
    }),
  })
    .sort((a, b) => {
      const left = `${a.country}|${a.site}|${a.brand}`;
      const right = `${b.country}|${b.site}|${b.brand}`;
      return left.localeCompare(right);
    })
    .map((item) => {
      const groupKey = buildPeriodSummaryGroupKey(
        item.country,
        item.site,
        item.brand,
      );
      return {
        ...item,
        timeSlotDetails: timeSlotMap.get(groupKey) || [],
      };
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

  await storeAnalyticsResult(
    cacheKey,
    latestCacheKey,
    finalResult,
    { source, generatedAt },
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

async function getPeriodSummaryTimeSlotDetails(params = {}) {
  const {
    country = '',
    site = '',
    brand = '',
    startTime = '',
    endTime = '',
    timeSlotGranularity = 'day',
    includeMeta = false,
  } = params;

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
        country,
        site,
        brand,
        withDimensions: true,
      });
      source = 'agg';
    } catch (error) {
      logger.warn(
        '[统计查询] getPeriodSummaryTimeSlotDetails 聚合表读取失败，回退原始表',
        { message: error?.message || String(error) },
      );
      sourceRows = null;
    }
  }

  if (!Array.isArray(sourceRows)) {
    sourceRows = await getDurationSourceRowsFromRaw({
      startTime,
      endTime,
      sourceGranularity,
      country,
      site,
      brand,
    });
    source = 'raw';
  }

  const result = buildDurationRowsByGroup(sourceRows, {
    sourceGranularity,
    targetGranularity: timeSlotGranularity,
    queryStartDate,
    queryEndDate,
    buildGroupKey: (targetPeriod) => targetPeriod,
    buildGroupMeta: (targetPeriod) => ({
      timeSlot: targetPeriod,
      country,
      site,
      brand,
    }),
  }).sort((a, b) =>
    String(a.timeSlot || '').localeCompare(String(b.timeSlot || '')),
  );

  return finalizeAnalyticsResult(result, {
    includeMeta,
    source,
    generatedAt: formatDateToSqlText(new Date()),
  });
}

module.exports = {
  getPeriodSummary,
  getPeriodSummaryTimeSlotDetails,
};
