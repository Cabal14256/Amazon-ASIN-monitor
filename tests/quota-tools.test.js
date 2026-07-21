process.env.LOG_LEVEL = 'ERROR';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildCompetitorDatabaseConfig,
  calculateGroupRequestBounds,
  combineRegionSummaries,
  projectRegionWorkload,
  resolveEffectiveConfig,
  summarizeInventory,
} = require('../server/scripts/quota-analysis');
const { analyzeQuotaUsage } = require('../server/scripts/analyze-quota-usage');
const {
  assertDistributedSnapshots,
  formatUsage,
  parseArgs,
} = require('../server/scripts/monitor-quota-realtime');
const {
  MultiLevelRateLimiter,
  acquireWithLimiters,
  tryConsumeMemoryWithLimiters,
} = require('../server/src/services/rateLimiter');
const {
  calculateFullSweepIntervalMinutes,
  calculateScheduledBatchIndex,
} = require('../server/src/utils/monitorBatch');

function createInventoryRow({ id, country, asinCount, hashValue, createTime }) {
  return {
    id,
    country,
    asin_count: asinCount,
    hash_value: hashValue,
    create_time: createTime,
  };
}

test('数据库中的调度与竞品配置优先于环境变量', () => {
  const config = resolveEffectiveConfig(
    {
      MONITOR_US_SCHEDULE_MINUTES: '15',
      MONITOR_EU_SCHEDULE_MINUTES: '15',
      COMPETITOR_MONITOR_ENABLED: 'false',
      MONITOR_BATCH_COUNT: '3',
      SP_API_RATE_LIMIT_PER_MINUTE: '80',
      SP_API_RATE_LIMIT_PER_HOUR: '2000',
    },
    [
      { config_key: 'MONITOR_US_SCHEDULE_MINUTES', config_value: '60' },
      { config_key: 'MONITOR_EU_SCHEDULE_MINUTES', config_value: '30' },
      { config_key: 'COMPETITOR_MONITOR_ENABLED', config_value: 'true' },
    ],
  );

  assert.equal(config.usIntervalMinutes, 60);
  assert.equal(config.euIntervalMinutes, 30);
  assert.equal(config.competitorEnabled, true);
  assert.equal(config.batchCount, 3);
  assert.equal(config.regionPerMinuteLimit, 80);
  assert.equal(config.regionPerHourLimit, 2000);
});

test('竞品数据库使用独立配置并按主营配置回退', () => {
  assert.deepEqual(
    buildCompetitorDatabaseConfig({
      DB_HOST: 'main-db',
      DB_PORT: '3307',
      DB_USER: 'main-user',
      DB_PASSWORD: 'main-password',
      DB_NAME: 'main-schema',
      COMPETITOR_DB_HOST: 'competitor-db',
      COMPETITOR_DB_NAME: 'competitor-schema',
    }),
    {
      host: 'competitor-db',
      port: 3307,
      user: 'main-user',
      password: 'main-password',
      database: 'competitor-schema',
      charset: 'utf8mb4',
      timezone: '+08:00',
    },
  );
});

test('计划调用按完整批次轮转折算且不额外乘二', () => {
  const standard = summarizeInventory(
    [
      createInventoryRow({
        id: 'group-1',
        country: 'US',
        asinCount: 10,
        hashValue: 0,
        createTime: '2026-01-01 00:00:00',
      }),
      createInventoryRow({
        id: 'group-2',
        country: 'US',
        asinCount: 6,
        hashValue: 1,
        createTime: '2026-01-02 00:00:00',
      }),
    ],
    { batchCount: 2 },
  );
  const competitor = summarizeInventory(
    [
      createInventoryRow({
        id: 'competitor-1',
        country: 'US',
        asinCount: 4,
        hashValue: 0,
        createTime: '2026-01-01 00:00:00',
      }),
    ],
    { batchCount: 2 },
  );
  const combined = combineRegionSummaries(standard.US, competitor.US);
  const projection = projectRegionWorkload(combined, 30, 2, {
    perMinute: 60,
    perHour: 1000,
  });

  assert.equal(combined.requestMin, 20);
  assert.equal(combined.requestMax, 20);
  assert.equal(projection.fullSweepMinutes, 60);
  assert.equal(projection.requestMinPerHour, 20);
  assert.equal(projection.requestMaxPerHour, 20);
});

