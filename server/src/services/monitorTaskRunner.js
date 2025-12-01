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

// 单次任务限制处理的变体组数量（防止单次任务过大）
const MAX_GROUPS_PER_TASK =
  Number(process.env.MONITOR_MAX_GROUPS_PER_TASK) || 0; // 0 表示不限制

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

async function processCountry(
  countryResults,
  country,
  checkTime,
  batchConfig = null,
) {
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
    let groupsList = [];

    // 如果提供了 batchConfig，使用分批查询
    if (
      batchConfig &&
      batchConfig.batchIndex !== undefined &&
      batchConfig.totalBatches > 1
    ) {
      console.log(
        `[processCountry] ${country} 使用分批查询: 批次 ${
          batchConfig.batchIndex + 1
        }/${batchConfig.totalBatches}`,
      );
      groupsList = await VariantGroup.findByCountryBatch(
        country,
        batchConfig.batchIndex,
        batchConfig.totalBatches,
      );
    } else {
      // 否则使用分页查询
      const pageSize = 200;
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const pageGroups = await VariantGroup.findByCountryPage(
          country,
          page,
          pageSize,
        );
        if (!pageGroups || pageGroups.length === 0) {
          hasMore = false;
          break;
        }
        groupsList.push(...pageGroups);

        // 如果设置了单次任务限制，检查是否达到限制
        if (
          MAX_GROUPS_PER_TASK > 0 &&
          groupsList.length >= MAX_GROUPS_PER_TASK
        ) {
          console.log(
            `[processCountry] ${country} 达到单次任务限制 (${MAX_GROUPS_PER_TASK})，停止加载更多变体组`,
          );
          groupsList = groupsList.slice(0, MAX_GROUPS_PER_TASK);
          hasMore = false;
          break;
        }

        if (pageGroups.length < pageSize) {
          hasMore = false;
          break;
        }
        page++;
      }
    }

    // 如果设置了单次任务限制，截取到限制数量
    if (MAX_GROUPS_PER_TASK > 0 && groupsList.length > MAX_GROUPS_PER_TASK) {
      console.log(
        `[processCountry] ${country} 截取到单次任务限制 (${MAX_GROUPS_PER_TASK})`,
      );
      groupsList = groupsList.slice(0, MAX_GROUPS_PER_TASK);
    }

    if (groupsList.length === 0) {
      console.log(`[processCountry] ${country} 没有需要检查的变体组`);
      return { checked: 0, broken: 0 };
    }

    console.log(
      `[processCountry] ${country} 开始检查 ${groupsList.length} 个变体组`,
    );

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

            if (asinInfo.feishuNotifyEnabled !== 0 && asinInfo.isBroken === 1) {
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

    // 分批查询模式下不需要分页循环
  } catch (error) {
    console.error(`❌ 处理国家 ${country} 失败:`, error.message);
    // 即使出错也返回统计信息
    return { checked, broken };
  }

  return { checked, broken };
}

async function runMonitorTask(countries, batchConfig = null) {
  if (!countries || countries.length === 0) {
    return {
      success: false,
      error: '没有指定要检查的国家',
      totalChecked: 0,
      totalBroken: 0,
      countryResults: {},
    };
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
    return {
      success: false,
      error: '上一个监控任务仍在运行',
      totalChecked: 0,
      totalBroken: 0,
      countryResults: {},
    };
  }

  isMonitorTaskRunning = true;
  syncSemaphoreLimit();

  const batchInfo = batchConfig
    ? ` (批次 ${batchConfig.batchIndex + 1}/${batchConfig.totalBatches})`
    : '';
  console.log(
    `\n⏰ [${new Date().toLocaleString(
      'zh-CN',
    )}] 开始执行监控任务，国家: ${countries.join(', ')}${batchInfo}`,
  );

  const startTime = process.hrtime();
  const countryResults = {};
  let totalChecked = 0;
  let totalBroken = 0;
  const checkTime = new Date(); // 使用 Date 对象而不是字符串

  try {
    const stats = await Promise.all(
      countries.map((country) =>
        processCountry(countryResults, country, checkTime, batchConfig),
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

    const [seconds, nanoseconds] = process.hrtime(startTime);
    const duration = seconds + nanoseconds / 1e9;

    console.log(
      `\n✅ 监控任务完成: 检查 ${totalChecked} 个变体组, 异常 ${totalBroken} 个, 耗时 ${duration.toFixed(
        2,
      )}秒\n`,
    );

    return {
      success: true,
      totalChecked,
      totalBroken,
      totalNormal: totalChecked - totalBroken,
      countryResults,
      notifyResults,
      duration,
      checkTime: checkTime.toISOString(),
    };
  } catch (error) {
    console.error(`❌ 监控任务执行失败:`, error);
    return {
      success: false,
      error: error.message || '监控任务执行失败',
      totalChecked,
      totalBroken,
      totalNormal: totalChecked - totalBroken,
      countryResults,
      duration: 0,
    };
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
    return await runMonitorTask(countries);
  } else {
    const allCountries = Object.keys(REGION_MAP);
    return await runMonitorTask(allCountries);
  }
}

module.exports = {
  REGION_MAP,
  runMonitorTask,
  triggerManualCheck,
  getCountriesToCheck,
};
