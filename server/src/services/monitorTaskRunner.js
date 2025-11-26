const VariantGroup = require('../models/VariantGroup');
const ASIN = require('../models/ASIN');
const { checkVariantGroup } = require('./variantCheckService');
const { sendBatchNotifications } = require('./feishuService');
const MonitorHistory = require('../models/MonitorHistory');
const { getMaxConcurrentGroupChecks } = require('../config/monitor-config');
const Semaphore = require('./semaphore');
const metricsService = require('./metricsService');

let monitorSemaphore = new Semaphore(getMaxConcurrentGroupChecks());
let isMonitorTaskRunning = false;
let pendingRunCountries = null;

const REGION_MAP = {
  US: 'US',
  UK: 'EU',
  DE: 'EU',
  FR: 'EU',
  IT: 'EU',
  ES: 'EU',
};

function syncSemaphoreLimit() {
  monitorSemaphore.setMax(getMaxConcurrentGroupChecks());
}

function getCountriesToCheck(region, minute) {
  const countries = [];
  for (const [country, countryRegion] of Object.entries(REGION_MAP)) {
    if (countryRegion !== region) continue;
    if (region === 'US' && (minute === 0 || minute === 30)) {
      countries.push(country);
    } else if (region === 'EU' && minute === 0) {
      countries.push(country);
    }
  }
  return countries;
}

async function processCountry(countryResults, country, checkTime) {
  const countryResult = (countryResults[country] = countryResults[country] || {
    country,
    totalGroups: 0,
    brokenGroups: 0,
    brokenGroupNames: [],
    brokenASINs: [],
    checkTime,
  });

  let checked = 0;
  let broken = 0;

  try {
    const pageSize = 200;
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const groupsList = await VariantGroup.findByCountryPage(
        country,
        page,
        pageSize,
      );
      if (!groupsList || groupsList.length === 0) {
        hasMore = false;
        break;
      }

      const chunkConcurrency = Math.min(
        Math.max(getMaxConcurrentGroupChecks(), 1),
        groupsList.length,
      );
      let nextGroupIndex = 0;

      const workers = Array.from({ length: chunkConcurrency }, async () => {
        while (true) {
          const currentIndex = nextGroupIndex++;
          if (currentIndex >= groupsList.length) {
            break;
          }
          const group = groupsList[currentIndex];
          checked++;
          countryResult.totalGroups++;

          let result;
          const workerStart = process.hrtime();
          await monitorSemaphore.acquire();
          try {
            result = await checkVariantGroup(group.id);
          } finally {
            monitorSemaphore.release();
          }
          const [seconds, nanoseconds] = process.hrtime(workerStart);
          metricsService.recordVariantGroupCheck({
            region: country,
            durationSec: seconds + nanoseconds / 1e9,
            isBroken: result?.isBroken,
          });

          const brokenASINs = result?.brokenASINs || [];
          if (result?.isBroken) {
            broken++;
            countryResult.brokenGroups++;
            countryResult.brokenGroupNames.push(group.name);
          }

          const historyEntries = [
            {
              variantGroupId: group.id,
              checkType: 'GROUP',
              country: group.country,
              isBroken: result?.isBroken ? 1 : 0,
              checkResult: result,
              checkTime,
            },
          ];

          const fullGroup = await VariantGroup.findById(group.id);
          if (fullGroup && Array.isArray(fullGroup.children)) {
            for (const asinInfo of fullGroup.children) {
              await ASIN.updateLastCheckTime(asinInfo.id);

              if (
                asinInfo.feishuNotifyEnabled !== 0 &&
                asinInfo.isBroken === 1
              ) {
                countryResult.brokenASINs.push({
                  asin: asinInfo.asin,
                  name: asinInfo.name || '',
                  groupName: group.name,
                  brand: asinInfo.brand || '',
                });
              }

              historyEntries.push({
                asinId: asinInfo.id,
                variantGroupId: group.id,
                checkType: 'ASIN',
                country: asinInfo.country,
                isBroken: asinInfo.isBroken === 1 ? 1 : 0,
                checkResult: {
                  asin: asinInfo.asin,
                  isBroken: asinInfo.isBroken === 1,
                },
                checkTime,
              });
            }
          }

          try {
            await MonitorHistory.bulkCreate(historyEntries);
          } catch (historyError) {
            console.error(`  ⚠️  批量记录监控历史失败:`, historyError.message);
          }
        }
      });

      await Promise.all(workers);

      if (groupsList.length < pageSize) {
        hasMore = false;
      } else {
        page++;
      }
    }
  } catch (error) {
    console.error(`❌ 处理国家 ${country} 失败:`, error.message);
  }

  return { checked, broken };
}

async function runMonitorTask(countries) {
  if (!countries || countries.length === 0) {
    return;
  }

  if (isMonitorTaskRunning) {
    pendingRunCountries = Array.from(
      new Set([...(pendingRunCountries || []), ...countries]),
    );
    console.log(
      `⏳ 上一个监控任务仍在运行，已缓存下一次执行的国家: ${pendingRunCountries.join(
        ', ',
      )}`,
    );
    return;
  }

  isMonitorTaskRunning = true;
  syncSemaphoreLimit();

  console.log(
    `\n⏰ [${new Date().toLocaleString(
      'zh-CN',
    )}] 开始执行监控任务，国家: ${countries.join(', ')}`,
  );

  const startTime = process.hrtime();
  const countryResults = {};
  let totalChecked = 0;
  let totalBroken = 0;
  const checkTime = new Date().toLocaleString('zh-CN');

  try {
    const stats = await Promise.all(
      countries.map((country) =>
        processCountry(countryResults, country, checkTime),
      ),
    );

    stats.forEach(({ checked, broken }) => {
      totalChecked += checked;
      totalBroken += broken;
    });

    console.log(`\n📨 开始发送飞书通知...`);
    const notifyResults = await sendBatchNotifications(countryResults);
    console.log(
      `📨 通知发送完成: 总计 ${notifyResults.total}, 成功 ${notifyResults.success}, 失败 ${notifyResults.failed}, 跳过 ${notifyResults.skipped}`,
    );

    console.log(
      `\n✅ 监控任务完成: 检查 ${totalChecked} 个变体组, 异常 ${totalBroken} 个\n`,
    );
  } catch (error) {
    console.error(`❌ 监控任务执行失败:`, error);
  } finally {
    isMonitorTaskRunning = false;
    const [seconds, nanoseconds] = process.hrtime(startTime);
    metricsService.recordSchedulerRun({
      type: 'monitor_task',
      durationSec: seconds + nanoseconds / 1e9,
    });
    if (pendingRunCountries && pendingRunCountries.length > 0) {
      const nextCountries = pendingRunCountries;
      pendingRunCountries = null;
      await runMonitorTask(nextCountries);
    }
  }
}

async function triggerManualCheck(countries = null) {
  if (countries && Array.isArray(countries)) {
    await runMonitorTask(countries);
  } else {
    const allCountries = Object.keys(REGION_MAP);
    await runMonitorTask(allCountries);
  }
}

module.exports = {
  REGION_MAP,
  runMonitorTask,
  triggerManualCheck,
  getCountriesToCheck,
};
