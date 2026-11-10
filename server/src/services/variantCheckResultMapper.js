const { applyParentTitleGate } = require('../utils/variantTitle');

function buildVariantViewFromResult(serviceResult) {
  if (!serviceResult || typeof serviceResult !== 'object') {
    return {
      asin: null,
      title: '',
      hasVariation: false,
      isBroken: true,
      parentAsin: null,
      brotherAsins: [],
      brand: null,
      raw: serviceResult || null,
    };
  }

  const { isBroken, details } = serviceResult;
  const nestedResult =
    details &&
    typeof details === 'object' &&
    (details.details || typeof details.hasVariants === 'boolean')
      ? details
      : serviceResult;
  const d = nestedResult.details || {};

  const asin = (d.asin || '').toString().trim().toUpperCase();
  const title = d.title || '';

  const variations = Array.isArray(d.variations)
    ? d.variations.map((variation) => ({
        asin: (variation.asin || '').toString().trim().toUpperCase(),
        title: variation.title || '',
      }))
    : [];

  const brotherAsins = variations
    .map((variation) => variation.asin)
    .filter((variationAsin) => variationAsin && variationAsin !== asin);

  const relationships = Array.isArray(d.relationships) ? d.relationships : [];
  let parentAsin = d.parentAsin
    ? d.parentAsin.toString().trim().toUpperCase()
    : null;

  for (const rel of relationships) {
    if (parentAsin) {
      break;
    }

    if (Array.isArray(rel.parentAsins) && rel.parentAsins.length > 0) {
      parentAsin = (rel.parentAsins[0] || '').toString().trim().toUpperCase();
      if (parentAsin) {
        break;
      }
    }

    if (
      (rel.type === 'PARENT' || rel.relationshipType === 'PARENT') &&
      (rel.asin || rel.parentAsin)
    ) {
      parentAsin = (rel.asin || rel.parentAsin || '')
        .toString()
        .trim()
        .toUpperCase();
      if (parentAsin) {
        break;
      }
    }
  }

  const derivedHasVariation = brotherAsins.length > 0 || Boolean(parentAsin);
  const serviceHasVariants =
    typeof nestedResult.hasVariants === 'boolean'
      ? nestedResult.hasVariants
      : derivedHasVariation;
  const hasVariation = applyParentTitleGate(
    serviceHasVariants,
    parentAsin,
    d.parentTitle,
  );

  const brand = d.brand || null;

  return {
    asin,
    title,
    hasVariation,
    isBroken: typeof isBroken === 'boolean' ? isBroken : !hasVariation,
    parentAsin,
    brotherAsins,
    brand,
    raw: serviceResult,
  };
}

function mapVariantGroupResultWithVariantView(result) {
  let mappedResults = result?.details?.results;

  if (!Array.isArray(mappedResults)) {
    return result;
  }

  mappedResults = mappedResults.map((item) => {
    if (!item || typeof item !== 'object') {
      return item;
    }

    return {
      ...item,
      variantView: buildVariantViewFromResult({
        isBroken: item.isBroken,
        details: item.details,
      }),
    };
  });

  return {
    ...result,
    details: {
      ...(result?.details || {}),
      results: mappedResults || result?.details?.results || [],
    },
  };
}

module.exports = {
  buildVariantViewFromResult,
  mapVariantGroupResultWithVariantView,
};
