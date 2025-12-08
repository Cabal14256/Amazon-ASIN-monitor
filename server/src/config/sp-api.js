require('dotenv').config();
const crypto = require('crypto');
const https = require('https');
const SPAPIConfig = require('../models/SPAPIConfig');
const logger = require('../utils/logger');
const responseAnalyzer = require('../services/spApiResponseAnalyzer');

// 创建全局HTTP连接池（keep-alive）
const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 50, // 最大连接数
  maxFreeSockets: 10, // 最大空闲连接数
  timeout: 60000, // 连接超时（毫秒）
  keepAliveMsecs: 1000, // keep-alive间隔
});

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
    logger.info(
      `[SP-API配置] USE_AWS_SIGNATURE: ${USE_AWS_SIGNATURE} (${
        USE_AWS_SIGNATURE ? '启用AWS签名' : '简化模式，无需AWS签名'
      })`,
    );
  } catch (error) {
    logger.error(
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
    logger.info('✅ SP-API配置已从数据库加载');
  } catch (error) {
    logger.error('⚠️ 从数据库加载SP-API配置失败，使用环境变量:', error.message);
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

  logger.info(`[getAccessToken] 正在获取 ${normalizedRegion} 区域访问令牌...`);

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
              logger.info(
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
          logger.error(
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
 * @param {string} method - HTTP方法
 * @param {string} path - API路径
 * @param {string} country - 国家代码
 * @param {object} params - 查询参数
 * @param {object} body - 请求体
 * @param {string} operation - Operation名称（可选，用于配额分析）
 */
async function callSPAPIInternal(
  method,
  path,
  country,
  params = {},
  body = null,
  operation = null,
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
  logger.info(
    `[callSPAPI] ${region} 区域 Access Token 获取成功，长度: ${accessToken.length}`,
  );

  const endpoint = SP_API_CONFIG.endpoints[region];
  let url;
  if (path.includes('?')) {
    url = `${endpoint}${path}`;
  } else if (params && Object.keys(params).length > 0) {
    const queryParts = [];

    // 检测 API 版本（从 path 中提取）
    const pathMatch = path.match(/\/catalog\/(\d{4}-\d{2}-\d{2})\//);
    const apiVersion = pathMatch ? pathMatch[1] : null;
    const is2022Version = apiVersion === '2022-04-01';

    // 对于 2022-04-01 版本，按照固定顺序处理参数（某些 API 版本可能对顺序敏感）
    // 标准顺序：marketplaceIds 在前，includedData 在后
    const paramOrder = ['marketplaceIds', 'includedData'];
    const processedKeys = new Set();

    // 先处理固定顺序的参数（针对 2022-04-01 版本）
    if (is2022Version) {
      for (const key of paramOrder) {
        if (params.hasOwnProperty(key)) {
          processedKeys.add(key);
          const value = params[key];
          if (Array.isArray(value) && value.length > 0) {
            const validValues = value.filter(
              (v) => v !== null && v !== undefined && v !== '',
            );
            if (validValues.length > 0) {
              // SP-API 要求 array(csv)：用逗号拼成一个参数
              const cleanJoined = validValues
                .map((v) => String(v).trim())
                .join(',');
              const encodedValue = encodeURIComponent(cleanJoined);
              queryParts.push(`${key}=${encodedValue}`);
            }
          } else if (value !== null && value !== undefined && value !== '') {
            const cleanValue = String(value).trim();
            const encodedValue = encodeURIComponent(cleanValue);
            queryParts.push(`${key}=${encodedValue}`);
          }
        }
      }
    }

    // 处理其他参数（按字母顺序，或对于非 2022 版本，按原始顺序）
    for (const [key, value] of Object.entries(params)) {
      if (!processedKeys.has(key)) {
        if (Array.isArray(value) && value.length > 0) {
          const validValues = value.filter(
            (v) => v !== null && v !== undefined && v !== '',
          );
          if (validValues.length > 0) {
            // SP-API 要求 array(csv)：用逗号拼成一个参数
            const cleanJoined = validValues
              .map((v) => String(v).trim())
              .join(',');
            const encodedValue = encodeURIComponent(cleanJoined);
            queryParts.push(`${key}=${encodedValue}`);
          }
        } else if (value !== null && value !== undefined && value !== '') {
          const cleanValue = String(value).trim();
          const encodedValue = encodeURIComponent(cleanValue);
          queryParts.push(`${key}=${encodedValue}`);
        }
      }
    }

    const queryString = queryParts.join('&');
    url = `${endpoint}${path}${queryString ? '?' + queryString : ''}`;
    logger.info(`[callSPAPI] 参数对象:`, JSON.stringify(params, null, 2));
    logger.info(`[callSPAPI] 构建的查询字符串: ${queryString}`);
    logger.info(`[callSPAPI] 完整请求URL: ${url}`);
    if (is2022Version) {
      logger.info(
        `[callSPAPI] 2022-04-01 版本特殊处理: 参数已按固定顺序排列并清理`,
      );
    }
  } else {
    url = `${endpoint}${path}`;
  }

  logger.info(`[callSPAPI] 请求URL: ${url}`);
  logger.info(
    `[callSPAPI] 请求方法: ${method}, 国家: ${country}, 区域: ${region}`,
  );
  const urlObj = new URL(url);
  const payload = body ? JSON.stringify(body) : '';
  const headers = {
    host: urlObj.hostname,
    'x-amz-access-token': accessToken,
    'user-agent': 'Amazon-ASIN-Monitor/1.0 (Language=Node.js)',
    accept: 'application/json', // Amazon SP-API 需要 Accept 头
  };
  if (body) {
    headers['content-type'] = 'application/json';
  }

  logger.info(`[callSPAPI] 请求头（签名前）:`, {
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
    // 确保不包含 authorization 和 x-amz-date 字段
    delete finalHeaders.authorization;
    delete finalHeaders['x-amz-date'];
    logger.info(`[callSPAPI] 使用简化模式（无需AWS签名）`);
  }

  logger.info(`[callSPAPI] 最终请求头:`, {
    host: finalHeaders.host,
    'x-amz-access-token': finalHeaders['x-amz-access-token']
      ? `${finalHeaders['x-amz-access-token'].substring(0, 20)}...`
      : 'missing',
    accept: finalHeaders.accept || 'missing',
    authorization: finalHeaders.authorization
      ? `${finalHeaders.authorization.substring(0, 50)}...`
      : 'not-present',
    'x-amz-date': finalHeaders['x-amz-date'] || 'not-present',
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + (urlObj.search || ''),
      method: method,
      headers: finalHeaders,
      agent: httpsAgent, // 使用连接池
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        logger.info(`[callSPAPI] 响应状态码: ${res.statusCode}`);
        logger.info(`[callSPAPI] 响应数据长度: ${data ? data.length : 0}`);

        // 记录所有响应头（用于配额分析）
        const responseHeaders = res.headers || {};
        const rateLimitLimit =
          responseHeaders['x-amzn-ratelimit-limit'] ||
          responseHeaders['x-amzn-RateLimit-Limit'];
        const requestId =
          responseHeaders['x-amzn-requestid'] ||
          responseHeaders['x-amzn-RequestId'];
        const retryAfter =
          responseHeaders['retry-after'] || responseHeaders['Retry-After'];

        // 记录关键响应头
        logger.info(`[callSPAPI] 响应头信息:`, {
          'x-amzn-RateLimit-Limit': rateLimitLimit,
          'x-amzn-RequestId': requestId,
          'Retry-After': retryAfter || 'N/A',
          statusCode: res.statusCode,
          method: method,
          path: path,
          country: country,
          region: region,
        });

        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const response = data ? JSON.parse(data) : {};

            // 将响应头信息附加到响应对象上（用于后续分析）
            response._spApiHeaders = {
              'x-amzn-RateLimit-Limit': rateLimitLimit,
              'x-amzn-RequestId': requestId,
              allHeaders: responseHeaders,
              method: method,
              path: path,
              country: country,
              region: region,
            };

            logger.info(`[callSPAPI] 响应解析成功:`, {
              hasItems: !!response.items,
              itemsCount: response.items ? response.items.length : 0,
              keys: Object.keys(response),
              rateLimitLimit: rateLimitLimit,
              requestId: requestId,
            });
            const responseStr = JSON.stringify(response);
            if (responseStr.length < 1000) {
              logger.info(`[callSPAPI] 完整响应内容:`, responseStr);
            } else {
              logger.info(
                `[callSPAPI] 响应内容（前500字符）:`,
                responseStr.substring(0, 500),
              );
            }

            // 分析响应头中的配额信息
            try {
              responseAnalyzer.analyzeResponse(response, operation);
            } catch (analyzerError) {
              logger.warn(`[callSPAPI] 分析响应头失败:`, analyzerError.message);
            }

            resolve(response);
          } catch (e) {
            logger.info(`[callSPAPI] 响应解析失败，返回原始数据:`, e.message);
            const fallbackResponse = data || {};
            if (typeof fallbackResponse === 'object') {
              fallbackResponse._spApiHeaders = {
                'x-amzn-RateLimit-Limit': rateLimitLimit,
                'x-amzn-RequestId': requestId,
                allHeaders: responseHeaders,
                method: method,
                path: path,
                country: country,
                region: region,
              };
            }
            resolve(fallbackResponse);
          }
        } else {
          const errorMsg = data || `HTTP ${res.statusCode}`;

          // 解析错误body中的code字段（429错误通常是QuotaExceeded/TooManyRequests）
          let errorCode = null;
          let errorDetails = null;
          if (data) {
            try {
              const errorBody = JSON.parse(data);
              errorCode = errorBody.code || errorBody.message || null;
              errorDetails = errorBody;
            } catch (e) {
              // 无法解析JSON，忽略
            }
          }

          logger.error(`[callSPAPI] 请求失败:`, {
            statusCode: res.statusCode,
            errorMsg: errorMsg.substring(0, 500),
            errorCode: errorCode,
            rateLimitLimit: rateLimitLimit,
            requestId: requestId,
            retryAfter: retryAfter,
          });

          // 如果是429错误，特别记录
          if (res.statusCode === 429) {
            logger.warn(`[callSPAPI] 429限流错误详情:`, {
              method: method,
              path: path,
              country: country,
              region: region,
              'x-amzn-RateLimit-Limit': rateLimitLimit,
              'x-amzn-RequestId': requestId,
              'Retry-After': retryAfter,
              errorCode: errorCode,
              errorDetails: errorDetails,
            });

            // 分析错误响应头中的配额信息
            try {
              responseAnalyzer.analyzeError(error, operation);
            } catch (analyzerError) {
              logger.warn(
                `[callSPAPI] 分析错误响应头失败:`,
                analyzerError.message,
              );
            }
          }

          // 创建错误对象，包含状态码、错误信息和响应头
          const error = new Error(
            `SP-API调用失败: ${res.statusCode} - ${errorMsg}`,
          );
          error.statusCode = res.statusCode;
          error.responseData = data;
          error.errorCode = errorCode;
          // 保存响应头信息，特别是Retry-After头
          error.headers = responseHeaders;
          error.response = {
            headers: responseHeaders,
            statusCode: res.statusCode,
          };
          // 附加配额相关信息
          error.rateLimitLimit = rateLimitLimit;
          error.requestId = requestId;
          error.retryAfter = retryAfter;
          error.method = method;
          error.path = path;
          error.country = country;
          error.region = region;
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
 * @param {object} options - 选项 {maxRetries: 3, initialDelay: 1000, operation: 'operationName'}
 */
async function callSPAPI(
  method,
  path,
  country,
  params = {},
  body = null,
  options = {},
) {
  const maxRetries = options.maxRetries !== undefined ? options.maxRetries : 5;
  const initialDelay =
    options.initialDelay !== undefined ? options.initialDelay : 2000;
  const operation = options.operation || null; // Operation名称（可选）

  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        // 如果是重试，需要等待（等待时间由Retry-After或指数退避决定）
        // 注意：首次重试的等待时间在上一次循环的错误处理中已设置
        logger.info(
          `[callSPAPI] 第 ${attempt} 次重试（最多 ${maxRetries} 次）...`,
        );
      }

      const result = await callSPAPIInternal(
        method,
        path,
        country,
        params,
        body,
        operation,
      );

      return result;
    } catch (error) {
      lastError = error;

      // 检查是否是 429 或 QuotaExceeded 错误
      const isRateLimitError =
        error.statusCode === 429 ||
        (error.message &&
          (error.message.includes('429') ||
            error.message.includes('QuotaExceeded') ||
            error.message.includes('TooManyRequests')));

      // 分析错误响应头
      if (isRateLimitError) {
        try {
          responseAnalyzer.analyzeError(error, operation);
        } catch (analyzerError) {
          logger.warn(`[callSPAPI] 分析错误响应头失败:`, analyzerError.message);
        }
      }

      if (isRateLimitError && attempt < maxRetries) {
        // 优先使用Retry-After响应头（如果存在）
        let waitTime = null;
        const retryAfter =
          error.retryAfter ||
          error.response?.headers?.['retry-after'] ||
          error.response?.headers?.['Retry-After'] ||
          error.headers?.['retry-after'] ||
          error.headers?.['Retry-After'];

        if (retryAfter) {
          // Retry-After可能是秒数（数字）或HTTP日期字符串
          const retryAfterNum = parseInt(retryAfter, 10);
          if (!isNaN(retryAfterNum)) {
            // 数字格式：直接使用（秒转毫秒）
            waitTime = retryAfterNum * 1000;
            logger.info(
              `[callSPAPI] 429限流错误，Retry-After头指定等待 ${waitTime}ms 后重试 (${
                attempt + 1
              }/${maxRetries})`,
            );
          } else {
            // HTTP日期格式：计算时间差
            const retryDate = new Date(retryAfter);
            if (!isNaN(retryDate.getTime())) {
              waitTime = Math.max(0, retryDate.getTime() - Date.now());
              logger.info(
                `[callSPAPI] 429限流错误，Retry-After头指定等待 ${waitTime}ms 后重试 (${
                  attempt + 1
                }/${maxRetries})`,
              );
            }
          }
        }

        // 如果没有Retry-After头或解析失败，使用指数退避作为兜底
        if (waitTime === null || waitTime <= 0) {
          waitTime = Math.min(initialDelay * Math.pow(2, attempt), 30000); // 最多30秒
          logger.info(
            `[callSPAPI] 429限流错误，使用指数退避等待 ${waitTime}ms 后重试 (${
              attempt + 1
            }/${maxRetries})`,
          );
        }

        // 限制最大等待时间为120秒
        waitTime = Math.min(waitTime, 120000);

        logger.info(
          `[callSPAPI] 遇到限流错误（429/QuotaExceeded），等待 ${waitTime}ms 后进行第 ${
            attempt + 1
          } 次重试（最多 ${maxRetries} 次）`,
        );

        // 等待指定时间后继续重试
        await new Promise((resolve) => {
          setTimeout(() => {
            resolve();
          }, waitTime);
        });

        continue; // 继续重试
      } else {
        // 不是限流错误，或者已达到最大重试次数，直接抛出错误
        if (isRateLimitError && attempt >= maxRetries) {
          logger.error(
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
