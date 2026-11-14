const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

process.env.LOG_LEVEL = 'ERROR';
process.env.SP_API_RATE_LIMIT_PER_MINUTE = '60';
process.env.SP_API_RATE_LIMIT_PER_HOUR = '1000';
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '../config/redis') {
    return {
      initRedis: async () => null,
      getRedisClient: () => null,
      isRedisAvailable: () => false,
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const limiter = require('../src/services/rateLimiter');
Module._load = originalLoad;
const risk = require('../src/services/riskControlService');
risk.stopRateLimiterAutoAdjustment();

function scenario(run) {
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  limiter.initializeRateLimiters();
  risk.resetMetrics();
  const tick = () => {
    now += 5 * 60 * 1000;
  };
  const record = (region, success = true, count = 20, isRateLimit = false) => {
    for (let i = 0; i < count; i++)
      risk.recordCheck({ region, success, isRateLimit });
  };
  try {
    run({ tick, record });
  } finally {
    Date.now = originalNow;
  }
}

test('健康后逐步恢复至配置基线，保留限流器及已消费令牌', () =>
  scenario(({ tick }) => {
    const original = limiter.getRateLimiter('US');
    original.minuteLimiter.tokens = 4;
    assert.equal(limiter.adjustRateLimit('US', 0, 1, 20).newPerMinute, 48);
    assert.equal(limiter.getRateLimiter('US'), original);
    assert.equal(original.minuteLimiter.tokens, 4);
    tick();
    assert.equal(limiter.adjustRateLimit('US', 0, 0, 20).adjusted, false);
    // A second evaluation in the same window cannot accelerate recovery.
    assert.equal(limiter.adjustRateLimit('US', 0, 0, 20).adjusted, false);
    tick();
    assert.equal(limiter.adjustRateLimit('US', 0, 0, 20).newPerMinute, 57);
    tick();
    const restored = limiter.adjustRateLimit('US', 0, 0, 20);
    assert.equal(restored.newPerMinute, 60);
    assert.equal(restored.newPerHour, 1000);
    tick();
    assert.equal(limiter.adjustRateLimit('US', 0, 0, 20).adjusted, false);
  }));

test('无流量、样本不足及再次限流中断健康恢复', () =>
  scenario(({ tick }) => {
    limiter.adjustRateLimit('US', 0, 1, 20);
    for (const [count, errors, samples] of [
      [0, 0, 20],
      [0, 0, 0],
      [0, 0, 20],
      [0, 0, 19],
      [0, 0, 20],
      [1, 0.05, 20],
    ]) {
      tick();
      assert.equal(
        limiter.adjustRateLimit('US', count, errors, samples).newPerMinute,
        48,
      );
    }
    tick();
    assert.equal(limiter.adjustRateLimit('US', 0, 1, 20).newPerMinute, 38);
  }));

test('恢复依据来自各区域新鲜 API 样本，旧错误不会永久压低速率', () =>
  scenario(({ tick, record }) => {
    record('US', false);
    assert.equal(risk.adjustRateLimiter('US').newPerMinute, 48);
    assert.equal(risk.adjustRateLimiter('EU').newPerMinute, 60);
    tick();
    record('US');
    record('EU', false);
    assert.equal(risk.adjustRateLimiter('US').adjusted, false);
    assert.equal(risk.adjustRateLimiter('EU').newPerMinute, 48);
    tick();
    record('US');
    assert.equal(risk.adjustRateLimiter('US').newPerMinute, 57);
    assert.equal(risk.adjustRateLimiter('EU').adjusted, false);
    tick();
    // Consumed samples cannot count again; region-less/cache checks don't recover.
    record(undefined);
    assert.equal(risk.adjustRateLimiter('EU').adjusted, false);
  }));

test('过期健康样本不能恢复速率', () =>
  scenario(({ tick, record }) => {
    limiter.adjustRateLimit('US', 0, 1, 20);
    record('US');
    tick();
    tick();
    assert.equal(risk.adjustRateLimiter('US').adjusted, false);
    tick();
    record('US');
    assert.equal(risk.adjustRateLimiter('US').adjusted, false);
  }));

test('低于默认保护下限的配置也不会在降速时被抬高', () => {
  process.env.SP_API_RATE_LIMIT_PER_MINUTE = '10';
  process.env.SP_API_RATE_LIMIT_PER_HOUR = '100';
  try {
    scenario(() => {
      const result = limiter.adjustRateLimit('US', 20, 1, 20);
      assert.equal(result.newPerMinute, 10);
      assert.equal(result.newPerHour, 100);
    });
  } finally {
    process.env.SP_API_RATE_LIMIT_PER_MINUTE = '60';
    process.env.SP_API_RATE_LIMIT_PER_HOUR = '1000';
  }
});
