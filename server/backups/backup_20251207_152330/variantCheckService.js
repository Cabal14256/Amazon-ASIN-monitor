const { callSPAPI, getMarketplaceId } = require('../config/sp-api');
const { callLegacySPAPI } = require('./legacySPAPIClient');
const VariantGroup = require('../models/VariantGroup');
const ASIN = require('../models/ASIN');
const MonitorHistory = require('../models/MonitorHistory');
const cacheService = require('./cacheService');
const htmlScraperService = require('./htmlScraperService');
const SPAPIConfig = require('../models/SPAPIConfig');
const riskControlService = require('./riskControlService');
const rateLimiter = require('./rateLimiter');
const { PRIORITY } = rateLimiter;
const operationIdentifier = require('./spApiOperationIdentifier');
const logger = require('../utils/logger');

/**
 * 每次最多同时检查的 ASIN 数（降低并发以减少限流风险）
 * 可以根据实际情况调整
 */
const MAX_CONCURRENT_ASIN_CHECKS = 3;

// 用于控制并发的简单队列
let currentRunningTasks = 0;
const taskQueue = [];

// HTML 抓取兜底开关
let ENABLE_HTML_SCRAPER_FALLBACK = false;

// 旧客户端备用开关
let ENABLE_LEGACY_CLIENT_FALLBACK = false;

// 用于去重请求的 Map
const pendingRequests = new Map();
const MAX_PENDING_REQUESTS = 1000; // 防止无限增长

/**
 * 简单的并发控制执行器
 * @param {Function} taskFn - 异步任务函数
 * @returns {Promise<any>}
 */
async function runWithConcurrencyLimit(taskFn) {
  if (currentRunningTasks >= MAX_CONCURRENT_ASIN_CHECKS) {
    // 超过并发限制，将任务加入队列
    return new Promise((resolve, reject) => {
      taskQueue.push({ taskFn, resolve, reject });
    });
  }

  currentRunningTasks += 1;
  try {
    const result = await taskFn();
    return result;
  } finally {
    currentRunningTasks -= 1;
    // 从队列中取出下一个任务执行
    if (taskQueue.length > 0) {
      const next = taskQueue.shift();
      runWithConcurrencyLimit(next.taskFn)
        .then(next.resolve)
        .catch(next.reject);
    }
  }
}

/**
 * 从缓存中获取变体检查结果
 * @param {string} asin - ASIN
 * @param {string} country - 国家代码
 * @returns {Promise<any|null>}
 */
async function getCachedVariantResult(asin, country) {
  const key = getVariantCacheKey(asin, country);
  const cached = await cacheService.get(key);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {
      logger.warn(`[getCachedVariantResult] 缓存解析失败: ${e.message}`);
      return null;
    }
  }
  return null;
}

/**
 * 设置变体检查结果缓存
 * @param {string} asin - ASIN
 * @param {string} country - 国家代码
 * @param {any} result - 缓存结果
 * @param {number} ttlSeconds - 缓存时间（秒）
 */
async function setVariantResultCache(asin, country, result, ttlSeconds = 600) {
  const key = getVariantCacheKey(asin, country);
  try {
    await cacheService.set(key, JSON.stringify(result), ttlSeconds);
  } catch (error) {
    logger.error(`[setVariantResultCache] 设置缓存失败: ${error.message}`);
  }
}

/**
 * 根据ASIN和国家构建缓存键
 * @param {string} asin - ASIN
 * @param {string} country - 国家代码
 * @returns {string}
 */
function getVariantCacheKey(asin, country) {
  const cleanASIN = asin ? asin.trim().toUpperCase() : asin;
  return `variant:${country}:${cleanASIN}`;
}

/**
 * 重新加载 HTML 抓取兜底配置
 */
async function reloadHtmlScraperFallbackConfig() {
  await loadHtmlScraperFallbackConfig();
}

/**
 * 重新加载旧客户端备用配置
 */
async function reloadLegacyClientFallbackConfig() {
  await loadLegacyClientFallbackConfig();
}

