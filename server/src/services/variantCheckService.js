const { callSPAPI } = require('../config/sp-api');
const VariantGroup = require('../models/VariantGroup');
const ASIN = require('../models/ASIN');
const MonitorHistory = require('../models/MonitorHistory');

/**
 * 每次最多同时检查的 ASIN 数（满足一次检查并发 5 个的要求）
 */
const MAX_CONCURRENT_ASIN_CHECKS = 5;

/**
 * 检查单个ASIN的变体关系
 * @param {string} asin - ASIN编码
 * @param {string} country - 国家代码
 * @returns {Promise<{hasVariants: boolean, variantCount: number, details: any}>}
 */
async function checkASINVariants(asin, country) {
  try {
    // 调用SP-API获取ASIN信息
    // 尝试使用Catalog Items API v2020-12-01（更稳定的版本）
    // 根据SP-API文档，getItem端点需要marketplaceIds作为查询参数
    const marketplaceId = getMarketplaceId(country);

    // 先尝试使用v2020-12-01版本
    let path = `/catalog/2020-12-01/items/${asin}`;
    let apiVersion = '2020-12-01';

    // 根据SP-API文档，Catalog Items API的getItem端点
    // marketplaceIds是必需参数（数组格式），includedData是可选的
    // 直接请求variations数据，避免二次请求
    const params = {
      marketplaceIds: [marketplaceId], // 使用数组格式
      includedData: ['variations'], // 显式请求variations数据
    };

    console.log(
      `[checkASINVariants] 调用SP-API检查ASIN ${asin}，国家: ${country}，Marketplace ID: ${marketplaceId}`,
    );
    console.log(`[checkASINVariants] API版本: ${apiVersion}`);
    console.log(`[checkASINVariants] 参数:`, params);

    let response;
    try {
      // 直接请求包含variations的数据
      response = await callSPAPI('GET', path, country, params);
    } catch (error) {
      // 如果失败，尝试使用v2022-04-01版本
      if (error.message && error.message.includes('400')) {
        console.log(
          `[checkASINVariants] v2020-12-01失败，尝试使用v2022-04-01版本...`,
        );
        path = `/catalog/2022-04-01/items/${asin}`;
        apiVersion = '2022-04-01';
        response = await callSPAPI('GET', path, country, params);
      } else {
        throw error;
      }
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

      return {
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
            title: '', // SP-API variations响应中不包含title，需要单独查询
          })),
          relationships: variationRelations,
        },
      };
    }

    // 如果没有找到变体，返回无变体
    return {
      hasVariants: false,
      variantCount: 0,
      details: {
        asin,
        message: '未找到变体信息',
      },
    };
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

    // 记录监控历史
    await MonitorHistory.create({
      variantGroupId,
      checkType: 'GROUP',
      country: group.country,
      isBroken: isBroken ? 1 : 0,
      checkTime: new Date(),
      checkResult: JSON.stringify({
        totalASINs: asins.length,
        brokenCount: brokenASINs.length,
        results: checkResults,
      }),
    });

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
  try {
    const asin = await ASIN.findById(asinId);
    if (!asin) {
      throw new Error('ASIN不存在');
    }

    const result = await checkASINVariants(asin.asin, asin.country);
    const isBroken = !result.hasVariants;

    // 更新ASIN状态
    await ASIN.updateVariantStatus(asinId, isBroken);

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
    throw error;
  }
}

/**
 * 获取Marketplace ID
 * @param {string} country - 国家代码
 * @returns {string} Marketplace ID
 */
function getMarketplaceId(country) {
  const marketplaceMap = {
    US: 'ATVPDKIKX0DER', // 美国
    UK: 'A1F83G8C2ARO7P', // 英国 (EU)
    DE: 'A1PA6795UKMFR9', // 德国 (EU)
    FR: 'A13V1IB3VIYZZH', // 法国 (EU)
    IT: 'APJ6JRA9NG5V4', // 意大利 (EU)
    ES: 'A1RKKUPIHCS9HS', // 西班牙 (EU)
  };
  return marketplaceMap[country] || marketplaceMap.US;
}

module.exports = {
  checkASINVariants,
  checkVariantGroup,
  checkSingleASIN,
  getMarketplaceId,
};
