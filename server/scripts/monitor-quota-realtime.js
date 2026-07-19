#!/usr/bin/env node

const path = require('path');
const { loadEnv } = require('./utils/loadEnv');

if (require.main === module) {
  loadEnv(path.join(__dirname, '../.env'));
}

const logger = require('../src/utils/logger');
const rateLimiter = require('../src/services/rateLimiter');
const { closeRedis, initRedis } = require('../src/config/redis');

const MONITORED_OPERATIONS = ['getCatalogItem', 'searchCatalogItems'];

function parseArgs(argv) {
  return {
    once: argv.includes('--once'),
  };
}

function normalizeInterval(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 1000 ? parsed : 60000;
}

function formatUsage(window) {
  if (!window) return '未启用';
  const usagePercent =
    window.limit > 0 ? (window.used / window.limit) * 100 : 0;
  return `${window.used}/${window.limit} 已用，${
    window.remaining
  } 剩余（${usagePercent.toFixed(1)}%）`;
}

async function collectSnapshots(limiter = rateLimiter) {
  const entries = await Promise.all(
    ['US', 'EU'].map(async (region) => {
      const regionStatus = await limiter.getStatusSnapshot(region);
      const operationEntries = await Promise.all(
        MONITORED_OPERATIONS.map(async (operation) => [
          operation,
          await limiter.getStatusSnapshot(region, operation),
        ]),
      );
      return [
        region,
        {
          region: regionStatus,
          operations: Object.fromEntries(operationEntries),
        },
      ];
    }),
  );
  return Object.fromEntries(entries);
}

function assertDistributedSnapshots(snapshots) {
  for (const [region, snapshot] of Object.entries(snapshots)) {
    if (snapshot.region.mode !== 'redis-distributed') {
      throw new Error(
        `${region} 未使用 Redis 分布式限流；独立监控进程无法读取其他进程的内存令牌桶`,
      );
    }
  }
}

function displaySnapshots(snapshots) {
  logger.info('\nSP-API 本地限流器实时状态');
  logger.info(`更新时间：${new Date().toLocaleString('zh-CN')}`);

  for (const [region, snapshot] of Object.entries(snapshots)) {
    logger.info(`\n${region} 区域总窗口：`);
    logger.info(`  分钟：${formatUsage(snapshot.region.windows.minute)}`);
    logger.info(`  小时：${formatUsage(snapshot.region.windows.hour)}`);

    for (const [operation, status] of Object.entries(snapshot.operations)) {
      logger.info(`  ${operation}：`);
      logger.info(`    秒：${formatUsage(status.windows.second)}`);
      logger.info(`    分钟：${formatUsage(status.windows.minute)}`);
      logger.info(`    小时：${formatUsage(status.windows.hour)}`);
      logger.info(
        `    限额来源：${status.limitSource || 'default'}${
          status.limitUpdatedAt ? `，更新时间 ${status.limitUpdatedAt}` : ''
        }`,
      );
    }
  }
}

async function runMonitor({
  once = false,
  intervalMs = normalizeInterval(process.env.QUOTA_MONITOR_INTERVAL),
  limiter = rateLimiter,
  close = closeRedis,
  initialize = initRedis,
} = {}) {
  let stopped = false;
  let timer = null;

  const stop = async () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearTimeout(timer);
    try {
      await close();
    } catch (error) {
      logger.warn('[配额监控] 关闭 Redis 连接失败:', error.message);
    }
  };

  const sample = async () => {
    const snapshots = await collectSnapshots(limiter);
    assertDistributedSnapshots(snapshots);
    displaySnapshots(snapshots);
  };

  await initialize();

  if (once) {
    try {
      await sample();
    } finally {
      await stop();
    }
    return { stop };
  }

  const scheduleNext = async () => {
    if (stopped) return;
    try {
      await sample();
    } catch (error) {
      logger.error('[配额监控] 获取状态失败:', error.message);
      await stop();
      process.exitCode = 1;
      return;
    }
    timer = setTimeout(scheduleNext, intervalMs);
  };

  await scheduleNext();
  return { stop };
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  let monitor;
  let shutdownRequested = false;

  const shutdown = async () => {
    shutdownRequested = true;
    if (monitor) await monitor.stop();
  };

  process.once('SIGINT', () => {
    void shutdown();
  });
  process.once('SIGTERM', () => {
    void shutdown();
  });

  runMonitor(args)
    .then((result) => {
      monitor = result;
      if (shutdownRequested) {
        void monitor.stop();
      }
    })
    .catch(async (error) => {
      logger.error('[配额监控] 启动失败:', error.message);
      try {
        await closeRedis();
      } catch (closeError) {
        logger.warn('[配额监控] 关闭 Redis 连接失败:', closeError.message);
      }
      process.exitCode = 1;
    });
}

module.exports = {
  MONITORED_OPERATIONS,
  assertDistributedSnapshots,
  collectSnapshots,
  displaySnapshots,
  formatUsage,
  normalizeInterval,
  parseArgs,
  runMonitor,
};
