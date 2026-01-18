/**
 * 旧客户端（Legacy SP-API Client）备用方案
 *
 * 当标准 SP-API 调用失败时，可以使用此备用方案
 * 注意：此实现使用简化的请求方式，可能不适用于所有场景
 */

const https = require('https');
const {
  getAccessToken,
  getMarketplaceId,
  getRegionByCountry,
  SP_API_CONFIG,
} = require('../config/sp-api');
const logger = require('../utils/logger');
const rateLimiter = require('./rateLimiter');
const spApiScheduler = require('./spApiScheduler');
const operationIdentifier = require('./spApiOperationIdentifier');

/**
 * 使用旧客户端方式调用 SP-API
 * @param {string} method - HTTP方法
 * @param {string} path - API路径
 * @param {string} country - 国家代码
 * @param {object} params - 查询参数
 * @param {object} body - 请求体
 * @returns {Promise<any>} API响应
 */
async function callLegacySPAPI(
  method,
  path,
  country,
  params = {},
  body = null,
  options = {},
) {
  try {
    const region = getRegionByCountry(country);
    const regionConfig = SP_API_CONFIG.regionConfigs[region];

    if (
      !regionConfig ||
      !regionConfig.lwaClientId ||
      !regionConfig.lwaClientSecret ||
      !regionConfig.refreshToken
    ) {
      throw new Error(`Legacy SP-API ${region}区域的LWA配置不完整，请检查配置`);
    }

    const accessToken = await getAccessToken(region);
    logger.info(
      `[Legacy SP-API] ${region} 区域 Access Token 获取成功，长度: ${accessToken.length}`,
    );

    const endpoint = SP_API_CONFIG.endpoints[region];
    let url;
    if (path.includes('?')) {
      url = `${endpoint}${path}`;
    } else if (params && Object.keys(params).length > 0) {
      const queryParts = [];
      for (const [key, value] of Object.entries(params)) {
        if (Array.isArray(value)) {
          value.forEach((v) => {
            queryParts.push(`${key}=${encodeURIComponent(v)}`);
          });
        } else {
          queryParts.push(`${key}=${encodeURIComponent(value)}`);
        }
      }
      const queryString = queryParts.join('&');
      url = `${endpoint}${path}${queryString ? '?' + queryString : ''}`;
    } else {
      url = `${endpoint}${path}`;
    }

    logger.info(`[Legacy SP-API] 请求URL: ${url}`);
    logger.info(
      `[Legacy SP-API] 请求方法: ${method}, 国家: ${country}, 区域: ${region}`,
    );

    const urlObj = new URL(url);
    const payload = body ? JSON.stringify(body) : '';

    // 旧客户端使用更简单的请求头
    const headers = {
      'x-amz-access-token': accessToken,
      'user-agent': 'Amazon-ASIN-Monitor/1.0 (Language=Node.js)',
    };

    if (body) {
      headers['content-type'] = 'application/json';
    }

    logger.info(`[Legacy SP-API] 请求头:`, {
      'x-amz-access-token': headers['x-amz-access-token']
        ? `${headers['x-amz-access-token'].substring(0, 20)}...`
        : 'missing',
    });

    const operation = operationIdentifier.identifyOperation(method, path);
    const priority = options.priority || rateLimiter.PRIORITY.SCHEDULED;
    const scheduleOptions = {
      operation,
      region,
      method,
      path,
      priority,
    };

    const executeRequest = () =>
      new Promise((resolve, reject) => {
        const requestOptions = {
          hostname: urlObj.hostname,
          path: urlObj.pathname + (urlObj.search || ''),
          method: method,
          headers: headers,
        };

        const req = https.request(requestOptions, (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            logger.info(`[Legacy SP-API] 响应状态码: ${res.statusCode}`);
            logger.info(
              `[Legacy SP-API] 响应数据长度: ${data ? data.length : 0}`,
            );

            if (res.statusCode >= 200 && res.statusCode < 300) {
              try {
                const response = data ? JSON.parse(data) : {};
                logger.info(`[Legacy SP-API] 响应解析成功:`, {
                  hasItems: !!response.items,
                  itemsCount: response.items ? response.items.length : 0,
                  keys: Object.keys(response),
                });
                resolve(response);
              } catch (e) {
                logger.info(
                  `[Legacy SP-API] 响应解析失败，返回原始数据:`,
                  e.message,
                );
                resolve(data || {});
              }
            } else {
              const errorMsg = data || `HTTP ${res.statusCode}`;
              logger.error(`[Legacy SP-API] 请求失败:`, {
                statusCode: res.statusCode,
                errorMsg: errorMsg.substring(0, 500),
              });

              const error = new Error(
                `Legacy SP-API调用失败: ${res.statusCode} - ${errorMsg}`,
              );
              error.statusCode = res.statusCode;
              error.responseData = data;
              reject(error);
            }
          });
        });

        req.on('error', (error) => {
          reject(error);
        });

        if (payload) {
          req.write(payload);
        }
        req.end();
      });

    return spApiScheduler.schedule(async () => {
      await rateLimiter.acquire(region, 1, priority, operation);
      return executeRequest();
    }, scheduleOptions);
  } catch (error) {
    logger.error('[Legacy SP-API] 调用错误:', error);
    throw error;
  }
}

module.exports = {
  callLegacySPAPI,
};
