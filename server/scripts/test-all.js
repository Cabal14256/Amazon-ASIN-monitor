#!/usr/bin/env node
/**
 * 综合测试脚本
 * 运行所有测试脚本并生成测试报告
 *
 * 使用方法: node scripts/test-all.js
 */

const { spawn } = require('child_process');
const path = require('path');

// 颜色输出辅助函数
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
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

function logHeader(message) {
  log(`\n${message}`, 'magenta');
}

// 运行测试脚本
function runTest(scriptPath, scriptName) {
  return new Promise((resolve) => {
    logHeader(`\n${'='.repeat(60)}`);
    logHeader(`运行测试: ${scriptName}`);
    logHeader('='.repeat(60));

    const child = spawn('node', [scriptPath], {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit',
      shell: true,
    });

    child.on('close', (code) => {
      resolve(code === 0 ? 'passed' : 'failed');
    });

    child.on('error', (error) => {
      logError(`执行测试失败: ${error.message}`);
      resolve('error');
    });
  });
}

async function runAllTests() {
  const testResults = {
    passed: [],
    failed: [],
    errors: [],
  };

  console.log('\n' + '='.repeat(60));
  log('🧪 综合测试套件', 'blue');
  console.log('='.repeat(60));
  logInfo('开始运行所有测试脚本...\n');

  // 测试脚本列表（按执行顺序）
  const tests = [
    {
      name: '环境变量配置测试',
      path: path.join(__dirname, '../../scripts/test-env.js'),
      category: '基础设施',
    },
    {
      name: '数据库连接测试',
      path: path.join(__dirname, '../test-db-connection.js'),
      category: '基础设施',
    },
    {
      name: 'Redis 连接测试',
      path: path.join(__dirname, '../../scripts/check-redis.js'),
      category: '基础设施',
    },
    {
      name: '任务队列测试',
      path: path.join(__dirname, 'test-queue.js'),
      category: '服务',
    },
    {
      name: 'SP-API 配置测试',
      path: path.join(__dirname, 'test-sp-api.js'),
      category: '配置',
    },
    {
      name: '飞书通知配置测试',
      path: path.join(__dirname, 'test-feishu.js'),
      category: '配置',
    },
    {
      name: '用户认证测试',
      path: path.join(__dirname, 'test-auth.js'),
      category: '功能',
    },
    {
      name: 'API 端点测试',
      path: path.join(__dirname, 'test-api.js'),
      category: '功能',
    },
  ];

  // 按分类分组
  const testsByCategory = {};
  for (const test of tests) {
    if (!testsByCategory[test.category]) {
      testsByCategory[test.category] = [];
    }
    testsByCategory[test.category].push(test);
  }

  // 执行测试
  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;

  for (const [category, categoryTests] of Object.entries(testsByCategory)) {
    logHeader(`\n📦 ${category}测试`);
    logHeader('-'.repeat(60));

    for (const test of categoryTests) {
      totalTests++;
      const result = await runTest(test.path, test.name);

      if (result === 'passed') {
        testResults.passed.push(test.name);
        passedTests++;
      } else if (result === 'failed') {
        testResults.failed.push(test.name);
        failedTests++;
      } else {
        testResults.errors.push(test.name);
        failedTests++;
      }
    }
  }

  // 生成测试报告
  console.log('\n' + '='.repeat(60));
  log('📊 测试报告', 'blue');
  console.log('='.repeat(60) + '\n');

  logInfo(`总测试数: ${totalTests}`);
  logSuccess(
    `通过: ${passedTests} (${((passedTests / totalTests) * 100).toFixed(1)}%)`,
  );
  if (failedTests > 0) {
    logError(
      `失败: ${failedTests} (${((failedTests / totalTests) * 100).toFixed(
        1,
      )}%)`,
    );
  }

  console.log('');

  if (testResults.passed.length > 0) {
    logSuccess('通过的测试:');
    testResults.passed.forEach((test) => {
      log(`  ✅ ${test}`, 'green');
    });
    console.log('');
  }

  if (testResults.failed.length > 0) {
    logError('失败的测试:');
    testResults.failed.forEach((test) => {
      log(`  ❌ ${test}`, 'red');
    });
    console.log('');
  }

  if (testResults.errors.length > 0) {
    logError('执行错误的测试:');
    testResults.errors.forEach((test) => {
      log(`  ❌ ${test}`, 'red');
    });
    console.log('');
  }

  // 测试建议
  console.log('='.repeat(60));
  log('💡 测试建议', 'cyan');
  console.log('='.repeat(60) + '\n');

  if (failedTests === 0) {
    logSuccess('所有测试通过！系统配置正常。');
  } else {
    logWarning('部分测试失败，请检查以下事项:');
    console.log('');

    if (testResults.failed.some((t) => t.includes('环境变量'))) {
      logInfo('1. 检查环境变量配置:');
      logInfo('   - 运行: node scripts/test-env.js');
      logInfo('   - 确保 server/.env 文件已正确配置');
      console.log('');
    }

    if (testResults.failed.some((t) => t.includes('数据库'))) {
      logInfo('2. 检查数据库配置:');
      logInfo('   - 运行: cd server && node test-db-connection.js');
      logInfo('   - 确保 MySQL 服务正在运行');
      logInfo('   - 确保数据库已初始化: mysql < database/init.sql');
      console.log('');
    }

    if (testResults.failed.some((t) => t.includes('Redis'))) {
      logInfo('3. 检查 Redis 配置:');
      logInfo('   - 运行: node scripts/check-redis.js');
      logInfo('   - 确保 Redis 服务正在运行');
      console.log('');
    }

    if (testResults.failed.some((t) => t.includes('API'))) {
      logInfo('4. 检查 API 服务:');
      logInfo('   - 确保后端服务正在运行: cd server && npm start');
      logInfo('   - 检查服务器端口是否正确');
      console.log('');
    }

    logInfo('5. 查看详细错误信息:');
    logInfo('   - 单独运行失败的测试脚本');
    logInfo('   - 查看控制台输出的错误信息');
    console.log('');
  }

  // 返回退出码
  const exitCode = failedTests > 0 ? 1 : 0;
  console.log('='.repeat(60) + '\n');

  if (exitCode === 0) {
    logSuccess('🎉 所有测试通过！');
  } else {
    logError('❌ 部分测试失败，请检查并修复');
  }

  console.log('');
  return exitCode;
}

// 运行所有测试
runAllTests()
  .then((exitCode) => {
    process.exit(exitCode);
  })
  .catch((error) => {
    logError(`测试套件执行失败: ${error.message}`);
    console.error(error);
    process.exit(1);
  });
