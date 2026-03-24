const client = require('prom-client');

const register = new client.Registry();
client.collectDefaultMetrics({
  register,
  prefix: 'amazon_asin_monitor_',
  gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5],
});

const httpRequestCounter = new client.Counter({
  name: 'amazon_asin_monitor_http_requests_total',
  help: 'HTTP 请求总数',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

const httpRequestDuration = new client.Histogram({
  name: 'amazon_asin_monitor_http_request_duration_seconds',
  help: 'HTTP 请求耗时（秒）',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
  buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 1, 2, 5],
});

const variantGroupChecks = new client.Counter({
  name: 'amazon_asin_monitor_variant_group_checks_total',
  help: '变体组监控执行次数',
  labelNames: ['region', 'result'],
  registers: [register],
});

const variantGroupCheckDuration = new client.Histogram({
  name: 'amazon_asin_monitor_variant_group_check_duration_seconds',
  help: '每次变体组监控耗时',
  labelNames: ['region'],
  registers: [register],
  buckets: [0.1, 0.5, 1, 2, 5, 10],
});

const schedulerRuns = new client.Counter({
  name: 'amazon_asin_monitor_scheduler_runs_total',
  help: '调度任务触发次数',
  labelNames: ['type'],
  registers: [register],
});

const schedulerRunDuration = new client.Histogram({
  name: 'amazon_asin_monitor_scheduler_run_duration_seconds',
  help: '调度任务执行耗时',
  labelNames: ['type'],
  registers: [register],
  buckets: [1, 5, 10, 30, 60, 120],
});

// 数据库查询指标
const dbQueryDuration = new client.Histogram({
  name: 'amazon_asin_monitor_db_query_duration_seconds',
  help: '数据库查询耗时（秒）',
  labelNames: ['table', 'operation'],
  registers: [register],
  buckets: [0.001, 0.01, 0.1, 0.5, 1, 2, 5],
});

const dbQueryCounter = new client.Counter({
  name: 'amazon_asin_monitor_db_queries_total',
  help: '数据库查询总数',
  labelNames: ['table', 'operation', 'status'],
  registers: [register],
});

// 缓存指标
const cacheHits = new client.Counter({
  name: 'amazon_asin_monitor_cache_hits_total',
  help: '缓存命中次数',
  labelNames: ['cache_key_prefix'],
  registers: [register],
});

const cacheMisses = new client.Counter({
  name: 'amazon_asin_monitor_cache_misses_total',
  help: '缓存未命中次数',
  labelNames: ['cache_key_prefix'],
  registers: [register],
});

const analyticsBusyFallbacks = new client.Counter({
  name: 'amazon_asin_monitor_analytics_busy_fallback_total',
  help: '数据分析繁忙降级到最近缓存的次数',
  labelNames: ['cache_key_prefix'],
  registers: [register],
});

const analyticsQueryTimeouts = new client.Counter({
  name: 'amazon_asin_monitor_analytics_query_timeouts_total',
  help: '数据分析查询超时次数',
  labelNames: ['query_name'],
  registers: [register],
});

const analyticsResponses = new client.Counter({
  name: 'amazon_asin_monitor_analytics_responses_total',
  help: '数据分析接口响应次数',
  labelNames: ['endpoint', 'status'],
  registers: [register],
});

const analyticsAggRefreshDuration = new client.Histogram({
  name: 'amazon_asin_monitor_analytics_agg_refresh_duration_seconds',
  help: '数据分析聚合刷新耗时（秒）',
  labelNames: ['table', 'granularity', 'status'],
  registers: [register],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300],
});

function recordHttpRequest({ method, route, status, durationSec }) {
  httpRequestCounter.labels(method, route, String(status)).inc();
  httpRequestDuration
    .labels(method, route, String(status))
    .observe(durationSec);
}

function recordVariantGroupCheck({ region, durationSec, isBroken }) {
  variantGroupChecks.labels(region, isBroken ? 'broken' : 'ok').inc();
  variantGroupCheckDuration.labels(region).observe(durationSec);
}

function recordSchedulerRun({ type, durationSec }) {
  schedulerRuns.labels(type).inc();
  schedulerRunDuration.labels(type).observe(durationSec);
}

/**
 * 记录数据库查询
 * @param {Object} params - 查询参数
 * @param {string} params.table - 表名
 * @param {string} params.operation - 操作类型 (SELECT, INSERT, UPDATE, DELETE)
 * @param {number} params.durationSec - 查询耗时（秒）
 * @param {string} params.status - 状态 (success, error)
 */
function recordDbQuery({ table, operation, durationSec, status = 'success' }) {
  dbQueryCounter.labels(table, operation, status).inc();
  if (status === 'success') {
    dbQueryDuration.labels(table, operation).observe(durationSec);
  }
}

/**
 * 记录缓存命中
 * @param {string} prefix - 缓存键前缀
 */
function recordCacheHit(prefix) {
  cacheHits.labels(prefix).inc();
}

/**
 * 记录缓存未命中
 * @param {string} prefix - 缓存键前缀
 */
function recordCacheMiss(prefix) {
  cacheMisses.labels(prefix).inc();
}

function recordAnalyticsBusyFallback(prefix) {
  analyticsBusyFallbacks.labels(prefix).inc();
}

function recordAnalyticsQueryTimeout(queryName) {
  analyticsQueryTimeouts.labels(queryName).inc();
}

function recordAnalyticsResponse({ endpoint, status }) {
  analyticsResponses.labels(endpoint, String(status)).inc();
}

function recordAnalyticsAggRefresh({
  table,
  granularity,
  status = 'success',
  durationSec,
}) {
  analyticsAggRefreshDuration
    .labels(table, granularity, status)
    .observe(durationSec);
}

module.exports = {
  register,
  recordHttpRequest,
  recordVariantGroupCheck,
  recordSchedulerRun,
  recordDbQuery,
  recordCacheHit,
  recordCacheMiss,
  recordAnalyticsAggRefresh,
  recordAnalyticsBusyFallback,
  recordAnalyticsQueryTimeout,
  recordAnalyticsResponse,
};
