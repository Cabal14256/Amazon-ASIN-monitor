// 复用原始的checkASINVariants函数（不依赖模型）
const { callSPAPI, getMarketplaceId } = require('../config/sp-api');
const { callLegacySPAPI } = require('./legacySPAPIClient');
const CompetitorVariantGroup = require('../models/CompetitorVariantGroup');
const CompetitorASIN = require('../models/CompetitorASIN');
const CompetitorMonitorHistory = require('../models/CompetitorMonitorHistory');
const cacheService = require('./cacheService');
const htmlScraperService = require('./htmlScraperService');
const SPAPIConfig = require('../models/SPAPIConfig');

/**
 * 每次最多同时检查的 ASIN 数（降低并发以减少限流风险）
 */
const MAX_CONCURRENT_ASIN_CHECKS = 3;
const VARIANT_CACHE_TTL_MS = 12 * 60 * 1000; // 12分钟缓存

// 请求延迟配置（每 N 个请求延迟 M 毫秒）
const REQUEST_DELAY_INTERVAL =
  Number(process.env.SP_API_REQUEST_DELAY_INTERVAL) || 20;
const REQUEST_DELAY_MS = Number(process.env.SP_API_REQUEST_DELAY_MS) || 150;

// 全局请求计数器（用于延迟控制）
let globalRequestCounter = 0;

// SP-API 版本列表（按优先级排序）
const API_VERSIONS = ['2022-04-01', '2020-12-01'];

// HTML 抓取兜底开关
let ENABLE_HTML_SCRAPER_FALLBACK = false;

// 旧客户端备用开关
let ENABLE_LEGACY_CLIENT_FALLBACK = false;

/**
 * 从数据库或环境变量加载 HTML 抓取兜底配置
 */
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
    console.log(
      `[竞品变体检查] ENABLE_HTML_SCRAPER_FALLBACK: ${ENABLE_HTML_SCRAPER_FALLBACK}`,
    );
  } catch (error) {
    console.error(
      '[竞品变体检查] 加载 ENABLE_HTML_SCRAPER_FALLBACK 配置失败:',
      error.message,
    );
    ENABLE_HTML_SCRAPER_FALLBACK = false; // 默认关闭
  }
}

/**
 * 从数据库或环境变量加载旧客户端备用配置
 */
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
      // 从环境变量读取
      ENABLE_LEGACY_CLIENT_FALLBACK =
        process.env.ENABLE_LEGACY_CLIENT_FALLBACK === 'true' ||
        process.env.ENABLE_LEGACY_CLIENT_FALLBACK === '1';
    }
    console.log(
      `[竞品变体检查] ENABLE_LEGACY_CLIENT_FALLBACK: ${ENABLE_LEGACY_CLIENT_FALLBACK}`,
    );
  } catch (error) {
    console.error(
      '[竞品变体检查] 加载 ENABLE_LEGACY_CLIENT_FALLBACK 配置失败:',
      error.message,
    );
    ENABLE_LEGACY_CLIENT_FALLBACK = false; // 默认关闭
  }
}

// 初始化时加载配置
loadHtmlScraperFallbackConfig();
loadLegacyClientFallbackConfig();

function getVariantCacheKey(asin, country) {
  // 统一使用大写的 ASIN 作为缓存键，避免大小写不一致导致缓存失效
  const cleanASIN = asin ? asin.trim().toUpperCase() : asin;
  return `competitorVariant:${country}:${cleanASIN}`;
}

function getCachedVariantResult(asin, country) {
  const key = getVariantCacheKey(asin, country);
  return cacheService.get(key);
}

function setVariantResultCache(asin, country, result) {
  const key = getVariantCacheKey(asin, country);
  cacheService.set(key, result, VARIANT_CACHE_TTL_MS);
}

/**
 * 检查单个ASIN的变体关系（复用原始逻辑）
 * @param {string} asin - ASIN编码
 * @param {string} country - 国家代码
 * @returns {Promise<{hasVariants: boolean, variantCount: number, details: any, errorType?: string}>}
 */
