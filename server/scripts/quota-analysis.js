const REGION_COUNTRIES = {
  US: new Set(['US']),
  EU: new Set(['UK', 'DE', 'FR', 'IT', 'ES']),
};

const DATABASE_CONFIG_KEYS = [
  'MONITOR_US_SCHEDULE_MINUTES',
  'MONITOR_EU_SCHEDULE_MINUTES',
  'COMPETITOR_MONITOR_ENABLED',
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
  const setting = (key, fallback) =>
    databaseConfig[key] !== undefined
      ? databaseConfig[key]
      : env[key] ?? fallback;

  return {
    usIntervalMinutes: normalizeScheduleInterval(
      setting('MONITOR_US_SCHEDULE_MINUTES', 30),
      30,
    ),
    euIntervalMinutes: normalizeScheduleInterval(
      setting('MONITOR_EU_SCHEDULE_MINUTES', 60),
      60,
    ),
    competitorEnabled: parseBoolean(
      setting('COMPETITOR_MONITOR_ENABLED', true),
      true,
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

function createRegionSummary() {
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
    US: createRegionSummary(),
    EU: createRegionSummary(),
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
      summary.groupCount += 1;
      summary.asinCount += group.asinCount;
      for (const [key, value] of Object.entries(bounds)) {
        summary[key] += value;
      }
    }

    for (const group of omitted) {
      summary.omittedGroupCount += 1;
      summary.omittedAsinCount += group.asinCount;
    }
  }

  return byRegion;
}

function combineRegionSummaries(...summaries) {
  const result = createRegionSummary();
  for (const summary of summaries) {
    for (const key of Object.keys(result)) {
      result[key] += Number(summary?.[key]) || 0;
    }
  }
  return result;
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
  };
}

module.exports = {
  DATABASE_CONFIG_KEYS,
  REGION_COUNTRIES,
  buildCompetitorDatabaseConfig,
  buildMainDatabaseConfig,
  calculateGroupRequestBounds,
  combineRegionSummaries,
  parseBoolean,
  projectRegionWorkload,
  resolveEffectiveConfig,
  summarizeInventory,
};
