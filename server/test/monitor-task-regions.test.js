process.env.LOG_LEVEL = 'ERROR';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  enqueueMonitorCountries,
  groupCountriesByRegion,
  getMonitorRunScope,
} = require('../src/services/monitorTaskRegions');
const {
  createMonitorTaskRunStateStore,
} = require('../src/services/monitorTaskRunState');
const { getWorkerQueueConfig } = require('../src/services/workerQueueConfig');

const REGION_MAP = {
  US: 'US',
  UK: 'EU',
  DE: 'EU',
  FR: 'EU',
  ES: 'EU',
  IT: 'EU',
};

test('标准监控国家按 US/EU 分组', () => {
  assert.deepEqual(
    groupCountriesByRegion(['US', 'UK', 'DE', 'US'], REGION_MAP),
    {
      US: ['US', 'US'],
      EU: ['UK', 'DE'],
    },
  );
});

test('单区域任务使用区域运行锁，混合任务使用全局作用域', () => {
  assert.equal(getMonitorRunScope(['US'], REGION_MAP), 'US');
  assert.equal(getMonitorRunScope(['UK', 'DE'], REGION_MAP), 'EU');
  assert.equal(getMonitorRunScope(['US', 'UK'], REGION_MAP), 'GLOBAL');
});

test('US 和 EU 运行状态互相独立', () => {
  const states = createMonitorTaskRunStateStore();
  const usState = states.get(getMonitorRunScope(['US'], REGION_MAP));
  const euState = states.get(getMonitorRunScope(['UK'], REGION_MAP));

  usState.isRunning = true;

  assert.equal(usState.isRunning, true);
  assert.equal(euState.isRunning, false);
});

test('混合国家手动任务分别进入 US 和 EU 队列', async () => {
  const calls = [];
  const queues = {
    US: {
      enqueue: async (countries, batchConfig, options) => {
        calls.push({ region: 'US', countries, batchConfig, options });
        return { id: 'us-job' };
      },
    },
    EU: {
      enqueue: async (countries, batchConfig, options) => {
        calls.push({ region: 'EU', countries, batchConfig, options });
        return { id: 'eu-job' };
      },
    },
  };

  const jobs = await enqueueMonitorCountries(
    ['US', 'UK', 'DE'],
    REGION_MAP,
    queues,
    null,
    { source: 'manual' },
  );

  assert.deepEqual(
    calls.map(({ region, countries }) => ({ region, countries })),
    [
      { region: 'US', countries: ['US'] },
      { region: 'EU', countries: ['UK', 'DE'] },
    ],
  );
  assert.deepEqual(
    jobs.map(({ id }) => id),
    ['us-job', 'eu-job'],
  );
});

test('旧 monitor Worker 配置自动启用 US 和 EU 标准队列', () => {
  const registrations = [
    { name: 'monitor', aliases: ['monitor-us', 'monitorus'] },
    { name: 'monitorEu', aliases: ['monitor-eu', 'monitoreu'] },
    { name: 'competitor', aliases: ['competitor'] },
  ];

  const config = getWorkerQueueConfig(registrations, 'monitor,competitor');

  assert.deepEqual(config.enabledQueues, [
    'monitor',
    'competitor',
    'monitorEu',
  ]);
  assert.equal(config.unknownQueues.length, 0);
});

test('Worker 可单独选择 US 或 EU 标准队列', () => {
  const registrations = [
    { name: 'monitor', aliases: ['monitor-us', 'monitorus'] },
    { name: 'monitorEu', aliases: ['monitor-eu', 'monitoreu'] },
  ];

  assert.deepEqual(
    getWorkerQueueConfig(registrations, 'monitor-us').enabledQueues,
    ['monitor'],
  );
  assert.deepEqual(
    getWorkerQueueConfig(registrations, 'monitor-eu').enabledQueues,
    ['monitorEu'],
  );
});
