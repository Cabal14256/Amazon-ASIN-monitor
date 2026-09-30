const axios = require('axios');
const FeishuConfig = require('../models/FeishuConfig');
const { getUTC8LocaleString } = require('../utils/dateTime');
const logger = require('../utils/logger');
const {
  assessEmergency,
  notifyEmergency,
} = require('./feishuEmergencyService');

const RATE_LIMIT_CODE = 11232;
const REQUEST_INTERVAL_MS = 500;
const MAX_RETRY_ATTEMPTS = 3;
const RATE_LIMIT_LOG_INTERVAL = 60 * 1000;

const wait = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const feishuMetrics = {
  rateLimitCount: 0,
  lastRateLimitAt: null,
};

function recordRateLimit(country) {
  feishuMetrics.rateLimitCount++;
  feishuMetrics.lastRateLimitAt = new Date();
  if (feishuMetrics.rateLimitCount % 5 === 0) {
    logger.warn(
      `[feishu] 累计 ${feishuMetrics.rateLimitCount} 次限频（最近一次: ${country}）`,
    );
  }
}

setInterval(() => {
  if (feishuMetrics.rateLimitCount > 0) {
    logger.warn(
      `[feishu] 最近 ${RATE_LIMIT_LOG_INTERVAL / 1000}s 触发 ${
        feishuMetrics.rateLimitCount
      } 次限频，上次发生在 ${feishuMetrics.lastRateLimitAt}`,
    );
    feishuMetrics.rateLimitCount = 0;
    feishuMetrics.lastRateLimitAt = null;
  }
}, RATE_LIMIT_LOG_INTERVAL).unref?.();

function getStatusSourceLabel(source) {
  const sourceMap = {
    AUTO: '自动检测',
    MANUAL: '人工标记',
    'AUTO+MANUAL': '自动检测 + 人工标记',
    NORMAL: '正常',
  };
  return sourceMap[source] || source || '未知';
}

function includesManualSource(source) {
  return String(source || '').includes('MANUAL');
}

function getNotificationStatusLabel(brokenGroups) {
  return brokenGroups > 0 ? '异常' : '正常';
}

function getNotificationCountryCode(country, countryName) {
  const normalizedCountry = country ? String(country).trim() : '';
  if (normalizedCountry) {
    return normalizedCountry;
  }

  const normalizedCountryName =
    countryName === undefined || countryName === null
      ? ''
      : String(countryName).trim();
  const countryCodeMatch = normalizedCountryName.match(/\(([A-Z]{2})\)$/);
  return countryCodeMatch ? countryCodeMatch[1] : normalizedCountryName;
}

function buildNotificationTitle(title, country, countryName, brokenGroups) {
  const countryCode = getNotificationCountryCode(country, countryName);
  return `${title}-${countryCode}${getNotificationStatusLabel(brokenGroups)}`;
}

/**
 * 发送飞书通知
 * @param {string} region - 区域代码（US或EU），用于查找webhook配置
 * @param {Object} messageData - 消息数据
 * @returns {Promise<{success: boolean, errorCode?: number}>}
 */
async function sendFeishuNotification(region, messageData) {
  try {
    // 获取飞书配置（使用区域代码）
    const config = await FeishuConfig.findByRegion(region);

    if (!config || !config.webhook_url) {
      const displayCountry =
        messageData.countryDisplay || messageData.country || region;
      logger.info(
        `区域 ${region} (${displayCountry}) 未配置飞书Webhook，跳过通知`,
      );
      return { success: false };
    }

    // 构建飞书消息卡片
    const card = buildFeishuCard(messageData);

    // 发送请求
    const response = await axios.post(
      config.webhook_url,
      {
        msg_type: 'interactive',
        card: card,
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 10000, // 10秒超时
      },
    );

    if (response.status === 200 && response.data.code === 0) {
      const displayCountry =
        messageData.countryDisplay || messageData.country || region;
      logger.info(`✅ 飞书通知发送成功: ${region} (${displayCountry})`);
      return { success: true };
    } else {
      const displayCountry =
        messageData.countryDisplay || messageData.country || region;
      logger.error(`❌ 飞书通知发送失败: ${region} (${displayCountry})`, {
        code: response.data?.code,
        msg: response.data?.msg,
      });
      return {
        success: false,
        errorCode: response.data?.code || response.status,
      };
    }
  } catch (error) {
    const displayCountry =
      messageData.countryDisplay || messageData.country || region;
    logger.error(
      `❌ 发送飞书通知异常: ${region} (${displayCountry})`,
      error.message,
    );
    return {
      success: false,
      errorCode: error?.response?.data?.code || error?.response?.status,
    };
  }
}