test('实验性批量查询输出上下界，任务上限报告遗漏对象', () => {
  const summary = summarizeInventory(
    [
      createInventoryRow({
        id: 'first',
        country: 'US',
        asinCount: 25,
        hashValue: 0,
        createTime: '2026-01-01 00:00:00',
      }),
      createInventoryRow({
        id: 'second',
        country: 'US',
        asinCount: 10,
        hashValue: 0,
        createTime: '2026-01-02 00:00:00',
      }),
    ],
    {
      batchCount: 1,
      maxGroupsPerTask: 1,
      batchAsinThreshold: 20,
      allowBatchApi: true,
    },
  ).US;

  assert.deepEqual(calculateGroupRequestBounds(25, 20, true), {
    getCatalogItemMin: 0,
    getCatalogItemMax: 25,
    searchCatalogItems: 2,
    requestMin: 2,
    requestMax: 27,
  });
  assert.equal(summary.requestMin, 2);
  assert.equal(summary.requestMax, 27);
  assert.equal(summary.omittedGroupCount, 1);
  assert.equal(summary.omittedAsinCount, 10);
});

function createFakeMysql({ competitorEnabled = true, failCompetitor = false }) {
  const connectionNames = [];
  const closed = [];
  const mysqlModule = {
    async createConnection(config) {
      connectionNames.push(config.database);
      const isCompetitor = config.database === 'competitor-schema';
      return {
        async execute(sql) {
          if (sql.includes('FROM sp_api_config')) {
            return [
              [
                {
                  config_key: 'COMPETITOR_MONITOR_ENABLED',
                  config_value: competitorEnabled ? 'true' : 'false',
                },
              ],
            ];
          }
          if (sql.includes('FROM competitor_variant_groups')) {
            if (failCompetitor) {
              const error = new Error('competitor table missing');
              error.code = 'ER_NO_SUCH_TABLE';
              throw error;
            }
            return [
              [
                createInventoryRow({
                  id: 'competitor',
                  country: 'US',
                  asinCount: 2,
                  hashValue: 0,
                  createTime: '2026-01-01 00:00:00',
                }),
              ],
            ];
          }
          return [
            [
              createInventoryRow({
                id: 'main',
                country: 'US',
                asinCount: 3,
                hashValue: 0,
                createTime: '2026-01-01 00:00:00',
              }),
            ],
          ];
        },
        async end() {
          closed.push(isCompetitor ? 'competitor' : 'main');
        },
      };
    },
  };
  return { mysqlModule, connectionNames, closed };
}

test('分析器分别连接主营和竞品数据库', async () => {
  const fake = createFakeMysql({ competitorEnabled: true });
  const result = await analyzeQuotaUsage({
    env: {
      DB_NAME: 'main-schema',
      COMPETITOR_DB_NAME: 'competitor-schema',
      MONITOR_BATCH_COUNT: '1',
    },
    mysqlModule: fake.mysqlModule,
  });

  assert.deepEqual(fake.connectionNames, ['main-schema', 'competitor-schema']);
  assert.deepEqual(fake.closed.sort(), ['competitor', 'main']);
  assert.equal(result.standardByRegion.US.asinCount, 3);
  assert.equal(result.competitorByRegion.US.asinCount, 2);
  assert.equal(result.taskProjections.US.standard.requestMinPerHour, 6);
  assert.equal(result.taskProjections.US.competitor.requestMinPerHour, 4);
  assert.equal(result.projections.US.requestMinPerHour, 10);
});

test('竞品关闭时不连接竞品库，开启但查询失败时整体失败', async () => {
  const disabled = createFakeMysql({ competitorEnabled: false });
  await analyzeQuotaUsage({
    env: {
      DB_NAME: 'main-schema',
      COMPETITOR_DB_NAME: 'competitor-schema',
    },
    mysqlModule: disabled.mysqlModule,
  });
  assert.deepEqual(disabled.connectionNames, ['main-schema']);

  const failed = createFakeMysql({
    competitorEnabled: true,
    failCompetitor: true,
  });
  await assert.rejects(
    analyzeQuotaUsage({
      env: {
        DB_NAME: 'main-schema',
        COMPETITOR_DB_NAME: 'competitor-schema',
      },
      mysqlModule: failed.mysqlModule,
    }),
    /competitor table missing/,
  );
  assert.deepEqual(failed.closed.sort(), ['competitor', 'main']);
});

