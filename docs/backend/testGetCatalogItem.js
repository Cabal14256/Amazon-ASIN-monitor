// testGetCatalogItemUK.js
require('dotenv').config();
const SellingPartnerAPI = require('amazon-sp-api');

const sp = new SellingPartnerAPI({
  region: 'eu',  // 英国也是 eu 区
  refresh_token: process.env.SP_API_TOKENS_EU,
  credentials: {
    SELLING_PARTNER_APP_CLIENT_ID: process.env.SP_API_CLIENT_ID,
    SELLING_PARTNER_APP_CLIENT_SECRET: process.env.SP_API_CLIENT_SECRET,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    role_arn: process.env.SP_API_ROLE_ARN,
  },
});

async function run() {
  try {
    const result = await sp.callAPI({
      operation: 'getCatalogItem',
      endpoint: 'catalogItems',
      path: { asin: 'B0F632CZC1' },   // 这里填一个你 UK 有的 ASIN
      query: {
        marketplaceIds: ['A1F83G8C2ARO7P'], // 只传 UK
        includedData: ['variations', 'attributes']
      }
    });
    console.log('UK 结果:', JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('UK 失败:', err);
  }
}

run();
