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
 */
const MAX_CONCURRENT_ASIN_CHECKS = 3;

// 缓存时间配置（统一使用12分钟，保证数据准确性）
const VARIANT_CACHE_TTL_MS = 12 * 60 * 1000; // 12分钟缓存

// 请求去重：存储正在进行的请求，防止重复请求
const pendingRequests = new Map(); // key: "asin:country" -> Promise
const MAX_PENDING_REQUESTS = 1000; // 最大pending请求数
const PENDING_REQUEST_TIMEOUT = 5 * 60 * 1000; // 5分钟超时

// 定期清理过期的pending请求
setInterval(() => {
  const now = Date.now();
  for (const [key, promise] of pendingRequests.entries()) {
    // 如果请求已经完成或超时，从Map中移除
    // 注意：这里无法直接检查Promise状态，所以依赖请求完成时的清理
  }
  // 如果Map大小超过限制，清理最旧的请求
  if (pendingRequests.size > MAX_PENDING_REQUESTS) {
    const oldestKey = Array.from(pendingRequests.keys())[0];
    pendingRequests.delete(oldestKey);
    logger.warn(
      `[pendingRequests] 清理最旧的请求: ${oldestKey}, 当前大小: ${pendingRequests.size}`,
    );
  }
}, 10 * 60 * 1000); // 每10分钟清理一次

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
    logger.info(
      `[变体检查] ENABLE_LEGACY_CLIENT_FALLBACK: ${ENABLE_LEGACY_CLIENT_FALLBACK}`,
    );
  } catch (error) {
    logger.error(
      '[变体检查] 加载 ENABLE_LEGACY_CLIENT_FALLBACK 配置失败:',
      error.message,
    );
    ENABLE_LEGACY_CLIENT_FALLBACK = false; // 默认关闭
  }
}

/**
 * 重新加载 HTML 抓取兜底配置（供外部调用）
 */
async function reloadHtmlScraperFallbackConfig() {
  await loadHtmlScraperFallbackConfig();
}

// 初始化时加载配置
loadHtmlScraperFallbackConfig();
loadLegacyClientFallbackConfig();

function getVariantCacheKey(asin, country) {
  // 统一使用大写的 ASIN 作为缓存键，避免大小写不一致导致缓存失效
  const cleanASIN = asin ? asin.trim().toUpperCase() : asin;
  return `variant:${country}:${cleanASIN}`;
}

function getCachedVariantResult(asin, country) {
  const key = getVariantCacheKey(asin, country);
  return cacheService.get(key);
}

function setVariantResultCache(asin, country, result) {
  const key = getVariantCacheKey(asin, country);
  // 统一使用12分钟缓存时间，保证数据准确性
  cacheService.set(key, result, VARIANT_CACHE_TTL_MS);
}