async function sendNotificationWithRetry(region, messageData) {
  let attempts = 0;
  while (attempts < MAX_RETRY_ATTEMPTS) {
    attempts++;
    const result = await sendFeishuNotification(region, messageData);
    if (result.success) {
      return result;
    }

    const errorCode = Number(result.errorCode);
    if (
      !Number.isNaN(errorCode) &&
      errorCode === RATE_LIMIT_CODE &&
      attempts < MAX_RETRY_ATTEMPTS
    ) {
      const waitMs = 2000 + Math.floor(Math.random() * 2000);
      logger.warn(
        `[feishu] 限频(${region})，第 ${attempts + 1} 次尝试前等待 ${waitMs}ms`,
      );
      recordRateLimit(region);
      await wait(waitMs);
      continue;
    }
    return result;
  }

  return { success: false, errorCode: RATE_LIMIT_CODE };
}

/**
 * 构建飞书消息卡片
 * @param {Object} data - 消息数据
 * @returns {Object} 飞书卡片对象
 */
function buildFeishuCard(data) {
  const {
    title = 'ASIN变体监控通知',
    country,
    totalGroups = 0,
    brokenGroups = 0,
    brokenGroupNames = [],
    brokenGroupDetails = [],
    brokenASINs = [],
    brokenByType = { SP_API_ERROR: 0, NOT_FOUND: 0, NO_VARIANTS: 0 },
    checkTime,
  } = data;

  // 状态颜色和文本
  const isEmergency = data.emergency?.status === 'emergency';
  const statusColor = isEmergency || brokenGroups > 0 ? 'red' : 'green';
  const statusText = isEmergency
    ? '🚨 紧急状态'
    : brokenGroups > 0
    ? '⚠️ 发现异常'
    : '✅ 全部正常';

  // 国家/区域名称映射
  const countryMap = {
    US: '美国区域',
    EU: '欧洲区域',
  };

  // 如果有countryDisplay（包含多个国家），使用它；否则使用区域名称
  const countryName = data.countryDisplay || countryMap[country] || country;
  const headerTitle = isEmergency
    ? `${title}-${country}紧急`
    : buildNotificationTitle(title, country, countryName, brokenGroups);
  // 确保时间格式为 UTC+8，如果 checkTime 是 Date 对象则转换，否则使用当前时间
  const timeStr = checkTime
    ? checkTime instanceof Date
      ? getUTC8LocaleString(checkTime)
      : checkTime
    : getUTC8LocaleString();

  // 统计异常类型
  const spApiErrorCount = brokenByType?.SP_API_ERROR || 0;
  const notFoundCount = brokenByType?.NOT_FOUND || 0;
  const noVariantsCount = brokenByType?.NO_VARIANTS || 0;
  const parentChangedCount = brokenByType?.PARENT_CHANGED || 0;
  const totalBrokenASINs = brokenASINs.length;
  const manualBrokenASINCount = brokenASINs.filter((item) =>
    includesManualSource(item?.statusSource),
  ).length;
  const manualBrokenGroupCount = brokenGroupDetails.filter((item) =>
    includesManualSource(item?.statusSource),
  ).length;
  const buildAmazonAsinUrl = (asin) => {
    if (!asin) {
      return '';
    }
    const domainMap = {
      US: 'amazon.com',
      UK: 'amazon.co.uk',
      DE: 'amazon.de',
      FR: 'amazon.fr',
      IT: 'amazon.it',
      ES: 'amazon.es',
    };
    const domain = domainMap[country] || 'amazon.com';
    return `https://www.${domain}/dp/${encodeURIComponent(asin)}`;
  };

  // 构建通知内容主体
  let contentText = `【${timeStr}】【${countryName}】\n\n`;
  if (isEmergency) {
    const { region, count, threshold, startTime, endTime } = data.emergency;
    contentText += `🚨 ${region} 区域进入紧急状态：统计时段内新增异常变体组 ${count} 个，超过阈值 ${threshold} 个。\n`;
    contentText += `统计时段（北京时间）：${startTime} 至 ${endTime}\n`;
    contentText +=
      '按国家 + 变体组去重，仅计正常转异常且原父体变化或关系丢失的新发事件。\n';
    contentText += '请相关负责人尽快检查并处理。\n\n';
  }
  contentText += `已检查分组数量：${totalGroups}，异常分组数量：${brokenGroups}，异常ASIN数量：${totalBrokenASINs}\n\n`;

  // 显示异常分类统计
  if (totalBrokenASINs > 0) {
    contentText += `异常分类统计：\n`;
    if (spApiErrorCount > 0) {
      contentText += `  ❌ SP-API错误：${spApiErrorCount} 个\n`;
    }
    if (notFoundCount > 0) {
      contentText += `  ⛔ ASIN不存在：${notFoundCount} 个\n`;
    }
    if (noVariantsCount > 0) {
      contentText += `  ⚠️ 无父变体ASIN：${noVariantsCount} 个\n`;
    }
    if (parentChangedCount > 0) {
      contentText += `  🔀 原父体发生变化：${parentChangedCount} 个\n`;
    }
    if (manualBrokenASINCount > 0) {
      contentText += `  🏷️ 含人工标记：${manualBrokenASINCount} 个\n`;
    }
    contentText += `\n`;
  }

  if (manualBrokenGroupCount > 0) {
    contentText += `含人工标记异常分组：${manualBrokenGroupCount} 个\n\n`;
  }

  contentText += `${statusText}\n`;

  // 如果有异常，按变体组分组显示异常ASIN / 人工说明
  if (brokenGroups > 0) {
    const getGroupKey = (item, groupName) =>
      item?.variantGroupId
        ? `id:${item.variantGroupId}`
        : `name:${groupName || '未知变体组'}`;
    const groupBuckets = new Map();
    for (const groupItem of brokenGroupDetails) {
      if (!groupItem?.groupName) {
        continue;
      }
      const groupKey = getGroupKey(groupItem, groupItem.groupName);
      groupBuckets.set(groupKey, {
        groupName: groupItem.groupName,
        groupDetail: groupItem,
        asins: [],
      });
    }
    for (const asinItem of brokenASINs) {
      const groupName = asinItem.groupName || '未知变体组';
      const groupKey = getGroupKey(asinItem, groupName);
      if (!groupBuckets.has(groupKey)) {
        groupBuckets.set(groupKey, {
          groupName,
          groupDetail: null,
          asins: [],
        });
      }
      groupBuckets.get(groupKey).asins.push(asinItem);
    }
    for (const groupName of brokenGroupNames) {
      if (
        groupName &&
        !Array.from(groupBuckets.values()).some(
          (bucket) => bucket.groupName === groupName,
        )
      ) {
        groupBuckets.set(`name:${groupName}`, {
          groupName,
          groupDetail: null,
          asins: [],
        });
      }
    }

    for (const { groupName, groupDetail, asins } of groupBuckets.values()) {
      contentText += `\n⚠️ ${groupName}\n`;
      if (groupDetail?.statusSource && groupDetail.statusSource !== 'NORMAL') {
        contentText += `  来源：${getStatusSourceLabel(
          groupDetail.statusSource,
        )}\n`;
      }
      if (groupDetail?.manualBrokenReason) {
        contentText += `  说明：${groupDetail.manualBrokenReason}\n`;
      }

      for (const asinItem of asins) {
        const asin = asinItem.asin || '';
        const brand = asinItem.brand || '';
        const asinUrl = buildAmazonAsinUrl(asin);
        const asinLabel = asinUrl ? `[${asin}](${asinUrl})` : asin;
        const extraParts = [];

        if (brand) {
          extraParts.push(`品牌：${brand}`);
        }
        if (asinItem.statusSource && asinItem.statusSource !== 'NORMAL') {
          extraParts.push(
            `来源：${getStatusSourceLabel(asinItem.statusSource)}`,
          );
        }
        if (asinItem.manualBrokenReason) {
          extraParts.push(`说明：${asinItem.manualBrokenReason}`);
        }
        const split = asinItem.splitDetection;
        if (split?.reason === 'PARENT_CHANGED') {
          extraParts.push(
            `父体变化：${split.baselineParentAsin || '未知'} → ${
              split.currentParentAsin || '无父体'
            }`,
          );
        } else if (split?.reason === 'RELATIONSHIP_LOST') {
          extraParts.push(
            `关系丢失，原父体：${split.baselineParentAsin || '未知'}`,
          );
        }

        contentText += `- ${asinLabel}`;
        if (extraParts.length > 0) {
          contentText += `（${extraParts.join('；')}）`;
        }
        contentText += '\n';
      }
    }
  }

  return {
    config: {
      wide_screen_mode: true,
    },
    header: {
      title: {
        tag: 'plain_text',
        content: headerTitle,
      },
      template: statusColor,
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: contentText,
        },
      },
    ],
  };
}

