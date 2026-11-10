const assert = require('node:assert/strict');
const test = require('node:test');
const axios = require('axios');
const logger = require('../src/utils/logger');
const {
  sendUrgentPhoneNotifications,
} = require('../src/services/feishuUrgentService');

const TOKEN_URL =
  'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
const MESSAGE_URL =
  'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id';
const credentials = {
  FEISHU_APP_ID: 'test-app-id',
  FEISHU_APP_SECRET: 'test-app-secret',
};
const request = {
  userIds: ['ou_first', 'ou_second'],
  text: '紧急：指定时间段的异常变体数超过阈值，请处理。',
  requestId: 'alert-US-2026-09-30T00:00:00Z',
};

function response(data = {}) {
  return { status: 200, data: { code: 0, ...data } };
}

function setup(t, handlers = {}) {
  const calls = [];
  const logs = [];
  const previous = Object.fromEntries(
    Object.keys(credentials).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, credentials);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  for (const level of ['info', 'warn', 'error']) {
    t.mock.method(logger, level, (...args) => logs.push({ level, args }));
  }
  t.mock.method(axios, 'post', async (url, body, options) => {
    calls.push({ method: 'POST', url, body, options });
    if (url === TOKEN_URL) {
      return handlers.token
        ? handlers.token()
        : response({ tenant_access_token: 'test-tenant-token' });
    }
    assert.equal(url, MESSAGE_URL);
    return handlers.message
      ? handlers.message(body)
      : response({ data: { message_id: `om_${body.receive_id}` } });
  });
  t.mock.method(axios, 'patch', async (url, body, options) => {
    calls.push({ method: 'PATCH', url, body, options });
    return handlers.urgent
      ? handlers.urgent(body)
      : response({ data: { invalid_user_id_list: [] } });
  });
  return { calls, logs };
}

