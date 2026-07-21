process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'ERROR';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const Redis = require('ioredis');
const mysql = require('mysql2/promise');

const { resolveEffectiveConfig } = require('../../scripts/quota-analysis');
const {
  DISTRIBUTED_ACQUIRE_SCRIPT,
  MultiLevelRateLimiter,
} = require('../../src/services/rateLimiter');
const {
  closeRedis,
  initRedis,
  isRedisAvailable,
} = require('../../src/config/redis');

const runIntegrationTests = process.env.RUN_INTEGRATION_TESTS === 'true';
const integrationTest = runIntegrationTests ? test : test.skip;

function assertLoopbackHost(host, label) {
  assert.ok(
    ['127.0.0.1', 'localhost', '::1'].includes(String(host).toLowerCase()),
    `${label} must use a loopback host`,
  );
}

function validateDatabaseName(value, label) {
  const databaseName = String(value || '');
  assert.match(
    databaseName,
    /^[a-z0-9_]+$/,
    `${label} is not a safe test name`,
  );
  assert.match(databaseName, /_ci_\d+$/, `${label} must be unique to a CI run`);
  return databaseName;
}

function rewriteDatabaseName(sql, sourceName, targetName) {
  return sql
    .replaceAll(`\`${sourceName}\``, `\`${targetName}\``)
    .replace(new RegExp(`\\b${sourceName}\\b`, 'g'), targetName);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(predicate, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch (_error) {
      // The service is expected to reject requests while restarting.
    }
    await sleep(250);
  }
  throw new Error(message);
}

async function pingWithTimeout(client, timeoutMs = 1000) {
  return Promise.race([
    client.ping().then((result) => result === 'PONG'),
    sleep(timeoutMs).then(() => false),
  ]);
}

async function evaluateAcquire(client, windows, tokens, memberPrefix) {
  const now = Date.now();
  return client.eval(
    DISTRIBUTED_ACQUIRE_SCRIPT,
    windows.length,
    ...windows.map((window) => window.key),
    now,
    memberPrefix,
    windows.length,
    tokens,
    ...windows.flatMap((window) => [
      window.limit,
      window.windowMs,
      window.ttlMs,
    ]),
  );
}

function minuteWindow(key, limit) {
  return { key, limit, windowMs: 60000, ttlMs: 120000 };
}

async function closeRedisClient(client) {
  if (!client || client.status === 'end') return;
  try {
    await client.quit();
  } catch (_error) {
    client.disconnect();
  }
}

