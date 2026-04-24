#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { loadEnv } = require('./utils/loadEnv');

const DEFAULT_REPORT_DIR = path.resolve(__dirname, '../../backups');
const TARGET_DAY = {
  startTime: '2026-04-13 00:00:00',
  endTime: '2026-04-14 00:00:00',
};
const APPLY_BATCH_SIZE = 200;

function parseArgs(argv) {
  const args = {
    help: false,
    apply: false,
    reportDir: DEFAULT_REPORT_DIR,
    envPath: '',
  };

  for (const item of argv) {
    if (item === '--help' || item === '-h') {
      args.help = true;
      continue;
    }
    if (item === '--apply') {
      args.apply = true;
      continue;
    }
    if (item.startsWith('--report-dir=')) {
      args.reportDir = path.resolve(item.slice('--report-dir='.length).trim());
      continue;
    }
    if (item.startsWith('--env=')) {
      args.envPath = path.resolve(item.slice('--env='.length).trim());
    }
  }

  return args;
}

function usage() {
  return [
    '用法:',
    '  node scripts/repair-residual-sp-api-errors-2026-04-13.js --apply',
    '参数:',
    '  --apply                 执行备份、残余 SP-API 异常回填和聚合修复',
    `  --report-dir=...        指定报告输出目录（默认 ${DEFAULT_REPORT_DIR}）`,
    '  --env=...               指定 .env 文件路径（默认 server/.env）',
  ].join('\n');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function chunk(array, size) {
  const result = [];
  for (let index = 0; index < array.length; index += size) {
    result.push(array.slice(index, index + size));
  }
  return result;
}

function parseDateTimeInput(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const normalized = String(value).trim().replace('T', ' ');
  const match = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (!match) {
    return null;
  }

  const [, year, month, day, hour = '00', minute = '00', second = '00'] = match;
  const parsed = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    0,
  );

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '';
  }
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function buildSuffix() {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

function addSecondsText(value, seconds) {
  const date = parseDateTimeInput(value);
  if (!date) {
    return '';
  }
  date.setSeconds(date.getSeconds() + seconds);
  return formatDateTime(date);
}

function addMinutesText(value, minutes) {
  return addSecondsText(value, minutes * 60);
}

function addDaysText(value, days) {
  const date = parseDateTimeInput(value);
  if (!date) {
    return '';
  }
  date.setDate(date.getDate() + days);
  return formatDateTime(date);
}

function floorToHourText(value) {
  const date = parseDateTimeInput(value);
  if (!date) {
    return '';
  }
  date.setMinutes(0, 0, 0);
  return formatDateTime(date);
}

function floorToDayText(value) {
  const date = parseDateTimeInput(value);
  if (!date) {
    return '';
  }
  date.setHours(0, 0, 0, 0);
  return formatDateTime(date);
}

function escapeSqlValue(value) {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'NULL';
  }
  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }
  if (value instanceof Date) {
    return `'${formatDateTime(value).replace(/'/g, "''")}'`;
  }
  if (Buffer.isBuffer(value)) {
    return `X'${value.toString('hex')}'`;
  }
  return `'${String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "''")
    .replace(/\u0000/g, '')}'`;
}

async function writeSqlChunks(stream, text) {
  if (!text) {
    return;
  }
  if (stream.write(text)) {
    return;
  }
  await new Promise((resolve) => {
    stream.once('drain', resolve);
  });
}

async function getBackupableColumns(query, tableName) {
  const rows = await query(`SHOW COLUMNS FROM \`${tableName}\``);
  return rows
    .filter((row) => String(row.Extra || '').trim() !== 'VIRTUAL GENERATED')
    .map((row) => row.Field);
}

async function appendTableBackup(stream, query, tableName, rows) {
  if (!rows || rows.length === 0) {
    return;
  }

  const columns = await getBackupableColumns(query, tableName);
  const columnSql = columns.map((column) => `\`${column}\``).join(', ');

  await writeSqlChunks(stream, `\n-- table: ${tableName}\n\n`);

  for (const batch of chunk(rows, APPLY_BATCH_SIZE)) {
    const valuesSql = batch
      .map((row) => {
        const values = columns.map((column) => escapeSqlValue(row[column]));
        return `(${values.join(', ')})`;
      })
      .join(',\n');

    await writeSqlChunks(
      stream,
      `REPLACE INTO \`${tableName}\` (${columnSql}) VALUES\n${valuesSql};\n`,
    );
  }
}

