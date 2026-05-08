#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { loadEnv } = require('./utils/loadEnv');

const DEFAULT_REPORT_DIR = path.resolve(
  __dirname,
  '../../backups/manual-history-delete',
);
const QUERY_CHUNK_SIZE = 100;
const DELETE_CHUNK_SIZE = 500;
const BACKUP_BATCH_SIZE = 200;
const AGG_KEY_CHUNK_SIZE = 80;
const DEFAULT_SAMPLE_LIMIT = 20;
const ANALYTICS_ASIN_HISTORY_FILTER =
  "mh.check_type = 'ASIN' AND (mh.asin_id IS NOT NULL OR NULLIF(mh.asin_code, '') IS NOT NULL)";

const TARGETS = [
  {
    key: '20260424_us_1000_1800_two_asins',
    description: '2026-04-24 10:00-18:00 US B0GLFG127N/B09LXSPHTC 删除记录',
    country: 'US',
    asins: ['B0GLFG127N', 'B09LXSPHTC'],
    startTime: '2026-04-24 10:00:00',
    endTime: '2026-04-24 18:00:00',
  },
  {
    key: '20260424_us_103422_b0fhh33fv3_to_now',
    description: '2026-04-24 10:34:22-至今 US B0FHH33FV3 删除记录',
    country: 'US',
    asins: ['B0FHH33FV3'],
    startTime: '2026-04-24 10:34:22',
    endTime: 'NOW',
  },
  {
    key: '20260420_uk_b0fnw9fmwl_to_now',
    description: '2026-04-20-至今 UK B0FNW9FMWL 删除记录',
    country: 'UK',
    asins: ['B0FNW9FMWL'],
    startTime: '2026-04-20 00:00:00',
    endTime: 'NOW',
  },
  {
    key: '20260425_us_1200_1415_b07px1vb7w',
    description: '2026-04-25 12:00-14:15 US B07PX1VB7W 删除记录',
    country: 'US',
    asins: ['B07PX1VB7W'],
    startTime: '2026-04-25 12:00:00',
    endTime: '2026-04-25 14:15:00',
  },
  {
    key: '20260425_us_0000_0015_two_asins',
    description: '2026-04-25 00:00-00:15 US B09PBKRXQG/B009YCP1LS 删除记录',
    country: 'US',
    asins: ['B09PBKRXQG', 'B009YCP1LS'],
    startTime: '2026-04-25 00:00:00',
    endTime: '2026-04-25 00:15:00',
  },
  {
    key: '20260424_1730_1740_abnormal_only',
    description: '2026-04-24 17:30-17:40 全站点异常记录删除',
    country: '',
    asins: [],
    startTime: '2026-04-24 17:30:00',
    endTime: '2026-04-24 17:40:00',
    isBroken: 1,
  },
];

function parseArgs(argv) {
  const args = {
    apply: false,
    help: false,
    envPath: '',
    reportDir: DEFAULT_REPORT_DIR,
    sampleLimit: DEFAULT_SAMPLE_LIMIT,
    asOf: '',
    maxDelete: 0,
    targetFile: '',
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
    if (item.startsWith('--env=')) {
      args.envPath = path.resolve(item.slice('--env='.length).trim());
      continue;
    }
    if (item.startsWith('--report-dir=')) {
      args.reportDir = path.resolve(item.slice('--report-dir='.length).trim());
      continue;
    }
    if (item.startsWith('--target-file=')) {
      args.targetFile = path.resolve(
        item.slice('--target-file='.length).trim(),
      );
      continue;
    }
    if (item.startsWith('--sample-limit=')) {
      const value = Number(item.slice('--sample-limit='.length).trim());
      if (Number.isFinite(value) && value >= 0) {
        args.sampleLimit = Math.floor(value);
      }
      continue;
    }
    if (item.startsWith('--as-of=')) {
      args.asOf = item.slice('--as-of='.length).trim();
      continue;
    }
    if (item.startsWith('--max-delete=')) {
      const value = Number(item.slice('--max-delete='.length).trim());
      if (Number.isFinite(value) && value > 0) {
        args.maxDelete = Math.floor(value);
      }
    }
  }

  return args;
}

