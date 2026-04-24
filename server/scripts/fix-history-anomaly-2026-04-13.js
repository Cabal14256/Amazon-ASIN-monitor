#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { loadEnv } = require('./utils/loadEnv');

const DEFAULT_REPORT_DIR = path.resolve(__dirname, '../../backups');
const TARGET_ASINS = ['B08NDV9741', 'B0GQ9M9Q7D', 'B0GQ9ZKGL4'];
const ARCHIVE_DELETE_CUTOFF = '2026-04-10 18:00:00';
const REQUESTED_BASELINE_WINDOW = {
  startTime: '2026-04-13 11:00:00',
  endTime: '2026-04-13 11:30:00',
};
const REPAIR_WINDOW = {
  startTime: '2026-04-13 11:30:00',
  endTime: '2026-04-13 16:00:00',
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
    '  node scripts/fix-history-anomaly-2026-04-13.js --apply',
    '参数:',
    '  --apply                 执行归档、删除、异常窗口回滚和聚合修复',
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

function addMinutesText(value, minutes) {
  const date = parseDateTimeInput(value);
  if (!date) {
    return '';
  }
  date.setMinutes(date.getMinutes() + minutes);
  return formatDateTime(date);
}

function getHalfHourSlotExpr(fieldName = 'check_time') {
  return `
    DATE_FORMAT(
      DATE_SUB(
        DATE_SUB(${fieldName}, INTERVAL SECOND(${fieldName}) SECOND),
        INTERVAL (MINUTE(${fieldName}) MOD 30) MINUTE
      ),
      '%Y-%m-%d %H:%i:00'
    )
  `;
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

function buildSlotConditionSql(slots, tableAlias = 'mh') {
  if (!slots || slots.length === 0) {
    return { sql: '1 = 0', params: [] };
  }

  const conditions = [];
  const params = [];
  for (const slot of slots) {
    conditions.push(
      `(${tableAlias}.country = ? AND ${tableAlias}.check_time >= ? AND ${tableAlias}.check_time < DATE_ADD(?, INTERVAL 30 MINUTE))`,
    );
    params.push(slot.country, slot.slotStart, slot.slotStart);
  }

  return {
    sql: conditions.join(' OR '),
    params,
  };
}

async function resolveContext(query, logger) {
  const targetSlots = await query(
    `
      SELECT
        country,
        ${getHalfHourSlotExpr('check_time')} AS slot_start,
        COUNT(*) AS row_count,
        SUM(CASE WHEN is_broken = 1 THEN 1 ELSE 0 END) AS broken_count,
        MIN(DATE_FORMAT(check_time, '%Y-%m-%d %H:%i:%s')) AS min_time,
        MAX(DATE_FORMAT(check_time, '%Y-%m-%d %H:%i:%s')) AS max_time
      FROM monitor_history FORCE INDEX (idx_check_time)
      WHERE check_time >= ?
        AND check_time < ?
      GROUP BY country, slot_start
      ORDER BY slot_start ASC, country ASC
    `,
    [REPAIR_WINDOW.startTime, REPAIR_WINDOW.endTime],
  );

  if (targetSlots.length === 0) {
    throw new Error('异常窗口内没有可修复的 monitor_history 记录');
  }

  const targetCountries = Array.from(
    new Set(targetSlots.map((item) => item.country)),
  ).sort();

  const requestedBaselineRows = await query(
    `
      SELECT country, COUNT(*) AS row_count
      FROM monitor_history FORCE INDEX (idx_country_check_time)
      WHERE check_time >= ?
        AND check_time < ?
        AND country IN (${targetCountries.map(() => '?').join(', ')})
      GROUP BY country
      ORDER BY country ASC
    `,
    [
      REQUESTED_BASELINE_WINDOW.startTime,
      REQUESTED_BASELINE_WINDOW.endTime,
      ...targetCountries,
    ],
  );
  const requestedBaselineMap = new Map(
    requestedBaselineRows.map((item) => [
      item.country,
      Number(item.row_count || 0),
    ]),
  );

  const latestBaselineRows = await query(
    `
      SELECT country, MAX(slot_start) AS slot_start
      FROM (
        SELECT
          country,
          ${getHalfHourSlotExpr('check_time')} AS slot_start
        FROM monitor_history FORCE INDEX (idx_country_check_time)
        WHERE check_time < ?
          AND country IN (${targetCountries.map(() => '?').join(', ')})
        GROUP BY country, slot_start
      ) slot_candidates
      GROUP BY country
      ORDER BY country ASC
    `,
    [REPAIR_WINDOW.startTime, ...targetCountries],
  );

  const baselineByCountry = new Map();
  for (const item of latestBaselineRows) {
    baselineByCountry.set(item.country, {
      country: item.country,
      requestedWindowStart: REQUESTED_BASELINE_WINDOW.startTime,
      requestedWindowEnd: REQUESTED_BASELINE_WINDOW.endTime,
      requestedWindowRowCount: requestedBaselineMap.get(item.country) || 0,
      resolvedSlotStart: item.slot_start,
      resolvedSlotEnd: addMinutesText(item.slot_start, 30),
      fallbackUsed: item.slot_start !== REQUESTED_BASELINE_WINDOW.startTime,
    });
  }

  const missingCountries = targetCountries.filter(
    (country) => !baselineByCountry.has(country),
  );
  if (missingCountries.length > 0) {
    throw new Error(
      `异常窗口国家缺少可用基线窗口: ${missingCountries.join(', ')}`,
    );
  }

  const baselineSlotSummaries = [];
  for (const country of targetCountries) {
    const baseline = baselineByCountry.get(country);
    const rows = await query(
      `
        SELECT
          ? AS country,
          check_type,
          COUNT(*) AS row_count,
          SUM(CASE WHEN is_broken = 1 THEN 1 ELSE 0 END) AS broken_count,
          MIN(DATE_FORMAT(check_time, '%Y-%m-%d %H:%i:%s')) AS min_time,
          MAX(DATE_FORMAT(check_time, '%Y-%m-%d %H:%i:%s')) AS max_time
        FROM monitor_history FORCE INDEX (idx_country_check_time)
        WHERE country = ?
          AND check_time >= ?
          AND check_time < ?
        GROUP BY check_type
        ORDER BY check_type ASC
      `,
      [country, country, baseline.resolvedSlotStart, baseline.resolvedSlotEnd],
    );
    baseline.rowCount = rows.reduce(
      (sum, item) => sum + Number(item.row_count || 0),
      0,
    );
    baseline.brokenCount = rows.reduce(
      (sum, item) => sum + Number(item.broken_count || 0),
      0,
    );
    baselineSlotSummaries.push(...rows);
  }

  logger.info('[History Sync] 基线窗口解析完成', {
    requestedBaselineWindow: REQUESTED_BASELINE_WINDOW,
    repairWindow: REPAIR_WINDOW,
    targetSlotCount: targetSlots.length,
    targetCountries,
    baselineByCountry: Object.fromEntries(
      Array.from(baselineByCountry.entries()).map(([country, item]) => [
        country,
        item,
      ]),
    ),
  });

  return {
    targetSlots: targetSlots.map((item) => ({
      country: item.country,
      slotStart: item.slot_start,
      slotEnd: addMinutesText(item.slot_start, 30),
      rowCount: Number(item.row_count || 0),
      brokenCount: Number(item.broken_count || 0),
      minTime: item.min_time,
      maxTime: item.max_time,
    })),
    targetCountries,
    baselineByCountry,
    baselineSlotSummaries,
  };
}

async function fetchArchiveDeleteRows(query) {
  return query(
    `
      SELECT *
      FROM monitor_history
      WHERE country = 'US'
        AND asin_code IN (${TARGET_ASINS.map(() => '?').join(', ')})
        AND check_time < ?
      ORDER BY check_time ASC, id ASC
    `,
    [...TARGET_ASINS, ARCHIVE_DELETE_CUTOFF],
  );
}

async function fetchRepairWindowRows(query, context) {
  const slotCondition = buildSlotConditionSql(context.targetSlots, 'mh');
  return query(
    `
      SELECT mh.*
      FROM monitor_history mh
      WHERE ${slotCondition.sql}
      ORDER BY mh.check_time ASC, mh.id ASC
    `,
    slotCondition.params,
  );
}

function collectArchiveSummary(rows) {
  const summary = {
    rowCount: rows.length,
    asinCounts: {},
    minCheckTime: '',
    maxCheckTime: '',
    hourStart: '',
    hourEnd: '',
    dayStart: '',
    dayEnd: '',
  };

  if (rows.length === 0) {
    return summary;
  }

  for (const row of rows) {
    const asinCode = row.asin_code || '';
    summary.asinCounts[asinCode] = (summary.asinCounts[asinCode] || 0) + 1;
  }

  summary.minCheckTime = formatDateTime(rows[0].check_time);
  summary.maxCheckTime = formatDateTime(rows[rows.length - 1].check_time);
  summary.hourStart = floorToHourText(summary.minCheckTime);
  summary.hourEnd = floorToHourText(summary.maxCheckTime);
  summary.dayStart = floorToDayText(summary.minCheckTime);
  summary.dayEnd = floorToDayText(summary.maxCheckTime);
  return summary;
}

function collectRepairSummary(rows, context) {
  const hourSlots = Array.from(
    new Set(context.targetSlots.map((item) => floorToHourText(item.slotStart))),
  ).sort();
  const daySlots = Array.from(
    new Set(context.targetSlots.map((item) => floorToDayText(item.slotStart))),
  ).sort();
  return {
    rowCount: rows.length,
    targetSlotCount: context.targetSlots.length,
    hourSlots,
    daySlots,
    countries: context.targetCountries,
  };
}

async function fetchAggBackupRows(
  query,
  tableName,
  archiveSummary,
  repairSummary,
) {
  const conditions = [];
  const params = [];

  if (archiveSummary.rowCount > 0) {
    conditions.push(`
      (
        country = 'US'
        AND asin_key IN (${TARGET_ASINS.map(() => '?').join(', ')})
        AND (
          (granularity = 'hour' AND time_slot >= ? AND time_slot <= ?)
          OR (granularity = 'day' AND time_slot >= ? AND time_slot <= ?)
        )
      )
    `);
    params.push(
      ...TARGET_ASINS,
      archiveSummary.hourStart,
      archiveSummary.hourEnd,
      archiveSummary.dayStart,
      archiveSummary.dayEnd,
    );
  }

  if (repairSummary.hourSlots.length > 0) {
    conditions.push(`
      (
        country IN (${repairSummary.countries.map(() => '?').join(', ')})
        AND (
          (granularity = 'hour' AND time_slot IN (${repairSummary.hourSlots
            .map(() => '?')
            .join(', ')}))
          OR (granularity = 'day' AND time_slot IN (${repairSummary.daySlots
            .map(() => '?')
            .join(', ')}))
        )
      )
    `);
    params.push(
      ...repairSummary.countries,
      ...repairSummary.hourSlots,
      ...repairSummary.daySlots,
    );
  }

  if (conditions.length === 0) {
    return [];
  }

  return query(
    `
      SELECT *
      FROM \`${tableName}\`
      WHERE ${conditions.join(' OR ')}
      ORDER BY country ASC, granularity ASC, time_slot ASC
    `,
    params,
  );
}

function buildMonitorHistoryRestoreDeleteSql(targetSlots) {
  const statements = [
    `DELETE FROM monitor_history
WHERE country = 'US'
  AND asin_code IN (${TARGET_ASINS.map((item) => escapeSqlValue(item)).join(
    ', ',
  )})
  AND check_time < ${escapeSqlValue(ARCHIVE_DELETE_CUTOFF)};`,
  ];

  for (const slot of targetSlots) {
    statements.push(`DELETE FROM monitor_history
WHERE country = ${escapeSqlValue(slot.country)}
  AND check_time >= ${escapeSqlValue(slot.slotStart)}
  AND check_time < DATE_ADD(${escapeSqlValue(
    slot.slotStart,
  )}, INTERVAL 30 MINUTE);`);
  }

  return statements.join('\n\n');
}

function buildAggRestoreDeleteSql(tableName, archiveSummary, repairSummary) {
  const statements = [];

  if (archiveSummary.rowCount > 0) {
    statements.push(`DELETE FROM \`${tableName}\`
WHERE country = 'US'
  AND asin_key IN (${TARGET_ASINS.map((item) => escapeSqlValue(item)).join(
    ', ',
  )})
  AND (
    (granularity = 'hour'
      AND time_slot >= ${escapeSqlValue(archiveSummary.hourStart)}
      AND time_slot <= ${escapeSqlValue(archiveSummary.hourEnd)})
    OR
    (granularity = 'day'
      AND time_slot >= ${escapeSqlValue(archiveSummary.dayStart)}
      AND time_slot <= ${escapeSqlValue(archiveSummary.dayEnd)})
  );`);
  }

  if (repairSummary.hourSlots.length > 0) {
    statements.push(`DELETE FROM \`${tableName}\`
WHERE country IN (${repairSummary.countries
      .map((item) => escapeSqlValue(item))
      .join(', ')})
  AND (
    (granularity = 'hour'
      AND time_slot IN (${repairSummary.hourSlots
        .map((item) => escapeSqlValue(item))
        .join(', ')}))
    OR
    (granularity = 'day'
      AND time_slot IN (${repairSummary.daySlots
        .map((item) => escapeSqlValue(item))
        .join(', ')}))
  );`);
  }

  return statements.join('\n\n');
}

async function createScopedSqlBackup(
  query,
  context,
  archiveRows,
  repairRows,
  archiveSummary,
  repairSummary,
  reportDir,
  logger,
) {
  ensureDir(reportDir);
  const filename = `history-anomaly-sync-backup-${buildSuffix()}.sql`;
  const filepath = path.join(reportDir, filename);
  const stream = fs.createWriteStream(filepath, { encoding: 'utf8' });

  try {
    const aggRows = await fetchAggBackupRows(
      query,
      'monitor_history_agg',
      archiveSummary,
      repairSummary,
    );
    const aggDimRows = await fetchAggBackupRows(
      query,
      'monitor_history_agg_dim',
      archiveSummary,
      repairSummary,
    );
    const aggVariantRows = await fetchAggBackupRows(
      query,
      'monitor_history_agg_variant_group',
      archiveSummary,
      repairSummary,
    );

    await writeSqlChunks(
      stream,
      [
        '-- Scoped SQL backup for 2026-04-13 anomaly history sync',
        `-- created_at: ${new Date().toISOString()}`,
        '-- scope: rows deleted or replaced by this execution',
        'SET NAMES utf8mb4;',
        'SET FOREIGN_KEY_CHECKS = 0;',
        '',
      ].join('\n'),
    );

    await writeSqlChunks(
      stream,
      `${buildMonitorHistoryRestoreDeleteSql(context.targetSlots)}\n\n`,
    );
    await appendTableBackup(stream, query, 'monitor_history', [
      ...archiveRows,
      ...repairRows,
    ]);
    await writeSqlChunks(
      stream,
      `${buildAggRestoreDeleteSql(
        'monitor_history_agg',
        archiveSummary,
        repairSummary,
      )}\n\n`,
    );
    await appendTableBackup(stream, query, 'monitor_history_agg', aggRows);
    await writeSqlChunks(
      stream,
      `${buildAggRestoreDeleteSql(
        'monitor_history_agg_dim',
        archiveSummary,
        repairSummary,
      )}\n\n`,
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
        archiveSummary,
        repairSummary,
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
      monitor_history: archiveRows.length + repairRows.length,
      monitor_history_agg: aggRows.length,
      monitor_history_agg_dim: aggDimRows.length,
      monitor_history_agg_variant_group: aggVariantRows.length,
    };

    logger.info('[History Sync] Scoped SQL 备份完成', {
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
    const archiveDeleteResult = await query(
      `
        DELETE FROM monitor_history
        WHERE country = 'US'
          AND asin_code IN (${TARGET_ASINS.map(() => '?').join(', ')})
          AND check_time < ?
      `,
      [...TARGET_ASINS, ARCHIVE_DELETE_CUTOFF],
    );

    const slotResults = [];
    for (const slot of context.targetSlots) {
      const baseline = context.baselineByCountry.get(slot.country);
      const deltaSeconds = Math.floor(
        (parseDateTimeInput(slot.slotStart).getTime() -
          parseDateTimeInput(baseline.resolvedSlotStart).getTime()) /
          1000,
      );

      const deleteResult = await query(
        `
          DELETE FROM monitor_history
          WHERE country = ?
            AND check_time >= ?
            AND check_time < DATE_ADD(?, INTERVAL 30 MINUTE)
        `,
        [slot.country, slot.slotStart, slot.slotStart],
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
          WHERE country = ?
            AND check_time >= ?
            AND check_time < ?
        `,
        [
          deltaSeconds,
          deltaSeconds,
          slot.country,
          baseline.resolvedSlotStart,
          baseline.resolvedSlotEnd,
        ],
      );

      slotResults.push({
        country: slot.country,
        slotStart: slot.slotStart,
        baselineSlotStart: baseline.resolvedSlotStart,
        deletedRows: Number(deleteResult?.affectedRows || 0),
        insertedRows: Number(insertResult?.affectedRows || 0),
      });
    }

    return {
      archiveDeletedRows: Number(archiveDeleteResult?.affectedRows || 0),
      replacedSlotCount: slotResults.length,
      slotResults,
    };
  });
}

async function clearAffectedAggRows(query, archiveSummary, repairSummary) {
  const result = {};

  const statements = [
    {
      key: 'monitor_history_agg.item1',
      enabled: archiveSummary.rowCount > 0,
      sql: `
        DELETE FROM monitor_history_agg
        WHERE country = 'US'
          AND asin_key IN (${TARGET_ASINS.map(() => '?').join(', ')})
          AND (
            (granularity = 'hour' AND time_slot >= ? AND time_slot <= ?)
            OR (granularity = 'day' AND time_slot >= ? AND time_slot <= ?)
          )
      `,
      params: [
        ...TARGET_ASINS,
        archiveSummary.hourStart,
        archiveSummary.hourEnd,
        archiveSummary.dayStart,
        archiveSummary.dayEnd,
      ],
    },
    {
      key: 'monitor_history_agg_dim.item1',
      enabled: archiveSummary.rowCount > 0,
      sql: `
        DELETE FROM monitor_history_agg_dim
        WHERE country = 'US'
          AND asin_key IN (${TARGET_ASINS.map(() => '?').join(', ')})
          AND (
            (granularity = 'hour' AND time_slot >= ? AND time_slot <= ?)
            OR (granularity = 'day' AND time_slot >= ? AND time_slot <= ?)
          )
      `,
      params: [
        ...TARGET_ASINS,
        archiveSummary.hourStart,
        archiveSummary.hourEnd,
        archiveSummary.dayStart,
        archiveSummary.dayEnd,
      ],
    },
    {
      key: 'monitor_history_agg_variant_group.item1',
      enabled: archiveSummary.rowCount > 0,
      sql: `
        DELETE FROM monitor_history_agg_variant_group
        WHERE country = 'US'
          AND asin_key IN (${TARGET_ASINS.map(() => '?').join(', ')})
          AND (
            (granularity = 'hour' AND time_slot >= ? AND time_slot <= ?)
            OR (granularity = 'day' AND time_slot >= ? AND time_slot <= ?)
          )
      `,
      params: [
        ...TARGET_ASINS,
        archiveSummary.hourStart,
        archiveSummary.hourEnd,
        archiveSummary.dayStart,
        archiveSummary.dayEnd,
      ],
    },
    {
      key: 'monitor_history_agg.item2',
      enabled: repairSummary.hourSlots.length > 0,
      sql: `
        DELETE FROM monitor_history_agg
        WHERE country IN (${repairSummary.countries.map(() => '?').join(', ')})
          AND (
            (granularity = 'hour' AND time_slot IN (${repairSummary.hourSlots
              .map(() => '?')
              .join(', ')}))
            OR (granularity = 'day' AND time_slot IN (${repairSummary.daySlots
              .map(() => '?')
              .join(', ')}))
          )
      `,
      params: [
        ...repairSummary.countries,
        ...repairSummary.hourSlots,
        ...repairSummary.daySlots,
      ],
    },
    {
      key: 'monitor_history_agg_dim.item2',
      enabled: repairSummary.hourSlots.length > 0,
      sql: `
        DELETE FROM monitor_history_agg_dim
        WHERE country IN (${repairSummary.countries.map(() => '?').join(', ')})
          AND (
            (granularity = 'hour' AND time_slot IN (${repairSummary.hourSlots
              .map(() => '?')
              .join(', ')}))
            OR (granularity = 'day' AND time_slot IN (${repairSummary.daySlots
              .map(() => '?')
              .join(', ')}))
          )
      `,
      params: [
        ...repairSummary.countries,
        ...repairSummary.hourSlots,
        ...repairSummary.daySlots,
      ],
    },
    {
      key: 'monitor_history_agg_variant_group.item2',
      enabled: repairSummary.hourSlots.length > 0,
      sql: `
        DELETE FROM monitor_history_agg_variant_group
        WHERE country IN (${repairSummary.countries.map(() => '?').join(', ')})
          AND (
            (granularity = 'hour' AND time_slot IN (${repairSummary.hourSlots
              .map(() => '?')
              .join(', ')}))
            OR (granularity = 'day' AND time_slot IN (${repairSummary.daySlots
              .map(() => '?')
              .join(', ')}))
          )
      `,
      params: [
        ...repairSummary.countries,
        ...repairSummary.hourSlots,
        ...repairSummary.daySlots,
      ],
    },
  ];

  for (const item of statements) {
    if (!item.enabled) {
      result[item.key] = 0;
      continue;
    }
    const queryResult = await query(item.sql, item.params);
    result[item.key] = Number(queryResult?.affectedRows || 0);
  }

  return result;
}

async function refreshAffectedAggWindow(
  analyticsAggService,
  archiveSummary,
  repairSummary,
) {
  const rawStarts = [];
  const rawEnds = [];

  if (archiveSummary.rowCount > 0) {
    rawStarts.push(archiveSummary.minCheckTime);
    rawEnds.push(archiveSummary.maxCheckTime);
  }
  if (repairSummary.rowCount > 0) {
    rawStarts.push(REPAIR_WINDOW.startTime);
    rawEnds.push(addMinutesText(REPAIR_WINDOW.endTime, -1));
  }

  const options = {
    startTime: rawStarts.sort()[0],
    endTime: rawEnds.sort().slice(-1)[0],
  };

  return {
    options,
    hour: await analyticsAggService.refreshAnalyticsAggBundle('hour', options),
    day: await analyticsAggService.refreshAnalyticsAggBundle('day', options),
  };
}

async function collectPostVerification(query, context) {
  const archiveRows = await query(
    `
      SELECT asin_code, COUNT(*) AS row_count
      FROM monitor_history
      WHERE country = 'US'
        AND asin_code IN (${TARGET_ASINS.map(() => '?').join(', ')})
        AND check_time < ?
      GROUP BY asin_code
      ORDER BY asin_code ASC
    `,
    [...TARGET_ASINS, ARCHIVE_DELETE_CUTOFF],
  );

  const slotCondition = buildSlotConditionSql(context.targetSlots, 'mh');
  const repairedRows = await query(
    `
      SELECT
        mh.country,
        ${getHalfHourSlotExpr('mh.check_time')} AS slot_start,
        mh.check_type,
        COUNT(*) AS row_count,
        SUM(CASE WHEN mh.is_broken = 1 THEN 1 ELSE 0 END) AS broken_count
      FROM monitor_history mh
      WHERE ${slotCondition.sql}
      GROUP BY mh.country, slot_start, mh.check_type
      ORDER BY slot_start ASC, mh.country ASC, mh.check_type ASC
    `,
    slotCondition.params,
  );

  const baselineRows = [];
  for (const country of context.targetCountries) {
    const baseline = context.baselineByCountry.get(country);
    const rows = await query(
      `
        SELECT
          ? AS country,
          check_type,
          COUNT(*) AS row_count,
          SUM(CASE WHEN is_broken = 1 THEN 1 ELSE 0 END) AS broken_count
        FROM monitor_history
        WHERE country = ?
          AND check_time >= ?
          AND check_time < ?
        GROUP BY check_type
        ORDER BY check_type ASC
      `,
      [country, country, baseline.resolvedSlotStart, baseline.resolvedSlotEnd],
    );
    baselineRows.push(...rows);
  }

  const baselineMap = new Map();
  for (const row of baselineRows) {
    baselineMap.set(`${row.country}|${row.check_type}`, {
      rowCount: Number(row.row_count || 0),
      brokenCount: Number(row.broken_count || 0),
    });
  }

  const comparisons = repairedRows.map((row) => {
    const baseline = baselineMap.get(`${row.country}|${row.check_type}`) || {
      rowCount: 0,
      brokenCount: 0,
    };
    return {
      slotStart: row.slot_start,
      country: row.country,
      checkType: row.check_type,
      rowCount: Number(row.row_count || 0),
      brokenCount: Number(row.broken_count || 0),
      baselineRowCount: baseline.rowCount,
      baselineBrokenCount: baseline.brokenCount,
      passed:
        Number(row.row_count || 0) === baseline.rowCount &&
        Number(row.broken_count || 0) === baseline.brokenCount,
    };
  });

  return {
    archiveDeleteRemaining: archiveRows,
    repairedSlotComparisons: comparisons,
    checks: {
      archiveDeleteCleared: archiveRows.length === 0,
      repairedSlotsAligned: comparisons.every((item) => item.passed),
    },
  };
}

function writeReport(reportDir, payload) {
  ensureDir(reportDir);
  const reportPath = path.join(
    reportDir,
    `history-anomaly-sync-report-${buildSuffix()}.json`,
  );
  fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2), 'utf8');
  return reportPath;
}

async function closeResources(pool, redisConfig, logger) {
  try {
    await redisConfig.closeRedis();
  } catch (error) {
    logger.warn('[History Sync] 关闭 Redis 失败', { message: error.message });
  }

  try {
    await pool.end();
  } catch (error) {
    logger.warn('[History Sync] 关闭数据库连接池失败', {
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
      logger.warn('[History Sync] 该脚本仅允许显式 --apply 执行');
      logger.info(usage());
      exitCode = 1;
      return;
    }

    const connected = await testConnection();
    if (!connected) {
      throw new Error('数据库连接失败');
    }

    const context = await resolveContext(query, logger);
    const archiveRows = await fetchArchiveDeleteRows(query);
    const repairRows = await fetchRepairWindowRows(query, context);
    const archiveSummary = collectArchiveSummary(archiveRows);
    const repairSummary = collectRepairSummary(repairRows, context);

    logger.info('[History Sync] 变更预览', {
      archiveSummary,
      repairSummary,
    });

    const backup = await createScopedSqlBackup(
      query,
      context,
      archiveRows,
      repairRows,
      archiveSummary,
      repairSummary,
      args.reportDir,
      logger,
    );

    const mutationResult = await applyMonitorHistoryMutation(
      withTransaction,
      context,
    );
    logger.info('[History Sync] monitor_history 事务已提交', mutationResult);

    const clearedAggRows = await clearAffectedAggRows(
      query,
      archiveSummary,
      repairSummary,
    );
    logger.info('[History Sync] 聚合受影响窗口已清理', clearedAggRows);

    const aggRefreshResult = await refreshAffectedAggWindow(
      analyticsAggService,
      archiveSummary,
      repairSummary,
    );
    MonitorHistory.invalidateCaches();
    logger.info('[History Sync] 聚合重建与缓存失效完成', aggRefreshResult);

    const postVerification = await collectPostVerification(query, context);
    const report = {
      kind: 'history-anomaly-sync-2026-04-13',
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      envPath,
      targetAsins: TARGET_ASINS,
      archiveDeleteCutoff: ARCHIVE_DELETE_CUTOFF,
      requestedBaselineWindow: REQUESTED_BASELINE_WINDOW,
      repairWindow: REPAIR_WINDOW,
      assumptions: {
        fallbackRule:
          '若 2026-04-13 11:00:00-11:29:59 无原始数据，则按各国家在 2026-04-13 11:30:00 之前最近一批有数据的半小时窗口作为回滚基线。',
        resolvedBaselineByCountry: Object.fromEntries(
          Array.from(context.baselineByCountry.entries()).map(
            ([country, item]) => [country, item],
          ),
        ),
      },
      preview: {
        archiveSummary,
        repairSummary,
        targetSlots: context.targetSlots,
        baselineSlotSummaries: context.baselineSlotSummaries,
      },
      backup,
      mutationResult,
      clearedAggRows,
      aggRefreshResult,
      postVerification,
    };

    const reportPath = writeReport(args.reportDir, report);
    logger.info('[History Sync] 报告已写入', { reportPath });
    logger.info('[History Sync] 执行完成', {
      reportPath,
      backupFile: backup.filepath,
      finalChecks: postVerification.checks,
    });
  } catch (error) {
    const logger = require('../src/utils/logger');
    logger.error('[History Sync] 执行失败', {
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
