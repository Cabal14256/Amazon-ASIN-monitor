process.env.LOG_LEVEL = 'ERROR';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

function loadQueueFactory() {
  const factoryPath = path.resolve(
    __dirname,
    '../src/services/monitorTaskQueueFactory.js',
  );
  const queueInstances = [];
  const originalLoad = Module._load;
  const buildScheduledJobId =
    require('../src/services/monitorQueuePolicy').buildScheduledJobId;

  class FakeQueue extends EventEmitter {
    constructor(name, redisUrl, options) {
      super();
      this.name = name;
      this.redisUrl = redisUrl;
      this.options = options;
      queueInstances.push(this);
    }

    process(concurrency, processor) {
      this.processor = processor;
      this.concurrency = concurrency;
    }

    add(data, options) {
      return Promise.resolve({
        id: options.jobId,
        data,
        options,
      });
    }
  }

  const mocks = {
    bull: FakeQueue,
    '../utils/logger': { info() {}, error() {} },
    './monitorQueuePolicy': { buildScheduledJobId },
    './monitorTaskProcessor': { processMonitorTaskJob: async () => ({}) },
    './bullQueueSettings': { getBullQueueSettings: () => ({}) },
    './monitorTaskRunner': { runMonitorTask: async () => ({}) },
  };

  Module._load = function loadWithMocks(request, parent, isMain) {
    if (parent?.filename === factoryPath && Object.hasOwn(mocks, request)) {
      return mocks[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[factoryPath];

  try {
    return {
      factory: require(factoryPath),
      queueInstances,
      restore() {
        Module._load = originalLoad;
        delete require.cache[factoryPath];
      },
    };
  } catch (error) {
    Module._load = originalLoad;
    delete require.cache[factoryPath];
    throw error;
  }
}

test('US 和 EU 标准监控队列使用独立 Bull 队列名与任务 ID', async () => {
  const previousRedisUrl = process.env.REDIS_URL;
  process.env.REDIS_URL = 'redis://localhost:6379';
  const { factory, queueInstances, restore } = loadQueueFactory();

  try {
    const usQueue = factory.createMonitorTaskQueue({
      name: 'monitor-task-queue',
    });
    const euQueue = factory.createMonitorTaskQueue({
      name: 'monitor-eu-task-queue',
    });
    const requestedAt = '2026-10-17T03:00:00.000Z';
    const [usJob, euJob] = await Promise.all([
      usQueue.enqueue(['US'], null, { requestedAt }),
      euQueue.enqueue(['UK', 'DE'], null, { requestedAt }),
    ]);

    assert.deepEqual(
      queueInstances.map((queue) => queue.name),
      ['monitor-task-queue', 'monitor-eu-task-queue'],
    );
    assert.notEqual(usJob.id, euJob.id);
    assert.equal(usJob.data.countries[0], 'US');
    assert.deepEqual(euJob.data.countries, ['UK', 'DE']);
  } finally {
    restore();
    if (previousRedisUrl === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = previousRedisUrl;
    }
  }
});
