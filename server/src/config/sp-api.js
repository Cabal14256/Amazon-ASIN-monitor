require('dotenv').config();
const crypto = require('crypto');
const https = require('https');
const SPAPIConfig = require('../models/SPAPIConfig');

const COUNTRY_REGION_MAP = {
  US: 'US',
  UK: 'EU',
  DE: 'EU',
  FR: 'EU',
  IT: 'EU',
  ES: 'EU',
};

const REGION_SETTINGS = {
  US: {
    endpoint: 'https://sellingpartnerapi-na.amazon.com',
    awsRegion: 'us-east-1',
    envSuffix: 'US',
  },
  EU: {
    endpoint: 'https://sellingpartnerapi-eu.amazon.com',
    awsRegion: 'eu-west-1',
    envSuffix: 'EU',
  },
};

const REGION_FIELD_SPECS = {
  lwaClientId: 'LWA_CLIENT_ID',
  lwaClientSecret: 'LWA_CLIENT_SECRET',
  refreshToken: 'REFRESH_TOKEN',
};

const GLOBAL_AWS_FIELD_SPECS = {
  accessKeyId: 'ACCESS_KEY_ID',
  secretAccessKey: 'SECRET_ACCESS_KEY',
  roleArn: 'ROLE_ARN',
};

// 初始化配置（先从环境变量读取）
let SP_API_CONFIG = {
  regionConfigs: {
    US: buildRegionConfig('US'),
    EU: buildRegionConfig('EU'),
  },
  aws: buildGlobalAWSConfig(),
  endpoints: {
    US: REGION_SETTINGS.US.endpoint,
    EU: REGION_SETTINGS.EU.endpoint,
  },
  regionMap: COUNTRY_REGION_MAP,
};

const ACCESS_TOKEN_CACHE = {
  US: null,
  EU: null,
};

function buildRegionConfig(region) {
  const suffix = REGION_SETTINGS[region]?.envSuffix || region;
  const fallbackPrefix = 'SP_API_';
  const result = {};
  for (const [fieldKey, fieldSuffix] of Object.entries(REGION_FIELD_SPECS)) {
    const envKey = `SP_API_${suffix}_${fieldSuffix}`;
    const fallbackEnvKey = `${fallbackPrefix}${fieldSuffix}`;
    result[fieldKey] = process.env[envKey] || process.env[fallbackEnvKey] || '';
  }
  result.accessKeyId = '';
  result.secretAccessKey = '';
  result.roleArn = '';
  return result;
}

function buildGlobalAWSConfig() {
  const result = {};
  const fallbackPrefix = 'SP_API_';
  for (const [fieldKey, fieldSuffix] of Object.entries(
    GLOBAL_AWS_FIELD_SPECS,
  )) {
    const envKey = `${fallbackPrefix}${fieldSuffix}`;
    result[fieldKey] = process.env[envKey] || '';
  }
  return result;
}

// USE_AWS_SIGNATURE 配置（默认 false，简化模式）
let USE_AWS_SIGNATURE = false;

/**
 * 从数据库或环境变量加载 USE_AWS_SIGNATURE 配置
 */
async function loadUseAwsSignatureConfig() {
  try {
    const config = await SPAPIConfig.findByKey('SP_API_USE_AWS_SIGNATURE');
    if (
      config &&
      config.config_value !== null &&
      config.config_value !== undefined
    ) {
      USE_AWS_SIGNATURE =
        config.config_value === 'true' ||
        config.config_value === true ||
        config.config_value === '1';
    } else {
      // 从环境变量读取
      USE_AWS_SIGNATURE =
        process.env.SP_API_USE_AWS_SIGNATURE === 'true' ||
        process.env.SP_API_USE_AWS_SIGNATURE === '1';
    }
    console.log(
      `[SP-API配置] USE_AWS_SIGNATURE: ${USE_AWS_SIGNATURE} (${
        USE_AWS_SIGNATURE ? '启用AWS签名' : '简化模式，无需AWS签名'
      })`,
    );
  } catch (error) {
    console.error(
      '[SP-API配置] 加载 USE_AWS_SIGNATURE 配置失败:',
      error.message,
    );
    USE_AWS_SIGNATURE = false; // 默认使用简化模式
  }
}

/**
 * 获取当前 USE_AWS_SIGNATURE 配置值
 */
function getUseAwsSignature() {
  return USE_AWS_SIGNATURE;
}

