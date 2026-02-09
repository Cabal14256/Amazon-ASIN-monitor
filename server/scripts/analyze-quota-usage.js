/**
 * SP-API 配额使用分析脚本
 * 分析数据库中的ASIN数量，计算预计的API调用频率，评估配额是否充足
 */

const mysql = require('mysql2/promise');
const path = require('path');
const { loadEnv } = require('./utils/loadEnv');

loadEnv(path.join(__dirname, '../.env'));

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'amazon_asin_monitor',
  charset: 'utf8mb4',
  timezone: '+08:00',
};

// 配额限制（从限流器配置读取）
const QUOTA_PER_MINUTE = Number(process.env.SP_API_RATE_LIMIT_PER_MINUTE) || 60;
const QUOTA_PER_HOUR = Number(process.env.SP_API_RATE_LIMIT_PER_HOUR) || 1000;

// 调度配置
const MONITOR_BATCH_COUNT = Number(process.env.MONITOR_BATCH_COUNT) || 1;
const MONITOR_US_SCHEDULE_MINUTES =
  Number(process.env.MONITOR_US_SCHEDULE_MINUTES) || 30;
const MONITOR_EU_SCHEDULE_MINUTES =
  Number(process.env.MONITOR_EU_SCHEDULE_MINUTES) || 60;

