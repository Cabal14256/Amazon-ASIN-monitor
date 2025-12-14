#!/usr/bin/env node
/**
 * 前端构建测试脚本
 * 测试前端项目是否能正常构建
 *
 * 使用方法: node scripts/test-build.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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

async function testBuild() {
  const results = {
    passed: 0,
    failed: 0,
    warnings: 0,
  };

  console.log('\n' + '='.repeat(60));
  log('🔨 前端构建测试', 'blue');
  console.log('='.repeat(60) + '\n');

  const projectRoot = path.join(__dirname, '..');
  const distPath = path.join(projectRoot, 'dist');
  const packageJsonPath = path.join(projectRoot, 'package.json');

  // 检查 package.json 是否存在
  logInfo('检查项目配置...');
  if (!fs.existsSync(packageJsonPath)) {
    logError('未找到 package.json 文件');
    results.failed++;
    return results;
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    logSuccess('找到 package.json');
    results.passed++;

    // 检查是否有 build 脚本
    if (!packageJson.scripts || !packageJson.scripts.build) {
      logWarning('package.json 中未找到 build 脚本');
      results.warnings++;
    } else {
      logSuccess(`找到 build 脚本: ${packageJson.scripts.build}`);
      results.passed++;
    }
  } catch (error) {
    logError(`读取 package.json 失败: ${error.message}`);
    results.failed++;
    return results;
  }

  console.log('');

  // 检查 node_modules 是否存在
  logInfo('检查依赖安装...');
  const nodeModulesPath = path.join(projectRoot, 'node_modules');
  if (fs.existsSync(nodeModulesPath)) {
    logSuccess('找到 node_modules 目录');
    results.passed++;
  } else {
    logWarning('未找到 node_modules 目录');
    logInfo('请先运行: npm install');
    results.warnings++;
  }

  console.log('');

  // 询问是否执行构建（可选）
  logInfo('构建测试选项:');
  logInfo('1. 仅检查构建输出目录（不执行构建）');
  logInfo('2. 执行完整构建测试（需要时间）');
  logWarning('注意: 执行构建会生成 dist 目录，可能需要几分钟时间\n');

  // 默认只检查，不执行构建
  const shouldBuild =
    process.argv.includes('--build') || process.argv.includes('-b');

  if (shouldBuild) {
    logInfo('执行构建测试...');
    try {
      // 切换到项目根目录
      process.chdir(projectRoot);

      // 执行构建
      logInfo('正在执行: npm run build');
      execSync('npm run build', {
        stdio: 'inherit',
        cwd: projectRoot,
      });

      logSuccess('构建完成');
      results.passed++;
    } catch (error) {
      logError(`构建失败: ${error.message}`);
      results.failed++;
    }
  } else {
    logInfo('跳过构建执行（使用 --build 或 -b 参数可执行完整构建）');
  }

  console.log('');

  // 检查构建输出
  logInfo('检查构建输出...');
  if (fs.existsSync(distPath)) {
    logSuccess(`找到构建输出目录: ${distPath}`);
    results.passed++;

    // 检查关键文件
    const indexHtmlPath = path.join(distPath, 'index.html');
    if (fs.existsSync(indexHtmlPath)) {
      logSuccess('找到 index.html');
      results.passed++;
    } else {
      logWarning('未找到 index.html');
      results.warnings++;
    }

    // 检查静态资源目录
    const staticDirs = ['static', 'assets', 'js', 'css'];
    let foundStatic = false;
    for (const dir of staticDirs) {
      const dirPath = path.join(distPath, dir);
      if (fs.existsSync(dirPath)) {
        foundStatic = true;
        break;
      }
    }

    if (foundStatic) {
      logSuccess('找到静态资源目录');
      results.passed++;
    } else {
      logWarning('未找到静态资源目录');
      results.warnings++;
    }

    // 统计文件数量
    try {
      const files = fs.readdirSync(distPath, { recursive: true });
      const fileCount = files.filter((file) => {
        const filePath = path.join(distPath, file);
        return fs.statSync(filePath).isFile();
      }).length;

      logInfo(`构建产物文件数量: ${fileCount}`);
    } catch (error) {
      logWarning(`无法统计文件数量: ${error.message}`);
    }
  } else {
    logWarning('未找到构建输出目录');
    logInfo('如果尚未执行构建，这是正常的');
    logInfo('运行构建: npm run build');
    results.warnings++;
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
    logError('构建测试未完全通过');
    return 1;
  } else if (results.warnings > 0) {
    logWarning('构建测试基本通过，但有一些警告');
    return 0;
  } else {
    logSuccess('构建测试通过！');
    return 0;
  }
}

// 运行测试
testBuild()
  .then((exitCode) => {
    process.exit(exitCode);
  })
  .catch((error) => {
    logError(`测试失败: ${error.message}`);
    console.error(error);
    process.exit(1);
  });
