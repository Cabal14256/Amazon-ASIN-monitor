const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');
const { getEmergencyWindow } = require('../src/utils/feishuEmergencyWindow');

function loadWithStubs(file, stubs) {
  const filename = require.resolve(file);
  delete require.cache[filename];
  const original = Module._load;
  Module._load = function (request, ...args) {
    return request in stubs
      ? stubs[request]
      : original.call(this, request, ...args);
  };
  try {
    return require(file);
  } finally {
    Module._load = original;
    delete require.cache[filename];
  }
}

const config = {
  enabled: true,
  timeMode: 'rolling',
  windowMinutes: 30,
  startTime: '22:00',
  endTime: '08:00',
  threshold: 10,
  cooldownMinutes: 60,
  userIds: ['ou_test'],
};
const now = new Date('2026-09-30T14:15:00.750Z');

test('滚动窗口保留毫秒精度并使用北京时间，跨日不受服务器时区影响', () => {
  assert.deepEqual(
    getEmergencyWindow(config, new Date('2026-09-30T16:05:00Z')),
    {
      startTime: '2026-09-30 23:35:00.000',
      endTime: '2026-10-01 00:05:00.000',
    },
  );
});

test('每日时段支持跨午夜，开始包含、结束排除', () => {
  const daily = { ...config, timeMode: 'daily' };
  assert.equal(
    getEmergencyWindow(daily, new Date('2026-09-30T13:59:59Z')),
    null,
  );
  assert.deepEqual(
    getEmergencyWindow(daily, new Date('2026-09-30T14:00:00Z')),
    {
      startTime: '2026-09-30 22:00:00.000',
      endTime: '2026-09-30 22:00:00.000',
    },
  );
  assert.deepEqual(
    getEmergencyWindow(daily, new Date('2026-09-30T23:59:59Z')),
    {
      startTime: '2026-09-30 22:00:00.000',
      endTime: '2026-10-01 07:59:59.000',
    },
  );
  assert.equal(
    getEmergencyWindow(daily, new Date('2026-10-01T00:00:00Z')),
    null,
  );
});

test('普通每日时段只统计今天开始后的记录', () => {
  const daily = {
    ...config,
    timeMode: 'daily',
    startTime: '09:00',
    endTime: '18:00',
  };
  assert.equal(
    getEmergencyWindow(daily, new Date('2026-09-30T00:00:00Z')),
    null,
  );
  assert.deepEqual(
    getEmergencyWindow(daily, new Date('2026-09-30T05:30:00Z')),
    {
      startTime: '2026-09-30 09:00:00.000',
      endTime: '2026-09-30 13:30:00.000',
    },
  );
  assert.equal(
    getEmergencyWindow(daily, new Date('2026-09-30T10:00:00Z')),
    null,
  );
});

test('组合模式取固定时段与滚动窗口交集', () => {
  const combined = { ...config, timeMode: 'combined' };
  assert.deepEqual(getEmergencyWindow(combined, now), {
    startTime: '2026-09-30 22:00:00.000',
    endTime: '2026-09-30 22:15:00.750',
  });
  assert.deepEqual(
    getEmergencyWindow(combined, new Date('2026-09-30T18:00:00Z')),
    {
      startTime: '2026-10-01 01:30:00.000',
      endTime: '2026-10-01 02:00:00.000',
    },
  );
});

function fixture(overrides = {}, sender = null) {
  const calls = { query: [], claim: [], phone: [], logs: [] };
  let claimed = false;
  const model = {
    findByRegion: async () => ({ enabled: 1, emergency_config: config }),
    getEmergencyGroups: async (...args) => {
      calls.query.push(args);
      return { count: 11, maxEventId: '41' };
    },
    claimEmergency: async (...args) => {
      calls.claim.push(args);
      if (claimed) return false;
      claimed = true;
      return true;
    },
    ...overrides,
  };
  const service = loadWithStubs('../src/services/feishuEmergencyService', {
    '../models/FeishuConfig': model,
    './feishuUrgentService': {
      sendUrgentPhoneNotifications: async (data) => {
        calls.phone.push(data);
        return sender ? sender(data) : { success: true, sent: 1, failed: 0 };
      },
    },
    '../utils/logger': Object.fromEntries(
      ['info', 'warn', 'error'].map((level) => [
        level,
        (...args) => calls.logs.push(args),
      ]),
    ),
  });
  return { ...service, calls };
}

test('只在数量严格超过阈值时进入紧急状态，区域和窗口传给统计查询', async () => {
  for (const count of [9, 10, 11]) {
    const service = fixture({
      getEmergencyGroups: async () => ({ count, maxEventId: '41' }),
    });
    assert.equal(
      (await service.assessEmergency('EU', now)).status,
      count > 10 ? 'emergency' : 'normal',
    );
  }
  const service = fixture();
  await service.assessEmergency('EU', now);
  assert.deepEqual(service.calls.query, [
    ['EU', '2026-09-30 21:45:00.750', '2026-09-30 22:15:00.750'],
  ]);
});

