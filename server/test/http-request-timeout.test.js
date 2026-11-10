const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULT_HTTP_REQUEST_TIMEOUT_MS,
  getHttpRequestTimeoutMs,
  attachHttpRequestTimeout,
} = require('../src/utils/httpRequestTimeout');

test('HTTP请求超时配置使用正整数并回退默认值', () => {
  assert.equal(getHttpRequestTimeoutMs('1500'), 1500);
  assert.equal(getHttpRequestTimeoutMs('0'), DEFAULT_HTTP_REQUEST_TIMEOUT_MS);
  assert.equal(
    getHttpRequestTimeoutMs('invalid'),
    DEFAULT_HTTP_REQUEST_TIMEOUT_MS,
  );
});

test('HTTP请求超时回调只触发一次且可取消', async () => {
  const events = [];
  const request = {
    setTimeout(_duration, callback) {
      this.timeoutCallback = callback;
    },
  };
  const stop = attachHttpRequestTimeout(request, {
    timeoutMs: 5,
    label: 'test request',
    onTimeout(error) {
      events.push(error);
    },
  });

  request.timeoutCallback();
  request.timeoutCallback();
  assert.equal(events.length, 1);
  assert.equal(events[0].code, 'ETIMEDOUT');
  assert.match(events[0].message, /test request/);

  stop();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(events.length, 1);
});