/**
 * 发送单个国家的飞书通知
 * @param {string} country - 国家代码
 * @param {Object} countryData - 该国家的检查结果数据
 * @returns {Promise<{success: boolean, skipped: boolean, errorCode?: number}>}
 */
async function sendSingleCountryNotification(country, countryData) {
  // 国家到区域的映射（用于查找webhook配置）
  const countryToRegionMap = {
    US: 'US',
    UK: 'EU',
    DE: 'EU',
    FR: 'EU',
    IT: 'EU',
    ES: 'EU',
  };

  // 国家名称映射
  const countryNameMap = {
    US: '美国',
    UK: '英国',
    DE: '德国',
    FR: '法国',
    IT: '意大利',
    ES: '西班牙',
  };

  const region = countryToRegionMap[country] || country;
  const countryName = countryNameMap[country] || country;
  const assessment = await assessEmergency(region);
  const { config: emergencyConfig, ...emergency } = assessment;
  const notificationData = {
    ...countryData,
    country,
    countryDisplay: `${countryName}(${country})`,
    region,
    emergency,
  };

  // 无论是否有异常都发送通知（无异常时显示"全部正常"）
  const [result, phoneResult] = await Promise.all([
    sendNotificationWithRetry(region, notificationData),
    notifyEmergency(assessment),
  ]);
  const emergencyResult = { ...emergency, phone: phoneResult };
  if (result.success) {
    return {
      success: true,
      skipped: false,
      emergency: emergencyResult,
    };
  } else {
    if (result.errorCode === RATE_LIMIT_CODE) {
      logger.warn(`[feishu] 国家 ${country} 限频重试失败`);
      recordRateLimit(country);
    }
    return {
      success: false,
      skipped: false,
      errorCode: result.errorCode,
      emergency: emergencyResult,
    };
  }
}

/**
 * 批量发送飞书通知
 * @param {Object} countryResults - 按国家分组的检查结果对象
 * @returns {Promise<Object>} 发送结果统计
 */
async function sendBatchNotifications(countryResults) {
  const results = {
    total: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    countryResults: {}, // 记录每个国家的通知发送结果
  };

  const countries = Object.keys(countryResults).filter((country) =>
    Object.prototype.hasOwnProperty.call(countryResults, country),
  );
  const BATCH_SIZE = 2;

  for (let i = 0; i < countries.length; i += BATCH_SIZE) {
    const batch = countries.slice(i, i + BATCH_SIZE);
    const tasks = batch.map(async (country) => {
      const countryData = countryResults[country];
      results.total++;
      const result = await sendSingleCountryNotification(country, countryData);
      results[result.success ? 'success' : 'failed']++;
      results.countryResults[country] = result;
    });

    await Promise.all(tasks);

    if (i + BATCH_SIZE < countries.length) {
      await wait(REQUEST_INTERVAL_MS);
    }
  }

  return results;
}

module.exports = {
  sendFeishuNotification,
  sendBatchNotifications,
  sendSingleCountryNotification,
  buildFeishuCard,
};
