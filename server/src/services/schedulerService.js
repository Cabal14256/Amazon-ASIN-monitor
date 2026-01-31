const cron = require('node-cron');
const logger = require('../utils/logger');
const monitorTaskQueue = require('./monitorTaskQueue');
const competitorMonitorTaskQueue = require('./competitorMonitorTaskQueue');
const {
  getCountriesToCheck,
  triggerManualCheck,
  REGION_MAP,
} = require('./monitorTaskRunner');
const { runCompetitorMonitorTask } = require('./competitorMonitorTaskRunner');
const {
  isCompetitorMonitorEnabled,
} = require('../config/competitor-monitor-config');
const BackupConfig = require('../models/BackupConfig');
const backupService = require('./backupService');
const { refreshRecentMonitorHistoryAgg } = require('./analyticsAggService');
const metricsService = require('./metricsService');
const { getUTC8ISOString } = require('../utils/dateTime');

// 分批处理配置
const TOTAL_BATCHES = Number(process.env.MONITOR_BATCH_COUNT) || 1; // 默认不分批

// EU国家检查顺序：UK, DE, FR, ES, IT
const EU_COUNTRIES_ORDER = ['UK', 'DE', 'FR', 'ES', 'IT'];
const US_CRON_EXPRESSION = '0,30 * * * *';
const EU_CRON_EXPRESSION = '0 * * * *';
const ANALYTICS_CRON_EXPRESSION = '5 * * * *';

const schedulerStatus = {
  us: {
    schedule: US_CRON_EXPRESSION,
    lastStandardRun: null,
    lastCompetitorRun: null,
  },
  eu: {
    schedule: EU_CRON_EXPRESSION,
    lastStandardRun: null,
    lastCompetitorRun: null,
  },
  analyticsAgg: {
    enabled: process.env.ANALYTICS_AGG_ENABLED !== '0',
    schedule: ANALYTICS_CRON_EXPRESSION,
    lastRun: null,
    lastSuccess: null,
    lastError: null,
  },
  backup: {
    enabled: false,
    schedule: null,
    lastRun: null,
    lastSuccess: null,
    lastError: null,
  },
};

function recordSchedulerRun(type, durationSec) {
  metricsService.recordSchedulerRun({ type, durationSec });
}

function updateLastRun(target, field) {
  schedulerStatus[target][field] = getUTC8ISOString();
}

async function runAnalyticsAgg(source) {
  const start = Date.now();
  schedulerStatus.analyticsAgg.lastRun = getUTC8ISOString();
  try {
    const result = await refreshRecentMonitorHistoryAgg();
    if (result?.success) {
      schedulerStatus.analyticsAgg.lastSuccess = getUTC8ISOString();
      schedulerStatus.analyticsAgg.lastError = null;
    } else if (result?.skipped) {
      schedulerStatus.analyticsAgg.lastError = result.reason || 'skipped';
    }
    return result;
  } catch (error) {
    schedulerStatus.analyticsAgg.lastError = error.message;
    throw error;
  } finally {
    recordSchedulerRun(`analytics_${source}`, (Date.now() - start) / 1000);
  }
}

// 自动备份任务引用
let backupTask = null;