test('调度批次在所有支持间隔下完整轮转', () => {
  const base = new Date('2026-01-01T00:00:00.000Z');
  for (const intervalMinutes of [15, 30, 60]) {
    for (const totalBatches of [2, 3, 4]) {
      const indexes = Array.from({ length: totalBatches }, (_, offset) =>
        calculateScheduledBatchIndex(
          new Date(base.getTime() + offset * intervalMinutes * 60 * 1000),
          intervalMinutes,
          totalBatches,
        ),
      );
      assert.equal(new Set(indexes).size, totalBatches);
      assert.equal(
        calculateFullSweepIntervalMinutes(intervalMinutes, totalBatches),
        intervalMinutes * totalBatches,
      );
    }
  }
});

test('区域和 operation 的全部 Redis 窗口在一次 Lua 调用中扣减', async () => {
  const regionLimiter = new MultiLevelRateLimiter({
    name: 'US:region',
    perMinute: 10,
    perHour: 100,
  });
  const operationLimiter = new MultiLevelRateLimiter({
    name: 'US:operation:getCatalogItem',
    rate: 2,
    burst: 2,
    perMinute: 120,
    perHour: 7200,
  });
  let evalCall = null;
  const client = {
    async get() {
      return null;
    },
    async eval(script, keyCount, ...payload) {
      evalCall = { script, keyCount, payload };
      return [1, 0];
    },
  };
  regionLimiter.getDistributedRedisClient = async () => client;

  await acquireWithLimiters(regionLimiter, operationLimiter, 2, 3);

  assert.equal(evalCall.keyCount, 5);
  assert.equal(evalCall.payload[evalCall.keyCount + 2], 5);
  assert.equal(evalCall.payload[evalCall.keyCount + 3], 2);
  assert.equal(regionLimiter.lastMode, 'redis-distributed');
  assert.equal(operationLimiter.lastMode, 'redis-distributed');
});

test('内存回退在 operation 不可用时不会提前消耗区域额度', () => {
  const regionLimiter = new MultiLevelRateLimiter({
    name: 'US:region',
    perMinute: 1,
    perHour: 1,
  });
  const blockedOperation = new MultiLevelRateLimiter({
    name: 'US:operation:getCatalogItem',
    perMinute: 1,
    perHour: 1,
  });
  const availableOperation = new MultiLevelRateLimiter({
    name: 'US:operation:searchCatalogItems',
    perMinute: 1,
    perHour: 1,
  });
  blockedOperation.minuteLimiter.tokens = 0;
  blockedOperation.minuteLimiter.lastRefill = Date.now();

  assert.equal(
    tryConsumeMemoryWithLimiters([regionLimiter, blockedOperation], 1),
    false,
  );
  assert.equal(regionLimiter.minuteLimiter.tokens, 1);
  assert.equal(regionLimiter.hourLimiter.tokens, 1);
  assert.equal(
    tryConsumeMemoryWithLimiters([regionLimiter, availableOperation], 1),
    true,
  );
  assert.equal(regionLimiter.minuteLimiter.tokens, 0);
  assert.equal(regionLimiter.hourLimiter.tokens, 0);
});

test('Redis 分布式限流按每个窗口三个参数编码 Lua 入参', async () => {
  const limiter = new MultiLevelRateLimiter({
    name: 'US:operation:getCatalogItem',
    rate: 2,
    burst: 2,
    perMinute: 120,
    perHour: 7200,
  });
  let evalCall = null;
  limiter.getDistributedRedisClient = async () => ({
    async eval(script, keyCount, ...payload) {
      evalCall = { script, keyCount, payload };
      return [1, 0];
    },
  });

  assert.equal(await limiter.acquireDistributed(), true);
  assert.equal(evalCall.keyCount, 3);
  assert.equal(
    evalCall.payload.slice(evalCall.keyCount).length,
    4 + evalCall.keyCount * 3,
  );
  assert.equal(evalCall.payload[evalCall.keyCount + 3], 1);
  assert.equal(
    Array.from(evalCall.script.matchAll(/\(\(i - 1\) \* 3\)/g)).length,
    2,
  );
});

