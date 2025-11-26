#!/usr/bin/env node
const path = require('path');

const targetUrl =
  process.argv[2] ||
  process.env.REDIS_URL ||
  process.env.REDIS_URI ||
  'redis://127.0.0.1:6379';

// Make sure dependent modules use the same URL
process.env.REDIS_URL = targetUrl;
process.env.REDIS_URI = targetUrl;

const Redis = require('ioredis');
const Queue = require('bull');

async function run() {
  console.log('🔍 验证 Redis 访问');
  console.log('➡️  连接地址:', targetUrl);

  const redis = new Redis(targetUrl);
  let queue;

  try {
    const pong = await redis.ping();
    if (pong !== 'PONG') {
      throw new Error(`Unexpected PONG response: ${pong}`);
    }
    console.log('✅ Redis ping 通过');

    const info = await redis.info('server');
    const versionMatch = info.match(/redis_version:(.+)/);
    console.log(
      'ℹ️  Redis 版本:',
      versionMatch ? versionMatch[1].trim() : 'unknown',
    );

    queue = new Queue('monitor-task-queue', targetUrl, {
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
    console.log('📦 Bull 队列名称:', queue.name);
    await queue.isReady();

    const counts = await queue.getJobCounts();
    console.log('📊 队列状态:', counts);

    const waiting = await queue.getWaiting();
    console.log(
      `🟡 等待执行的任务: ${waiting.length}, 最新 ID: ${
        waiting[0]?.id || 'N/A'
      }`,
    );

    const failed = await queue.getFailed(0, 5);
    if (failed.length > 0) {
      console.warn(
        `⚠️ 最近 5 条失败任务:`,
        failed.map((job) => job.id),
      );
    } else {
      console.log('✅ 最近无失败任务');
    }
  } catch (error) {
    console.error('❌ 验证失败:', error.message || error);
    process.exitCode = 1;
  } finally {
    redis.disconnect();
    if (queue) {
      await queue.close();
    }
  }
}

run();