/**
 * 实际执行ASIN变体检查的内部函数
 * @param {string} asin - ASIN编码
 * @param {string} country - 国家代码
 * @param {boolean} forceRefresh - 是否强制刷新
 * @param {number} priority - 请求优先级（PRIORITY.MANUAL=1, PRIORITY.SCHEDULED=2, PRIORITY.BATCH=3），默认2
 * @returns {Promise<{hasVariants: boolean, variantCount: number, details: any, errorType?: string}>}
 * errorType: 'SP_API_ERROR' - SP-API调用错误, 'NO_VARIANTS' - ASIN无变体（正常情况）
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
      const cached = getCachedVariantResult(asin, country);
      if (cached) {
        logger.info(`[checkASINVariants] 使用缓存结果: ${asin} (${country})`);
        // 缓存命中，记录为成功
        const responseTime = (Date.now() - startTime) / 1000;
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
      throw new Error('ASIN 不能为空');
    }

    // 清理 ASIN（去除空格，转换为大写）
    const cleanASIN = asin.trim().toUpperCase();

    // 验证 ASIN 格式（Amazon ASIN 通常是 10 位字符，以 B 开头）
    if (!/^[A-Z0-9]{10}$/.test(cleanASIN)) {
      logger.warn(
        `[checkASINVariants] ASIN 格式可能不正确: ${cleanASIN}，但继续尝试调用 API`,
      );
    }

    const marketplaceId = getMarketplaceId(country);

    logger.info(
      `[checkASINVariants] 调用SP-API检查ASIN ${cleanASIN}，国家: ${country}，Marketplace ID: ${marketplaceId}`,
    );

    // 获取区域代码（US或EU），用于令牌桶限流
    // US区域：US
    // EU区域：UK, DE, FR, IT, ES -> EU
    const region = country === 'US' ? 'US' : 'EU';

    // 指数退避重试函数（用于429限流错误，支持Retry-After头解析）
    const retryWithBackoff = async (fn, maxRetries = 3) => {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          return await fn();
        } catch (error) {
          const statusCode =
            error.statusCode || error.message.match(/\d{3}/)?.[0];

          // 只有429错误才重试
          if (statusCode === 429 || error.message.includes('429')) {
            if (attempt < maxRetries - 1) {
              // 优先使用Retry-After响应头（如果存在）
              let waitTime = null;
              const retryAfter =
                error.response?.headers?.['retry-after'] ||
                error.response?.headers?.['Retry-After'] ||
                error.headers?.['retry-after'] ||
                error.headers?.['Retry-After'];

              if (retryAfter) {
                // Retry-After可能是秒数（数字）或HTTP日期字符串
                const retryAfterNum = parseInt(retryAfter, 10);
                if (!isNaN(retryAfterNum)) {
                  // 数字格式：直接使用（秒转毫秒）
                  waitTime = retryAfterNum * 1000;
                  logger.info(
                    `[checkASINVariants] 429限流错误，Retry-After头指定等待 ${waitTime}ms 后重试 (${
                      attempt + 1
                    }/${maxRetries})`,
                  );
                } else {
                  // HTTP日期格式：计算时间差
                  const retryDate = new Date(retryAfter);
                  if (!isNaN(retryDate.getTime())) {
                    waitTime = Math.max(0, retryDate.getTime() - Date.now());
                    logger.info(
                      `[checkASINVariants] 429限流错误，Retry-After头指定等待 ${waitTime}ms 后重试 (${
                        attempt + 1
                      }/${maxRetries})`,
                    );
                  }
                }
              }

              // 如果没有Retry-After头或解析失败，使用指数退避作为兜底
              if (waitTime === null || waitTime <= 0) {
                waitTime = Math.min(1000 * Math.pow(2, attempt), 10000); // 最多10秒
                logger.info(
                  `[checkASINVariants] 429限流错误，使用指数退避等待 ${waitTime}ms 后重试 (${
                    attempt + 1
                  }/${maxRetries})`,
                );
              }

              // 限制最大等待时间为60秒
              waitTime = Math.min(waitTime, 60000);

              await new Promise((resolve) => {
                void setTimeout(resolve, waitTime);
              });
              continue;
            }
          }
          throw error;
        }
      }
    };

    // 统一使用 2022-04-01 版本，不再尝试多版本回退
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
    if (!marketplaceId) {
      throw new Error(`无法获取 ${country} 的 Marketplace ID`);
    }

    const cleanMarketplaceId = String(marketplaceId).trim();
    if (!cleanMarketplaceId || cleanMarketplaceId.length === 0) {
      throw new Error(`Marketplace ID 无效: ${marketplaceId}`);
    }

    const params = {
      marketplaceIds: [cleanMarketplaceId],
      includedData: ['variations'],
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
    await rateLimiter.acquire(region, 1, priority, operation);

    try {
      // 调用SP-API，传递operation参数（callSPAPI内部已处理Retry-After，所以retryWithBackoff可能不再需要）
      response = await callSPAPI('GET', path, country, params, null, {
        operation: operation,
        maxRetries: 3,
      });

      if (response) {
        logger.info(`[checkASINVariants] API版本 ${apiVersion} 调用成功`);
      }
    } catch (error) {
      lastError = error;
      const statusCode = error.statusCode || error.message.match(/\d{3}/)?.[0];

      logger.warn(
        `[checkASINVariants] API版本 ${apiVersion} 调用失败:`,
        error.message,
      );

      // 记录详细的错误信息
      if (error.responseData) {
        try {
          const errorData =
            typeof error.responseData === 'string'
              ? JSON.parse(error.responseData)
              : error.responseData;
          logger.debug(
            `[checkASINVariants] 错误详情:`,
            JSON.stringify(errorData, null, 2),
          );
        } catch (e) {
          logger.debug(`[checkASINVariants] 错误响应数据:`, error.responseData);
        }
      }

      // 429限流错误：已在retryWithBackoff中处理，如果仍然失败，标记为限流
      if (
        statusCode === 429 ||
        error.message.includes('429') ||
        error.message.includes('QuotaExceeded') ||
        error.message.includes('TooManyRequests')
      ) {
        isRateLimit = true;
        logger.warn(
          `[checkASINVariants] API版本 ${apiVersion} 返回 429（限流），重试后仍失败，进入兜底逻辑`,
        );
      } else if (
        statusCode === 400 ||
        (error.message && error.message.includes('400'))
      ) {
        // 400错误：参数问题，直接进入兜底
        logger.warn(
          `[checkASINVariants] API版本 ${apiVersion} 返回 400（Bad Request），进入兜底逻辑`,
        );
      } else if (
        statusCode === 404 ||
        (error.message && error.message.includes('404'))
      ) {
        // 404错误：ASIN不存在，直接进入兜底
        logger.warn(
          `[checkASINVariants] API版本 ${apiVersion} 返回 404（Not Found），进入兜底逻辑`,
        );
      } else {
        // 其他错误：直接进入兜底
        logger.warn(
          `[checkASINVariants] API版本 ${apiVersion} 返回其他错误，进入兜底逻辑`,
        );
      }
    }

    // 如果 SP-API 调用失败，尝试旧客户端备用
    if (!response && ENABLE_LEGACY_CLIENT_FALLBACK) {
      logger.info(`[checkASINVariants] SP-API调用失败，尝试旧客户端备用...`);
      try {
        // 使用相同的路径和参数
        const legacyParams = {
          marketplaceIds: [cleanMarketplaceId],
          includedData: ['variations'],
        };
        response = await callLegacySPAPI('GET', path, country, legacyParams);

        if (response) {
          logger.info(`[checkASINVariants] 旧客户端调用成功`);
        }
      } catch (legacyError) {
        logger.error(
          `[checkASINVariants] 旧客户端也失败:`,
          legacyError.message,
        );
        // 继续尝试 HTML 抓取
      }
    }

    // 如果 SP-API 和旧客户端都失败，尝试 HTML 抓取兜底
    if (!response && ENABLE_HTML_SCRAPER_FALLBACK) {
      logger.info(
        `[checkASINVariants] SP-API和旧客户端都失败，尝试HTML抓取兜底...`,
      );
      try {
        const htmlResult = await htmlScraperService.checkASINVariantsByHTML(
          cleanASIN,
          country,
        );

        // 将 HTML 抓取结果转换为标准格式
        const variantASINs = htmlResult.details.variantAsins || [];
        const parentASIN = htmlResult.details.parentAsin;

        const hasVariants = htmlResult.hasVariants;
        const variantCount = variantASINs.length;

        const result = {
          hasVariants,
          variantCount,
          details: {
            asin,
            parentAsin: parentASIN,
            variantASINs,
            source: 'html_scraper',
            apiVersion: null,
          },
        };

        // 缓存结果（使用清理后的 ASIN）
        setVariantResultCache(cleanASIN, country, result);

        logger.info(
          `[checkASINVariants] HTML抓取成功: hasVariants=${hasVariants}, variantCount=${variantCount}`,
        );

        // 记录成功（HTML抓取成功）
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
        // HTML 抓取失败，抛出最后一个 SP-API 错误
        if (lastError) {
          throw lastError;
        }
        throw htmlError;
      }
    }

    // 如果所有方法都失败，抛出错误
    if (!response) {
      if (lastError) {
        throw lastError;
      }
      throw new Error('SP-API调用失败，且备用方案未启用或失败');
    }

    // 解析响应
    logger.debug(`[checkASINVariants] SP-API响应:`, {
      hasResponse: !!response,
      hasItems: !!(response && response.items),
      itemsCount: response && response.items ? response.items.length : 0,
      responseKeys: response ? Object.keys(response) : [],
    });

    // SP-API返回格式可能有两种：
    // 1. v2022-04-01: { items: [{ asin, variations: [...] }] }
    // 2. v2020-12-01: { asin: "...", summaries: [...], variations: [...] } (直接返回item对象)
    let item = null;

    if (response && response.items && response.items.length > 0) {
      // v2022-04-01 格式
      item = response.items[0];
    } else if (response && response.asin) {
      // v2020-12-01 格式：直接返回item对象
      item = response;
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

      // 检查是否有变体关系
      // SP-API返回的variations格式: [{marketplaceId, asins: [...], variationType}]
      // 每个元素代表一个变体组，asins数组包含实际的变体ASIN列表
      const variations = item.variations || [];

      // 提取所有变体ASIN和变体类型信息
      // SP-API的variations格式说明：
      // - 如果 variationType: "CHILD"，表示当前ASIN是子变体，asins数组中的ASIN是父变体ASIN
      // - 如果 variationType: "PARENT"，表示当前ASIN是父变体，asins数组中的ASIN是子变体ASIN
      const variantASINs = [];
      let parentASIN = null;
      let isChild = false;
      let isParent = false;

      variations.forEach((variationGroup) => {
        // 检查变体类型
        if (variationGroup.variationType === 'CHILD') {
          isChild = true;
          // 如果当前ASIN是子变体，asins数组中的ASIN就是父变体ASIN
          if (
            variationGroup.asins &&
            Array.isArray(variationGroup.asins) &&
            variationGroup.asins.length > 0
          ) {
            parentASIN = variationGroup.asins[0]; // 通常只有一个父变体
            // 父变体ASIN也加入到variantASINs中，用于统计
            variantASINs.push(...variationGroup.asins);
          }
        } else if (variationGroup.variationType === 'PARENT') {
          isParent = true;
          // 如果当前ASIN是父变体，asins数组中的ASIN是子变体ASIN
          if (variationGroup.asins && Array.isArray(variationGroup.asins)) {
            variantASINs.push(...variationGroup.asins);
          }
          // 当前ASIN就是父变体
          parentASIN = item.asin;
        } else {
          // 未知类型，直接添加asins
          if (variationGroup.asins && Array.isArray(variationGroup.asins)) {
            variantASINs.push(...variationGroup.asins);
          }
        }
      });

      const hasVariants = variantASINs.length > 0;

      // 如果没有variations字段，尝试检查relationships中的VARIATION关系
      const relationships = item.relationships || [];
      const variationRelations = relationships.filter(
        (rel) => rel.type === 'VARIATION' || rel.type === 'VARIANT',
      );

      // 如果还没有找到父变体，尝试从relationships中查找
      if (!parentASIN && isChild && relationships.length > 0) {
        // 查找PARENT类型的relationship
        const parentRelation = relationships.find(
          (rel) => rel.type === 'PARENT' || rel.relationshipType === 'PARENT',
        );
        if (parentRelation && parentRelation.asin) {
          parentASIN = parentRelation.asin;
        } else if (parentRelation && parentRelation.parentAsin) {
          parentASIN = parentRelation.parentAsin;
        }
      }

      const finalHasVariants = hasVariants || variationRelations.length > 0;
      // variantCount是实际的变体ASIN数量
      const variantCount = variantASINs.length || variationRelations.length;

      // 输出详细的变体检查结果
      logger.debug(`\n========== ASIN变体检查结果 ==========`);
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
          if (isChild) {
            // 如果是子变体，variantASINs中包含的是父变体ASIN
            logger.debug(`父变体ASIN: ${variantASINs.join(', ')}`);
          } else if (isParent) {
            // 如果是父变体，variantASINs中包含的是子变体ASIN
            logger.debug(`子变体ASIN列表: ${variantASINs.join(', ')}`);
          } else {
            logger.debug(`变体ASIN列表: ${variantASINs.join(', ')}`);
          }
        }
        if (parentASIN) {
          logger.debug(`✅ 父变体ASIN: ${parentASIN}`);
        } else if (isChild) {
          logger.debug(`⚠️  注意: 当前ASIN是子变体，但未找到父变体ASIN`);
        }
      } else {
        logger.debug(`说明: 该ASIN没有变体关系`);
      }
      logger.debug(`=====================================\n`);

      const resultPayload = {
        hasVariants: finalHasVariants,
        variantCount,
        // 如果有变体，不需要 errorType；如果没有变体，标记为 NO_VARIANTS
        errorType: finalHasVariants ? undefined : 'NO_VARIANTS',
        details: {
          asin: item.asin,
          title:
            item.summaries?.[0]?.itemName ||
            item.summaries?.[0]?.title ||
            item.attributes?.item_name?.[0]?.value ||
            '',
          variations: variantASINs.map((asin) => ({
            asin: asin,
            title: '',
          })),
          relationships: variationRelations,
        },
      };
      // 使用清理后的 ASIN 存储缓存
      setVariantResultCache(cleanASIN, country, resultPayload);

      // 记录成功（有变体或无变体都是成功，只是结果不同）
      const responseTime = (Date.now() - startTime) / 1000;
      success = true;
      riskControlService.recordCheck({
        success: true,
        isRateLimit: false,
        isSpApiError: false,
        responseTime,
      });

      return resultPayload;
    }

    // 如果没有找到变体，返回无变体（这是正常情况，不是错误）
    const resultPayload = {
      hasVariants: false,
      variantCount: 0,
      errorType: 'NO_VARIANTS', // 标识为无变体（正常情况）
      details: {
        asin: cleanASIN,
        message: '未找到变体信息',
      },
    };
    // 使用清理后的 ASIN 存储缓存
    setVariantResultCache(cleanASIN, country, resultPayload);

    // 记录成功（无变体也是成功）
    const responseTime = (Date.now() - startTime) / 1000;
    success = true;
    riskControlService.recordCheck({
      success: true,
      isRateLimit: false,
      isSpApiError: false,
      responseTime,
    });

    return resultPayload;
  } catch (error) {
    logger.error(`检查ASIN ${asin} 变体失败:`, error.message);

    // 记录错误统计
    const region = country === 'US' ? 'US' : 'EU';
    errorStatsService.recordErrorAuto(error, region);

    // 如果是404错误，说明ASIN不存在或无法访问（可能是ASIN不存在，也可能是SP-API版本不支持）
    // 这种情况下，我们标记为 SP-API 错误，因为可能是API调用问题
    if (error.message.includes('404') || error.message.includes('NotFound')) {
      const responseTime = (Date.now() - startTime) / 1000;
      isSpApiError = true;
      riskControlService.recordCheck({
        success: false,
        isRateLimit: false,
        isSpApiError: true,
        responseTime,
      });

      return {
        hasVariants: false,
        variantCount: 0,
        errorType: 'SP_API_ERROR', // 标记为SP-API错误
        details: {
          asin,
          error: 'ASIN不存在或无法访问（可能是SP-API调用失败）',
          errorMessage: error.message,
        },
      };
    }

    // 如果是认证错误，抛出异常（这是配置问题，不是ASIN问题）
    if (
      error.message.includes('401') ||
      error.message.includes('Unauthorized')
    ) {
      throw new Error('SP-API认证失败，请检查配置');
    }

    // 如果是权限错误，抛出异常（这是配置问题，不是ASIN问题）
    if (error.message.includes('403') || error.message.includes('Forbidden')) {
      throw new Error('SP-API权限不足，请检查IAM角色配置');
    }

    // 其他SP-API错误（400, 429, 500等），标记为SP-API错误
    if (
      error.message.includes('SP-API') ||
      error.message.includes('400') ||
      error.message.includes('429') ||
      error.message.includes('500') ||
      error.message.includes('503') ||
      error.statusCode
    ) {
      const responseTime = (Date.now() - startTime) / 1000;
      const isRateLimitError =
        error.message.includes('429') ||
        error.message.includes('QuotaExceeded') ||
        error.message.includes('TooManyRequests') ||
        error.statusCode === 429;

      isRateLimit = isRateLimitError;
      isSpApiError = !isRateLimitError; // 限流错误不算SP-API错误，是单独的类型

      riskControlService.recordCheck({
        success: false,
        isRateLimit: isRateLimitError,
        isSpApiError: !isRateLimitError,
        responseTime,
      });

      return {
        hasVariants: false,
        variantCount: 0,
        errorType: 'SP_API_ERROR', // 标记为SP-API错误
        details: {
          asin,
          error: 'SP-API调用失败',
          errorMessage: error.message,
          statusCode: error.statusCode,
        },
      };
    }

    // 未知错误，也标记为SP-API错误
    return {
      hasVariants: false,
      variantCount: 0,
      errorType: 'SP_API_ERROR',
      details: {
        asin,
        error: '检查失败',
        errorMessage: error.message,
      },
    };
  }
}

/**
 * 检查单个ASIN的变体关系（带请求去重和优先级支持）
 * @param {string} asin - ASIN编码
 * @param {string} country - 国家代码
 * @param {boolean} forceRefresh - 是否强制刷新
 * @param {number} priority - 请求优先级（PRIORITY.MANUAL=1, PRIORITY.SCHEDULED=2, PRIORITY.BATCH=3），默认2
 * @returns {Promise<{hasVariants: boolean, variantCount: number, details: any, errorType?: string}>}
 * errorType: 'SP_API_ERROR' - SP-API调用错误, 'NO_VARIANTS' - ASIN无变体（正常情况）
 */
