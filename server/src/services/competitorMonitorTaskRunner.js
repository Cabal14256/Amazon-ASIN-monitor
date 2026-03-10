const CompetitorVariantGroup = require('../models/CompetitorVariantGroup');
const {
  checkCompetitorVariantGroup,
} = require('./competitorVariantCheckService');
const {
  sendCompetitorBatchNotifications,
} = require('./competitorFeishuService');
const CompetitorMonitorHistory = require('../models/CompetitorMonitorHistory');
const { getMaxConcurrentGroupChecks } = require('../config/monitor-config');
const Semaphore = require('./semaphore');
const metricsService = require('./metricsService');
const websocketService = require('./websocketService');
const {
  getUTC8ISOString,
  getUTC8LocaleString,
  toUTC8ISOString,
} = require('../utils/dateTime');
const {
  isCompetitorMonitorEnabled,
} = require('../config/competitor-monitor-config');
const logger = require('../utils/logger');
const {
  getMonitorScheduleConfig,
} = require('../config/monitor-schedule-config');

let competitorMonitorSemaphore = new Semaphore(getMaxConcurrentGroupChecks());
let isCompetitorMonitorTaskRunning = false;
let pendingCompetitorRunCountries = null;

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

function syncCompetitorSemaphoreLimit() {
  // 获取当前并发数（如果启用了自动调整，这里会触发调整逻辑）
  const currentConcurrency = getMaxConcurrentGroupChecks();
  competitorMonitorSemaphore.setMax(currentConcurrency);
}

function getCountriesToCheck(region, minute) {
  const { usIntervalMinutes, euIntervalMinutes } = getMonitorScheduleConfig();
  const intervalMinutes =
    region === 'US' ? usIntervalMinutes : euIntervalMinutes;

  if (!intervalMinutes || minute % intervalMinutes !== 0) {
    return [];
  }

  const countries = [];
  for (const [country, countryRegion] of Object.entries(REGION_MAP)) {
    if (countryRegion !== region) continue;
    countries.push(country);
  }
  return countries;
}