// 从数据库加载配置
async function loadConfigFromDatabase() {
  try {
    const configs = await SPAPIConfig.findAll();
    const configMap = {};
    configs.forEach((item) => {
      if (item.config_key) {
        configMap[item.config_key] = item.config_value;
      }
    });

    // 加载 USE_AWS_SIGNATURE 配置
    await loadUseAwsSignatureConfig();

    const awsConfig = {};
    for (const [fieldKey, fieldSuffix] of Object.entries(
      GLOBAL_AWS_FIELD_SPECS,
    )) {
      const key = `SP_API_${fieldSuffix}`;
      awsConfig[fieldKey] = configMap[key] || SP_API_CONFIG.aws[fieldKey] || '';
    }
    SP_API_CONFIG.aws = awsConfig;

    for (const region of Object.keys(REGION_SETTINGS)) {
      const regionConfig = buildRegionConfig(region);
      for (const [fieldKey, fieldSuffix] of Object.entries(
        REGION_FIELD_SPECS,
      )) {
        const regionKey = `SP_API_${REGION_SETTINGS[region].envSuffix}_${fieldSuffix}`;
        const fallbackKey = `SP_API_${fieldSuffix}`;
        const value =
          configMap[regionKey] ||
          configMap[fallbackKey] ||
          regionConfig[fieldKey];
        if (value) {
          regionConfig[fieldKey] = value;
        }
      }

      for (const [fieldKey, fieldSuffix] of Object.entries(
        GLOBAL_AWS_FIELD_SPECS,
      )) {
        const regionKey = `SP_API_${REGION_SETTINGS[region].envSuffix}_${fieldSuffix}`;
        const fallbackKey = `SP_API_${fieldSuffix}`;
        const value =
          configMap[regionKey] ||
          configMap[fallbackKey] ||
          SP_API_CONFIG.aws[fieldKey] ||
          '';
        if (value) {
          regionConfig[fieldKey] = value;
        }
      }

      SP_API_CONFIG.regionConfigs[region] = regionConfig;
    }

    clearAccessTokenCache();
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
async function getAccessToken(region) {
  const normalizedRegion = normalizeRegion(region);
  const regionConfig = SP_API_CONFIG.regionConfigs[normalizedRegion];
  if (!regionConfig) {
    throw new Error(`无效的SP-API区域配置: ${region}`);
  }

  if (
    !regionConfig.lwaClientId ||
    !regionConfig.lwaClientSecret ||
    !regionConfig.refreshToken
  ) {
    throw new Error(
      `SP-API ${normalizedRegion}区域的LWA配置不完整，请检查配置`,
    );
  }

  const cached = ACCESS_TOKEN_CACHE[normalizedRegion];
  if (cached && cached.expiresAt && Date.now() < cached.expiresAt) {
    return cached.token;
  }

  const postData = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: regionConfig.refreshToken,
    client_id: regionConfig.lwaClientId,
    client_secret: regionConfig.lwaClientSecret,
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

  console.log(`[getAccessToken] 正在获取 ${normalizedRegion} 区域访问令牌...`);

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const response = JSON.parse(data);
            if (response.access_token) {
              const expiresIn = response.expires_in
                ? Number(response.expires_in)
                : 3600;
              ACCESS_TOKEN_CACHE[normalizedRegion] = {
                token: response.access_token,
                expiresAt: Date.now() + (expiresIn - 60) * 1000,
              };
              console.log(
                `[getAccessToken] ${normalizedRegion} 访问令牌获取成功，长度: ${response.access_token.length}`,
              );
              resolve(response.access_token);
            } else {
              reject(
                new Error(
                  `获取访问令牌失败: 响应中缺少 access_token - ${JSON.stringify(
                    response,
                  )}`,
                ),
              );
            }
          } catch (e) {
            reject(new Error(`解析访问令牌响应失败: ${e.message} - ${data}`));
          }
        } else {
          console.error(
            `[getAccessToken] 获取访问令牌失败: ${res.statusCode} - ${data}`,
          );
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

function clearAccessTokenCache() {
  Object.keys(ACCESS_TOKEN_CACHE).forEach((region) => {
    ACCESS_TOKEN_CACHE[region] = null;
  });
}

function normalizeRegion(region) {
  if (!region) {
    return 'US';
  }
  return REGION_SETTINGS[region] ? region : 'US';
}

function getRegionByCountry(country) {
  if (!country) {
    return 'US';
  }
  return COUNTRY_REGION_MAP[country] || 'US';
}

function getMarketplaceId(country) {
  const marketplaceMap = {
    US: 'ATVPDKIKX0DER',
    UK: 'A1F83G8C2ARO7P',
    DE: 'A1PA6795UKMFR9',
    FR: 'A13V1IB3VIYZZH',
    IT: 'APJ6JRA9NG5V4',
    ES: 'A1RKKUPIHCS9HS',
  };
  return marketplaceMap[country] || marketplaceMap.US;
}

function getRegionConfig(region) {
  return SP_API_CONFIG.regionConfigs[normalizeRegion(region)];
}

/**
 * 执行单次 SP-API 请求（内部函数，不包含重试逻辑）
 */
async function callSPAPIInternal(
  method,
  path,
  country,
  params = {},
  body = null,
) {
  const region = getRegionByCountry(country);
  const regionConfig = SP_API_CONFIG.regionConfigs[region];
  if (
    !regionConfig ||
    !regionConfig.lwaClientId ||
    !regionConfig.lwaClientSecret ||
    !regionConfig.refreshToken
  ) {
    throw new Error(`SP-API ${region}区域的LWA配置不完整，请检查配置`);
  }

  const accessToken = await getAccessToken(region);
  console.log(
    `[callSPAPI] ${region} 区域 Access Token 获取成功，长度: ${accessToken.length}`,
  );

  const endpoint = SP_API_CONFIG.endpoints[region];
  let url;
  if (path.includes('?')) {
    url = `${endpoint}${path}`;
  } else if (params && Object.keys(params).length > 0) {
    const queryParts = [];
    for (const [key, value] of Object.entries(params)) {
      if (Array.isArray(value) && value.length > 0) {
        // SP-API Catalog Items API 要求数组参数使用逗号分隔的格式
        // 根据官方文档：marketplaceIds 和 includedData 应该使用逗号分隔
        // 例如：marketplaceIds=A1PA6795UKMFR9&includedData=variations
        const validValues = value.filter(
          (v) => v !== null && v !== undefined && v !== '',
        );
        if (validValues.length > 0) {
          const arrayValue = validValues
            .map((v) => encodeURIComponent(String(v)))
            .join(',');
          queryParts.push(`${key}=${arrayValue}`);
        }
      } else if (value !== null && value !== undefined && value !== '') {
        queryParts.push(`${key}=${encodeURIComponent(String(value))}`);
      }
    }
    const queryString = queryParts.join('&');
    url = `${endpoint}${path}${queryString ? '?' + queryString : ''}`;
    console.log(`[callSPAPI] 构建的查询字符串: ${queryString}`);
    console.log(`[callSPAPI] 完整请求URL: ${url}`);
  } else {
    url = `${endpoint}${path}`;
  }

  console.log(`[callSPAPI] 请求URL: ${url}`);
  console.log(
    `[callSPAPI] 请求方法: ${method}, 国家: ${country}, 区域: ${region}`,
  );
  const urlObj = new URL(url);
  const payload = body ? JSON.stringify(body) : '';
  const headers = {
    host: urlObj.hostname,
    'x-amz-access-token': accessToken,
    'user-agent': 'Amazon-ASIN-Monitor/1.0 (Language=Node.js)',
  };
  if (body) {
    headers['content-type'] = 'application/json';
  }

  console.log(`[callSPAPI] 请求头（签名前）:`, {
    host: headers.host,
    'x-amz-access-token': headers['x-amz-access-token']
      ? `${headers['x-amz-access-token'].substring(0, 20)}...`
      : 'missing',
  });

  // 根据 USE_AWS_SIGNATURE 配置决定是否使用 AWS 签名
  let finalHeaders = { ...headers };

  if (USE_AWS_SIGNATURE) {
    // 需要 AWS 签名
    const awsConfig = SP_API_CONFIG.aws || {};
    const accessKeyId = regionConfig.accessKeyId || awsConfig.accessKeyId;
    const secretAccessKey =
      regionConfig.secretAccessKey || awsConfig.secretAccessKey;

    if (!accessKeyId || !secretAccessKey) {
      throw new Error(
        `SP-API ${region}区域的AWS配置不完整（启用签名模式需要Access Key），请检查配置`,
      );
    }

    const signatureHeaders = signRequest(
      method,
      url,
      headers,
      payload,
      accessKeyId,
      secretAccessKey,
      REGION_SETTINGS[region].awsRegion,
      'execute-api',
    );

    finalHeaders = {
      ...headers,
      ...signatureHeaders,
    };
  } else {
    // 简化模式：不需要 AWS 签名
    console.log(`[callSPAPI] 使用简化模式（无需AWS签名）`);
  }

  console.log(`[callSPAPI] 最终请求头:`, {
    host: finalHeaders.host,
    'x-amz-access-token': finalHeaders['x-amz-access-token']
      ? `${finalHeaders['x-amz-access-token'].substring(0, 20)}...`
      : 'missing',
    authorization: finalHeaders.authorization
      ? `${finalHeaders.authorization.substring(0, 50)}...`
      : 'missing',
    'x-amz-date': finalHeaders['x-amz-date'],
  });

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
        console.log(`[callSPAPI] 响应状态码: ${res.statusCode}`);
        console.log(`[callSPAPI] 响应数据长度: ${data ? data.length : 0}`);

        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const response = data ? JSON.parse(data) : {};
            console.log(`[callSPAPI] 响应解析成功:`, {
              hasItems: !!response.items,
              itemsCount: response.items ? response.items.length : 0,
              keys: Object.keys(response),
            });
            const responseStr = JSON.stringify(response);
            if (responseStr.length < 1000) {
              console.log(`[callSPAPI] 完整响应内容:`, responseStr);
            } else {
              console.log(
                `[callSPAPI] 响应内容（前500字符）:`,
                responseStr.substring(0, 500),
              );
            }
            resolve(response);
          } catch (e) {
            console.log(`[callSPAPI] 响应解析失败，返回原始数据:`, e.message);
            resolve(data || {});
          }
        } else {
          const errorMsg = data || `HTTP ${res.statusCode}`;
          console.error(`[callSPAPI] 请求失败:`, {
            statusCode: res.statusCode,
            errorMsg: errorMsg.substring(0, 500),
          });

          // 创建错误对象，包含状态码和错误信息
          const error = new Error(
            `SP-API调用失败: ${res.statusCode} - ${errorMsg}`,
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
}

/**
 * 调用SP-API（带指数退避重试）
 * @param {string} method - HTTP方法
 * @param {string} path - API路径
 * @param {string} country - 国家代码
 * @param {object} params - 查询参数
 * @param {object} body - 请求体
 * @param {object} options - 重试选项 {maxRetries: 3, initialDelay: 1000}
 */
async function callSPAPI(
  method,
  path,
  country,
  params = {},
  body = null,
  options = {},
) {
  const maxRetries = options.maxRetries !== undefined ? options.maxRetries : 3;
  const initialDelay =
    options.initialDelay !== undefined ? options.initialDelay : 1000;

  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        // 计算指数退避延迟：initialDelay * 2^(attempt-1)
        const delay = initialDelay * Math.pow(2, attempt - 1);
        console.log(
          `[callSPAPI] 第 ${attempt} 次重试，延迟 ${delay}ms 后重试...`,
        );
        await new Promise((resolve) => {
          setTimeout(() => {
            resolve();
          }, delay);
        });
      }

      return await callSPAPIInternal(method, path, country, params, body);
    } catch (error) {
      lastError = error;

      // 检查是否是 429 或 QuotaExceeded 错误
      const isRateLimitError =
        error.statusCode === 429 ||
        (error.message &&
          (error.message.includes('429') ||
            error.message.includes('QuotaExceeded') ||
            error.message.includes('TooManyRequests')));

      if (isRateLimitError && attempt < maxRetries) {
        console.log(
          `[callSPAPI] 遇到限流错误（429/QuotaExceeded），将进行第 ${
            attempt + 1
          } 次重试（最多 ${maxRetries} 次）`,
        );
        continue; // 继续重试
      } else {
        // 不是限流错误，或者已达到最大重试次数，直接抛出错误
        if (isRateLimitError && attempt >= maxRetries) {
          console.error(
            `[callSPAPI] 达到最大重试次数（${maxRetries}），放弃重试`,
          );
        }
        throw error;
      }
    }
  }

  // 如果所有重试都失败，抛出最后一个错误
  throw lastError || new Error('SP-API调用失败：未知错误');
}

module.exports = {
  SP_API_CONFIG,
  getAccessToken,
  callSPAPI,
  reloadSPAPIConfig,
  loadConfigFromDatabase,
  getRegionByCountry,
  getRegionConfig,
  getMarketplaceId,
  loadUseAwsSignatureConfig,
  getUseAwsSignature,
};