async function analyzeQuotaUsage() {
  let connection;

  try {
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ 数据库连接成功\n');

    // 查询各国家ASIN数量
    const [asinsByCountry] = await connection.execute(`
      SELECT country, COUNT(*) as asin_count 
      FROM asins 
      GROUP BY country
      ORDER BY country
    `);

    // 查询变体组数量
    const [groupsByCountry] = await connection.execute(`
      SELECT country, COUNT(*) as group_count
      FROM variant_groups
      GROUP BY country
      ORDER BY country
    `);

    // 查询竞品ASIN数量
    let competitorAsinsByCountry = [];
    try {
      const [competitorAsins] = await connection.execute(`
        SELECT country, COUNT(*) as asin_count 
        FROM competitor_asins 
        GROUP BY country
        ORDER BY country
      `);
      competitorAsinsByCountry = competitorAsins;
    } catch (error) {
      // 竞品表可能不存在，忽略
      console.log('ℹ️  竞品ASIN表不存在或无法访问，跳过竞品分析\n');
    }

    console.log('='.repeat(60));
    console.log('📊 SP-API 配额使用分析报告');
    console.log('='.repeat(60));
    console.log(
      `分析时间: ${new Date().toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
      })}\n`,
    );

    // 统计区域数据
    const regionStats = {
      US: { asins: 0, groups: 0, competitorAsins: 0, countries: [] },
      EU: { asins: 0, groups: 0, competitorAsins: 0, countries: [] },
    };

    // 统计标准ASIN
    asinsByCountry.forEach((row) => {
      if (row.country === 'US') {
        regionStats.US.asins += row.asin_count;
        if (!regionStats.US.countries.includes('US')) {
          regionStats.US.countries.push('US');
        }
      } else if (['UK', 'DE', 'FR', 'IT', 'ES'].includes(row.country)) {
        regionStats.EU.asins += row.asin_count;
        if (!regionStats.EU.countries.includes(row.country)) {
          regionStats.EU.countries.push(row.country);
        }
      }
    });

    // 统计变体组
    groupsByCountry.forEach((row) => {
      if (row.country === 'US') {
        regionStats.US.groups += row.group_count;
      } else if (['UK', 'DE', 'FR', 'IT', 'ES'].includes(row.country)) {
        regionStats.EU.groups += row.group_count;
      }
    });

    // 统计竞品ASIN
    competitorAsinsByCountry.forEach((row) => {
      if (row.country === 'US') {
        regionStats.US.competitorAsins += row.asin_count;
      } else if (['UK', 'DE', 'FR', 'IT', 'ES'].includes(row.country)) {
        regionStats.EU.competitorAsins += row.asin_count;
      }
    });

    // 显示数据统计
    console.log('📈 数据统计：');
    console.log('─'.repeat(60));
    console.log(`US区域 (${regionStats.US.countries.join(', ') || '无'}):`);
    console.log(`  - 标准ASIN: ${regionStats.US.asins.toLocaleString()} 个`);
    console.log(
      `  - 竞品ASIN: ${regionStats.US.competitorAsins.toLocaleString()} 个`,
    );
    console.log(`  - 变体组: ${regionStats.US.groups.toLocaleString()} 个`);
    console.log(`EU区域 (${regionStats.EU.countries.join(', ') || '无'}):`);
    console.log(`  - 标准ASIN: ${regionStats.EU.asins.toLocaleString()} 个`);
    console.log(
      `  - 竞品ASIN: ${regionStats.EU.competitorAsins.toLocaleString()} 个`,
    );
    console.log(`  - 变体组: ${regionStats.EU.groups.toLocaleString()} 个`);
    console.log(`总计:`);
    const totalAsins = regionStats.US.asins + regionStats.EU.asins;
    const totalCompetitorAsins =
      regionStats.US.competitorAsins + regionStats.EU.competitorAsins;
    console.log(`  - 标准ASIN: ${totalAsins.toLocaleString()} 个`);
    console.log(`  - 竞品ASIN: ${totalCompetitorAsins.toLocaleString()} 个`);
    console.log(
      `  - 总ASIN: ${(
        totalAsins + totalCompetitorAsins
      ).toLocaleString()} 个\n`,
    );

    // 计算配额使用
    // US/EU 区域按配置的分钟间隔执行
    // 标准监控 + 竞品监控 = 双倍调用

    const usTotalAsins = regionStats.US.asins + regionStats.US.competitorAsins;
    const euTotalAsins = regionStats.EU.asins + regionStats.EU.competitorAsins;

    // 如果不分批，计算高峰期的调用
    let usCallsPerHour, euCallsPerHour;
    const usRunsPerHour = 60 / MONITOR_US_SCHEDULE_MINUTES;
    const euRunsPerHour = 60 / MONITOR_EU_SCHEDULE_MINUTES;
    if (MONITOR_BATCH_COUNT === 1) {
      // 不分批：每次任务检查所有ASIN
      usCallsPerHour = usTotalAsins * usRunsPerHour * 2;
      euCallsPerHour = euTotalAsins * euRunsPerHour * 2;
    } else {
      // 分批：每次任务只检查 1/MONITOR_BATCH_COUNT 的ASIN
      usCallsPerHour = (usTotalAsins / MONITOR_BATCH_COUNT) * usRunsPerHour * 2;
      euCallsPerHour = (euTotalAsins / MONITOR_BATCH_COUNT) * euRunsPerHour * 2;
    }

    const usCallsPerMinute = usCallsPerHour / 60;
    const euCallsPerMinute = euCallsPerHour / 60;

    // 总计
    const totalCallsPerHour = usCallsPerHour + euCallsPerHour;
    const totalCallsPerMinute = usCallsPerMinute + euCallsPerMinute;

    console.log('📊 预计API调用频率：');
    console.log('─'.repeat(60));
    console.log('调度配置：');
    console.log(
      `  - US区域: 每${MONITOR_US_SCHEDULE_MINUTES}分钟执行 (${usRunsPerHour} 次/小时)`,
    );
    console.log(
      `  - EU区域: 每${MONITOR_EU_SCHEDULE_MINUTES}分钟执行 (${euRunsPerHour} 次/小时)`,
    );
    console.log(`  - 任务类型: 标准监控 + 竞品监控（双倍调用）`);
    console.log(
      `  - 分批处理: ${
        MONITOR_BATCH_COUNT === 1
          ? '未启用'
          : `已启用 (${MONITOR_BATCH_COUNT}批)`
      }\n`,
    );

    console.log('预计调用频率：');
    console.log(
      `  US区域: ${Math.ceil(
        usCallsPerHour,
      ).toLocaleString()} 次/小时 (${usCallsPerMinute.toFixed(2)} 次/分钟)`,
    );
    console.log(
      `  EU区域: ${Math.ceil(
        euCallsPerHour,
      ).toLocaleString()} 次/小时 (${euCallsPerMinute.toFixed(2)} 次/分钟)`,
    );
    console.log(
      `  总计: ${Math.ceil(
        totalCallsPerHour,
      ).toLocaleString()} 次/小时 (${totalCallsPerMinute.toFixed(
        2,
      )} 次/分钟)\n`,
    );

    console.log('⚖️  配额对比：');
    console.log('─'.repeat(60));
    console.log(
      `配额限制: ${QUOTA_PER_MINUTE} 次/分钟, ${QUOTA_PER_HOUR.toLocaleString()} 次/小时`,
    );
    console.log(
      `预计使用: ${totalCallsPerMinute.toFixed(2)} 次/分钟, ${Math.ceil(
        totalCallsPerHour,
      ).toLocaleString()} 次/小时\n`,
    );

    // 安全评估
    const minuteUsage = (totalCallsPerMinute / QUOTA_PER_MINUTE) * 100;
    const hourUsage = (totalCallsPerHour / QUOTA_PER_HOUR) * 100;

    console.log('✅ 安全评估：');
    console.log('─'.repeat(60));
    console.log(
      `分钟配额使用率: ${minuteUsage.toFixed(
        1,
      )}% (${totalCallsPerMinute.toFixed(2)}/${QUOTA_PER_MINUTE})`,
    );
    console.log(
      `小时配额使用率: ${hourUsage.toFixed(1)}% (${Math.ceil(
        totalCallsPerHour,
      )}/${QUOTA_PER_HOUR.toLocaleString()})\n`,
    );

    if (minuteUsage <= 70 && hourUsage <= 70) {
      console.log('✅ 状态: 配额使用率健康（<70%）');
      console.log('   系统运行良好，配额充足。\n');
    } else if (minuteUsage <= 85 && hourUsage <= 85) {
      console.log('⚠️  状态: 配额使用率较高（70-85%）');
      console.log('   建议监控配额使用情况，避免突发流量。\n');
      console.log('💡 优化建议：');
      if (MONITOR_BATCH_COUNT === 1) {
        const recommendedBatch = Math.ceil(
          totalCallsPerHour / (QUOTA_PER_HOUR * 0.8),
        );
        console.log(
          `   - 考虑启用分批处理: MONITOR_BATCH_COUNT=${recommendedBatch}`,
        );
      }
      console.log('   - 监控实际调用情况，根据需要进行调整\n');
    } else if (minuteUsage <= 95 && hourUsage <= 95) {
      console.log('⚠️  状态: 配额使用率很高（85-95%）');
      console.log('   需要立即优化，否则可能触发限流！\n');
      console.log('💡 优化建议：');
      if (MONITOR_BATCH_COUNT === 1) {
        const recommendedBatch = Math.ceil(
          totalCallsPerHour / (QUOTA_PER_HOUR * 0.8),
        );
        console.log(
          `   1. 立即启用分批处理: MONITOR_BATCH_COUNT=${recommendedBatch}`,
        );
      } else {
        const recommendedBatch = Math.ceil(
          totalCallsPerHour / (QUOTA_PER_HOUR * 0.8),
        );
        if (recommendedBatch > MONITOR_BATCH_COUNT) {
          console.log(
            `   1. 增加分批数量: MONITOR_BATCH_COUNT=${recommendedBatch}`,
          );
        }
      }
      console.log('   2. 考虑增加缓存时间（减少重复检查）');
      console.log('   3. 监控实际调用，必要时减少检查频率\n');
    } else {
      console.log('❌ 状态: 配额使用率过高（>95%）！');
      console.log('   超过配额限制，系统将被限流！\n');
      console.log('🚨 紧急优化建议：');
      const recommendedBatch = Math.ceil(
        totalCallsPerHour / (QUOTA_PER_HOUR * 0.8),
      );
      console.log(
        `   1. 立即启用分批处理: MONITOR_BATCH_COUNT=${recommendedBatch} 或更高`,
      );
      console.log('   2. 增加缓存时间，减少API调用');
      console.log('   3. 考虑减少检查频率（修改scheduler配置）');
      console.log('   4. 考虑申请更高配额');
      console.log('   5. 检查是否有不必要的API调用\n');
    }

    // 显示分批处理建议
    if (MONITOR_BATCH_COUNT === 1 && minuteUsage > 70) {
      console.log('📋 分批处理配置建议：');
      console.log('─'.repeat(60));
      const safeHourCalls = QUOTA_PER_HOUR * 0.8; // 使用80%的配额作为安全阈值
      const recommendedBatch = Math.ceil(totalCallsPerHour / safeHourCalls);
      console.log(`当前预计调用: ${Math.ceil(totalCallsPerHour)} 次/小时`);
      console.log(`安全阈值（80%）: ${Math.ceil(safeHourCalls)} 次/小时`);
      console.log(`建议分批数量: ${recommendedBatch}`);
      console.log(
        `分批后预计调用: ${Math.ceil(
          totalCallsPerHour / recommendedBatch,
        )} 次/小时\n`,
      );
      console.log(
        `在 .env 文件中设置: MONITOR_BATCH_COUNT=${recommendedBatch}\n`,
      );
    }

    // 显示缓存建议
    if (totalAsins > 100) {
      console.log('💾 缓存优化建议：');
      console.log('─'.repeat(60));
      console.log('当前ASIN数量较多，建议：');
      console.log('   - 确保缓存正常工作（variantCheckService已实现）');
      console.log('   - 缓存TTL: 10分钟（600秒）');
      console.log('   - 缓存预热功能已启用\n');
    }

    console.log('='.repeat(60));
  } catch (error) {
    console.error('❌ 分析失败:', error.message);
    if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('   数据库访问被拒绝，请检查数据库配置');
    } else if (error.code === 'ER_BAD_DB_ERROR') {
      console.error('   数据库不存在，请检查数据库名称');
    } else {
      console.error('   错误详情:', error);
    }
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// 运行分析
analyzeQuotaUsage().catch((error) => {
  console.error('脚本执行失败:', error);
  process.exit(1);
});
