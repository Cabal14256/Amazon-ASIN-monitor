const { callSPAPI, getMarketplaceId } = require('../config/sp-api');
const VariantGroup = require('../models/VariantGroup');
const ASIN = require('../models/ASIN');
const MonitorHistory = require('../models/MonitorHistory');
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
      `[变体检查] ENABLE_HTML_SCRAPER_FALLBACK: ${ENABLE_HTML_SCRAPER_FALLBACK}`,
    );
  } catch (error) {
    console.error(
      '[变体检查] 加载 ENABLE_HTML_SCRAPER_FALLBACK 配置失败:',
      error.message,
    );
    ENABLE_HTML_SCRAPER_FALLBACK = false; // 默认关闭
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

function getVariantCacheKey(asin, country) {
  return `variant:${country}:${asin}`;
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
 * 检查单个ASIN的变体关系
 * @param {string} asin - ASIN编码
 * @param {string} country - 国家代码
 * @returns {Promise<{hasVariants: boolean, variantCount: number, details: any}>}
 */
async function checkASINVariants(asin, country) {
  try {
    const cached = getCachedVariantResult(asin, country);
    if (cached) {
      console.log(`[checkASINVariants] 使用缓存结果: ${asin} (${country})`);
      return cached;
    }

    const marketplaceId = getMarketplaceId(country);
    const params = {
      marketplaceIds: [marketplaceId],
      includedData: ['variations'],
    };

    console.log(
      `[checkASINVariants] 调用SP-API检查ASIN ${asin}，国家: ${country}，Marketplace ID: ${marketplaceId}`,
    );

    // 请求延迟控制（每 N 个请求延迟 M 毫秒）
    globalRequestCounter++;
    if (globalRequestCounter >= REQUEST_DELAY_INTERVAL) {
      console.log(
        `[checkASINVariants] 达到延迟阈值（${REQUEST_DELAY_INTERVAL}个请求），延迟 ${REQUEST_DELAY_MS}ms`,
      );
      await new Promise((resolve) => {
        setTimeout(() => {
          resolve();
        }, REQUEST_DELAY_MS);
      });
      globalRequestCounter = 0;
    }

    // 多版本回退策略：优先使用 2022-04-01，失败后回退到 2020-12-01
    let response = null;
    let apiVersion = null;
    let lastError = null;

    for (const version of API_VERSIONS) {
      try {
        const path = `/catalog/${version}/items/${asin}`;
        apiVersion = version;
        console.log(`[checkASINVariants] 尝试API版本: ${apiVersion}`);
        console.log(`[checkASINVariants] 参数:`, params);

        response = await callSPAPI('GET', path, country, params);

        // 如果成功，跳出循环
        if (response) {
          console.log(`[checkASINVariants] API版本 ${apiVersion} 调用成功`);
          break;
        }
      } catch (error) {
        lastError = error;
        console.log(
          `[checkASINVariants] API版本 ${version} 调用失败:`,
          error.message,
        );

        // 如果是 400 或 404 错误，尝试下一个版本
        if (
          error.message &&
          (error.message.includes('400') || error.message.includes('404'))
        ) {
          console.log(
            `[checkASINVariants] 版本 ${version} 返回 400/404，尝试下一个版本...`,
          );
          continue;
        }

        // 其他错误（如 429、500 等），也尝试下一个版本
        if (error.message && error.message.includes('429')) {
          console.log(
            `[checkASINVariants] 版本 ${version} 返回 429（限流），尝试下一个版本...`,
          );
          continue;
        }

        // 如果是网络错误或其他严重错误，直接抛出
        if (
          !error.message ||
          (!error.message.includes('400') &&
            !error.message.includes('404') &&
            !error.message.includes('429'))
        ) {
          throw error;
        }
      }
    }

    // 如果所有 SP-API 版本都失败，尝试 HTML 抓取兜底
    if (!response && ENABLE_HTML_SCRAPER_FALLBACK) {
      console.log(
        `[checkASINVariants] 所有SP-API版本都失败，尝试HTML抓取兜底...`,
      );
      try {
        const htmlResult = await htmlScraperService.checkASINVariantsByHTML(
          asin,
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

        // 缓存结果
        setVariantResultCache(asin, country, result);

        console.log(
          `[checkASINVariants] HTML抓取成功: hasVariants=${hasVariants}, variantCount=${variantCount}`,
        );
        return result;
      } catch (htmlError) {
        console.error(`[checkASINVariants] HTML抓取也失败:`, htmlError.message);
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
      throw new Error('所有SP-API版本调用失败，且HTML抓取未启用或失败');
    }

    // 解析响应
    console.log(`[checkASINVariants] SP-API响应:`, {
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
      console.log(`[checkASINVariants] 解析到的item:`, {
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
      console.log(`\n========== ASIN变体检查结果 ==========`);
      console.log(`ASIN: ${item.asin}`);
      console.log(`是否有变体: ${finalHasVariants ? '✅ 是' : '❌ 否'}`);

      if (finalHasVariants) {
        console.log(
          `变体类型: ${
            isChild ? '子变体 (CHILD)' : isParent ? '父变体 (PARENT)' : '未知'
          }`,
        );
        console.log(`变体ASIN数量: ${variantCount}`);
        if (variantASINs.length > 0) {
          if (isChild) {
            // 如果是子变体，variantASINs中包含的是父变体ASIN
            console.log(`父变体ASIN: ${variantASINs.join(', ')}`);
          } else if (isParent) {
            // 如果是父变体，variantASINs中包含的是子变体ASIN
            console.log(`子变体ASIN列表: ${variantASINs.join(', ')}`);
          } else {
            console.log(`变体ASIN列表: ${variantASINs.join(', ')}`);
          }
        }
        if (parentASIN) {
          console.log(`✅ 父变体ASIN: ${parentASIN}`);
        } else if (isChild) {
          console.log(`⚠️  注意: 当前ASIN是子变体，但未找到父变体ASIN`);
        }
      } else {
        console.log(`说明: 该ASIN没有变体关系`);
      }
      console.log(`=====================================\n`);

      const resultPayload = {
        hasVariants: finalHasVariants,
        variantCount,
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
      setVariantResultCache(asin, country, resultPayload);
      return resultPayload;
    }

    // 如果没有找到变体，返回无变体
    const resultPayload = {
      hasVariants: false,
      variantCount: 0,
      details: {
        asin,
        message: '未找到变体信息',
      },
    };
    setVariantResultCache(asin, country, resultPayload);
    return resultPayload;
  } catch (error) {
    console.error(`检查ASIN ${asin} 变体失败:`, error.message);

    // 如果是404错误，说明ASIN不存在或无法访问
    if (error.message.includes('404') || error.message.includes('NotFound')) {
      return {
        hasVariants: false,
        variantCount: 0,
        details: {
          asin,
          error: 'ASIN不存在或无法访问',
        },
      };
    }

    // 如果是认证错误，抛出异常
    if (
      error.message.includes('401') ||
      error.message.includes('Unauthorized')
    ) {
      throw new Error('SP-API认证失败，请检查配置');
    }

    // 如果是权限错误
    if (error.message.includes('403') || error.message.includes('Forbidden')) {
      throw new Error('SP-API权限不足，请检查IAM角色配置');
    }

    throw error;
  }
}

/**
 * 检查变体组的所有ASIN
 * @param {string} variantGroupId - 变体组ID
 * @returns {Promise<{isBroken: boolean, brokenASINs: Array, details: any}>}
 */
async function checkVariantGroup(variantGroupId) {
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
          const result = await checkASINVariants(asin.asin, asin.country);
          const hasVariants = result.hasVariants;

          checkResults[currentIndex] = {
            asin: asin.asin,
            hasVariants,
            variantCount: result.variantCount,
          };

          if (!hasVariants) {
            brokenASINs.push(asin.asin);
          }

          await ASIN.updateVariantStatus(asin.id, !hasVariants);
        } catch (error) {
          console.error(`检查ASIN ${asin.asin} 失败:`, error);
          checkResults[currentIndex] = {
            asin: asin.asin,
            error: error.message,
          };
          brokenASINs.push(asin.asin);
        }
      }
    });

    await Promise.all(workerTasks);

    // 判断变体组是否异常（如果有任何一个ASIN异常，则整个组异常）
    const isBroken = brokenASINs.length > 0;

    // 更新变体组状态
    await VariantGroup.updateVariantStatus(variantGroupId, isBroken);

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

    return {
      isBroken,
      brokenASINs,
      details: {
        totalASINs: asins.length,
        brokenCount: brokenASINs.length,
        results: checkResults,
      },
    };
  } catch (error) {
    console.error(`检查变体组 ${variantGroupId} 失败:`, error);
    throw error;
  }
}

/**
 * 检查单个ASIN
 * @param {string} asinId - ASIN ID
 * @returns {Promise<{isBroken: boolean, details: any}>}
 */
async function checkSingleASIN(asinId) {
  let asin = null;
  try {
    asin = await ASIN.findById(asinId);
    if (!asin) {
      throw new Error('ASIN不存在');
    }

    const result = await checkASINVariants(asin.asin, asin.country);
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
    console.error(`检查ASIN ${asinId} 失败:`, error);
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
        console.error(`更新ASIN ${asinId} 状态失败:`, updateError);
      }
    }
    throw error;
  }
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
  MAX_CONCURRENT_ASIN_CHECKS,
};
