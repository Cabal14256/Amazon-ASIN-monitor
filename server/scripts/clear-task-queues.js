#!/usr/bin/env node

const path = require('path');
const dotenv = require('dotenv');

function parseArgs(argv) {
  const args = {
    env: path.resolve(__dirname, '../.env.worker'),
    queues: ['monitor', 'competitor'],
    includeHistory: false,
    waitActiveMs: 120000,
    pollMs: 1000,
  };

  argv.forEach((arg) => {
    if (!arg) {
      return;
    }

    if (arg === '--include-history') {
      args.includeHistory = true;
      return;
    }

    if (arg.startsWith('--env=')) {
      args.env = path.resolve(__dirname, arg.slice('--env='.length));
      return;
    }

    if (arg.startsWith('--queues=')) {
      args.queues = arg
        .slice('--queues='.length)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      return;
    }

    if (arg.startsWith('--wait-active-ms=')) {
      const value = Number(arg.slice('--wait-active-ms='.length));
      if (Number.isFinite(value) && value >= 0) {
        args.waitActiveMs = value;
      }
      return;
    }

    if (arg.startsWith('--poll-ms=')) {
      const value = Number(arg.slice('--poll-ms='.length));
      if (Number.isFinite(value) && value > 0) {
        args.pollMs = value;
      }
    }
  });

  return args;
}

const args = parseArgs(process.argv.slice(2));
dotenv.config({ path: args.env });

const logger = require('../src/utils/logger');
const monitorTaskQueue = require('../src/services/monitorTaskQueue');
const competitorMonitorTaskQueue = require('../src/services/competitorMonitorTaskQueue');
const exportTaskQueue = require('../src/services/exportTaskQueue');
const importTaskQueue = require('../src/services/importTaskQueue');
const batchCheckTaskQueue = require('../src/services/batchCheckTaskQueue');
const backupTaskQueue = require('../src/services/backupTaskQueue');
const variantCheckTaskQueue = require('../src/services/variantCheckTaskQueue');

const queueMap = {
  monitor: {
    label: 'monitor-task-queue',
    module: monitorTaskQueue,
  },
  competitor: {
    label: 'competitor-monitor-task-queue',
    module: competitorMonitorTaskQueue,
  },
  export: {
    label: 'export-task-queue',
    module: exportTaskQueue,
  },
  import: {
    label: 'import-task-queue',
    module: importTaskQueue,
  },
  batchcheck: {
    label: 'batch-check-task-queue',
    module: batchCheckTaskQueue,
  },
  backup: {
    label: 'backup-task-queue',
    module: backupTaskQueue,
  },
  variantcheck: {
    label: 'variant-check-task-queue',
    module: variantCheckTaskQueue,
  },
};

function normalizeQueueName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s-]+/g, '');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getCounts(queue) {
  return queue.getJobCounts();
}

async function waitForActiveJobs(queue, label, waitActiveMs, pollMs) {
  const deadline = Date.now() + waitActiveMs;

  while (true) {
    const counts = await getCounts(queue);
    if (!counts.active) {
      return counts;
    }

    if (Date.now() >= deadline) {
      throw new Error(
        `${label} 在 ${waitActiveMs}ms 内仍有 ${counts.active} 个 active 作业未结束`,
      );
    }

    logger.info(`[Queue Cleanup] 等待运行中作业结束: ${label}`, {
      active: counts.active,
      waiting: counts.waiting,
      delayed: counts.delayed,
      paused: counts.paused,
    });
    await sleep(pollMs);
  }
}

async function cleanState(queue, state, label) {
  let totalCleaned = 0;

  while (true) {
    let cleaned = [];
    try {
      cleaned = await queue.clean(0, state, 1000);
    } catch (error) {
      logger.warn('[Queue Cleanup] 清理队列状态失败', {
        label,
        state,
        message: error.message,
      });
      break;
    }

    const size = Array.isArray(cleaned) ? cleaned.length : Number(cleaned) || 0;
    totalCleaned += size;

    if (!size) {
      break;
    }
  }

  return totalCleaned;
}

async function cleanupQueue(queueName, queueEntry) {
  const queue = queueEntry.module.queue;
  const label = queueEntry.label;
  const before = await getCounts(queue);

  logger.info(`[Queue Cleanup] 开始清理队列: ${label}`, {
    before,
    includeHistory: args.includeHistory,
  });

  await queue.pause(false, true);
  logger.info(`[Queue Cleanup] 队列已暂停: ${label}`);

  try {
    await waitForActiveJobs(queue, label, args.waitActiveMs, args.pollMs);
    await queue.empty();

    const cleaned = {
      paused: await cleanState(queue, 'paused', label),
      delayed: await cleanState(queue, 'delayed', label),
      wait: await cleanState(queue, 'wait', label),
    };

    if (args.includeHistory) {
      cleaned.completed = await cleanState(queue, 'completed', label);
      cleaned.failed = await cleanState(queue, 'failed', label);
    }

    const after = await getCounts(queue);
    logger.info(`[Queue Cleanup] 队列清理完成: ${label}`, {
      queueName,
      cleaned,
      before,
      after,
    });

    return { label, before, after, cleaned };
  } finally {
    await queue.resume();
    logger.info(`[Queue Cleanup] 队列已恢复: ${label}`);
  }
}

async function run() {
  const normalizedQueueNames = args.queues.map(normalizeQueueName);
  const selectedEntries = normalizedQueueNames.map((name) => {
    const queueEntry = queueMap[name];
    if (!queueEntry) {
      throw new Error(`未知队列: ${name}`);
    }
    return { name, entry: queueEntry };
  });

  logger.info('[Queue Cleanup] 启动队列清理脚本', {
    env: path.basename(args.env),
    queues: selectedEntries.map((item) => item.entry.label),
    includeHistory: args.includeHistory,
    waitActiveMs: args.waitActiveMs,
    pollMs: args.pollMs,
  });

  const results = [];
  try {
    for (const item of selectedEntries) {
      const result = await cleanupQueue(item.name, item.entry);
      results.push(result);
    }
  } finally {
    await Promise.all(
      Object.values(queueMap).map(async ({ module }) => {
        try {
          await module.queue.close();
        } catch (error) {
          logger.warn('[Queue Cleanup] 关闭队列连接失败', {
            message: error.message,
          });
        }
      }),
    );
  }

  logger.info('[Queue Cleanup] 全部完成', {
    results,
  });
}

run().catch((error) => {
  logger.error('[Queue Cleanup] 执行失败', {
    message: error.message,
  });
  process.exitCode = 1;
});
