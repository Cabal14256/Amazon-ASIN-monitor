#!/usr/bin/env node
/**
 * Analytics 查询健康检查脚本
 *
 * 用法:
 *   node scripts/check-analytics-health.js
 */

const path = require('path');
const { loadEnv } = require('./utils/loadEnv');

// 加载环境变量
const envPath = path.join(__dirname, '../.env');
loadEnv(envPath);

const logger = require('../src/utils/logger');
const { query, testConnection, pool } = require('../src/config/database');

async function main() {
  logger.info('========================================');
  logger.info('Analytics 查询健康检查');
  logger.info('========================================');

  // 测试数据库连接
  const connected = await testConnection();
  if (!connected) {
    logger.error('❌ 数据库连接失败');
    process.exit(1);
  }
  logger.info('✅ 数据库连接正常');

  // 检查环境变量配置
  logger.info('\n📋 环境变量配置:');
  const config = {
    ANALYTICS_AGG_ENABLED: process.env.ANALYTICS_AGG_ENABLED || '1',
    ANALYTICS_AGG_BACKFILL_DAYS:
      process.env.ANALYTICS_AGG_BACKFILL_DAYS || '30',
    ANALYTICS_QUERY_TIMEOUT_MS:
      process.env.ANALYTICS_QUERY_TIMEOUT_MS || '45000',
    ANALYTICS_MAX_RAW_QUERY_DAYS:
      process.env.ANALYTICS_MAX_RAW_QUERY_DAYS || '7',
  };

  Object.entries(config).forEach(([key, value]) => {
    logger.info(`  ${key}=${value}`);
  });

  // 检查聚合表状态
  logger.info('\n📊 聚合表状态检查:');

  try {
    // 检查 monitor_history 总数据量
    const [historyRow] = await query(
      'SELECT COUNT(*) as count FROM monitor_history',
    );
    const historyCount = historyRow?.count || 0;
    logger.info(`  monitor_history 总记录数: ${historyCount.toLocaleString()}`);

    // 检查 monitor_history_agg 数据覆盖范围
    const [aggBase] = await query(`
      SELECT 
        granularity,
        COUNT(*) as row_count,
        DATE_FORMAT(MIN(time_slot), '%Y-%m-%d %H:%i:%s') as min_slot,
        DATE_FORMAT(MAX(time_slot), '%Y-%m-%d %H:%i:%s') as max_slot
      FROM monitor_history_agg
      GROUP BY granularity
      ORDER BY granularity
    `);

    if (aggBase) {
      logger.info(`  monitor_history_agg:`);
      logger.info(
        `    - ${
          aggBase.granularity
        } 粒度: ${aggBase.row_count.toLocaleString()} 条记录`,
      );
      logger.info(`    - 覆盖范围: ${aggBase.min_slot} ~ ${aggBase.max_slot}`);
    } else {
      logger.warn(`  ⚠️ monitor_history_agg 表无数据`);
    }

    // 检查 monitor_history_agg_dim 数据覆盖范围
    const [aggDim] = await query(`
      SELECT 
        granularity,
        COUNT(*) as row_count,
        DATE_FORMAT(MIN(time_slot), '%Y-%m-%d %H:%i:%s') as min_slot,
        DATE_FORMAT(MAX(time_slot), '%Y-%m-%d %H:%i:%s') as max_slot
      FROM monitor_history_agg_dim
      GROUP BY granularity
      ORDER BY granularity
      LIMIT 1
    `);

    if (aggDim) {
      logger.info(`  monitor_history_agg_dim:`);
      logger.info(
        `    - ${
          aggDim.granularity
        } 粒度: ${aggDim.row_count.toLocaleString()} 条记录`,
      );
      logger.info(`    - 覆盖范围: ${aggDim.min_slot} ~ ${aggDim.max_slot}`);
    } else {
      logger.warn(`  ⚠️ monitor_history_agg_dim 表无数据`);
    }

    // 检查是否可以覆盖 2026-03-01 到 2026-03-15 的查询
    logger.info('\n🔍 查询范围覆盖检查 (2026-03-01 ~ 2026-03-15):');
    const targetStart = '2026-03-01';
    const targetEnd = '2026-03-15';

    if (aggBase) {
      const minSlot = aggBase.min_slot?.slice(0, 10);
      const maxSlot = aggBase.max_slot?.slice(0, 10);

      if (minSlot <= targetStart && maxSlot >= targetEnd) {
        logger.info(`  ✅ 聚合表可以完全覆盖查询范围`);
      } else if (minSlot <= targetStart) {
        logger.warn(`  ⚠️ 聚合表覆盖不足，最新数据只到 ${maxSlot}`);
        logger.info(
          `     建议执行: node scripts/rebuild-analytics-agg.js --yes --no-truncate`,
        );
      } else {
        logger.error(`  ❌ 聚合表覆盖范围不足`);
      }
    }

    // 检查索引
    logger.info('\n🔍 关键索引检查:');
    const indexes = await query(`
      SELECT INDEX_NAME, COLUMN_NAME 
      FROM INFORMATION_SCHEMA.STATISTICS 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'monitor_history'
        AND INDEX_NAME LIKE 'idx_check_type%'
      ORDER BY INDEX_NAME, SEQ_IN_INDEX
    `);

    if (indexes.length > 0) {
      logger.info(`  ✅ 发现 ${indexes.length} 个优化索引`);
      const indexNames = [...new Set(indexes.map((i) => i.INDEX_NAME))];
      indexNames.forEach((name) => logger.info(`    - ${name}`));
    } else {
      logger.warn(`  ⚠️ 未发现优化索引，建议执行迁移脚本:`);
      logger.info(
        `     mysql -u root -p amazon_asin_monitor < database/migrations/031_fix_analytics_performance.sql`,
      );
    }

    // 性能建议
    logger.info('\n💡 性能优化建议:');

    const queryTimeout = Number(config.ANALYTICS_QUERY_TIMEOUT_MS);
    if (queryTimeout < 60000) {
      logger.warn(
        `  ⚠️ ANALYTICS_QUERY_TIMEOUT_MS (${queryTimeout}ms) 设置较低`,
      );
      logger.info(`     建议设置为 120000 或更高以支持大数据量查询`);
    } else {
      logger.info(`  ✅ 查询超时设置合理 (${queryTimeout}ms)`);
    }

    if (config.ANALYTICS_AGG_ENABLED === '0') {
      logger.error(`  ❌ ANALYTICS_AGG_ENABLED=0，聚合表已禁用`);
      logger.info(`     建议设置为 1 以启用聚合表加速查询`);
    } else {
      logger.info(`  ✅ 聚合表已启用`);
    }

    if (!aggBase || !aggDim) {
      logger.error(`  ❌ 聚合表数据不完整`);
      logger.info(`     建议执行: node scripts/rebuild-analytics-agg.js --yes`);
    }
  } catch (error) {
    logger.error('检查过程出错:', error.message);
  }

  // 关闭连接池
  try {
    await pool.end();
  } catch (error) {
    // 忽略关闭错误
  }

  logger.info('\n========================================');
  logger.info('检查完成');
  logger.info('========================================');
}

main().catch((error) => {
  logger.error('未捕获异常:', error?.message || error);
  process.exit(1);
});
