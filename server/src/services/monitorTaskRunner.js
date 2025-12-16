const VariantGroup = require('../models/VariantGroup');
const ASIN = require('../models/ASIN');
const {
  checkVariantGroup,
  checkASINVariants,
  getDeferredASINs,
  clearDeferredASINs,
  markCountryCompleted,
  getCompletedCountries,
  clearCompletedCountries,
  getRegionByCountry,
} = require('./variantCheckService');
const cacheService = require('./cacheService');
const { PRIORITY } = require('./rateLimiter');
const logger = require('../utils/logger');
const {
  sendBatchNotifications,
  sendSingleCountryNotification,
} = require('./feishuService');
const MonitorHistory = require('../models/MonitorHistory');
const { getMaxConcurrentGroupChecks } = require('../config/monitor-config');
const Semaphore = require('./semaphore');
const metricsService = require('./metricsService');
const websocketService = require('./websocketService');
const {
  getUTC8ISOString,
  getUTC8LocaleString,
  toUTC8ISOString,
} = require('../utils/dateTime');

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
  // 获取当前并发数（如果启用了自动调整，这里会触发调整逻辑）
  const currentConcurrency = getMaxConcurrentGroupChecks();
  monitorSemaphore.setMax(currentConcurrency);

  // 定期输出风控指标（每10次调用输出一次，避免日志过多）
  if (Math.random() < 0.1) {
    const riskControlService = require('./riskControlService');
    const metrics = riskControlService.getMetrics();
    logger.info(
      `[风控指标] 错误率: ${(metrics.errorRate * 100).toFixed(1)}%, 限流次数: ${
        metrics.rateLimitCount
      }, 平均响应时间: ${metrics.avgResponseTime}s`,
    );
  }
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

/**
 * 缓存预热：提前刷新即将过期的缓存
 * @param {string} country - 国家代码
 */