test('区域或加急关闭、时段外时不查询历史', async () => {
  for (const row of [
    null,
    { enabled: 0 },
    { enabled: 1, emergency_config: { enabled: false } },
    { enabled: 1, emergency_config: { ...config, timeMode: 'daily' } },
  ]) {
    const service = fixture({ findByRegion: async () => row });
    await service.assessEmergency('US', new Date('2026-09-30T04:00:00Z'));
    assert.equal(service.calls.query.length, 0);
  }
});

test('评估异常不会向外抛错，也不记录可能含联系人数据的原始错误', async () => {
  const service = fixture({
    findByRegion: async () => {
      throw new Error('secret ou_contact');
    },
  });
  assert.equal(
    (await service.assessEmergency('US', now)).status,
    'assessment_failed',
  );
  assert.doesNotMatch(JSON.stringify(service.calls.logs), /secret|ou_contact/);
});

test('同一区域并发评估仅一次加急，冷却不泄露联系人', async (t) => {
  const oldId = process.env.FEISHU_APP_ID;
  const oldSecret = process.env.FEISHU_APP_SECRET;
  process.env.FEISHU_APP_ID = 'test';
  process.env.FEISHU_APP_SECRET = 'test';
  t.after(() => {
    if (oldId === undefined) delete process.env.FEISHU_APP_ID;
    else process.env.FEISHU_APP_ID = oldId;
    if (oldSecret === undefined) delete process.env.FEISHU_APP_SECRET;
    else process.env.FEISHU_APP_SECRET = oldSecret;
  });
  const service = fixture();
  const assessment = await service.assessEmergency('EU', now);
  const outcomes = await Promise.all(
    Array.from({ length: 5 }, () => service.notifyEmergency(assessment)),
  );
  assert.equal(outcomes.filter((item) => item.status === 'sent').length, 1);
  assert.equal(outcomes.filter((item) => item.status === 'cooldown').length, 4);
  assert.equal(service.calls.phone.length, 1);
  assert.match(service.calls.phone[0].text, /新增异常变体组数：11/);
  assert.match(
    service.calls.phone[0].text,
    /关系丢失或成功查询确认父 ASIN 标题为空/,
  );
  assert.doesNotMatch(service.calls.phone[0].text, /历史父体|原父体变化/);
  assert.match(service.calls.phone[0].text, /标题查询失败或超时暂不判定/);
  assert.deepEqual(service.calls.claim[0], [
    'EU',
    60,
    {
      startTime: '2026-09-30 21:45:00.750',
      endTime: '2026-09-30 22:15:00.750',
      maxEventId: '41',
      rule: config,
    },
  ]);
  assert.doesNotMatch(JSON.stringify(service.calls.logs), /ou_test/);
});

test('部分成功或发送异常后仍保留冷却，后续评估不会重复拨打', async (t) => {
  const oldId = process.env.FEISHU_APP_ID;
  const oldSecret = process.env.FEISHU_APP_SECRET;
  process.env.FEISHU_APP_ID = 'test';
  process.env.FEISHU_APP_SECRET = 'test';
  t.after(() => {
    if (oldId === undefined) delete process.env.FEISHU_APP_ID;
    else process.env.FEISHU_APP_ID = oldId;
    if (oldSecret === undefined) delete process.env.FEISHU_APP_SECRET;
    else process.env.FEISHU_APP_SECRET = oldSecret;
  });

  for (const scenario of [
    {
      name: '部分联系人成功',
      sender: async () => ({ success: false, sent: 1, failed: 1 }),
      expected: { status: 'partial', sent: 1, failed: 1 },
    },
    {
      name: '发送器抛出异常',
      sender: async () => {
        throw new Error('private_sender_payload ou_private');
      },
      expected: { status: 'failed' },
    },
  ]) {
    await t.test(scenario.name, async () => {
      const service = fixture(
        {
          findByRegion: async () => ({
            enabled: 1,
            emergency_config: {
              ...config,
              userIds: ['ou_test', 'ou_other'],
            },
          }),
        },
        scenario.sender,
      );
      const firstAssessment = await service.assessEmergency('EU', now);
      assert.deepEqual(
        await service.notifyEmergency(firstAssessment),
        scenario.expected,
      );
      const nextAssessment = await service.assessEmergency('EU', now);
      assert.deepEqual(await service.notifyEmergency(nextAssessment), {
        status: 'cooldown',
      });
      assert.equal(service.calls.phone.length, 1);
      assert.deepEqual(service.calls.phone[0].userIds, ['ou_test', 'ou_other']);
      assert.doesNotMatch(
        JSON.stringify(service.calls.logs),
        /private_sender_payload|ou_private|ou_test|ou_other/,
      );
    });
  }
});

