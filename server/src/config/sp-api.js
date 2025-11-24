require('dotenv').config();
const crypto = require('crypto');
const https = require('https');

// SP-API配置（支持从数据库读取）
let SP_API_CONFIG = {
  // LWA (Login with Amazon) 配置
  lwaClientId: process.env.SP_API_LWA_CLIENT_ID || '',
  lwaClientSecret: process.env.SP_API_LWA_CLIENT_SECRET || '',
  refreshToken: process.env.SP_API_REFRESH_TOKEN || '',

  // AWS IAM配置
  accessKeyId: process.env.SP_API_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.SP_API_SECRET_ACCESS_KEY || '',
  roleArn: process.env.SP_API_ROLE_ARN || '',

  // API端点（根据区域不同）
  endpoints: {
    US: 'https://sellingpartnerapi-na.amazon.com', // US区域
    EU: 'https://sellingpartnerapi-eu.amazon.com', // EU区域（包括UK、DE、FR、IT、ES）
  },

  // 区域映射
  regionMap: {
    US: 'us-east-1',
    UK: 'eu-west-1',
    DE: 'eu-west-1',
    FR: 'eu-west-1',
    IT: 'eu-west-1',
    ES: 'eu-west-1',
  },
};

// 从数据库加载配置
async function loadConfigFromDatabase() {
  try {
    const SPAPIConfig = require('../models/SPAPIConfig');
    const configs = await SPAPIConfig.getAllAsObject();

    // 更新配置（如果数据库中有值，优先使用数据库的值）
    if (configs.SP_API_LWA_CLIENT_ID) {
      SP_API_CONFIG.lwaClientId = configs.SP_API_LWA_CLIENT_ID;
    }
    if (configs.SP_API_LWA_CLIENT_SECRET) {
      SP_API_CONFIG.lwaClientSecret = configs.SP_API_LWA_CLIENT_SECRET;
    }
    if (configs.SP_API_REFRESH_TOKEN) {
      SP_API_CONFIG.refreshToken = configs.SP_API_REFRESH_TOKEN;
    }
    if (configs.SP_API_ACCESS_KEY_ID) {
      SP_API_CONFIG.accessKeyId = configs.SP_API_ACCESS_KEY_ID;
    }
    if (configs.SP_API_SECRET_ACCESS_KEY) {
      SP_API_CONFIG.secretAccessKey = configs.SP_API_SECRET_ACCESS_KEY;
    }
    if (configs.SP_API_ROLE_ARN) {
      SP_API_CONFIG.roleArn = configs.SP_API_ROLE_ARN;
    }

    console.log('✅ SP-API配置已从数据库加载');
  } catch (error) {
    console.error(
      '⚠️ 从数据库加载SP-API配置失败，使用环境变量:',
      error.message,
    );
  }
}

// 重新加载配置
async function reloadSPAPIConfig() {
  await loadConfigFromDatabase();
}

// 初始化时加载配置
loadConfigFromDatabase();