test('Redis 快照清理窗口并采用响应头限额元数据', async () => {
  const removed = [];
  const counts = { second: 2, minute: 5, hour: 20 };
  let evalCall = null;
  const limiter = new MultiLevelRateLimiter({
    name: 'US:operation:getCatalogItem',
    rate: 2,
    burst: 2,
    perMinute: 120,
    perHour: 7200,
  });
  limiter.getDistributedRedisClient = async () => ({
    async get() {
      return JSON.stringify({
        rate: 1,
        burst: 3,
        source: 'response_header',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
    },
    async eval(script, keyCount, ...payload) {
      evalCall = { script, keyCount, payload };
      return [1, 0];
    },
    async zremrangebyscore(key, minimum, maximum) {
      removed.push({ key, minimum, maximum });
    },
    async zcard(key) {
      return counts[key.split(':').pop()];
    },
  });

  assert.equal(await limiter.acquireDistributed(), true);
  const acquireArgs = evalCall.payload.slice(evalCall.keyCount);
  assert.deepEqual(
    [acquireArgs[4], acquireArgs[7], acquireArgs[10]],
    [3, 60, 3600],
  );

  const snapshot = await limiter.getStatusSnapshot();
  assert.equal(snapshot.mode, 'redis-distributed');
  assert.equal(snapshot.limitSource, 'response_header');
  assert.equal(snapshot.windows.second.limit, 3);
  assert.equal(snapshot.windows.second.remaining, 1);
  assert.equal(snapshot.windows.minute.limit, 60);
  assert.equal(snapshot.windows.minute.remaining, 55);
  assert.equal(snapshot.windows.hour.limit, 3600);
  assert.equal(snapshot.windows.hour.remaining, 3580);
  assert.equal(removed.length, 3);
});

test('非法 Redis 配额元数据不会改变执行或展示容量', async () => {
  let evalCall = null;
  const limiter = new MultiLevelRateLimiter({
    name: 'US:operation:getCatalogItem',
    rate: 2,
    burst: 2,
    perMinute: 120,
    perHour: 7200,
  });
  limiter.getDistributedRedisClient = async () => ({
    async get() {
      return JSON.stringify({ rate: 0, burst: 99, source: 'invalid' });
    },
    async eval(script, keyCount, ...payload) {
      evalCall = { script, keyCount, payload };
      return [1, 0];
    },
    async zremrangebyscore() {},
    async zcard() {
      return 0;
    },
  });

  assert.equal(await limiter.acquireDistributed(), true);
  const acquireArgs = evalCall.payload.slice(evalCall.keyCount);
  assert.deepEqual(
    [acquireArgs[4], acquireArgs[7], acquireArgs[10]],
    [2, 120, 7200],
  );

  const snapshot = await limiter.getStatusSnapshot();
  assert.deepEqual(snapshot.limits, {
    second: 2,
    minute: 120,
    hour: 7200,
  });
  assert.equal(snapshot.limitSource, 'default');
});

test('独立 limiter 实例从 Redis 元数据解析出相同执行容量', async () => {
  const client = {
    async get() {
      return JSON.stringify({
        rate: 1.5,
        burst: 4,
        source: 'response_header',
        updatedAt: '2026-01-02T00:00:00.000Z',
      });
    },
  };
  const apiLimiter = new MultiLevelRateLimiter({
    name: 'US:operation:getCatalogItem',
    rate: 2,
    burst: 2,
    perMinute: 120,
    perHour: 7200,
  });
  const workerLimiter = new MultiLevelRateLimiter({
    name: 'US:operation:getCatalogItem',
    rate: 2,
    burst: 2,
    perMinute: 120,
    perHour: 7200,
  });

  const [apiConfig, workerConfig] = await Promise.all([
    apiLimiter.getEffectiveWindowConfigs(client),
    workerLimiter.getEffectiveWindowConfigs(client),
  ]);

  assert.deepEqual(apiConfig, workerConfig);
  assert.deepEqual(
    apiConfig.windows.map((window) => window.limit),
    [4, 90, 5400],
  );
});

test('实时监控参数与 Redis 前置条件可验证', () => {
  assert.deepEqual(parseArgs(['--once']), { once: true });
  assert.match(
    formatUsage({ used: 2, remaining: 8, limit: 10 }),
    /2\/10.*20\.0%/,
  );
  assert.throws(
    () =>
      assertDistributedSnapshots({
        US: { region: { mode: 'memory' }, operations: {} },
      }),
    /无法读取其他进程/,
  );
});
