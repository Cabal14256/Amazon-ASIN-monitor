const axios = require('axios');
const logger = require('../utils/logger');

/**
 * HTML 抓取服务 - 作为 SP-API 的最终兜底方案
 *
 * ⚠️ 风险提示：
 * - 可能违反 Amazon 服务条款
 * - 可能触发反爬虫机制（IP封禁、验证码等）
 * - 需要持续维护以适应页面结构变化
 * - 建议仅在 SP-API 完全失败时使用
 */

// 国家域名映射
const COUNTRY_DOMAIN_MAP = {
  US: 'amazon.com',
  UK: 'amazon.co.uk',
  DE: 'amazon.de',
  FR: 'amazon.fr',
  IT: 'amazon.it',
  ES: 'amazon.es',
};

// 国家语言映射（用于 Accept-Language 头）
const COUNTRY_LANGUAGE_MAP = {
  US: 'en-US,en;q=0.9',
  UK: 'en-GB,en;q=0.9',
  DE: 'de-DE,de;q=0.9,en;q=0.8',
  FR: 'fr-FR,fr;q=0.9,en;q=0.8',
  IT: 'it-IT,it;q=0.9,en;q=0.8',
  ES: 'es-ES,es;q=0.9,en;q=0.8',
};

// User-Agent 列表（可以轮换使用）
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
];

/**
 * 获取随机 User-Agent
 */
function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * 构造商品页 URL
 * @param {string} asin - ASIN 编码
 * @param {string} country - 国家代码
 * @returns {string} 商品页 URL
 */
function buildProductUrl(asin, country) {
  const domain = COUNTRY_DOMAIN_MAP[country] || COUNTRY_DOMAIN_MAP.US;
  return `https://www.${domain}/dp/${asin}`;
}

/**
 * 从 HTML 中提取 parentAsin
 * 使用多个正则表达式尝试提取
 * @param {string} html - HTML 内容
 * @returns {string|null} parentAsin 或 null
 */
function extractParentAsin(html) {
  if (!html || typeof html !== 'string') {
    return null;
  }

  const patterns = [
    // 模式1: "parentAsin": "B0XXXXX"
    /"parentAsin"\s*:\s*"([A-Z0-9]{10})"/i,
    // 模式2: "parent_asin": "B0XXXXX"
    /"parent_asin"\s*:\s*"([A-Z0-9]{10})"/i,
    // 模式3: data-asin-parent="B0XXXXX"
    /data-asin-parent\s*=\s*"([A-Z0-9]{10})"/i,
    // 模式4: "twisterJsInit" 中的 parentAsin
    /twisterJsInit[^}]*"parentAsin"\s*:\s*"([A-Z0-9]{10})"/i,
    // 模式5: "variationDisplayData" 中的 parentAsin
    /variationDisplayData[^}]*"parentAsin"\s*:\s*"([A-Z0-9]{10})"/i,
    // 模式6: 在 JSON 数据中的 parentAsin（更宽泛的匹配）
    /"parentAsin"\s*:\s*"([A-Z0-9]{10})"/g,
  ];

  for (let i = 0; i < patterns.length; i++) {
    const pattern = patterns[i];
    const matches = html.match(pattern);
    if (matches && matches[1]) {
      const parentAsin = matches[1].toUpperCase();
      // 验证 ASIN 格式（10个字符，以字母开头）
      if (/^[A-Z][A-Z0-9]{9}$/.test(parentAsin)) {
        logger.debug(
          `[HTML抓取] 使用模式 ${i + 1} 提取到 parentAsin: ${parentAsin}`,
        );
        return parentAsin;
      }
    }
  }

  // 如果所有模式都失败，尝试全局搜索
  const globalMatch = html.match(/"parentAsin"\s*:\s*"([A-Z0-9]{10})"/gi);
  if (globalMatch && globalMatch.length > 0) {
    for (const match of globalMatch) {
      const extracted = match.match(/"([A-Z0-9]{10})"/i);
      if (extracted && extracted[1]) {
        const parentAsin = extracted[1].toUpperCase();
        if (/^[A-Z][A-Z0-9]{9}$/.test(parentAsin)) {
          logger.debug(
            `[HTML抓取] 使用全局搜索提取到 parentAsin: ${parentAsin}`,
          );
          return parentAsin;
        }
      }
    }
  }

  return null;
}