async function checkASINVariants(
  asin,
  country,
  forceRefresh = false,
  priority = PRIORITY.SCHEDULED,
) {
  // 构建请求去重的缓存键
  const cacheKey = `${asin}:${country}`;

  // 如果Map大小超过限制，清理最旧的请求
  if (pendingRequests.size > MAX_PENDING_REQUESTS) {
    const oldestKey = Array.from(pendingRequests.keys())[0];
    pendingRequests.delete(oldestKey);
    logger.warn(
      `[checkASINVariants] pendingRequests超过限制，清理最旧的请求: ${oldestKey}`,
    );
  }

  // 如果已有相同请求在进行且不强制刷新，等待该请求完成
  if (pendingRequests.has(cacheKey) && !forceRefresh) {
    logger.info(
      `[checkASINVariants] 检测到重复请求，等待已有请求完成: ${asin} (${country})`,
    );
    try {
      return await pendingRequests.get(cacheKey);
    } catch (error) {
      // 如果已有请求失败，继续执行新请求
      logger.warn(
        `[checkASINVariants] 已有请求失败，执行新请求: ${asin} (${country})`,
      );
    }
  }

  // 创建新的请求Promise（传入优先级）
  const requestPromise = doCheckASINVariants(
    asin,
    country,
    forceRefresh,
    priority,
  );

  // 将请求Promise存储到Map中（仅在非强制刷新时）
  if (!forceRefresh) {
    pendingRequests.set(cacheKey, requestPromise);
  }

  try {
    const result = await requestPromise;
    return result;
  } finally {
    // 请求完成后从Map中移除
    if (pendingRequests.get(cacheKey) === requestPromise) {
      pendingRequests.delete(cacheKey);
    }
  }
}