function buildBatchConditionSql(batches, tableAlias = 'mh') {
  if (!batches || batches.length === 0) {
    return { sql: '1 = 0', params: [] };
  }

  const conditions = [];
  const params = [];
  for (const batch of batches) {
    conditions.push(
      `(${tableAlias}.variant_group_id = ? AND ${tableAlias}.check_time = ?)`,
    );
    params.push(batch.variantGroupId, batch.abnormalCheckTime);
  }

  return {
    sql: conditions.join(' OR '),
    params,
  };
}

function buildAffectedAggSummary(abnormalGroups) {
  const countries = Array.from(
    new Set(abnormalGroups.map((item) => item.country)),
  ).sort();
  const hourSlots = Array.from(
    new Set(
      abnormalGroups.map((item) => floorToHourText(item.abnormalCheckTime)),
    ),
  ).sort();
  const daySlots = Array.from(
    new Set(
      abnormalGroups.map((item) => floorToDayText(item.abnormalCheckTime)),
    ),
  ).sort();
  const abnormalTimes = abnormalGroups
    .map((item) => item.abnormalCheckTime)
    .filter(Boolean)
    .sort();

  return {
    countries,
    hourSlots,
    daySlots,
    minCheckTime: abnormalTimes[0] || '',
    maxCheckTime: abnormalTimes[abnormalTimes.length - 1] || '',
  };
}