/**
 * 从 HTML 中提取变体 ASIN 列表
 * @param {string} html - HTML 内容
 * @returns {string[]} 变体 ASIN 列表
 */
function extractVariantAsins(html) {
  if (!html || typeof html !== 'string') {
    return [];
  }

  const variantAsins = [];
  const patterns = [
    // 从 variationDisplayData 中提取
    /variationDisplayData[^}]*"variationASINs"\s*:\s*\[([^\]]+)\]/i,
    // 从 twisterJsInit 中提取
    /twisterJsInit[^}]*"variationASINs"\s*:\s*\[([^\]]+)\]/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      // 提取所有 ASIN
      const asinMatches = match[1].match(/"([A-Z0-9]{10})"/gi);
      if (asinMatches) {
        asinMatches.forEach((m) => {
          const asin = m.replace(/"/g, '').toUpperCase();
          if (/^[A-Z][A-Z0-9]{9}$/.test(asin) && !variantAsins.includes(asin)) {
            variantAsins.push(asin);
          }
        });
      }
    }
  }

  return variantAsins;
}

/**
 * 通过 HTML 抓取检查 ASIN 的变体关系
 * @param {string} asin - ASIN 编码
 * @param {string} country - 国家代码
 * @returns {Promise<{hasVariants: boolean, variantCount: number, details: any}>}
 */
async function checkASINVariantsByHTML(asin, country) {
  const startTime = Date.now();
  logger.info(`[HTML抓取] 开始抓取 ASIN ${asin} (${country})`);

  try {
    const url = buildProductUrl(asin, country);
    const userAgent = getRandomUserAgent();
    const acceptLanguage =
      COUNTRY_LANGUAGE_MAP[country] || COUNTRY_LANGUAGE_MAP.US;

    logger.debug(`[HTML抓取] 请求URL: ${url}`);
    logger.debug(`[HTML抓取] User-Agent: ${userAgent.substring(0, 50)}...`);

    const response = await axios.get(url, {
      headers: {
        'User-Agent': userAgent,
        'Accept-Language': acceptLanguage,
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        Connection: 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
      timeout: 15000, // 15秒超时
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 400, // 允许重定向
    });

    const html = response.data;
    if (!html || typeof html !== 'string') {
      throw new Error('HTML 响应为空或格式不正确');
    }

    logger.debug(`[HTML抓取] 获取到 HTML，长度: ${html.length} 字符`);

    // 提取 parentAsin
    const parentAsin = extractParentAsin(html);

    // 提取变体 ASIN 列表
    const variantAsins = extractVariantAsins(html);

    // 判断是否有变体关系
    // 如果有 parentAsin 且与当前 ASIN 不同，说明是子变体
    // 如果有 variantAsins，说明是父变体或有变体关系
    const hasVariants = !!parentAsin || variantAsins.length > 0;
    const variantCount = variantAsins.length;

    const duration = Date.now() - startTime;
    logger.info(`[HTML抓取] 抓取完成，耗时: ${duration}ms`);
    logger.debug(
      `[HTML抓取] 结果: hasVariants=${hasVariants}, variantCount=${variantCount}, parentAsin=${
        parentAsin || 'N/A'
      }`,
    );

    return {
      hasVariants,
      variantCount,
      details: {
        asin,
        parentAsin: parentAsin || null,
        variantAsins,
        source: 'html_scraper',
        duration,
      },
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(`[HTML抓取] 抓取失败 (${duration}ms):`, error.message);

    // 如果是超时错误
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      throw new Error('HTML抓取超时（15秒）');
    }

    // 如果是网络错误
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      throw new Error(`HTML抓取网络错误: ${error.message}`);
    }

    // 其他错误
    throw new Error(`HTML抓取失败: ${error.message}`);
  }
}

module.exports = {
  checkASINVariantsByHTML,
  buildProductUrl,
  extractParentAsin,
  extractVariantAsins,
};
