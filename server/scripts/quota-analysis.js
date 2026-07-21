const REGION_COUNTRIES = {
  US: new Set(['US']),
  EU: new Set(['UK', 'DE', 'FR', 'IT', 'ES']),
};

const DATABASE_CONFIG_KEYS = [
  'MONITOR_US_SCHEDULE_MINUTES',
  'MONITOR_EU_SCHEDULE_MINUTES',
  'COMPETITOR_MONITOR_ENABLED',
];

const SUMMARY_FIELDS = [
  'groupCount',
  'asinCount',
  'omittedGroupCount',
  'omittedAsinCount',
  'getCatalogItemMin',
  'getCatalogItemMax',
  'searchCatalogItems',
  'requestMin',
  'requestMax',
];

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseNonNegativeInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeScheduleInterval(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return [15, 30, 60].includes(parsed) ? parsed : fallback;
}

function toConfigMap(rows = []) {
  return Object.fromEntries(
    rows.map((row) => [row.config_key, row.config_value]),
  );
}

function resolveEffectiveConfig(env = process.env, configRows = []) {
  const databaseConfig = toConfigMap(configRows);
  const envUsInterval = normalizeScheduleInterval(
    env.MONITOR_US_SCHEDULE_MINUTES,
    30,
  );
  const envEuInterval = normalizeScheduleInterval(
    env.MONITOR_EU_SCHEDULE_MINUTES,
    60,
  );
  const envCompetitorEnabled = parseBoolean(
    env.COMPETITOR_MONITOR_ENABLED,
    true,
  );

  return {
    usIntervalMinutes: normalizeScheduleInterval(
      databaseConfig.MONITOR_US_SCHEDULE_MINUTES,
      envUsInterval,
    ),
    euIntervalMinutes: normalizeScheduleInterval(
      databaseConfig.MONITOR_EU_SCHEDULE_MINUTES,
      envEuInterval,
    ),
    competitorEnabled: parseBoolean(
      databaseConfig.COMPETITOR_MONITOR_ENABLED,
      envCompetitorEnabled,
    ),
    batchCount: parsePositiveInteger(env.MONITOR_BATCH_COUNT, 1),
    batchAsinThreshold: parseNonNegativeInteger(
      env.MONITOR_BATCH_ASIN_THRESHOLD,
      0,
    ),
    maxGroupsPerTask: parseNonNegativeInteger(
      env.MONITOR_MAX_GROUPS_PER_TASK,
      0,
    ),
    regionPerMinuteLimit: parsePositiveInteger(
      env.SP_API_RATE_LIMIT_PER_MINUTE,
      60,
    ),
    regionPerHourLimit: parsePositiveInteger(
      env.SP_API_RATE_LIMIT_PER_HOUR,
      1000,
    ),
  };
}

function buildMainDatabaseConfig(env = process.env) {
  return {
    host: env.DB_HOST || 'localhost',
    port: Number(env.DB_PORT) || 3306,
    user: env.DB_USER || 'root',
    password: env.DB_PASSWORD || '',
    database: env.DB_NAME || 'amazon_asin_monitor',
    charset: 'utf8mb4',
    timezone: '+08:00',
  };
}

function buildCompetitorDatabaseConfig(env = process.env) {
  return {
    host: env.COMPETITOR_DB_HOST || env.DB_HOST || 'localhost',
    port: Number(env.COMPETITOR_DB_PORT || env.DB_PORT) || 3306,
    user: env.COMPETITOR_DB_USER || env.DB_USER || 'root',
    password:
      env.COMPETITOR_DB_PASSWORD !== undefined
        ? env.COMPETITOR_DB_PASSWORD
        : env.DB_PASSWORD || '',
    database: env.COMPETITOR_DB_NAME || env.DB_NAME || 'amazon_asin_monitor',
    charset: 'utf8mb4',
    timezone: '+08:00',
  };
}

function findRegion(country) {
  for (const [region, countries] of Object.entries(REGION_COUNTRIES)) {
    if (countries.has(country)) return region;
  }
  return null;
}