async function resolveContext(query, logger) {
  const abnormalGroups = await query(
    `
      WITH abnormal_groups AS (
        SELECT
          variant_group_id,
          variant_group_name,
          country,
          check_time,
          CAST(
            COALESCE(
              JSON_UNQUOTE(JSON_EXTRACT(check_result, '$.brokenByType.SP_API_ERROR')),
              '0'
            ) AS UNSIGNED
          ) AS sp_api_error_asins
        FROM monitor_history FORCE INDEX (idx_check_time)
        WHERE check_time >= ?
          AND check_time < ?
          AND asin_code IS NULL
          AND CAST(
            COALESCE(
              JSON_UNQUOTE(JSON_EXTRACT(check_result, '$.brokenByType.SP_API_ERROR')),
              '0'
            ) AS UNSIGNED
          ) > 0
      )
      SELECT
        ag.variant_group_id,
        ag.variant_group_name,
        ag.country,
        DATE_FORMAT(ag.check_time, '%Y-%m-%d %H:%i:%s') AS abnormal_check_time,
        ag.sp_api_error_asins,
        (
          SELECT DATE_FORMAT(mh2.check_time, '%Y-%m-%d %H:%i:%s')
          FROM monitor_history mh2
          WHERE mh2.variant_group_id = ag.variant_group_id
            AND mh2.asin_code IS NULL
            AND mh2.check_time >= ?
            AND mh2.check_time < ag.check_time
            AND CAST(
              COALESCE(
                JSON_UNQUOTE(JSON_EXTRACT(mh2.check_result, '$.brokenByType.SP_API_ERROR')),
                '0'
              ) AS UNSIGNED
            ) = 0
          ORDER BY mh2.check_time DESC
          LIMIT 1
        ) AS baseline_check_time,
        (
          SELECT COUNT(*)
          FROM monitor_history mh3
          WHERE mh3.variant_group_id = ag.variant_group_id
            AND mh3.check_time = ag.check_time
        ) AS abnormal_row_count
      FROM abnormal_groups ag
      ORDER BY ag.check_time ASC, ag.country ASC, ag.variant_group_name ASC
    `,
    [TARGET_DAY.startTime, TARGET_DAY.endTime, TARGET_DAY.startTime],
  );

  if (abnormalGroups.length === 0) {
    logger.info(
      '[Residual SP-API Repair] 今日未发现残余 SP_API_ERROR 异常批次',
    );
    return {
      abnormalGroups: [],
      affectedAggSummary: buildAffectedAggSummary([]),
    };
  }

  const normalizedGroups = [];
  const missingBaseline = [];

  for (const item of abnormalGroups) {
    if (!item.baseline_check_time) {
      missingBaseline.push(item);
      continue;
    }

    const baselineSummaryRows = await query(
      `
        SELECT
          COUNT(*) AS row_count,
          SUM(CASE WHEN is_broken = 1 THEN 1 ELSE 0 END) AS broken_rows,
          SUM(
            CASE
              WHEN asin_code IS NULL THEN CAST(
                COALESCE(
                  JSON_UNQUOTE(JSON_EXTRACT(check_result, '$.brokenByType.SP_API_ERROR')),
                  '0'
                ) AS UNSIGNED
              )
              ELSE 0
            END
          ) AS sp_api_error_asins
        FROM monitor_history
        WHERE variant_group_id = ?
          AND check_time = ?
      `,
      [item.variant_group_id, item.baseline_check_time],
    );

    const baselineSummary = baselineSummaryRows[0] || {};
    normalizedGroups.push({
      variantGroupId: item.variant_group_id,
      variantGroupName: item.variant_group_name,
      country: item.country,
      abnormalCheckTime: item.abnormal_check_time,
      baselineCheckTime: item.baseline_check_time,
      spApiErrorAsins: Number(item.sp_api_error_asins || 0),
      abnormalRowCount: Number(item.abnormal_row_count || 0),
      baselineRowCount: Number(baselineSummary.row_count || 0),
      baselineBrokenRows: Number(baselineSummary.broken_rows || 0),
      baselineSpApiErrorAsins: Number(baselineSummary.sp_api_error_asins || 0),
    });
  }

  if (missingBaseline.length > 0) {
    throw new Error(
      `存在无法找到当天基线的异常批次: ${missingBaseline
        .map(
          (item) =>
            `${item.country}/${item.variant_group_name}@${item.abnormal_check_time}`,
        )
        .join(', ')}`,
    );
  }

  const rowCountMismatch = normalizedGroups.filter(
    (item) => item.abnormalRowCount !== item.baselineRowCount,
  );
  if (rowCountMismatch.length > 0) {
    throw new Error(
      `发现批次数量不一致，停止修复: ${rowCountMismatch
        .map(
          (item) =>
            `${item.country}/${item.variantGroupName} abnormal=${item.abnormalRowCount} baseline=${item.baselineRowCount}`,
        )
        .join(', ')}`,
    );
  }

  const affectedAggSummary = buildAffectedAggSummary(normalizedGroups);
  logger.info('[Residual SP-API Repair] 异常上下文解析完成', {
    targetDay: TARGET_DAY,
    abnormalBatchCount: normalizedGroups.length,
    affectedAggSummary,
  });

  return {
    abnormalGroups: normalizedGroups,
    affectedAggSummary,
  };
}

async function fetchRepairRows(query, context) {
  const batchCondition = buildBatchConditionSql(context.abnormalGroups, 'mh');
  return query(
    `
      SELECT mh.*
      FROM monitor_history mh
      WHERE ${batchCondition.sql}
      ORDER BY mh.check_time ASC, mh.id ASC
    `,
    batchCondition.params,
  );
}

async function fetchAggBackupRows(query, tableName, context) {
  const summary = context.affectedAggSummary;
  if (
    !summary.countries.length ||
    !summary.hourSlots.length ||
    !summary.daySlots.length
  ) {
    return [];
  }

  return query(
    `
      SELECT *
      FROM \`${tableName}\`
      WHERE country IN (${summary.countries.map(() => '?').join(', ')})
        AND (
          (granularity = 'hour' AND time_slot IN (${summary.hourSlots
            .map(() => '?')
            .join(', ')}))
          OR
          (granularity = 'day' AND time_slot IN (${summary.daySlots
            .map(() => '?')
            .join(', ')}))
        )
      ORDER BY country ASC, granularity ASC, time_slot ASC
    `,
    [...summary.countries, ...summary.hourSlots, ...summary.daySlots],
  );
}

