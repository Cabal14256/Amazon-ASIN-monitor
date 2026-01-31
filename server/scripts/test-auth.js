#!/usr/bin/env node
/**
 * 用户认证测试脚本
 * 测试用户认证功能是否正常
 *
 * 使用方法: node scripts/test-auth.js [--test-login]
 */

const path = require('path');
const { loadEnv } = require('./utils/loadEnv');

loadEnv(path.join(__dirname, '../.env'));

const User = require('../src/models/User');
const { query } = require('../src/config/database');
const jwt = require('jsonwebtoken');
const { secret } = require('../src/config/jwt');
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

async function testAuth() {
  const results = {
    passed: 0,
    failed: 0,
    warnings: 0,
  };

  console.log('\n' + '='.repeat(60));
  log('🔐 用户认证测试', 'blue');
  console.log('='.repeat(60) + '\n');

  const shouldTestLogin =
    process.argv.includes('--test-login') || process.argv.includes('-l');
  const serverUrl = process.env.API_BASE_URL || 'http://localhost:3001';

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

  // 检查用户表是否存在
  logInfo('检查用户表...');
  try {
    const tableCheck = await query(`
      SELECT COUNT(*) as count 
      FROM information_schema.tables 
      WHERE table_schema = DATABASE() 
      AND table_name = 'users'
    `);

    if (tableCheck[0].count === 0) {
      logError('用户表不存在');
      logInfo('提示: 请执行 server/database/init.sql 初始化数据库');
      results.failed++;
      console.log('');
      return results;
    } else {
      logSuccess('用户表存在');
      results.passed++;
    }
  } catch (error) {
    logError(`检查用户表失败: ${error.message}`);
    results.failed++;
    console.log('');
    return results;
  }

  console.log('');

  // 检查是否有用户
  logInfo('检查用户数据...');
  try {
    const userCount = await query('SELECT COUNT(*) as count FROM users');
    const count = userCount[0].count;

    if (count === 0) {
      logWarning('数据库中没有任何用户');
      logInfo('提示: 请运行 node init-admin-user.js 创建管理员用户');
      results.warnings++;
    } else {
      logSuccess(`找到 ${count} 个用户`);
      results.passed++;

      // 检查管理员用户
      const adminUsers = await query(`
        SELECT u.*, GROUP_CONCAT(r.name) as roles
        FROM users u
        LEFT JOIN user_roles ur ON u.id = ur.user_id
        LEFT JOIN roles r ON ur.role_id = r.id
        WHERE u.status = 1
        GROUP BY u.id
        HAVING roles LIKE '%ADMIN%' OR roles LIKE '%管理员%'
        LIMIT 5
      `);

      if (adminUsers.length === 0) {
        logWarning('未找到管理员用户');
        logInfo('提示: 请运行 node init-admin-user.js 创建管理员用户');
        results.warnings++;
      } else {
        logSuccess(`找到 ${adminUsers.length} 个管理员用户`);
        results.passed++;
      }

      // 显示用户统计
      const activeUsers = await query(
        'SELECT COUNT(*) as count FROM users WHERE status = 1',
      );
      const inactiveUsers = await query(
        'SELECT COUNT(*) as count FROM users WHERE status = 0',
      );
      logInfo(
        `活跃用户: ${activeUsers[0].count}, 禁用用户: ${inactiveUsers[0].count}`,
      );
    }
  } catch (error) {
    logError(`查询用户数据失败: ${error.message}`);
    results.failed++;
  }

  console.log('');

  // 检查 JWT 配置
  logInfo('检查 JWT 配置...');
  try {
    if (!secret || secret.trim() === '') {
      logError('JWT Secret 未配置');
      logInfo('提示: 请在 .env 文件中设置 JWT_SECRET');
      results.failed++;
    } else {
      if (secret.includes('change_this') || secret.length < 16) {
        logWarning('JWT Secret 可能不安全（建议使用至少16字符的强密钥）');
        results.warnings++;
      } else {
        logSuccess('JWT Secret 已配置');
        results.passed++;
      }

      // 测试 JWT 生成和验证
      try {
        const testPayload = { userId: 'test', username: 'test' };
        const token = jwt.sign(testPayload, secret, { expiresIn: '1h' });
        const decoded = jwt.verify(token, secret);

        if (decoded.userId === testPayload.userId) {
          logSuccess('JWT 生成和验证正常');
          results.passed++;
        } else {
          logError('JWT 验证失败');
          results.failed++;
        }
      } catch (error) {
        logError(`JWT 测试失败: ${error.message}`);
        results.failed++;
      }
    }
  } catch (error) {
    logError(`检查 JWT 配置失败: ${error.message}`);
    results.failed++;
  }

  console.log('');

  // 检查角色和权限表
  logInfo('检查角色和权限表...');
  try {
    const roleCount = await query('SELECT COUNT(*) as count FROM roles');
    const permissionCount = await query(
      'SELECT COUNT(*) as count FROM permissions',
    );

    if (roleCount[0].count === 0) {
      logWarning('角色表为空');
      results.warnings++;
    } else {
      logSuccess(`找到 ${roleCount[0].count} 个角色`);
      results.passed++;
    }

    if (permissionCount[0].count === 0) {
      logWarning('权限表为空');
      results.warnings++;
    } else {
      logSuccess(`找到 ${permissionCount[0].count} 个权限`);
      results.passed++;
    }
  } catch (error) {
    if (error.code === 'ER_NO_SUCH_TABLE') {
      logWarning('角色或权限表不存在（可能数据库未完全初始化）');
      results.warnings++;
    } else {
      logError(`检查角色和权限表失败: ${error.message}`);
      results.failed++;
    }
  }

  console.log('');

  // 测试登录 API（如果启用）
  if (shouldTestLogin) {
    logInfo('测试登录 API...');
    logWarning('注意: 需要提供有效的用户名和密码');

    // 尝试查找一个测试用户
    try {
      const testUsers = await query(
        'SELECT username FROM users WHERE status = 1 LIMIT 1',
      );
      if (testUsers.length > 0) {
        logInfo(`找到测试用户: ${testUsers[0].username}`);
        logInfo('提示: 使用实际用户名和密码测试登录');
        logInfo(`API 端点: POST ${serverUrl}/api/v1/auth/login`);
      } else {
        logWarning('没有可用的测试用户');
      }
    } catch (error) {
      logWarning(`无法查找测试用户: ${error.message}`);
    }

    // 测试 API 端点是否可访问
    try {
      const response = await axios.post(
        `${serverUrl}/api/v1/auth/login`,
        { username: 'test', password: 'test' },
        { validateStatus: () => true, timeout: 5000 },
      );

      if (response.status === 400 || response.status === 401) {
        logSuccess('登录 API 端点可访问（返回预期的错误响应）');
        results.passed++;
      } else if (response.status === 200) {
        logWarning('登录 API 返回成功（可能使用了默认密码）');
        results.warnings++;
      } else {
        logWarning(`登录 API 返回意外状态码: ${response.status}`);
        results.warnings++;
      }
    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        logWarning('无法连接到服务器（服务器可能未运行）');
        logInfo(`提示: 启动服务器: cd server && npm start`);
        results.warnings++;
      } else {
        logWarning(`测试登录 API 失败: ${error.message}`);
        results.warnings++;
      }
    }
  } else {
    logInfo('跳过登录 API 测试（使用 --test-login 或 -l 参数可测试）');
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
    logError('用户认证测试未完全通过');
    return 1;
  } else if (results.warnings > 0) {
    logWarning('用户认证测试基本通过，但有一些警告');
    return 0;
  } else {
    logSuccess('用户认证测试通过！');
    return 0;
  }
}

// 运行测试
testAuth()
  .then((exitCode) => {
    process.exit(exitCode);
  })
  .catch((error) => {
    logError(`测试失败: ${error.message}`);
    console.error(error);
    process.exit(1);
  });
