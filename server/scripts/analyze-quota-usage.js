#!/usr/bin/env node

const path = require('path');
const { loadEnv } = require('./utils/loadEnv');

if (require.main === module) {
  loadEnv(path.join(__dirname, '../.env'));
}

const mysql = require('mysql2/promise');
const logger = require('../src/utils/logger');
const {
  DATABASE_CONFIG_KEYS,
  buildCompetitorDatabaseConfig,
  buildMainDatabaseConfig,
  combineRegionSummaries,
  projectRegionWorkload,
  resolveEffectiveConfig,
  summarizeInventory,
} = require('./quota-analysis');

const MAIN_INVENTORY_SQL = `
  SELECT
    vg.id,
    vg.country,
    vg.create_time,
    CRC32(vg.id) AS hash_value,
    COUNT(a.id) AS asin_count
  FROM variant_groups vg
  LEFT JOIN asins a ON a.variant_group_id = vg.id
  GROUP BY vg.id, vg.country, vg.create_time
  ORDER BY vg.country, vg.create_time, vg.id
`;

const COMPETITOR_INVENTORY_SQL = `
  SELECT
    vg.id,
    vg.country,
    vg.create_time,
    CRC32(vg.id) AS hash_value,
    COUNT(a.id) AS asin_count
  FROM competitor_variant_groups vg
  LEFT JOIN competitor_asins a ON a.variant_group_id = vg.id
  GROUP BY vg.id, vg.country, vg.create_time
  ORDER BY vg.country, vg.create_time, vg.id
`;

