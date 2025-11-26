const cron = require('node-cron');
const monitorTaskQueue = require('./monitorTaskQueue');
const {
  getCountriesToCheck,
  triggerManualCheck,
  REGION_MAP,
} = require('./monitorTaskRunner');

function initScheduler() {
  console.log('🕐 初始化定时任务...');

  cron.schedule('* * * * *', () => {
    const now = new Date();
    const minute = now.getMinutes();

    const usCountries = getCountriesToCheck('US', minute);
    const euCountries = getCountriesToCheck('EU', minute);
    const allCountries = [...usCountries, ...euCountries];

    if (allCountries.length > 0) {
      monitorTaskQueue.enqueue(allCountries);
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
};