function initScheduler() {
  logger.info('🕐 初始化定时任务...');
  logger.info(
    `📦 分批处理配置: ${TOTAL_BATCHES} 批（${
      TOTAL_BATCHES === 1 ? '不分批' : '分批处理'
    }）`,
  );

  // US区域：每小时整点和30分执行
  cron.schedule(US_CRON_EXPRESSION, () => {
    const start = Date.now();
    const now = new Date();
    const minute = now.getMinutes();
    const hour = now.getHours();

    // --- Standard Monitor Task ---
    const usCountries = getCountriesToCheck('US', minute);

    if (usCountries.length > 0) {
      updateLastRun('us', 'lastStandardRun');
      // 如果启用分批处理，计算当前批次
      if (TOTAL_BATCHES > 1) {
        // 基于小时和分钟计算批次索引（0 到 TOTAL_BATCHES-1）
        // 使用 (hour * 60 + minute) % TOTAL_BATCHES 来分散批次
        const batchIndex = (hour * 60 + minute) % TOTAL_BATCHES;
        logger.info(
          `[定时任务] 标准监控（US）当前批次: ${
            batchIndex + 1
          }/${TOTAL_BATCHES}`,
        );
        monitorTaskQueue.enqueue(usCountries, {
          batchIndex,
          totalBatches: TOTAL_BATCHES,
        });
      } else {
        // 不分批，直接处理所有国家
        monitorTaskQueue.enqueue(usCountries);
      }
    }

    // --- Competitor Monitor Task ---
    // 竞品监控使用相同的时间表
    if (isCompetitorMonitorEnabled()) {
      const competitorUsCountries = getCountriesToCheck('US', minute);

      if (competitorUsCountries.length > 0) {
        updateLastRun('us', 'lastCompetitorRun');
        if (TOTAL_BATCHES > 1) {
          const batchIndex = (hour * 60 + minute) % TOTAL_BATCHES;
          logger.info(
            `[定时任务] 竞品监控（US）当前批次: ${
              batchIndex + 1
            }/${TOTAL_BATCHES}`,
          );
          competitorMonitorTaskQueue.enqueue(competitorUsCountries, {
            batchIndex,
            totalBatches: TOTAL_BATCHES,
          });
        } else {
          competitorMonitorTaskQueue.enqueue(competitorUsCountries);
        }
      }
    } else {
      logger.info('[定时任务] 竞品监控已关闭，跳过本次US任务');
    }

    recordSchedulerRun('us', (Date.now() - start) / 1000);
  });

  // EU区域：每小时整点执行
  // EU国家按顺序依次检查：UK, DE, FR, ES, IT
  cron.schedule(EU_CRON_EXPRESSION, () => {
    const start = Date.now();
    const now = new Date();
    const minute = now.getMinutes();
    const hour = now.getHours();

    // --- Standard Monitor Task ---
    const euCountries = getCountriesToCheck('EU', minute);

    // 按指定顺序排序EU国家
    const orderedEuCountries = EU_COUNTRIES_ORDER.filter((country) =>
      euCountries.includes(country),
    );

    if (orderedEuCountries.length > 0) {
      updateLastRun('eu', 'lastStandardRun');
      // 如果启用分批处理，计算当前批次
      if (TOTAL_BATCHES > 1) {
        // 基于小时和分钟计算批次索引（0 到 TOTAL_BATCHES-1）
        const batchIndex = (hour * 60 + minute) % TOTAL_BATCHES;
        logger.info(
          `[定时任务] 标准监控（EU）当前批次: ${
            batchIndex + 1
          }/${TOTAL_BATCHES}`,
        );
        // 按顺序依次加入队列，每个国家单独一个任务
        orderedEuCountries.forEach((country, index) => {
          setTimeout(() => {
            monitorTaskQueue.enqueue([country], {
              batchIndex,
              totalBatches: TOTAL_BATCHES,
            });
          }, index * 1000); // 每个国家间隔1秒加入队列
        });
      } else {
        // 不分批，按顺序依次加入队列
        orderedEuCountries.forEach((country, index) => {
          setTimeout(() => {
            monitorTaskQueue.enqueue([country]);
          }, index * 1000); // 每个国家间隔1秒加入队列
        });
      }
    }

    // --- Competitor Monitor Task ---
    // 竞品监控使用相同的时间表，也按顺序执行
    if (isCompetitorMonitorEnabled()) {
      const competitorEuCountries = getCountriesToCheck('EU', minute);

      // 按指定顺序排序EU国家
      const orderedCompetitorEuCountries = EU_COUNTRIES_ORDER.filter(
        (country) => competitorEuCountries.includes(country),
      );

      if (orderedCompetitorEuCountries.length > 0) {
        updateLastRun('eu', 'lastCompetitorRun');
        if (TOTAL_BATCHES > 1) {
          const batchIndex = (hour * 60 + minute) % TOTAL_BATCHES;
          logger.info(
            `[定时任务] 竞品监控（EU）当前批次: ${
              batchIndex + 1
            }/${TOTAL_BATCHES}`,
          );
          // 按顺序依次加入队列，每个国家单独一个任务
          orderedCompetitorEuCountries.forEach((country, index) => {
            setTimeout(() => {
              competitorMonitorTaskQueue.enqueue([country], {
                batchIndex,
                totalBatches: TOTAL_BATCHES,
              });
            }, index * 1000); // 每个国家间隔1秒加入队列
          });
        } else {
          // 不分批，按顺序依次加入队列
          orderedCompetitorEuCountries.forEach((country, index) => {
            setTimeout(() => {
              competitorMonitorTaskQueue.enqueue([country]);
            }, index * 1000); // 每个国家间隔1秒加入队列
          });
        }
      }
    } else {
      logger.info('[定时任务] 竞品监控已关闭，跳过本次EU任务');
    }

    recordSchedulerRun('eu', (Date.now() - start) / 1000);
  });

  logger.info('✅ 定时任务已启动');
  logger.info('📅 执行时间:');
  logger.info('   - 美国区域 (US): 每小时整点和30分');
  logger.info(
    '   - 欧洲区域 (EU): 每小时整点，按顺序依次检查: UK → DE → FR → ES → IT',
  );

  // 数据分析聚合刷新（默认开启，可通过 ANALYTICS_AGG_ENABLED=0 关闭）
  if (process.env.ANALYTICS_AGG_ENABLED !== '0') {
    // 启动时先执行一次（异步，不阻塞启动）
    runAnalyticsAgg('startup').catch((error) => {
      logger.error('❌ 初始化数据分析聚合失败:', error.message);
    });

    // 每小时第5分钟刷新一次最近聚合数据
    cron.schedule(ANALYTICS_CRON_EXPRESSION, () => {
      runAnalyticsAgg('scheduled').catch((error) => {
        logger.error('❌ 定时聚合刷新失败:', error.message);
      });
    });
    logger.info('📊 数据分析聚合刷新已启用（每小时第5分钟）');
  } else {
    logger.info('📊 数据分析聚合刷新已禁用（ANALYTICS_AGG_ENABLED=0）');
  }

  // 初始化自动备份任务（异步执行，不阻塞启动）
  initBackupScheduler().catch((error) => {
    logger.error('❌ 初始化自动备份任务失败:', error.message);
  });

  // ⭐ 新增：启动时立即执行一次监控（借鉴老项目经验）
  // 暂时注释掉，后续再启用
  // if (process.env.MONITOR_RUN_ON_STARTUP !== '0') {
  //   (async () => {
  //     console.log('🚀 启动后立即执行一次监控...');
  //     const { runMonitorTask } = require('./monitorTaskRunner');
  //
  //     // 默认只执行US，可通过环境变量配置
  //     const startupCountries = process.env.MONITOR_STARTUP_COUNTRIES
  //       ? process.env.MONITOR_STARTUP_COUNTRIES.split(',').map(c => c.trim().toUpperCase())
  //       : ['US'];
  //
  //     try {
  //       await runMonitorTask(startupCountries);
  //       console.log('✅ 启动时监控执行完成');
  //     } catch (error) {
  //       console.error('❌ 启动时监控执行失败:', error.message);
  //       // 不抛出错误，避免影响服务启动
  //     }
  //   })();
  // } else {
  //   console.log('ℹ️  启动时监控已禁用（MONITOR_RUN_ON_STARTUP=0）');
  // }
}

