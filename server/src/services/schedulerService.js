const cron = require('node-cron');
const VariantGroup = require('../models/VariantGroup');
const ASIN = require('../models/ASIN');
const { checkVariantGroup } = require('./variantCheckService');
const { sendBatchNotifications } = require('./feishuService');
const MonitorHistory = require('../models/MonitorHistory');
const { getMaxConcurrentGroupChecks } = require('../config/monitor-config');

/**
 * 国家区域映射
 */
const REGION_MAP = {
  US: 'US', // 美国
  UK: 'EU', // 英国 - 欧洲区域
  DE: 'EU', // 德国 - 欧洲区域
  FR: 'EU', // 法国 - 欧洲区域
  IT: 'EU', // 意大利 - 欧洲区域
  ES: 'EU', // 西班牙 - 欧洲区域
};

/**
 * 获取当前应该检查的国家列表
 * @param {string} region - 区域：'US' 或 'EU'
 * @param {number} minute - 当前分钟数（0-59）
 * @returns {Array<string>} 国家代码数组
 */
function getCountriesToCheck(region, minute) {
  const countries = [];

  for (const [country, countryRegion] of Object.entries(REGION_MAP)) {
    if (countryRegion === region) {
      // 美国区域：整点和30分都检查
      if (region === 'US' && (minute === 0 || minute === 30)) {
        countries.push(country);
      }
      // 欧洲区域：只在整点检查
      else if (region === 'EU' && minute === 0) {
        countries.push(country);
      }
    }
  }

  return countries;
}

/**
 * 执行监控检查任务
 * @param {Array<string>} countries - 要检查的国家列表
 */
async function runMonitorTask(countries) {
  if (countries.length === 0) {
    return;
  }

  console.log(
    `\n⏰ [${new Date().toLocaleString(
      'zh-CN',
    )}] 开始执行监控任务，国家: ${countries.join(', ')}`,
  );

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
  }
}

async function processCountry(countryResults, country, checkTime) {
  const countryResult = (countryResults[country] =
    countryResults[country] || {
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
    const groups = await VariantGroup.findAll({
      country,
      current: 1,
      pageSize: 1000,
    });

    console.log(`📊 国家 ${country}: 找到 ${groups.list.length} 个变体组`);

    const groupsList = (groups && groups.list) || [];
    if (groupsList.length === 0) {
      return { checked, broken };
    }

    const concurrencyLimit = Math.min(
      Math.max(getMaxConcurrentGroupChecks(), 1),
      groupsList.length,
    );
    let nextGroupIndex = 0;

    const processGroup = async (group) => {
      try {
        checked++;
        countryResult.totalGroups++;
        console.log(`  🔍 检查变体组: ${group.name} (${group.id})`);

        const result = await checkVariantGroup(group.id);
        const brokenASINs = result.brokenASINs || [];

        if (result.isBroken) {
          broken++;
          countryResult.brokenGroups++;
          countryResult.brokenGroupNames.push(group.name);
        }

        try {
          await MonitorHistory.create({
            variantGroupId: group.id,
            checkType: 'GROUP',
            country: group.country,
            isBroken: result.isBroken ? 1 : 0,
            checkResult: JSON.stringify(result),
          });
        } catch (historyError) {
          console.error(
            `  ⚠️  记录监控历史失败:`,
            historyError.message,
          );
        }

        const fullGroup = await VariantGroup.findById(group.id);
        if (fullGroup && fullGroup.children && fullGroup.children.length > 0) {
          for (const asin of fullGroup.children) {
            const asinInfo = await ASIN.findById(asin.id);
            if (asinInfo) {
              await ASIN.updateLastCheckTime(asin.id);
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

              try {
                await MonitorHistory.create({
                  asinId: asinInfo.id,
                  checkType: 'ASIN',
                  country: asinInfo.country,
                  isBroken: asinInfo.isBroken === 1 ? 1 : 0,
                  checkResult: JSON.stringify({
                    asin: asinInfo.asin,
                    isBroken: asinInfo.isBroken === 1,
                  }),
                });
              } catch (historyError) {
                // 静默处理历史记录错误
              }
            }
          }
        }

        console.log(
          `    ${result.isBroken ? '❌ 异常' : '✅ 正常'} - 异常ASIN: ${
            brokenASINs.length
          }`,
        );
      } catch (error) {
        console.error(`  ❌ 检查变体组失败: ${group.name}`, error.message);
        checked++;
        broken++;
        countryResult.brokenGroups++;
        countryResult.brokenGroupNames.push(group.name);
      }
    };

    const workers = Array.from({ length: concurrencyLimit }, async () => {
      while (true) {
        const currentIndex = nextGroupIndex++;
        if (currentIndex >= groupsList.length) {
          break;
        }
        await processGroup(groupsList[currentIndex]);
      }
    });

    await Promise.all(workers);
  } catch (error) {
    console.error(`❌ 处理国家 ${country} 失败:`, error.message);
  }

  return { checked, broken };
}

/**
 * 初始化定时任务
 */
function initScheduler() {
  console.log('🕐 初始化定时任务...');

  // 每分钟检查一次，判断是否需要执行任务
  cron.schedule('* * * * *', () => {
    const now = new Date();
    const minute = now.getMinutes();
    const hour = now.getHours();

    // 获取当前应该检查的国家
    const usCountries = getCountriesToCheck('US', minute);
    const euCountries = getCountriesToCheck('EU', minute);

    const allCountries = [...usCountries, ...euCountries];

    if (allCountries.length > 0) {
      // 异步执行，不阻塞定时器
      runMonitorTask(allCountries).catch((error) => {
        console.error('定时任务执行错误:', error);
      });
    }
  });

  console.log('✅ 定时任务已启动');
  console.log('📅 执行时间:');
  console.log('   - 美国区域 (US): 每小时整点和30分');
  console.log('   - 欧洲区域 (UK, DE, FR, IT, ES): 每小时整点');
}

/**
 * 手动触发监控任务（用于测试）
 * @param {Array<string>} countries - 要检查的国家列表，如果不提供则检查所有国家
 */
async function triggerManualCheck(countries = null) {
  if (countries && Array.isArray(countries)) {
    await runMonitorTask(countries);
  } else {
    // 检查所有国家
    const allCountries = Object.keys(REGION_MAP);
    await runMonitorTask(allCountries);
  }
}

module.exports = {
  initScheduler,
  triggerManualCheck,
  runMonitorTask,
  REGION_MAP,
};
