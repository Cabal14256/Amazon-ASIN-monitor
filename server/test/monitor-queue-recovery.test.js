process.env.LOG_LEVEL = 'ERROR';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
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
  DEFAULT_OPERATION_CONFIGS,
  DEFAULT_REGION_PER_HOUR,
  DEFAULT_REGION_PER_MINUTE,
  applyRateLimitSafetyFactor,
  getSafeBurst,
  getSafeOperationLimits,
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

test('不同总批次数不会被稳定任务ID误判为重复', () => {
  const twoBatches = buildScheduledJobId('monitor-task-queue', {
    source: 'scheduled',
    requestedAt: '2026-07-31T10:00:05.000Z',
    countries: ['US'],
    batchConfig: { batchIndex: 0, totalBatches: 2 },
  });
  const threeBatches = buildScheduledJobId('monitor-task-queue', {
    source: 'scheduled',
    requestedAt: '2026-07-31T10:00:05.000Z',
    countries: ['US'],
    batchConfig: { batchIndex: 0, totalBatches: 3 },
  });

  assert.notEqual(twoBatches, threeBatches);
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

test('worker看门狗识别有积压且active任务执行超时', async () => {
  const queue = {
    client: { ping: async () => 'PONG' },
    isPaused: async () => false,
    getJobCounts: async () => ({ waiting: 2, active: 1 }),
    getActive: async () => [{ processedOn: 1000 }],
  };

  await assert.rejects(
    checkQueueConnection(queue, {
      checkBacklogProgress: true,
      activeJobMaxAgeMs: 1000,
      now: () => 5000,
    }),
    /active_job_stalled/,
  );
});

test('worker看门狗限制积压状态查询耗时', async () => {
  const queue = {
    client: { ping: async () => 'PONG' },
    isPaused: async () => new Promise(() => {}),
    getJobCounts: async () => ({ waiting: 1, active: 0 }),
  };

  await assert.rejects(
    checkQueueConnection(queue, {
      checkBacklogProgress: true,
      pingTimeoutMs: 10,
    }),
    /Redis backlog health check timed out/,
  );
});

test('看门狗停止后忽略尚未完成检查的失败回调', async () => {
  const queue = new EventEmitter();
  queue.name = 'monitor-task-queue';
  let nowMs = 0;
  let checkCount = 0;
  let rejectPendingCheck;
  let recoveryCount = 0;
  const watchdog = startQueueConnectionWatchdog([queue], {
    runImmediately: false,
    unhealthyMs: 60000,
    now: () => nowMs,
    checkQueue: async () => {
      checkCount += 1;
      if (checkCount === 1) {
        throw new Error('ECONNRESET');
      }
      return new Promise((resolve, reject) => {
        rejectPendingCheck = reject;
      });
    },
    setIntervalFn: () => ({ unref() {} }),
    clearIntervalFn: () => {},
    onUnhealthy: () => {
      recoveryCount += 1;
    },
  });

  await watchdog.runCheck();
  nowMs = 60001;
  const pendingCheck = watchdog.runCheck();
  await Promise.resolve();
  watchdog.stop();
  rejectPendingCheck(new Error('ECONNRESET'));
  await pendingCheck;

  assert.equal(recoveryCount, 0);
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

test('默认operation按显式分钟和小时上限应用安全系数', () => {
  const previous = process.env.SP_API_RATE_LIMIT_SAFETY_FACTOR;
  process.env.SP_API_RATE_LIMIT_SAFETY_FACTOR = '0.75';
  try {
    assert.deepEqual(
      getSafeOperationLimits(DEFAULT_OPERATION_CONFIGS.default),
      {
        effectiveRate: 0.375,
        perMinute: 22,
        perHour: 375,
      },
    );
  } finally {
    if (previous === undefined) {
      delete process.env.SP_API_RATE_LIMIT_SAFETY_FACTOR;
    } else {
      process.env.SP_API_RATE_LIMIT_SAFETY_FACTOR = previous;
    }
  }
});

test('区域小时上限与分钟上限保持一致吞吐', () => {
  assert.equal(DEFAULT_REGION_PER_HOUR, DEFAULT_REGION_PER_MINUTE * 60);
});

test('429错误只在错误对象创建后执行一次配额分析', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../src/config/sp-api.js'),
    'utf8',
  );
  const analyzerCalls = source.match(
    /responseAnalyzer\.analyzeError\(error, operation\)/g,
  );

  assert.equal(analyzerCalls?.length, 1);
  assert.ok(
    source.indexOf('const error = new Error(') <
      source.indexOf('responseAnalyzer.analyzeError(error, operation)'),
  );
});