async function loadHtmlScraperFallbackConfig() {
  try {
    const config = await SPAPIConfig.findByKey('ENABLE_HTML_SCRAPER_FALLBACK');
    if (
      config &&
      config.config_value !== null &&
      config.config_value !== undefined
    ) {
      ENABLE_HTML_SCRAPER_FALLBACK =
        config.config_value === 'true' ||
        config.config_value === true ||
        config.config_value === '1';
    } else {
      // 从环境变量读取
      ENABLE_HTML_SCRAPER_FALLBACK =
        process.env.ENABLE_HTML_SCRAPER_FALLBACK === 'true' ||
        process.env.ENABLE_HTML_SCRAPER_FALLBACK === '1';
    }
    logger.info(
      `[变体检查] ENABLE_HTML_SCRAPER_FALLBACK: ${ENABLE_HTML_SCRAPER_FALLBACK}`,
    );
  } catch (error) {
    logger.error(
      '[变体检查] 加载 ENABLE_HTML_SCRAPER_FALLBACK 配置失败:',
      error.message,
    );
    ENABLE_HTML_SCRAPER_FALLBACK = false; // 默认关闭
  }
}

async function loadLegacyClientFallbackConfig() {
  try {
    const config = await SPAPIConfig.findByKey('ENABLE_LEGACY_CLIENT_FALLBACK');
    if (
      config &&
      config.config_value !== null &&
      config.config_value !== undefined
    ) {
      ENABLE_LEGACY_CLIENT_FALLBACK =
        config.config_value === 'true' ||
        config.config_value === true ||
        config.config_value === '1';
    } else {
      ENABLE_LEGACY_CLIENT_FALLBACK =
        process.env.ENABLE_LEGACY_CLIENT_FALLBACK === 'true' ||
        process.env.ENABLE_LEGACY_CLIENT_FALLBACK === '1';
    }
    logger.info(
      `[变体检查] ENABLE_LEGACY_CLIENT_FALLBACK: ${ENABLE_LEGACY_CLIENT_FALLBACK}`,
    );
  } catch (error) {
    logger.error(
      '[变体检查] 加载 ENABLE_LEGACY_CLIENT_FALLBACK 配置失败:',
      error.message,
    );
    ENABLE_LEGACY_CLIENT_FALLBACK = false;
  }
}

// 初始化时加载配置
loadHtmlScraperFallbackConfig();
loadLegacyClientFallbackConfig();

/**
 * 核心：执行单个 ASIN 的变体检查（包含缓存与重试逻辑）
 */
