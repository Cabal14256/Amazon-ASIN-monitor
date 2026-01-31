/**
 * 测试定时任务和飞书通知功能
 * 使用方法: node test-scheduler.js [country1] [country2] ...
 * 示例: node test-scheduler.js US UK
 */

const path = require('path');
const { loadEnv } = require('./scripts/utils/loadEnv');

loadEnv(path.join(__dirname, '.env'));
const { triggerManualCheck } = require('./src/services/schedulerService');

async function test() {
  const countries = process.argv.slice(2);

  console.log('🧪 开始测试定时任务...\n');

  if (countries.length > 0) {
    console.log(`📋 检查指定国家: ${countries.join(', ')}\n`);
    await triggerManualCheck(countries);
  } else {
    console.log('📋 检查所有国家\n');
    await triggerManualCheck();
  }

  console.log('\n✅ 测试完成');
  process.exit(0);
}

test().catch((error) => {
  console.error('❌ 测试失败:', error);
  process.exit(1);
});