function buildMonitorHistoryRestoreDeleteSql(context) {
  return context.abnormalGroups
    .map(
      (item) => `DELETE FROM monitor_history
WHERE variant_group_id = ${escapeSqlValue(item.variantGroupId)}
  AND check_time = ${escapeSqlValue(item.abnormalCheckTime)};`,
    )
    .join('\n\n');
}

function buildAggRestoreDeleteSql(tableName, context) {
  const summary = context.affectedAggSummary;
  if (
    !summary.countries.length ||
    !summary.hourSlots.length ||
    !summary.daySlots.length
  ) {
    return '';
  }

  return `DELETE FROM \`${tableName}\`
WHERE country IN (${summary.countries
    .map((item) => escapeSqlValue(item))
    .join(', ')})
  AND (
    (granularity = 'hour'
      AND time_slot IN (${summary.hourSlots
        .map((item) => escapeSqlValue(item))
        .join(', ')}))
    OR
    (granularity = 'day'
      AND time_slot IN (${summary.daySlots
        .map((item) => escapeSqlValue(item))
        .join(', ')}))
  );`;
}

async function createScopedSqlBackup(
  query,
  context,
  repairRows,
  reportDir,
  logger,
) {
  ensureDir(reportDir);
  const filename = `residual-sp-api-repair-backup-${buildSuffix()}.sql`;
  const filepath = path.join(reportDir, filename);
  const stream = fs.createWriteStream(filepath, { encoding: 'utf8' });

  try {
    const aggRows = await fetchAggBackupRows(
      query,
      'monitor_history_agg',
      context,
    );
    const aggDimRows = await fetchAggBackupRows(
      query,
      'monitor_history_agg_dim',
      context,
    );
    const aggVariantRows = await fetchAggBackupRows(
      query,
      'monitor_history_agg_variant_group',
      context,
    );

    await writeSqlChunks(
      stream,
      [
        '-- Scoped SQL backup for residual SP-API repair on 2026-04-13',
        `-- created_at: ${new Date().toISOString()}`,
        '-- scope: rows deleted or replaced by this execution',
        'SET NAMES utf8mb4;',
        'SET FOREIGN_KEY_CHECKS = 0;',
        '',
      ].join('\n'),
    );

    await writeSqlChunks(
      stream,
      `${buildMonitorHistoryRestoreDeleteSql(context)}\n\n`,
    );
    await appendTableBackup(stream, query, 'monitor_history', repairRows);
    await writeSqlChunks(
      stream,
      `${buildAggRestoreDeleteSql('monitor_history_agg', context)}\n\n`,
    );
    await appendTableBackup(stream, query, 'monitor_history_agg', aggRows);
    await writeSqlChunks(
      stream,
      `${buildAggRestoreDeleteSql('monitor_history_agg_dim', context)}\n\n`,
    );
    await appendTableBackup(
      stream,
      query,
      'monitor_history_agg_dim',
      aggDimRows,
    );
    await writeSqlChunks(
      stream,
      `${buildAggRestoreDeleteSql(
        'monitor_history_agg_variant_group',
        context,
      )}\n\n`,
    );
    await appendTableBackup(
      stream,
      query,
      'monitor_history_agg_variant_group',
      aggVariantRows,
    );
    await writeSqlChunks(stream, '\nSET FOREIGN_KEY_CHECKS = 1;\n');

    await new Promise((resolve, reject) => {
      stream.end(() => resolve());
      stream.on('error', reject);
    });

    const stats = fs.statSync(filepath);
    const summary = {
      monitor_history: repairRows.length,
      monitor_history_agg: aggRows.length,
      monitor_history_agg_dim: aggDimRows.length,
      monitor_history_agg_variant_group: aggVariantRows.length,
    };

    logger.info('[Residual SP-API Repair] Scoped SQL 备份完成', {
      filepath,
      size: stats.size,
      summary,
    });

    return {
      filename,
      filepath,
      size: stats.size,
      createdAt: new Date().toISOString(),
      summary,
      mode: 'scoped_sql',
    };
  } catch (error) {
    stream.destroy();
    try {
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }
    } catch (unlinkError) {}
    throw error;
  }
}