test('每日时段已消费事件退出统计，新一批独立事件达到阈值才再次加急', async (t) => {
  const oldId = process.env.FEISHU_APP_ID;
  const oldSecret = process.env.FEISHU_APP_SECRET;
  process.env.FEISHU_APP_ID = 'test';
  process.env.FEISHU_APP_SECRET = 'test';
  t.after(() => {
    if (oldId === undefined) delete process.env.FEISHU_APP_ID;
    else process.env.FEISHU_APP_ID = oldId;
    if (oldSecret === undefined) delete process.env.FEISHU_APP_SECRET;
    else process.env.FEISHU_APP_SECRET = oldSecret;
  });
  let pendingCount = 11;
  let maxEventId = '41';
  const service = fixture({
    findByRegion: async () => ({
      enabled: 1,
      emergency_config: { ...config, timeMode: 'daily' },
    }),
    getEmergencyGroups: async () => ({ count: pendingCount, maxEventId }),
    claimEmergency: async (_region, _cooldown, options) => {
      assert.equal(options.maxEventId, maxEventId);
      pendingCount = 0;
      return true;
    },
  });
  assert.equal(
    (await service.notifyEmergency(await service.assessEmergency('US', now)))
      .status,
    'sent',
  );
  const later = new Date('2026-09-30T15:30:00Z');
  assert.equal(
    (await service.notifyEmergency(await service.assessEmergency('US', later)))
      .status,
    'normal',
  );
  pendingCount = 10;
  maxEventId = '51';
  assert.equal((await service.assessEmergency('US', later)).status, 'normal');
  pendingCount = 11;
  maxEventId = '52';
  assert.equal(
    (await service.notifyEmergency(await service.assessEmergency('US', later)))
      .status,
    'sent',
  );
  assert.equal(service.calls.phone.length, 2);
});

test('普通通知失败仍执行电话加急，电话失败仍保留普通通知成功', async () => {
  for (const webhookSuccess of [true, false]) {
    let phoneCalls = 0;
    const service = loadWithStubs('../src/services/feishuService', {
      axios: {
        post: async () => ({
          status: 200,
          data: { code: webhookSuccess ? 0 : 1 },
        }),
      },
      '../models/FeishuConfig': {
        findByRegion: async () => ({ webhook_url: 'https://example.test' }),
      },
      './feishuEmergencyService': {
        assessEmergency: async () => ({
          status: 'emergency',
          region: 'EU',
          count: 11,
          threshold: 10,
          config,
        }),
        notifyEmergency: async () => {
          phoneCalls++;
          return { status: 'failed' };
        },
      },
      '../utils/logger': { info() {}, warn() {}, error() {} },
    });
    const outcome = await service.sendSingleCountryNotification('DE', {
      brokenGroups: 0,
    });
    assert.equal(outcome.success, webhookSuccess);
    assert.equal(outcome.emergency.phone.status, 'failed');
    assert.equal(phoneCalls, 1);
    assert.doesNotMatch(JSON.stringify(outcome), /ou_test|userIds/);
    const card = service.buildFeishuCard({
      country: 'DE',
      emergency: {
        status: 'emergency',
        region: 'EU',
        count: 11,
        threshold: 10,
      },
    });
    assert.match(card.header.title.content, /紧急/);
    assert.equal(card.header.template, 'red');
    assert.doesNotMatch(JSON.stringify(card), /全部正常/);
    assert.match(JSON.stringify(card), /新增异常变体组 11 个/);
    assert.doesNotMatch(JSON.stringify(card), /历史父体|原父体变化/);
  }
});

test('群卡片只显示当前异常，不展示历史父体变化', () => {
  const service = loadWithStubs('../src/services/feishuService', {
    axios: {},
    '../models/FeishuConfig': {},
    './feishuEmergencyService': {},
    '../utils/logger': { info() {}, warn() {}, error() {} },
  });
  const card = service.buildFeishuCard({
    country: 'US',
    brokenGroups: 1,
    brokenByType: {
      NO_VARIANTS: 1,
      PARENT_TITLE_EMPTY: 1,
      SP_API_ERROR: 1,
    },
    brokenASINs: [
      {
        asin: 'B000000002',
        groupName: 'group',
        splitDetection: {
          reason: 'RELATIONSHIP_LOST',
          baselineParentAsin: 'B000PARENT',
          currentParentAsin: null,
        },
      },
      {
        asin: 'B000000003',
        groupName: 'group',
        splitDetection: {
          reason: 'PARENT_TITLE_EMPTY',
          baselineParentAsin: 'B000PARENT',
          currentParentAsin: 'B000PARENT',
        },
      },
      {
        asin: 'B000000004',
        groupName: 'group',
        statusSource: 'AUTO',
      },
    ],
    parentChanges: [
      {
        asin: 'B000000001',
        groupName: 'group',
        parentHistory: {
          status: 'CHANGED',
          baselineParentAsin: 'B000PARENT',
          currentParentAsin: 'B000NEWPAR',
        },
      },
    ],
  });
  assert.doesNotMatch(
    JSON.stringify(card),
    /历史父体|原父体发生变化|初始父体|最近确认父体|最近变化前父体|B000NEWPAR|B000000001/,
  );
  assert.match(JSON.stringify(card), /关系丢失，原父体：B000PARENT/);
  assert.match(JSON.stringify(card), /父 ASIN 标题确认为空：1 个/);
  assert.match(JSON.stringify(card), /父 ASIN 标题确认为空：B000PARENT/);
  assert.match(JSON.stringify(card), /SP-API错误：1 个/);
  const errorLine = card.elements[0].text.content
    .split('\n')
    .find((line) => line.includes('[B000000004]'));
  assert.ok(errorLine);
  assert.doesNotMatch(errorLine, /标题确认为空/);
});