function createUsageSummary() {
  return {
    groupCount: 0,
    asinCount: 0,
    omittedGroupCount: 0,
    omittedAsinCount: 0,
    getCatalogItemMin: 0,
    getCatalogItemMax: 0,
    searchCatalogItems: 0,
    requestMin: 0,
    requestMax: 0,
  };
}

function createRegionSummary(batchCount = 1) {
  const normalizedBatchCount = Math.max(parsePositiveInteger(batchCount, 1), 1);
  return {
    ...createUsageSummary(),
    batches: Array.from({ length: normalizedBatchCount }, (_, batchIndex) => ({
      batchIndex,
      ...createUsageSummary(),
    })),
  };
}

function addUsageSummary(target, source) {
  for (const key of SUMMARY_FIELDS) {
    target[key] += Number(source?.[key]) || 0;
  }
}

function getBatchIndex(hashValue, batchCount) {
  if (batchCount <= 1) return 0;
  const hash = Number(hashValue) || 0;
  return ((hash % batchCount) + batchCount) % batchCount;
}

function calculateGroupRequestBounds(
  asinCount,
  batchAsinThreshold,
  allowBatchApi,
) {
  if (
    allowBatchApi &&
    batchAsinThreshold > 0 &&
    asinCount >= batchAsinThreshold
  ) {
    const searchCalls = Math.ceil(asinCount / 20);
    return {
      getCatalogItemMin: 0,
      getCatalogItemMax: asinCount,
      searchCatalogItems: searchCalls,
      requestMin: searchCalls,
      requestMax: searchCalls + asinCount,
    };
  }

  return {
    getCatalogItemMin: asinCount,
    getCatalogItemMax: asinCount,
    searchCatalogItems: 0,
    requestMin: asinCount,
    requestMax: asinCount,
  };
}