async function doCheckASINVariants(
  asin,
  country,
  forceRefresh = false,
  priority = PRIORITY.SCHEDULED,
) {
  const startTime = Date.now();
  let isRateLimit = false;
  let isSpApiError = false;
  let success = false;

  try {
    // 如果 forceRefresh 为 true，跳过缓存
    if (!forceRefresh) {
      const cached = await getCachedVariantResult(asin, country);
      if (cached) {
        logger.info(`[checkASINVariants] 使用缓存结果: ${asin} (${country})`);
        // 缓存命中，记录为成功
        const responseTime = (Date.now() - startTime) / 1000;
        success = true;
        riskControlService.recordCheck({
          success: true,
          isRateLimit: false,
          isSpApiError: false,
          responseTime,
        });
        return cached;
      }
    } else {
      logger.info(
        `[checkASINVariants] 强制刷新，跳过缓存: ${asin} (${country})`,
      );
    }

    // ASIN 格式验证
    if (!asin || typeof asin !== 'string' || asin.trim().length === 0) {
      throw new Error('ASIN不能为空');
    }

    const cleanASIN = asin.trim().toUpperCase();

    if (!country || typeof country !== 'string') {
      throw new Error('country 参数无效');
    }

    const marketplaceId = getMarketplaceId(country);
    if (!marketplaceId) {
      throw new Error(`无法获取 ${country} 的 Marketplace ID`);
    }

    let response = null;
    let lastError = null;
    const apiVersion = '2022-04-01';
    const path = `/catalog/${apiVersion}/items/${cleanASIN}`;

    // 识别operation
    const operation = operationIdentifier.identifyOperation('GET', path);
    logger.info(
      `[checkASINVariants] 识别的operation: ${operation || 'unknown'}`,
    );

    // 验证和清理 marketplaceId
    const cleanMarketplaceId = String(marketplaceId).trim();
    if (!cleanMarketplaceId || cleanMarketplaceId.length === 0) {
      throw new Error(`Marketplace ID 无效: ${marketplaceId}`);
    }

    const params = {
      marketplaceIds: [cleanMarketplaceId],
      includedData: ['summaries', 'relationships'],
    };

    // 验证参数格式
    if (
      !Array.isArray(params.marketplaceIds) ||
      params.marketplaceIds.length === 0
    ) {
      throw new Error('marketplaceIds 必须是非空数组');
    }
    if (
      !Array.isArray(params.includedData) ||
      params.includedData.length === 0
    ) {
      throw new Error('includedData 必须是非空数组');
    }

    logger.info(`[checkASINVariants] 使用API版本: ${apiVersion}`);
    logger.info(`[checkASINVariants] 请求路径: ${path}`);

    // 通过令牌桶获取令牌（使用operation级别的限流器）
    await rateLimiter.acquire(country, 1, priority, operation);

    try {
      // 调用SP-API，传递operation参数
      response = await callSPAPI('GET', path, country, params, null, {
        operation: operation,
        maxRetries: 3,
      });
      logger.info(
        `[checkASINVariants] API版本 ${apiVersion} 调用成功，状态码: ${
          response?._spApiHeaders?.statusCode || 'unknown'
        }`,
      );
    } catch (error) {
      logger.warn(
        `[checkASINVariants] API版本 ${apiVersion} 调用失败: ${error.message}`,
      );
      lastError = error;

      // 如果是 4xx 级别错误（如 400 InvalidInput），则不再重试，进入兜底逻辑
      if (
        error.statusCode &&
        Number(error.statusCode) >= 400 &&
        Number(error.statusCode) < 500
      ) {
        logger.warn(
          `[checkASINVariants] API版本 ${apiVersion} 返回 ${error.statusCode}，进入兜底逻辑`,
        );
        response = null;
      } else {
        throw error;
      }
    }

    // 如果新版API没有拿到有效数据，尝试旧版SP-API（legacy client）
    if (!response && ENABLE_LEGACY_CLIENT_FALLBACK) {
      logger.warn(
        '[checkASINVariants] 新版SP-API失败，尝试旧版SP-API（legacy client）...',
      );
      try {
        const legacyPath = `/catalog/2022-04-01/items/${cleanASIN}`;
        const legacyParams = {
          marketplaceIds: [cleanMarketplaceId],
          includedData: ['summaries', 'relationships'],
        };
        response = await callLegacySPAPI(
          'GET',
          legacyPath,
          country,
          legacyParams,
        );
        logger.info('[checkASINVariants] 旧SP-API调用成功');
      } catch (legacyError) {
        logger.error('[checkASINVariants] 旧客户端也失败:', legacyError);
        lastError = legacyError;
      }
    }

    // 如果所有 SP-API 调用都失败，且开启了 HTML 抓取兜底，则尝试 HTML 抓取
    if (!response && ENABLE_HTML_SCRAPER_FALLBACK) {
      try {
        logger.info(
          `[checkASINVariants] SP-API调用失败，尝试HTML抓取兜底ASIN ${cleanASIN} (${country})...`,
        );
        const htmlResult = await htmlScraperService.checkASINVariantsHTML(
          cleanASIN,
          country,
        );

        const variantASINs = htmlResult.details.variantAsins || [];
        const parentASIN = htmlResult.details.parentAsin || null;
        const hasVariants = htmlResult.hasVariants;
        const variantCount = variantASINs.length;

        const result = {
          hasVariants,
          variantCount,
          details: {
            asin: cleanASIN,
            title: htmlResult.details.title || '',
            brand: htmlResult.details.brand || null,
            parentAsin: parentASIN,
            variations: variantASINs.map((asin) => ({
              asin,
              title: '',
            })),
            relationships: [],
          },
          meta: {
            source: 'html_scraper',
            apiVersion: null,
          },
        };

        await setVariantResultCache(cleanASIN, country, result);

        logger.info(
          `[checkASINVariants] HTML抓取成功: hasVariants=${hasVariants}, variantCount=${variantCount}`,
        );

        const responseTime = (Date.now() - startTime) / 1000;
        success = true;
        riskControlService.recordCheck({
          success: true,
          isRateLimit: false,
          isSpApiError: false,
          responseTime,
        });

        return result;
      } catch (htmlError) {
        logger.error(`[checkASINVariants] HTML抓取也失败:`, htmlError.message);
        if (lastError) {
          throw lastError;
        }
        throw htmlError;
      }
    }

    // 如果response仍然为空，说明所有兜底都失败
    if (!response) {
      throw lastError || new Error('SP-API响应为空且未使用HTML兜底');
    }

    // 解析新版API返回的数据结构
    let item = null;

    if (response && response.items && response.items.length > 0) {
      item = response.items[0]; // 2022-04-01 结构
    } else if (response && response.asin) {
      item = response; // 2020-12-01 结构
    }

    if (item) {
      logger.debug(`[checkASINVariants] 解析到的item:`, {
        asin: item.asin,
        hasVariations: !!item.variations,
        variationsCount: item.variations ? item.variations.length : 0,
        hasRelationships: !!item.relationships,
        relationshipsCount: item.relationships ? item.relationships.length : 0,
        hasSummaries: !!item.summaries,
        summariesCount: item.summaries ? item.summaries.length : 0,
      });

      // 检查是否有变体关系（兼容 2022-04-01 relationships 结构 + 旧 variations 结构）
      const variantASINs = [];
      let parentASIN = null;
      let isChild = false;
      let isParent = false;
      const variationRelations = [];

      // 1) 优先解析 2022-04-01 relationships 结构
      if (Array.isArray(item.relationships)) {
        item.relationships.forEach((relByMarketplace) => {
          if (
            !relByMarketplace ||
            !Array.isArray(relByMarketplace.relationships)
          ) {
            return;
          }

          relByMarketplace.relationships.forEach((rel) => {
            if (!rel || rel.type !== 'VARIATION') return;

            variationRelations.push(rel);

            // parentAsins 存在时，当前 ASIN 视为子体
            if (Array.isArray(rel.parentAsins) && rel.parentAsins.length > 0) {
              isChild = true;

              if (!parentASIN) {
                parentASIN = String(rel.parentAsins[0] || '').trim();
              }

              rel.parentAsins.forEach((p) => {
                const v = String(p || '')
                  .trim()
                  .toUpperCase();
                const self = String(item.asin || '')
                  .trim()
                  .toUpperCase();
                if (v && v !== self) {
                  variantASINs.push(v);
                }
              });
            }

            // childAsins 存在时，当前 ASIN 视为父体
            if (Array.isArray(rel.childAsins) && rel.childAsins.length > 0) {
              isParent = true;

              rel.childAsins.forEach((c) => {
                const v = String(c || '')
                  .trim()
                  .toUpperCase();
                const self = String(item.asin || '')
                  .trim()
                  .toUpperCase();
                if (v && v !== self) {
                  variantASINs.push(v);
                }
              });

              if (!parentASIN) {
                parentASIN = String(item.asin || '')
                  .trim()
                  .toUpperCase();
              }
            }
          });
        });
      }

      // 2) 兼容旧的 variations 结构（某些账号/旧版本可能还会返回）
      if (
        (!Array.isArray(item.relationships) ||
          variationRelations.length === 0) &&
        Array.isArray(item.variations)
      ) {
        item.variations.forEach((variationGroup) => {
          if (
            !variationGroup ||
            !Array.isArray(variationGroup.asins) ||
            variationGroup.asins.length === 0
          ) {
            return;
          }

          const asins = variationGroup.asins.map((a) =>
            String(a || '')
              .trim()
              .toUpperCase(),
          );
          const self = String(item.asin || '')
            .trim()
            .toUpperCase();

          if (variationGroup.variationType === 'CHILD') {
            isChild = true;
            // CHILD：当前 ASIN 是子体，asins 中通常是父体
            if (asins.length > 0 && !parentASIN) {
              parentASIN = asins[0];
            }
          } else if (variationGroup.variationType === 'PARENT') {
            isParent = true;
            // PARENT：当前 ASIN 是父体
            if (!parentASIN) {
              parentASIN = self;
            }
          }

          asins.forEach((a) => {
            if (a && a !== self) {
              variantASINs.push(a);
            }
          });
        });
      }

      // 去重
      const variantASINSet = new Set(
        variantASINs
          .map((a) =>
            String(a || '')
              .trim()
              .toUpperCase(),
          )
          .filter((a) => a),
      );
      variantASINs.length = 0;
      variantASINs.push(...Array.from(variantASINSet));

      const hasVariants = variantASINs.length > 0;

      const finalHasVariants = hasVariants || variationRelations.length > 0;
      const variantCount = variantASINs.length || variationRelations.length;

      logger.debug(`
========== ASIN变体检查结果 ==========`);
      logger.debug(`ASIN: ${item.asin}`);
      logger.debug(`是否有变体: ${finalHasVariants ? '✅ 是' : '❌ 否'}`);

      if (finalHasVariants) {
        logger.debug(
          `变体类型: ${
            isChild ? '子变体 (CHILD)' : isParent ? '父变体 (PARENT)' : '未知'
          }`,
        );
        logger.debug(`变体ASIN数量: ${variantCount}`);

        if (variantASINs.length > 0) {
          logger.debug(`变体ASIN列表: ${variantASINs.join(', ')}`);
        }

        if (parentASIN) {
          logger.debug(`父ASIN: ${parentASIN}`);
        }
      } else {
        logger.debug('说明: 该ASIN没有变体关系');
      }

      const result = {
        hasVariants: finalHasVariants,
        variantCount,
        details: {
          asin: item.asin,
          title:
            item.summaries?.[0]?.itemName ||
            item.summaries?.[0]?.title ||
            item.attributes?.item_name?.[0]?.value ||
            '',
          brand:
            item.summaries?.[0]?.brand ||
            item.summaries?.[0]?.manufacturer ||
            null,
          parentAsin: parentASIN || null,
          variations: variantASINs.map((asin) => ({
            asin,
            title: '',
          })),
          relationships: variationRelations,
        },
        meta: {
          source: 'spapi',
          apiVersion,
        },
      };

      await setVariantResultCache(cleanASIN, country, result);

      const responseTime = (Date.now() - startTime) / 1000;
      success = true;
      riskControlService.recordCheck({
        success: true,
        isRateLimit,
        isSpApiError,
        responseTime,
      });

      return result;
    }

    throw new Error('未能解析SP-API响应中的item');
  } catch (error) {
    const responseTime = (Date.now() - startTime) / 1000;
    success = false;
    isRateLimit = !!(
      error.statusCode === 429 ||
      error.code === 'TooManyRequestsException' ||
      error.code === 'RequestThrottled'
    );
    isSpApiError = !isRateLimit;

    riskControlService.recordCheck({
      success,
      isRateLimit,
      isSpApiError,
      responseTime,
    });

    logger.error(
      `[checkASINVariants] 检查ASIN ${asin} (${country}) 时发生错误:`,
      error.message || error,
    );
    throw error;
  }
}