async function processCompetitorCountry(
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
    brokenByType: { SP_API_ERROR: 0, NO_VARIANTS: 0 },
    checkTime,
  });

  let checked = 0;
  let broken = 0;

  try {
    let groupsList = [];
    if (
      batchConfig &&
      batchConfig.batchIndex !== undefined &&
      batchConfig.totalBatches > 1
    ) {
      groupsList = await CompetitorVariantGroup.findByCountryBatch(
        country,
        batchConfig.batchIndex,
        batchConfig.totalBatches,
      );
    } else {
      const pageSize = 200;
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        const pageGroups = await CompetitorVariantGroup.findByCountryPage(
          country,
          page,
          pageSize,
        );
        if (!pageGroups || pageGroups.length === 0) {
          hasMore = false;
          break;
        }
        groupsList.push(...pageGroups);
        if (
          MAX_GROUPS_PER_TASK > 0 &&
          groupsList.length >= MAX_GROUPS_PER_TASK
        ) {
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
    if (MAX_GROUPS_PER_TASK > 0 && groupsList.length > MAX_GROUPS_PER_TASK) {
      groupsList = groupsList.slice(0, MAX_GROUPS_PER_TASK);
    }

    if (groupsList.length === 0) {
      logger.info(
        `[processCompetitorCountry] ${country} 没有需要检查的竞品变体组`,
      );
      return { checked: 0, broken: 0 };
    }

    const groupIds = groupsList.map((group) => group.id);
    const groupMap = await CompetitorVariantGroup.findByIdsWithChildren(
      groupIds,
    );

    const chunkConcurrency = Math.min(
      Math.max(getMaxConcurrentGroupChecks(), 1),
      groupsList.length,
    );
    let nextGroupIndex = 0;
    const totalGroups = groupsList.length;

    const workers = Array.from({ length: chunkConcurrency }, async () => {
      while (true) {
        const currentIndex = nextGroupIndex++;
        if (currentIndex >= groupsList.length) {
          break;
        }
        const group = groupsList[currentIndex];
        const groupSnapshot = groupMap.get(group.id) || group;
        checked++;
        countryResult.totalGroups++;

        websocketService.sendMonitorProgress({
          status: 'progress',
          country,
          current: checked,
          total: totalGroups,
          progress: Math.round((checked / totalGroups) * 100),
          timestamp: getUTC8ISOString(),
          isCompetitor: true, // 标记为竞品任务
        });

        let result;
        const workerStart = process.hrtime();
        await competitorMonitorSemaphore.acquire();
        try {
          result = await checkCompetitorVariantGroup(group.id, false, {
            group: groupSnapshot,
            recordHistory: false,
          });
        } finally {
          competitorMonitorSemaphore.release();
        }
        const [seconds, nanoseconds] = process.hrtime(workerStart);
        metricsService.recordVariantGroupCheck({
          region: country,
          durationSec: seconds + nanoseconds / 1e9,
          isBroken: result?.isBroken,
          isCompetitor: true, // 标记为竞品任务
        });

        const brokenASINs = result?.brokenASINs || [];
        const brokenByType = result?.brokenByType || {
          SP_API_ERROR: 0,
          NO_VARIANTS: 0,
        };

        if (result?.isBroken) {
          broken++;
          countryResult.brokenGroups++;
          countryResult.brokenGroupNames.push(group.name);
          countryResult.brokenByType.SP_API_ERROR +=
            brokenByType.SP_API_ERROR || 0;
          countryResult.brokenByType.NO_VARIANTS +=
            brokenByType.NO_VARIANTS || 0;
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

        const updatedGroup = result?.groupSnapshot || groupSnapshot;
        if (updatedGroup && Array.isArray(updatedGroup.children)) {
          // 竞品监控：飞书通知默认关闭（feishu_notify_enabled默认为0）
          const groupNotifyEnabled =
            updatedGroup.feishuNotifyEnabled !== null &&
            updatedGroup.feishuNotifyEnabled !== undefined
              ? updatedGroup.feishuNotifyEnabled !== 0
              : false; // 默认为关闭（竞品）

          for (const asinInfo of updatedGroup.children) {
            // 同时检查变体组和ASIN的通知开关
            // 只有当两者都开启时，才发送通知
            const asinNotifyEnabled =
              asinInfo.feishuNotifyEnabled !== null &&
              asinInfo.feishuNotifyEnabled !== undefined
                ? asinInfo.feishuNotifyEnabled !== 0
                : false; // 默认为关闭（竞品）

            if (
              groupNotifyEnabled &&
              asinNotifyEnabled &&
              asinInfo.isBroken === 1
            ) {
              // 从 brokenASINs 中查找对应的错误类型
              const brokenASINItem = brokenASINs.find(
                (item) =>
                  (typeof item === 'string' ? item : item.asin) ===
                  asinInfo.asin,
              );
              const errorType =
                brokenASINItem && typeof brokenASINItem !== 'string'
                  ? brokenASINItem.errorType
                  : 'NO_VARIANTS';

              countryResult.brokenASINs.push({
                asin: asinInfo.asin,
                name: asinInfo.name || '',
                groupName: group.name,
                brand: asinInfo.brand || '',
                errorType,
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
          await CompetitorMonitorHistory.bulkCreate(historyEntries);
        } catch (historyError) {
          logger.error(`  ⚠️  批量记录竞品监控历史失败:`, historyError.message);
        }
      }
    });

    await Promise.all(workers);
  } catch (error) {
    logger.error(`❌ 处理竞品国家 ${country} 失败:`, error.message);
    return { checked, broken };
  }

  return { checked, broken };
}

async function runCompetitorMonitorTask(countries, batchConfig = null) {
  if (!countries || countries.length === 0) {
    return {
      success: false,
      error: '没有指定要检查的国家',
      totalChecked: 0,
      totalBroken: 0,
      countryResults: {},
    };
  }

  if (!isCompetitorMonitorEnabled()) {
    return {
      success: false,
      error: '竞品监控已关闭',
      totalChecked: 0,
      totalBroken: 0,
      countryResults: {},
    };
  }

  if (isCompetitorMonitorTaskRunning) {
    pendingCompetitorRunCountries = Array.from(
      new Set([...(pendingCompetitorRunCountries || []), ...countries]),
    );
    logger.info(
      `⏳ 上一个竞品监控任务仍在运行，已缓存下一次执行的国家: ${pendingCompetitorRunCountries.join(
        ', ',
      )}`,
    );
    return {
      success: false,
      error: '上一个竞品监控任务仍在运行',
      totalChecked: 0,
      totalBroken: 0,
      countryResults: {},
    };
  }

  isCompetitorMonitorTaskRunning = true;
  syncCompetitorSemaphoreLimit();

  const batchInfo = batchConfig
    ? ` (批次 ${batchConfig.batchIndex + 1}/${batchConfig.totalBatches})`
    : '';
  logger.info(
    `\n⏰ [${getUTC8LocaleString()}] 开始执行竞品监控任务，国家: ${countries.join(
      ', ',
    )}${batchInfo}`,
  );

  const startTime = process.hrtime();
  const countryResults = {};
  let totalChecked = 0;
  let totalBroken = 0;
  const checkTime = new Date();

  websocketService.sendMonitorProgress({
    status: 'started',
    countries,
    batchInfo: batchConfig
      ? `批次 ${batchConfig.batchIndex + 1}/${batchConfig.totalBatches}`
      : null,
    timestamp: toUTC8ISOString(checkTime),
    isCompetitor: true, // 标记为竞品任务
  });

  try {
    const stats = await Promise.all(
      countries.map((country) =>
        processCompetitorCountry(
          countryResults,
          country,
          checkTime,
          batchConfig,
        ),
      ),
    );

    stats.forEach(({ checked, broken }) => {
      totalChecked += checked;
      totalBroken += broken;
    });

    const totalBrokenByType = {
      SP_API_ERROR: 0,
      NO_VARIANTS: 0,
    };
    Object.values(countryResults).forEach((countryResult) => {
      if (countryResult.brokenByType) {
        totalBrokenByType.SP_API_ERROR +=
          countryResult.brokenByType.SP_API_ERROR || 0;
        totalBrokenByType.NO_VARIANTS +=
          countryResult.brokenByType.NO_VARIANTS || 0;
      }
    });

    logger.info(`\n📨 开始发送竞品飞书通知...`);
    const notifyResults = await sendCompetitorBatchNotifications(
      countryResults,
    );
    logger.info(
      `📨 竞品通知发送完成: 总计 ${notifyResults.total}, 成功 ${notifyResults.success}, 失败 ${notifyResults.failed}, 跳过 ${notifyResults.skipped}`,
    );

    if (notifyResults.countryResults) {
      for (const country of countries) {
        const countryNotifyResult = notifyResults.countryResults[country];
        const countryResult = countryResults[country];

        if (
          countryNotifyResult &&
          countryNotifyResult.success &&
          !countryNotifyResult.skipped &&
          countryResult &&
          countryResult.brokenGroups > 0
        ) {
          try {
            const updatedCount =
              await CompetitorMonitorHistory.updateNotificationStatus(
                country,
                checkTime,
                1,
              );
            if (updatedCount > 0) {
              logger.info(
                `✅ 已更新 ${country} 的 ${updatedCount} 条竞品监控历史记录为已通知状态`,
              );
            }
          } catch (error) {
            logger.error(
              `❌ 更新 ${country} 竞品监控历史记录通知状态失败:`,
              error.message,
            );
          }
        }
      }
    }

    const [seconds, nanoseconds] = process.hrtime(startTime);
    const duration = seconds + nanoseconds / 1e9;

    const errorTypeInfo = [];
    if (totalBrokenByType.SP_API_ERROR > 0) {
      errorTypeInfo.push(`SP-API错误: ${totalBrokenByType.SP_API_ERROR} 个`);
    }
    if (totalBrokenByType.NO_VARIANTS > 0) {
      errorTypeInfo.push(`无父变体ASIN: ${totalBrokenByType.NO_VARIANTS} 个`);
    }

    const errorTypeText =
      errorTypeInfo.length > 0 ? ` (${errorTypeInfo.join(', ')})` : '';

    logger.info(
      `\n✅ 竞品监控任务完成: 检查 ${totalChecked} 个变体组, 异常 ${totalBroken} 个${errorTypeText}, 耗时 ${duration.toFixed(
        2,
      )}秒\n`,
    );

    websocketService.sendMonitorComplete({
      success: true,
      totalChecked,
      totalBroken,
      totalNormal: totalChecked - totalBroken,
      duration: duration.toFixed(2),
      countryResults,
      timestamp: getUTC8ISOString(),
      isCompetitor: true, // 标记为竞品任务
    });

    return {
      success: true,
      totalChecked,
      totalBroken,
      totalNormal: totalChecked - totalBroken,
      countryResults,
      notifyResults,
      duration,
      checkTime: toUTC8ISOString(checkTime),
    };
  } catch (error) {
    logger.error(`❌ 竞品监控任务执行失败:`, error);
    return {
      success: false,
      error: error.message || '竞品监控任务执行失败',
      totalChecked,
      totalBroken,
      totalNormal: totalChecked - totalBroken,
      countryResults,
      duration: 0,
    };
  } finally {
    isCompetitorMonitorTaskRunning = false;
    const [seconds, nanoseconds] = process.hrtime(startTime);
    metricsService.recordSchedulerRun({
      type: 'competitor_monitor_task', // 自定义类型用于竞品
      durationSec: seconds + nanoseconds / 1e9,
    });
    if (
      pendingCompetitorRunCountries &&
      pendingCompetitorRunCountries.length > 0
    ) {
      const nextCountries = pendingCompetitorRunCountries;
      pendingCompetitorRunCountries = null;
      await runCompetitorMonitorTask(nextCountries);
    }
  }
}

async function triggerCompetitorManualCheck(countries = null) {
  if (countries && Array.isArray(countries)) {
    return await runCompetitorMonitorTask(countries);
  } else {
    const allCountries = Object.keys(REGION_MAP);
    return await runCompetitorMonitorTask(allCountries);
  }
}

module.exports = {
  REGION_MAP,
  runCompetitorMonitorTask,
  triggerCompetitorManualCheck,
  getCountriesToCheck,
};
