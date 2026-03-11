#!/usr/bin/env node
/**
 * 生产可用的监控历史聚合表重建脚本
 *
 * 用法:
 *   node scripts/rebuild-analytics-agg.js --yes
 *   node scripts/rebuild-analytics-agg.js --yes --backup
 *   node scripts/rebuild-analytics-agg.js --no-truncate --start-time="2026-02-01 00:00:00" --end-time="2026-02-29 23:59:59"
 *   node scripts/rebuild-analytics-agg.js --yes --skip-dim
 */

const path = require('path');
const { loadEnv } = require('./utils/loadEnv');

function parseArgs(argv) {
  const args = {
    help: false,
    yes: false,
    truncate: true,
    backup: false,
    skipDim: false,
    granularity: 'both',
    startTime: '',
    endTime: '',
    allowPartial: false,
    forceEnableAgg: false,
    forceEnableDim: false,
    envPath: '',
  };

  for (const item of argv) {
    if (item === '--yes') {
      args.yes = true;
      continue;
    }
    if (item === '--help' || item === '-h') {
      args.help = true;
      continue;
    }
    if (item === '--no-truncate') {
      args.truncate = false;
      continue;
    }
    if (item === '--backup') {
      args.backup = true;
      continue;
    }
    if (item === '--skip-dim') {
      args.skipDim = true;
      continue;
    }
    if (item === '--allow-partial') {
      args.allowPartial = true;
      continue;
    }
    if (item === '--force-enable-agg') {
      args.forceEnableAgg = true;
      continue;
    }
    if (item === '--force-enable-dim') {
      args.forceEnableDim = true;
      continue;
    }
    if (item.startsWith('--granularity=')) {
      args.granularity = item.slice('--granularity='.length).trim();
      continue;
    }
    if (item.startsWith('--start-time=')) {
      args.startTime = item.slice('--start-time='.length).trim();
      continue;
    }
    if (item.startsWith('--end-time=')) {
      args.endTime = item.slice('--end-time='.length).trim();
      continue;
    }
    if (item.startsWith('--env=')) {
      args.envPath = item.slice('--env='.length).trim();
    }
  }

  return args;
}

function isValidGranularity(value) {
  return value === 'hour' || value === 'day' || value === 'both';
}

function buildGranularityList(value) {
  if (value === 'hour') {
    return ['hour'];
  }
  if (value === 'day') {
    return ['day'];
  }
  return ['hour', 'day'];
}