/**
 * 对外暴露的检查方法（带请求去重）
 */
async function checkASINVariants(
  asin,
  country,
  forceRefresh = false,
  priority = PRIORITY.SCHEDULED,
) {
  const cacheKey = `${asin}:${country}`;

  if (pendingRequests.size > MAX_PENDING_REQUESTS) {
    const oldestKey = Array.from(pendingRequests.keys())[0];
    pendingRequests.delete(oldestKey);
    logger.warn(
      `[checkASINVariants] pendingRequests超过限制，清理最旧的请求: ${oldestKey}`,
    );
  }

  let requestPromise = pendingRequests.get(cacheKey);

  if (requestPromise && !forceRefresh) {
    logger.info(
      `[checkASINVariants] 检测到重复请求，等待已有请求完成: ${asin} (${country})`,
    );
  } else {
    requestPromise = runWithConcurrencyLimit(() =>
      doCheckASINVariants(asin, country, forceRefresh, priority),
    );
    pendingRequests.set(cacheKey, requestPromise);
  }

  try {
    const result = await requestPromise;
    return result;
  } finally {
    if (pendingRequests.get(cacheKey) === requestPromise) {
      pendingRequests.delete(cacheKey);
    }
  }
}

/**
 * 检查变体组的所有ASIN
 */
