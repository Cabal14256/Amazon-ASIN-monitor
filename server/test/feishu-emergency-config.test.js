const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');
const {
  DEFAULT_EMERGENCY_CONFIG,
  normalizeEmergencyConfig,
} = require('../src/utils/feishuEmergencyConfig');

function loadModel(runQuery, logs = []) {
  const filename = require.resolve('../src/models/FeishuConfig');
  const cachedModule = require.cache[filename];
  const originalLoad = Module._load;
  delete require.cache[filename];
  Module._load = function load(request, parent, isMain) {
    if (parent?.filename === filename && request === '../config/database') {
      return {
        pool: {
          query: (options) => runQuery(options, options.values),
        },
        withTransaction: async (handler) =>
          handler({
            connection: {
              query: (options) => runQuery(options, options.values),
            },
          }),
      };
    }
    if (parent?.filename === filename && request === '../utils/logger') {
      return { error: (...args) => logs.push(args) };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(filename);
  } finally {
    Module._load = originalLoad;
    if (cachedModule) require.cache[filename] = cachedModule;
    else delete require.cache[filename];
  }
}

function makeRow(overrides = {}) {
  return {
    id: 1,
    country: 'US',
    webhook_url: 'https://example.invalid/hook',
    enabled: 1,
    emergency_config: null,
    last_emergency_at: '2026-09-30 08:00:00',
    ...overrides,
  };
}

test('空配置默认关闭，返回独立联系人数组且不接受未知字段', () => {
  assert.deepEqual(normalizeEmergencyConfig(), DEFAULT_EMERGENCY_CONFIG);
  const first = normalizeEmergencyConfig({ unexpected: 'discard' });
  first.userIds.push('ou_local');
  assert.deepEqual(normalizeEmergencyConfig(null).userIds, []);
  assert.equal(Object.hasOwn(first, 'unexpected'), false);
});

test('启用要求联系人，并按 open_id 去空白和去重', () => {
  assert.throws(() => normalizeEmergencyConfig({ enabled: true }), {
    status: 400,
  });
  assert.deepEqual(
    normalizeEmergencyConfig({
      enabled: true,
      userIds: [' ou_alice ', 'ou_alice', 'ou_bob-2'],
    }).userIds,
    ['ou_alice', 'ou_bob-2'],
  );
  for (const userIds of [
    [''],
    ['user_1'],
    [123],
    'ou_alice',
    Array.from({ length: 11 }, (_, index) => `ou_${index}`),
  ]) {
    assert.throws(() => normalizeEmergencyConfig({ userIds }), { status: 400 });
  }
});

test('所有数值必须是范围内整数，不能悄悄截断小数或解析字符串', () => {
  for (const [key, min, max] of [
    ['windowMinutes', 1, 1440],
    ['threshold', 0, 1000000],
    ['cooldownMinutes', 5, 10080],
  ]) {
    assert.equal(normalizeEmergencyConfig({ [key]: min })[key], min);
    assert.equal(normalizeEmergencyConfig({ [key]: max })[key], max);
    for (const value of [
      min - 1,
      max + 1,
      min + 0.5,
      String(min),
      NaN,
      Infinity,
      null,
    ]) {
      assert.throws(() => normalizeEmergencyConfig({ [key]: value }), {
        status: 400,
      });
    }
  }
});

test('时段支持跨午夜并拒绝无效时刻、模式及相同起止时刻', () => {
  assert.equal(
    normalizeEmergencyConfig({
      timeMode: 'daily',
      startTime: '22:00',
      endTime: '08:00',
    }).timeMode,
    'daily',
  );
  for (const value of [
    { timeMode: 'invalid' },
    { startTime: '24:00' },
    { endTime: '8:00' },
    { startTime: '08:60' },
    { enabled: 1 },
    [],
  ]) {
    assert.throws(() => normalizeEmergencyConfig(value), { status: 400 });
  }
  for (const timeMode of ['daily', 'combined']) {
    assert.throws(
      () =>
        normalizeEmergencyConfig({
          timeMode,
          startTime: '08:00',
          endTime: '08:00',
        }),
      { status: 400 },
    );
  }
});

test('公开查询转换 JSON 和字段名，隐藏数据库冷却字段且返回禁用配置', async () => {
  const row = makeRow({
    enabled: 0,
    emergency_config: JSON.stringify({ threshold: 20 }),
  });
  const calls = [];
  const model = loadModel(async (options, params) => {
    calls.push({ ...options, params });
    return [[row]];
  });
  const config = await model.findByCountry('US');
  assert.equal(config.enabled, 0);
  assert.equal(config.emergency.threshold, 20);
  assert.equal(config.webhookUrl, row.webhook_url);
  assert.equal(Object.hasOwn(config, 'last_emergency_at'), false);
  assert.equal(Object.hasOwn(config, 'emergency_config'), false);
  assert.doesNotMatch(calls[0].sql, /enabled\s*=\s*1/);
  assert.deepEqual(await model.findAll(), [config]);
});

test('旧客户端更新未带 emergency 时保留规则和冷却，不把未提供字段清空', async () => {
  const row = makeRow({ emergency_config: { threshold: 17 } });
  const calls = [];
  const model = loadModel(async (options, params) => {
    calls.push({ ...options, params });
    return [options.sql.startsWith('SELECT') ? [row] : { affectedRows: 1 }];
  });
  const config = await model.upsert({
    country: 'US',
    webhookUrl: row.webhook_url,
  });
  const update = calls.find((call) => call.sql.startsWith('UPDATE'));
  assert.doesNotMatch(update.sql, /emergency_config|last_emergency_at/);
  assert.equal(config.emergency.threshold, 17);
});

test('保存启用配置前检查应用凭据，缺失时不操作数据库', async () => {
  const oldAppId = process.env.FEISHU_APP_ID;
  const oldAppSecret = process.env.FEISHU_APP_SECRET;
  delete process.env.FEISHU_APP_ID;
  delete process.env.FEISHU_APP_SECRET;
  let called = false;
  try {
    const model = loadModel(async () => {
      called = true;
      return [[]];
    });
    await assert.rejects(
      model.upsert({
        country: 'US',
        webhookUrl: 'https://example.invalid/hook',
        emergency: { enabled: true, userIds: ['ou_alice'] },
      }),
      { status: 400 },
    );
    assert.equal(called, false);
  } finally {
    if (oldAppId === undefined) delete process.env.FEISHU_APP_ID;
    else process.env.FEISHU_APP_ID = oldAppId;
    if (oldAppSecret === undefined) delete process.env.FEISHU_APP_SECRET;
    else process.env.FEISHU_APP_SECRET = oldAppSecret;
  }
});

test('显式更新规则使用绑定 JSON，不重置冷却时间', async () => {
  const row = makeRow();
  const calls = [];
  const model = loadModel(async (options, params) => {
    calls.push({ ...options, params });
    return [options.sql.startsWith('SELECT') ? [row] : { affectedRows: 1 }];
  });
  await model.upsert({
    country: 'US',
    webhookUrl: row.webhook_url,
    emergency: { userIds: ['ou_alice'], threshold: 0 },
  });
  const update = calls.find((call) => call.sql.startsWith('UPDATE'));
  assert.match(update.sql, /emergency_config = \?/);
  assert.doesNotMatch(update.sql, /last_emergency_at|ou_alice/);
  assert.deepEqual(JSON.parse(update.params[2]).userIds, ['ou_alice']);
  assert.equal(JSON.parse(update.params[2]).threshold, 0);
});

test('新发拆分按国家加变体组去重，只统计未尝试电话的有效通知事件', async () => {
  const calls = [];
  const model = loadModel(async (options, params) => {
    calls.push({ ...options, params });
    return [[{ group_count: '12', max_event_id: '9007199254740993' }]];
  });
  assert.deepEqual(
    await model.getEmergencyGroups(
      'EU',
      '2026-09-30 08:00:00',
      '2026-09-30 08:30:00',
    ),
    { count: 12, maxEventId: '9007199254740993' },
  );
  const call = calls[0];
  assert.match(call.sql, /COUNT\(DISTINCT e.country, e.variant_group_id\)/);
  assert.match(call.sql, /FROM variant_group_split_events e/);
  assert.match(call.sql, /e.phone_attempted_at IS NULL/);
  assert.match(call.sql, /e.notify_enabled = 1/);
  assert.match(call.sql, /e.occurred_at >= \?/);
  assert.match(call.sql, /e.occurred_at <= \?/);
  assert.match(call.sql, /a.variant_group_id = e.variant_group_id/);
  assert.match(
    call.sql,
    /JSON_CONTAINS\(e.details, JSON_QUOTE\(a.id\), '\$.triggerAsinIds'\)/,
  );
  assert.match(call.sql, /COALESCE\(a.feishu_notify_enabled, 1\) <> 0/);
  assert.match(call.sql, /COALESCE\(vg.feishu_notify_enabled, 1\) <> 0/);
  assert.deepEqual(call.params, [
    'UK',
    'DE',
    'FR',
    'IT',
    'ES',
    '2026-09-30 08:00:00',
    '2026-09-30 08:30:00',
  ]);
  await assert.rejects(model.getEmergencyGroups('invalid', '', ''), {
    status: 400,
  });
  assert.equal(calls.length, 1);
});

const claimRule = normalizeEmergencyConfig({
  enabled: true,
  userIds: ['ou_test'],
});
const claimOptions = {
  startTime: '2026-09-30 08:00:00.000',
  endTime: '2026-09-30 08:30:00.750',
  maxEventId: '45',
  rule: claimRule,
};

function claimFixture({ row = {}, count = 11 } = {}) {
  const calls = [];
  const model = loadModel(async (options, params) => {
    calls.push({ ...options, params });
    if (options.sql.includes('FROM feishu_config'))
      return [
        [
          makeRow({
            cooldown_ready: 1,
            emergency_config: claimRule,
            ...row,
          }),
        ],
      ];
    if (options.sql.includes('SELECT COUNT')) return [[{ group_count: count }]];
    return [{ affectedRows: 1 }];
  });
  return { model, calls };
}

test('原子抢占锁定区域配置，重算水位内数量并仅消费本批次，冷却使用数据库 UTC', async () => {
  const { model, calls } = claimFixture();
  assert.equal(await model.claimEmergency('EU', 60, claimOptions), true);
  assert.equal(calls.length, 4);
  assert.match(calls[0].sql, /FOR UPDATE/);
  assert.match(
    calls[0].sql,
    /last_emergency_at <= DATE_SUB\(UTC_TIMESTAMP\(\), INTERVAL \? MINUTE\)/,
  );
  assert.deepEqual(calls[0].params, [60, 'EU']);
  for (const call of [calls[1], calls[2]]) {
    assert.match(call.sql, /e.id <= \?/);
    assert.match(call.sql, /e.phone_attempted_at IS NULL/);
    assert.match(call.sql, /e.occurred_at >= \? AND e.occurred_at <= \?/);
    assert.match(call.sql, /JSON_CONTAINS/);
    assert.deepEqual(call.params, [
      'UK',
      'DE',
      'FR',
      'IT',
      'ES',
      claimOptions.startTime,
      claimOptions.endTime,
      '45',
    ]);
  }
  assert.match(calls[2].sql, /SET e.phone_attempted_at = UTC_TIMESTAMP\(\)/);
  assert.match(calls[3].sql, /SET last_emergency_at = UTC_TIMESTAMP\(\)/);
});

test('规则修改、关闭、冷却中、未消费组数不足时不消费事件或抢占电话', async () => {
  for (const scenario of [
    { row: { enabled: 0 } },
    { row: { cooldown_ready: 0 } },
    { row: { emergency_config: { ...claimRule, enabled: false } } },
    { row: { emergency_config: { ...claimRule, threshold: 9 } } },
    { row: { emergency_config: { ...claimRule, userIds: ['ou_new'] } } },
    { row: { emergency_config: { ...claimRule, cooldownMinutes: 5 } } },
    { count: 10 },
    { count: 0 },
  ]) {
    const { model, calls } = claimFixture(scenario);
    assert.equal(await model.claimEmergency('US', 60, claimOptions), false);
    assert.ok(calls.every((call) => !call.sql.startsWith('UPDATE')));
  }
});

test('没有完整事件评估不消费，非法冷却值拒绝，不再支持仅按冷却直接拨打', async () => {
  const { model, calls } = claimFixture();
  for (const options of [
    undefined,
    {},
    { ...claimOptions, maxEventId: null },
    { ...claimOptions, maxEventId: '1.1' },
    { ...claimOptions, rule: null },
  ]) {
    assert.equal(await model.claimEmergency('US', 60, options), false);
  }
  await assert.rejects(model.claimEmergency('US', 0, claimOptions), {
    status: 400,
  });
  assert.equal(calls.length, 0);
});

test('事务内数据库失败仍只记录脱敏错误码', async () => {
  const logs = [];
  const model = loadModel(async () => {
    const error = new Error('bound SQL ou_private and private_webhook');
    error.code = 'ER_LOCK_DEADLOCK';
    throw error;
  }, logs);
  await assert.rejects(model.claimEmergency('US', 60, claimOptions), {
    message: '飞书配置数据库操作失败',
  });
  assert.match(JSON.stringify(logs), /ER_LOCK_DEADLOCK/);
  assert.doesNotMatch(
    JSON.stringify(logs),
    /ou_private|private_webhook|bound SQL/,
  );
});

test('数据库失败不传播 SQL、webhook 或联系人到日志和错误消息', async () => {
  const logs = [];
  const model = loadModel(async () => {
    const error = new Error('SQL with ou_private and secret_webhook');
    error.code = 'ER_BAD_FIELD_ERROR';
    error.sql = 'SELECT ou_private';
    throw error;
  }, logs);
  await assert.rejects(model.findAll(), { message: '飞书配置数据库操作失败' });
  assert.match(JSON.stringify(logs), /ER_BAD_FIELD_ERROR/);
  assert.doesNotMatch(JSON.stringify(logs), /ou_private|secret_webhook|SELECT/);
});

test('飞书权限只挂在自身路由，读取和修改分别要求 settings:read/write', () => {
  const filename = require.resolve('../src/routes/feishuRoutes');
  const originalLoad = Module._load;
  const cachedModule = require.cache[filename];
  const registrations = [];
  const auth = () => {};
  const router = Object.fromEntries(
    ['get', 'post', 'put', 'patch', 'delete', 'use'].map((method) => [
      method,
      (...args) => registrations.push({ method, args }),
    ]),
  );
  delete require.cache[filename];
  Module._load = function load(request, parent, isMain) {
    if (parent?.filename === filename) {
      if (request === 'express') return { Router: () => router };
      if (request === '../middleware/auth')
        return {
          authenticateToken: auth,
          checkPermission: (permission) => permission,
        };
      if (request === '../controllers/feishuController')
        return new Proxy({}, { get: () => () => {} });
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    require(filename);
  } finally {
    Module._load = originalLoad;
    if (cachedModule) require.cache[filename] = cachedModule;
    else delete require.cache[filename];
  }
  assert.equal(registrations.length, 6);
  for (const { method, args } of registrations) {
    assert.notEqual(method, 'use');
    assert.match(args[0], /^\/feishu-configs/);
    assert.equal(args[1], auth);
    assert.equal(
      args[2],
      method === 'get' ? 'settings:read' : 'settings:write',
    );
  }
});
