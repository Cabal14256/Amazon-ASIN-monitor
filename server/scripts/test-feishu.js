#!/usr/bin/env node
/**
 * 飞书通知配置测试脚本
 * 测试飞书 Webhook 配置是否正确
 *
 * 使用方法: node scripts/test-feishu.js [--send-test]
 */

const path = require('path');
const { loadEnv } = require('./utils/loadEnv');

loadEnv(path.join(__dirname, '../.env'));

const FeishuConfig = require('../src/models/FeishuConfig');
const { query } = require('../src/config/database');
const axios = require('axios');

// 颜色输出辅助函数
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'cyan');
}

// 验证 Webhook URL 格式
function validateWebhookUrl(url) {
  if (!url) {
    return { valid: false, error: 'URL 为空' };
  }

  try {
    const urlObj = new URL(url);
    if (!urlObj.protocol.startsWith('http')) {
      return { valid: false, error: 'URL 必须是 HTTP 或 HTTPS' };
    }

    // 检查是否是飞书 Webhook URL
    if (!url.includes('open.feishu.cn') && !url.includes('larkoffice.com')) {
      return { valid: true, warning: 'URL 可能不是飞书 Webhook 地址' };
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, error: 'URL 格式无效' };
  }
}

// 发送测试消息
async function sendTestMessage(webhookUrl, region) {
  try {
    const testCard = {
      config: {
        wide_screen_mode: true,
      },
      header: {
        title: {
          tag: 'plain_text',
          content: '🧪 飞书通知测试',
        },
        template: 'blue',
      },
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: `**测试时间**: ${new Date().toLocaleString('zh-CN', {
              timeZone: 'Asia/Shanghai',
            })}\n**测试区域**: ${region}\n\n这是一条测试消息，用于验证飞书 Webhook 配置是否正确。`,
          },
        },
      ],
    };

    const response = await axios.post(
      webhookUrl,
      {
        msg_type: 'interactive',
        card: testCard,
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      },
    );

    if (response.status === 200 && response.data.code === 0) {
      return { success: true };
    } else {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.data?.msg || '未知错误'}`,
      };
    }
  } catch (error) {
    if (error.response) {
      return {
        success: false,
        error: `HTTP ${error.response.status}: ${
          error.response.data?.msg || error.message
        }`,
      };
    } else {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

async function testFeishu() {
  const results = {
    passed: 0,
    failed: 0,
    warnings: 0,
  };

  console.log('\n' + '='.repeat(60));
  log('📱 飞书通知配置测试', 'blue');
  console.log('='.repeat(60) + '\n');

  const shouldSendTest =
    process.argv.includes('--send-test') || process.argv.includes('-t');

  // 检查数据库连接
  logInfo('检查数据库连接...');
  try {
    await query('SELECT 1');
    logSuccess('数据库连接正常');
    results.passed++;
  } catch (error) {
    logError(`数据库连接失败: ${error.message}`);
    results.failed++;
    console.log('');
    return results;
  }

  console.log('');

  // 查询飞书配置
  logInfo('查询飞书配置...');
  try {
    const configs = await FeishuConfig.findAll();

    if (configs.length === 0) {
      logWarning('未找到飞书配置');
      logInfo('提示: 可以通过前端系统设置页面或 API 配置飞书 Webhook');
      logInfo('API 示例: POST /api/v1/feishu-configs');
      results.warnings++;
    } else {
      logSuccess(`找到 ${configs.length} 条飞书配置`);

      for (const config of configs) {
        console.log('');
        logInfo(`区域: ${config.country}`);
        logInfo(`启用状态: ${config.enabled ? '已启用' : '已禁用'}`);

        if (!config.enabled) {
          logWarning('配置已禁用，不会发送通知');
          results.warnings++;
          continue;
        }

        if (!config.webhookUrl) {
          logError('Webhook URL 未设置');
          results.failed++;
          continue;
        }

        // 验证 URL 格式
        const urlValidation = validateWebhookUrl(config.webhookUrl);
        if (!urlValidation.valid) {
          logError(`Webhook URL 无效: ${urlValidation.error}`);
          results.failed++;
          continue;
        } else {
          logSuccess(`Webhook URL: ${config.webhookUrl.substring(0, 50)}...`);
          if (urlValidation.warning) {
            logWarning(urlValidation.warning);
            results.warnings++;
          }
          results.passed++;
        }

        // 发送测试消息（如果启用）
        if (shouldSendTest) {
          logInfo('发送测试消息...');
          const testResult = await sendTestMessage(
            config.webhookUrl,
            config.country,
          );

          if (testResult.success) {
            logSuccess('测试消息发送成功');
            logInfo('请检查飞书群聊是否收到测试消息');
            results.passed++;
          } else {
            logError(`测试消息发送失败: ${testResult.error}`);
            if (testResult.error.includes('11232')) {
              logWarning('错误代码 11232: 飞书限流，请稍后重试');
            }
            results.failed++;
          }
        } else {
          logInfo(
            '跳过测试消息发送（使用 --send-test 或 -t 参数可发送测试消息）',
          );
        }
      }
    }
  } catch (error) {
    if (error.code === 'ER_NO_SUCH_TABLE') {
      logError('飞书配置表不存在（可能数据库未初始化）');
      logInfo('提示: 请执行 server/database/init.sql 初始化数据库');
      results.failed++;
    } else {
      logError(`查询飞书配置失败: ${error.message}`);
      results.failed++;
    }
  }

  console.log('');

  // 配置说明
  logInfo('配置说明:');
  logInfo('  - 系统支持按区域配置飞书 Webhook（US 和 EU）');
  logInfo('  - EU 区域包括: UK, DE, FR, IT, ES');
  logInfo('  - 只有启用且配置了 Webhook URL 的区域才会发送通知');
  logInfo('  - 通知只在检测到异常 ASIN 时发送');

  console.log('');

  // 输出测试结果摘要
  console.log('='.repeat(60));
  log('📊 测试结果摘要', 'blue');
  console.log('='.repeat(60));
  logSuccess(`通过: ${results.passed} 项`);
  if (results.failed > 0) {
    logError(`失败: ${results.failed} 项`);
  }
  if (results.warnings > 0) {
    logWarning(`警告: ${results.warnings} 项`);
  }
  console.log('');

  if (results.failed > 0) {
    logError('飞书配置测试未完全通过');
    return 1;
  } else if (results.warnings > 0) {
    logWarning('飞书配置测试基本通过，但有一些警告');
    return 0;
  } else {
    logSuccess('飞书配置测试通过！');
    return 0;
  }
}

// 运行测试
testFeishu()
  .then((exitCode) => {
    process.exit(exitCode);
  })
  .catch((error) => {
    logError(`测试失败: ${error.message}`);
    console.error(error);
    process.exit(1);
  });
