#!/usr/bin/env node
/**
 * 从 monitor_snapshots CSV 备份恢复 ASIN 级 monitor_history 记录。
 *
 * 用法:
 *   node scripts/restore-monitor-snapshots.js
 *   node scripts/restore-monitor-snapshots.js --file="../docs/monitor_snapshots_2026_02.csv"
 *   node scripts/restore-monitor-snapshots.js --skip-agg
 *   node scripts/restore-monitor-snapshots.js --batch-size=2000
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { loadEnv } = require('./utils/loadEnv');

function parseArgs(argv) {
  const args = {
    file: path.join('..', '..', 'docs', 'monitor_snapshots_2026_02.csv'),
    envPath: '',
    batchSize: 2000,
    startTime: '2026-02-01 00:00:00',
    endTimeExclusive: '2026-03-01 00:00:00',
    skipAgg: false,
  };

  for (const item of argv) {
    if (item === '--skip-agg') {
      args.skipAgg = true;
      continue;
    }
    if (item.startsWith('--file=')) {
      args.file = item.slice('--file='.length).trim();
      continue;
    }
    if (item.startsWith('--env=')) {
      args.envPath = item.slice('--env='.length).trim();
      continue;
    }
    if (item.startsWith('--batch-size=')) {
      const parsed = Number(item.slice('--batch-size='.length).trim());
      if (Number.isFinite(parsed) && parsed > 0) {
        args.batchSize = Math.floor(parsed);
      }
      continue;
    }
    if (item.startsWith('--start-time=')) {
      args.startTime = item.slice('--start-time='.length).trim();
      continue;
    }
    if (item.startsWith('--end-time-exclusive=')) {
      args.endTimeExclusive = item.slice('--end-time-exclusive='.length).trim();
    }
  }

  return args;
}

function splitCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  result.push(current);
  return result;
}

function normalizeCell(value) {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value).trim();
}

function toNullable(value) {
  const normalized = normalizeCell(value);
  return normalized || null;
}

function toInt(value, fallback = 0) {
  const normalized = normalizeCell(value);
  if (!normalized) {
    return fallback;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function subtractOneSecond(datetimeText) {
  const parsed = new Date(datetimeText.replace(' ', 'T') + '+08:00');
  if (Number.isNaN(parsed.getTime())) {
    return datetimeText;
  }
  parsed.setSeconds(parsed.getSeconds() - 1);
  const yyyy = parsed.getFullYear();
  const mm = String(parsed.getMonth() + 1).padStart(2, '0');
  const dd = String(parsed.getDate()).padStart(2, '0');
  const hh = String(parsed.getHours()).padStart(2, '0');
  const mi = String(parsed.getMinutes()).padStart(2, '0');
  const ss = String(parsed.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

async function withDbLock(execute, lockName, handler) {
  const [lockRow] = await execute('SELECT GET_LOCK(?, 1) AS locked', [
    lockName,
  ]);
  if (Number(lockRow?.locked) !== 1) {
    throw new Error(`获取数据库锁失败: ${lockName}`);
  }

  try {
    return await handler();
  } finally {
    try {
      await execute('SELECT RELEASE_LOCK(?)', [lockName]);
    } catch (error) {
      // 锁释放失败不影响主流程，只记录最小必要上下文。
    }
  }
}

async function createStageTable(execute) {
  await execute(`
    CREATE TEMPORARY TABLE tmp_restore_monitor_snapshots (
      backup_id BIGINT NOT NULL,
      event_time DATETIME NOT NULL,
      batch_no INT DEFAULT NULL,
      parent_title VARCHAR(255) DEFAULT NULL,
      country VARCHAR(10) NOT NULL,
      site VARCHAR(100) DEFAULT NULL,
      brand VARCHAR(255) DEFAULT NULL,
      amazon_brand VARCHAR(255) DEFAULT NULL,
      group_id VARCHAR(50) DEFAULT NULL,
      group_name VARCHAR(255) DEFAULT NULL,
      asin VARCHAR(20) NOT NULL,
      status_text VARCHAR(50) DEFAULT NULL,
      is_broken TINYINT(1) DEFAULT 0,
      chain_type VARCHAR(20) DEFAULT NULL,
      peak_flag TINYINT(1) DEFAULT 0,
      is_peak TINYINT(1) DEFAULT 0,
      hour_ts DATETIME DEFAULT NULL,
      day_ts DATETIME DEFAULT NULL,
      PRIMARY KEY (backup_id),
      KEY idx_restore_event_time (event_time),
      KEY idx_restore_country_asin_time (country, asin, event_time)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function insertStageBatch(execute, rows, timeoutMs) {
  if (!rows.length) {
    return;
  }

  const placeholders = [];
  const values = [];

  for (const row of rows) {
    placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    values.push(
      row.backupId,
      row.eventTime,
      row.batchNo,
      row.parentTitle,
      row.country,
      row.site,
      row.brand,
      row.amazonBrand,
      row.groupId,
      row.groupName,
      row.asin,
      row.statusText,
      row.isBroken,
      row.chainType,
      row.peakFlag,
      row.isPeak,
      row.hourTs,
      row.dayTs,
    );
  }

  await execute(
    `INSERT INTO tmp_restore_monitor_snapshots (
      backup_id, event_time, batch_no, parent_title, country, site, brand,
      amazon_brand, group_id, group_name, asin, status_text, is_broken,
      chain_type, peak_flag, is_peak, hour_ts, day_ts
    ) VALUES ${placeholders.join(', ')}`,
    values,
    { timeoutMs },
  );
}

async function loadCsvIntoStage({ filePath, batchSize, execute, logger }) {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  let header = null;
  let loadedRows = 0;
  let batch = [];
  let nextProgressLogAt = batchSize * 20;

  for await (const line of rl) {
    if (!header) {
      header = splitCsvLine(line);
      continue;
    }

    if (!line.trim()) {
      continue;
    }

    const columns = splitCsvLine(line);
    const row = Object.fromEntries(
      header.map((key, index) => [key, columns[index] ?? '']),
    );

    batch.push({
      backupId: toInt(row.id, 0),
      eventTime: normalizeCell(row.event_time),
      batchNo: toInt(row.batch, 0),
      parentTitle: toNullable(row.parent_title),
      country: normalizeCell(row.country),
      site: toNullable(row.site),
      brand: toNullable(row.brand),
      amazonBrand: toNullable(row.amazon_brand),
      groupId: toNullable(row.group_id),
      groupName: toNullable(row.group_name),
      asin: normalizeCell(row.asin),
      statusText: toNullable(row.status),
      isBroken: toInt(row.is_broken, 0) === 1 ? 1 : 0,
      chainType: toNullable(row.chain_type),
      peakFlag: toInt(row.peak_flag, 0) === 1 ? 1 : 0,
      isPeak: toInt(row.is_peak, 0) === 1 ? 1 : 0,
      hourTs: toNullable(row.hour_ts),
      dayTs: toNullable(row.day_ts),
    });

    if (batch.length >= batchSize) {
      await insertStageBatch(execute, batch, 600000);
      loadedRows += batch.length;
      batch = [];

      if (loadedRows >= nextProgressLogAt) {
        logger.info('[Restore Snapshots] CSV staged progress:', {
          loadedRows,
        });
        nextProgressLogAt += batchSize * 20;
      }
    }
  }

  if (batch.length > 0) {
    await insertStageBatch(execute, batch, 600000);
    loadedRows += batch.length;
  }

  return loadedRows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const envPath = args.envPath
    ? path.resolve(args.envPath)
    : path.join(__dirname, '../.env');
  loadEnv(envPath);

  const logger = require('../src/utils/logger');
  const {
    testConnection,
    getConnection,
    createQueryExecutor,
    pool,
  } = require('../src/config/database');
  const analyticsAggService = require('../src/services/analyticsAggService');

  const filePath = path.resolve(__dirname, args.file);
  const aggEndTime = subtractOneSecond(args.endTimeExclusive);

  if (!fs.existsSync(filePath)) {
    logger.error('[Restore Snapshots] 备份文件不存在:', {
      filePath,
    });
    process.exit(1);
  }

  const connected = await testConnection();
  if (!connected) {
    logger.error('[Restore Snapshots] 数据库连接失败');
    process.exit(1);
  }

  logger.info('[Restore Snapshots] 开始恢复:', {
    filePath,
    batchSize: args.batchSize,
    startTime: args.startTime,
    endTimeExclusive: args.endTimeExclusive,
    skipAgg: args.skipAgg,
  });

  const connection = await getConnection();
  const execute = createQueryExecutor(connection);

  try {
    await withDbLock(
      execute,
      'ops_restore_monitor_snapshots_lock',
      async () => {
        const [existingRange] = await execute(
          `SELECT COUNT(*) AS total
             FROM monitor_history
            WHERE check_time >= ?
              AND check_time < ?`,
          [args.startTime, args.endTimeExclusive],
        );

        if (Number(existingRange?.total || 0) > 0) {
          throw new Error(
            `目标时间范围已存在 ${existingRange.total} 条 monitor_history 记录，已中止恢复`,
          );
        }

        await createStageTable(execute);
        const stagedRows = await loadCsvIntoStage({
          filePath,
          batchSize: args.batchSize,
          execute,
          logger,
        });

        const [stageStats] = await execute(`
          SELECT
            COUNT(*) AS total_rows,
            COUNT(DISTINCT CONCAT(asin, '||', country)) AS distinct_asin_country,
            SUM(CASE WHEN parent_title IS NULL OR parent_title = '' THEN 1 ELSE 0 END) AS blank_parent_rows,
            SUM(CASE WHEN is_broken = 1 THEN 1 ELSE 0 END) AS broken_rows
          FROM tmp_restore_monitor_snapshots
        `);

        logger.info('[Restore Snapshots] CSV staging 完成:', {
          stagedRows,
          stageStats,
        });

        const [matchStats] = await execute(
          `
          SELECT
            COUNT(*) AS total_rows,
            SUM(CASE WHEN a.id IS NOT NULL THEN 1 ELSE 0 END) AS matched_asin_rows,
            SUM(CASE WHEN a.id IS NULL THEN 1 ELSE 0 END) AS unmatched_asin_rows,
            COUNT(DISTINCT CASE WHEN a.id IS NOT NULL THEN CONCAT(ts.asin, '||', ts.country) END) AS matched_distinct_asin_country,
            COUNT(DISTINCT CASE WHEN a.id IS NULL THEN CONCAT(ts.asin, '||', ts.country) END) AS unmatched_distinct_asin_country
          FROM tmp_restore_monitor_snapshots ts
          LEFT JOIN asins a
            ON a.asin = ts.asin
           AND a.country = ts.country
          WHERE ts.event_time >= ?
            AND ts.event_time < ?
        `,
          [args.startTime, args.endTimeExclusive],
        );

        logger.warn('[Restore Snapshots] ASIN 匹配情况:', matchStats);

        const insertResult = await execute(
          `INSERT INTO monitor_history (
             variant_group_id,
             variant_group_name,
             asin_id,
             asin_code,
             asin_name,
             site_snapshot,
             brand_snapshot,
             check_type,
             country,
             is_broken,
             check_time,
             check_result,
             notification_sent,
             create_time
           )
           SELECT
             COALESCE(NULLIF(ts.group_id, ''), a.variant_group_id) AS variant_group_id,
             COALESCE(
               NULLIF(vg.name, ''),
               NULLIF(ts.group_name, ''),
               NULLIF(ts.parent_title, '')
             ) AS variant_group_name,
             a.id AS asin_id,
             ts.asin AS asin_code,
             NULLIF(a.name, '') AS asin_name,
             COALESCE(
               NULLIF(ts.site, ''),
               NULLIF(a.site, ''),
               NULLIF(vg.site, '')
             ) AS site_snapshot,
             COALESCE(
               NULLIF(ts.brand, ''),
               NULLIF(a.brand, ''),
               NULLIF(vg.brand, ''),
               NULLIF(ts.amazon_brand, '')
             ) AS brand_snapshot,
             'ASIN' AS check_type,
             ts.country,
             ts.is_broken,
             ts.event_time AS check_time,
             JSON_OBJECT(
               'asin', ts.asin,
               'isBroken', ts.is_broken = 1,
               'statusSource', 'BACKUP_RESTORE',
               'backupStatus', COALESCE(ts.status_text, ''),
               'backupId', ts.backup_id,
               'batch', ts.batch_no,
               'parentTitle', COALESCE(ts.parent_title, ''),
               'chainType', COALESCE(ts.chain_type, ''),
               'peakFlag', ts.peak_flag,
               'isPeak', ts.is_peak,
               'sourceFile', ?
             ) AS check_result,
             0 AS notification_sent,
             ts.event_time AS create_time
           FROM tmp_restore_monitor_snapshots ts
           LEFT JOIN asins a
             ON a.asin = ts.asin
            AND a.country = ts.country
           LEFT JOIN variant_groups vg
             ON vg.id = COALESCE(NULLIF(ts.group_id, ''), a.variant_group_id)
           LEFT JOIN monitor_history existing
             ON existing.check_type = 'ASIN'
            AND existing.country = ts.country
            AND existing.check_time = ts.event_time
            AND COALESCE(existing.asin_code, '') = COALESCE(ts.asin, '')
           WHERE ts.event_time >= ?
             AND ts.event_time < ?
             AND existing.id IS NULL`,
          [path.basename(filePath), args.startTime, args.endTimeExclusive],
          { timeoutMs: 1800000 },
        );

        logger.info('[Restore Snapshots] monitor_history 导入完成:', {
          affectedRows: insertResult?.affectedRows || 0,
        });

        const [restoredStats] = await execute(
          `SELECT
             COUNT(*) AS total_rows,
             SUM(CASE WHEN check_type = 'ASIN' THEN 1 ELSE 0 END) AS asin_rows,
             SUM(CASE WHEN is_broken = 1 THEN 1 ELSE 0 END) AS broken_rows,
             DATE_FORMAT(MIN(check_time), '%Y-%m-%d %H:%i:%s') AS first_check_time,
             DATE_FORMAT(MAX(check_time), '%Y-%m-%d %H:%i:%s') AS last_check_time
           FROM monitor_history
           WHERE check_time >= ?
             AND check_time < ?`,
          [args.startTime, args.endTimeExclusive],
        );

        logger.info('[Restore Snapshots] 恢复后区间校验:', restoredStats);

        if (args.skipAgg) {
          logger.warn('[Restore Snapshots] 已跳过聚合重建');
          return;
        }

        const hourBaseResult =
          await analyticsAggService.refreshMonitorHistoryAgg('hour', {
            startTime: args.startTime,
            endTime: aggEndTime,
          });
        const dayBaseResult =
          await analyticsAggService.refreshMonitorHistoryAgg('day', {
            startTime: args.startTime,
            endTime: aggEndTime,
          });
        const hourDimResult =
          await analyticsAggService.refreshMonitorHistoryAggDim('hour', {
            startTime: args.startTime,
            endTime: aggEndTime,
          });
        const dayDimResult =
          await analyticsAggService.refreshMonitorHistoryAggDim('day', {
            startTime: args.startTime,
            endTime: aggEndTime,
          });

        logger.info('[Restore Snapshots] 聚合重建完成:', {
          hourBaseResult,
          dayBaseResult,
          hourDimResult,
          dayDimResult,
        });
        logger.warn(
          '[Restore Snapshots] 已跳过 variant_group 聚合重建；该备份缺少可靠的分组外键信息',
        );
      },
    );
  } catch (error) {
    logger.error('[Restore Snapshots] 恢复失败:', {
      message: error.message,
    });
    process.exitCode = 1;
  } finally {
    connection.release();
    try {
      await pool.end();
    } catch (error) {
      // 连接池关闭失败只做静默收尾，避免覆盖主错误。
    }
  }
}

main();
