#!/usr/bin/env node
/**
 * 任务队列测试脚本
 * 测试 Bull 任务队列功能是否正常
 *
 * 使用方法: node scripts/test-queue.js
 */

const path = require('path');
const { loadEnv } = require('./utils/loadEnv');

loadEnv(path.join(__dirname, '../.env'));

const Redis = require('ioredis');
const Queue = require('bull');

// 颜色输出辅助函数
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'cyan');
}

// 构建 Redis URL
function buildRedisUrl() {
  if (process.env.REDIS_URL || process.env.REDIS_URI) {
    return process.env.REDIS_URL || process.env.REDIS_URI;
  }

  const host = process.env.REDIS_HOST || '127.0.0.1';
  const port = process.env.REDIS_PORT || 6379;
  const password = process.env.REDIS_PASSWORD;
  const username = process.env.REDIS_USERNAME;
  const db = process.env.REDIS_DB || '0';

  let url = 'redis://';
  if (username && password) {
    url += `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`;
  } else if (password) {
    url += `:${encodeURIComponent(password)}@`;
  }
  url += `${host}:${port}`;
  if (db !== '0') {
    url += `/${db}`;
  }

  return url;
}

async function testQueue() {
  const results = {
    passed: 0,
    failed: 0,
    warnings: 0,
  };

  console.log('\n' + '='.repeat(60));
  log('📦 任务队列测试', 'blue');
  console.log('='.repeat(60) + '\n');

  const redisUrl = buildRedisUrl();
  const safeUrl = redisUrl.replace(/:([^:@]+)@/, ':****@');
  logInfo(`Redis 连接地址: ${safeUrl}`);

  let redis;
  let monitorQueue;
  let competitorQueue;

  try {
    // 测试 Redis 连接
    logInfo('测试 Redis 连接...');
    redis = new Redis(redisUrl);

    const pong = await redis.ping();
    if (pong !== 'PONG') {
      throw new Error(`Unexpected PONG response: ${pong}`);
    }

    logSuccess('Redis 连接成功');
    results.passed++;

    // 获取 Redis 信息
    const info = await redis.info('server');
    const versionMatch = info.match(/redis_version:(.+)/);
    if (versionMatch) {
      logInfo(`Redis 版本: ${versionMatch[1].trim()}`);
    }

    console.log('');

    // 测试监控任务队列
    logInfo('测试监控任务队列...');
    monitorQueue = new Queue('monitor-task-queue', redisUrl, {
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

    await monitorQueue.isReady();
    logSuccess('监控任务队列初始化成功');
    results.passed++;

    const monitorCounts = await monitorQueue.getJobCounts();
    logInfo(
      `队列状态: 等待=${monitorCounts.waiting}, 活跃=${monitorCounts.active}, 完成=${monitorCounts.completed}, 失败=${monitorCounts.failed}`,
    );

    if (monitorCounts.failed > 0) {
      logWarning(`有 ${monitorCounts.failed} 个失败的任务`);
      results.warnings++;
    }

    console.log('');

    // 测试竞品监控任务队列
    logInfo('测试竞品监控任务队列...');
    competitorQueue = new Queue('competitor-monitor-task-queue', redisUrl, {
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

    await competitorQueue.isReady();
    logSuccess('竞品监控任务队列初始化成功');
    results.passed++;

    const competitorCounts = await competitorQueue.getJobCounts();
    logInfo(
      `队列状态: 等待=${competitorCounts.waiting}, 活跃=${competitorCounts.active}, 完成=${competitorCounts.completed}, 失败=${competitorCounts.failed}`,
    );

    if (competitorCounts.failed > 0) {
      logWarning(`有 ${competitorCounts.failed} 个失败的任务`);
      results.warnings++;
    }

    console.log('');

    // 检查队列配置
    logInfo('检查队列配置...');
    const monitorEvents = monitorQueue.eventNames();
    if (monitorEvents.length > 0) {
      logSuccess('监控队列事件监听器已配置');
      results.passed++;
    }

    const competitorEvents = competitorQueue.eventNames();
    if (competitorEvents.length > 0) {
      logSuccess('竞品队列事件监听器已配置');
      results.passed++;
    }

    console.log('');

    // 测试添加测试任务（可选）
    const shouldTestJob = process.argv.includes('--test-job');
    if (shouldTestJob) {
      logInfo('测试添加任务...');
      try {
        const testJob = await monitorQueue.add(
          'test',
          { test: true },
          {
            removeOnComplete: true,
            removeOnFail: true,
          },
        );
        logSuccess(`测试任务已添加: ${testJob.id}`);
        results.passed++;

        // 等待任务处理或超时
        await new Promise((resolve) => {
          const timeout = setTimeout(() => {
            logWarning(
              '测试任务未在预期时间内处理（这是正常的，因为没有处理器）',
            );
            resolve();
          }, 2000);

          testJob
            .finished()
            .then(() => {
              clearTimeout(timeout);
              logSuccess('测试任务已完成');
              resolve();
            })
            .catch(() => {
              clearTimeout(timeout);
              resolve();
            });
        });
      } catch (error) {
        logWarning(`添加测试任务失败: ${error.message}`);
        results.warnings++;
      }
    } else {
      logInfo('跳过任务添加测试（使用 --test-job 参数可测试）');
    }
  } catch (error) {
    logError(`队列测试失败: ${error.message}`);
    if (error.code === 'ECONNREFUSED') {
      logError('无法连接到 Redis 服务器');
      logInfo('提示: 请确保 Redis 服务正在运行');
      logInfo('启动 Redis: redis-server');
    } else if (error.code === 'NOAUTH') {
      logError('Redis 认证失败');
      logInfo('提示: 请检查 REDIS_PASSWORD 配置');
    }
    results.failed++;
  } finally {
    // 清理资源
    if (redis) {
      await redis.disconnect();
    }
    if (monitorQueue) {
      await monitorQueue.close();
    }
    if (competitorQueue) {
      await competitorQueue.close();
    }
  }

  console.log('');

  // 输出测试结果摘要
  console.log('='.repeat(60));
  log('📊 测试结果摘要', 'blue');
  console.log('='.repeat(60));
  logSuccess(`通过: ${results.passed} 项`);
  if (results.failed > 0) {
    logError(`失败: ${results.failed} 项`);
  }
  if (results.warnings > 0) {
    logWarning(`警告: ${results.warnings} 项`);
  }
  console.log('');

  if (results.failed > 0) {
    logError('任务队列测试未完全通过');
    return 1;
  } else if (results.warnings > 0) {
    logWarning('任务队列测试基本通过，但有一些警告');
    return 0;
  } else {
    logSuccess('任务队列测试通过！');
    return 0;
  }
}

// 运行测试
testQueue()
  .then((exitCode) => {
    process.exit(exitCode);
  })
  .catch((error) => {
    logError(`测试失败: ${error.message}`);
    console.error(error);
    process.exit(1);
  });
