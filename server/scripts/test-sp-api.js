#!/usr/bin/env node
/**
 * SP-API 配置测试脚本
 * 测试 Amazon SP-API 配置是否正确
 *
 * 使用方法: node scripts/test-sp-api.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const SPAPIConfig = require('../src/models/SpApiConfig');
const { query } = require('../src/config/database');

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

// 检查环境变量中的 SP-API 配置
function checkEnvSpApiConfig() {
  const configs = {
    global: {},
    us: {},
    eu: {},
  };

  // 全局配置
  if (process.env.SP_API_LWA_CLIENT_ID) {
    configs.global.clientId = process.env.SP_API_LWA_CLIENT_ID;
  }
  if (process.env.SP_API_LWA_CLIENT_SECRET) {
    configs.global.clientSecret = process.env.SP_API_LWA_CLIENT_SECRET;
  }
  if (process.env.SP_API_REFRESH_TOKEN) {
    configs.global.refreshToken = process.env.SP_API_REFRESH_TOKEN;
  }

  // US 区域配置
  if (process.env.SP_API_US_LWA_CLIENT_ID) {
    configs.us.clientId = process.env.SP_API_US_LWA_CLIENT_ID;
  }
  if (process.env.SP_API_US_LWA_CLIENT_SECRET) {
    configs.us.clientSecret = process.env.SP_API_US_LWA_CLIENT_SECRET;
  }
  if (process.env.SP_API_US_REFRESH_TOKEN) {
    configs.us.refreshToken = process.env.SP_API_US_REFRESH_TOKEN;
  }

  // EU 区域配置
  if (process.env.SP_API_EU_LWA_CLIENT_ID) {
    configs.eu.clientId = process.env.SP_API_EU_LWA_CLIENT_ID;
  }
  if (process.env.SP_API_EU_LWA_CLIENT_SECRET) {
    configs.eu.clientSecret = process.env.SP_API_EU_LWA_CLIENT_SECRET;
  }
  if (process.env.SP_API_EU_REFRESH_TOKEN) {
    configs.eu.refreshToken = process.env.SP_API_EU_REFRESH_TOKEN;
  }

  // AWS 配置
  if (process.env.SP_API_ACCESS_KEY_ID) {
    configs.aws = {
      accessKeyId: process.env.SP_API_ACCESS_KEY_ID,
      secretAccessKey: process.env.SP_API_SECRET_ACCESS_KEY,
      roleArn: process.env.SP_API_ROLE_ARN,
    };
  }

  return configs;
}

// 检查数据库中的 SP-API 配置
async function checkDbSpApiConfig() {
  try {
    const configs = await SPAPIConfig.findAll();
    return configs;
  } catch (error) {
    if (error.code === 'ER_NO_SUCH_TABLE') {
      return null; // 表不存在
    }
    throw error;
  }
}

// 验证配置完整性
function validateConfig(config, region = '') {
  const issues = [];
  const regionLabel = region ? ` (${region})` : '';

  if (!config.clientId) {
    issues.push(`缺少 Client ID${regionLabel}`);
  } else if (config.clientId.length < 10) {
    issues.push(`Client ID${regionLabel} 格式可能不正确`);
  }

  if (!config.clientSecret) {
    issues.push(`缺少 Client Secret${regionLabel}`);
  } else if (config.clientSecret.length < 10) {
    issues.push(`Client Secret${regionLabel} 格式可能不正确`);
  }

  if (!config.refreshToken) {
    issues.push(`缺少 Refresh Token${regionLabel}`);
  } else if (config.refreshToken.length < 10) {
    issues.push(`Refresh Token${regionLabel} 格式可能不正确`);
  }

  return issues;
}

async function testSpApi() {
  const results = {
    passed: 0,
    failed: 0,
    warnings: 0,
  };

  console.log('\n' + '='.repeat(60));
  log('🔐 SP-API 配置测试', 'blue');
  console.log('='.repeat(60) + '\n');

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

  // 检查环境变量配置
  logInfo('检查环境变量配置...');
  const envConfigs = checkEnvSpApiConfig();
  let hasEnvConfig = false;

  if (
    envConfigs.global.clientId ||
    envConfigs.us.clientId ||
    envConfigs.eu.clientId
  ) {
    hasEnvConfig = true;
    logSuccess('找到环境变量中的 SP-API 配置');

    // 检查全局配置
    if (envConfigs.global.clientId) {
      logInfo('全局配置:');
      const globalIssues = validateConfig(envConfigs.global);
      if (globalIssues.length === 0) {
        logSuccess('  - 全局配置完整');
        results.passed++;
      } else {
        logWarning(`  - 全局配置问题: ${globalIssues.join(', ')}`);
        results.warnings++;
      }
    }

    // 检查 US 区域配置
    if (envConfigs.us.clientId) {
      logInfo('US 区域配置:');
      const usIssues = validateConfig(envConfigs.us, 'US');
      if (usIssues.length === 0) {
        logSuccess('  - US 区域配置完整');
        results.passed++;
      } else {
        logWarning(`  - US 区域配置问题: ${usIssues.join(', ')}`);
        results.warnings++;
      }
    }

    // 检查 EU 区域配置
    if (envConfigs.eu.clientId) {
      logInfo('EU 区域配置:');
      const euIssues = validateConfig(envConfigs.eu, 'EU');
      if (euIssues.length === 0) {
        logSuccess('  - EU 区域配置完整');
        results.passed++;
      } else {
        logWarning(`  - EU 区域配置问题: ${euIssues.join(', ')}`);
        results.warnings++;
      }
    }

    // 检查 AWS 配置
    if (envConfigs.aws) {
      logInfo('AWS 配置:');
      if (
        envConfigs.aws.accessKeyId &&
        envConfigs.aws.secretAccessKey &&
        envConfigs.aws.roleArn
      ) {
        logSuccess('  - AWS 配置完整');
        results.passed++;
      } else {
        logWarning(
          '  - AWS 配置不完整（需要 Access Key ID, Secret Access Key 和 Role ARN）',
        );
        results.warnings++;
      }
    }

    // 检查是否启用 AWS 签名
    const useAwsSignature = process.env.SP_API_USE_AWS_SIGNATURE === 'true';
    if (useAwsSignature) {
      logInfo('AWS 签名模式: 已启用');
      if (!envConfigs.aws) {
        logWarning('  - 已启用 AWS 签名但未配置 AWS 凭证');
        results.warnings++;
      }
    } else {
      logInfo('AWS 签名模式: 未启用（简化模式）');
    }
  } else {
    logWarning('未找到环境变量中的 SP-API 配置');
    results.warnings++;
  }

  console.log('');

  // 检查数据库配置
  logInfo('检查数据库配置...');
  try {
    const dbConfigs = await checkDbSpApiConfig();

    if (dbConfigs === null) {
      logWarning('SP-API 配置表不存在（可能数据库未初始化）');
      results.warnings++;
    } else if (dbConfigs.length === 0) {
      logWarning('数据库中没有 SP-API 配置');
      logInfo('提示: 可以通过前端系统设置页面配置 SP-API');
      results.warnings++;
    } else {
      logSuccess(`找到 ${dbConfigs.length} 条数据库配置`);

      // 分析配置
      const configMap = {};
      for (const config of dbConfigs) {
        const key = config.config_key;
        if (!configMap[key]) {
          configMap[key] = [];
        }
        configMap[key].push(config);
      }

      // 检查关键配置项
      const requiredKeys = [
        'SP_API_LWA_CLIENT_ID',
        'SP_API_LWA_CLIENT_SECRET',
        'SP_API_REFRESH_TOKEN',
      ];

      for (const key of requiredKeys) {
        if (configMap[key] && configMap[key].length > 0) {
          const value = configMap[key][0].config_value;
          if (value && value.trim() !== '') {
            logSuccess(`  - ${key}: 已配置`);
            results.passed++;
          } else {
            logWarning(`  - ${key}: 配置为空`);
            results.warnings++;
          }
        } else {
          logWarning(`  - ${key}: 未配置`);
          results.warnings++;
        }
      }
    }
  } catch (error) {
    logError(`检查数据库配置失败: ${error.message}`);
    results.failed++;
  }

  console.log('');

  // 配置优先级说明
  logInfo('配置优先级说明:');
  logInfo('  1. 数据库配置（优先）');
  logInfo('  2. 环境变量配置（备用）');
  logInfo('  3. 区域配置优先于全局配置');

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
    logError('SP-API 配置测试未完全通过');
    return 1;
  } else if (results.warnings > 0) {
    logWarning('SP-API 配置测试基本通过，但有一些警告');
    logInfo('提示: 可以通过前端系统设置页面或环境变量配置 SP-API');
    return 0;
  } else {
    logSuccess('SP-API 配置测试通过！');
    return 0;
  }
}

// 运行测试
testSpApi()
  .then((exitCode) => {
    process.exit(exitCode);
  })
  .catch((error) => {
    logError(`测试失败: ${error.message}`);
    console.error(error);
    process.exit(1);
  });
