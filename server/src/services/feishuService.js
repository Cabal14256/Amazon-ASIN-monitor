const axios = require('axios');
const FeishuConfig = require('../models/FeishuConfig');

/**
 * 发送飞书通知
 * @param {string} region - 区域代码（US或EU），用于查找webhook配置
 * @param {Object} messageData - 消息数据
 * @returns {Promise<boolean>} 是否发送成功
 */
async function sendFeishuNotification(region, messageData) {
  try {
    // 获取飞书配置（使用区域代码）
    const config = await FeishuConfig.findByRegion(region);

    if (!config || !config.webhook_url) {
      const displayCountry =
        messageData.countryDisplay || messageData.country || region;
      console.log(
        `区域 ${region} (${displayCountry}) 未配置飞书Webhook，跳过通知`,
      );
      return false;
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
      console.log(`✅ 飞书通知发送成功: ${region} (${displayCountry})`);
      return true;
    } else {
      const displayCountry =
        messageData.countryDisplay || messageData.country || region;
      console.error(
        `❌ 飞书通知发送失败: ${region} (${displayCountry})`,
        response.data,
      );
      return false;
    }
  } catch (error) {
    const displayCountry =
      messageData.countryDisplay || messageData.country || region;
    console.error(
      `❌ 发送飞书通知异常: ${region} (${displayCountry})`,
      error.message,
    );
    return false;
  }
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
    brokenASINs = [],
    checkTime,
  } = data;

  // 状态颜色和文本
  const statusColor = brokenGroups > 0 ? 'red' : 'green';
  const statusText = brokenGroups > 0 ? '⚠️ 发现异常' : '✅ 全部正常';

  // 国家/区域名称映射
  const countryMap = {
    US: '美国区域',
    EU: '欧洲区域',
  };

  // 如果有countryDisplay（包含多个国家），使用它；否则使用区域名称
  const countryName = data.countryDisplay || countryMap[country] || country;
  const timeStr = checkTime || new Date().toLocaleString('zh-CN');

  // 构建通知内容主体
  let contentText = `【${timeStr}】【${countryName}】\n\n`;
  contentText += `已检查分组数量：${totalGroups}，异常分组数量：${brokenGroups}，异常ASIN数量：${brokenASINs.length}\n\n`;
  contentText += `${statusText}\n`;

  // 如果有异常，按变体组分组显示异常ASIN
  if (brokenGroups > 0 && brokenASINs.length > 0) {
    // 按变体组名称分组
    const asinsByGroup = {};
    for (const asinItem of brokenASINs) {
      const groupName = asinItem.groupName || '未知变体组';
      if (!asinsByGroup[groupName]) {
        asinsByGroup[groupName] = [];
      }
      asinsByGroup[groupName].push(asinItem);
    }

    // 构建异常变体组和ASIN列表（按照brokenGroupNames的顺序，但只显示有异常ASIN的）
    const displayedGroups = new Set();
    for (const groupName of brokenGroupNames) {
      if (
        asinsByGroup[groupName] &&
        asinsByGroup[groupName].length > 0 &&
        !displayedGroups.has(groupName)
      ) {
        displayedGroups.add(groupName);
        contentText += `\n⚠️ ${groupName}\n`;
        for (const asinItem of asinsByGroup[groupName]) {
          const asin = asinItem.asin || '';
          const brand = asinItem.brand || '';
          contentText += `- ${asin}`;
          if (brand) {
            contentText += ` ⚠️ 品牌：${brand}`;
          }
          contentText += '\n';
        }
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
        content: title,
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
  };

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

  // 处理每个国家的数据
  for (const country in countryResults) {
    if (!Object.prototype.hasOwnProperty.call(countryResults, country)) {
      continue;
    }
    const countryData = countryResults[country];
    const region = countryToRegionMap[country] || country;
    results.total++;
    const countryName = countryNameMap[country] || country;
    const notificationData = {
      ...countryData,
      country: country, // 使用国家代码作为显示
      countryDisplay: `${countryName}(${country})`,
      region: region, // 保存区域信息用于查找webhook
    };

    // 使用区域代码查找webhook配置，但显示国家名称
    const success = await sendFeishuNotification(region, notificationData);
    if (success) {
      results.success++;
    } else {
      results.failed++;
    }
  }

  return results;
}

module.exports = {
  sendFeishuNotification,
  sendBatchNotifications,
  buildFeishuCard,
};