async function applyMonitorHistoryMutation(withTransaction, context) {
  return withTransaction(async ({ query }) => {
    const batchResults = [];

    for (const item of context.abnormalGroups) {
      const deltaSeconds = Math.floor(
        (parseDateTimeInput(item.abnormalCheckTime).getTime() -
          parseDateTimeInput(item.baselineCheckTime).getTime()) /
          1000,
      );

      const deleteResult = await query(
        `
          DELETE FROM monitor_history
          WHERE variant_group_id = ?
            AND check_time = ?
        `,
        [item.variantGroupId, item.abnormalCheckTime],
      );

      const insertResult = await query(
        `
          INSERT INTO monitor_history (
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
            DATE_ADD(check_time, INTERVAL ? SECOND) AS check_time,
            check_result,
            notification_sent,
            DATE_ADD(create_time, INTERVAL ? SECOND) AS create_time
          FROM monitor_history
          WHERE variant_group_id = ?
            AND check_time = ?
        `,
        [
          deltaSeconds,
          deltaSeconds,
          item.variantGroupId,
          item.baselineCheckTime,
        ],
      );

      batchResults.push({
        country: item.country,
        variantGroupName: item.variantGroupName,
        abnormalCheckTime: item.abnormalCheckTime,
        baselineCheckTime: item.baselineCheckTime,
        deletedRows: Number(deleteResult?.affectedRows || 0),
        insertedRows: Number(insertResult?.affectedRows || 0),
      });
    }

    return {
      replacedBatchCount: batchResults.length,
      totalDeletedRows: batchResults.reduce(
        (sum, item) => sum + item.deletedRows,
        0,
      ),
      totalInsertedRows: batchResults.reduce(
        (sum, item) => sum + item.insertedRows,
        0,
      ),
      batchResults,
    };
  });
}

async function clearAffectedAggRows(query, context) {
  const summary = context.affectedAggSummary;
  const result = {};

  if (
    !summary.countries.length ||
    !summary.hourSlots.length ||
    !summary.daySlots.length
  ) {
    result.monitor_history_agg = 0;
    result.monitor_history_agg_dim = 0;
    result.monitor_history_agg_variant_group = 0;
    return result;
  }

  const definitions = [
    {
      key: 'monitor_history_agg',
      sql: `
        DELETE FROM monitor_history_agg
        WHERE country IN (${summary.countries.map(() => '?').join(', ')})
          AND (
            (granularity = 'hour' AND time_slot IN (${summary.hourSlots
              .map(() => '?')
              .join(', ')}))
            OR
            (granularity = 'day' AND time_slot IN (${summary.daySlots
              .map(() => '?')
              .join(', ')}))
          )
      `,
    },
    {
      key: 'monitor_history_agg_dim',
      sql: `
        DELETE FROM monitor_history_agg_dim
        WHERE country IN (${summary.countries.map(() => '?').join(', ')})
          AND (
            (granularity = 'hour' AND time_slot IN (${summary.hourSlots
              .map(() => '?')
              .join(', ')}))
            OR
            (granularity = 'day' AND time_slot IN (${summary.daySlots
              .map(() => '?')
              .join(', ')}))
          )
      `,
    },
    {
      key: 'monitor_history_agg_variant_group',
      sql: `
        DELETE FROM monitor_history_agg_variant_group
        WHERE country IN (${summary.countries.map(() => '?').join(', ')})
          AND (
            (granularity = 'hour' AND time_slot IN (${summary.hourSlots
              .map(() => '?')
              .join(', ')}))
            OR
            (granularity = 'day' AND time_slot IN (${summary.daySlots
              .map(() => '?')
              .join(', ')}))
          )
      `,
    },
  ];

  const params = [
    ...summary.countries,
    ...summary.hourSlots,
    ...summary.daySlots,
  ];
  for (const item of definitions) {
    const queryResult = await query(item.sql, params);
    result[item.key] = Number(queryResult?.affectedRows || 0);
  }

  return result;
}

function buildRefreshWindows(context) {
  const { hourSlots, daySlots } = context.affectedAggSummary;
  const hourWindow =
    hourSlots.length > 0
      ? {
          startTime: hourSlots[0],
          endTime: addSecondsText(
            addMinutesText(hourSlots[hourSlots.length - 1], 60),
            -1,
          ),
        }
      : null;
  const dayWindow =
    daySlots.length > 0
      ? {
          startTime: daySlots[0],
          endTime: addSecondsText(
            addDaysText(daySlots[daySlots.length - 1], 1),
            -1,
          ),
        }
      : null;

  return { hourWindow, dayWindow };
}

