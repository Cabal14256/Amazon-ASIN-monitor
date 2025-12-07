/**
 * 批量变体检查服务
 * 使用SP-API的searchCatalogItems接口进行批量查询，减少API调用次数
 *
 * 策略：
 * 1. 使用searchCatalogItems批量获取summary信息（验证ASIN是否存在、获取基础信息）
 * 2. 对于有变体的ASIN，再调用getCatalogItem获取详细信息
 * 3. 注意限流：searchCatalogItems rate = 2 req/s, burst = 2
 */

const { callSPAPI, getMarketplaceId } = require('../config/sp-api');
const rateLimiter = require('./rateLimiter');
const operationIdentifier = require('./spApiOperationIdentifier');
const logger = require('../utils/logger');
const { parseVariantRelationships } = require('../utils/variantParser');

// searchCatalogItems的rate limit: 2 req/s, burst = 2
const BATCH_SEARCH_RATE_LIMIT_PER_SECOND = 2;
const BATCH_SEARCH_BURST = 2;

/**
 * 批量查询ASIN的变体信息（使用searchCatalogItems）
 * @param {Array<string>} asins - ASIN列表
 * @param {string} country - 国家代码
 * @returns {Promise<Map<string, {asin: string, hasVariants: boolean, parentAsin: string|null}>>}
 * 返回Map，key为ASIN，value为查询结果
 */
async function batchCheckASINsBySearch(asins, country) {
  if (!asins || asins.length === 0) {
    return new Map();
  }

  const marketplaceId = getMarketplaceId(country);
  const region = country === 'US' ? 'US' : 'EU';

  // 清理和验证ASIN列表
  const cleanASINs = asins
    .map((asin) =>
      String(asin || '')
        .trim()
        .toUpperCase(),
    )
    .filter((asin) => asin && /^[A-Z0-9]{10}$/.test(asin));

  if (cleanASINs.length === 0) {
    return new Map();
  }

  logger.info(
    `[batchCheckASINsBySearch] 批量查询 ${cleanASINs.length} 个ASIN，国家: ${country}`,
  );

  const results = new Map();
  const apiVersion = '2022-04-01';

  // searchCatalogItems使用POST方法，body包含identifiers数组
  // 注意：SP-API可能限制单次查询的ASIN数量，需要分批处理
  const BATCH_SIZE = 20; // 每批最多20个ASIN（根据SP-API限制调整）

  for (let i = 0; i < cleanASINs.length; i += BATCH_SIZE) {
    const batchASINs = cleanASINs.slice(i, i + BATCH_SIZE);

    try {
      // 构建searchCatalogItems的请求体
      // 根据SP-API文档，searchCatalogItems使用POST，body包含identifiers数组
      const identifiers = batchASINs.map((asin) => ({
        identifiers: ['ASIN'],
        marketplaceIds: [marketplaceId],
        asin: asin,
      }));

      const path = `/catalog/${apiVersion}/items`;
      const body = {
        identifiers: identifiers,
        marketplaceIds: [marketplaceId],
        includedData: ['summaries', 'relationships'], // 获取summary和relationships，用于判断变体
      };

      // 识别operation
      const operation = operationIdentifier.identifyOperation('POST', path);
      logger.info(
        `[batchCheckASINsBySearch] 查询批次 ${
          Math.floor(i / BATCH_SIZE) + 1
        }，ASIN数量: ${batchASINs.length}，operation: ${
          operation || 'unknown'
        }`,
      );

      // 通过令牌桶获取令牌（使用operation级别的限流器）
      await rateLimiter.acquire(
        region,
        1,
        rateLimiter.PRIORITY.BATCH,
        operation,
      );

      // 调用searchCatalogItems（POST方法），传递operation参数
      const response = await callSPAPI('POST', path, country, {}, body, {
        operation: operation,
        maxRetries: 3,
      });

      if (response && response.items) {
        // 处理返回的items
        for (const item of response.items) {
          const asin = item.asin?.toUpperCase();
          if (!asin) continue;

          // ========= 从 relationships 里判断是否有变体 =========
          const {
            variantASINs,
            parentASIN: parentAsin,
            isChild,
            isParent,
          } = parseVariantRelationships(item, asin);

          const hasVariants = variantASINs.length > 0 || isChild || isParent;

          results.set(asin, {
            asin: asin,
            hasVariants,
            parentAsin,
            source: 'batch_search',
          });
        }
      }

      // 处理未返回的ASIN（可能不存在或查询失败）
      for (const asin of batchASINs) {
        if (!results.has(asin)) {
          results.set(asin, {
            asin: asin,
            hasVariants: false,
            parentAsin: null,
            source: 'batch_search',
            notFound: true,
          });
        }
      }
    } catch (error) {
      logger.error(`[batchCheckASINsBySearch] 批次查询失败:`, error.message);
      // 批次失败，标记所有ASIN为查询失败
      for (const asin of batchASINs) {
        results.set(asin, {
          asin: asin,
          hasVariants: false,
          parentAsin: null,
          errorType: 'SP_API_ERROR',
          source: 'batch_search',
          error: '批量查询失败',
          errorMessage: error.message,
        });
      }
    }
  }

  return results;
}