function buildBackupSuffix() {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

function usage() {
  return [
    '用法:',
    '  node scripts/rebuild-analytics-agg.js --yes',
    '  node scripts/rebuild-analytics-agg.js --yes --backup',
    '  node scripts/rebuild-analytics-agg.js --no-truncate --start-time="2026-02-01 00:00:00" --end-time="2026-02-29 23:59:59"',
    '参数:',
    '  --yes                  允许执行 TRUNCATE（truncate 默认开启）',
    '  --no-truncate          不清空聚合表，只执行 UPSERT 刷新',
    '  --backup               清空前备份当前聚合表到 *_bak_YYYYMMDD_HHMMSS',
    '  --skip-dim             跳过 monitor_history_agg_dim',
    '  --granularity=...      hour/day/both，默认 both',
    '  --start-time=...       指定窗口开始时间（与 end-time 成对使用）',
    '  --end-time=...         指定窗口结束时间（与 start-time 成对使用）',
    '  --allow-partial        允许 truncate + 自定义时间窗口（危险）',
    '  --force-enable-agg     强制启用 ANALYTICS_AGG_ENABLED=1（仅当前进程）',
    '  --force-enable-dim     强制启用 ANALYTICS_AGG_REFRESH_DIM=1（仅当前进程）',
    '  --env=...              指定 .env 路径（默认 server/.env）',
  ].join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const envPath = args.envPath
    ? path.resolve(args.envPath)
    : path.join(__dirname, '../.env');
  loadEnv(envPath);

  if (args.forceEnableAgg) {
    process.env.ANALYTICS_AGG_ENABLED = '1';
  }
  if (args.forceEnableDim) {
    process.env.ANALYTICS_AGG_REFRESH_DIM = '1';
  }

  const logger = require('../src/utils/logger');
  const { query, testConnection, pool } = require('../src/config/database');
  const analyticsAggService = require('../src/services/analyticsAggService');
  const analyticsCacheService = require('../src/services/analyticsCacheService');

  const closeAndExit = async (code) => {
    try {
      await pool.end();
    } catch (error) {
      logger.warn('[Agg Rebuild] 关闭数据库连接池失败:', error.message);
    }
    process.exit(code);
  };

  if (!isValidGranularity(args.granularity)) {
    logger.error('[Agg Rebuild] granularity 参数非法:', args.granularity);
    logger.info(usage());
    await closeAndExit(1);
    return;
  }

  if (args.help) {
    logger.info(usage());
    await closeAndExit(0);
    return;
  }

  if (!!args.startTime !== !!args.endTime) {
    logger.error('[Agg Rebuild] start-time 和 end-time 必须同时提供');
    logger.info(usage());
    await closeAndExit(1);
    return;
  }

  if (args.truncate && !args.yes) {
    logger.error(
      '[Agg Rebuild] 当前为 truncate 模式，请追加 --yes 确认执行（防止误清空）',
    );
    logger.info(usage());
    await closeAndExit(1);
    return;
  }

  const hasCustomWindow = Boolean(args.startTime && args.endTime);
  if (args.truncate && hasCustomWindow && !args.allowPartial) {
    logger.error(
      '[Agg Rebuild] 检测到 truncate + 自定义窗口，默认阻止。若确需执行请追加 --allow-partial',
    );
    await closeAndExit(1);
    return;
  }

  if (analyticsAggService.getAggStatus().enabled === false) {
    logger.error(
      '[Agg Rebuild] ANALYTICS_AGG_ENABLED=0，聚合服务当前不可用。可加 --force-enable-agg 仅对本进程生效',
    );
    await closeAndExit(1);
    return;
  }

  const connected = await testConnection();
  if (!connected) {
    logger.error('[Agg Rebuild] 数据库连接失败');
    await closeAndExit(1);
    return;
  }

  const granularityList = buildGranularityList(args.granularity);
  const includeDim = !args.skipDim;
  const [rangeRow] = await query(
    `SELECT
       DATE_FORMAT(MIN(check_time), '%Y-%m-%d %H:%i:%s') as min_time,
       DATE_FORMAT(MAX(check_time), '%Y-%m-%d %H:%i:%s') as max_time,
       COUNT(*) as total_rows
     FROM monitor_history`,
  );

  const totalRows = Number(rangeRow?.total_rows || 0);
  if (totalRows <= 0) {
    logger.warn('[Agg Rebuild] monitor_history 无数据，跳过重建');
    await closeAndExit(0);
    return;
  }

  const startTime = hasCustomWindow ? args.startTime : rangeRow.min_time;
  const endTime = hasCustomWindow ? args.endTime : rangeRow.max_time;
  const options = { startTime, endTime };

  logger.info('[Agg Rebuild] 开始执行，参数:', {
    envPath,
    truncate: args.truncate,
    backup: args.backup,
    includeDim,
    granularityList,
    startTime,
    endTime,
    totalRows,
  });

  const lockName = 'ops_rebuild_monitor_history_agg_lock';
  const [lockRow] = await query('SELECT GET_LOCK(?, 1) as locked', [lockName]);
  if (Number(lockRow?.locked) !== 1) {
    logger.error('[Agg Rebuild] 获取数据库锁失败，可能已有重建任务在执行');
    await closeAndExit(1);
    return;
  }

  const results = {
    base: {},
    dim: {},
    variantGroup: {},
    verify: {},
    audit: {},
  };
  let exitCode = 0;

  try {
    if (args.backup) {
      const suffix = buildBackupSuffix();
      const aggBakTable = `monitor_history_agg_bak_${suffix}`;
      await query(`CREATE TABLE \`${aggBakTable}\` LIKE monitor_history_agg`);
      await query(
        `INSERT INTO \`${aggBakTable}\` SELECT * FROM monitor_history_agg`,
      );
      logger.info(`[Agg Rebuild] monitor_history_agg 已备份到 ${aggBakTable}`);

      const aggVariantGroupBakTable = `monitor_history_agg_variant_group_bak_${suffix}`;
      await query(
        `CREATE TABLE \`${aggVariantGroupBakTable}\` LIKE monitor_history_agg_variant_group`,
      );
      await query(
        `INSERT INTO \`${aggVariantGroupBakTable}\` SELECT * FROM monitor_history_agg_variant_group`,
      );
      logger.info(
        `[Agg Rebuild] monitor_history_agg_variant_group 已备份到 ${aggVariantGroupBakTable}`,
      );

      if (includeDim) {
        const aggDimBakTable = `monitor_history_agg_dim_bak_${suffix}`;
        await query(
          `CREATE TABLE \`${aggDimBakTable}\` LIKE monitor_history_agg_dim`,
        );
        await query(
          `INSERT INTO \`${aggDimBakTable}\` SELECT * FROM monitor_history_agg_dim`,
        );
        logger.info(
          `[Agg Rebuild] monitor_history_agg_dim 已备份到 ${aggDimBakTable}`,
        );
      }
    }

    if (args.truncate) {
      if (includeDim) {
        await query('TRUNCATE TABLE monitor_history_agg_dim');
      }
      await query('TRUNCATE TABLE monitor_history_agg_variant_group');
      await query('TRUNCATE TABLE monitor_history_agg');
      logger.info('[Agg Rebuild] 聚合表清空完成');
    }

    for (const granularity of granularityList) {
      results.base[granularity] =
        await analyticsAggService.refreshMonitorHistoryAgg(
          granularity,
          options,
        );
      results.variantGroup[granularity] =
        await analyticsAggService.refreshMonitorHistoryAggVariantGroup(
          granularity,
          options,
        );
    }

    if (includeDim) {
      for (const granularity of granularityList) {
        results.dim[granularity] =
          await analyticsAggService.refreshMonitorHistoryAggDim(
            granularity,
            options,
          );
      }
    }

    const verifyBase = await query(
      `SELECT
         granularity,
         COUNT(*) as row_count,
         DATE_FORMAT(MIN(time_slot), '%Y-%m-%d %H:%i:%s') as min_slot,
         DATE_FORMAT(MAX(time_slot), '%Y-%m-%d %H:%i:%s') as max_slot
       FROM monitor_history_agg
       GROUP BY granularity
       ORDER BY granularity ASC`,
    );
    results.verify.base = verifyBase;

    if (includeDim) {
      const verifyDim = await query(
        `SELECT
           granularity,
           COUNT(*) as row_count,
           DATE_FORMAT(MIN(time_slot), '%Y-%m-%d %H:%i:%s') as min_slot,
           DATE_FORMAT(MAX(time_slot), '%Y-%m-%d %H:%i:%s') as max_slot
         FROM monitor_history_agg_dim
         GROUP BY granularity
         ORDER BY granularity ASC`,
      );
      results.verify.dim = verifyDim;
    }

    const verifyVariantGroup = await query(
      `SELECT
         granularity,
         COUNT(*) as row_count,
         DATE_FORMAT(MIN(time_slot), '%Y-%m-%d %H:%i:%s') as min_slot,
         DATE_FORMAT(MAX(time_slot), '%Y-%m-%d %H:%i:%s') as max_slot
       FROM monitor_history_agg_variant_group
       GROUP BY granularity
       ORDER BY granularity ASC`,
    );
    results.verify.variantGroup = verifyVariantGroup;

    results.audit.asinTypeDistribution = await query(
      `SELECT
         COALESCE(CAST(asin_type AS CHAR), 'NULL') as asin_type,
         COUNT(*) as total
       FROM asins
       GROUP BY asin_type
       ORDER BY total DESC`,
    );
    results.audit.suspiciousGroups = await query(
      `SELECT
         vg.name,
         vg.country,
         SUM(CASE WHEN a.asin_type = '1' THEN 1 ELSE 0 END) as main_count,
         SUM(CASE WHEN a.asin_type = '2' THEN 1 ELSE 0 END) as sub_count,
         COUNT(*) as total_asins
       FROM variant_groups vg
       LEFT JOIN asins a ON a.variant_group_id = vg.id
       GROUP BY vg.id, vg.name, vg.country
       HAVING main_count > 1 OR sub_count = 0
       ORDER BY main_count DESC, total_asins DESC
       LIMIT 20`,
    );

    await analyticsCacheService.deleteByPrefix('statisticsByTime:');
    await analyticsCacheService.deleteByPrefix('allCountriesSummary:');
    await analyticsCacheService.deleteByPrefix('regionSummary:');
    await analyticsCacheService.deleteByPrefix('periodSummary:');
    await analyticsCacheService.deleteByPrefix('asinStatisticsByCountry:');
    await analyticsCacheService.deleteByPrefix('asinStatisticsByVariantGroup:');

    logger.info('[Agg Rebuild] 执行完成，结果汇总:', results);
  } catch (error) {
    logger.error('[Agg Rebuild] 执行失败:', error.message);
    exitCode = 1;
  } finally {
    try {
      await query('SELECT RELEASE_LOCK(?) as released', [lockName]);
    } catch (error) {
      logger.warn('[Agg Rebuild] 释放数据库锁失败:', error.message);
    }
  }

  await closeAndExit(exitCode);
}

main().catch(async (error) => {
  const logger = require('../src/utils/logger');
  logger.error('[Agg Rebuild] 未捕获异常:', error?.message || error);
  process.exit(1);
});