async function checkVariantGroup(variantGroupId, forceRefresh = false) {
  try {
    const group = await VariantGroup.findById(variantGroupId);
    if (!group) {
      throw new Error('变体组不存在');
    }

    const asins = group.children || [];
    if (asins.length === 0) {
      return {
        isBroken: true,
        brokenASINs: [],
        details: { results: [] },
      };
    }

    const country = group.country || 'US';
    const brokenASINs = [];
    const results = [];

    for (const asinEntry of asins) {
      const asin = asinEntry.asin || asinEntry;
      const asinId = asinEntry.id;

      try {
        const result = await checkASINVariants(asin, country, forceRefresh);
        const isBroken =
          !result.hasVariants ||
          !result.variantCount ||
          result.variantCount === 0;

        // 更新数据库中ASIN的is_broken状态和检查时间
        if (asinId) {
          await ASIN.updateVariantStatus(asinId, isBroken);
          await ASIN.updateLastCheckTime(asinId);
        }

        if (isBroken) {
          brokenASINs.push(asin);
        }

        results.push({
          asin,
          country,
          isBroken,
          details: result,
        });
      } catch (error) {
        logger.error(
          `[checkVariantGroup] 检查ASIN ${asin} (${country}) 失败:`,
          error.message || error,
        );
        brokenASINs.push(asin);

        // 即使检查失败，也要更新ASIN状态为异常
        if (asinId) {
          await ASIN.updateVariantStatus(asinId, true);
          await ASIN.updateLastCheckTime(asinId);
        }

        results.push({
          asin,
          country,
          isBroken: true,
          error: error.message || String(error),
        });
      }
    }

    const isBroken = brokenASINs.length > 0;

    await VariantGroup.updateVariantStatus(variantGroupId, isBroken);
    await VariantGroup.updateLastCheckTime(variantGroupId);

    // 清除所有相关ASIN的变体检查结果缓存，确保前端获取最新数据
    for (const asinEntry of asins) {
      const asin = asinEntry.asin || asinEntry;
      if (asin) {
        const cacheKey = getVariantCacheKey(asin, country);
        cacheService.delete(cacheKey);
      }
    }

    // 再次清除变体组缓存，确保前端获取最新数据
    VariantGroup.clearCache();

    const updatedGroup = await VariantGroup.findById(variantGroupId);
    let groupStatus = null;

    if (updatedGroup) {
      groupStatus = {
        id: updatedGroup._id,
        name: updatedGroup.name,
        is_broken: updatedGroup.is_broken,
        last_check_time: updatedGroup.last_check_time,
      };
    }

    return {
      isBroken,
      brokenASINs,
      groupStatus,
      details: {
        results,
      },
    };
  } catch (error) {
    logger.error(
      `[checkVariantGroup] 检查变体组 ${variantGroupId} 失败:`,
      error.message || error,
    );
    throw error;
  }
}