async function refreshAffectedAggWindow(analyticsAggService, context) {
  const { hourWindow, dayWindow } = buildRefreshWindows(context);
  return {
    hourWindow,
    dayWindow,
    hour: hourWindow
      ? await analyticsAggService.refreshAnalyticsAggBundle('hour', hourWindow)
      : { skipped: true, reason: 'no_hour_window' },
    day: dayWindow
      ? await analyticsAggService.refreshAnalyticsAggBundle('day', dayWindow)
      : { skipped: true, reason: 'no_day_window' },
  };
}

async function collectPostVerification(query, context) {
  const residualRows = await query(
    `
      SELECT
        country,
        variant_group_name,
        DATE_FORMAT(check_time, '%Y-%m-%d %H:%i:%s') AS check_time,
        CAST(
          COALESCE(
            JSON_UNQUOTE(JSON_EXTRACT(check_result, '$.brokenByType.SP_API_ERROR')),
            '0'
          ) AS UNSIGNED
        ) AS sp_api_error_asins
      FROM monitor_history
      WHERE check_time >= ?
        AND check_time < ?
        AND asin_code IS NULL
        AND CAST(
          COALESCE(
            JSON_UNQUOTE(JSON_EXTRACT(check_result, '$.brokenByType.SP_API_ERROR')),
            '0'
          ) AS UNSIGNED
        ) > 0
      ORDER BY check_time ASC, country ASC, variant_group_name ASC
    `,
    [TARGET_DAY.startTime, TARGET_DAY.endTime],
  );

  const batchComparisons = [];
  for (const item of context.abnormalGroups) {
    const repairedRows = await query(
      `
        SELECT
          COUNT(*) AS row_count,
          SUM(CASE WHEN is_broken = 1 THEN 1 ELSE 0 END) AS broken_rows,
          SUM(
            CASE
              WHEN asin_code IS NULL THEN CAST(
                COALESCE(
                  JSON_UNQUOTE(JSON_EXTRACT(check_result, '$.brokenByType.SP_API_ERROR')),
                  '0'
                ) AS UNSIGNED
              )
              ELSE 0
            END
          ) AS sp_api_error_asins
        FROM monitor_history
        WHERE variant_group_id = ?
          AND check_time = ?
      `,
      [item.variantGroupId, item.abnormalCheckTime],
    );

    const repairedSummary = repairedRows[0] || {};
    const rowCount = Number(repairedSummary.row_count || 0);
    const brokenRows = Number(repairedSummary.broken_rows || 0);
    const spApiErrorAsins = Number(repairedSummary.sp_api_error_asins || 0);

    batchComparisons.push({
      country: item.country,
      variantGroupName: item.variantGroupName,
      abnormalCheckTime: item.abnormalCheckTime,
      baselineCheckTime: item.baselineCheckTime,
      rowCount,
      brokenRows,
      spApiErrorAsins,
      baselineRowCount: item.baselineRowCount,
      baselineBrokenRows: item.baselineBrokenRows,
      passed:
        rowCount === item.baselineRowCount &&
        brokenRows === item.baselineBrokenRows &&
        spApiErrorAsins === 0,
    });
  }

  return {
    residualRows,
    batchComparisons,
    checks: {
      residualSpApiErrorCleared: residualRows.length === 0,
      repairedBatchesAligned: batchComparisons.every((item) => item.passed),
    },
  };
}

function writeReport(reportDir, payload) {
  ensureDir(reportDir);
  const reportPath = path.join(
    reportDir,
    `residual-sp-api-repair-report-${buildSuffix()}.json`,
  );
  fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2), 'utf8');
  return reportPath;
}

