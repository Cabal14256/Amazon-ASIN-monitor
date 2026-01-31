#!/usr/bin/env node
/**
 * 环境变量配置测试脚本
 * 检查项目必需的环境变量是否已正确配置
 *
 * 使用方法: node scripts/test-env.js
 */

const fs = require('fs');
const path = require('path');
const { loadEnv } = require('../server/scripts/utils/loadEnv');

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

// 必需的环境变量配置
const requiredEnvVars = {
  database: {
    DB_HOST: '数据库主机地址',
    DB_PORT: '数据库端口',
    DB_USER: '数据库用户名',
    DB_PASSWORD: '数据库密码',
    DB_NAME: '数据库名称',
  },
  server: {
    PORT: '服务器端口',
    JWT_SECRET: 'JWT密钥',
  },
  redis: {
    // Redis 可以通过 REDIS_URL 或单独配置项设置
  },
};

// 可选但推荐的环境变量
const recommendedEnvVars = {
  CORS_ORIGIN: 'CORS允许的源',
  NODE_ENV: 'Node.js环境',
  JWT_EXPIRES_IN: 'JWT过期时间',
  SP_API_RATE_LIMIT_PER_MINUTE: 'SP-API每分钟限流',
  SP_API_RATE_LIMIT_PER_HOUR: 'SP-API每小时限流',
};

