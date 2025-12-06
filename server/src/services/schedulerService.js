const cron = require('node-cron');
const monitorTaskQueue = require('./monitorTaskQueue');
const competitorMonitorTaskQueue = require('./competitorMonitorTaskQueue');
const {
  getCountriesToCheck,
  triggerManualCheck,
  REGION_MAP,
} = require('./monitorTaskRunner');
const { runCompetitorMonitorTask } = require('./competitorMonitorTaskRunner');

// 分批处理配置
const TOTAL_BATCHES = Number(process.env.MONITOR_BATCH_COUNT) || 1; // 默认不分批

function initScheduler() {
  console.log('🕐 初始化定时任务...');
  console.log(
    `📦 分批处理配置: ${TOTAL_BATCHES} 批（${
      TOTAL_BATCHES === 1 ? '不分批' : '分批处理'
    }）`,
  );

  // US区域：每小时整点和30分执行
  cron.schedule('0,30 * * * *', () => {
    const now = new Date();
    const minute = now.getMinutes();
    const hour = now.getHours();

    // --- Standard Monitor Task ---
    const usCountries = getCountriesToCheck('US', minute);

    if (usCountries.length > 0) {
      // 如果启用分批处理，计算当前批次
      if (TOTAL_BATCHES > 1) {
        // 基于小时和分钟计算批次索引（0 到 TOTAL_BATCHES-1）
        // 使用 (hour * 60 + minute) % TOTAL_BATCHES 来分散批次
        const batchIndex = (hour * 60 + minute) % TOTAL_BATCHES;
        console.log(
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
    const competitorUsCountries = getCountriesToCheck('US', minute);

    if (competitorUsCountries.length > 0) {
      if (TOTAL_BATCHES > 1) {
        const batchIndex = (hour * 60 + minute) % TOTAL_BATCHES;
        console.log(
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
  });

  // EU区域：每小时整点执行
  cron.schedule('0 * * * *', () => {
    const now = new Date();
    const minute = now.getMinutes();
    const hour = now.getHours();

    // --- Standard Monitor Task ---
    const euCountries = getCountriesToCheck('EU', minute);

    if (euCountries.length > 0) {
      // 如果启用分批处理，计算当前批次
      if (TOTAL_BATCHES > 1) {
        // 基于小时和分钟计算批次索引（0 到 TOTAL_BATCHES-1）
        const batchIndex = (hour * 60 + minute) % TOTAL_BATCHES;
        console.log(
          `[定时任务] 标准监控（EU）当前批次: ${
            batchIndex + 1
          }/${TOTAL_BATCHES}`,
        );
        monitorTaskQueue.enqueue(euCountries, {
          batchIndex,
          totalBatches: TOTAL_BATCHES,
        });
      } else {
        // 不分批，直接处理所有国家
        monitorTaskQueue.enqueue(euCountries);
      }
    }

    // --- Competitor Monitor Task ---
    // 竞品监控使用相同的时间表
    const competitorEuCountries = getCountriesToCheck('EU', minute);

    if (competitorEuCountries.length > 0) {
      if (TOTAL_BATCHES > 1) {
        const batchIndex = (hour * 60 + minute) % TOTAL_BATCHES;
        console.log(
          `[定时任务] 竞品监控（EU）当前批次: ${
            batchIndex + 1
          }/${TOTAL_BATCHES}`,
        );
        competitorMonitorTaskQueue.enqueue(competitorEuCountries, {
          batchIndex,
          totalBatches: TOTAL_BATCHES,
        });
      } else {
        competitorMonitorTaskQueue.enqueue(competitorEuCountries);
      }
    }
  });

  console.log('✅ 定时任务已启动');
  console.log('📅 执行时间:');
  console.log('   - 美国区域 (US): 每小时整点和30分');
  console.log('   - 欧洲区域 (UK, DE, FR, IT, ES): 每小时整点');
}

module.exports = {
  initScheduler,
  triggerManualCheck,
  REGION_MAP,
  runCompetitorMonitorTask, // 导出竞品监控任务运行器供手动触发使用
};