/**
 * 检查变体组的所有ASIN
 * @param {string} variantGroupId - 变体组ID
 * @returns {Promise<{isBroken: boolean, brokenASINs: Array, details: any}>}
 */
async function checkVariantGroup(variantGroupId, forceRefresh = false) {
  try {
    const group = await VariantGroup.findById(variantGroupId);
    if (!group) {
      throw new Error('变体组不存在');
    }

    const asins = group.children || [];
    if (asins.length === 0) {
      // 没有ASIN，视为异常
      return {
        isBroken: true,
        brokenASINs: [],
        brokenByType: { SP_API_ERROR: 0, NO_VARIANTS: 0 },
        details: {
          message: '变体组中没有ASIN',
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
          // 变体组检查使用SCHEDULED优先级（中等优先级）
          const result = await checkASINVariants(
            asin.asin,
            asin.country,
            forceRefresh,
            PRIORITY.SCHEDULED,
          );
          const hasVariants = result.hasVariants;
          const errorType =
            result.errorType || (hasVariants ? undefined : 'NO_VARIANTS');

          checkResults[currentIndex] = {
            asin: asin.asin,
            hasVariants,
            variantCount: result.variantCount,
            errorType, // 记录错误类型
          };

          if (!hasVariants) {
            brokenASINs.push({
              asin: asin.asin,
              errorType, // 记录错误类型
            });
          }

          await ASIN.updateVariantStatus(asin.id, !hasVariants);
        } catch (error) {
          logger.error(`检查ASIN ${asin.asin} 失败:`, error);
          checkResults[currentIndex] = {
            asin: asin.asin,
            error: error.message,
            errorType: 'SP_API_ERROR', // 异常情况标记为SP-API错误
          };
          brokenASINs.push({
            asin: asin.asin,
            errorType: 'SP_API_ERROR', // 异常情况标记为SP-API错误
          });
        }
      }
    });

    await Promise.all(workerTasks);

    // 判断变体组是否异常（如果有任何一个ASIN异常，则整个组异常）
    const isBroken = brokenASINs.length > 0;

    // 更新变体组状态
    await VariantGroup.updateVariantStatus(variantGroupId, isBroken);

    // 更新变体组的监控更新时间
    await VariantGroup.updateLastCheckTime(variantGroupId);

    // 重新查询变体组状态确保准确性
    const updatedGroup = await VariantGroup.findById(variantGroupId);
    if (updatedGroup) {
      // 如果状态不一致，再次更新
      const actualIsBroken = updatedGroup.isBroken === 1;
      if (actualIsBroken !== isBroken) {
        await VariantGroup.updateVariantStatus(variantGroupId, actualIsBroken);
      }
    }

    // 记录监控历史
    const checkTime = new Date();
    await MonitorHistory.create({
      variantGroupId,
      checkType: 'GROUP',
      country: group.country,
      isBroken: isBroken ? 1 : 0,
      checkTime,
      checkResult: JSON.stringify({
        totalASINs: asins.length,
        brokenCount: brokenASINs.length,
        results: checkResults,
      }),
    });

    // 记录每个ASIN的检查历史
    if (group.children && group.children.length > 0) {
      const asinHistoryEntries = group.children.map((asinInfo) => ({
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
      await MonitorHistory.bulkCreate(asinHistoryEntries);
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
      details: {
        totalASINs: asins.length,
        brokenCount: brokenASINs.length,
        results: checkResults,
      },
    };
  } catch (error) {
    logger.error(`检查变体组 ${variantGroupId} 失败:`, error);
    throw error;
  }
}

/**
 * 检查单个ASIN
 * @param {string} asinId - ASIN ID
 * @returns {Promise<{isBroken: boolean, details: any}>}
 */
async function checkSingleASIN(asinId, forceRefresh = false) {
  let asin = null;
  try {
    asin = await ASIN.findById(asinId);
    if (!asin) {
      throw new Error('ASIN不存在');
    }

    // 单个ASIN检查（通常来自手动触发）使用MANUAL优先级（最高优先级）
    const result = await checkASINVariants(
      asin.asin,
      asin.country,
      forceRefresh,
      PRIORITY.MANUAL,
    );
    const isBroken = !result.hasVariants;

    // 更新ASIN状态
    await ASIN.updateVariantStatus(asinId, isBroken);

    // 如果ASIN属于某个变体组，同步更新变体组状态
    if (asin.variantGroupId) {
      // 重新查询变体组，获取所有ASIN的最新状态
      const group = await VariantGroup.findById(asin.variantGroupId);
      if (group && group.children && group.children.length > 0) {
        // 检查变体组中是否有任何ASIN异常
        const hasBrokenASIN = group.children.some(
          (child) => child.isBroken === 1,
        );
        // 更新变体组状态
        await VariantGroup.updateVariantStatus(
          asin.variantGroupId,
          hasBrokenASIN,
        );
      }
    }

    // 记录监控历史
    await MonitorHistory.create({
      asinId,
      variantGroupId: asin.variantGroupId,
      checkType: 'ASIN',
      country: asin.country,
      isBroken: isBroken ? 1 : 0,
      checkTime: new Date(),
      checkResult: JSON.stringify(result.details),
    });

    return {
      isBroken,
      details: result.details,
    };
  } catch (error) {
    logger.error(`检查ASIN ${asinId} 失败:`, error);
    // 检查失败时，标记ASIN为异常状态
    if (asin) {
      try {
        await ASIN.updateVariantStatus(asinId, true);
        // 如果ASIN属于某个变体组，同步更新变体组状态
        if (asin.variantGroupId) {
          const group = await VariantGroup.findById(asin.variantGroupId);
          if (group && group.children && group.children.length > 0) {
            const hasBrokenASIN = group.children.some(
              (child) => child.isBroken === 1,
            );
            await VariantGroup.updateVariantStatus(
              asin.variantGroupId,
              hasBrokenASIN,
            );
          }
        }
        // 记录检查失败的历史
        await MonitorHistory.create({
          asinId,
          variantGroupId: asin.variantGroupId,
          checkType: 'ASIN',
          country: asin.country,
          isBroken: 1,
          checkTime: new Date(),
          checkResult: JSON.stringify({
            error: error.message,
            checkFailed: true,
          }),
        });
      } catch (updateError) {
        logger.error(`更新ASIN ${asinId} 状态失败:`, updateError);
      }
    }
    throw error;
  }
}

/**
 * 重新加载旧客户端备用配置（供外部调用）
 */
async function reloadLegacyClientFallbackConfig() {
  await loadLegacyClientFallbackConfig();
}

/**
 * 获取Marketplace ID
 * @param {string} country - 国家代码
 * @returns {string} Marketplace ID
 */
module.exports = {
  checkASINVariants,
  checkVariantGroup,
  checkSingleASIN,
  reloadHtmlScraperFallbackConfig,
  reloadLegacyClientFallbackConfig,
  MAX_CONCURRENT_ASIN_CHECKS,
  doCheckASINVariants, // 导出内部函数供批量查询使用
};