async function checkCompetitorASINVariants(
  asin,
  country,
  forceRefresh = false,
) {
  // 复用原始的checkASINVariants逻辑，但使用竞品缓存键
  // 为了简化，我们直接调用原始服务，但使用竞品缓存键
  // 实际上，我们可以直接复用原始逻辑，因为SP-API调用不依赖模型

  // 如果 forceRefresh 为 true，跳过缓存
  if (!forceRefresh) {
    const cached = getCachedVariantResult(asin, country);
    if (cached) {
      console.log(
        `[checkCompetitorASINVariants] 使用缓存结果: ${asin} (${country})`,
      );
      return cached;
    }
  } else {
    console.log(
      `[checkCompetitorASINVariants] 强制刷新，跳过缓存: ${asin} (${country})`,
    );
  }

  // 导入原始服务以复用checkASINVariants逻辑
  const variantCheckService = require('./variantCheckService');

  // 调用原始函数（它不依赖模型，可以复用）
  const result = await variantCheckService.checkASINVariants(
    asin,
    country,
    forceRefresh,
  );

  // 使用竞品缓存键存储结果
  setVariantResultCache(asin, country, result);

  return result;
}

/**
 * 检查竞品变体组的所有ASIN
 * @param {string} variantGroupId - 变体组ID
 * @returns {Promise<{isBroken: boolean, brokenASINs: Array, details: any}>}
 */
async function checkCompetitorVariantGroup(
  variantGroupId,
  forceRefresh = false,
  options = {},
) {
  try {
    const { group = null } = options;
    const groupSnapshot =
      group || (await CompetitorVariantGroup.findById(variantGroupId));
    if (!groupSnapshot) {
      throw new Error('竞品变体组不存在');
    }

    const asins = groupSnapshot.children || [];
    if (asins.length === 0) {
      // 没有ASIN，视为异常
      return {
        isBroken: true,
        brokenASINs: [],
        brokenByType: { SP_API_ERROR: 0, NO_VARIANTS: 0 },
        groupSnapshot,
        details: {
          message: '竞品变体组中没有ASIN',
        },
      };
    }

    const checkResults = new Array(asins.length);
    const brokenASINs = [];
    const concurrencyLimit = Math.min(MAX_CONCURRENT_ASIN_CHECKS, asins.length);
    let nextIndex = 0;

    const workerTasks = Array.from({ length: concurrencyLimit }, async () => {
      while (true) {
        const currentIndex = nextIndex++;
        if (currentIndex >= asins.length) {
          break;
        }

        const asin = asins[currentIndex];
        try {
          const result = await checkCompetitorASINVariants(
            asin.asin,
            asin.country,
            forceRefresh,
          );
          const isBroken =
            !result.hasVariants ||
            !result.variantCount ||
            result.variantCount === 0;
          const errorType =
            result.errorType || (isBroken ? 'NO_VARIANTS' : undefined);

          checkResults[currentIndex] = {
            asin: asin.asin,
            hasVariants: result.hasVariants,
            variantCount: result.variantCount,
            errorType, // 记录错误类型
          };

          if (isBroken) {
            brokenASINs.push({
              asin: asin.asin,
              errorType, // 记录错误类型
            });
          }

          await CompetitorASIN.updateVariantStatusAndCheckTime(
            asin.id,
            isBroken,
          );
          asin.isBroken = isBroken ? 1 : 0;
          asin.variantStatus = isBroken ? 'BROKEN' : 'NORMAL';
          asin.lastCheckTime = new Date();
        } catch (error) {
          console.error(`检查竞品ASIN ${asin.asin} 失败:`, error);
          checkResults[currentIndex] = {
            asin: asin.asin,
            error: error.message,
            errorType: 'SP_API_ERROR', // 异常情况标记为SP-API错误
          };
          brokenASINs.push({
            asin: asin.asin,
            errorType: 'SP_API_ERROR', // 异常情况标记为SP-API错误
          });
          await CompetitorASIN.updateVariantStatusAndCheckTime(asin.id, true);
          asin.isBroken = 1;
          asin.variantStatus = 'BROKEN';
          asin.lastCheckTime = new Date();
        }
      }
    });

    await Promise.all(workerTasks);

    // 判断变体组是否异常（如果有任何一个ASIN异常，则整个组异常）
    const isBroken = brokenASINs.length > 0;

    // 更新变体组状态和监控时间
    await CompetitorVariantGroup.updateVariantStatusAndCheckTime(
      variantGroupId,
      isBroken,
    );

    groupSnapshot.is_broken = isBroken ? 1 : 0;
    groupSnapshot.isBroken = isBroken ? 1 : 0;
    groupSnapshot.variant_status = isBroken ? 'BROKEN' : 'NORMAL';
    groupSnapshot.variantStatus = isBroken ? 'BROKEN' : 'NORMAL';
    groupSnapshot.last_check_time = new Date();
    groupSnapshot.lastCheckTime = groupSnapshot.last_check_time;

    // 记录监控历史
    const checkTime = new Date();
    await CompetitorMonitorHistory.create({
      variantGroupId,
      checkType: 'GROUP',
      country: groupSnapshot.country,
      isBroken: isBroken ? 1 : 0,
      checkTime,
      checkResult: JSON.stringify({
        totalASINs: asins.length,
        brokenCount: brokenASINs.length,
        results: checkResults,
      }),
    });

    // 记录每个ASIN的检查历史
    if (groupSnapshot.children && groupSnapshot.children.length > 0) {
      const asinHistoryEntries = groupSnapshot.children.map((asinInfo) => ({
        asinId: asinInfo.id,
        variantGroupId,
        checkType: 'ASIN',
        country: asinInfo.country,
        isBroken: asinInfo.isBroken === 1 ? 1 : 0,
        checkResult: JSON.stringify({
          asin: asinInfo.asin,
          isBroken: asinInfo.isBroken === 1,
        }),
        checkTime,
      }));
      await CompetitorMonitorHistory.bulkCreate(asinHistoryEntries);
    }

    // 统计不同类型的异常
    const brokenByType = {
      SP_API_ERROR: 0,
      NO_VARIANTS: 0,
    };
    brokenASINs.forEach((item) => {
      const errorType =
        typeof item === 'string'
          ? 'NO_VARIANTS'
          : item.errorType || 'NO_VARIANTS';
      brokenByType[errorType] = (brokenByType[errorType] || 0) + 1;
    });

    return {
      isBroken,
      brokenASINs: brokenASINs.map((item) =>
        typeof item === 'string'
          ? { asin: item, errorType: 'NO_VARIANTS' }
          : item,
      ),
      brokenByType, // 按类型统计的异常数量
      groupSnapshot,
      details: {
        totalASINs: asins.length,
        brokenCount: brokenASINs.length,
        results: checkResults,
      },
    };
  } catch (error) {
    console.error(`检查竞品变体组 ${variantGroupId} 失败:`, error);
    throw error;
  }
}

