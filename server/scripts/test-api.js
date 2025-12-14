#!/usr/bin/env node
/**
 * API 端点测试脚本
 * 测试 API 端点是否可访问和正常工作
 *
 * 使用方法: node scripts/test-api.js [--server-url=http://localhost:3001]
 */

const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

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

// 解析命令行参数
function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    serverUrl: process.env.API_BASE_URL || 'http://localhost:3001',
  };

  for (const arg of args) {
    if (arg.startsWith('--server-url=')) {
      config.serverUrl = arg.split('=')[1];
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
使用方法: node scripts/test-api.js [选项]

选项:
  --server-url=URL    指定服务器地址 (默认: http://localhost:3001)
  -h, --help          显示帮助信息

示例:
  node scripts/test-api.js
  node scripts/test-api.js --server-url=http://localhost:3001
      `);
      process.exit(0);
    }
  }

  return config;
}

async function testApiEndpoint(url, description) {
  try {
    const startTime = Date.now();
    const response = await axios.get(url, {
      timeout: 5000,
      validateStatus: (status) => status < 500, // 接受 4xx 但不接受 5xx
    });
    const duration = Date.now() - startTime;

    if (response.status === 200) {
      return {
        success: true,
        status: response.status,
        duration,
        data: response.data,
      };
    } else {
      return {
        success: false,
        status: response.status,
        duration,
        error: `HTTP ${response.status}`,
      };
    }
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      return {
        success: false,
        error: '连接被拒绝（服务器可能未运行）',
      };
    } else if (error.code === 'ETIMEDOUT') {
      return {
        success: false,
        error: '请求超时',
      };
    } else {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

async function testApi() {
  const config = parseArgs();
  const results = {
    passed: 0,
    failed: 0,
    warnings: 0,
  };

  console.log('\n' + '='.repeat(60));
  log('🌐 API 端点测试', 'blue');
  console.log('='.repeat(60) + '\n');

  logInfo(`服务器地址: ${config.serverUrl}`);
  console.log('');

  // 测试健康检查端点
  logInfo('测试健康检查端点...');
  const healthUrl = `${config.serverUrl}/health`;
  const healthResult = await testApiEndpoint(healthUrl, '健康检查');

  if (healthResult.success) {
    logSuccess(`健康检查端点: ${healthUrl}`);
    logInfo(`响应时间: ${healthResult.duration}ms`);
    if (healthResult.data) {
      if (healthResult.data.status === 'ok') {
        logSuccess('服务器状态: 正常');
      } else if (healthResult.data.status === 'degraded') {
        logWarning('服务器状态: 降级（部分功能可能不可用）');
        results.warnings++;
      }

      // 显示数据库状态
      if (healthResult.data.database) {
        if (healthResult.data.database.connected) {
          logSuccess('数据库连接: 正常');
        } else {
          logWarning('数据库连接: 失败');
          results.warnings++;
        }
      }

      // 显示内存使用
      if (healthResult.data.memory) {
        const mem = healthResult.data.memory;
        logInfo(
          `内存使用: ${mem.heapUsed}MB / ${mem.heapTotal}MB (${mem.usagePercent}%)`,
        );
        if (parseFloat(mem.usagePercent) > 90) {
          logWarning('内存使用率较高');
          results.warnings++;
        }
      }
    }
    results.passed++;
  } else {
    logError(`健康检查端点: ${healthUrl}`);
    if (healthResult.error) {
      logError(`错误: ${healthResult.error}`);
    }
    if (healthResult.status) {
      logError(`HTTP 状态码: ${healthResult.status}`);
    }
    results.failed++;
  }

  console.log('');

  // 测试 API v1 健康检查
  logInfo('测试 API v1 健康检查端点...');
  const apiHealthUrl = `${config.serverUrl}/api/v1/health`;
  const apiHealthResult = await testApiEndpoint(
    apiHealthUrl,
    'API v1 健康检查',
  );

  if (apiHealthResult.success) {
    logSuccess(`API v1 健康检查: ${apiHealthUrl}`);
    logInfo(`响应时间: ${apiHealthResult.duration}ms`);
    results.passed++;
  } else {
    logWarning(`API v1 健康检查: ${apiHealthUrl}`);
    if (apiHealthResult.error) {
      logWarning(`错误: ${apiHealthResult.error}`);
    }
    results.warnings++;
  }

  console.log('');

  // 测试 Prometheus metrics 端点
  logInfo('测试 Prometheus metrics 端点...');
  const metricsUrl = `${config.serverUrl}/metrics`;
  const metricsResult = await testApiEndpoint(metricsUrl, 'Prometheus metrics');

  if (metricsResult.success) {
    logSuccess(`Prometheus metrics: ${metricsUrl}`);
    logInfo(`响应时间: ${metricsResult.duration}ms`);
    results.passed++;
  } else {
    logWarning(`Prometheus metrics: ${metricsUrl}`);
    if (metricsResult.error) {
      logWarning(`错误: ${metricsResult.error}`);
    }
    results.warnings++;
  }

  console.log('');

  // 测试 404 端点（验证错误处理）
  logInfo('测试 404 错误处理...');
  const notFoundUrl = `${config.serverUrl}/api/v1/nonexistent`;
  const notFoundResult = await testApiEndpoint(notFoundUrl, '404 错误处理');

  if (notFoundResult.status === 404) {
    logSuccess('404 错误处理: 正常');
    results.passed++;
  } else {
    logWarning('404 错误处理: 未返回预期状态码');
    results.warnings++;
  }

  console.log('');

  // 测试 CORS 配置（如果可能）
  logInfo('测试 CORS 配置...');
  try {
    const corsTest = await axios.options(`${config.serverUrl}/health`, {
      headers: {
        Origin: 'http://localhost:8000',
        'Access-Control-Request-Method': 'GET',
      },
      timeout: 3000,
    });

    if (corsTest.headers['access-control-allow-origin']) {
      logSuccess('CORS 配置: 已启用');
      logInfo(`允许的源: ${corsTest.headers['access-control-allow-origin']}`);
      results.passed++;
    } else {
      logWarning('CORS 配置: 未检测到 CORS 头');
      results.warnings++;
    }
  } catch (error) {
    logInfo('CORS 测试: 跳过（无法测试）');
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

  if (results.failed > 0) {
    logError('API 测试未完全通过');
    logInfo('提示: 请确保后端服务正在运行');
    logInfo(`运行服务: cd server && npm start`);
    console.log('');
    return 1;
  } else if (results.warnings > 0) {
    logWarning('API 测试基本通过，但有一些警告');
    return 0;
  } else {
    logSuccess('API 测试通过！');
    return 0;
  }
}

// 运行测试
testApi()
  .then((exitCode) => {
    process.exit(exitCode);
  })
  .catch((error) => {
    logError(`测试失败: ${error.message}`);
    console.error(error);
    process.exit(1);
  });
