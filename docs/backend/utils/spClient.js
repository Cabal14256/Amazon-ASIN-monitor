// utils/spClient.js 里补充/替换

const axios = require('axios');
const { pickRegion, pickCredsByRegion } = require('./regionCreds');

const MARKETPLACE = { US:'ATVPDKIKX0DER', UK:'A1F83G8C2ARO7P', DE:'A1PA6795UKMFR9', FR:'A13V1IB3VIYZZH', IT:'APJ6JRA9NG5V4', ES:'A1RKKUPIHCS9HS' };
const DOMAINS     = { US:'www.amazon.com', UK:'www.amazon.co.uk', DE:'www.amazon.de', FR:'www.amazon.fr', IT:'www.amazon.it', ES:'www.amazon.es' };

function normalizeParent(parent, asin) {
  if (parent == null) return null;
  const p = String(parent).trim();
  if (!p) return null;
  const a = String(asin).trim();
  if (p.toUpperCase() === a.toUpperCase()) return null; // 父体=自身 → 置空
  return p;
}

// 兜底：HTML 抓取 parentAsin
async function scrapeParentAsin(asin, country='US') {
  const host = DOMAINS[country] || DOMAINS.US;
  const url = `https://${host}/dp/${String(asin).toUpperCase()}?psc=1`;
  try {
    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 15000,
      proxy: false,
    });

    const raw =
      data.match(/"parentAsin"\s*:\s*"([^"]+)"/i)?.[1] ||
      data.match(/"parent_asin"\s*:\s*"([^"]+)"/i)?.[1] ||
      data.match(/data-asin-parent="([^"]+)"/i)?.[1] ||
      data.match(/"twisterJsInit".*?"parentAsin"\s*:\s*"([^"]+)"/i)?.[1] ||
      data.match(/"variationDisplayData".*?"parentAsin"\s*:\s*"([^"]+)"/i)?.[1] ||
      null;

    return normalizeParent(raw, asin);
  } catch {
    return null;
  }
}

// 创建 amazon-sp-api 客户端
function makeClient(country='US') {
  const region = pickRegion(country);                 // US/EU
  const creds  = pickCredsByRegion(region);           // 拿到对应区的 clientId/secret/token
  const marketplaceId = MARKETPLACE[country] || MARKETPLACE.US;

  const { SellingPartner } = require('amazon-sp-api');  // ✅ 这个包叫 amazon-sp-api
  const sp = new SellingPartner({
    region: region === 'EU' ? 'eu' : 'na',
    refresh_token: creds.refreshToken,
    credentials: {
      SELLING_PARTNER_APP_CLIENT_ID:     creds.clientId,
      SELLING_PARTNER_APP_CLIENT_SECRET: creds.clientSecret,
      AWS_ACCESS_KEY_ID:                 process.env.AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY:             process.env.AWS_SECRET_ACCESS_KEY,
      AWS_SELLING_PARTNER_ROLE:          process.env.SP_API_ROLE_ARN,
    }
  });

  if (process.env.SP_DEBUG === '1') {
    console.log(`初始化 SP-API 客户端: country=${country}, region=${sp.region}, lib=amazon-sp-api, id=${(creds.clientId||'').slice(0,18)}…`);
  }

  return { sp, marketplaceId };
}

// 先 SP-API → 再 HTML 兜底
async function getParentAndStatus(asin, country='US') {
  const upper = String(asin).toUpperCase();
  let parent = null;

  try {
    const { sp, marketplaceId } = makeClient(country);

    const res = await sp.callAPI({
      endpoint:  'catalogItems',
      operation: 'getCatalogItem',
      path:      { asin: upper },
      query:     { marketplaceIds: [marketplaceId], includedData: ['summaries','variations','attributes'] }
    });

    // 1) summaries
    parent = res?.summaries?.[0]?.parentAsin || null;

    // 2) variations 兜底
    if (!parent && Array.isArray(res?.variations)) {
      for (const v of res.variations) {
        const vt = String(v?.variationType || v?.type || '').toUpperCase();
        if (vt === 'PARENT') {
          const idAsin =
            v?.identifiers?.find(i => i?.marketplaceId === marketplaceId)?.asin ||
            v?.identifiers?.[0]?.asin || null;
          if (idAsin) { parent = idAsin; break; }
        }
        if (!parent && Array.isArray(v?.relationships)) {
          const p = v.relationships.find(x => String(x?.type).toUpperCase() === 'PARENT' && x?.asin);
          if (p?.asin) { parent = p.asin; break; }
        }
        if (!parent && vt === 'PARENT' && v?.asin) { parent = v.asin; break; }
      }
    }

    // 3) 顶层 relationships（极少数）
    if (!parent && Array.isArray(res?.relationships)) {
      const p = res.relationships.find(x => String(x?.type).toUpperCase() === 'PARENT' && x?.asin);
      if (p?.asin) parent = p.asin;
    }

    parent = normalizeParent(parent, upper);

  } catch (e) {
    if (process.env.SP_DEBUG === '1') {
      console.warn('[SP] error:', e?.code || e?.name || '', e?.message || e);
    }
  }

  // 4) 如果 SP-API 还没拿到，就走 HTML 兜底
  if (!parent) {
    const scraped = await scrapeParentAsin(upper, country);
    parent = normalizeParent(scraped, upper);
  }

  return { parent_asin: parent, is_broken: parent ? 0 : 1 };
}

module.exports = { getParentAndStatus };