/**
 * 检查单个竞品ASIN
 * @param {string} asinId - ASIN ID
 * @returns {Promise<{isBroken: boolean, details: any}>}
 */
async function checkSingleCompetitorASIN(asinId, forceRefresh = false) {
  let asin = null;
  try {
    asin = await CompetitorASIN.findById(asinId);
    if (!asin) {
      throw new Error('竞品ASIN不存在');
    }

    const result = await checkCompetitorASINVariants(
      asin.asin,
      asin.country,
      forceRefresh,
    );
    const isBroken =
      !result.hasVariants || !result.variantCount || result.variantCount === 0;

    // 更新ASIN状态与监控时间
    await CompetitorASIN.updateVariantStatusAndCheckTime(asinId, isBroken);

    // 如果ASIN属于某个变体组，同步更新变体组状态
    if (asin.variantGroupId) {
      // 重新查询变体组，获取所有ASIN的最新状态
      const group = await CompetitorVariantGroup.findById(asin.variantGroupId);
      if (group && group.children && group.children.length > 0) {
        // 检查变体组中是否有任何ASIN异常
        const hasBrokenASIN = group.children.some(
          (child) => child.isBroken === 1,
        );
        // 更新变体组状态
        await CompetitorVariantGroup.updateVariantStatus(
          asin.variantGroupId,
          hasBrokenASIN,
        );
      }
    }

    // 记录监控历史
    const checkTime = new Date();
    await CompetitorMonitorHistory.create({
      asinId,
      variantGroupId: asin.variantGroupId,
      checkType: 'ASIN',
      country: asin.country,
      isBroken: isBroken ? 1 : 0,
      checkTime,
      checkResult: JSON.stringify({
        asin: asin.asin,
        isBroken,
        result,
      }),
    });

    return {
      isBroken,
      details: {
        asin: asin.asin,
        result,
      },
    };
  } catch (error) {
    console.error(`检查竞品ASIN ${asinId} 失败:`, error);
    throw error;
  }
}

module.exports = {
  checkCompetitorASINVariants,
  checkCompetitorVariantGroup,
  checkSingleCompetitorASIN,
  MAX_CONCURRENT_ASIN_CHECKS,
};