/**
 * 检查单个ASIN（提供给外部调用）
 */
async function checkSingleASIN(asinId, forceRefresh = false) {
  try {
    const asinRecord = await ASIN.findById(asinId);
    if (!asinRecord) {
      throw new Error('ASIN记录不存在');
    }

    const asin = asinRecord.asin;
    const country = asinRecord.country || 'US';

    const result = await checkASINVariants(asin, country, forceRefresh);

    const isBroken =
      !result.hasVariants || !result.variantCount || result.variantCount === 0;

    // 更新数据库中ASIN的is_broken状态和检查时间
    await ASIN.updateVariantStatus(asinId, isBroken);
    await ASIN.updateLastCheckTime(asinId);

    // 清除该ASIN的变体检查结果缓存，确保前端获取最新数据
    const cacheKey = getVariantCacheKey(asin, country);
    cacheService.delete(cacheKey);

    // 如果ASIN属于某个变体组，清除变体组缓存
    if (asinRecord.variantGroupId) {
      VariantGroup.clearCache();
    }

    await MonitorHistory.create({
      asinId,
      asin,
      country,
      is_broken: isBroken ? 1 : 0,
      checked_at: new Date(),
      raw_result: result,
    });

    return {
      isBroken,
      brokenASINs: isBroken ? [asin] : [],
      details: result,
    };
  } catch (error) {
    logger.error(
      `[checkSingleASIN] 检查单个ASIN失败: ${asinId}`,
      error.message || error,
    );
    throw error;
  }
}

module.exports = {
  checkASINVariants,
  checkVariantGroup,
  checkSingleASIN,
  reloadHtmlScraperFallbackConfig,
  reloadLegacyClientFallbackConfig,
  MAX_CONCURRENT_ASIN_CHECKS,
  doCheckASINVariants,
};
