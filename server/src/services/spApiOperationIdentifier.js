/**
 * SP-API Operation识别器
 * 自动识别operation（基于HTTP方法+路径）或支持显式指定
 */

const logger = require('../utils/logger');

/**
 * 已知的operation配置
 */
const KNOWN_OPERATIONS = {
  getCatalogItem: {
    method: 'GET',
    pattern: /^\/catalog\/\d{4}-\d{2}-\d{2}\/items\/[A-Z0-9]{10}$/,
    description: '获取单个ASIN的Catalog Item信息',
  },
  searchCatalogItems: {
    method: 'POST',
    pattern: /^\/catalog\/\d{4}-\d{2}-\d{2}\/items$/,
    description: '批量搜索Catalog Items',
  },
  // 可以添加更多已知的operation
};

/**
 * 识别operation名称（基于HTTP方法和路径）
 * @param {string} method - HTTP方法（GET, POST, PUT, DELETE等）
 * @param {string} path - API路径
 * @returns {string|null} Operation名称，如果无法识别则返回null
 */
function identifyOperation(method, path) {
  if (!method || !path) {
    return null;
  }

  // 规范化方法和路径
  const normalizedMethod = method.toUpperCase();
  const normalizedPath = path.split('?')[0]; // 移除查询参数

  // 遍历已知的operation，查找匹配项
  for (const [operationName, config] of Object.entries(KNOWN_OPERATIONS)) {
    if (
      config.method === normalizedMethod &&
      config.pattern.test(normalizedPath)
    ) {
      logger.debug(
        `[spApiOperationIdentifier] 识别到operation: ${operationName} (${normalizedMethod} ${normalizedPath})`,
      );
      return operationName;
    }
  }

  // 如果无法匹配已知operation，生成通用名称
  const pathParts = normalizedPath.split('/').filter((p) => p);
  const lastPart = pathParts[pathParts.length - 1] || 'unknown';
  const genericName = `${normalizedMethod.toLowerCase()}_${lastPart}`;

  logger.debug(
    `[spApiOperationIdentifier] 无法匹配已知operation，生成通用名称: ${genericName} (${normalizedMethod} ${normalizedPath})`,
  );

  return genericName;
}

/**
 * 验证operation名称是否有效
 * @param {string} operation - Operation名称
 * @returns {boolean} 是否为已知的operation
 */
function isValidOperation(operation) {
  return operation && operation in KNOWN_OPERATIONS;
}

/**
 * 获取operation的配置信息
 * @param {string} operation - Operation名称
 * @returns {Object|null} Operation配置，如果不存在则返回null
 */
function getOperationConfig(operation) {
  if (!operation || !isValidOperation(operation)) {
    return null;
  }
  return KNOWN_OPERATIONS[operation];
}

/**
 * 获取所有已知的operation列表
 * @returns {Array<string>} Operation名称数组
 */
function getKnownOperations() {
  return Object.keys(KNOWN_OPERATIONS);
}

/**
 * 注册新的operation（运行时添加）
 * @param {string} operationName - Operation名称
 * @param {Object} config - Operation配置 {method, pattern, description}
 */
function registerOperation(operationName, config) {
  if (!operationName || !config || !config.method || !config.pattern) {
    throw new Error('Invalid operation configuration');
  }

  KNOWN_OPERATIONS[operationName] = {
    method: config.method.toUpperCase(),
    pattern:
      config.pattern instanceof RegExp
        ? config.pattern
        : new RegExp(config.pattern),
    description: config.description || '',
  };

  logger.info(`[spApiOperationIdentifier] 注册新operation: ${operationName}`);
}

/**
 * 从完整URL中识别operation
 * @param {string} method - HTTP方法
 * @param {string} url - 完整URL或路径
 * @returns {string|null} Operation名称
 */
function identifyFromUrl(method, url) {
  if (!url) {
    return null;
  }

  // 如果是完整URL，提取路径部分
  let path = url;
  try {
    const urlObj = new URL(url);
    path = urlObj.pathname;
  } catch (e) {
    // 不是完整URL，当作路径处理
    path = url.split('?')[0]; // 移除查询参数
  }

  return identifyOperation(method, path);
}

module.exports = {
  identifyOperation,
  identifyFromUrl,
  isValidOperation,
  getOperationConfig,
  getKnownOperations,
  registerOperation,
  KNOWN_OPERATIONS,
};
