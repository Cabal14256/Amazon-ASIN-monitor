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
const { auditSchemas } = require('../../src/services/schemaAuditService');

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

function splitMysqlClientScript(sql) {
  const statements = [];
  let delimiter = ';';
  let buffer = '';

  for (const line of sql.split(/\r?\n/)) {
    const delimiterMatch = line.trim().match(/^DELIMITER\s+(.+)$/i);
    if (delimiterMatch) {
      assert.equal(buffer.trim(), '');
      delimiter = delimiterMatch[1];
      continue;
    }

    buffer += `${line}\n`;
    if (buffer.trimEnd().endsWith(delimiter)) {
      const statement = buffer.trimEnd().slice(0, -delimiter.length).trim();
      if (statement) statements.push(statement);
      buffer = '';
    }
  }

  assert.equal(
    buffer.trim(),
    '',
    'migration contains an unterminated statement',
  );
  return statements;
}

async function executeMysqlClientScript(connection, sql) {
  for (const statement of splitMysqlClientScript(sql)) {
    await connection.query(statement);
  }
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
        await mysqlConnection.query(competitorSql);

        const [[mainTableCount]] = await mysqlConnection.query(
          'SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = ?',
          [mainDatabase],
        );
        const [[competitorTableCount]] = await mysqlConnection.query(
          'SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = ?',
          [competitorDatabase],
        );
        assert.equal(Number(mainTableCount.count), 21);
        assert.equal(Number(competitorTableCount.count), 4);

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
      '生产旧结构 fixture 连续迁移两次后与 canonical metadata 一致',
      { timeout: 120000 },
      async (migrationContext) => {
        await mysqlConnection.query(
          `INSERT INTO \`${mainDatabase}\`.variant_groups
             (id, name, country, site, brand)
           VALUES ('migration-main-group', 'Main group', 'US', '12', 'Brand')`,
        );
        await mysqlConnection.query(
          `INSERT INTO \`${mainDatabase}\`.asins
             (id, asin, country, site, brand, variant_group_id, asin_note, parent_title)
           VALUES ('migration-main-asin', 'B000000001', 'US', '12', 'Brand',
                   'migration-main-group', '', '')`,
        );
        await mysqlConnection.query(
          `INSERT INTO \`${mainDatabase}\`.monitor_history
             (variant_group_id, asin_id, country, check_time)
           VALUES ('migration-main-group', 'migration-main-asin', 'US', NOW())`,
        );
        await mysqlConnection.query(
          `ALTER TABLE \`${mainDatabase}\`.asins
             MODIFY COLUMN asin_note TEXT NOT NULL,
             MODIFY COLUMN parent_title TEXT NOT NULL,
             DROP INDEX ix_asins_parent_lookup,
             ADD INDEX ix_asins_parent_lookup (parent_asin, country),
             ADD INDEX idx_asins_asin (asin),
             ADD INDEX idx_asins_variant_group_id (variant_group_id),
             MODIFY COLUMN asin VARCHAR(20)
               CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL`,
        );
        await mysqlConnection.query(
          `ALTER TABLE \`${mainDatabase}\`.monitor_history
             DROP INDEX idx_month_country_asin,
             DROP INDEX idx_check_type_hour_country_asin,
             DROP INDEX idx_check_type_day_country_asin,
             DROP INDEX idx_check_type_time_country_asin_broken,
             DROP INDEX idx_country_check_time_type_asin,
             DROP INDEX idx_variant_group_time_asin_broken,
             ADD CONSTRAINT fk_fixture_history_group
               FOREIGN KEY (variant_group_id) REFERENCES \`${mainDatabase}\`.variant_groups(id),
             ADD CONSTRAINT fk_fixture_history_asin
               FOREIGN KEY (asin_id) REFERENCES \`${mainDatabase}\`.asins(id)`,
        );
        await mysqlConnection.query(
          `ALTER TABLE \`${mainDatabase}\`.monitor_history_agg
             DROP INDEX idx_agg_covering_query`,
        );
        await mysqlConnection.query(
          `ALTER TABLE \`${mainDatabase}\`.monitor_history_agg_dim
             DROP INDEX idx_agg_dim_covering_query`,
        );
        await mysqlConnection.query(
          `ALTER TABLE \`${mainDatabase}\`.users DROP INDEX idx_status`,
        );

        await mysqlConnection.query(
          `INSERT INTO \`${competitorDatabase}\`.competitor_variant_groups
             (id, name, country, brand)
           VALUES ('migration-competitor-group', 'Competitor group', 'US', 'Brand')`,
        );
        await mysqlConnection.query(
          `INSERT INTO \`${competitorDatabase}\`.competitor_asins
             (id, asin, country, brand, variant_group_id)
           VALUES ('migration-competitor-asin', 'B000000002', 'US', 'Brand',
                   'migration-competitor-group')`,
        );
        await mysqlConnection.query(
          `INSERT INTO \`${competitorDatabase}\`.competitor_monitor_history
             (variant_group_id, asin_id, country, check_time)
           VALUES ('migration-competitor-group', 'migration-competitor-asin', 'US', NOW())`,
        );
        await mysqlConnection.query(
          `ALTER TABLE \`${competitorDatabase}\`.competitor_asins
             DROP INDEX uk_asin_country,
             ADD UNIQUE INDEX uk_asin (asin),
             ADD INDEX uk_asin_country (asin, country)`,
        );
        await mysqlConnection.query(
          `ALTER TABLE \`${competitorDatabase}\`.competitor_monitor_history
             ADD CONSTRAINT fk_fixture_competitor_history_group
               FOREIGN KEY (variant_group_id)
               REFERENCES \`${competitorDatabase}\`.competitor_variant_groups(id),
             ADD CONSTRAINT fk_fixture_competitor_history_asin
               FOREIGN KEY (asin_id)
               REFERENCES \`${competitorDatabase}\`.competitor_asins(id)`,
        );

        const activeDirectory = path.join(
          __dirname,
          '../../database/migrations/active',
        );
        const activeFiles = fs
          .readdirSync(activeDirectory)
          .filter((filename) => filename.endsWith('.sql'))
          .sort();
        const timings = [];
        for (let pass = 1; pass <= 2; pass += 1) {
          for (const filename of activeFiles) {
            let sql = fs.readFileSync(
              path.join(activeDirectory, filename),
              'utf8',
            );
            sql = rewriteDatabaseName(sql, 'amazon_asin_monitor', mainDatabase);
            sql = rewriteDatabaseName(
              sql,
              'amazon_competitor_monitor',
              competitorDatabase,
            );
            const startedAt = Date.now();
            await executeMysqlClientScript(mysqlConnection, sql);
            timings.push({
              pass,
              filename,
              durationMs: Date.now() - startedAt,
            });
          }
        }
        migrationContext.diagnostic(
          `migration timings: ${JSON.stringify(timings)}`,
        );

        const mainAuditConnection = await mysql.createConnection({
          host: mysqlHost,
          port: Number(process.env.INTEGRATION_MYSQL_PORT) || 3306,
          user: process.env.INTEGRATION_MYSQL_USER || 'root',
          password: '',
          database: mainDatabase,
        });
        const competitorAuditConnection = await mysql.createConnection({
          host: mysqlHost,
          port: Number(process.env.INTEGRATION_MYSQL_PORT) || 3306,
          user: process.env.INTEGRATION_MYSQL_USER || 'root',
          password: '',
          database: competitorDatabase,
        });
        migrationContext.after(async () => {
          await mainAuditConnection.end();
          await competitorAuditConnection.end();
        });
        const audit = await auditSchemas({
          target: 'all',
          queryOverrides: {
            main: async (sql, params) => {
              const [rows] = await mainAuditConnection.query(sql, params);
              return rows;
            },
            competitor: async (sql, params) => {
              const [rows] = await competitorAuditConnection.query(sql, params);
              return rows;
            },
          },
        });
        assert.equal(audit.status, 'ok', JSON.stringify(audit, null, 2));

        await mysqlConnection.query(
          `DELETE FROM \`${mainDatabase}\`.variant_groups
           WHERE id = 'migration-main-group'`,
        );
        await mysqlConnection.query(
          `DELETE FROM \`${competitorDatabase}\`.competitor_variant_groups
           WHERE id = 'migration-competitor-group'`,
        );
        const [[mainHistory]] = await mysqlConnection.query(
          `SELECT variant_group_name, asin_code, site_snapshot, brand_snapshot
           FROM \`${mainDatabase}\`.monitor_history
           WHERE variant_group_id = 'migration-main-group'`,
        );
        const [[competitorHistory]] = await mysqlConnection.query(
          `SELECT variant_group_name, asin_code
           FROM \`${competitorDatabase}\`.competitor_monitor_history
           WHERE variant_group_id = 'migration-competitor-group'`,
        );
        assert.deepEqual(
          [
            mainHistory.variant_group_name,
            mainHistory.asin_code,
            mainHistory.site_snapshot,
            mainHistory.brand_snapshot,
          ],
          ['Main group', 'B000000001', '12', 'Brand'],
        );
        assert.deepEqual(
          [competitorHistory.variant_group_name, competitorHistory.asin_code],
          ['Competitor group', 'B000000002'],
        );
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
