#!/usr/bin/env node
/**
 * EU SP-API 健康自检脚本
 * 用法：
 *   node backend/scripts/test-eu-spapi.js
 *   node backend/scripts/test-eu-spapi.js --asin B0XXXXXXX --country DE
 *
 * 说明：
 *  - 第一步：Sellers.getMarketplaceParticipations（仅验证 EU 区域授权是否可用）
 *  - 第二步（可选）：CatalogItems.getCatalogItem（验证你业务使用的接口）
 */

require('dotenv').config();
const SellingPartnerAPI = require('amazon-sp-api');

const argv = require('node:process').argv.slice(2);
const args = Object.fromEntries(
  argv.map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
  })
);

// ========= 配置区（沿用你现有的 env 变量） =========
const commonCredentials = {
  SELLING_PARTNER_APP_CLIENT_ID: process.env.SP_API_CLIENT_ID,
  SELLING_PARTNER_APP_CLIENT_SECRET: process.env.SP_API_CLIENT_SECRET,
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
  role_arn: process.env.SP_API_ROLE_ARN,
};

// 你项目里 EU 各国共享 refresh_token（SP_API_TOKENS_EU），按需调整
const marketConfigs = {
  UK: { region: 'eu', marketplaceIds: [process.env.SP_API_MARKETPLACE_IDS_UK] },
  DE: { region: 'eu', marketplaceIds: [process.env.SP_API_MARKETPLACE_IDS_DE] },
  FR: { region: 'eu', marketplaceIds: [process.env.SP_API_MARKETPLACE_IDS_FR] },
  IT: { region: 'eu', marketplaceIds: [process.env.SP_API_MARKETPLACE_IDS_IT] },
  ES: { region: 'eu', marketplaceIds: [process.env.SP_API_MARKETPLACE_IDS_ES] },
};
const EU_REFRESH_TOKEN = process.env.SP_API_TOKENS_EU;

// ========= 工具函数 =========
function title(s) {
  console.log('\n' + '='.repeat(8) + ' ' + s + ' ' + '='.repeat(8));
}

function makeClient(region) {
  return new SellingPartnerAPI({
    region,
    refresh_token: EU_REFRESH_TOKEN,
    credentials: commonCredentials,
    auto_request_tokens: true,
    auto_request_threshold: 60,
    rate_limit: { retry: true, retry_count: 2, retry_delay: 1500 },
  });
}

function prettyError(e) {
  if (!e) return 'Unknown error';
  const parts = [];
  if (e.name) parts.push(e.name);
  if (e.code) parts.push(`code=${e.code}`);
  if (e.statusCode) parts.push(`status=${e.statusCode}`);
  if (e.message) parts.push(e.message);
  if (e.details) parts.push(JSON.stringify(e.details));
  return parts.join(' | ');
}

// ========= Step 1：验证 EU 授权 =========
async function testAuthEU() {
  title('Step 1: EU 授权健康检查 (Sellers.getMarketplaceParticipations)');
  try {
    const sp = makeClient('eu');
    const data = await sp.callAPI({
      operation: 'getMarketplaceParticipations',
      endpoint: 'sellers',
    });
    console.log('? 授权可用。返回 marketplaces:');
    console.log(JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    console.error('? 授权失败：', prettyError(e));
    console.error('可能原因：开发者账号停用 / 角色未授权 / 刷新令牌失效。');
    return false;
  }
}

// ========= Step 2：可选，用 ASIN 真实拉一次 =========
async function testCatalogItem(country, asin) {
  const cfg = marketConfigs[country];
  if (!cfg || !asin) {
    console.log('（跳过 Step 2，无 country/asin 参数）');
    return;
  }
  title(`Step 2: Catalog.getCatalogItem 实测 (${country}, ${asin})`);
  try {
    const sp = makeClient(cfg.region);
    const result = await sp.callAPI({
      operation: 'getCatalogItem',
      endpoint: 'catalogItems',
      path: { asin },
      query: {
        marketplaceIds: cfg.marketplaceIds,
        includedData: ['variations', 'attributes'],
      },
    });
    console.log('? getCatalogItem 成功：');
    const brief = {
      asin: asin,
      hasVariations: !!(result?.variations && result.variations.length),
      brand: result?.attributes?.brand?.[0] || result?.attributes?.brand || null,
      // 只展示少量关键字段，避免太长
    };
    console.log(JSON.stringify(brief, null, 2));
  } catch (e) {
    console.error('? getCatalogItem 失败：', prettyError(e));
    console.error('如果 Step 1 成功但这里失败，多半是 marketplaceId/权限范围问题。');
  }
}

// ========= 主流程 =========
(async () => {
  const ok = await testAuthEU();

  // 带参才跑第二步：--asin B0XXXXX --country DE|UK|FR|IT|ES
  const asin = typeof args.asin === 'string' ? args.asin.toUpperCase() : null;
  const countryRaw = typeof args.country === 'string' ? args.country.toUpperCase() : null;
  if (asin && countryRaw) {
    await testCatalogItem(countryRaw, asin);
  }

  console.log('\n检查完成。EU 授权：' + (ok ? '可用 ?' : '不可用 ?'));
  process.exit(ok ? 0 : 1);
})();
