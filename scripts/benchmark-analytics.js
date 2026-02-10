#!/usr/bin/env node
/**
 * Analytics API benchmark and comparison script.
 *
 * Example:
 * node scripts/benchmark-analytics.js ^
 *   --old-base http://127.0.0.1:3002 ^
 *   --new-base http://127.0.0.1:3001 ^
 *   --start-time "2026-02-01 00:00:00" ^
 *   --end-time "2026-02-07 23:59:59" ^
 *   --time-slot day ^
 *   --runs 6 ^
 *   --warmup 2 ^
 *   --token "YOUR_JWT"
 */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    i += 1;
  }
  return parsed;
}

function normalizeBaseUrl(baseUrl) {
  const trimmed = String(baseUrl || '')
    .trim()
    .replace(/\/+$/, '');
  if (!trimmed) {
    return '';
  }
  if (trimmed.endsWith('/api/v1')) {
    return trimmed;
  }
  return `${trimmed}/api/v1`;
}

function toNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toPercent(value) {
  if (!Number.isFinite(value)) {
    return 'N/A';
  }
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatMs(value) {
  if (!Number.isFinite(value)) {
    return 'N/A';
  }
  return `${value.toFixed(2)} ms`;
}

function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) {
    return NaN;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) {
    return sorted[low];
  }
  const weight = rank - low;
  return sorted[low] + (sorted[high] - sorted[low]) * weight;
}

function calcStats(items) {
  const durations = items
    .filter((x) => x.ok && Number.isFinite(x.durationMs))
    .map((x) => x.durationMs);

  const successCount = items.filter((x) => x.ok).length;
  const totalCount = items.length;
  const failCount = totalCount - successCount;
  const passRate = totalCount > 0 ? (successCount / totalCount) * 100 : 0;

  if (durations.length === 0) {
    return {
      count: totalCount,
      successCount,
      failCount,
      passRate,
      min: NaN,
      max: NaN,
      avg: NaN,
      p50: NaN,
      p90: NaN,
      p95: NaN,
    };
  }

  const sum = durations.reduce((acc, item) => acc + item, 0);
  const min = Math.min(...durations);
  const max = Math.max(...durations);
  return {
    count: totalCount,
    successCount,
    failCount,
    passRate,
    min,
    max,
    avg: sum / durations.length,
    p50: percentile(durations, 50),
    p90: percentile(durations, 90),
    p95: percentile(durations, 95),
  };
}

function nowTimestamp() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function buildQuery(params) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }
    const text = String(value).trim();
    if (!text) {
      return;
    }
    query.set(key, text);
  });
  return query.toString();
}

function usage() {
  return `
Usage:
  node scripts/benchmark-analytics.js --old-base <url> --new-base <url> [options]

Required:
  --old-base            Old project base URL (with or without /api/v1)
  --new-base            New project base URL (with or without /api/v1)
  --start-time          Start time. Default: 2026-02-01 00:00:00
  --end-time            End time.   Default: 2026-02-07 23:59:59

Optional:
  --time-slot           hour | day. Default: day
  --country             Country filter for period-summary (optional)
  --site                Site filter for period-summary (optional)
  --brand               Brand filter for period-summary (optional)
  --current             Pagination current. Default: 1
  --page-size           Pagination page size. Default: 100
  --runs                Measured runs per endpoint. Default: 5
  --warmup              Warmup runs per endpoint. Default: 2
  --timeout-ms          Request timeout in ms. Default: 120000
  --token               Bearer token (if endpoint requires auth)
  --label-old           Label for old target. Default: old
  --label-new           Label for new target. Default: new
  --output-dir          Output directory. Default: benchmark-results
  --dry-run             Print request URLs only, do not send requests
  --help                Show this help
`;
}