test('电话加急使用应用消息 ID、open_id 和授权头，每请求限制 10 秒', async (t) => {
  const { calls, logs } = setup(t);
  assert.deepEqual(await sendUrgentPhoneNotifications(request), {
    success: true,
    sent: 2,
    failed: 0,
  });
  assert.deepEqual(calls[0].body, {
    app_id: credentials.FEISHU_APP_ID,
    app_secret: credentials.FEISHU_APP_SECRET,
  });
  assert.equal(calls.length, 5);
  for (const call of calls) {
    assert.equal(call.options.timeout, 10000);
    assert.equal(call.options.maxRedirects, 0);
    assert.equal(
      call.options.headers['Content-Type'],
      'application/json; charset=utf-8',
    );
    assert.doesNotMatch(call.url, /\/api\/api\//);
    if (call.url !== TOKEN_URL) {
      assert.equal(
        call.options.headers.Authorization,
        'Bearer test-tenant-token',
      );
    }
  }
  for (const recipient of request.userIds) {
    const message = calls.find((call) => call.body.receive_id === recipient);
    assert.equal(message.body.msg_type, 'text');
    assert.deepEqual(JSON.parse(message.body.content), { text: request.text });
    const urgent = calls.find(
      (call) => call.body.user_id_list?.[0] === recipient,
    );
    assert.equal(urgent.method, 'PATCH');
    assert.equal(
      urgent.url,
      `https://open.feishu.cn/open-apis/im/v1/messages/om_${recipient}/urgent_phone?user_id_type=open_id`,
    );
    assert.deepEqual(urgent.body, { user_id_list: [recipient] });
  }
  assert.deepEqual(logs.at(-1).args[1], { sent: 2, failed: 0 });
});

test('消息 uuid 对同一告警和联系人稳定，对不同联系人及告警不同', async (t) => {
  const { calls } = setup(t);
  await sendUrgentPhoneNotifications({
    ...request,
    userIds: [' ou_first ', 'ou_first', 'ou_second'],
  });
  await sendUrgentPhoneNotifications(request);
  await sendUrgentPhoneNotifications({ ...request, requestId: 'next-alert' });
  const messages = calls.filter((call) => call.url === MESSAGE_URL);
  assert.equal(messages.length, 6);
  assert.equal(messages[0].body.uuid, messages[2].body.uuid);
  assert.equal(messages[1].body.uuid, messages[3].body.uuid);
  assert.notEqual(messages[0].body.uuid, messages[1].body.uuid);
  assert.notEqual(messages[0].body.uuid, messages[4].body.uuid);
  for (const message of messages) {
    assert.ok(message.body.uuid.length <= 50);
    assert.doesNotMatch(message.body.uuid, /ou_first|ou_second|alert/);
  }
});

test('缺少应用凭据、空联系人和超过 10 名联系人时不访问飞书', async (t) => {
  const { calls } = setup(t);
  delete process.env.FEISHU_APP_SECRET;
  assert.deepEqual(await sendUrgentPhoneNotifications(request), {
    success: false,
    sent: 0,
    failed: 2,
  });
  Object.assign(process.env, credentials);
  for (const invalidRequest of [
    null,
    {},
    { ...request, userIds: [] },
    { ...request, userIds: ['ou_first', ''] },
    { ...request, userIds: Array.from({ length: 11 }, (_, i) => `ou_${i}`) },
    { ...request, requestId: '' },
    { ...request, text: '' },
  ]) {
    const result = await sendUrgentPhoneNotifications(invalidRequest);
    assert.equal(result.success, false);
    assert.equal(result.sent, 0);
  }
  assert.equal(calls.length, 0);
});

test('鉴权 HTTP、业务码或缺少 token 的失败不会发送消息', async (t) => {
  for (const tokenResponse of [
    { status: 503, data: { code: 0, tenant_access_token: 'invalid' } },
    response({ code: 10003, tenant_access_token: 'invalid' }),
    response({}),
  ]) {
    await t.test(JSON.stringify(tokenResponse), async (subtest) => {
      const { calls } = setup(subtest, { token: () => tokenResponse });
      assert.deepEqual(await sendUrgentPhoneNotifications(request), {
        success: false,
        sent: 0,
        failed: 2,
      });
      assert.equal(calls.length, 1);
    });
  }
});

test('消息 HTTP、业务码或缺少消息 ID 的失败不加急且不阻断其他联系人', async (t) => {
  for (const messageResponse of [
    { status: 502, data: { code: 0, data: { message_id: 'om_wrong' } } },
    response({ code: 230001, data: { message_id: 'om_wrong' } }),
    response({ data: {} }),
  ]) {
    await t.test(JSON.stringify(messageResponse), async (subtest) => {
      const { calls } = setup(subtest, {
        message: (body) =>
          body.receive_id === 'ou_first'
            ? messageResponse
            : response({ data: { message_id: 'om_second' } }),
      });
      assert.deepEqual(await sendUrgentPhoneNotifications(request), {
        success: false,
        sent: 1,
        failed: 1,
      });
      const urgentCalls = calls.filter((call) => call.method === 'PATCH');
      assert.equal(urgentCalls.length, 1);
      assert.deepEqual(urgentCalls[0].body.user_id_list, ['ou_second']);
    });
  }
});

test('电话加急校验 HTTP 状态、业务错误码及 invalid_user_id_list', async (t) => {
  for (const urgentResponse of [
    { status: 500, data: { code: 0 } },
    response({ code: 230001 }),
    response({ data: { invalid_user_id_list: ['ou_first'] } }),
    response({ data: { invalid_user_id_list: 'ou_first' } }),
  ]) {
    await t.test(JSON.stringify(urgentResponse), async (subtest) => {
      setup(subtest, {
        urgent: (body) =>
          body.user_id_list[0] === 'ou_first' ? urgentResponse : response(),
      });
      assert.deepEqual(await sendUrgentPhoneNotifications(request), {
        success: false,
        sent: 1,
        failed: 1,
      });
    });
  }
});

test('电话超时失败隔离且不会自动重拨或记录凭据、联系人和外部错误文本', async (t) => {
  const secretError = Object.assign(
    new Error('ou_first test-app-secret test-tenant-token private text'),
    { response: { status: 504, data: { code: 999, msg: 'private payload' } } },
  );
  const { calls, logs } = setup(t, {
    urgent: (body) => {
      if (body.user_id_list[0] === 'ou_first') throw secretError;
      return response();
    },
  });
  assert.deepEqual(await sendUrgentPhoneNotifications(request), {
    success: false,
    sent: 1,
    failed: 1,
  });
  assert.equal(calls.filter((call) => call.method === 'PATCH').length, 2);
  assert.doesNotMatch(
    JSON.stringify(logs),
    /ou_first|ou_second|test-app-secret|test-tenant-token|private|alert-US/,
  );
  assert.deepEqual(logs.find((log) => log.level === 'error').args[1], {
    stage: 'urgent_phone',
    status: 504,
    code: 999,
  });
});

test('鉴权网络异常返回失败而不向监控任务抛出', async (t) => {
  const { calls } = setup(t, {
    token: () => {
      throw new Error('network failed');
    },
  });
  assert.deepEqual(await sendUrgentPhoneNotifications(request), {
    success: false,
    sent: 0,
    failed: 2,
  });
  assert.equal(calls.length, 1);
});
