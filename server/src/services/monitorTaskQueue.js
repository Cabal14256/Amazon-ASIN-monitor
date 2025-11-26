const Queue = require('bull');
const monitorTaskRunner = require('./monitorTaskRunner');

const redisUrl =
  process.env.REDIS_URL || process.env.REDIS_URI || 'redis://127.0.0.1:6379';

const monitorTaskQueue = new Queue('monitor-task-queue', redisUrl, {
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 86400 },
  },
});

monitorTaskQueue.process(async (job) => {
  const { countries } = job.data || {};
  if (!countries || !countries.length) {
    return;
  }
  await monitorTaskRunner.runMonitorTask(countries);
});

monitorTaskQueue.on('failed', (job, err) => {
  console.error(
    `🚫 监控任务队列失败 (Job ${job.id}):`,
    err?.message || 'unknown error',
  );
});

function enqueue(countries) {
  if (!countries || !countries.length) {
    return;
  }
  monitorTaskQueue.add({ countries });
}

module.exports = {
  enqueue,
  queue: monitorTaskQueue,
};