async function requestWithTiming(url, options) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, options.timeoutMs);
  const begin = process.hrtime.bigint();

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: options.headers,
      signal: controller.signal,
    });
    const rawText = await response.text();
    const end = process.hrtime.bigint();
    const durationMs = Number(end - begin) / 1e6;

    let body;
    try {
      body = rawText ? JSON.parse(rawText) : null;
    } catch (parseError) {
      body = { parseError: parseError.message, rawText };
    }

    const bodySuccess =
      body &&
      typeof body === 'object' &&
      Object.prototype.hasOwnProperty.call(body, 'success')
        ? body.success !== false
        : true;
    const ok = response.ok && bodySuccess;

    return {
      ok,
      status: response.status,
      durationMs,
      error: ok ? '' : `HTTP ${response.status}`,
      responseBody: body,
    };
  } catch (error) {
    const end = process.hrtime.bigint();
    const durationMs = Number(end - begin) / 1e6;
    const isTimeout =
      error &&
      (error.name === 'AbortError' || /aborted/i.test(error.message || ''));
    return {
      ok: false,
      status: 0,
      durationMs,
      error: isTimeout
        ? `Timeout after ${options.timeoutMs}ms`
        : error.message || 'Unknown error',
      responseBody: null,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function runOneEndpoint(target, endpoint, options) {
  const allRuns = [];

  for (let i = 0; i < options.warmup; i += 1) {
    const result = await requestWithTiming(endpoint.url, {
      timeoutMs: options.timeoutMs,
      headers: target.headers,
    });
    process.stdout.write(
      `[warmup] ${target.label} | ${endpoint.name} | ${i + 1}/${
        options.warmup
      } | ${formatMs(result.durationMs)} | ${result.ok ? 'ok' : 'fail'}\n`,
    );
  }

  for (let i = 0; i < options.runs; i += 1) {
    const result = await requestWithTiming(endpoint.url, {
      timeoutMs: options.timeoutMs,
      headers: target.headers,
    });
    allRuns.push({
      run: i + 1,
      ...result,
    });
    process.stdout.write(
      `[run]    ${target.label} | ${endpoint.name} | ${i + 1}/${
        options.runs
      } | ${formatMs(result.durationMs)} | ${
        result.ok ? 'ok' : `fail (${result.error})`
      }\n`,
    );
  }

  return {
    endpoint: endpoint.name,
    path: endpoint.path,
    query: endpoint.query,
    url: endpoint.url,
    stats: calcStats(allRuns),
    runs: allRuns,
  };
}

function buildMarkdown(result) {
  const lines = [];
  const createdAt = new Date(result.meta.createdAt).toISOString();
  lines.push('# Analytics Performance Comparison Report');
  lines.push('');
  lines.push(`- Created At: ${createdAt}`);
  lines.push(`- Old Target: ${result.meta.oldLabel} (${result.meta.oldBase})`);
  lines.push(`- New Target: ${result.meta.newLabel} (${result.meta.newBase})`);
  lines.push(`- Start Time: ${result.meta.startTime}`);
  lines.push(`- End Time: ${result.meta.endTime}`);
  lines.push(`- Time Slot: ${result.meta.timeSlot}`);
  lines.push(`- Warmup Runs: ${result.meta.warmup}`);
  lines.push(`- Measured Runs: ${result.meta.runs}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(
    '| Endpoint | Old Avg | New Avg | Avg Delta | Old P95 | New P95 | P95 Delta | Old Pass | New Pass |',
  );
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');

  result.summary.forEach((item) => {
    lines.push(
      `| ${item.endpoint} | ${formatMs(item.old.avg)} | ${formatMs(
        item.new.avg,
      )} | ${toPercent(item.deltaAvgPct)} | ${formatMs(
        item.old.p95,
      )} | ${formatMs(item.new.p95)} | ${toPercent(
        item.deltaP95Pct,
      )} | ${item.old.passRate.toFixed(2)}% | ${item.new.passRate.toFixed(
        2,
      )}% |`,
    );
  });

  lines.push('');
  lines.push('## Endpoints');
  lines.push('');
  result.endpoints.forEach((ep) => {
    lines.push(`### ${ep.name}`);
    lines.push('');
    lines.push(`- Path: \`${ep.path}\``);
    lines.push(`- Query: \`${ep.query || '(none)'}\``);
    lines.push('');
  });

  lines.push('## Notes');
  lines.push('');
  lines.push('- Delta is calculated as `(old - new) / old * 100%`.');
  lines.push('- Positive delta means the new project is faster.');
  lines.push(
    '- If pass rate is below 100%, check timeout, auth and data availability.',
  );
  lines.push('');

  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    process.exit(0);
  }

  const oldBaseRaw = args['old-base'] || process.env.BENCH_OLD_BASE_URL;
  const newBaseRaw =
    args['new-base'] ||
    process.env.BENCH_NEW_BASE_URL ||
    process.env.API_BASE_URL;
  const oldBase = normalizeBaseUrl(oldBaseRaw);
  const newBase = normalizeBaseUrl(newBaseRaw);

  if (!oldBase || !newBase) {
    process.stderr.write('Missing required --old-base or --new-base\n');
    process.stderr.write(usage());
    process.exit(1);
  }

  const startTime = args['start-time'] || '2026-02-01 00:00:00';
  const endTime = args['end-time'] || '2026-02-07 23:59:59';
  const timeSlot = (args['time-slot'] || 'day').toLowerCase();
  const runs = Math.max(1, toNumber(args.runs, 5));
  const warmup = Math.max(0, toNumber(args.warmup, 2));
  const timeoutMs = Math.max(1000, toNumber(args['timeout-ms'], 120000));
  const pageSize = Math.max(1, toNumber(args['page-size'], 100));
  const current = Math.max(1, toNumber(args.current, 1));
  const country = args.country || '';
  const site = args.site || '';
  const brand = args.brand || '';
  const oldLabel = args['label-old'] || 'old';
  const newLabel = args['label-new'] || 'new';
  const outputDir = args['output-dir'] || 'benchmark-results';
  const token = args.token || '';
  const dryRun = Boolean(args['dry-run']);

  const commonParams = {
    startTime,
    endTime,
    timeSlotGranularity: timeSlot,
  };
  const endpoints = [
    {
      name: 'all-countries-summary',
      path: '/monitor-history/statistics/all-countries-summary',
      params: commonParams,
    },
    {
      name: 'region-summary',
      path: '/monitor-history/statistics/region-summary',
      params: commonParams,
    },
    {
      name: 'period-summary',
      path: '/monitor-history/statistics/period-summary',
      params: {
        ...commonParams,
        country,
        site,
        brand,
        current,
        pageSize,
      },
    },
  ].map((endpoint) => {
    const query = buildQuery(endpoint.params);
    return {
      ...endpoint,
      query,
    };
  });

  const headers = {
    Accept: 'application/json',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const targets = [
    {
      label: oldLabel,
      base: oldBase,
      headers,
    },
    {
      label: newLabel,
      base: newBase,
      headers,
    },
  ];

  if (dryRun) {
    process.stdout.write('Dry run mode. URLs:\n');
    targets.forEach((target) => {
      endpoints.forEach((endpoint) => {
        const url = `${target.base}${endpoint.path}${
          endpoint.query ? `?${endpoint.query}` : ''
        }`;
        process.stdout.write(`- ${target.label}: ${url}\n`);
      });
    });
    process.exit(0);
  }

  const resultByTarget = {};
  for (const target of targets) {
    process.stdout.write(`\nTarget: ${target.label} (${target.base})\n`);
    resultByTarget[target.label] = {};
    for (const endpoint of endpoints) {
      const url = `${target.base}${endpoint.path}${
        endpoint.query ? `?${endpoint.query}` : ''
      }`;
      const endpointWithUrl = {
        ...endpoint,
        url,
      };
      const benchmark = await runOneEndpoint(target, endpointWithUrl, {
        warmup,
        runs,
        timeoutMs,
      });
      resultByTarget[target.label][endpoint.name] = benchmark;
    }
  }

  const summary = endpoints.map((endpoint) => {
    const oldStats = resultByTarget[oldLabel][endpoint.name].stats;
    const newStats = resultByTarget[newLabel][endpoint.name].stats;
    const deltaAvgPct =
      Number.isFinite(oldStats.avg) &&
      oldStats.avg > 0 &&
      Number.isFinite(newStats.avg)
        ? ((oldStats.avg - newStats.avg) / oldStats.avg) * 100
        : NaN;
    const deltaP95Pct =
      Number.isFinite(oldStats.p95) &&
      oldStats.p95 > 0 &&
      Number.isFinite(newStats.p95)
        ? ((oldStats.p95 - newStats.p95) / oldStats.p95) * 100
        : NaN;
    return {
      endpoint: endpoint.name,
      old: oldStats,
      new: newStats,
      deltaAvgPct,
      deltaP95Pct,
    };
  });

  const report = {
    meta: {
      createdAt: Date.now(),
      oldLabel,
      newLabel,
      oldBase,
      newBase,
      startTime,
      endTime,
      timeSlot,
      warmup,
      runs,
      timeoutMs,
      country,
      site,
      brand,
      current,
      pageSize,
    },
    endpoints,
    summary,
    resultByTarget,
  };

  const outDir = path.resolve(outputDir);
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = nowTimestamp();
  const jsonPath = path.join(outDir, `analytics-compare-${stamp}.json`);
  const mdPath = path.join(outDir, `analytics-compare-${stamp}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(mdPath, buildMarkdown(report), 'utf8');

  process.stdout.write('\nComparison summary:\n');
  summary.forEach((row) => {
    process.stdout.write(
      `- ${row.endpoint}: avg ${toPercent(row.deltaAvgPct)}, p95 ${toPercent(
        row.deltaP95Pct,
      )}\n`,
    );
  });
  process.stdout.write(`\nJSON report: ${jsonPath}\n`);
  process.stdout.write(`Markdown report: ${mdPath}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `${error && error.message ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
