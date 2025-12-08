/**
 * SP-API 配额实时监控脚本
 * 实时监控限流器的配额使用情况，显示剩余令牌数和使用率
 */

const rateLimiter = require('../src/services/rateLimiter');
const path = require('path');

// 从环境变量或默认值读取配额限制
const QUOTA_PER_MINUTE = Number(process.env.SP_API_RATE_LIMIT_PER_MINUTE) || 60;
const QUOTA_PER_HOUR = Number(process.env.SP_API_RATE_LIMIT_PER_HOUR) || 1000;

// 监控间隔（毫秒）
const MONITOR_INTERVAL = Number(process.env.QUOTA_MONITOR_INTERVAL) || 60000; // 默认60秒

// 颜色输出支持（Windows 10+ 支持ANSI颜色）
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function formatUsage(used, total, type = '') {
  const remaining = total - used;
  const usagePercent = (used / total) * 100;
  const remainingPercent = (remaining / total) * 100;

  // 选择颜色
  let color = colors.green;
  if (remainingPercent < 20) {
    color = colors.red;
  } else if (remainingPercent < 40) {
    color = colors.yellow;
  }

  const barLength = 30;
  const filledLength = Math.round((used / total) * barLength);
  const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);

  return {
    used,
    remaining,
    total,
    usagePercent: usagePercent.toFixed(1),
    remainingPercent: remainingPercent.toFixed(1),
    bar,
    color,
  };
}

function displayStatus() {
  try {
    const usStatus = rateLimiter.getStatus('US');
    const euStatus = rateLimiter.getStatus('EU');

    // 清屏（可选，如果不想清屏可以注释掉）
    // process.stdout.write('\x1b[2J\x1b[0f');

    console.log('\n' + '='.repeat(70));
    console.log(`${colors.bright}${colors.cyan}SP-API 配额实时监控${colors.reset}`);
    console.log('='.repeat(70));
    console.log(
      `${colors.gray}更新时间: ${new Date().toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
      })}${colors.reset}\n`,
    );

    // US区域状态
    const usMinute = formatUsage(
      QUOTA_PER_MINUTE - usStatus.minuteTokens,
      QUOTA_PER_MINUTE,
      'minute',
    );
    const usHour = formatUsage(
      QUOTA_PER_HOUR - usStatus.hourTokens,
      QUOTA_PER_HOUR,
      'hour',
    );

    console.log(`${colors.bright}US 区域${colors.reset}`);
    console.log('─'.repeat(70));
    console.log(`分钟配额: ${usMinute.color}${usStatus.minuteTokens}${colors.reset}/${QUOTA_PER_MINUTE} 剩余 (使用率: ${usMinute.color}${usMinute.usagePercent}%${colors.reset})`);
    console.log(`         [${usMinute.color}${usMinute.bar}${colors.reset}]`);
    console.log(`小时配额: ${usHour.color}${usStatus.hourTokens}${colors.reset}/${QUOTA_PER_HOUR.toLocaleString()} 剩余 (使用率: ${usHour.color}${usHour.usagePercent}%${colors.reset})`);
    console.log(`         [${usHour.color}${usHour.bar}${colors.reset}]\n`);

    // EU区域状态
    const euMinute = formatUsage(
      QUOTA_PER_MINUTE - euStatus.minuteTokens,
      QUOTA_PER_MINUTE,
      'minute',
    );
    const euHour = formatUsage(
      QUOTA_PER_HOUR - euStatus.hourTokens,
      QUOTA_PER_HOUR,
      'hour',
    );

    console.log(`${colors.bright}EU 区域${colors.reset}`);
    console.log('─'.repeat(70));
    console.log(`分钟配额: ${euMinute.color}${euStatus.minuteTokens}${colors.reset}/${QUOTA_PER_MINUTE} 剩余 (使用率: ${euMinute.color}${euMinute.usagePercent}%${colors.reset})`);
    console.log(`         [${euMinute.color}${euMinute.bar}${colors.reset}]`);
    console.log(`小时配额: ${euHour.color}${euStatus.hourTokens}${colors.reset}/${QUOTA_PER_HOUR.toLocaleString()} 剩余 (使用率: ${euHour.color}${euHour.usagePercent}%${colors.reset})`);
    console.log(`         [${euHour.color}${euHour.bar}${colors.reset}]\n`);

    // 状态总结
    const minRemainingPercent = Math.min(
      (usStatus.minuteTokens / QUOTA_PER_MINUTE) * 100,
      (euStatus.minuteTokens / QUOTA_PER_MINUTE) * 100,
    );
    const hourRemainingPercent = Math.min(
      (usStatus.hourTokens / QUOTA_PER_HOUR) * 100,
      (euStatus.hourTokens / QUOTA_PER_HOUR) * 100,
    );

    let statusColor = colors.green;
    let statusText = '✅ 健康';
    if (minRemainingPercent < 20 || hourRemainingPercent < 20) {
      statusColor = colors.red;
      statusText = '❌ 警告：配额不足';
    } else if (minRemainingPercent < 40 || hourRemainingPercent < 40) {
      statusColor = colors.yellow;
      statusText = '⚠️  注意：配额使用率较高';
    }

    console.log(`${colors.bright}总体状态: ${statusColor}${statusText}${colors.reset}`);
    console.log(`最低剩余: 分钟 ${minRemainingPercent.toFixed(1)}%, 小时 ${hourRemainingPercent.toFixed(1)}%\n`);

    console.log(`${colors.gray}按 Ctrl+C 停止监控${colors.reset}`);
    console.log('='.repeat(70) + '\n');
  } catch (error) {
    console.error(`${colors.red}❌ 获取配额状态失败:${colors.reset}`, error.message);
  }
}

// 首次显示
displayStatus();

// 定时显示
const interval = setInterval(displayStatus, MONITOR_INTERVAL);

// 优雅退出
process.on('SIGINT', () => {
  console.log(`\n${colors.yellow}监控已停止${colors.reset}\n`);
  clearInterval(interval);
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log(`\n${colors.yellow}监控已停止${colors.reset}\n`);
  clearInterval(interval);
  process.exit(0);
});

