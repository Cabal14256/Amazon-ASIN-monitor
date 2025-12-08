// backend/utils/spapi.js
const SellingPartnerAPI = require('amazon-sp-api');
const { pickRegion, pickCredsByRegion } = require('./regionCreds');

// 各站点 marketplaceId
const MARKETPLACE = {
  US:'ATVPDKIKX0DER',
  UK:'A1F83G8C2ARO7P',
  DE:'A1PA6795UKMFR9',
  FR:'A13V1IB3VIYZZH',
  IT:'APJ6JRA9NG5V4',
  ES:'A1RKKUPIHCS9HS',
};

/**
 * 按国家创建 SP-API 客户端
 * country: 'US' | 'UK' | 'DE' | 'FR' | 'IT' | 'ES'
 */
function makeSp(country = 'US') {
  // regionKey = 'US' 或 'EU'
  const regionKey = pickRegion(country);
  const creds = pickCredsByRegion(regionKey);

  if (!creds.clientId || !creds.clientSecret || !creds.refreshToken) {
    throw new Error(
      `[SP-API] 缺少凭据 region=${regionKey} ` +
      `clientId=${!!creds.clientId} secret=${!!creds.clientSecret} token=${!!creds.refreshToken}`
    );
  }

  // amazon-sp-api 库里 region 只能是 'na' | 'eu' | 'fe'
  const region = regionKey === 'EU' ? 'eu' : 'na';

  const sp = new SellingPartnerAPI({
    region,
    refresh_token: creds.refreshToken,
    credentials: {
      SELLING_PARTNER_APP_CLIENT_ID:     creds.clientId,
      SELLING_PARTNER_APP_CLIENT_SECRET: creds.clientSecret,
      AWS_ACCESS_KEY_ID:                 process.env.AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY:             process.env.AWS_SECRET_ACCESS_KEY,
      AWS_SELLING_PARTNER_ROLE:          process.env.SP_API_ROLE_ARN,
    },
    auto_request_tokens: true,
    auto_request_threshold: 60,
  });

  if (process.env.SP_DEBUG === '1') {
    console.log(
      `初始化 SP-API 客户端: country=${country}, region=${region}, lib=amazon-sp-api, id=${(creds.clientId || '').slice(0, 18)}…`
    );
  }

  return sp;
}

/**
 * 统一封装 getCatalogItem (v2022-04-01)
 * 👉 直接走 /catalog/2022-04-01/items/{asin}?marketplaceIds=ATV...&includedData=...
 *    避免 endpoint/operation 映射出问题导致 400 InvalidInput
 */
async function getCatalogItem(sp, asin, marketplaceId) {
  const upperAsin = String(asin || '').toUpperCase().trim();
  const mp        = String(marketplaceId || '').trim();

  if (!upperAsin || !mp) {
    throw new Error(`[SP-API] getCatalogItem 参数错误 asin=${upperAsin} marketplaceId=${mp}`);
  }

  try {
    const res = await sp.callAPI({
      // 直接使用文档里的路径
      api_path: `/catalog/2022-04-01/items/${encodeURIComponent(upperAsin)}`,
      method: 'GET',
      // 官方文档：marketplaceIds / includedData 是 comma-delimited csv
      // 这里直接用字符串，避免 SDK 把数组转成奇怪格式导致 InvalidInput
      query: {
        marketplaceIds: mp,
        // 只要我们真的用到的几类数据，越少越安全
        includedData: 'summaries,attributes,relationships,images,productTypes,identifiers',
      },
    });

    return res;
  } catch (e) {
    if (process.env.SP_DEBUG === '1') {
      const body = e?.response?.data;
      console.error(
        '[SP-API getCatalogItem] 调用失败:',
        e?.code || '',
        e?.message || e,
        body ? JSON.stringify(body) : ''
      );
    }
    throw e;
  }
}

module.exports = { makeSp, MARKETPLACE, getCatalogItem };
