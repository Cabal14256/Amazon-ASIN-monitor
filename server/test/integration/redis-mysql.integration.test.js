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
  updateOperationRateLimit,
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
    let applicationPool = null;
    context.after(async () => {
      if (applicationPool) await applicationPool.end();
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
        [3, 90, 5400],
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
        second: 3,
        minute: 90,
        hour: 5400,
      });
      assert.equal(workerSnapshot.windows.second.used, 2);
      assert.equal(workerSnapshot.windows.minute.used, 2);
      assert.equal(workerSnapshot.windows.hour.used, 2);
      assert.equal(workerSnapshot.limitSource, 'response_header');

      const genericOperation = 'reviewGenericOperation';
      const genericMetadataKey = `${process.env.RATE_LIMITER_KEY_PREFIX}:metadata:US:operation:${genericOperation}`;
      updateOperationRateLimit('US', genericOperation, 0.5);
      let genericMetadata = null;
      await waitFor(
        async () => {
          const rawMetadata = await directRedis.get(genericMetadataKey);
          if (!rawMetadata) return false;
          genericMetadata = JSON.parse(rawMetadata);
          return true;
        },
        5000,
        'Generic operation metadata was not persisted',
      );
      assert.equal(genericMetadata.burst, 1);
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

    await context.test(
      '电话加急迁移可升级旧表并重复执行，保留既有通知配置',
      async () => {
        await mysqlConnection.query(
          `INSERT INTO \`${mainDatabase}\`.feishu_config (country, webhook_url, enabled)
         VALUES ('US', 'https://example.invalid/us-hook', 1), ('EU', 'https://example.invalid/eu-hook', 1)`,
        );
        // 只在已验证名称的本次 CI 隔离库模拟升级前结构。
        await mysqlConnection.query(
          `ALTER TABLE \`${mainDatabase}\`.feishu_config
         DROP COLUMN emergency_config, DROP COLUMN last_emergency_at`,
        );
        const migration = rewriteDatabaseName(
          fs.readFileSync(
            path.join(
              __dirname,
              '../../database/migrations/032_add_feishu_emergency.sql',
            ),
            'utf8',
          ),
          'amazon_asin_monitor',
          mainDatabase,
        );
        await mysqlConnection.query(migration);
        await mysqlConnection.query(migration);

        const [columns] = await mysqlConnection.query(
          `SELECT COLUMN_NAME AS name, DATA_TYPE AS type
         FROM information_schema.columns
         WHERE table_schema = ? AND table_name = 'feishu_config'
           AND column_name IN ('emergency_config', 'last_emergency_at')
         ORDER BY column_name`,
          [mainDatabase],
        );
        assert.deepEqual(
          columns.map((column) => ({ ...column })),
          [
            { name: 'emergency_config', type: 'json' },
            { name: 'last_emergency_at', type: 'datetime' },
          ],
        );
        const [rows] = await mysqlConnection.query(
          `SELECT country, webhook_url, emergency_config, last_emergency_at
         FROM \`${mainDatabase}\`.feishu_config ORDER BY country`,
        );
        assert.deepEqual(
          rows.map((row) => ({ ...row })),
          [
            {
              country: 'EU',
              webhook_url: 'https://example.invalid/eu-hook',
              emergency_config: null,
              last_emergency_at: null,
            },
            {
              country: 'US',
              webhook_url: 'https://example.invalid/us-hook',
              emergency_config: null,
              last_emergency_at: null,
            },
          ],
        );
      },
    );

    // 延迟加载真实模型，防止 .env 或开发库设置影响隔离测试。
    const databaseModule = require.resolve('../../src/config/database');
    assert.equal(
      require.cache[databaseModule],
      undefined,
      'Application database must not be loaded before CI settings are installed',
    );
    const safeEnvironment = {
      DB_HOST: mysqlHost,
      DB_PORT: String(Number(process.env.INTEGRATION_MYSQL_PORT) || 3306),
      DB_USER: process.env.INTEGRATION_MYSQL_USER || 'root',
      DB_PASSWORD: '',
      DB_NAME: mainDatabase,
      DB_CONNECTION_LIMIT: '10',
    };
    const previousEnvironment = Object.fromEntries(
      Object.keys(safeEnvironment).map((key) => [key, process.env[key]]),
    );
    let FeishuConfig;
    try {
      Object.assign(process.env, safeEnvironment);
      applicationPool = require('../../src/config/database').pool;
      FeishuConfig = require('../../src/models/FeishuConfig');
    } finally {
      for (const [key, value] of Object.entries(previousEnvironment)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }

    await context.test(
      '真实异常窗口按国家和 ASIN 去重，遵守通知开关及闭区间边界',
      async () => {
        const groups = [
          ['emergency-us', 'US', 1],
          ['emergency-uk', 'UK', 1],
          ['emergency-de', 'DE', 1],
          ['emergency-fr-muted', 'FR', 0],
          ['emergency-es-default', 'ES', null],
        ];
        await mysqlConnection.query(
          `INSERT INTO \`${mainDatabase}\`.variant_groups (id, name, country, site, brand, feishu_notify_enabled) VALUES ?`,
          [
            groups.map(([id, country, enabled]) => [
              id,
              id,
              country,
              'ci',
              'ci',
              enabled,
            ]),
          ],
        );
        const asins = [
          ['us-common', 'B000COMMON', 'US', 'emergency-us', 1],
          ['uk-common', 'B000COMMON', 'UK', 'emergency-uk', 1],
          ['de-common', 'B000COMMON', 'DE', 'emergency-de', 1],
          ['uk-start', 'B000START', 'UK', 'emergency-uk', 1],
          ['uk-end', 'B000END', 'UK', 'emergency-uk', 1],
          ['uk-before', 'B000BEFORE', 'UK', 'emergency-uk', 1],
          ['uk-after', 'B000AFTER', 'UK', 'emergency-uk', 1],
          ['uk-muted', 'B000MUTED', 'UK', 'emergency-uk', 0],
          ['fr-muted', 'B000FRMUTED', 'FR', 'emergency-fr-muted', 1],
          ['uk-normal', 'B000NORMAL', 'UK', 'emergency-uk', 1],
          ['uk-group', 'B000GROUP', 'UK', 'emergency-uk', 1],
          ['es-fallback', 'B000FALLBACK', 'ES', 'emergency-es-default', null],
          ['uk-recovered', 'B000RECOVER', 'UK', 'emergency-uk', 1],
        ];
        await mysqlConnection.query(
          `INSERT INTO \`${mainDatabase}\`.asins (id, asin, country, variant_group_id, site, brand, feishu_notify_enabled) VALUES ?`,
          [
            asins.map(([id, asin, country, groupId, enabled]) => [
              id,
              asin,
              country,
              groupId,
              'ci',
              'ci',
              enabled,
            ]),
          ],
        );
        const asinMap = new Map(asins.map((asin) => [asin[0], asin]));
        const history = [
          ['us-common', '08:15:00'],
          ['uk-common', '08:05:00'],
          ['uk-common', '08:10:00'],
          ['de-common', '08:15:00'],
          ['uk-start', '08:00:00'],
          ['uk-end', '08:30:00'],
          ['uk-before', '07:59:59'],
          ['uk-after', '08:30:01'],
          ['uk-muted', '08:15:00'],
          ['fr-muted', '08:15:00'],
          ['uk-normal', '08:15:00', 0],
          ['uk-group', '08:15:00', 1, 'GROUP'],
          ['es-fallback', '08:15:00', 1, 'ASIN', null],
          ['es-fallback', '08:20:00', 1, 'ASIN', ''],
          ['es-fallback', '08:25:00', 1, 'ASIN', 'B000FALLBACK'],
          ['uk-recovered', '08:15:00'],
          ['uk-recovered', '08:20:00', 0],
        ].map(([id, time, broken = 1, type = 'ASIN', snapshot]) => {
          const [, asin, country, groupId] = asinMap.get(id);
          return [
            groupId,
            id,
            snapshot === undefined ? asin : snapshot,
            country,
            type,
            broken,
            `2026-09-30 ${time}`,
          ];
        });
        await mysqlConnection.query(
          `INSERT INTO \`${mainDatabase}\`.monitor_history (variant_group_id, asin_id, asin_code, country, check_type, is_broken, check_time) VALUES ?`,
          [history],
        );

        assert.equal(
          await FeishuConfig.countEmergencyASINs(
            'US',
            '2026-09-30 08:00:00',
            '2026-09-30 08:30:00',
          ),
          1,
        );
        assert.equal(
          await FeishuConfig.countEmergencyASINs(
            'EU',
            '2026-09-30 08:00:00',
            '2026-09-30 08:30:00',
          ),
          6,
        );
        assert.equal(
          await FeishuConfig.countEmergencyASINs(
            'EU',
            '2026-09-30 08:00:00',
            '2026-09-30 08:00:00',
          ),
          1,
        );
        assert.equal(
          await FeishuConfig.countEmergencyASINs(
            'EU',
            '2026-09-30 08:30:00',
            '2026-09-30 08:30:00',
          ),
          1,
        );
        assert.equal(
          await FeishuConfig.countEmergencyASINs(
            'EU',
            '2026-09-30 08:00:01',
            '2026-09-30 08:29:59',
          ),
          4,
        );
      },
    );

    await context.test(
      '真实连接池并发抢占每区域仅成功一次，UTC 冷却与开关独立生效',
      async () => {
        const emergency = JSON.stringify({
          enabled: true,
          userIds: ['ou_ci_contact'],
        });
        await mysqlConnection.query(
          `UPDATE \`${mainDatabase}\`.feishu_config SET emergency_config = ?, last_emergency_at = NULL`,
          [emergency],
        );
        const claims = await Promise.all(
          Array.from({ length: 10 }, () =>
            FeishuConfig.claimEmergency('EU', 60),
          ),
        );
        assert.equal(claims.filter(Boolean).length, 1);
        assert.equal(await FeishuConfig.claimEmergency('US', 60), true);
        assert.equal(await FeishuConfig.claimEmergency('EU', 60), false);
        assert.equal(await FeishuConfig.claimEmergency('US', 60), false);
        const [[row]] = await mysqlConnection.query(
          `SELECT ABS(TIMESTAMPDIFF(SECOND, last_emergency_at, UTC_TIMESTAMP())) AS age
         FROM \`${mainDatabase}\`.feishu_config WHERE country = 'EU'`,
        );
        assert.ok(Number(row.age) < 10, 'Cooldown must be stored in UTC');

        await mysqlConnection.query(
          `UPDATE \`${mainDatabase}\`.feishu_config
         SET last_emergency_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 61 MINUTE)
         WHERE country = 'EU'`,
        );
        assert.equal(await FeishuConfig.claimEmergency('EU', 60), true);
        await mysqlConnection.query(
          `UPDATE \`${mainDatabase}\`.feishu_config SET last_emergency_at = NULL, enabled = 0 WHERE country = 'EU'`,
        );
        assert.equal(await FeishuConfig.claimEmergency('EU', 60), false);
        await mysqlConnection.query(
          `UPDATE \`${mainDatabase}\`.feishu_config SET enabled = 1, emergency_config = JSON_OBJECT('enabled', FALSE) WHERE country = 'EU'`,
        );
        assert.equal(await FeishuConfig.claimEmergency('EU', 60), false);
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