test('健康迁移及回到原父体都只显示正常卡片，不展示父体历史', () => {
  const service = loadWithStubs('../src/services/feishuService', {
    axios: {},
    '../models/FeishuConfig': {},
    './feishuEmergencyService': {},
    '../utils/logger': { info() {}, warn() {}, error() {} },
  });
  for (const currentParentAsin of ['B000NEWPAR', 'B000PARENT']) {
    const card = service.buildFeishuCard({
      country: 'US',
      totalGroups: 1,
      brokenGroups: 0,
      brokenASINs: [],
      parentChanges: [
        {
          asin: 'B000000001',
          groupName: '健康迁移组',
          parentHistory: {
            status: 'CHANGED',
            baselineParentAsin: 'B000PARENT',
            currentParentAsin,
            previousParentAsin:
              currentParentAsin === 'B000PARENT' ? 'B000NEWPAR' : 'B000PARENT',
            changedAt: '2026-10-01T00:00:00Z',
            observedAt: '2026-10-01T00:10:00Z',
          },
        },
      ],
    });
    assert.equal(card.header.template, 'green');
    assert.equal(card.header.title.content, 'ASIN变体监控通知-US正常');
    const content = card.elements[0].text.content;
    assert.match(content, /异常分组数量：0，异常ASIN数量：0/);
    assert.match(content, /✅ 全部正常/);
    assert.doesNotMatch(
      content,
      /异常分类统计|历史父体|原父体发生变化|初始父体|最近确认父体|最近变化前父体|B000NEWPAR|B000PARENT|健康迁移组/,
    );
  }
});

test('缺少凭据时不占用冷却，电话服务异常时不会向监控任务抛错', async (t) => {
  const oldId = process.env.FEISHU_APP_ID;
  const oldSecret = process.env.FEISHU_APP_SECRET;
  t.after(() => {
    if (oldId === undefined) delete process.env.FEISHU_APP_ID;
    else process.env.FEISHU_APP_ID = oldId;
    if (oldSecret === undefined) delete process.env.FEISHU_APP_SECRET;
    else process.env.FEISHU_APP_SECRET = oldSecret;
  });
  let claims = 0;
  const service = fixture({
    claimEmergency: async () => {
      claims++;
      throw new Error('database unavailable');
    },
  });
  const assessment = await service.assessEmergency('US', now);
  delete process.env.FEISHU_APP_ID;
  delete process.env.FEISHU_APP_SECRET;
  assert.equal(
    (await service.notifyEmergency(assessment)).status,
    'credentials_missing',
  );
  assert.equal(claims, 0);
  process.env.FEISHU_APP_ID = 'test';
  process.env.FEISHU_APP_SECRET = 'test';
  assert.equal((await service.notifyEmergency(assessment)).status, 'failed');
  assert.equal(claims, 1);
  assert.equal(service.calls.phone.length, 0);
});

test('审计飞书配置时遮蔽联系人与 Webhook，保持原请求可正常保存', async () => {
  const entries = [];
  const audit = loadWithStubs('../src/middleware/auditLog', {
    '../models/AuditLog': { create: async (entry) => entries.push(entry) },
    '../utils/logger': { error() {} },
  });
  const body = {
    country: 'US',
    webhookUrl: 'https://example.test/secret',
    emergency: config,
  };
  await audit(
    { method: 'POST', path: '/feishu-configs', body, headers: {} },
    {
      json() {},
      send() {},
      statusCode: 200,
    },
    () => {},
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].requestData.webhookUrl, '***');
  assert.equal(entries[0].requestData.emergency.userIds, '***');
  assert.deepEqual(body.emergency.userIds, ['ou_test']);
  assert.equal(body.webhookUrl, 'https://example.test/secret');
});