/**
 * 生成 cron 表达式
 */
function generateCronExpression(scheduleType, scheduleValue, backupTime) {
  const [hour, minute] = backupTime.split(':').map(Number);

  switch (scheduleType) {
    case 'daily':
      // 每天执行: 0 {minute} {hour} * * *
      return `${minute} ${hour} * * *`;
    case 'weekly': {
      // 每周执行: 0 {minute} {hour} * * {dayOfWeek}
      // scheduleValue: 1=周一, 2=周二, ..., 7=周日
      // cron: 0=周日, 1=周一, ..., 6=周六
      const dayOfWeek = scheduleValue === 7 ? 0 : scheduleValue;
      return `${minute} ${hour} * * ${dayOfWeek}`;
    }
    case 'monthly':
      // 每月执行: 0 {minute} {hour} {day} * *
      return `${minute} ${hour} ${scheduleValue} * *`;
    default:
      return null;
  }
}

/**
 * 初始化自动备份定时任务
 */
async function initBackupScheduler() {
  try {
    const config = await BackupConfig.findOne();

    if (!config || !config.enabled) {
      schedulerStatus.backup.enabled = false;
      schedulerStatus.backup.schedule = null;
      logger.info('ℹ️  自动备份未启用');
      return;
    }

    const cronExpression = generateCronExpression(
      config.scheduleType,
      config.scheduleValue,
      config.backupTime,
    );

    if (!cronExpression) {
      schedulerStatus.backup.enabled = false;
      logger.error('❌ 无效的备份计划配置');
      return;
    }

    // 如果已有任务，先停止
    if (backupTask) {
      backupTask.stop();
    }

    // 创建新的定时任务
    backupTask = cron.schedule(cronExpression, async () => {
      schedulerStatus.backup.lastRun = getUTC8ISOString();
      try {
        logger.info('🔄 开始执行自动备份...');
        const now = new Date();
        const description = `AutoBackup-${now
          .toISOString()
          .slice(0, 19)
          .replace('T', ' ')}`;
        await backupService.createBackup({ description });
        schedulerStatus.backup.lastSuccess = getUTC8ISOString();
        schedulerStatus.backup.lastError = null;
        logger.info('✅ 自动备份完成');
      } catch (error) {
        schedulerStatus.backup.lastError = error.message;
        logger.error('❌ 自动备份失败:', error.message);
      }
    });

    schedulerStatus.backup.enabled = true;
    schedulerStatus.backup.schedule = cronExpression;
    logger.info('✅ 自动备份定时任务已启动');
    logger.info(`📅 备份计划: ${config.scheduleType}`);
    if (config.scheduleType === 'weekly') {
      const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      const dayName =
        weekDays[config.scheduleValue === 7 ? 0 : config.scheduleValue];
      logger.info(`   每周${dayName} ${config.backupTime} 执行`);
    } else if (config.scheduleType === 'monthly') {
      logger.info(`   每月${config.scheduleValue}号 ${config.backupTime} 执行`);
    } else {
      logger.info(`   每天 ${config.backupTime} 执行`);
    }
  } catch (error) {
    schedulerStatus.backup.enabled = false;
    schedulerStatus.backup.lastError = error.message;
    logger.error('❌ 初始化自动备份任务失败:', error.message);
  }
}

/**
 * 重新加载备份计划（配置更新时调用）
 */
async function reloadBackupSchedule() {
  logger.info('🔄 重新加载备份计划...');
  if (backupTask) {
    backupTask.stop();
    backupTask = null;
  }
  await initBackupScheduler();
}

module.exports = {
  initScheduler,
  triggerManualCheck,
  REGION_MAP,
  runCompetitorMonitorTask, // 导出竞品监控任务运行器供手动触发使用
  initBackupScheduler,
  reloadBackupSchedule,
  getSchedulerStatus: () => ({ ...schedulerStatus }),
};
