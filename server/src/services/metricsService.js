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

module.exports = {
  register,
  recordHttpRequest,
  recordVariantGroupCheck,
  recordSchedulerRun,
};
