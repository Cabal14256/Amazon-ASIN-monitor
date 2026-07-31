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
  getOperationBurstLimit,
  getSafeBurst,
  getSafeOperationLimits,
} = require('../src/services/rateLimiter');
const {
  processMonitorTaskJob,
} = require('../src/services/monitorTaskProcessor');

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

test('显式突发上限独立于持续速率安全系数', () => {
  const previousFactor = process.env.SP_API_RATE_LIMIT_SAFETY_FACTOR;
  const previousCap = process.env.SP_API_RATE_LIMIT_BURST_CAP;
  process.env.SP_API_RATE_LIMIT_SAFETY_FACTOR = '0.75';
  process.env.SP_API_RATE_LIMIT_BURST_CAP = '2';
  try {
    assert.equal(getSafeBurst(2), 1);
    assert.equal(getOperationBurstLimit(2), 2);
    assert.equal(getOperationBurstLimit(1), 1);
  } finally {
    if (previousFactor === undefined) {
      delete process.env.SP_API_RATE_LIMIT_SAFETY_FACTOR;
    } else {
      process.env.SP_API_RATE_LIMIT_SAFETY_FACTOR = previousFactor;
    }
    if (previousCap === undefined) {
      delete process.env.SP_API_RATE_LIMIT_BURST_CAP;
    } else {
      process.env.SP_API_RATE_LIMIT_BURST_CAP = previousCap;
    }
  }
});

test('US标准任务结束后才入队竞品后继任务', async () => {
  const calls = [];
  const followUpRequestedAt = '2026-07-31T14:05:00.000Z';
  const job = {
    id: 'standard-us',
    timestamp: Date.now(),
    data: {
      countries: ['US'],
      batchConfig: null,
      source: 'scheduled',
      requestedAt: new Date().toISOString(),
      followUp: {
        type: 'competitor',
        countries: ['US'],
        batchConfig: null,
        source: 'scheduled',
        requestedAt: new Date().toISOString(),
      },
    },
    async update(data) {
      calls.push('persist-standard-completed');
      this.data = data;
    },
  };

  const result = await processMonitorTaskJob(job, {
    runMonitorTask: async (countries, batchConfig, options) => {
      calls.push('standard-start');
      assert.deepEqual(countries, ['US']);
      assert.equal(batchConfig, null);
      assert.equal(options.waitForDeferred, true);
      await Promise.resolve();
      calls.push('standard-complete');
      return { success: true };
    },
    enqueueCompetitor: async (countries, batchConfig, options) => {
      calls.push('competitor-enqueue');
      assert.deepEqual(countries, ['US']);
      assert.equal(batchConfig, null);
      assert.equal(options.source, 'scheduled');
      assert.equal(options.requestedAt, followUpRequestedAt);
    },
    getCurrentTimestamp: () => followUpRequestedAt,
  });

  assert.deepEqual(calls, [
    'standard-start',
    'standard-complete',
    'persist-standard-completed',
    'competitor-enqueue',
  ]);
  assert.equal(result.competitorFollowUpEnqueued, true);
  assert.equal(job.data.followUpRequestedAt, followUpRequestedAt);
});

test('没有竞品后继的手动队列任务保持立即返回调用方式', async () => {
  const job = {
    id: 'manual-us',
    timestamp: Date.now(),
    data: {
      countries: ['US'],
      source: 'manual',
      requestedAt: new Date().toISOString(),
    },
  };
  let argumentCount = 0;

  const result = await processMonitorTaskJob(job, {
    runMonitorTask: async function runManualTask() {
      argumentCount = arguments.length;
      return { success: false, error: '上一个监控任务仍在运行' };
    },
    enqueueCompetitor: async () => {
      assert.fail('手动任务不应入队竞品后继任务');
    },
  });

  assert.equal(argumentCount, 2);
  assert.equal(result.success, false);
});

test('竞品入队失败重试时不会重复执行已完成的标准任务', async () => {
  let standardRuns = 0;
  let competitorEnqueues = 0;
  const competitorRequestedAt = [];
  const requestedAt = new Date().toISOString();
  const followUpRequestedAt = '2026-07-31T14:10:00.000Z';
  const job = {
    id: 'standard-us-retry',
    timestamp: Date.now(),
    data: {
      countries: ['US'],
      source: 'scheduled',
      requestedAt,
      followUp: {
        type: 'competitor',
        countries: ['US'],
        source: 'scheduled',
        requestedAt,
      },
    },
    async update(data) {
      this.data = data;
    },
  };
  const dependencies = {
    runMonitorTask: async (countries, batchConfig, options) => {
      standardRuns += 1;
      assert.deepEqual(countries, ['US']);
      assert.equal(batchConfig, undefined);
      assert.equal(options.waitForDeferred, true);
      return { success: true };
    },
    enqueueCompetitor: async (countries, batchConfig, options) => {
      competitorEnqueues += 1;
      competitorRequestedAt.push(options.requestedAt);
      if (competitorEnqueues === 1) {
        throw new Error('Redis unavailable');
      }
    },
    getCurrentTimestamp: () => followUpRequestedAt,
  };

  await assert.rejects(
    processMonitorTaskJob(job, dependencies),
    /Redis unavailable/,
  );
  await processMonitorTaskJob(job, dependencies);

  assert.equal(standardRuns, 1);
  assert.equal(competitorEnqueues, 2);
  assert.deepEqual(competitorRequestedAt, [
    followUpRequestedAt,
    followUpRequestedAt,
  ]);
});

test('已完成标准任务的重试使用后继时间而不被父任务年龄跳过', async () => {
  const followUpRequestedAt = new Date().toISOString();
  let competitorEnqueues = 0;
  const job = {
    id: 'standard-us-old-parent',
    timestamp: Date.now() - DEFAULT_SCHEDULED_JOB_MAX_AGE_MS - 1000,
    data: {
      countries: ['US'],
      source: 'scheduled',
      requestedAt: new Date(
        Date.now() - DEFAULT_SCHEDULED_JOB_MAX_AGE_MS - 1000,
      ).toISOString(),
      standardCompleted: true,
      followUpRequestedAt,
      followUp: {
        type: 'competitor',
        countries: ['US'],
        source: 'scheduled',
      },
    },
  };

  const result = await processMonitorTaskJob(job, {
    runMonitorTask: async () => {
      assert.fail('标准任务已完成时不应重复执行');
    },
    enqueueCompetitor: async (countries, batchConfig, options) => {
      competitorEnqueues += 1;
      assert.deepEqual(countries, ['US']);
      assert.equal(options.requestedAt, followUpRequestedAt);
    },
  });

  assert.equal(competitorEnqueues, 1);
  assert.equal(result.competitorFollowUpEnqueued, true);
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
