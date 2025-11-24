const { callSPAPI } = require('../config/sp-api');
const VariantGroup = require('../models/VariantGroup');
const ASIN = require('../models/ASIN');
const MonitorHistory = require('../models/MonitorHistory');

/**
 * 检查单个ASIN的变体关系
 * @param {string} asin - ASIN编码
 * @param {string} country - 国家代码
 * @returns {Promise<{hasVariants: boolean, variantCount: number, details: any}>}
 */
async function checkASINVariants(asin, country) {
  try {
    // 调用SP-API获取ASIN信息
    // 使用Catalog Items API v2022-04-01
    const path = `/catalog/2022-04-01/items/${asin}`;
    const marketplaceId = getMarketplaceId(country);
    const params = {
      marketplaceIds: marketplaceId,
      includedData: 'variations', // 包含变体信息
    };

    const response = await callSPAPI('GET', path, country, params);

    // 解析响应
    // SP-API返回格式: { items: [{ asin, variations: [...] }] }
    if (response && response.items && response.items.length > 0) {
      const item = response.items[0];

      // 检查是否有变体关系
      // variations字段包含变体信息，如果有则说明存在变体关系
      const variations = item.variations || [];
      const hasVariants = variations.length > 0;

      // 如果没有variations字段，尝试检查relationships中的VARIATION关系
      const relationships = item.relationships || [];
      const variationRelations = relationships.filter(
        (rel) => rel.type === 'VARIATION' || rel.type === 'VARIANT',
      );

      const finalHasVariants = hasVariants || variationRelations.length > 0;
      const variantCount = variations.length || variationRelations.length;

      return {
        hasVariants: finalHasVariants,
        variantCount,
        details: {
          asin: item.asin,
          title:
            item.summaries?.[0]?.title ||
            item.attributes?.item_name?.[0]?.value ||
            '',
          variations: variations.map((v) => ({
            asin: v.asin,
            title:
              v.summaries?.[0]?.title ||
              v.attributes?.item_name?.[0]?.value ||
              '',
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

    const checkResults = [];
    const brokenASINs = [];

    // 检查每个ASIN
    for (const asin of asins) {
      try {
        const result = await checkASINVariants(asin.asin, asin.country);
        const hasVariants = result.hasVariants;

        checkResults.push({
          asin: asin.asin,
          hasVariants,
          variantCount: result.variantCount,
        });

        // 如果没有变体，视为异常
        if (!hasVariants) {
          brokenASINs.push(asin.asin);
        }

        // 更新ASIN的变体状态
        await ASIN.updateVariantStatus(asin.id, !hasVariants);
      } catch (error) {
        console.error(`检查ASIN ${asin.asin} 失败:`, error);
        checkResults.push({
          asin: asin.asin,
          error: error.message,
        });
        brokenASINs.push(asin.asin);
      }
    }

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
