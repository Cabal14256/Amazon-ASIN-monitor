// backend/services/competitorMonitor.js
const { writeSnapshot } = require('./writeSnapshot');
const { getVariantData, getParentAsinFromVariations } = require('./variantMonitor'); // 复用

async function runCompetitorMonitor(targets = [], opts = {}) {
  if (!Array.isArray(targets) || !targets.length) return { ok: true, batch: null };
  const batch = opts.batch || Number(String(Date.now()).slice(0,10));

  for (const t of targets) {
    const country = String(t.country || '').toUpperCase().trim();
    const asin    = String(t.asin || '').trim();
    const site    = t.site || null;
    if (!country || !asin) continue;

    let hasVariation = false, amazonBrand = null, parent_title = null;

    try {
      const { variations = [], hasVariation: hv, brand } = await getVariantData(asin, country);
      hasVariation = !!hv;
      amazonBrand  = brand || null;
      parent_title = getParentAsinFromVariations(variations) || null;
    } catch (e) {
      console.error('[competitor] SP-API error:', country, asin, e?.message || e);
      hasVariation = false;
    }

    await writeSnapshot(
      { batch, country, site, brand: null, amazonBrand, asin, hasVariation, chain_type: null, parent_title },
      {
        snapConn: 'db3', histConn: 'db3',
        snapTable: 'snapshots',   // asin_competitor.snapshots（db3 已指库）
        histTable: 'history',
      }
    );
  }
  return { ok: true, batch };
}
module.exports = { runCompetitorMonitor };