function usage() {
  return [
    '用法:',
    '  node scripts/delete-monitor-history-2026-04-20-to-04-26.js',
    '  node scripts/delete-monitor-history-2026-04-20-to-04-26.js --apply --max-delete=1000',
    '参数:',
    '  --apply             执行存档、删除、聚合刷新；不带时只预览',
    '  --env=...           指定 .env 路径，默认 server/.env',
    '  --report-dir=...    指定报告/备份目录',
    '  --target-file=...   指定自定义删除目标 JSON 文件；不带时使用脚本内置目标',
    '  --sample-limit=N    报告样例行数，默认 20',
    '  --as-of=...         指定“至今”的截止时间，格式 YYYY-MM-DD HH:mm:ss',
    '  --max-delete=N      apply 模式安全阈值，命中行数超过 N 时中止',
  ].join('\n');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function normalizeAsin(value) {
  return String(value || '')
    .trim()
    .toUpperCase();
}

function loadTargetsFromFile(targetFile) {
  if (!targetFile) {
    return TARGETS;
  }
  const content = fs.readFileSync(targetFile, 'utf8');
  const parsed = JSON.parse(content);
  const targets = Array.isArray(parsed) ? parsed : parsed.targets;
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error(`自定义目标文件无有效 targets: ${targetFile}`);
  }
  return targets;
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

function parseDateTimeInput(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
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

function addOneHourText(value) {
  const date = parseDateTimeInput(value);
  if (!date) {
    return '';
  }
  date.setHours(date.getHours() + 1);
  return formatDateTime(date);
}

function addOneDayText(value) {
  const date = parseDateTimeInput(value);
  if (!date) {
    return '';
  }
  date.setDate(date.getDate() + 1);
  return formatDateTime(date);
}

function buildSuffix() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '-',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
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
    .filter((row) => !String(row.Extra || '').includes('GENERATED'))
    .map((row) => row.Field);
}

async function appendTableBackup(stream, query, tableName, rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return;
  }

  const columns = await getBackupableColumns(query, tableName);
  const columnSql = columns.map((column) => `\`${column}\``).join(', ');

  await writeSqlChunks(stream, `\n-- table: ${tableName}\n\n`);

  for (const batch of chunk(rows, BACKUP_BATCH_SIZE)) {
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

function resolveTarget(target, asOf) {
  return {
    ...target,
    asins: (target.asins || []).map(normalizeAsin).filter(Boolean),
    country: String(target.country || '')
      .trim()
      .toUpperCase(),
    resolvedEndTime: target.endTime === 'NOW' ? asOf : target.endTime,
  };
}

function buildBaseWhere(target) {
  const clauses = ['mh.check_time >= ?', 'mh.check_time <= ?'];
  const params = [target.startTime, target.resolvedEndTime];

  if (target.country) {
    clauses.push('mh.country = ?');
    params.push(target.country);
  }

  if (target.isBroken !== undefined) {
    clauses.push('mh.is_broken = ?');
    params.push(target.isBroken ? 1 : 0);
  }

  if (target.checkType) {
    clauses.push('mh.check_type = ?');
    params.push(String(target.checkType).trim().toUpperCase());
  }

  return {
    whereSql: clauses.join('\n        AND '),
    params,
  };
}

async function fetchRowsForTarget(query, target) {
  const { whereSql, params } = buildBaseWhere(target);

  if (target.asins.length === 0) {
    return query(
      `
        SELECT
          mh.*,
          mh.asin_code AS matched_asin_code
        FROM monitor_history mh FORCE INDEX (idx_check_time_country_broken)
        WHERE ${whereSql}
        ORDER BY mh.check_time ASC, mh.id ASC
      `,
      params,
    );
  }

  const asinRows = await query(
    `
      SELECT id, asin
      FROM asins
      WHERE country = ?
        AND asin IN (${target.asins.map(() => '?').join(', ')})
    `,
    [target.country, ...target.asins],
  );
  const asinIds = asinRows.map((row) => row.id).filter(Boolean);

  const rowsByCode = await query(
    `
      SELECT
        mh.*,
        mh.asin_code AS matched_asin_code
      FROM monitor_history mh FORCE INDEX (idx_asin_code_country_check_time)
      WHERE ${whereSql}
        AND mh.asin_code IN (${target.asins.map(() => '?').join(', ')})
      ORDER BY mh.check_time ASC, mh.id ASC
    `,
    [...params, ...target.asins],
  );

  if (asinIds.length === 0) {
    return rowsByCode;
  }

  const rowsByAsinId = await query(
    `
      SELECT
        mh.*,
        COALESCE(NULLIF(mh.asin_code, ''), a.asin) AS matched_asin_code
      FROM monitor_history mh FORCE INDEX (idx_asin_country_check_time_broken)
      LEFT JOIN asins a ON a.id = mh.asin_id
      WHERE ${whereSql}
        AND mh.asin_id IN (${asinIds.map(() => '?').join(', ')})
      ORDER BY mh.check_time ASC, mh.id ASC
    `,
    [...params, ...asinIds],
  );

  const merged = new Map();
  for (const row of rowsByCode) {
    merged.set(row.id, row);
  }
  for (const row of rowsByAsinId) {
    merged.set(row.id, row);
  }

  return Array.from(merged.values()).sort((a, b) => {
    const timeDiff =
      new Date(a.check_time).getTime() - new Date(b.check_time).getTime();
    if (timeDiff !== 0) {
      return timeDiff;
    }
    return Number(a.id) - Number(b.id);
  });
}

async function fetchRowsByIds(query, tableName, ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return [];
  }

  const rows = [];
  for (const idChunk of chunk(ids, QUERY_CHUNK_SIZE)) {
    rows.push(
      ...(await query(
        `
          SELECT *
          FROM \`${tableName}\`
          WHERE id IN (${idChunk.map(() => '?').join(', ')})
          ORDER BY id ASC
        `,
        idChunk,
      )),
    );
  }
  return rows;
}

function summarizeRows(rows) {
  const byRule = {};
  const byCountry = {};
  const byAsin = {};
  const byBroken = { normal: 0, broken: 0 };
  const byCheckType = {};

  for (const row of rows) {
    for (const ruleKey of row.__matchedRules || []) {
      byRule[ruleKey] = (byRule[ruleKey] || 0) + 1;
    }
    const country = String(row.country || 'UNKNOWN').trim() || 'UNKNOWN';
    const asin = normalizeAsin(row.matched_asin_code || row.asin_code);
    const checkType = String(row.check_type || 'UNKNOWN').trim() || 'UNKNOWN';
    byCountry[country] = (byCountry[country] || 0) + 1;
    byAsin[asin || 'UNKNOWN'] = (byAsin[asin || 'UNKNOWN'] || 0) + 1;
    byCheckType[checkType] = (byCheckType[checkType] || 0) + 1;
    if (Number(row.is_broken) === 1) {
      byBroken.broken += 1;
    } else {
      byBroken.normal += 1;
    }
  }

  return { byRule, byCountry, byAsin, byBroken, byCheckType };
}

function buildSample(rows, limit) {
  return rows.slice(0, limit).map((row) => ({
    id: row.id,
    check_time: formatDateTime(row.check_time),
    country: row.country,
    asin_code: row.matched_asin_code || row.asin_code || '',
    check_type: row.check_type,
    is_broken: Number(row.is_broken) === 1 ? 1 : 0,
    matchedRules: row.__matchedRules || [],
  }));
}

function collectAggScope(rows) {
  const countries = new Set();
  const hourSlots = new Set();
  const daySlots = new Set();

  for (const row of rows) {
    if (row.country) {
      countries.add(String(row.country).trim().toUpperCase());
    }
    if (row.check_time) {
      const hourSlot = floorToHourText(row.check_time);
      const daySlot = floorToDayText(row.check_time);
      if (hourSlot) {
        hourSlots.add(hourSlot);
      }
      if (daySlot) {
        daySlots.add(daySlot);
      }
    }
  }

  return {
    countries: Array.from(countries).sort(),
    hourSlots: Array.from(hourSlots).sort(),
    daySlots: Array.from(daySlots).sort(),
  };
}

function buildPeakHourCase(countryField, timeField) {
  const hourExpr = `HOUR(DATE_ADD(${timeField}, INTERVAL 8 HOUR))`;
  return `CASE
    WHEN ${countryField} = 'US' THEN
      (${hourExpr} >= 2 AND ${hourExpr} < 6)
      OR (${hourExpr} >= 9 AND ${hourExpr} < 12)
    WHEN ${countryField} = 'UK' THEN
      ${hourExpr} >= 22
      OR (${hourExpr} >= 0 AND ${hourExpr} < 2)
      OR (${hourExpr} >= 3 AND ${hourExpr} < 6)
    WHEN ${countryField} IN ('DE', 'FR', 'ES', 'IT') THEN
      ${hourExpr} >= 20
      OR (${hourExpr} >= 2 AND ${hourExpr} < 5)
    ELSE 0
  END`;
}

function buildAsinAggKey(row) {
  const asinCode = String(row.asin_code || '').trim();
  if (asinCode) {
    return asinCode;
  }
  if (row.asin_id) {
    return `ID#${row.asin_id}`;
  }
  return '';
}

function normalizeAggText(value) {
  return String(value || '').trim();
}

function collectAggKeys(rows) {
  const baseMap = new Map();
  const dimMap = new Map();
  const variantMap = new Map();

  for (const row of rows) {
    const asinKey = buildAsinAggKey(row);
    const country = normalizeAggText(row.country).toUpperCase();
    if (!asinKey || !country || !row.check_time) {
      continue;
    }

    const slots = [
      ['hour', floorToHourText(row.check_time)],
      ['day', floorToDayText(row.check_time)],
    ].filter(([, timeSlot]) => Boolean(timeSlot));

    for (const [granularity, timeSlot] of slots) {
      const baseKey = { granularity, timeSlot, country, asinKey };
      baseMap.set(JSON.stringify(baseKey), baseKey);

      const dimKey = {
        ...baseKey,
        site: normalizeAggText(row.site_snapshot),
        brand: normalizeAggText(row.brand_snapshot),
      };
      dimMap.set(JSON.stringify(dimKey), dimKey);

      if (row.variant_group_id) {
        const variantKey = {
          ...baseKey,
          variantGroupId: normalizeAggText(row.variant_group_id),
        };
        variantMap.set(JSON.stringify(variantKey), variantKey);
      }
    }
  }

  return {
    base: Array.from(baseMap.values()).sort(compareAggKeys),
    dim: Array.from(dimMap.values()).sort(compareAggKeys),
    variantGroup: Array.from(variantMap.values()).sort(compareAggKeys),
  };
}

function compareAggKeys(a, b) {
  return [
    'granularity',
    'timeSlot',
    'country',
    'site',
    'brand',
    'variantGroupId',
    'asinKey',
  ].reduce((result, key) => {
    if (result !== 0) {
      return result;
    }
    return String(a[key] || '').localeCompare(String(b[key] || ''));
  }, 0);
}

function getAggTableConfig(tableName) {
  if (tableName === 'monitor_history_agg') {
    return {
      keyName: 'base',
      columns: ['granularity', 'time_slot', 'country', 'asin_key'],
      valueGetters: [
        (key) => key.granularity,
        (key) => key.timeSlot,
        (key) => key.country,
        (key) => key.asinKey,
      ],
    };
  }
  if (tableName === 'monitor_history_agg_dim') {
    return {
      keyName: 'dim',
      columns: [
        'granularity',
        'time_slot',
        'country',
        'site',
        'brand',
        'asin_key',
      ],
      valueGetters: [
        (key) => key.granularity,
        (key) => key.timeSlot,
        (key) => key.country,
        (key) => key.site,
        (key) => key.brand,
        (key) => key.asinKey,
      ],
    };
  }
  if (tableName === 'monitor_history_agg_variant_group') {
    return {
      keyName: 'variantGroup',
      columns: [
        'granularity',
        'time_slot',
        'country',
        'variant_group_id',
        'asin_key',
      ],
      valueGetters: [
        (key) => key.granularity,
        (key) => key.timeSlot,
        (key) => key.country,
        (key) => key.variantGroupId,
        (key) => key.asinKey,
      ],
    };
  }
  throw new Error(`未知聚合表: ${tableName}`);
}

function buildExactAggWhere(tableName, keys) {
  const config = getAggTableConfig(tableName);
  const conditions = [];
  const params = [];

  for (const key of keys) {
    conditions.push(
      `(${config.columns.map((column) => `\`${column}\` = ?`).join(' AND ')})`,
    );
    params.push(...config.valueGetters.map((getter) => getter(key)));
  }

  return { whereSql: conditions.join(' OR '), params };
}

async function fetchAggBackupRows(query, tableName, aggKeys) {
  const config = getAggTableConfig(tableName);
  const keys = aggKeys[config.keyName] || [];
  if (keys.length === 0) {
    return [];
  }

  const rows = [];
  for (const keyChunk of chunk(keys, AGG_KEY_CHUNK_SIZE)) {
    const { whereSql, params } = buildExactAggWhere(tableName, keyChunk);
    rows.push(
      ...(await query(
        `
          SELECT *
          FROM \`${tableName}\`
          WHERE ${whereSql}
        `,
        params,
      )),
    );
  }
  return rows;
}

