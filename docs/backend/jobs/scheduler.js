// jobs/scheduler.js
require('dotenv').config();

const cron = require('node-cron');
const db3 = require('../utils/db3');

// ① 普通监控（你原来的）
const { registerMonitorJobs } = require('../services/variantMonitor');

// ② 竞品监控：直接调用我们写好的快照函数
const { runCompSnapshot } = require('../services/compMonitor');

const log = (...args) => console.log('[COMP-CRON]', ...args);

/* ---------------- 竞品监控：定时器注册 ---------------- */

const ENABLED   = String(process.env.COMP_CRON_ENABLED ?? '1') === '1';
const CRON_EXPR = process.env.COMP_CRON_EXPR || '15 * * * *';
const TIMEZONE  = process.env.COMP_CRON_TZ   || 'Asia/Shanghai';       // 用北京时间
const COUNTRIES = (process.env.COMP_CRON_COUNTRIES || 'US')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const LIMIT     = Number(process.env.COMP_CRON_LIMIT || 200);          // 每次最多抓多少个
const RUN_ON_BOOT = String(process.env.COMP_CRON_RUN_ON_BOOT ?? '1') === '1';

// ========== 修改点1: 移除了分布式锁相关函数 ==========
// 移除了 acquireLock 和 releaseLock 函数
// 原因: 单实例部署，任务执行时间稳定(30-35秒)，锁机制导致任务被跳过

async function tick() {
  const startTime = Date.now(); // ========== 修改点2: 添加执行时间监控 ==========
  const ts = new Date().toISOString();
  log(`tick start @ ${ts}, countries=${COUNTRIES.join(',')}, limit=${LIMIT}`);

  // ========== 修改点3: 移除了锁获取逻辑 ==========
  // 不再检查锁状态，确保任务每次都能执行

  try {
    let total = 0;
    for (const c of COUNTRIES) {
      try {
        const n = await runCompSnapshot({ country: c, limit: LIMIT });
        total += n;
        log(`country=${c} inserted=${n}`);
      } catch (e) {
        log(`country=${c} error:`, e?.message || e);
      }
    }
    
    // ========== 修改点4: 添加执行时长日志 ==========
    const duration = Date.now() - startTime;
    log(`tick done, total inserted=${total}, duration=${duration}ms`);
    
    // ========== 修改点5: 添加执行时间过长警告 ==========
    if (duration > 300000) { // 5分钟阈值
      log(`⚠️ WARNING: Task execution took too long: ${duration}ms`);
    }
  } catch (e) {
    log('tick error:', e?.message || e);
  }
  // ========== 修改点6: 移除了锁释放逻辑 ==========
}

function registerCompCron() {
  if (!ENABLED) {
    log('disabled by env (COMP_CRON_ENABLED != 1)');
    return;
  }
  cron.schedule(CRON_EXPR, tick, { timezone: TIMEZONE });
  log(`registered expr="${CRON_EXPR}", tz=${TIMEZONE}, countries=${COUNTRIES.join(',')}, limit=${LIMIT}`);

  if (RUN_ON_BOOT) {
    log('run once on boot...');
    tick();
  }
}

/* ---------------- 统一初始化 ---------------- */

function initSchedulers() {
  console.log('⏰ 定时任务调度器启动...');
  // 你原来的：普通监控
  registerMonitorJobs();
  // 新增：竞品监控
  registerCompCron();
}

initSchedulers();