async function testEnvConfig() {
  const results = {
    passed: 0,
    failed: 0,
    warnings: 0,
  };

  console.log('\n' + '='.repeat(60));
  log('🔍 环境变量配置检查', 'blue');
  console.log('='.repeat(60) + '\n');

  // 检查 .env 文件是否存在
  const envPath = path.join(__dirname, '../server/.env');
  const envTemplatePath = path.join(__dirname, '../server/env.template');

  logInfo('检查环境变量文件...');
  const envLoadResult = loadEnv(envPath);
  if (envLoadResult.loaded) {
    logSuccess(`找到 .env 文件: ${envLoadResult.path}`);
    if (!envLoadResult.usedDotenv) {
      logWarning('dotenv 不可用，已使用简化解析器加载 .env');
      results.warnings++;
    }
  } else {
    logError(`未找到 .env 文件: ${envLoadResult.path}`);
    logWarning('请复制 env.template 为 .env 并配置相应值');
    if (fs.existsSync(envTemplatePath)) {
      logInfo(`参考模板文件: ${envTemplatePath}`);
    }
    results.failed++;
  }

  console.log('');

  // 检查数据库配置
  logInfo('检查数据库配置...');
  const dbVars = requiredEnvVars.database;
  let dbConfigValid = true;

  for (const [key, description] of Object.entries(dbVars)) {
    const value = process.env[key];
    if (value && value.trim() !== '') {
      // 隐藏敏感信息
      if (key === 'DB_PASSWORD') {
        logSuccess(
          `${key} (${description}): 已设置 (${'*'.repeat(
            Math.min(value.length, 10),
          )})`,
        );
      } else {
        logSuccess(`${key} (${description}): ${value}`);
      }
      results.passed++;
    } else {
      logError(`${key} (${description}): 未设置`);
      dbConfigValid = false;
      results.failed++;
    }
  }

  if (!dbConfigValid) {
    logWarning('数据库配置不完整，可能无法连接数据库');
  }

  console.log('');

  // 检查服务器配置
  logInfo('检查服务器配置...');
  const serverVars = requiredEnvVars.server;

  for (const [key, description] of Object.entries(serverVars)) {
    const value = process.env[key];
    if (value && value.trim() !== '') {
      if (key === 'JWT_SECRET') {
        // 检查是否为默认值
        if (value.includes('change_this') || value.length < 16) {
          logWarning(
            `${key} (${description}): 已设置，但建议使用更强的密钥（至少16字符）`,
          );
          results.warnings++;
        } else {
          logSuccess(`${key} (${description}): 已设置 (${'*'.repeat(8)}...)`);
        }
      } else {
        logSuccess(`${key} (${description}): ${value}`);
      }
      results.passed++;
    } else {
      logError(`${key} (${description}): 未设置`);
      results.failed++;
    }
  }

  console.log('');

  // 检查 Redis 配置
  logInfo('检查 Redis 配置...');
  const redisUrl = process.env.REDIS_URL || process.env.REDIS_URI;
  const redisHost = process.env.REDIS_HOST;
  const redisPort = process.env.REDIS_PORT;

  if (redisUrl) {
    // 隐藏密码
    const safeUrl = redisUrl.replace(/:([^:@]+)@/, ':****@');
    logSuccess(`REDIS_URL: ${safeUrl}`);
    results.passed++;
  } else if (redisHost && redisPort) {
    logSuccess(`Redis 配置: ${redisHost}:${redisPort}`);
    if (process.env.REDIS_PASSWORD) {
      logInfo('Redis 密码: 已设置');
    }
    results.passed++;
  } else {
    logWarning('Redis 配置未设置（REDIS_URL 或 REDIS_HOST/REDIS_PORT）');
    logInfo('如果使用默认配置（127.0.0.1:6379），可以忽略此警告');
    results.warnings++;
  }

  console.log('');

  // 检查推荐配置
  logInfo('检查推荐配置...');
  for (const [key, description] of Object.entries(recommendedEnvVars)) {
    const value = process.env[key];
    if (value && value.trim() !== '') {
      logSuccess(`${key} (${description}): ${value}`);
      results.passed++;
    } else {
      logWarning(`${key} (${description}): 未设置（可选）`);
      results.warnings++;
    }
  }

  console.log('');

  // 检查 SP-API 配置（可选）
  logInfo('检查 SP-API 配置（可选）...');
  const spApiVars = [
    'SP_API_LWA_CLIENT_ID',
    'SP_API_LWA_CLIENT_SECRET',
    'SP_API_REFRESH_TOKEN',
    'SP_API_US_LWA_CLIENT_ID',
    'SP_API_EU_LWA_CLIENT_ID',
  ];

  let hasSpApiConfig = false;
  for (const key of spApiVars) {
    if (process.env[key] && process.env[key].trim() !== '') {
      hasSpApiConfig = true;
      break;
    }
  }

  if (hasSpApiConfig) {
    logSuccess('SP-API 配置已设置（部分或全部）');
    results.passed++;
  } else {
    logInfo('SP-API 配置未设置（可通过前端系统设置页面配置）');
  }

  console.log('');

  // 检查 SP-API AWS 签名配置（仅在启用时校验）
  const useAwsSignature = process.env.SP_API_USE_AWS_SIGNATURE === 'true';
  if (useAwsSignature) {
    logInfo('检测到启用 AWS 签名，检查 AWS 凭证配置...');
    const awsVars = [
      'SP_API_ACCESS_KEY_ID',
      'SP_API_SECRET_ACCESS_KEY',
      'SP_API_ROLE_ARN',
    ];
    let awsConfigValid = true;
    for (const key of awsVars) {
      const value = process.env[key];
      if (value && value.trim() !== '') {
        logSuccess(`${key}: 已设置`);
        results.passed++;
      } else {
        logError(`${key}: 未设置（启用 AWS 签名时必填）`);
        awsConfigValid = false;
        results.failed++;
      }
    }
    if (!awsConfigValid) {
      logWarning('AWS 签名配置不完整，SP-API 调用可能失败');
    }
    console.log('');
  }

  // 检查竞品数据库配置（可选）
  logInfo('检查竞品数据库配置（可选）...');
  const competitorDbVars = ['COMPETITOR_DB_HOST', 'COMPETITOR_DB_NAME'];

  let hasCompetitorDb = false;
  for (const key of competitorDbVars) {
    if (process.env[key] && process.env[key].trim() !== '') {
      hasCompetitorDb = true;
      break;
    }
  }

  if (hasCompetitorDb) {
    logSuccess('竞品数据库配置已设置');
    results.passed++;
  } else {
    logInfo('竞品数据库配置未设置（将使用主数据库配置）');
  }

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

  // 返回退出码
  if (results.failed > 0) {
    logError('环境变量配置不完整，请检查并修复');
    console.log('');
    return 1;
  } else if (results.warnings > 0) {
    logWarning('环境变量配置基本完整，但有一些建议项未设置');
    console.log('');
    return 0;
  } else {
    logSuccess('环境变量配置检查通过！');
    console.log('');
    return 0;
  }
}

// 运行测试
testEnvConfig()
  .then((exitCode) => {
    process.exit(exitCode);
  })
  .catch((error) => {
    logError(`测试失败: ${error.message}`);
    console.error(error);
    process.exit(1);
  });