function summarizeInventory(
  rows,
  {
    batchCount = 1,
    maxGroupsPerTask = 0,
    batchAsinThreshold = 0,
    allowBatchApi = false,
  } = {},
) {
  const byRegion = {
    US: createRegionSummary(batchCount),
    EU: createRegionSummary(batchCount),
  };
  const buckets = new Map();

  for (const row of rows) {
    const country = String(row.country || '').toUpperCase();
    const region = findRegion(country);
    if (!region) continue;
    const batchIndex = getBatchIndex(row.hash_value, batchCount);
    const key = `${region}:${country}:${batchIndex}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push({
      ...row,
      country,
      region,
      batchIndex,
      asinCount: Number(row.asin_count) || 0,
    });
  }

  for (const groups of buckets.values()) {
    groups.sort((left, right) => {
      const timeCompare = String(left.create_time || '').localeCompare(
        String(right.create_time || ''),
      );
      return timeCompare || String(left.id).localeCompare(String(right.id));
    });

    const selected =
      maxGroupsPerTask > 0 ? groups.slice(0, maxGroupsPerTask) : groups;
    const omitted = maxGroupsPerTask > 0 ? groups.slice(maxGroupsPerTask) : [];
    const region = groups[0].region;
    const summary = byRegion[region];

    for (const group of selected) {
      const bounds = calculateGroupRequestBounds(
        group.asinCount,
        batchAsinThreshold,
        allowBatchApi,
      );
      const usage = {
        ...createUsageSummary(),
        groupCount: 1,
        asinCount: group.asinCount,
        ...bounds,
      };
      addUsageSummary(summary, usage);
      addUsageSummary(summary.batches[group.batchIndex], usage);
    }

    for (const group of omitted) {
      const omittedUsage = {
        ...createUsageSummary(),
        omittedGroupCount: 1,
        omittedAsinCount: group.asinCount,
      };
      addUsageSummary(summary, omittedUsage);
      addUsageSummary(summary.batches[group.batchIndex], omittedUsage);
    }
  }

  return byRegion;
}

function combineRegionSummaries(...summaries) {
  const batchCount = Math.max(
    1,
    ...summaries.map((summary) => summary?.batches?.length || 0),
  );
  const result = createRegionSummary(batchCount);
  for (const summary of summaries) {
    addUsageSummary(result, summary);
    for (let batchIndex = 0; batchIndex < batchCount; batchIndex += 1) {
      addUsageSummary(
        result.batches[batchIndex],
        summary?.batches?.[batchIndex],
      );
    }
  }
  return result;
}

function getBatchRequestValues(summary, batchCount, field) {
  const divisor = Math.max(batchCount, 1);
  if (summary?.batches?.length > 0) {
    return Array.from(
      { length: divisor },
      (_, batchIndex) => Number(summary.batches[batchIndex]?.[field]) || 0,
    );
  }
  const average = (Number(summary?.[field]) || 0) / divisor;
  return Array.from({ length: divisor }, () => average);
}

function calculatePeakRollingWindow(values, windowSize) {
  if (values.length === 0) return 0;
  let peak = 0;
  for (let start = 0; start < values.length; start += 1) {
    let total = 0;
    for (let offset = 0; offset < windowSize; offset += 1) {
      total += values[(start + offset) % values.length];
    }
    peak = Math.max(peak, total);
  }
  return peak;
}

function projectRegionWorkload(
  summary,
  intervalMinutes,
  batchCount,
  { perMinute, perHour },
) {
  const runsPerHour = 60 / intervalMinutes;
  const divisor = Math.max(batchCount, 1);
  const requestMinPerHour = (summary.requestMin / divisor) * runsPerHour;
  const requestMaxPerHour = (summary.requestMax / divisor) * runsPerHour;
  const batchRequestMins = getBatchRequestValues(
    summary,
    divisor,
    'requestMin',
  );
  const batchRequestMaxes = getBatchRequestValues(
    summary,
    divisor,
    'requestMax',
  );
  const peakBatchRequestMin = Math.max(...batchRequestMins, 0);
  const peakBatchRequestMax = Math.max(...batchRequestMaxes, 0);
  const runsPerRollingHour = Math.max(Math.floor(runsPerHour), 1);
  const peakRollingHourRequestMin = calculatePeakRollingWindow(
    batchRequestMins,
    runsPerRollingHour,
  );
  const peakRollingHourRequestMax = calculatePeakRollingWindow(
    batchRequestMaxes,
    runsPerRollingHour,
  );

  return {
    runsPerHour,
    fullSweepMinutes: intervalMinutes * divisor,
    requestMinPerHour,
    requestMaxPerHour,
    requestMinPerMinute: requestMinPerHour / 60,
    requestMaxPerMinute: requestMaxPerHour / 60,
    minuteUsageMinPercent: (requestMinPerHour / 60 / perMinute) * 100,
    minuteUsageMaxPercent: (requestMaxPerHour / 60 / perMinute) * 100,
    hourUsageMinPercent: (requestMinPerHour / perHour) * 100,
    hourUsageMaxPercent: (requestMaxPerHour / perHour) * 100,
    peakBatchRequestMin,
    peakBatchRequestMax,
    peakRollingHourRequestMin,
    peakRollingHourRequestMax,
    peakMinuteUsageMinPercent: (peakBatchRequestMin / perMinute) * 100,
    peakMinuteUsageMaxPercent: (peakBatchRequestMax / perMinute) * 100,
    peakHourUsageMinPercent: (peakRollingHourRequestMin / perHour) * 100,
    peakHourUsageMaxPercent: (peakRollingHourRequestMax / perHour) * 100,
    batchRequests: batchRequestMins.map((requestMin, batchIndex) => ({
      batchIndex,
      requestMin,
      requestMax: batchRequestMaxes[batchIndex],
    })),
  };
}

module.exports = {
  DATABASE_CONFIG_KEYS,
  REGION_COUNTRIES,
  buildCompetitorDatabaseConfig,
  buildMainDatabaseConfig,
  calculateGroupRequestBounds,
  calculatePeakRollingWindow,
  combineRegionSummaries,
  parseBoolean,
  projectRegionWorkload,
  resolveEffectiveConfig,
  summarizeInventory,
};