function formatNumber(value, digits = 2) {
  return Number(value).toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatRange(minimum, maximum, digits = 2) {
  if (Math.abs(maximum - minimum) < 0.000001) {
    return formatNumber(minimum, digits);
  }
  return `${formatNumber(minimum, digits)} - ${formatNumber(maximum, digits)}`;
}

async function loadDatabaseConfigRows(connection) {
  const placeholders = DATABASE_CONFIG_KEYS.map(() => '?').join(', ');
  const [rows] = await connection.execute(
    `SELECT config_key, config_value
     FROM sp_api_config
     WHERE config_key IN (${placeholders})`,
    DATABASE_CONFIG_KEYS,
  );
  return rows;
}

async function loadInventory(connection, sql) {
  const [rows] = await connection.execute(sql);
  return rows;
}

function logRegionReport(
  region,
  standardSummary,
  competitorSummary,
  taskProjections,
  projection,
  config,
) {
  const combined = combineRegionSummaries(standardSummary, competitorSummary);

  logger.info(`\n${region} 区域：`);
  logger.info(
    `  主营监控：${standardSummary.groupCount} 个变体组，${standardSummary.asinCount} 个 ASIN`,
  );
  logger.info(
    `  竞品监控：${competitorSummary.groupCount} 个变体组，${competitorSummary.asinCount} 个 ASIN`,
  );
  logger.info(
    `  完整轮转：${projection.fullSweepMinutes} 分钟（${config.batchCount} 批）`,
  );
  logger.info(
    `  主营计划请求：${formatRange(
      taskProjections.standard.requestMinPerHour,
      taskProjections.standard.requestMaxPerHour,
    )} 次/小时`,
  );
  logger.info(
    `  竞品计划请求：${formatRange(
      taskProjections.competitor.requestMinPerHour,
      taskProjections.competitor.requestMaxPerHour,
    )} 次/小时`,
  );
  logger.info(
    `  合计计划请求：${formatRange(
      projection.requestMinPerHour,
      projection.requestMaxPerHour,
    )} 次/小时，${formatRange(
      projection.requestMinPerMinute,
      projection.requestMaxPerMinute,
    )} 次/分钟`,
  );
  logger.info(
    `  本地区域上限占用：分钟 ${formatRange(
      projection.minuteUsageMinPercent,
      projection.minuteUsageMaxPercent,
      1,
    )}%，小时 ${formatRange(
      projection.hourUsageMinPercent,
      projection.hourUsageMaxPercent,
      1,
    )}%`,
  );
  logger.info(
    `  operation（完整轮转）：getCatalogItem ${combined.getCatalogItemMin}-${combined.getCatalogItemMax}，searchCatalogItems ${combined.searchCatalogItems}`,
  );

  if (combined.omittedGroupCount > 0) {
    logger.warn(
      `  MONITOR_MAX_GROUPS_PER_TASK 导致 ${combined.omittedGroupCount} 个变体组、${combined.omittedAsinCount} 个 ASIN 不在当前计划覆盖范围内`,
    );
  }
}

async function analyzeQuotaUsage({
  env = process.env,
  mysqlModule = mysql,
} = {}) {
  let mainConnection;
  let competitorConnection;

  try {
    const mainDatabaseConfig = buildMainDatabaseConfig(env);
    mainConnection = await mysqlModule.createConnection(mainDatabaseConfig);
    logger.info(`[配额分析] 主数据库连接成功: ${mainDatabaseConfig.database}`);

    const configRows = await loadDatabaseConfigRows(mainConnection);
    const config = resolveEffectiveConfig(env, configRows);
    const mainRows = await loadInventory(mainConnection, MAIN_INVENTORY_SQL);

    let competitorRows = [];
    if (config.competitorEnabled) {
      const competitorDatabaseConfig = buildCompetitorDatabaseConfig(env);
      competitorConnection = await mysqlModule.createConnection(
        competitorDatabaseConfig,
      );
      logger.info(
        `[配额分析] 竞品数据库连接成功: ${competitorDatabaseConfig.database}`,
      );
      competitorRows = await loadInventory(
        competitorConnection,
        COMPETITOR_INVENTORY_SQL,
      );
    } else {
      logger.info('[配额分析] 竞品监控已关闭，不计入竞品调用');
    }

    const standardByRegion = summarizeInventory(mainRows, {
      batchCount: config.batchCount,
      maxGroupsPerTask: config.maxGroupsPerTask,
      batchAsinThreshold: config.batchAsinThreshold,
      allowBatchApi: true,
    });
    const competitorByRegion = summarizeInventory(competitorRows, {
      batchCount: config.batchCount,
      maxGroupsPerTask: config.maxGroupsPerTask,
      allowBatchApi: false,
    });

    logger.info('\nSP-API 计划负载估算');
    logger.info(
      `配置：US ${config.usIntervalMinutes} 分钟，EU ${config.euIntervalMinutes} 分钟，批次数 ${config.batchCount}`,
    );
    logger.info(
      `本地区域保护上限：${config.regionPerMinuteLimit} 次/分钟，${config.regionPerHourLimit} 次/小时`,
    );

    if (config.batchAsinThreshold > 0) {
      logger.warn(
        `MONITOR_BATCH_ASIN_THRESHOLD=${config.batchAsinThreshold} 已启用，批量查询后的详细请求量依赖 Amazon 返回结果，因此以下使用上下界`,
      );
    }

    const projections = {};
    const taskProjections = {};
    for (const region of ['US', 'EU']) {
      const intervalMinutes =
        region === 'US' ? config.usIntervalMinutes : config.euIntervalMinutes;
      const localLimits = {
        perMinute: config.regionPerMinuteLimit,
        perHour: config.regionPerHourLimit,
      };
      taskProjections[region] = {
        standard: projectRegionWorkload(
          standardByRegion[region],
          intervalMinutes,
          config.batchCount,
          localLimits,
        ),
        competitor: projectRegionWorkload(
          competitorByRegion[region],
          intervalMinutes,
          config.batchCount,
          localLimits,
        ),
      };
      projections[region] = projectRegionWorkload(
        combineRegionSummaries(
          standardByRegion[region],
          competitorByRegion[region],
        ),
        intervalMinutes,
        config.batchCount,
        localLimits,
      );
      logRegionReport(
        region,
        standardByRegion[region],
        competitorByRegion[region],
        taskProjections[region],
        projections[region],
        config,
      );
    }

    logger.warn(
      '\n以上仅估算定时任务的计划调用；重试、手动检查、缓存未命中和兜底请求会产生额外流量。Amazon 实际 usage plan 以 operation 响应头和 429 观测为准。',
    );

    return {
      config,
      standardByRegion,
      competitorByRegion,
      taskProjections,
      projections,
    };
  } finally {
    if (competitorConnection) {
      await competitorConnection.end().catch((error) => {
        logger.warn('[配额分析] 关闭竞品数据库连接失败:', error.message);
      });
    }
    if (mainConnection) {
      await mainConnection.end().catch((error) => {
        logger.warn('[配额分析] 关闭主数据库连接失败:', error.message);
      });
    }
  }
}

if (require.main === module) {
  analyzeQuotaUsage().catch((error) => {
    logger.error('[配额分析] 执行失败:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  analyzeQuotaUsage,
  loadDatabaseConfigRows,
  loadInventory,
};