async function prewarmCache(country) {
  try {
    const CACHE_PREFIX = `variant:${country}:`;
    const PREWARM_THRESHOLD_MS = 5 * 60 * 1000; // 5分钟阈值

    const cacheKeys = cacheService.getKeys(CACHE_PREFIX);
    const asinsToRefresh = [];

    // 找出缓存剩余时间少于5分钟的ASIN
    for (const key of cacheKeys) {
      const remaining = cacheService.getTimeToExpiry(key);
      if (remaining !== null && remaining < PREWARM_THRESHOLD_MS) {
        // 从key中提取ASIN: variant:country:ASIN
        const parts = key.split(':');
        if (parts.length === 3 && parts[0] === 'variant') {
          const asin = parts[2];
          asinsToRefresh.push(asin);
        }
      }
    }

    if (asinsToRefresh.length === 0) {
      return;
    }

    logger.info(
      `[缓存预热] ${country} 发现 ${asinsToRefresh.length} 个ASIN缓存即将过期，开始预热...`,
    );

    // 分批预热（每批最多10个，使用低优先级）
    const BATCH_SIZE = 10;
    for (let i = 0; i < asinsToRefresh.length; i += BATCH_SIZE) {
      const batch = asinsToRefresh.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map((asin) =>
          checkASINVariants(asin, country, false, PRIORITY.BATCH).catch(
            (error) => {
              logger.error(`[缓存预热] 预热ASIN ${asin} 失败:`, error.message);
            },
          ),
        ),
      );

      // 批次间稍作延迟，避免过于频繁
      if (i + BATCH_SIZE < asinsToRefresh.length) {
        await new Promise((resolve) => {
          void setTimeout(resolve, 1000);
        });
      }
    }

    logger.info(`[缓存预热] ${country} 缓存预热完成`);
  } catch (error) {
    logger.error(`[缓存预热] ${country} 缓存预热失败:`, error.message);
  }
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
    brokenByType: { SP_API_ERROR: 0, NO_VARIANTS: 0 }, // 按类型统计异常
    checkTime,
  });

  let checked = 0;
  let broken = 0;

  try {
    // 在开始处理前进行缓存预热
    await prewarmCache(country);

    let groupsList = [];

    // 如果提供了 batchConfig，使用分批查询
    if (
      batchConfig &&
      batchConfig.batchIndex !== undefined &&
      batchConfig.totalBatches > 1
    ) {
      logger.info(
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
          logger.info(
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
      logger.info(
        `[processCountry] ${country} 截取到单次任务限制 (${MAX_GROUPS_PER_TASK})`,
      );
      groupsList = groupsList.slice(0, MAX_GROUPS_PER_TASK);
    }

    if (groupsList.length === 0) {
      logger.info(`[processCountry] ${country} 没有需要检查的变体组`);
      return { checked: 0, broken: 0 };
    }

    logger.info(
      `[processCountry] ${country} 开始检查 ${groupsList.length} 个变体组`,
    );

    // 在开始处理前同步信号量限制（触发自动调整）
    syncSemaphoreLimit();

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
        checked++;
        countryResult.totalGroups++;

        // 每处理10个变体组后，检查并同步并发数（触发自动调整）
        if (checked % 10 === 0) {
          syncSemaphoreLimit();
        }

        // 发送进度更新（每10个变体组更新一次，避免过于频繁）
        if (checked % 10 === 0 || checked === totalGroups) {
          websocketService.sendMonitorProgress({
            status: 'progress',
            country,
            current: checked,
            total: totalGroups,
            progress: Math.round((checked / totalGroups) * 100),
            timestamp: getUTC8ISOString(),
          });
        }

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
        const brokenByType = result?.brokenByType || {
          SP_API_ERROR: 0,
          NO_VARIANTS: 0,
        };

        if (result?.isBroken) {
          broken++;
          countryResult.brokenGroups++;
          countryResult.brokenGroupNames.push(group.name);

          // 累加错误类型统计
          countryResult.brokenByType.SP_API_ERROR +=
            brokenByType.SP_API_ERROR || 0;
          countryResult.brokenByType.NO_VARIANTS +=
            brokenByType.NO_VARIANTS || 0;
        }

        const fullGroup = await VariantGroup.findById(group.id);
        const variantGroupName = fullGroup?.name || group.name || null;

        const historyEntries = [
          {
            variantGroupId: group.id,
            variantGroupName: variantGroupName,
            checkType: 'GROUP',
            country: group.country,
            isBroken: result?.isBroken ? 1 : 0,
            checkResult: result,
            checkTime,
          },
        ];

        if (fullGroup && Array.isArray(fullGroup.children)) {
          // 检查变体组的通知开关（默认为1，即开启）
          const groupNotifyEnabled =
            fullGroup.feishuNotifyEnabled !== null &&
            fullGroup.feishuNotifyEnabled !== undefined
              ? fullGroup.feishuNotifyEnabled !== 0
              : true; // 默认为开启

          for (const asinInfo of fullGroup.children) {
            await ASIN.updateLastCheckTime(asinInfo.id);

            // 同时检查变体组和ASIN的通知开关
            // 只有当两者都开启时，才发送通知
            const asinNotifyEnabled =
              asinInfo.feishuNotifyEnabled !== null &&
              asinInfo.feishuNotifyEnabled !== undefined
                ? asinInfo.feishuNotifyEnabled !== 0
                : true; // 默认为开启

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
                errorType, // 添加错误类型
              });
            }

            historyEntries.push({
              asinId: asinInfo.id,
              asinCode: asinInfo.asin || null,
              asinName: asinInfo.name || null,
              variantGroupId: group.id,
              variantGroupName: variantGroupName,
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
          logger.error(`  ⚠️  批量记录监控历史失败:`, historyError.message);
        }
      }
    });

    await Promise.all(workers);

    // 分批查询模式下不需要分页循环
  } catch (error) {
    logger.error(`❌ 处理国家 ${country} 失败:`, error.message);
    // 即使出错也返回统计信息
    return { checked, broken };
  }

  // 标记该国家已完成处理
  const region = REGION_MAP[country] || 'US';
  markCountryCompleted(region, country);

  return { checked, broken };
}

/**
 * 检查region的所有国家是否都已完成处理
 * @param {string} region - 区域代码（US或EU）
 * @param {Array<string>} completedCountries - 已完成的国家列表
 * @returns {boolean} 是否所有国家都已完成
 */
function checkRegionCountriesCompleted(region, completedCountries) {
  // 获取该region的所有国家
  const regionCountries = Object.keys(REGION_MAP).filter(
    (country) => REGION_MAP[country] === region,
  );

  // 检查所有国家是否都在已完成列表中
  return regionCountries.every((country) =>
    completedCountries.includes(country),
  );
}

