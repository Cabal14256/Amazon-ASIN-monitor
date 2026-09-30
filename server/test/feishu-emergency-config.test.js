const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');
const {
  DEFAULT_EMERGENCY_CONFIG,
  normalizeEmergencyConfig,
} = require('../src/utils/feishuEmergencyConfig');

function loadModel(execute, logs = []) {
  const filename = require.resolve('../src/models/FeishuConfig');
  const cachedModule = require.cache[filename];
  const originalLoad = Module._load;
  delete require.cache[filename];
  Module._load = function load(request, parent, isMain) {
    if (parent?.filename === filename && request === '../config/database') {
      return { pool: { execute } };
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

test('窗口统计使用国家加 ASIN 去重，包含边界并排除关闭通知的 ASIN 与变体组', async () => {
  const calls = [];
  const model = loadModel(async (options, params) => {
    calls.push({ ...options, params });
    return [[{ broken_count: '12' }]];
  });
  assert.equal(
    await model.countEmergencyASINs(
      'EU',
      '2026-09-30 08:00:00',
      '2026-09-30 08:30:00',
    ),
    12,
  );
  const call = calls[0];
  assert.match(
    call.sql,
    /COUNT\(DISTINCT mh.country, COALESCE\(NULLIF\(mh.asin_code, ''\), mh.asin_id\)\)/,
  );
  assert.match(call.sql, /mh.check_type = 'ASIN'/);
  assert.match(call.sql, /mh.is_broken = 1/);
  assert.match(call.sql, /mh.check_time >= \?/);
  assert.match(call.sql, /mh.check_time <= \?/);
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
  await assert.rejects(model.countEmergencyASINs('invalid', '', ''), {
    status: 400,
  });
  assert.equal(calls.length, 1);
});

test('电话冷却使用单次 UTC 条件 UPDATE 抢占，只把实际更新一行判为成功', async () => {
  const calls = [];
  const model = loadModel(async (options, params) => {
    calls.push({ ...options, params });
    return [{ affectedRows: calls.length === 1 ? 1 : 0 }];
  });
  assert.equal(await model.claimEmergency('EU', 60), true);
  assert.equal(await model.claimEmergency('EU', 60), false);
  assert.match(calls[0].sql, /SET last_emergency_at = UTC_TIMESTAMP\(\)/);
  assert.match(calls[0].sql, /last_emergency_at IS NULL/);
  assert.match(
    calls[0].sql,
    /last_emergency_at <= DATE_SUB\(UTC_TIMESTAMP\(\), INTERVAL \? MINUTE\)/,
  );
  assert.match(calls[0].sql, /enabled = 1/);
  assert.match(
    calls[0].sql,
    /JSON_EXTRACT\(emergency_config, '\$.enabled'\) = TRUE/,
  );
  assert.deepEqual(calls[0].params, ['EU', 60]);
  await assert.rejects(model.claimEmergency('EU', 0), { status: 400 });
  assert.equal(calls.length, 2);
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