integrationTest(
  'Redis 7 与 MySQL 8 隔离集成验证',
  { timeout: 120000 },
  async (context) => {
    const redisUrl = new URL(
      process.env.REDIS_URL || 'redis://127.0.0.1:6379/15',
    );
    assertLoopbackHost(redisUrl.hostname, 'Redis');

    const mysqlHost = process.env.INTEGRATION_MYSQL_HOST || '127.0.0.1';
    assertLoopbackHost(mysqlHost, 'MySQL');
    assert.equal(process.env.INTEGRATION_ALLOW_DROP_DATABASES, 'true');

    const mainDatabase = validateDatabaseName(
      process.env.INTEGRATION_MYSQL_DATABASE,
      'Main database',
    );
    const competitorDatabase = validateDatabaseName(
      process.env.INTEGRATION_COMPETITOR_DATABASE,
      'Competitor database',
    );

    const directRedis = new Redis(redisUrl.toString(), {
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
      retryStrategy: (attempt) => Math.min(attempt * 50, 1000),
    });
    directRedis.on('error', () => {});
    context.after(async () => {
      await closeRedis();
      await closeRedisClient(directRedis);
    });
    assert.equal(await directRedis.ping(), 'PONG');

    const mysqlConnection = await mysql.createConnection({
      host: mysqlHost,
      port: Number(process.env.INTEGRATION_MYSQL_PORT) || 3306,
      user: process.env.INTEGRATION_MYSQL_USER || 'root',
      password: '',
      multipleStatements: true,
    });
    context.after(async () => {
      await mysqlConnection.query(
        `DROP DATABASE IF EXISTS \`${mainDatabase}\``,
      );
      await mysqlConnection.query(
        `DROP DATABASE IF EXISTS \`${competitorDatabase}\``,
      );
      await mysqlConnection.end();
    });

    await context.test('真实 Lua 对完整窗口和 tokens 原子扣减', async () => {
      await directRedis.flushdb();
      const prefix = `${process.env.RATE_LIMITER_KEY_PREFIX}:atomic`;
      const regionWindow = minuteWindow(`${prefix}:US:region:minute`, 2);
      const operationWindow = minuteWindow(
        `${prefix}:US:operation:getCatalogItem:minute`,
        1,
      );

      const first = await evaluateAcquire(
        directRedis,
        [regionWindow, operationWindow],
        1,
        'first',
      );
      assert.equal(Number(first[0]), 1);

      const denied = await evaluateAcquire(
        directRedis,
        [regionWindow, operationWindow],
        1,
        'denied',
      );
      assert.equal(Number(denied[0]), 0);
      assert.equal(await directRedis.zcard(regionWindow.key), 1);
      assert.equal(await directRedis.zcard(operationWindow.key), 1);

      const otherOperationWindow = minuteWindow(
        `${prefix}:US:operation:searchCatalogItems:minute`,
        2,
      );
      const otherOperation = await evaluateAcquire(
        directRedis,
        [regionWindow, otherOperationWindow],
        1,
        'other-operation',
      );
      assert.equal(Number(otherOperation[0]), 1);
      assert.equal(await directRedis.zcard(regionWindow.key), 2);
      assert.equal(await directRedis.zcard(otherOperationWindow.key), 1);

      await directRedis.flushdb();
      const multiTokenRegion = minuteWindow(`${prefix}:multi:region`, 3);
      const multiTokenOperation = minuteWindow(`${prefix}:multi:operation`, 1);
      const multiTokenDenied = await evaluateAcquire(
        directRedis,
        [multiTokenRegion, multiTokenOperation],
        2,
        'multi-token',
      );
      assert.equal(Number(multiTokenDenied[0]), 0);
      assert.equal(await directRedis.zcard(multiTokenRegion.key), 0);
      assert.equal(await directRedis.zcard(multiTokenOperation.key), 0);
    });

    await context.test('API 与 Worker limiter 共享元数据及用量', async () => {
      await directRedis.flushdb();
      const limiterName = 'US:operation:getCatalogItem';
      const metadataKey = `${process.env.RATE_LIMITER_KEY_PREFIX}:metadata:${limiterName}`;
      await directRedis.set(
        metadataKey,
        JSON.stringify({
          rate: 3.5,
          burst: 4,
          source: 'response_header',
          updatedAt: '2026-07-21T00:00:00.000Z',
        }),
      );

      const apiLimiter = new MultiLevelRateLimiter({
        name: limiterName,
        perMinute: 30,
        perHour: 500,
        rate: 0.5,
        burst: 1,
      });
      const workerLimiter = new MultiLevelRateLimiter({
        name: limiterName,
        perMinute: 120,
        perHour: 7200,
        rate: 2,
        burst: 2,
      });

      const sharedRedis = await initRedis();
      assert.ok(sharedRedis);
      await waitFor(
        () => isRedisAvailable(),
        10000,
        'Shared Redis client did not become ready',
      );

      const [apiConfig, workerConfig] = await Promise.all([
        apiLimiter.getEffectiveWindowConfigs(sharedRedis),
        workerLimiter.getEffectiveWindowConfigs(sharedRedis),
      ]);
      assert.deepEqual(
        apiConfig.windows.map(({ limit }) => limit),
        [4, 210, 12600],
      );
      assert.deepEqual(apiConfig.windows, workerConfig.windows);
      assert.equal(apiConfig.limitSource, 'response_header');
      assert.equal(workerConfig.limitSource, 'response_header');

      assert.equal(await apiLimiter.acquireDistributed(2), true);
      const [apiSnapshot, workerSnapshot] = await Promise.all([
        apiLimiter.getStatusSnapshot(),
        workerLimiter.getStatusSnapshot(),
      ]);
      assert.deepEqual(apiSnapshot.limits, workerSnapshot.limits);
      assert.deepEqual(apiSnapshot.windows, workerSnapshot.windows);
      assert.deepEqual(apiSnapshot.limits, {
        second: 4,
        minute: 210,
        hour: 12600,
      });
      assert.equal(workerSnapshot.windows.second.used, 2);
      assert.equal(workerSnapshot.windows.minute.used, 2);
      assert.equal(workerSnapshot.windows.hour.used, 2);
      assert.equal(workerSnapshot.limitSource, 'response_header');
    });

    await context.test(
      '初始化 SQL 幂等且空配置按环境与默认值回退',
      async () => {
        const mainSql = rewriteDatabaseName(
          fs.readFileSync(
            path.join(__dirname, '../../database/init.sql'),
            'utf8',
          ),
          'amazon_asin_monitor',
          mainDatabase,
        );
        const competitorSql = rewriteDatabaseName(
          fs.readFileSync(
            path.join(__dirname, '../../database/competitor-init.sql'),
            'utf8',
          ),
          'amazon_competitor_monitor',
          competitorDatabase,
        );

        await mysqlConnection.query(mainSql);
        await mysqlConnection.query(competitorSql);
        await mysqlConnection.query(mainSql);

        const [[mainTableCount]] = await mysqlConnection.query(
          'SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = ?',
          [mainDatabase],
        );
        const [[competitorTableCount]] = await mysqlConnection.query(
          'SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = ?',
          [competitorDatabase],
        );
        assert.ok(Number(mainTableCount.count) >= 15);
        assert.ok(Number(competitorTableCount.count) >= 4);

        const [[backupConfigCount]] = await mysqlConnection.query(
          `SELECT COUNT(*) AS count FROM \`${mainDatabase}\`.backup_config`,
        );
        assert.equal(Number(backupConfigCount.count), 1);

        const configKeys = [
          'MONITOR_US_SCHEDULE_MINUTES',
          'MONITOR_EU_SCHEDULE_MINUTES',
          'COMPETITOR_MONITOR_ENABLED',
        ];
        await mysqlConnection.query(
          `DELETE FROM \`${mainDatabase}\`.sp_api_config WHERE config_key IN (?, ?, ?)`,
          configKeys,
        );
        await mysqlConnection.query(
          `INSERT INTO \`${mainDatabase}\`.sp_api_config (config_key, config_value) VALUES (?, ?), (?, ?), (?, ?)`,
          [configKeys[0], '60', configKeys[1], '   ', configKeys[2], null],
        );
        const [configRows] = await mysqlConnection.query(
          `SELECT config_key, config_value FROM \`${mainDatabase}\`.sp_api_config WHERE config_key IN (?, ?, ?)`,
          configKeys,
        );

        const environmentFallback = resolveEffectiveConfig(
          {
            MONITOR_US_SCHEDULE_MINUTES: '15',
            MONITOR_EU_SCHEDULE_MINUTES: '30',
            COMPETITOR_MONITOR_ENABLED: 'false',
          },
          configRows,
        );
        assert.equal(environmentFallback.usIntervalMinutes, 60);
        assert.equal(environmentFallback.euIntervalMinutes, 30);
        assert.equal(environmentFallback.competitorEnabled, false);

        await mysqlConnection.query(
          `DELETE FROM \`${mainDatabase}\`.sp_api_config WHERE config_key IN (?, ?, ?)`,
          configKeys,
        );
        const [emptyConfigRows] = await mysqlConnection.query(
          `SELECT config_key, config_value FROM \`${mainDatabase}\`.sp_api_config WHERE config_key IN (?, ?, ?)`,
          configKeys,
        );
        const defaults = resolveEffectiveConfig({}, emptyConfigRows);
        assert.equal(defaults.usIntervalMinutes, 30);
        assert.equal(defaults.euIntervalMinutes, 60);
        assert.equal(defaults.competitorEnabled, true);
      },
    );

    await context.test('Redis 重启后现有客户端恢复连接', async () => {
      const containerId = String(
        process.env.INTEGRATION_REDIS_CONTAINER_ID || '',
      );
      assert.match(containerId, /^[a-f0-9]{12,64}$/);
      const sharedRedis = await initRedis();
      assert.ok(sharedRedis);
      await sharedRedis.set(
        `${process.env.RATE_LIMITER_KEY_PREFIX}:restart:before`,
        'ready',
      );

      const restart = spawnSync('docker', ['restart', containerId], {
        encoding: 'utf8',
        timeout: 30000,
      });
      if (restart.error) throw restart.error;
      assert.equal(restart.status, 0, restart.stderr);

      await waitFor(
        () => pingWithTimeout(sharedRedis),
        45000,
        'Redis client did not recover after container restart',
      );
      const recoveryKey = `${process.env.RATE_LIMITER_KEY_PREFIX}:restart:after`;
      await sharedRedis.set(recoveryKey, 'recovered');
      assert.equal(await sharedRedis.get(recoveryKey), 'recovered');
    });
  },
);