/**
 * 处理延后队列中的ASIN
 * @param {string} region - 区域代码
 * @param {string} country - 国家代码（用于日志）
 * @returns {Object} 处理结果统计
 */
async function processDeferredASINs(region, country) {
  const deferredASINs = getDeferredASINs(region);

  if (deferredASINs.length === 0) {
    logger.info(`[延后队列] ${region}区域没有需要处理的延后ASIN`);
    return {
      total: 0,
      success: 0,
      failed: 0,
    };
  }

  logger.info(
    `[延后队列] 开始处理 ${region}区域的 ${deferredASINs.length} 个延后ASIN`,
  );

  let successCount = 0;
  let failedCount = 0;

  // 按国家分组处理
  const asinsByCountry = {};
  for (const deferred of deferredASINs) {
    if (!asinsByCountry[deferred.country]) {
      asinsByCountry[deferred.country] = [];
    }
    asinsByCountry[deferred.country].push(deferred);
  }

  // 逐个处理延后ASIN
  for (const [deferredCountry, asins] of Object.entries(asinsByCountry)) {
    logger.info(
      `[延后队列] 处理 ${deferredCountry} 的 ${asins.length} 个延后ASIN`,
    );

    for (const deferred of asins) {
      // 检查重试次数，最多重试1次
      if (deferred.retryCount >= 1) {
        logger.warn(
          `[延后队列] ASIN ${deferred.asin} (${deferred.country}) 已达到最大重试次数，跳过`,
        );
        failedCount++;
        continue;
      }

      try {
        // 重试检查ASIN
        logger.info(
          `[延后队列] 重试检查 ASIN ${deferred.asin} (${deferred.country})`,
        );

        const result = await checkASINVariants(
          deferred.asin,
          deferred.country,
          true, // forceRefresh = true，强制刷新
          PRIORITY.SCHEDULED,
        );

        // 检查是否成功
        if (result && result.hasVariants !== undefined) {
          successCount++;
          logger.info(
            `[延后队列] ASIN ${deferred.asin} (${deferred.country}) 重试成功`,
          );
        } else {
          failedCount++;
          logger.warn(
            `[延后队列] ASIN ${deferred.asin} (${deferred.country}) 重试失败：结果无效`,
          );
        }
      } catch (error) {
        // 如果错误标记为已延后，说明再次失败，直接标记为失败，不再加入队列
        if (error.isDeferred) {
          failedCount++;
          logger.warn(
            `[延后队列] ASIN ${deferred.asin} (${deferred.country}) 重试再次失败，已标记为最终失败: ${error.message}`,
          );
        } else {
          failedCount++;
          logger.error(
            `[延后队列] ASIN ${deferred.asin} (${deferred.country}) 重试失败:`,
            error.message,
          );
        }
      }
    }
  }

  // 清除已处理的延后ASIN
  clearDeferredASINs(region);
  clearCompletedCountries(region);

  logger.info(
    `[延后队列] ${region}区域延后队列处理完成: 总计 ${deferredASINs.length}, 成功 ${successCount}, 失败 ${failedCount}`,
  );

  return {
    total: deferredASINs.length,
    success: successCount,
    failed: failedCount,
  };
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
    logger.info(
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
  logger.info(
    `\n⏰ [${getUTC8LocaleString()}] 开始执行监控任务，国家: ${countries.join(
      ', ',
    )}${batchInfo}`,
  );

  const startTime = process.hrtime();
  const countryResults = {};
  let totalChecked = 0;
  let totalBroken = 0;
  const checkTime = new Date(); // 使用 Date 对象而不是字符串

  // 发送任务开始通知
  websocketService.sendMonitorProgress({
    status: 'started',
    countries,
    batchInfo: batchConfig
      ? `批次 ${batchConfig.batchIndex + 1}/${batchConfig.totalBatches}`
      : null,
    timestamp: toUTC8ISOString(checkTime),
  });

  try {
    // 串行处理每个国家：检查完一个国家就发送该国家的飞书通知，然后继续下一个
    const notifyResults = {
      total: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      countryResults: {},
    };

    // 处理延后队列的region集合
    const processedRegions = new Set();

    // 串行处理每个国家
    for (const country of countries) {
      // 处理当前国家
      const { checked, broken } = await processCountry(
        countryResults,
        country,
        checkTime,
        batchConfig,
      );
      totalChecked += checked;
      totalBroken += broken;

      // 立即发送该国家的飞书通知
      logger.info(`\n📨 开始发送 ${country} 的飞书通知...`);
      const countryNotifyResult = await sendSingleCountryNotification(
        country,
        countryResults[country],
      );
      notifyResults.total++;
      if (countryNotifyResult.success) {
        notifyResults.success++;
        notifyResults.countryResults[country] = countryNotifyResult;
        logger.info(`✅ ${country} 的飞书通知发送成功`);
      } else {
        notifyResults.failed++;
        notifyResults.countryResults[country] = countryNotifyResult;
        logger.warn(
          `❌ ${country} 的飞书通知发送失败${
            countryNotifyResult.errorCode
              ? ` (错误码: ${countryNotifyResult.errorCode})`
              : ''
          }`,
        );
      }

      // 更新已发送通知的监控历史记录状态（仅当通知发送成功且该国家有异常时）
      if (
        countryNotifyResult.success &&
        !countryNotifyResult.skipped &&
        countryResults[country] &&
        countryResults[country].brokenGroups > 0
      ) {
        try {
          const updatedCount = await MonitorHistory.updateNotificationStatus(
            country,
            checkTime,
            1, // 标记为已通知
          );
          if (updatedCount > 0) {
            logger.info(
              `✅ 已更新 ${country} 的 ${updatedCount} 条监控历史记录为已通知状态`,
            );
          }
        } catch (error) {
          logger.error(
            `❌ 更新 ${country} 监控历史记录通知状态失败:`,
            error.message,
          );
        }
      }

      // 处理延后队列：检查当前国家所属region的所有国家是否都已完成
      const region = REGION_MAP[country] || 'US';

      // 避免重复处理同一个region
      if (!processedRegions.has(region)) {
        const completedCountries = getCompletedCountries(region);
        const allCompleted = checkRegionCountriesCompleted(
          region,
          completedCountries,
        );

        // 如果所有国家都已完成，或者US区域（只有一个国家），处理延后队列
        if (allCompleted || (region === 'US' && country === 'US')) {
          processedRegions.add(region);
          logger.info(
            `[延后队列] ${region}区域的所有国家都已完成，开始处理延后队列`,
          );
          try {
            const deferredResult = await processDeferredASINs(region, country);
            if (deferredResult.total > 0) {
              logger.info(
                `[延后队列] ${region}区域处理结果: 总计 ${deferredResult.total}, 成功 ${deferredResult.success}, 失败 ${deferredResult.failed}`,
              );
            }
          } catch (deferredError) {
            logger.error(
              `[延后队列] 处理 ${region}区域延后队列失败:`,
              deferredError.message,
            );
          }
        }
      }
    }

    // 汇总所有国家的异常类型统计
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

    logger.info(
      `\n📨 所有国家通知发送完成: 总计 ${notifyResults.total}, 成功 ${notifyResults.success}, 失败 ${notifyResults.failed}, 跳过 ${notifyResults.skipped}`,
    );

    const [seconds, nanoseconds] = process.hrtime(startTime);
    const duration = seconds + nanoseconds / 1e9;

    // 构建异常分类信息
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
      `\n✅ 监控任务完成: 检查 ${totalChecked} 个变体组, 异常 ${totalBroken} 个${errorTypeText}, 耗时 ${duration.toFixed(
        2,
      )}秒\n`,
    );

    // 发送任务完成通知
    websocketService.sendMonitorComplete({
      success: true,
      totalChecked,
      totalBroken,
      totalNormal: totalChecked - totalBroken,
      duration: duration.toFixed(2),
      countryResults,
      timestamp: getUTC8ISOString(),
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
    // 改进错误日志：提取错误信息，避免显示空对象
    const errorMessage = error?.message || error?.toString() || '未知错误';
    const errorStack = error?.stack ? `\n堆栈: ${error.stack}` : '';
    logger.error(`❌ 监控任务执行失败: ${errorMessage}${errorStack}`);
    return {
      success: false,
      error: errorMessage,
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
      // 捕获错误，避免影响主任务的日志
      try {
        await runMonitorTask(nextCountries);
      } catch (nextTaskError) {
        const nextErrorMessage =
          nextTaskError?.message || nextTaskError?.toString() || '未知错误';
        logger.error(`❌ 执行待处理的监控任务失败: ${nextErrorMessage}`);
      }
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