/**
 * 混合策略：先用searchCatalogItems批量获取summary，再对需要的ASIN调用getCatalogItem
 * @param {Array<string>} asins - ASIN列表
 * @param {string} country - 国家代码
 * @returns {Promise<Array<{asin: string, hasVariants: boolean, variantCount: number, details: any}>>}
 */
async function batchCheckASINsHybrid(asins, country) {
  // 第一步：使用searchCatalogItems批量获取summary
  const searchResultsMap = await batchCheckASINsBySearch(asins, country);

  // 第二步：对于有变体的ASIN（或查询失败的ASIN），使用getCatalogItem获取详细信息
  const { checkASINVariants } = require('./variantCheckService');
  const detailedResults = [];

  for (const asin of asins) {
    const cleanASIN = String(asin || '')
      .trim()
      .toUpperCase();
    const searchResult = searchResultsMap.get(cleanASIN);

    if (!searchResult) {
      // 未找到结果，标记为错误
      detailedResults.push({
        asin: cleanASIN,
        hasVariants: false,
        variantCount: 0,
        errorType: 'SP_API_ERROR',
        details: {
          asin: cleanASIN,
          error: '批量查询未返回结果',
        },
      });
      continue;
    }

    if (searchResult.errorType === 'SP_API_ERROR' || searchResult.hasVariants) {
      // 需要详细信息，调用getCatalogItem
      try {
        const detailed = await checkASINVariants(cleanASIN, country, false);
        detailedResults.push(detailed);
      } catch (error) {
        // 如果详细查询也失败，使用批量查询的结果
        detailedResults.push({
          asin: cleanASIN,
          hasVariants: searchResult.hasVariants,
          variantCount: 0,
          errorType: searchResult.errorType || 'SP_API_ERROR',
          details: {
            asin: cleanASIN,
            parentAsin: searchResult.parentAsin,
            source: 'batch_search_fallback',
            error: '详细查询失败',
            errorMessage: error.message,
          },
        });
      }
    } else {
      // 无变体，直接使用批量查询结果
      detailedResults.push({
        asin: cleanASIN,
        hasVariants: false,
        variantCount: 0,
        errorType: 'NO_VARIANTS',
        details: {
          asin: cleanASIN,
          parentAsin: null,
          source: 'batch_search',
        },
      });
    }
  }

  return detailedResults;
}

module.exports = {
  batchCheckASINsBySearch,
  batchCheckASINsHybrid,
  BATCH_SEARCH_RATE_LIMIT_PER_SECOND,
  BATCH_SEARCH_BURST,
};
