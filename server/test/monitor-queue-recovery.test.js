process.env.LOG_LEVEL = 'ERROR';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const {
  DEFAULT_SCHEDULED_JOB_MAX_AGE_MS,
  buildScheduledJobId,
  evaluateScheduledJobFreshness,
} = require('../src/services/monitorQueuePolicy');
const {
  checkQueueConnection,
  startQueueConnectionWatchdog,
} = require('../src/services/queueConnectionWatchdog');
const {
  applyRateLimitSafetyFactor,
  getSafeBurst,
} = require('../src/services/rateLimiter');

test('定时监控任务超过最大排队时长后被判定为过期', () => {
  const requestedAt = Date.parse('2026-07-31T08:00:00.000Z');
  const result = evaluateScheduledJobFreshness(
    {
      source: 'scheduled',
      requestedAt: new Date(requestedAt).toISOString(),
    },
    requestedAt,
    requestedAt + DEFAULT_SCHEDULED_JOB_MAX_AGE_MS + 1,
  );

  assert.equal(result.stale, true);
  assert.equal(result.reason, 'scheduled_job_expired');
});

test('手动任务不应用定时任务过期策略', () => {
  const result = evaluateScheduledJobFreshness(
    {
      source: 'manual',
      requestedAt: '2026-07-31T08:00:00.000Z',
    },
    null,
    Date.parse('2026-07-31T12:00:00.000Z'),
  );

  assert.equal(result.stale, false);
});

test('同一调度分钟和国家生成稳定的Bull任务ID', () => {
  const first = buildScheduledJobId('monitor-task-queue', {
    source: 'scheduled',
    requestedAt: '2026-07-31T10:00:05.000Z',
    countries: ['DE', 'UK'],
    batchConfig: { batchIndex: 1 },
  });
  const duplicate = buildScheduledJobId('monitor-task-queue', {
    source: 'scheduled',
    requestedAt: '2026-07-31T10:00:45.000Z',
    countries: ['UK', 'DE'],
    batchConfig: { batchIndex: 1 },
  });

  assert.equal(first, duplicate);
  assert.equal(first.includes(':'), false);
});

test('连接看门狗在持续异常达到阈值后只触发一次恢复', async () => {
  const queue = new EventEmitter();
  queue.name = 'monitor-task-queue';
  let nowMs = 0;
  let recoveryCount = 0;
  const watchdog = startQueueConnectionWatchdog([queue], {
    runImmediately: false,
    unhealthyMs: 60000,
    now: () => nowMs,
    checkQueue: async () => {
      throw new Error('ECONNRESET');
    },
    setIntervalFn: () => ({ unref() {} }),
    clearIntervalFn: () => {},
    onUnhealthy: () => {
      recoveryCount += 1;
    },
  });

  await watchdog.runCheck();
  nowMs = 60001;
  await watchdog.runCheck();
  nowMs = 120002;
  await watchdog.runCheck();

  assert.equal(recoveryCount, 1);
  assert.equal(watchdog.getState(queue).recoveryTriggered, true);
  watchdog.stop();
});

test('worker看门狗识别有等待任务但没有消费者活动', async () => {
  const queue = {
    client: { ping: async () => 'PONG' },
    isPaused: async () => false,
    getJobCounts: async () => ({ waiting: 2, active: 0 }),
  };

  await assert.rejects(
    checkQueueConnection(queue, { checkBacklogProgress: true }),
    /queue_not_consuming/,
  );
});

test('响应头配额应用安全系数并压低突发量', () => {
  const previous = process.env.SP_API_RATE_LIMIT_SAFETY_FACTOR;
  process.env.SP_API_RATE_LIMIT_SAFETY_FACTOR = '0.75';
  try {
    assert.equal(applyRateLimitSafetyFactor(2), 1.5);
    assert.equal(getSafeBurst(2), 1);
  } finally {
    if (previous === undefined) {
      delete process.env.SP_API_RATE_LIMIT_SAFETY_FACTOR;
    } else {
      process.env.SP_API_RATE_LIMIT_SAFETY_FACTOR = previous;
    }
  }
});