async function closeResources(pool, redisConfig, logger) {
  try {
    await redisConfig.closeRedis();
  } catch (error) {
    logger.warn('[Residual SP-API Repair] 关闭 Redis 失败', {
      message: error.message,
    });
  }

  try {
    await pool.end();
  } catch (error) {
    logger.warn('[Residual SP-API Repair] 关闭数据库连接池失败', {
      message: error.message,
    });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const envPath = args.envPath
    ? path.resolve(args.envPath)
    : path.join(__dirname, '../.env');

  loadEnv(envPath);

  const logger = require('../src/utils/logger');
  const {
    query,
    withTransaction,
    testConnection,
  } = require('../src/config/database');
  const analyticsAggService = require('../src/services/analyticsAggService');
  const MonitorHistory = require('../src/models/MonitorHistory');

  const startedAt = new Date();
  let exitCode = 0;

  try {
    if (args.help) {
      logger.info(usage());
      return;
    }

    if (!args.apply) {
      logger.warn('[Residual SP-API Repair] 该脚本仅允许显式 --apply 执行');
      logger.info(usage());
      exitCode = 1;
      return;
    }

    const connected = await testConnection();
    if (!connected) {
      throw new Error('数据库连接失败');
    }

    const context = await resolveContext(query, logger);
    if (context.abnormalGroups.length === 0) {
      const report = {
        kind: 'residual-sp-api-repair-2026-04-13',
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        envPath,
        targetDay: TARGET_DAY,
        preview: {
          abnormalBatchCount: 0,
          affectedAggSummary: context.affectedAggSummary,
        },
        mutationResult: {
          replacedBatchCount: 0,
          totalDeletedRows: 0,
          totalInsertedRows: 0,
        },
        postVerification: {
          residualRows: [],
          batchComparisons: [],
          checks: {
            residualSpApiErrorCleared: true,
            repairedBatchesAligned: true,
          },
        },
      };
      const reportPath = writeReport(args.reportDir, report);
      logger.info('[Residual SP-API Repair] 无需修复，报告已写入', {
        reportPath,
      });
      return;
    }

    const repairRows = await fetchRepairRows(query, context);
    const preview = {
      abnormalBatchCount: context.abnormalGroups.length,
      affectedRawRows: repairRows.length,
      affectedAggSummary: context.affectedAggSummary,
      abnormalGroups: context.abnormalGroups,
    };
    logger.info('[Residual SP-API Repair] 变更预览', preview);

    const backup = await createScopedSqlBackup(
      query,
      context,
      repairRows,
      args.reportDir,
      logger,
    );

    const mutationResult = await applyMonitorHistoryMutation(
      withTransaction,
      context,
    );
    logger.info('[Residual SP-API Repair] monitor_history 事务已提交', {
      replacedBatchCount: mutationResult.replacedBatchCount,
      totalDeletedRows: mutationResult.totalDeletedRows,
      totalInsertedRows: mutationResult.totalInsertedRows,
    });

    const clearedAggRows = await clearAffectedAggRows(query, context);
    logger.info(
      '[Residual SP-API Repair] 聚合受影响窗口已清理',
      clearedAggRows,
    );

    const aggRefreshResult = await refreshAffectedAggWindow(
      analyticsAggService,
      context,
    );
    MonitorHistory.invalidateCaches();
    logger.info(
      '[Residual SP-API Repair] 聚合重建与缓存失效完成',
      aggRefreshResult,
    );

    const postVerification = await collectPostVerification(query, context);
    const report = {
      kind: 'residual-sp-api-repair-2026-04-13',
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      envPath,
      targetDay: TARGET_DAY,
      preview,
      backup,
      mutationResult,
      clearedAggRows,
      aggRefreshResult,
      postVerification,
    };

    const reportPath = writeReport(args.reportDir, report);
    logger.info('[Residual SP-API Repair] 报告已写入', { reportPath });
    logger.info('[Residual SP-API Repair] 执行完成', {
      reportPath,
      backupFile: backup.filepath,
      finalChecks: postVerification.checks,
    });
  } catch (error) {
    const logger = require('../src/utils/logger');
    logger.error('[Residual SP-API Repair] 执行失败', {
      message: error.message,
    });
    exitCode = 1;
  } finally {
    const logger = require('../src/utils/logger');
    const redisConfig = require('../src/config/redis');
    const { pool } = require('../src/config/database');
    await closeResources(pool, redisConfig, logger);
    process.exit(exitCode);
  }
}

main();
