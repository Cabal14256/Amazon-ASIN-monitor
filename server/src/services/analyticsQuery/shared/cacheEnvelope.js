const { getPoolStatus } = require('../../../config/database');
const analyticsCacheService = require('../../analyticsCacheService');
const analyticsAggService = require('../../analyticsAggService');
const { formatDateToSqlText } = require('./timeUtils');

const ANALYTICS_CACHE_VERSION = 'full-history-v2';

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

module.exports = {
  ANALYTICS_CACHE_VERSION,
  finalizeAnalyticsResult,
  getAnalyticsBusyContext,
  getBusyFallbackAnalyticsResult,
  resolveCachedAnalyticsResult,
  storeAnalyticsResult,
};
