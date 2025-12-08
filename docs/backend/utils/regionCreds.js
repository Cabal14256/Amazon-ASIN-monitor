// backend/utils/regionCreds.js
const REGION_BY_COUNTRY = { US:'US', UK:'EU', DE:'EU', FR:'EU', IT:'EU', ES:'EU' };

function pickRegion(country='US') {
  return REGION_BY_COUNTRY[country] || 'US';
}

function pickCredsByRegion(region) {
  const R = String(region || 'US').toUpperCase(); // US / EU

  return {
    clientId:     process.env[`SP_API_CLIENT_ID_${R}`]     || process.env.SP_API_CLIENT_ID     || '',
    clientSecret: process.env[`SP_API_CLIENT_SECRET_${R}`] || process.env.SP_API_CLIENT_SECRET || '',
    refreshToken: process.env[`SP_API_TOKENS_${R}`]        || process.env.SP_API_TOKENS        || '',
    region: R,
  };
}

module.exports = { pickRegion, pickCredsByRegion };