function buildRawRestoreDeleteSql(ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return '';
  }

  return chunk(ids, DELETE_CHUNK_SIZE)
    .map(
      (idChunk) =>
        `DELETE FROM monitor_history WHERE id IN (${idChunk
          .map((id) => escapeSqlValue(id))
          .join(', ')});`,
    )
    .join('\n\n');
}

function buildAggRestoreDeleteSql(tableName, aggKeys) {
  const config = getAggTableConfig(tableName);
  const keys = aggKeys[config.keyName] || [];
  if (keys.length === 0) {
    return '';
  }

  return chunk(keys, AGG_KEY_CHUNK_SIZE)
    .map((keyChunk) => {
      const clauses = keyChunk.map((key) => {
        const parts = config.columns.map((column, index) => {
          const value = config.valueGetters[index](key);
          return `\`${column}\` = ${escapeSqlValue(value)}`;
        });
        return `(${parts.join(' AND ')})`;
      });
      return `DELETE FROM \`${tableName}\`\nWHERE ${clauses.join('\n   OR ')};`;
    })
    .join('\n\n');
}

async function createScopedSqlBackup(
  query,
  backupRows,
  aggKeys,
  reportDir,
  logger,
) {
  ensureDir(reportDir);
  const filename = `manual-history-delete-backup-${buildSuffix()}.sql`;
  const filepath = path.join(reportDir, filename);
  const stream = fs.createWriteStream(filepath, { encoding: 'utf8' });

  try {
    const aggRows = await fetchAggBackupRows(
      query,
      'monitor_history_agg',
      aggKeys,
    );
    const aggDimRows = await fetchAggBackupRows(
      query,
      'monitor_history_agg_dim',
      aggKeys,
    );
    const aggVariantRows = await fetchAggBackupRows(
      query,
      'monitor_history_agg_variant_group',
      aggKeys,
    );

    await writeSqlChunks(
      stream,
      [
        '-- Scoped SQL backup for manual monitor_history delete',
        `-- created_at: ${new Date().toISOString()}`,
        '-- scope: requested rows and affected aggregate buckets',
        'SET NAMES utf8mb4;',
        'SET FOREIGN_KEY_CHECKS = 0;',
        '',
      ].join('\n'),
    );

    const rawDeleteSql = buildRawRestoreDeleteSql(
      backupRows.map((row) => row.id),
    );
    if (rawDeleteSql) {
      await writeSqlChunks(stream, `${rawDeleteSql}\n\n`);
    }
    await appendTableBackup(stream, query, 'monitor_history', backupRows);

    const aggTables = [
      ['monitor_history_agg', aggRows],
      ['monitor_history_agg_dim', aggDimRows],
      ['monitor_history_agg_variant_group', aggVariantRows],
    ];

    for (const [tableName, rows] of aggTables) {
      const deleteSql = buildAggRestoreDeleteSql(tableName, aggKeys);
      if (deleteSql) {
        await writeSqlChunks(stream, `${deleteSql}\n\n`);
      }
      await appendTableBackup(stream, query, tableName, rows);
    }

    await writeSqlChunks(stream, '\nSET FOREIGN_KEY_CHECKS = 1;\n');

    await new Promise((resolve, reject) => {
      stream.end(() => resolve());
      stream.on('error', reject);
    });

    const stats = fs.statSync(filepath);
    const summary = {
      monitor_history: backupRows.length,
      monitor_history_agg: aggRows.length,
      monitor_history_agg_dim: aggDimRows.length,
      monitor_history_agg_variant_group: aggVariantRows.length,
    };

    logger.info('[Manual History Delete] Scoped SQL 备份完成', {
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
    } catch (unlinkError) {
      logger.warn('[Manual History Delete] 清理失败备份文件失败', {
        message: unlinkError.message,
      });
    }
    throw error;
  }
}

async function deleteRowsByIds(query, ids) {
  let affectedRows = 0;
  for (const idChunk of chunk(ids, DELETE_CHUNK_SIZE)) {
    const result = await query(
      `
        DELETE FROM monitor_history
        WHERE id IN (${idChunk.map(() => '?').join(', ')})
      `,
      idChunk,
    );
    affectedRows += Number(result?.affectedRows || 0);
  }
  return affectedRows;
}

async function clearAffectedAggRows(query, aggKeys) {
  const result = {};
  const statements = [
    { key: 'monitor_history_agg', tableName: 'monitor_history_agg' },
    { key: 'monitor_history_agg_dim', tableName: 'monitor_history_agg_dim' },
    {
      key: 'monitor_history_agg_variant_group',
      tableName: 'monitor_history_agg_variant_group',
    },
  ];

  for (const item of statements) {
    const config = getAggTableConfig(item.tableName);
    const keys = aggKeys[config.keyName] || [];
    result[item.key] = 0;
    for (const keyChunk of chunk(keys, AGG_KEY_CHUNK_SIZE)) {
      const { whereSql, params } = buildExactAggWhere(item.tableName, keyChunk);
      const queryResult = await query(
        `
          DELETE FROM \`${item.tableName}\`
          WHERE ${whereSql}
        `,
        params,
      );
      result[item.key] += Number(queryResult?.affectedRows || 0);
    }
  }

  return result;
}

function buildExactRawWhere(tableName, keys, granularity) {
  const slotExpr = granularity === 'hour' ? 'mh.hour_ts' : 'mh.day_ts';
  const asinKeyExpr =
    "COALESCE(NULLIF(mh.asin_code, ''), CONCAT('ID#', mh.asin_id))";
  const conditions = [];
  const params = [];

  for (const key of keys) {
    if (key.granularity !== granularity) {
      continue;
    }

    const parts = [`${slotExpr} = ?`, 'mh.country = ?', `${asinKeyExpr} = ?`];
    params.push(key.timeSlot, key.country, key.asinKey);

    if (tableName === 'monitor_history_agg_dim') {
      parts.push("COALESCE(mh.site_snapshot, '') = ?");
      parts.push("COALESCE(mh.brand_snapshot, '') = ?");
      params.push(key.site, key.brand);
    }

    if (tableName === 'monitor_history_agg_variant_group') {
      parts.push('mh.variant_group_id = ?');
      params.push(key.variantGroupId);
    }

    conditions.push(`(${parts.join(' AND ')})`);
  }

  return { slotExpr, asinKeyExpr, whereSql: conditions.join(' OR '), params };
}

async function rebuildMonitorHistoryAgg(query, keys, granularity) {
  const activeKeys = keys.filter((key) => key.granularity === granularity);
  if (activeKeys.length === 0) {
    return 0;
  }

  let affectedRows = 0;
  for (const keyChunk of chunk(activeKeys, AGG_KEY_CHUNK_SIZE)) {
    const { slotExpr, asinKeyExpr, whereSql, params } = buildExactRawWhere(
      'monitor_history_agg',
      keyChunk,
      granularity,
    );
    const isPeakCase = buildPeakHourCase('mh.country', 'mh.check_time');
    const result = await query(
      `
        INSERT INTO monitor_history_agg (
          granularity,
          time_slot,
          country,
          asin_key,
          check_count,
          broken_count,
          has_broken,
          has_peak,
          first_check_time,
          last_check_time
        )
        SELECT
          ? as granularity,
          ${slotExpr} as time_slot,
          mh.country,
          ${asinKeyExpr} as asin_key,
          COUNT(*) as check_count,
          SUM(CASE WHEN mh.is_broken = 1 THEN 1 ELSE 0 END) as broken_count,
          MAX(mh.is_broken) as has_broken,
          MAX(${isPeakCase}) as has_peak,
          MIN(mh.check_time) as first_check_time,
          MAX(mh.check_time) as last_check_time
        FROM monitor_history mh
        WHERE ${ANALYTICS_ASIN_HISTORY_FILTER}
          AND (${whereSql})
        GROUP BY ${slotExpr}, mh.country, ${asinKeyExpr}
        ON DUPLICATE KEY UPDATE
          check_count = VALUES(check_count),
          broken_count = VALUES(broken_count),
          has_broken = VALUES(has_broken),
          has_peak = VALUES(has_peak),
          first_check_time = VALUES(first_check_time),
          last_check_time = VALUES(last_check_time)
      `,
      [granularity, ...params],
    );
    affectedRows += Number(result?.affectedRows || 0);
  }
  return affectedRows;
}

async function rebuildMonitorHistoryAggDim(query, keys, granularity) {
  const activeKeys = keys.filter((key) => key.granularity === granularity);
  if (activeKeys.length === 0) {
    return 0;
  }

  let affectedRows = 0;
  for (const keyChunk of chunk(activeKeys, AGG_KEY_CHUNK_SIZE)) {
    const { slotExpr, asinKeyExpr, whereSql, params } = buildExactRawWhere(
      'monitor_history_agg_dim',
      keyChunk,
      granularity,
    );
    const isPeakCase = buildPeakHourCase('mh.country', 'mh.check_time');
    const result = await query(
      `
        INSERT INTO monitor_history_agg_dim (
          granularity,
          time_slot,
          country,
          site,
          brand,
          asin_key,
          check_count,
          broken_count,
          has_broken,
          has_peak,
          first_check_time,
          last_check_time
        )
        SELECT
          ? as granularity,
          ${slotExpr} as time_slot,
          mh.country,
          COALESCE(mh.site_snapshot, '') as site,
          COALESCE(mh.brand_snapshot, '') as brand,
          ${asinKeyExpr} as asin_key,
          COUNT(*) as check_count,
          SUM(CASE WHEN mh.is_broken = 1 THEN 1 ELSE 0 END) as broken_count,
          MAX(mh.is_broken) as has_broken,
          MAX(${isPeakCase}) as has_peak,
          MIN(mh.check_time) as first_check_time,
          MAX(mh.check_time) as last_check_time
        FROM monitor_history mh
        WHERE ${ANALYTICS_ASIN_HISTORY_FILTER}
          AND (${whereSql})
        GROUP BY
          ${slotExpr},
          mh.country,
          COALESCE(mh.site_snapshot, ''),
          COALESCE(mh.brand_snapshot, ''),
          ${asinKeyExpr}
        ON DUPLICATE KEY UPDATE
          check_count = VALUES(check_count),
          broken_count = VALUES(broken_count),
          has_broken = VALUES(has_broken),
          has_peak = VALUES(has_peak),
          first_check_time = VALUES(first_check_time),
          last_check_time = VALUES(last_check_time)
      `,
      [granularity, ...params],
    );
    affectedRows += Number(result?.affectedRows || 0);
  }
  return affectedRows;
}

async function rebuildMonitorHistoryAggVariantGroup(query, keys, granularity) {
  const activeKeys = keys.filter((key) => key.granularity === granularity);
  if (activeKeys.length === 0) {
    return 0;
  }

  let affectedRows = 0;
  for (const keyChunk of chunk(activeKeys, AGG_KEY_CHUNK_SIZE)) {
    const { slotExpr, asinKeyExpr, whereSql, params } = buildExactRawWhere(
      'monitor_history_agg_variant_group',
      keyChunk,
      granularity,
    );
    const isPeakCase = buildPeakHourCase('mh.country', 'mh.check_time');
    const result = await query(
      `
        INSERT INTO monitor_history_agg_variant_group (
          granularity,
          time_slot,
          country,
          variant_group_id,
          variant_group_name,
          asin_key,
          check_count,
          broken_count,
          has_broken,
          has_peak,
          first_check_time,
          last_check_time
        )
        SELECT
          ? as granularity,
          ${slotExpr} as time_slot,
          mh.country,
          mh.variant_group_id,
          COALESCE(MAX(NULLIF(mh.variant_group_name, '')), MAX(vg.name), '') as variant_group_name,
          ${asinKeyExpr} as asin_key,
          COUNT(*) as check_count,
          SUM(CASE WHEN mh.is_broken = 1 THEN 1 ELSE 0 END) as broken_count,
          MAX(mh.is_broken) as has_broken,
          MAX(${isPeakCase}) as has_peak,
          MIN(mh.check_time) as first_check_time,
          MAX(mh.check_time) as last_check_time
        FROM monitor_history mh
        LEFT JOIN variant_groups vg ON vg.id = mh.variant_group_id
        WHERE ${ANALYTICS_ASIN_HISTORY_FILTER}
          AND mh.variant_group_id IS NOT NULL
          AND (${whereSql})
        GROUP BY
          ${slotExpr},
          mh.country,
          mh.variant_group_id,
          ${asinKeyExpr}
        ON DUPLICATE KEY UPDATE
          variant_group_name = VALUES(variant_group_name),
          check_count = VALUES(check_count),
          broken_count = VALUES(broken_count),
          has_broken = VALUES(has_broken),
          has_peak = VALUES(has_peak),
          first_check_time = VALUES(first_check_time),
          last_check_time = VALUES(last_check_time)
      `,
      [granularity, ...params],
    );
    affectedRows += Number(result?.affectedRows || 0);
  }
  return affectedRows;
}

async function rebuildAffectedAggRows(query, aggKeys) {
  const result = {
    monitor_history_agg: 0,
    monitor_history_agg_dim: 0,
    monitor_history_agg_variant_group: 0,
  };

  for (const granularity of ['hour', 'day']) {
    result.monitor_history_agg += await rebuildMonitorHistoryAgg(
      query,
      aggKeys.base,
      granularity,
    );
    result.monitor_history_agg_dim += await rebuildMonitorHistoryAggDim(
      query,
      aggKeys.dim,
      granularity,
    );
    result.monitor_history_agg_variant_group +=
      await rebuildMonitorHistoryAggVariantGroup(
        query,
        aggKeys.variantGroup,
        granularity,
      );
  }

  return result;
}

async function collectTargetRows(query, targets, logger) {
  const rowMap = new Map();
  const ruleSummaries = [];

  for (const target of targets) {
    const rows = await fetchRowsForTarget(query, target);
    ruleSummaries.push({
      key: target.key,
      description: target.description,
      count: rows.length,
      country: target.country || 'ALL',
      asins: target.asins,
      startTime: target.startTime,
      endTime: target.resolvedEndTime,
      isBroken: target.isBroken,
      checkType: target.checkType || '',
    });
    logger.info('[Manual History Delete] 规则预览完成', {
      key: target.key,
      count: rows.length,
    });

    for (const row of rows) {
      const existing = rowMap.get(row.id);
      if (existing) {
        existing.__matchedRules.push(target.key);
        continue;
      }
      row.__matchedRules = [target.key];
      rowMap.set(row.id, row);
    }
  }

  const rows = Array.from(rowMap.values()).sort((a, b) => {
    const timeDiff =
      new Date(a.check_time).getTime() - new Date(b.check_time).getTime();
    if (timeDiff !== 0) {
      return timeDiff;
    }
    return Number(a.id) - Number(b.id);
  });

  return { rows, ruleSummaries };
}

function writeReport(reportDir, payload, mode) {
  ensureDir(reportDir);
  const reportPath = path.join(
    reportDir,
    `manual-history-delete-${mode}-report-${buildSuffix()}.json`,
  );
  fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2), 'utf8');
  return reportPath;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  loadEnv(args.envPath || path.resolve(__dirname, '../.env'));

  const logger = require('../src/utils/logger');
  const { pool, query, withTransaction } = require('../src/config/database');
  const MonitorHistory = require('../src/models/MonitorHistory');
  const redisConfig = require('../src/config/redis');

  try {
    await query("SET time_zone = '+08:00'");
    const nowRows = await query(
      "SELECT DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS db_now",
    );
    const asOf = args.asOf || nowRows[0]?.db_now;
    if (!parseDateTimeInput(asOf)) {
      throw new Error(`无效的 as-of 时间: ${asOf}`);
    }

    const targetSpecs = loadTargetsFromFile(args.targetFile);
    const targets = targetSpecs.map((target) => resolveTarget(target, asOf));
    const { rows, ruleSummaries } = await collectTargetRows(
      query,
      targets,
      logger,
    );
    const ids = rows.map((row) => row.id);
    const aggScope = collectAggScope(rows);
    const aggKeys = collectAggKeys(rows);
    const summary = summarizeRows(rows);
    const sample = buildSample(rows, args.sampleLimit);

    if (args.apply && args.maxDelete > 0 && rows.length > args.maxDelete) {
      throw new Error(
        `命中 ${rows.length} 行，超过 --max-delete=${args.maxDelete}，已中止`,
      );
    }

    const baseReport = {
      mode: args.apply ? 'apply' : 'preview',
      asOf,
      generatedAt: new Date().toISOString(),
      targetSource: args.targetFile || 'built-in',
      targetCount: targets.length,
      rawRowCount: rows.length,
      uniqueIdCount: ids.length,
      ruleSummaries,
      summary,
      sample,
      aggScope,
      aggKeyCounts: {
        monitor_history_agg: aggKeys.base.length,
        monitor_history_agg_dim: aggKeys.dim.length,
        monitor_history_agg_variant_group: aggKeys.variantGroup.length,
      },
    };

    if (!args.apply) {
      const reportPath = writeReport(args.reportDir, baseReport, 'preview');
      logger.info('[Manual History Delete] 预览完成，未执行删除', {
        reportPath,
        rawRowCount: rows.length,
        asOf,
      });
      return;
    }

    const backupRows = await fetchRowsByIds(query, 'monitor_history', ids);
    if (backupRows.length !== ids.length) {
      throw new Error(
        `备份行数不一致，expected=${ids.length}, actual=${backupRows.length}`,
      );
    }

    const backup = await createScopedSqlBackup(
      query,
      backupRows,
      aggKeys,
      args.reportDir,
      logger,
    );

    const mutationResult = await withTransaction(async ({ query: txQuery }) => {
      await txQuery("SET time_zone = '+08:00'");
      const deletedRows = await deleteRowsByIds(txQuery, ids);
      const clearedAggRows = await clearAffectedAggRows(txQuery, aggKeys);
      const rebuiltAggRows = await rebuildAffectedAggRows(txQuery, aggKeys);
      return { deletedRows, clearedAggRows, rebuiltAggRows };
    });
    MonitorHistory.invalidateCaches();

    const remaining = rows.length
      ? await collectTargetRows(query, targets, logger)
      : { rows: [] };

    const report = {
      ...baseReport,
      backup,
      mutationResult,
      remainingRawRowCount: remaining.rows.length,
    };
    const reportPath = writeReport(args.reportDir, report, 'apply');
    logger.info('[Manual History Delete] 执行完成', {
      reportPath,
      backupFile: backup.filepath,
      deletedRows: mutationResult.deletedRows,
      clearedAggRows: mutationResult.clearedAggRows,
      remainingRawRowCount: remaining.rows.length,
    });
  } finally {
    try {
      await redisConfig.closeRedis();
    } catch (error) {
      const logger = require('../src/utils/logger');
      logger.warn('[Manual History Delete] 关闭 Redis 失败', {
        message: error.message,
      });
    }

    await pool.end();
  }
}

main().catch((error) => {
  const logger = require('../src/utils/logger');
  logger.error('[Manual History Delete] 执行失败', {
    message: error.message,
  });
  process.exitCode = 1;
});