// 获取访问令牌 (Access Token)
async function getAccessToken() {
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: SP_API_CONFIG.refreshToken,
      client_id: SP_API_CONFIG.lwaClientId,
      client_secret: SP_API_CONFIG.lwaClientSecret,
    }).toString();

    const options = {
      hostname: 'api.amazon.com',
      path: '/auth/o2/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode === 200) {
          const response = JSON.parse(data);
          resolve(response.access_token);
        } else {
          reject(new Error(`获取访问令牌失败: ${res.statusCode} - ${data}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(postData);
    req.end();
  });
}

// AWS签名V4
function signRequest(
  method,
  url,
  headers,
  payload,
  accessKeyId,
  secretAccessKey,
  region,
  service,
) {
  const algorithm = 'AWS4-HMAC-SHA256';
  const now = new Date();
  const dateStamp = now.toISOString().substr(0, 10).replace(/-/g, '');
  const amzDate =
    now
      .toISOString()
      .replace(/[:-]|\.\d{3}/g, '')
      .substr(0, 15) + 'Z';

  // 解析URL
  const urlObj = new URL(url);
  const host = urlObj.hostname;
  const path = urlObj.pathname + (urlObj.search || '');

  // 规范请求
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((key) => `${key.toLowerCase()}:${headers[key].trim()}\n`)
    .join('');
  const signedHeaders = Object.keys(headers)
    .sort()
    .map((key) => key.toLowerCase())
    .join(';');
  const payloadHash = crypto
    .createHash('sha256')
    .update(payload || '')
    .digest('hex');
  const canonicalRequest = `${method}\n${path}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  // 创建签名字符串
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${crypto
    .createHash('sha256')
    .update(canonicalRequest)
    .digest('hex')}`;

  // 计算签名
  const kDate = crypto
    .createHmac('sha256', `AWS4${secretAccessKey}`)
    .update(dateStamp)
    .digest();
  const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
  const kService = crypto
    .createHmac('sha256', kRegion)
    .update(service)
    .digest();
  const kSigning = crypto
    .createHmac('sha256', kService)
    .update('aws4_request')
    .digest();
  const signature = crypto
    .createHmac('sha256', kSigning)
    .update(stringToSign)
    .digest('hex');

  // 授权头
  const authorization = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    authorization,
    'x-amz-date': amzDate,
  };
}

// 调用SP-API
async function callSPAPI(method, path, country, params = {}, body = null) {
  try {
    // 检查配置
    if (
      !SP_API_CONFIG.lwaClientId ||
      !SP_API_CONFIG.lwaClientSecret ||
      !SP_API_CONFIG.refreshToken
    ) {
      throw new Error('SP-API LWA配置不完整，请检查环境变量');
    }

    if (!SP_API_CONFIG.accessKeyId || !SP_API_CONFIG.secretAccessKey) {
      throw new Error('SP-API AWS配置不完整，请检查环境变量');
    }

    // 获取访问令牌
    const accessToken = await getAccessToken();

    // 确定端点和区域
    const region = SP_API_CONFIG.regionMap[country] || 'us-east-1';
    let endpoint = SP_API_CONFIG.endpoints.US;
    if (['UK', 'DE', 'FR', 'IT', 'ES'].includes(country)) {
      endpoint = SP_API_CONFIG.endpoints.EU;
    }

    // 构建URL
    const queryString = new URLSearchParams(params).toString();
    const url = `${endpoint}${path}${queryString ? '?' + queryString : ''}`;
    const urlObj = new URL(url);

    // 准备请求
    const payload = body ? JSON.stringify(body) : '';
    const headers = {
      host: urlObj.hostname,
      'x-amz-access-token': accessToken,
    };

    if (body) {
      headers['content-type'] = 'application/json';
    }

    // AWS签名
    const signatureHeaders = signRequest(
      method,
      url,
      headers,
      payload,
      SP_API_CONFIG.accessKeyId,
      SP_API_CONFIG.secretAccessKey,
      region,
      'execute-api',
    );

    // 合并头部
    const finalHeaders = {
      ...headers,
      ...signatureHeaders,
    };

    // 发送请求
    return new Promise((resolve, reject) => {
      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + (urlObj.search || ''),
        method: method,
        headers: finalHeaders,
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const response = data ? JSON.parse(data) : {};
              resolve(response);
            } catch (e) {
              resolve(data || {});
            }
          } else {
            const errorMsg = data || `HTTP ${res.statusCode}`;
            reject(
              new Error(`SP-API调用失败: ${res.statusCode} - ${errorMsg}`),
            );
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
  } catch (error) {
    console.error('SP-API调用错误:', error);
    throw error;
  }
}

module.exports = {
  SP_API_CONFIG,
  getAccessToken,
  callSPAPI,
  reloadSPAPIConfig,
  loadConfigFromDatabase,
};
