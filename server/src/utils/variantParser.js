/**
 * 变体关系解析工具函数
 * 从SP-API响应中解析变体关系信息
 */

/**
 * 解析变体关系
 * @param {Object} item - SP-API返回的item对象
 * @param {string} asin - 当前ASIN（可选，如果item.asin存在则使用item.asin）
 * @returns {Object} 解析结果
 * @returns {Array<string>} variantASINs - 变体ASIN列表
 * @returns {string|null} parentASIN - 父ASIN
 * @returns {boolean} isChild - 是否为子变体
 * @returns {boolean} isParent - 是否为父变体
 * @returns {Array} variationRelations - 变体关系数组
 */
function parseVariantRelationships(item, asin = null) {
  const currentASIN = asin || item?.asin || '';
  const variantASINs = [];
  let parentASIN = null;
  let isChild = false;
  let isParent = false;
  const variationRelations = [];

  // 1) 优先解析 2022-04-01 relationships 结构
  if (Array.isArray(item.relationships)) {
    item.relationships.forEach((relByMarketplace) => {
      if (!relByMarketplace || !Array.isArray(relByMarketplace.relationships)) {
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
            const self = String(currentASIN || '')
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
            const self = String(currentASIN || '')
              .trim()
              .toUpperCase();
            if (v && v !== self) {
              variantASINs.push(v);
            }
          });

          if (!parentASIN) {
            parentASIN = String(currentASIN || '')
              .trim()
              .toUpperCase();
          }
        }
      });
    });
  }

  // 2) 兼容旧的 variations 结构（某些账号/旧版本可能还会返回）
  if (
    (!Array.isArray(item.relationships) || variationRelations.length === 0) &&
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
      const self = String(currentASIN || '')
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

  return {
    variantASINs,
    parentASIN: parentASIN ? String(parentASIN).trim().toUpperCase() : null,
    isChild,
    isParent,
    variationRelations,
  };
}

module.exports = {
  parseVariantRelationships,
};
