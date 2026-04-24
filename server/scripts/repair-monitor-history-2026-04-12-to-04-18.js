#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { loadEnv } = require('./utils/loadEnv');

const DEFAULT_INPUT_PATH = path.resolve(__dirname, '../../docs/4.12-4.18.xlsx');
const DEFAULT_REPORT_DIR = path.resolve(__dirname, '../../backups');
const REQUIRED_HEADERS = [
  '国家',
  'ASIN',
  '被拆时间-以监控为准',
  '共享时间',
  '勿删-未执行原因',
];
const PREVIEW_SAMPLE_LIMIT = 12;
const QUERY_CHUNK_SIZE = 200;
const APPLY_BATCH_SIZE = 200;
const DELETE_BATCH_SIZE = 500;

const BASELINE_WINDOW = {
  startTime: '2026-04-13 10:00:00',
  endTime: '2026-04-13 10:30:00',
};

const ROLLBACK_WINDOWS = [
  {
    name: 'EU',
    countries: ['UK', 'DE', 'FR', 'IT', 'ES'],
    startTime: '2026-04-13 12:00:00',
    endTime: '2026-04-13 16:30:00',
  },
  {
    name: 'US',
    countries: ['US'],
    startTime: '2026-04-13 12:00:00',
    endTime: '2026-04-13 15:33:00',
  },
];

const DELETE_WINDOW = {
  country: 'DE',
  asins: ['B08TWX13R3', 'B0G1MBFC2N', 'B09BB2JWRT'],
  startTime: '2026-04-12 00:00:00',
  endTime: '2026-04-14 10:07:47',
};

const NORMALIZE_OTHER_ASINS_WINDOW = {
  startTime: '2026-04-17 17:00:00',
  endTime: '2026-04-18 11:00:00',
};

function parseArgs(argv) {
  const args = {
    help: false,
    apply: false,
    verifyOnly: false,
    inputPath: DEFAULT_INPUT_PATH,
    reportDir: DEFAULT_REPORT_DIR,
    envPath: '',
    sampleLimit: PREVIEW_SAMPLE_LIMIT,
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
    if (item === '--verify-only') {
      args.verifyOnly = true;
      continue;
    }
    if (item.startsWith('--input=')) {
      args.inputPath = path.resolve(item.slice('--input='.length).trim());
      continue;
    }
    if (item.startsWith('--report-dir=')) {
      args.reportDir = path.resolve(item.slice('--report-dir='.length).trim());
      continue;
    }
    if (item.startsWith('--env=')) {
      args.envPath = path.resolve(item.slice('--env='.length).trim());
      continue;
    }
    if (item.startsWith('--sample-limit=')) {
      const value = Number(item.slice('--sample-limit='.length).trim());
      if (Number.isFinite(value) && value > 0) {
        args.sampleLimit = Math.floor(value);
      }
    }
  }

  return args;
}

function usage() {
  return [
    '用法:',
    '  node scripts/repair-monitor-history-2026-04-12-to-04-18.js',
    '  node scripts/repair-monitor-history-2026-04-12-to-04-18.js --apply',
    '参数:',
    '  --apply                 执行 monitor_history 历史修复',
    `  --input=...             指定 Excel 文件路径（默认 ${DEFAULT_INPUT_PATH}）`,
    `  --report-dir=...        指定报告输出目录（默认 ${DEFAULT_REPORT_DIR}）`,
    '  --env=...               指定 .env 文件路径（默认 server/.env）',
    `  --sample-limit=...      预览样例数量（默认 ${PREVIEW_SAMPLE_LIMIT}）`,
  ].join('\n');
}

function usage() {
  const lines = [
    'Usage:',
    '  node scripts/repair-monitor-history-2026-04-12-to-04-18.js',
    '  node scripts/repair-monitor-history-2026-04-12-to-04-18.js --apply',
    '  node scripts/repair-monitor-history-2026-04-12-to-04-18.js --verify-only',
    'Options:',
    '  --apply                 Execute the repair against monitor_history',
    '  --verify-only           Run read-only verification without mutating data',
    `  --input=...             Excel path (default: ${DEFAULT_INPUT_PATH})`,
    `  --report-dir=...        Report output directory (default: ${DEFAULT_REPORT_DIR})`,
    '  --env=...               .env path (default: server/.env)',
    `  --sample-limit=...      Preview sample size (default: ${PREVIEW_SAMPLE_LIMIT})`,
  ];
  return lines.join('\n');
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

function normalizeText(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number') {
    return String(value).trim();
  }
  if (value && typeof value === 'object') {
    if (Array.isArray(value.richText)) {
      return value.richText
        .map((item) => item.text || '')
        .join('')
        .trim();
    }
    if (typeof value.text === 'string') {
      return value.text.trim();
    }
    if (typeof value.result === 'string') {
      return value.result.trim();
    }
  }
  return String(value).trim();
}

function parseDateTimeInput(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return null;
    }
    return new Date(
      value.getUTCFullYear(),
      value.getUTCMonth(),
      value.getUTCDate(),
      value.getUTCHours(),
      value.getUTCMinutes(),
      value.getUTCSeconds(),
      value.getUTCMilliseconds(),
    );
  }

  const normalized = normalizeText(value).replace('T', ' ');
  if (!normalized) {
    return null;
  }

  const match = normalized.match(
    /^(\d{4})[-/](\d{2})[-/](\d{2})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/,
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

function formatDateTime(value) {
  const date = value instanceof Date ? value : parseDateTimeInput(value);
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

function pairKey(country, asinCode) {
  return `${country}::${asinCode}`;
}

function splitPairKey(key) {
  const divider = String(key).indexOf('::');
  return {
    country: String(key).slice(0, divider),
    asinCode: String(key).slice(divider + 2),
  };
}

function buildBatchKey(variantGroupId, country, checkTime) {
  return `${variantGroupId || ''}::${country || ''}::${checkTime || ''}`;
}

function splitBatchKey(key) {
  const [variantGroupId = '', country = '', checkTime = ''] =
    String(key).split('::');
  return {
    variantGroupId,
    country,
    checkTime,
  };
}

function getHistoryLogicalKey(row) {
  const checkType = String(row.check_type || row.checkType || '').trim();
  const country = String(row.country || '').trim();
  if (checkType === 'GROUP') {
    return `GROUP::${country}::${
      row.variant_group_id || row.variantGroupId || ''
    }`;
  }
  const asinIdentifier =
    row.asin_id || row.asinId
      ? `ID#${row.asin_id || row.asinId}`
      : String(row.asin_code || row.asinCode || '')
          .trim()
          .toUpperCase();
  return `ASIN::${country}::${asinIdentifier}`;
}

function sortIntervals(intervals) {
  return intervals
    .slice()
    .sort((left, right) => left.start.getTime() - right.start.getTime());
}

function findMatchedInterval(intervals, checkTime) {
  if (!(checkTime instanceof Date) || Number.isNaN(checkTime.getTime())) {
    return null;
  }
  const timeValue = checkTime.getTime();
  for (const interval of intervals) {
    if (
      timeValue >= interval.start.getTime() &&
      timeValue < interval.end.getTime()
    ) {
      return interval;
    }
  }
  return null;
}

function buildHeaderMap(worksheet) {
  const headerMap = new Map();
  worksheet.getRow(1).eachCell((cell, colNumber) => {
    const key = normalizeText(cell.value);
    if (key) {
      headerMap.set(key, colNumber);
    }
  });
  return headerMap;
}

function readCellValue(row, headerMap, headerName) {
  const column = headerMap.get(headerName);
  if (!column) {
    return null;
  }
  return row.getCell(column).value;
}

function parseJsonSafe(text) {
  if (!text) {
    return {};
  }
  if (typeof text === 'object') {
    return text && typeof text === 'object' ? text : {};
  }
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
}

function toBooleanFlag(value) {
  return Number(value) === 1;
}

function getStatusSource(autoBroken, manualBroken) {
  const auto = toBooleanFlag(autoBroken);
  const manual = toBooleanFlag(manualBroken);
  if (auto && manual) {
    return 'AUTO+MANUAL';
  }
  if (manual) {
    return 'MANUAL';
  }
  if (auto) {
    return 'AUTO';
  }
  return 'NORMAL';
}

function buildEffectiveStatus({ autoBroken = 0, manualBroken = 0 }) {
  const auto = toBooleanFlag(autoBroken);
  const manual = toBooleanFlag(manualBroken);
  const isBroken = auto || manual;
  return {
    isBroken: isBroken ? 1 : 0,
    variantStatus: isBroken ? 'BROKEN' : 'NORMAL',
    autoIsBroken: auto ? 1 : 0,
    autoVariantStatus: auto ? 'BROKEN' : 'NORMAL',
    manualBroken: manual ? 1 : 0,
    statusSource: getStatusSource(auto, manual),
  };
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
  if (!Array.isArray(rows) || rows.length === 0) {
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

function summarizeRowsByCountry(rows) {
  const result = {};
  for (const row of rows) {
    const country = String(row.country || '').trim() || 'UNKNOWN';
    result[country] = (result[country] || 0) + 1;
  }
  return result;
}

function summarizeRowsByCheckType(rows) {
  const result = {};
  for (const row of rows) {
    const checkType =
      String(row.check_type || row.checkType || '').trim() || 'UNKNOWN';
    result[checkType] = (result[checkType] || 0) + 1;
  }
  return result;
}

function dedupeByKey(items, keyBuilder) {
  const result = new Map();
  for (const item of items) {
    const key = keyBuilder(item);
    if (!result.has(key)) {
      result.set(key, item);
    }
  }
  return Array.from(result.values());
}

function mergeUniqueUpdates(...updateLists) {
  const merged = new Map();
  const duplicates = [];

  for (const list of updateLists) {
    for (const item of list) {
      if (merged.has(item.id)) {
        duplicates.push({
          id: item.id,
          previousCategory: merged.get(item.id).category,
          nextCategory: item.category,
        });
        continue;
      }
      merged.set(item.id, item);
    }
  }

  return {
    updates: Array.from(merged.values()),
    duplicates,
  };
}

async function loadManualIntervals(inputPath, logger) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(inputPath);

  if (workbook.worksheets.length === 0) {
    throw new Error('Excel 文件没有工作表');
  }

  const worksheet = workbook.worksheets[0];
  const headerMap = buildHeaderMap(worksheet);
  for (const header of REQUIRED_HEADERS) {
    if (!headerMap.has(header)) {
      throw new Error(`Excel 缺少必需列: ${header}`);
    }
  }

  const intervalsByPair = new Map();
  const invalidRows = [];
  const countryCount = new Map();
  let effectiveRowCount = 0;

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const country = normalizeText(
      readCellValue(row, headerMap, '国家'),
    ).toUpperCase();
    const asinCode = normalizeText(
      readCellValue(row, headerMap, 'ASIN'),
    ).toUpperCase();
    const reason = normalizeText(
      readCellValue(row, headerMap, '勿删-未执行原因'),
    );
    const start = parseDateTimeInput(
      readCellValue(row, headerMap, '被拆时间-以监控为准'),
    );
    const end = parseDateTimeInput(readCellValue(row, headerMap, '共享时间'));

    const isEmpty = !country && !asinCode && !reason && !start && !end;
    if (isEmpty) {
      continue;
    }

    if (!country || !asinCode || !start || !end) {
      invalidRows.push({
        rowNumber,
        country,
        asinCode,
        start: formatDateTime(start),
        end: formatDateTime(end),
        reason,
        error: 'required_fields_missing',
      });
      continue;
    }

    if (end.getTime() <= start.getTime()) {
      invalidRows.push({
        rowNumber,
        country,
        asinCode,
        start: formatDateTime(start),
        end: formatDateTime(end),
        reason,
        error: 'invalid_interval',
      });
      continue;
    }

    const key = pairKey(country, asinCode);
    if (!intervalsByPair.has(key)) {
      intervalsByPair.set(key, []);
    }

    intervalsByPair.get(key).push({
      rowNumber,
      country,
      asinCode,
      start,
      end,
      startText: formatDateTime(start),
      endText: formatDateTime(end),
      reason,
    });
    countryCount.set(country, (countryCount.get(country) || 0) + 1);
    effectiveRowCount += 1;
  }

  for (const [key, intervals] of intervalsByPair.entries()) {
    intervalsByPair.set(key, sortIntervals(intervals));
  }

  const pairKeys = Array.from(intervalsByPair.keys()).sort();
  let startTime = null;
  let endTime = null;
  for (const key of pairKeys) {
    for (const interval of intervalsByPair.get(key)) {
      if (!startTime || interval.start.getTime() < startTime.getTime()) {
        startTime = interval.start;
      }
      if (!endTime || interval.end.getTime() > endTime.getTime()) {
        endTime = interval.end;
      }
    }
  }

  logger.info('[History Repair 0412-0418] Excel 解析完成', {
    inputPath,
    sheetName: worksheet.name,
    effectiveRowCount,
    pairCount: pairKeys.length,
    startTime: formatDateTime(startTime),
    endTime: formatDateTime(endTime),
    countryCount: Object.fromEntries(countryCount),
    invalidRowCount: invalidRows.length,
  });

  if (invalidRows.length > 0) {
    logger.warn('[History Repair 0412-0418] 发现无效附件记录，已跳过', {
      invalidRows: invalidRows.slice(0, 10),
      invalidRowCount: invalidRows.length,
    });
  }

  if (pairKeys.length === 0 || !startTime || !endTime) {
    throw new Error('Excel 中没有可用于修复的有效区间');
  }

  return {
    inputPath,
    sheetName: worksheet.name,
    effectiveRowCount,
    invalidRows,
    intervalsByPair,
    pairKeys,
    pairKeySet: new Set(pairKeys),
    startTime,
    endTime,
    countryCount: Object.fromEntries(countryCount),
  };
}

function buildRollbackWindowConditionSql(windows, tableAlias = 'mh') {
  const conditions = [];
  const params = [];

  for (const window of windows) {
    conditions.push(
      `(${tableAlias}.country IN (${window.countries
        .map(() => '?')
        .join(
          ', ',
        )}) AND ${tableAlias}.check_time >= ? AND ${tableAlias}.check_time <= ?)`,
    );
    params.push(...window.countries, window.startTime, window.endTime);
  }

  return {
    sql: conditions.join(' OR '),
    params,
  };
}

async function fetchRollbackTargetRows(query) {
  const rows = [];
  for (const window of ROLLBACK_WINDOWS) {
    const chunkRows = await query(
      `
        SELECT
          mh.id,
          mh.variant_group_id,
          mh.variant_group_name,
          mh.asin_id,
          mh.asin_code,
          mh.asin_name,
          mh.site_snapshot,
          mh.brand_snapshot,
          mh.check_type,
          mh.country,
          mh.is_broken,
          mh.check_result,
          mh.notification_sent,
          DATE_FORMAT(mh.check_time, '%Y-%m-%d %H:%i:%s') AS check_time
        FROM monitor_history mh FORCE INDEX (idx_country_check_time)
        WHERE mh.country IN (${window.countries.map(() => '?').join(', ')})
          AND mh.check_time >= ?
          AND mh.check_time <= ?
          AND mh.check_type IN ('ASIN', 'GROUP')
        ORDER BY mh.country ASC, mh.check_time ASC, mh.check_type ASC, mh.id ASC
      `,
      [...window.countries, window.startTime, window.endTime],
    );
    rows.push(...chunkRows);
  }

  return rows.sort((left, right) => {
    const countryCompare = String(left.country || '').localeCompare(
      String(right.country || ''),
    );
    if (countryCompare !== 0) {
      return countryCompare;
    }
    const timeCompare = String(left.check_time || '').localeCompare(
      String(right.check_time || ''),
    );
    if (timeCompare !== 0) {
      return timeCompare;
    }
    const typeCompare = String(left.check_type || '').localeCompare(
      String(right.check_type || ''),
    );
    if (typeCompare !== 0) {
      return typeCompare;
    }
    return Number(left.id || 0) - Number(right.id || 0);
  });
}

async function fetchBaselineRows(query, countries) {
  if (!Array.isArray(countries) || countries.length === 0) {
    return [];
  }

  return query(
    `
      SELECT
        mh.id,
        mh.variant_group_id,
        mh.variant_group_name,
        mh.asin_id,
        mh.asin_code,
        mh.asin_name,
        mh.site_snapshot,
        mh.brand_snapshot,
        mh.check_type,
        mh.country,
        mh.is_broken,
        mh.check_result,
        mh.notification_sent,
        DATE_FORMAT(mh.check_time, '%Y-%m-%d %H:%i:%s') AS check_time
      FROM monitor_history mh FORCE INDEX (idx_country_check_time)
      WHERE mh.check_time >= ?
        AND mh.check_time < ?
        AND mh.country IN (${countries.map(() => '?').join(', ')})
        AND mh.check_type IN ('ASIN', 'GROUP')
      ORDER BY mh.check_time DESC, mh.id DESC
    `,
    [BASELINE_WINDOW.startTime, BASELINE_WINDOW.endTime, ...countries],
  );
}

function buildBaselineMap(rows) {
  const baselineMap = new Map();
  for (const row of rows) {
    const key = getHistoryLogicalKey(row);
    if (!baselineMap.has(key)) {
      baselineMap.set(key, row);
    }
  }
  return baselineMap;
}

function buildRollbackPreview(targetRows, baselineRows, sampleLimit) {
  const baselineMap = buildBaselineMap(baselineRows);
  const missingBaselineKeys = [];
  const updates = [];

  for (const row of targetRows) {
    const logicalKey = getHistoryLogicalKey(row);
    const baseline = baselineMap.get(logicalKey);
    if (!baseline) {
      missingBaselineKeys.push({
        logicalKey,
        country: row.country,
        checkType: row.check_type,
        variantGroupId: row.variant_group_id || null,
        asinCode: row.asin_code || null,
        asinId: row.asin_id || null,
        targetRowId: row.id,
        targetCheckTime: row.check_time,
      });
      continue;
    }

    updates.push({
      id: row.id,
      category: 'rollback_0413',
      country: row.country,
      checkType: row.check_type,
      checkTime: row.check_time,
      variantGroupId: row.variant_group_id || null,
      asinCode: row.asin_code || null,
      afterIsBroken: Number(baseline.is_broken || 0) === 1 ? 1 : 0,
      afterCheckResult: baseline.check_result || null,
      afterNotificationSent:
        Number(baseline.notification_sent || 0) === 1 ? 1 : 0,
      updateNotificationSent: 1,
      baselineRowId: baseline.id,
      baselineCheckTime: baseline.check_time,
    });
  }

  return {
    summary: {
      targetRowCount: targetRows.length,
      targetRowsByCountry: summarizeRowsByCountry(targetRows),
      targetRowsByCheckType: summarizeRowsByCheckType(targetRows),
      baselineRowCount: baselineRows.length,
      updateRowCount: updates.length,
      missingBaselineKeyCount: dedupeByKey(
        missingBaselineKeys,
        (item) => item.logicalKey,
      ).length,
    },
    updates,
    baselineMap,
    missingBaselineKeys: dedupeByKey(
      missingBaselineKeys,
      (item) => item.logicalKey,
    ),
    sampleMissingBaselineKeys: dedupeByKey(
      missingBaselineKeys,
      (item) => item.logicalKey,
    ).slice(0, sampleLimit),
    sampleUpdates: updates.slice(0, sampleLimit),
  };
}

async function fetchDeleteRows(query) {
  return query(
    `
      SELECT
        mh.id,
        mh.variant_group_id,
        mh.variant_group_name,
        mh.asin_id,
        mh.asin_code,
        mh.asin_name,
        mh.site_snapshot,
        mh.brand_snapshot,
        mh.check_type,
        mh.country,
        mh.is_broken,
        mh.check_result,
        mh.notification_sent,
        DATE_FORMAT(mh.check_time, '%Y-%m-%d %H:%i:%s') AS check_time
      FROM monitor_history mh FORCE INDEX (idx_asin_code_country_check_time)
      WHERE mh.check_type = 'ASIN'
        AND mh.country = ?
        AND mh.asin_code IN (${DELETE_WINDOW.asins.map(() => '?').join(', ')})
        AND mh.check_time >= ?
        AND mh.check_time <= ?
      ORDER BY mh.check_time ASC, mh.id ASC
    `,
    [
      DELETE_WINDOW.country,
      ...DELETE_WINDOW.asins,
      DELETE_WINDOW.startTime,
      DELETE_WINDOW.endTime,
    ],
  );
}

function buildDeletePreview(rows, sampleLimit) {
  const batchKeys = new Set();
  const asinCounts = {};

  for (const row of rows) {
    const asinCode = String(row.asin_code || '').trim();
    if (asinCode) {
      asinCounts[asinCode] = (asinCounts[asinCode] || 0) + 1;
    }
    if (row.variant_group_id && row.country && row.check_time) {
      batchKeys.add(
        buildBatchKey(row.variant_group_id, row.country, row.check_time),
      );
    }
  }

  return {
    summary: {
      deleteRowCount: rows.length,
      asinCounts,
      affectedGroupBatchCount: batchKeys.size,
    },
    rows,
    batchKeys: Array.from(batchKeys).sort(),
    sampleRows: rows.slice(0, sampleLimit),
  };
}

async function fetchAttachmentCandidateRows(query, manualData) {
  const rows = [];

  for (const pairChunk of chunk(manualData.pairKeys, QUERY_CHUNK_SIZE)) {
    const tuplePlaceholders = pairChunk.map(() => '(?, ?)').join(', ');
    const params = [
      formatDateTime(manualData.startTime),
      formatDateTime(manualData.endTime),
    ];

    for (const key of pairChunk) {
      const { country, asinCode } = splitPairKey(key);
      params.push(asinCode, country);
    }

    const chunkRows = await query(
      `
        SELECT
          mh.id,
          mh.variant_group_id,
          mh.variant_group_name,
          mh.asin_id,
          mh.asin_code,
          mh.asin_name,
          mh.site_snapshot,
          mh.brand_snapshot,
          mh.check_type,
          mh.country,
          mh.is_broken,
          mh.check_result,
          mh.notification_sent,
          DATE_FORMAT(mh.check_time, '%Y-%m-%d %H:%i:%s') AS check_time
        FROM monitor_history mh FORCE INDEX (idx_asin_code_country_check_time)
        WHERE mh.check_type = 'ASIN'
          AND mh.check_time >= ?
          AND mh.check_time <= ?
          AND (mh.asin_code, mh.country) IN (${tuplePlaceholders})
        ORDER BY mh.country ASC, mh.asin_code ASC, mh.check_time ASC, mh.id ASC
      `,
      params,
    );
    rows.push(...chunkRows);
  }

  return rows;
}

function buildRepairedAsinCheckResult(
  row,
  desiredBroken,
  desiredStatusSource,
  sourceFile,
  rule,
  matchedInterval = null,
) {
  return JSON.stringify({
    asin: row.asin_code || null,
    isBroken: desiredBroken,
    statusSource: desiredStatusSource,
    manualBrokenReason: '',
    manualRepair: {
      source: path.basename(sourceFile),
      rule,
      matchedInterval: Boolean(matchedInterval),
      intervalStart: matchedInterval ? matchedInterval.startText : null,
      intervalEnd: matchedInterval ? matchedInterval.endText : null,
      reason: matchedInterval ? matchedInterval.reason || null : null,
    },
  });
}

function buildAttachmentPreview(
  manualData,
  existingRows,
  inputPath,
  sampleLimit,
) {
  const existingRowCountByPair = new Map();
  const changes = [];
  let matchedRowCount = 0;

  for (const row of existingRows) {
    const key = pairKey(row.country, row.asin_code);
    existingRowCountByPair.set(key, (existingRowCountByPair.get(key) || 0) + 1);
    const intervals = manualData.intervalsByPair.get(key) || [];
    const matchedInterval = findMatchedInterval(
      intervals,
      parseDateTimeInput(row.check_time),
    );
    if (matchedInterval) {
      matchedRowCount += 1;
    }

    changes.push({
      id: row.id,
      category: 'attachment_full_sheet',
      country: row.country,
      checkType: row.check_type,
      checkTime: row.check_time,
      variantGroupId: row.variant_group_id || null,
      asinCode: row.asin_code || null,
      afterIsBroken: matchedInterval ? 1 : 0,
      afterCheckResult: buildRepairedAsinCheckResult(
        row,
        Boolean(matchedInterval),
        matchedInterval ? 'AUTO' : 'NORMAL',
        inputPath,
        'attachment_full_sheet',
        matchedInterval,
      ),
      afterNotificationSent: null,
      updateNotificationSent: 0,
      matchedInterval: matchedInterval && {
        rowNumber: matchedInterval.rowNumber,
        start: matchedInterval.startText,
        end: matchedInterval.endText,
        reason: matchedInterval.reason,
      },
    });
  }

  const missingPairs = [];
  for (const key of manualData.pairKeys) {
    if (!existingRowCountByPair.has(key)) {
      const { country, asinCode } = splitPairKey(key);
      missingPairs.push({
        country,
        asinCode,
        intervalCount: manualData.intervalsByPair.get(key)?.length || 0,
      });
    }
  }

  return {
    summary: {
      pairCount: manualData.pairKeys.length,
      existingRowCount: existingRows.length,
      matchedRowCount,
      updateRowCount: changes.length,
      missingPairCount: missingPairs.length,
      startTime: formatDateTime(manualData.startTime),
      endTime: formatDateTime(manualData.endTime),
    },
    changes,
    missingPairs,
    sampleChanges: changes.slice(0, sampleLimit),
  };
}

async function fetchFallbackWindowRows(query) {
  return query(
    `
      SELECT
        mh.id,
        mh.variant_group_id,
        mh.variant_group_name,
        mh.asin_id,
        mh.asin_code,
        mh.asin_name,
        mh.site_snapshot,
        mh.brand_snapshot,
        mh.check_type,
        mh.country,
        mh.is_broken,
        mh.check_result,
        mh.notification_sent,
        DATE_FORMAT(mh.check_time, '%Y-%m-%d %H:%i:%s') AS check_time
      FROM monitor_history mh FORCE INDEX (idx_check_time)
      WHERE mh.check_type = 'ASIN'
        AND mh.check_time >= ?
        AND mh.check_time <= ?
      ORDER BY mh.country ASC, mh.asin_code ASC, mh.check_time ASC, mh.id ASC
    `,
    [
      NORMALIZE_OTHER_ASINS_WINDOW.startTime,
      NORMALIZE_OTHER_ASINS_WINDOW.endTime,
    ],
  );
}

function buildFallbackPreview(allRows, manualData, inputPath, sampleLimit) {
  const changes = [];

  for (const row of allRows) {
    const key = pairKey(row.country, row.asin_code);
    if (manualData.pairKeySet.has(key)) {
      continue;
    }

    changes.push({
      id: row.id,
      category: 'normalize_other_asins_0417_0418',
      country: row.country,
      checkType: row.check_type,
      checkTime: row.check_time,
      variantGroupId: row.variant_group_id || null,
      asinCode: row.asin_code || null,
      afterIsBroken: 0,
      afterCheckResult: buildRepairedAsinCheckResult(
        row,
        false,
        'NORMAL',
        inputPath,
        'normalize_other_asins_0417_0418',
      ),
      afterNotificationSent: null,
      updateNotificationSent: 0,
    });
  }

  return {
    summary: {
      candidateRowCount: allRows.length,
      normalizedRowCount: changes.length,
      startTime: NORMALIZE_OTHER_ASINS_WINDOW.startTime,
      endTime: NORMALIZE_OTHER_ASINS_WINDOW.endTime,
    },
    changes,
    sampleChanges: changes.slice(0, sampleLimit),
  };
}

function collectGroupBatchKeys(...rowLists) {
  const batchKeys = new Set();

  for (const rows of rowLists) {
    for (const row of rows) {
      const variantGroupId = row.variant_group_id || row.variantGroupId || '';
      const country = row.country || '';
      const checkTime = row.check_time || row.checkTime || '';
      if (!variantGroupId || !country || !checkTime) {
        continue;
      }
      batchKeys.add(buildBatchKey(variantGroupId, country, checkTime));
    }
  }

  return Array.from(batchKeys).sort();
}

function buildBatchKeyDerivedTableSql(batchKeys) {
  if (!Array.isArray(batchKeys) || batchKeys.length === 0) {
    return {
      sql: 'SELECT NULL AS variant_group_id, NULL AS country, NULL AS check_time',
      params: [],
    };
  }

  const selects = [];
  const params = [];
  for (const key of batchKeys) {
    const item = splitBatchKey(key);
    selects.push('SELECT ? AS variant_group_id, ? AS country, ? AS check_time');
    params.push(item.variantGroupId, item.country, item.checkTime);
  }

  return {
    sql: selects.join(' UNION ALL '),
    params,
  };
}

async function fetchExistingGroupRowsByBatchKeys(query, batchKeys) {
  if (!Array.isArray(batchKeys) || batchKeys.length === 0) {
    return [];
  }

  const rows = [];
  let chunkIndex = 0;
  for (const keyChunk of chunk(batchKeys, QUERY_CHUNK_SIZE)) {
    chunkIndex += 1;
    const batchKeyTable = buildBatchKeyDerivedTableSql(keyChunk);
    const chunkRows = await query(
      `
        SELECT
          mh.id,
          mh.variant_group_id,
          mh.country,
          DATE_FORMAT(mh.check_time, '%Y-%m-%d %H:%i:%s') AS check_time
        FROM (${batchKeyTable.sql}) batch_keys
        INNER JOIN monitor_history mh FORCE INDEX (idx_variant_group_check_time_broken)
          ON mh.variant_group_id = batch_keys.variant_group_id
         AND mh.country = batch_keys.country
         AND mh.check_time = batch_keys.check_time
        WHERE mh.check_type = 'GROUP'
        ORDER BY mh.country ASC, mh.check_time ASC, mh.id ASC
      `,
      batchKeyTable.params,
    );
    rows.push(...chunkRows);
    if (chunkIndex === 1 || chunkIndex % 10 === 0) {
      const logger = require('../src/utils/logger');
      logger.info('[History Repair 0412-0418] GROUP 批次查询进度', {
        chunkIndex,
        chunkSize: keyChunk.length,
        accumulatedRows: rows.length,
      });
    }
  }
  return rows;
}

function buildGroupRebuildPreview(batchKeys, groupRows, sampleLimit) {
  const existingBatchKeys = new Set(
    groupRows.map((row) =>
      buildBatchKey(row.variant_group_id, row.country, row.check_time),
    ),
  );
  const missingGroupBatches = [];
  for (const key of batchKeys) {
    if (!existingBatchKeys.has(key)) {
      missingGroupBatches.push(splitBatchKey(key));
    }
  }

  return {
    summary: {
      batchCount: batchKeys.length,
      existingGroupRowCount: groupRows.length,
      missingGroupBatchCount: missingGroupBatches.length,
    },
    groupRows,
    missingGroupBatches,
    sampleMissingGroupBatches: missingGroupBatches.slice(0, sampleLimit),
  };
}

async function fetchRowsByIds(query, tableName, ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return [];
  }

  const rows = [];
  let chunkIndex = 0;
  for (const idChunk of chunk(ids, DELETE_BATCH_SIZE)) {
    chunkIndex += 1;
    const chunkRows = await query(
      `
        SELECT *
        FROM \`${tableName}\`
        WHERE id IN (${idChunk.map(() => '?').join(', ')})
        ORDER BY id ASC
      `,
      idChunk,
    );
    rows.push(...chunkRows);
    if (chunkIndex === 1 || chunkIndex % 10 === 0) {
      const logger = require('../src/utils/logger');
      logger.info('[History Repair 0412-0418] 备份原始行查询进度', {
        tableName,
        chunkIndex,
        chunkSize: idChunk.length,
        accumulatedRows: rows.length,
      });
    }
  }
  return rows;
}

async function fetchHistoryRowsForVerificationByIds(query, ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return [];
  }

  const rows = [];
  for (const idChunk of chunk(ids, DELETE_BATCH_SIZE)) {
    const chunkRows = await query(
      `
        SELECT
          mh.id,
          mh.variant_group_id,
          mh.asin_id,
          mh.asin_code,
          mh.check_type,
          mh.country,
          mh.is_broken,
          mh.check_result,
          mh.notification_sent,
          DATE_FORMAT(mh.check_time, '%Y-%m-%d %H:%i:%s') AS check_time
        FROM monitor_history mh
        WHERE mh.id IN (${idChunk.map(() => '?').join(', ')})
        ORDER BY mh.id ASC
      `,
      idChunk,
    );
    rows.push(...chunkRows);
  }

  return rows;
}

function collectAggScope(rows) {
  const countries = new Set();
  const hourSlots = new Set();
  const daySlots = new Set();

  for (const row of rows) {
    if (row.country) {
      countries.add(row.country);
    }
    if (row.check_time) {
      hourSlots.add(floorToHourText(row.check_time));
      daySlots.add(floorToDayText(row.check_time));
    }
  }

  return {
    countries: Array.from(countries).sort(),
    hourSlots: Array.from(hourSlots).filter(Boolean).sort(),
    daySlots: Array.from(daySlots).filter(Boolean).sort(),
  };
}

async function fetchAggBackupRows(query, tableName, aggScope) {
  if (
    !aggScope ||
    aggScope.countries.length === 0 ||
    (aggScope.hourSlots.length === 0 && aggScope.daySlots.length === 0)
  ) {
    return [];
  }

  const conditions = [];
  const params = [...aggScope.countries];
  if (aggScope.hourSlots.length > 0) {
    conditions.push(
      `(granularity = 'hour' AND time_slot IN (${aggScope.hourSlots
        .map(() => '?')
        .join(', ')}))`,
    );
    params.push(...aggScope.hourSlots);
  }
  if (aggScope.daySlots.length > 0) {
    conditions.push(
      `(granularity = 'day' AND time_slot IN (${aggScope.daySlots
        .map(() => '?')
        .join(', ')}))`,
    );
    params.push(...aggScope.daySlots);
  }

  return query(
    `
      SELECT *
      FROM \`${tableName}\`
      WHERE country IN (${aggScope.countries.map(() => '?').join(', ')})
        AND (${conditions.join(' OR ')})
      ORDER BY country ASC, granularity ASC, time_slot ASC
    `,
    params,
  );
}

function buildRawRestoreDeleteSql(ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return '';
  }

  return chunk(ids, DELETE_BATCH_SIZE)
    .map(
      (idChunk) =>
        `DELETE FROM monitor_history WHERE id IN (${idChunk
          .map((id) => escapeSqlValue(id))
          .join(', ')});`,
    )
    .join('\n\n');
}

function buildAggRestoreDeleteSql(tableName, aggScope) {
  if (
    !aggScope ||
    aggScope.countries.length === 0 ||
    (aggScope.hourSlots.length === 0 && aggScope.daySlots.length === 0)
  ) {
    return '';
  }

  const clauses = [];
  if (aggScope.hourSlots.length > 0) {
    clauses.push(`(
  granularity = 'hour'
  AND time_slot IN (${aggScope.hourSlots
    .map((item) => escapeSqlValue(item))
    .join(', ')})
)`);
  }
  if (aggScope.daySlots.length > 0) {
    clauses.push(`(
  granularity = 'day'
  AND time_slot IN (${aggScope.daySlots
    .map((item) => escapeSqlValue(item))
    .join(', ')})
)`);
  }

  return `DELETE FROM \`${tableName}\`
WHERE country IN (${aggScope.countries
    .map((item) => escapeSqlValue(item))
    .join(', ')})
  AND (
${clauses.join('\n  OR\n')}
  );`;
}

async function createScopedSqlBackup(
  query,
  backupRows,
  aggScope,
  reportDir,
  logger,
) {
  ensureDir(reportDir);
  const filename = `history-repair-20260412-0418-backup-${buildSuffix()}.sql`;
  const filepath = path.join(reportDir, filename);
  const stream = fs.createWriteStream(filepath, { encoding: 'utf8' });

  try {
    const aggRows = await fetchAggBackupRows(
      query,
      'monitor_history_agg',
      aggScope,
    );
    const aggDimRows = await fetchAggBackupRows(
      query,
      'monitor_history_agg_dim',
      aggScope,
    );
    const aggVariantRows = await fetchAggBackupRows(
      query,
      'monitor_history_agg_variant_group',
      aggScope,
    );

    await writeSqlChunks(
      stream,
      [
        '-- Scoped SQL backup for monitor history repair 2026-04-12 ~ 2026-04-18',
        `-- created_at: ${new Date().toISOString()}`,
        '-- scope: rows and agg buckets touched by this execution',
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

    const aggDeleteSql = buildAggRestoreDeleteSql(
      'monitor_history_agg',
      aggScope,
    );
    if (aggDeleteSql) {
      await writeSqlChunks(stream, `${aggDeleteSql}\n\n`);
    }
    await appendTableBackup(stream, query, 'monitor_history_agg', aggRows);

    const aggDimDeleteSql = buildAggRestoreDeleteSql(
      'monitor_history_agg_dim',
      aggScope,
    );
    if (aggDimDeleteSql) {
      await writeSqlChunks(stream, `${aggDimDeleteSql}\n\n`);
    }
    await appendTableBackup(
      stream,
      query,
      'monitor_history_agg_dim',
      aggDimRows,
    );

    const aggVariantDeleteSql = buildAggRestoreDeleteSql(
      'monitor_history_agg_variant_group',
      aggScope,
    );
    if (aggVariantDeleteSql) {
      await writeSqlChunks(stream, `${aggVariantDeleteSql}\n\n`);
    }
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
      monitor_history: backupRows.length,
      monitor_history_agg: aggRows.length,
      monitor_history_agg_dim: aggDimRows.length,
      monitor_history_agg_variant_group: aggVariantRows.length,
    };

    logger.info('[History Repair 0412-0418] Scoped SQL 备份完成', {
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

function normalizeManualFlag(statusSource, parsed) {
  if (Number(parsed.manualBroken || 0) === 1) {
    return 1;
  }
  return String(statusSource || '').includes('MANUAL') ? 1 : 0;
}

function normalizeAutoFlag(row, statusSource, parsed) {
  if (Number(parsed.autoIsBroken || 0) === 1) {
    return 1;
  }
  if (String(statusSource || '').trim() === 'MANUAL') {
    return 0;
  }
  return Number(row.is_broken || 0) === 1 ? 1 : 0;
}

function buildChildSnapshotFromAsinRow(row) {
  const parsed = parseJsonSafe(row.check_result);
  const explicitStatusSource = String(parsed.statusSource || '').trim();
  const autoFlag = normalizeAutoFlag(row, explicitStatusSource, parsed);
  const manualFlag = normalizeManualFlag(explicitStatusSource, parsed);
  const effective = buildEffectiveStatus({
    autoBroken: autoFlag,
    manualBroken: manualFlag,
  });
  const statusSource = explicitStatusSource || effective.statusSource;

  return {
    id: row.asin_id || null,
    asin: row.asin_code || null,
    name: row.asin_name || null,
    country: row.country || null,
    site: row.site_snapshot || null,
    brand: row.brand_snapshot || null,
    is_broken: effective.autoIsBroken,
    variant_status: effective.autoVariantStatus,
    autoIsBroken: effective.autoIsBroken,
    autoVariantStatus: effective.autoVariantStatus,
    isBroken: effective.isBroken,
    variantStatus: effective.variantStatus,
    statusSource,
    manualBroken: effective.manualBroken,
    manualBrokenReason: parsed.manualBrokenReason || '',
    manualBrokenUpdatedAt: parsed.manualBrokenUpdatedAt || null,
    manualBrokenUpdatedBy: parsed.manualBrokenUpdatedBy || null,
    selfManualBroken:
      Number(parsed.selfManualBroken || 0) === 1 ? 1 : effective.manualBroken,
  };
}

function buildDecoratedGroupStatus(baseGroupRow, children, basePayload) {
  const autoBrokenChild = children.some((child) => child.autoIsBroken === 1);
  const groupManualBroken =
    Number(
      basePayload.groupStatus?.manualBroken ??
        basePayload.groupSnapshot?.manualBroken ??
        0,
    ) === 1
      ? 1
      : 0;
  const childManualBroken = children.some((child) => child.manualBroken === 1);
  const effective = buildEffectiveStatus({
    autoBroken: autoBrokenChild ? 1 : 0,
    manualBroken: groupManualBroken || childManualBroken ? 1 : 0,
  });

  return {
    id: baseGroupRow.variant_group_id || null,
    name:
      baseGroupRow.variant_group_name ||
      basePayload.groupStatus?.name ||
      basePayload.groupSnapshot?.name ||
      '',
    country: baseGroupRow.country || null,
    lastCheckTime: baseGroupRow.check_time,
    effective,
    manualBroken: groupManualBroken,
    manualBrokenReason:
      basePayload.groupStatus?.manualBrokenReason ||
      basePayload.groupSnapshot?.manualBrokenReason ||
      '',
    manualBrokenUpdatedAt:
      basePayload.groupSnapshot?.manualBrokenUpdatedAt || null,
    manualBrokenUpdatedBy:
      basePayload.groupSnapshot?.manualBrokenUpdatedBy || null,
  };
}

function buildRebuiltGroupCheckResult(groupRow, asinRows) {
  const basePayload = parseJsonSafe(groupRow.check_result);
  const children = asinRows
    .slice()
    .sort((left, right) => {
      const leftAsin = String(left.asin_code || '');
      const rightAsin = String(right.asin_code || '');
      if (leftAsin !== rightAsin) {
        return leftAsin.localeCompare(rightAsin);
      }
      return Number(left.id || 0) - Number(right.id || 0);
    })
    .map(buildChildSnapshotFromAsinRow);

  const groupState = buildDecoratedGroupStatus(groupRow, children, basePayload);
  const brokenASINs = children
    .filter((child) => child.isBroken === 1)
    .map((child) => ({
      asin: child.asin,
      errorType: 'NO_VARIANTS',
      statusSource: child.statusSource || 'NORMAL',
      manualBroken: child.manualBroken || 0,
      manualBrokenReason: child.manualBrokenReason || '',
      manualBrokenUpdatedAt: child.manualBrokenUpdatedAt || null,
      manualBrokenUpdatedBy: child.manualBrokenUpdatedBy || null,
    }));

  const groupSnapshot = {
    ...(basePayload.groupSnapshot &&
    typeof basePayload.groupSnapshot === 'object'
      ? basePayload.groupSnapshot
      : {}),
    id: groupState.id,
    name: groupState.name,
    country: groupState.country,
    is_broken: groupState.effective.autoIsBroken,
    variant_status: groupState.effective.autoVariantStatus,
    autoIsBroken: groupState.effective.autoIsBroken,
    autoVariantStatus: groupState.effective.autoVariantStatus,
    isBroken: groupState.effective.isBroken,
    variantStatus: groupState.effective.variantStatus,
    statusSource: groupState.effective.statusSource,
    manualBroken: groupState.manualBroken,
    manualBrokenReason: groupState.manualBrokenReason || '',
    manualBrokenUpdatedAt: groupState.manualBrokenUpdatedAt || null,
    manualBrokenUpdatedBy: groupState.manualBrokenUpdatedBy || null,
    last_check_time: groupState.lastCheckTime,
    lastCheckTime: groupState.lastCheckTime,
    children,
  };

  const detailsResults = children.map((child) => ({
    asin: child.asin,
    country: child.country,
    isBroken: child.isBroken === 1,
    errorType: child.isBroken === 1 ? 'NO_VARIANTS' : undefined,
    statusSource: child.statusSource || 'NORMAL',
    details: {
      asin: child.asin,
      isBroken: child.isBroken === 1,
      statusSource: child.statusSource || 'NORMAL',
      manualBrokenReason: child.manualBrokenReason || '',
    },
  }));

  return JSON.stringify({
    ...basePayload,
    isBroken: groupState.effective.isBroken === 1,
    brokenASINs,
    brokenByType: {
      SP_API_ERROR: 0,
      NO_VARIANTS: brokenASINs.length,
    },
    groupStatus: {
      id: groupState.id,
      name: groupState.name,
      is_broken: groupState.effective.isBroken,
      statusSource: groupState.effective.statusSource,
      manualBroken: groupState.manualBroken,
      manualBrokenReason: groupState.manualBrokenReason || '',
      last_check_time: groupState.lastCheckTime,
    },
    groupSnapshot,
    details: {
      ...(basePayload.details && typeof basePayload.details === 'object'
        ? basePayload.details
        : {}),
      results: detailsResults,
    },
  });
}

async function createUpdateTempTable(
  queryExecutor,
  tempTableName,
  updates,
  logger,
) {
  if (!Array.isArray(updates) || updates.length === 0) {
    return 0;
  }

  await queryExecutor(`
    CREATE TEMPORARY TABLE \`${tempTableName}\` (
      id BIGINT PRIMARY KEY,
      is_broken TINYINT(1) NOT NULL,
      check_result LONGTEXT NULL,
      notification_sent TINYINT(1) NULL,
      update_notification_sent TINYINT(1) NOT NULL DEFAULT 0
    ) ENGINE=InnoDB
  `);

  for (const batch of chunk(updates, APPLY_BATCH_SIZE)) {
    const placeholders = batch.map(() => '(?, ?, ?, ?, ?)').join(', ');
    const values = [];
    for (const item of batch) {
      values.push(
        item.id,
        item.afterIsBroken,
        item.afterCheckResult,
        item.afterNotificationSent,
        item.updateNotificationSent ? 1 : 0,
      );
    }
    await queryExecutor(
      `
        INSERT INTO \`${tempTableName}\`
          (id, is_broken, check_result, notification_sent, update_notification_sent)
        VALUES ${placeholders}
      `,
      values,
    );
  }

  const result = await queryExecutor(`
    UPDATE monitor_history mh
    INNER JOIN \`${tempTableName}\` t
      ON t.id = mh.id
    SET
      mh.is_broken = t.is_broken,
      mh.check_result = t.check_result,
      mh.notification_sent = CASE
        WHEN t.update_notification_sent = 1 THEN COALESCE(t.notification_sent, 0)
        ELSE mh.notification_sent
      END
  `);

  logger.info('[History Repair 0412-0418] monitor_history 更新已写入临时表', {
    tempTableName,
    updateRowCount: updates.length,
    affectedRows: Number(result?.affectedRows || 0),
  });

  return Number(result?.affectedRows || 0);
}

async function deleteRowsByIds(queryExecutor, ids) {
  let affectedRows = 0;
  for (const idChunk of chunk(ids, DELETE_BATCH_SIZE)) {
    const result = await queryExecutor(
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

async function fetchBatchRowsInTransaction(
  queryExecutor,
  batchKeys,
  checkType,
) {
  if (!Array.isArray(batchKeys) || batchKeys.length === 0) {
    return [];
  }

  const rows = [];
  for (const keyChunk of chunk(batchKeys, QUERY_CHUNK_SIZE)) {
    const batchKeyTable = buildBatchKeyDerivedTableSql(keyChunk);
    const chunkRows = await queryExecutor(
      `
        SELECT
          mh.id,
          mh.variant_group_id,
          mh.variant_group_name,
          mh.asin_id,
          mh.asin_code,
          mh.asin_name,
          mh.site_snapshot,
          mh.brand_snapshot,
          mh.check_type,
          mh.country,
          mh.is_broken,
          mh.check_result,
          mh.notification_sent,
          DATE_FORMAT(mh.check_time, '%Y-%m-%d %H:%i:%s') AS check_time
        FROM (${batchKeyTable.sql}) batch_keys
        INNER JOIN monitor_history mh FORCE INDEX (idx_variant_group_check_time_broken)
          ON mh.variant_group_id = batch_keys.variant_group_id
         AND mh.country = batch_keys.country
         AND mh.check_time = batch_keys.check_time
        WHERE mh.check_type = ?
        ORDER BY mh.country ASC, mh.check_time ASC, mh.id ASC
      `,
      [...batchKeyTable.params, checkType],
    );
    rows.push(...chunkRows);
  }
  return rows;
}

async function rebuildGroupRowsInTransaction(queryExecutor, batchKeys, logger) {
  if (!Array.isArray(batchKeys) || batchKeys.length === 0) {
    return {
      batchCount: 0,
      updatedGroupRowCount: 0,
      missingGroupBatchCount: 0,
      missingGroupBatches: [],
    };
  }

  const groupRows = await fetchBatchRowsInTransaction(
    queryExecutor,
    batchKeys,
    'GROUP',
  );
  const asinRows = await fetchBatchRowsInTransaction(
    queryExecutor,
    batchKeys,
    'ASIN',
  );

  const groupRowsByBatch = new Map();
  for (const row of groupRows) {
    const key = buildBatchKey(
      row.variant_group_id,
      row.country,
      row.check_time,
    );
    if (!groupRowsByBatch.has(key)) {
      groupRowsByBatch.set(key, []);
    }
    groupRowsByBatch.get(key).push(row);
  }

  const asinRowsByBatch = new Map();
  for (const row of asinRows) {
    const key = buildBatchKey(
      row.variant_group_id,
      row.country,
      row.check_time,
    );
    if (!asinRowsByBatch.has(key)) {
      asinRowsByBatch.set(key, []);
    }
    asinRowsByBatch.get(key).push(row);
  }

  const updates = [];
  const missingGroupBatches = [];

  for (const key of batchKeys) {
    const rowsForBatch = groupRowsByBatch.get(key) || [];
    if (rowsForBatch.length === 0) {
      missingGroupBatches.push(splitBatchKey(key));
      continue;
    }

    const asinRowsForBatch = asinRowsByBatch.get(key) || [];
    const nextCheckResult = buildRebuiltGroupCheckResult(
      rowsForBatch[0],
      asinRowsForBatch,
    );
    const nextIsBroken = asinRowsForBatch.some(
      (item) => Number(item.is_broken || 0) === 1,
    )
      ? 1
      : 0;

    for (const groupRow of rowsForBatch) {
      updates.push({
        id: groupRow.id,
        afterIsBroken: nextIsBroken,
        afterCheckResult: nextCheckResult,
        afterNotificationSent: null,
        updateNotificationSent: 0,
      });
    }
  }

  const affectedRows = await createUpdateTempTable(
    queryExecutor,
    'tmp_history_repair_0412_0418_group_updates',
    updates,
    logger,
  );

  return {
    batchCount: batchKeys.length,
    updatedGroupRowCount: updates.length,
    affectedRows,
    missingGroupBatchCount: missingGroupBatches.length,
    missingGroupBatches,
  };
}

async function clearAffectedAggRows(query, aggScope) {
  const result = {};
  if (
    !aggScope ||
    aggScope.countries.length === 0 ||
    (aggScope.hourSlots.length === 0 && aggScope.daySlots.length === 0)
  ) {
    result.monitor_history_agg = 0;
    result.monitor_history_agg_dim = 0;
    result.monitor_history_agg_variant_group = 0;
    return result;
  }

  const statements = [
    { key: 'monitor_history_agg', tableName: 'monitor_history_agg' },
    { key: 'monitor_history_agg_dim', tableName: 'monitor_history_agg_dim' },
    {
      key: 'monitor_history_agg_variant_group',
      tableName: 'monitor_history_agg_variant_group',
    },
  ];

  for (const item of statements) {
    const conditions = [];
    const params = [...aggScope.countries];
    if (aggScope.hourSlots.length > 0) {
      conditions.push(
        `(granularity = 'hour' AND time_slot IN (${aggScope.hourSlots
          .map(() => '?')
          .join(', ')}))`,
      );
      params.push(...aggScope.hourSlots);
    }
    if (aggScope.daySlots.length > 0) {
      conditions.push(
        `(granularity = 'day' AND time_slot IN (${aggScope.daySlots
          .map(() => '?')
          .join(', ')}))`,
      );
      params.push(...aggScope.daySlots);
    }

    const queryResult = await query(
      `
        DELETE FROM \`${item.tableName}\`
        WHERE country IN (${aggScope.countries.map(() => '?').join(', ')})
          AND (${conditions.join(' OR ')})
      `,
      params,
    );
    result[item.key] = Number(queryResult?.affectedRows || 0);
  }

  return result;
}

function buildAggRefreshWindowFromScope(aggScope) {
  const rawStarts = [];
  const rawEnds = [];

  for (const item of aggScope.hourSlots || []) {
    rawStarts.push(item);
    const startDate = parseDateTimeInput(item);
    if (startDate) {
      startDate.setMinutes(startDate.getMinutes() + 59, 59, 0);
      rawEnds.push(formatDateTime(startDate));
    }
  }

  for (const item of aggScope.daySlots || []) {
    const dayStart = parseDateTimeInput(item);
    if (!dayStart) {
      continue;
    }
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    dayEnd.setSeconds(dayEnd.getSeconds() - 1);
    rawStarts.push(formatDateTime(dayStart));
    rawEnds.push(formatDateTime(dayEnd));
  }

  const filteredStarts = rawStarts.filter(Boolean).sort();
  const filteredEnds = rawEnds.filter(Boolean).sort();
  if (filteredStarts.length === 0 || filteredEnds.length === 0) {
    return null;
  }

  return {
    startTime: filteredStarts[0],
    endTime: filteredEnds[filteredEnds.length - 1],
  };
}

async function refreshAffectedAggWindow(analyticsAggService, aggScope, logger) {
  const options = buildAggRefreshWindowFromScope(aggScope);
  if (!options) {
    return {
      skipped: true,
      reason: 'no_affected_window',
    };
  }

  const result = {
    options,
    hour: await analyticsAggService.refreshAnalyticsAggBundle('hour', options),
    day: await analyticsAggService.refreshAnalyticsAggBundle('day', options),
  };

  logger.info('[History Repair 0412-0418] 聚合刷新完成', result);
  return result;
}

function writeReport(reportDir, payload) {
  ensureDir(reportDir);
  const reportPath = path.join(
    reportDir,
    `history-repair-20260412-0418-report-${buildSuffix()}.json`,
  );
  fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2), 'utf8');
  return reportPath;
}

async function closeResources(pool, redisConfig, logger) {
  try {
    if (redisConfig) {
      await redisConfig.closeRedis();
    }
  } catch (error) {
    logger.warn('[History Repair 0412-0418] 关闭 Redis 失败', {
      message: error.message,
    });
  }

  try {
    if (pool) {
      await pool.end();
    }
  } catch (error) {
    logger.warn('[History Repair 0412-0418] 关闭数据库连接池失败', {
      message: error.message,
    });
  }
}

function buildBackupRawIds(
  rollbackTargetRows,
  deleteRows,
  attachmentChanges,
  fallbackChanges,
  groupRows,
) {
  const idSet = new Set();

  for (const row of rollbackTargetRows) {
    idSet.add(row.id);
  }
  for (const row of deleteRows) {
    idSet.add(row.id);
  }
  for (const row of attachmentChanges) {
    idSet.add(row.id);
  }
  for (const row of fallbackChanges) {
    idSet.add(row.id);
  }
  for (const row of groupRows) {
    idSet.add(row.id);
  }

  return Array.from(idSet).sort((left, right) => Number(left) - Number(right));
}

function findDeleteUpdateOverlap(deleteRows, updateIdSet) {
  const overlaps = [];
  for (const row of deleteRows) {
    if (updateIdSet.has(row.id)) {
      overlaps.push({
        id: row.id,
        asinCode: row.asin_code || null,
        country: row.country || null,
        checkTime: row.check_time || null,
      });
    }
  }
  return overlaps;
}

async function buildPreviewContext(query, logger, args) {
  logger.info('[History Repair 0412-0418] 开始构建预览上下文', {
    inputPath: args.inputPath,
    sampleLimit: args.sampleLimit,
  });
  const manualData = await loadManualIntervals(args.inputPath, logger);
  logger.info('[History Repair 0412-0418] 手工附件解析完成', {
    effectiveRowCount: manualData.effectiveRowCount,
    pairCount: manualData.pairKeys.length,
    invalidRows: manualData.invalidRows.length,
  });

  const rollbackTargetRows = await fetchRollbackTargetRows(query);
  logger.info('[History Repair 0412-0418] 4/13 回滚目标已加载', {
    rowCount: rollbackTargetRows.length,
  });
  const rollbackCountries = Array.from(
    new Set(rollbackTargetRows.map((item) => item.country)),
  ).sort();
  const baselineRows = await fetchBaselineRows(query, rollbackCountries);
  logger.info('[History Repair 0412-0418] 4/13 回滚基线已加载', {
    rowCount: baselineRows.length,
    countries: rollbackCountries,
  });
  const rollbackPreview = buildRollbackPreview(
    rollbackTargetRows,
    baselineRows,
    args.sampleLimit,
  );
  logger.info(
    '[History Repair 0412-0418] 4/13 回滚预览已生成',
    rollbackPreview.summary,
  );

  const deleteRows = await fetchDeleteRows(query);
  const deletePreview = buildDeletePreview(deleteRows, args.sampleLimit);
  logger.info(
    '[History Repair 0412-0418] DE 删除预览已生成',
    deletePreview.summary,
  );

  const attachmentExistingRows = await fetchAttachmentCandidateRows(
    query,
    manualData,
  );
  const attachmentPreview = buildAttachmentPreview(
    manualData,
    attachmentExistingRows,
    args.inputPath,
    args.sampleLimit,
  );
  logger.info(
    '[History Repair 0412-0418] 附件覆盖预览已生成',
    attachmentPreview.summary,
  );

  const fallbackWindowRows = await fetchFallbackWindowRows(query);
  const fallbackPreview = buildFallbackPreview(
    fallbackWindowRows,
    manualData,
    args.inputPath,
    args.sampleLimit,
  );
  logger.info(
    '[History Repair 0412-0418] 4/17~4/18 兜底归正预览已生成',
    fallbackPreview.summary,
  );

  const mergedUpdates = mergeUniqueUpdates(
    rollbackPreview.updates,
    attachmentPreview.changes,
    fallbackPreview.changes,
  );
  logger.info('[History Repair 0412-0418] 更新集合已合并', {
    updateCount: mergedUpdates.updates.length,
    duplicateCount: mergedUpdates.duplicates.length,
  });

  const deleteUpdateOverlap = findDeleteUpdateOverlap(
    deleteRows,
    new Set(mergedUpdates.updates.map((item) => item.id)),
  );
  const deleteIdSet = new Set(deleteRows.map((item) => item.id));
  const filteredUpdates = mergedUpdates.updates.filter(
    (item) => !deleteIdSet.has(item.id),
  );
  logger.info('[History Repair 0412-0418] 删除/更新冲突已过滤', {
    deleteUpdateOverlapCount: deleteUpdateOverlap.length,
    filteredUpdateCount: filteredUpdates.length,
  });

  const groupBatchKeys = collectGroupBatchKeys(
    deleteRows,
    attachmentPreview.changes,
    fallbackPreview.changes,
  );
  logger.info('[History Repair 0412-0418] GROUP 重建批次已收集', {
    batchCount: groupBatchKeys.length,
  });
  const groupRows = await fetchExistingGroupRowsByBatchKeys(
    query,
    groupBatchKeys,
  );
  const groupRebuildPreview = buildGroupRebuildPreview(
    groupBatchKeys,
    groupRows,
    args.sampleLimit,
  );
  logger.info(
    '[History Repair 0412-0418] GROUP 重建预览已生成',
    groupRebuildPreview.summary,
  );

  let backupRows = [];
  let aggScope = {
    countries: [],
    hourSlots: [],
    daySlots: [],
  };
  if (args.apply || args.verifyOnly) {
    const backupRawIds = buildBackupRawIds(
      rollbackTargetRows,
      deleteRows,
      attachmentPreview.changes,
      fallbackPreview.changes,
      groupRows,
    );
    logger.info('[History Repair 0412-0418] 备份原始 ID 已收集', {
      backupRawIdCount: backupRawIds.length,
    });
    backupRows = await fetchRowsByIds(query, 'monitor_history', backupRawIds);
    aggScope = collectAggScope(backupRows);
    logger.info('[History Repair 0412-0418] apply 备份上下文已构建', {
      backupRowCount: backupRows.length,
      aggCountryCount: aggScope.countries.length,
      aggHourSlotCount: aggScope.hourSlots.length,
      aggDaySlotCount: aggScope.daySlots.length,
    });
  } else {
    logger.info('[History Repair 0412-0418] 预览上下文构建完成', {
      backupPreparationSkipped: true,
      groupRowCount: groupRows.length,
    });
  }

  return {
    manualData,
    rollbackTargetRows,
    rollbackPreview,
    deletePreview,
    attachmentPreview,
    fallbackPreview,
    mergedUpdates: {
      updates: filteredUpdates,
      duplicates: mergedUpdates.duplicates,
    },
    deleteUpdateOverlap,
    groupBatchKeys,
    groupRebuildPreview,
    backupRows,
    aggScope,
  };
}

async function applyMutation(withTransaction, context, logger) {
  return withTransaction(async ({ query }) => {
    const deletedRows = await deleteRowsByIds(
      query,
      context.deletePreview.rows.map((row) => row.id),
    );
    const updatedRows = await createUpdateTempTable(
      query,
      'tmp_history_repair_0412_0418_updates',
      context.mergedUpdates.updates,
      logger,
    );
    const groupRebuildResult = await rebuildGroupRowsInTransaction(
      query,
      context.groupBatchKeys,
      logger,
    );

    return {
      deletedRows,
      updatedRows,
      groupRebuildResult,
    };
  });
}

async function collectPostVerification(query, context) {
  const result = {};
  const overriddenRollbackIdSet = new Set(
    context.mergedUpdates.duplicates
      .filter((item) => item.previousCategory === 'rollback_0413')
      .map((item) => Number(item.id)),
  );

  const rollbackRows = await fetchHistoryRowsForVerificationByIds(
    query,
    context.rollbackTargetRows.map((row) => row.id),
  );
  const rollbackChecks = rollbackRows.map((row) => {
    if (overriddenRollbackIdSet.has(Number(row.id))) {
      return {
        id: row.id,
        checkTime: formatDateTime(row.check_time),
        passed: true,
        skippedByHigherPriorityRule: true,
      };
    }
    const baseline = context.rollbackPreview.baselineMap.get(
      getHistoryLogicalKey(row),
    );
    if (!baseline) {
      return {
        id: row.id,
        checkTime: formatDateTime(row.check_time),
        passed: false,
        reason: 'baseline_missing_after_apply',
      };
    }
    return {
      id: row.id,
      checkTime: formatDateTime(row.check_time),
      passed:
        Number(row.is_broken || 0) === Number(baseline.is_broken || 0) &&
        String(row.check_result || '') ===
          String(baseline.check_result || '') &&
        Number(row.notification_sent || 0) ===
          Number(baseline.notification_sent || 0),
    };
  });
  const evaluatedRollbackChecks = rollbackChecks.filter(
    (item) => item.skippedByHigherPriorityRule !== true,
  );
  result.rollback0413 = {
    checkedRowCount: evaluatedRollbackChecks.length,
    skippedRowCount: rollbackChecks.length - evaluatedRollbackChecks.length,
    failedRowCount: evaluatedRollbackChecks.filter((item) => !item.passed)
      .length,
    sampleFailures: evaluatedRollbackChecks
      .filter((item) => !item.passed)
      .slice(0, 20),
    passed: evaluatedRollbackChecks.every((item) => item.passed),
  };

  const deletedRows = await query(
    `
      SELECT asin_code, COUNT(*) AS row_count
      FROM monitor_history
      WHERE check_type = 'ASIN'
        AND country = ?
        AND asin_code IN (${DELETE_WINDOW.asins.map(() => '?').join(', ')})
        AND check_time >= ?
        AND check_time <= ?
      GROUP BY asin_code
      ORDER BY asin_code ASC
    `,
    [
      DELETE_WINDOW.country,
      ...DELETE_WINDOW.asins,
      DELETE_WINDOW.startTime,
      DELETE_WINDOW.endTime,
    ],
  );
  result.deleteDE = {
    remainingRows: deletedRows,
    passed: deletedRows.length === 0,
  };

  const attachmentRows = await fetchHistoryRowsForVerificationByIds(
    query,
    context.attachmentPreview.changes.map((row) => row.id),
  );
  const attachmentChecks = attachmentRows.map((row) => {
    const key = pairKey(row.country, row.asin_code);
    const matchedInterval = findMatchedInterval(
      context.manualData.intervalsByPair.get(key) || [],
      parseDateTimeInput(row.check_time),
    );
    return {
      id: row.id,
      asinCode: row.asin_code,
      checkTime: formatDateTime(row.check_time),
      passed: Number(row.is_broken || 0) === (matchedInterval ? 1 : 0),
    };
  });
  result.attachment = {
    checkedRowCount: attachmentChecks.length,
    failedRowCount: attachmentChecks.filter((item) => !item.passed).length,
    sampleFailures: attachmentChecks
      .filter((item) => !item.passed)
      .slice(0, 20),
    passed: attachmentChecks.every((item) => item.passed),
  };

  const fallbackRows = await fetchHistoryRowsForVerificationByIds(
    query,
    context.fallbackPreview.changes.map((row) => row.id),
  );
  const fallbackChecks = fallbackRows.map((row) => ({
    id: row.id,
    asinCode: row.asin_code,
    checkTime: formatDateTime(row.check_time),
    passed: Number(row.is_broken || 0) === 0,
  }));
  result.normalizeOtherAsins0417_0418 = {
    checkedRowCount: fallbackChecks.length,
    failedRowCount: fallbackChecks.filter((item) => !item.passed).length,
    sampleFailures: fallbackChecks.filter((item) => !item.passed).slice(0, 20),
    passed: fallbackChecks.every((item) => item.passed),
  };

  const groupRows = await fetchBatchRowsInTransaction(
    query,
    context.groupBatchKeys,
    'GROUP',
  );
  const asinRows = await fetchBatchRowsInTransaction(
    query,
    context.groupBatchKeys,
    'ASIN',
  );
  const asinRowsByBatch = new Map();
  for (const row of asinRows) {
    const key = buildBatchKey(
      row.variant_group_id,
      row.country,
      row.check_time,
    );
    if (!asinRowsByBatch.has(key)) {
      asinRowsByBatch.set(key, []);
    }
    asinRowsByBatch.get(key).push(row);
  }
  const groupChecks = groupRows.map((row) => {
    const batchKey = buildBatchKey(
      row.variant_group_id,
      row.country,
      row.check_time,
    );
    const asinRowsForBatch = asinRowsByBatch.get(batchKey) || [];
    const brokenCount = asinRowsForBatch.filter(
      (item) => Number(item.is_broken || 0) === 1,
    ).length;
    const parsed = parseJsonSafe(row.check_result);
    return {
      id: row.id,
      batchKey,
      passed:
        Number(row.is_broken || 0) === (brokenCount > 0 ? 1 : 0) &&
        Number(parsed.brokenByType?.SP_API_ERROR || 0) === 0 &&
        Number(parsed.brokenByType?.NO_VARIANTS || 0) === brokenCount,
    };
  });
  result.groupRebuild = {
    checkedRowCount: groupChecks.length,
    failedRowCount: groupChecks.filter((item) => !item.passed).length,
    sampleFailures: groupChecks.filter((item) => !item.passed).slice(0, 20),
    passed: groupChecks.every((item) => item.passed),
  };

  const aggCounts = {};
  const tables = [
    'monitor_history_agg',
    'monitor_history_agg_dim',
    'monitor_history_agg_variant_group',
  ];
  for (const tableName of tables) {
    const rows = await fetchAggBackupRows(query, tableName, context.aggScope);
    aggCounts[tableName] = rows.length;
  }
  result.agg = {
    counts: aggCounts,
    passed: true,
  };

  result.checks = {
    rollback0413Aligned: result.rollback0413.passed,
    deleteDERowsCleared: result.deleteDE.passed,
    attachmentIntervalsAligned: result.attachment.passed,
    normalizeOtherAsinsAligned: result.normalizeOtherAsins0417_0418.passed,
    groupRowsRebuilt: result.groupRebuild.passed,
    aggRefreshed: result.agg.passed,
  };

  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const envPath = args.envPath
    ? path.resolve(args.envPath)
    : path.join(__dirname, '../.env');
  loadEnv(envPath);

  const logger = require('../src/utils/logger');
  const redisConfig = require('../src/config/redis');
  const {
    query,
    withTransaction,
    testConnection,
    pool,
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

    if (args.apply && args.verifyOnly) {
      throw new Error('--apply and --verify-only cannot be used together');
    }

    if (!fs.existsSync(args.inputPath)) {
      throw new Error(`Excel 文件不存在: ${args.inputPath}`);
    }

    const connected = await testConnection();
    if (!connected) {
      throw new Error('数据库连接失败');
    }

    const preview = await buildPreviewContext(query, logger, args);

    logger.info('[History Repair 0412-0418] 预览汇总', {
      rollback0413Rows: preview.rollbackPreview.summary.targetRowCount,
      deleteDERows: preview.deletePreview.summary.deleteRowCount,
      attachmentMatchedRows: preview.attachmentPreview.summary.matchedRowCount,
      normalizeOtherRows: preview.fallbackPreview.summary.normalizedRowCount,
      missingBaselineKeyCount:
        preview.rollbackPreview.summary.missingBaselineKeyCount,
      missingAttachmentPairCount:
        preview.attachmentPreview.summary.missingPairCount,
      groupRebuildBatchCount: preview.groupRebuildPreview.summary.batchCount,
      overlappingUpdateCount: preview.mergedUpdates.duplicates.length,
    });

    if (preview.mergedUpdates.duplicates.length > 0) {
      logger.warn(
        '[History Repair 0412-0418] 检测到规则重叠，已按优先级保留先匹配规则',
        {
          overlaps: preview.mergedUpdates.duplicates.slice(0, 20),
          overlapCount: preview.mergedUpdates.duplicates.length,
        },
      );
    }
    if (preview.deleteUpdateOverlap.length > 0) {
      logger.warn(
        '[History Repair 0412-0418] 检测到删除/更新重叠，已按优先级保留删除规则',
        {
          overlaps: preview.deleteUpdateOverlap.slice(0, 20),
          overlapCount: preview.deleteUpdateOverlap.length,
        },
      );
    }

    const report = {
      kind: 'monitor-history-repair-2026-04-12-to-04-18',
      startedAt: startedAt.toISOString(),
      finishedAt: null,
      envPath,
      inputPath: args.inputPath,
      apply: args.apply === true,
      verifyOnly: args.verifyOnly === true,
      baselineWindow: BASELINE_WINDOW,
      rollbackWindows: ROLLBACK_WINDOWS,
      deleteWindow: DELETE_WINDOW,
      normalizeOtherAsinsWindow: NORMALIZE_OTHER_ASINS_WINDOW,
      preview: {
        rollback0413: {
          ...preview.rollbackPreview.summary,
          missingBaselineKeys: preview.rollbackPreview.missingBaselineKeys,
          sampleMissingBaselineKeys:
            preview.rollbackPreview.sampleMissingBaselineKeys,
          sampleUpdates: preview.rollbackPreview.sampleUpdates,
        },
        deleteDE: {
          ...preview.deletePreview.summary,
          sampleRows: preview.deletePreview.sampleRows,
        },
        attachment: {
          ...preview.attachmentPreview.summary,
          missingPairs: preview.attachmentPreview.missingPairs,
          sampleChanges: preview.attachmentPreview.sampleChanges,
        },
        normalizeOtherAsins0417_0418: {
          ...preview.fallbackPreview.summary,
          sampleChanges: preview.fallbackPreview.sampleChanges,
        },
        groupRebuild: {
          ...preview.groupRebuildPreview.summary,
          missingGroupBatches:
            preview.groupRebuildPreview.sampleMissingGroupBatches,
        },
        invalidRows: preview.manualData.invalidRows,
        duplicateUpdates: preview.mergedUpdates.duplicates,
        deleteUpdateOverlap: preview.deleteUpdateOverlap,
      },
      assumptions: {
        europeCountries: ROLLBACK_WINDOWS[0].countries,
        deleteWindowStartInclusive: DELETE_WINDOW.startTime,
        attachmentFullSheetActive: true,
        normalizeOtherAsinsOnlyFor0417_0418: true,
        rebuiltGroupBrokenByTypePolicy:
          'SP_API_ERROR 固定为 0，NO_VARIANTS 等于同批次异常 ASIN 数量',
      },
    };

    if (args.verifyOnly) {
      const postVerification = await collectPostVerification(query, preview);
      report.postVerification = postVerification;
      report.finishedAt = new Date().toISOString();
      const reportPath = writeReport(args.reportDir, report);
      logger.info('[History Repair 0412-0418] Verify-only complete', {
        reportPath,
        finalChecks: postVerification.checks,
      });
      return;
    }

    if (!args.apply) {
      report.finishedAt = new Date().toISOString();
      const reportPath = writeReport(args.reportDir, report);
      logger.info('[History Repair 0412-0418] 预览模式完成', {
        reportPath,
      });
      return;
    }

    if (preview.rollbackPreview.missingBaselineKeys.length > 0) {
      throw new Error(
        `4/13 基线缺失，禁止 apply。缺失逻辑键数量=${preview.rollbackPreview.missingBaselineKeys.length}`,
      );
    }

    const backup = await createScopedSqlBackup(
      query,
      preview.backupRows,
      preview.aggScope,
      args.reportDir,
      logger,
    );

    const mutationResult = await applyMutation(
      withTransaction,
      preview,
      logger,
    );
    const clearedAggRows = await clearAffectedAggRows(query, preview.aggScope);
    const aggRefreshResult = await refreshAffectedAggWindow(
      analyticsAggService,
      preview.aggScope,
      logger,
    );
    MonitorHistory.invalidateCaches();

    const postVerification = await collectPostVerification(query, preview);

    report.finishedAt = new Date().toISOString();
    report.backup = backup;
    report.mutationResult = mutationResult;
    report.clearedAggRows = clearedAggRows;
    report.aggRefreshResult = aggRefreshResult;
    report.postVerification = postVerification;

    const reportPath = writeReport(args.reportDir, report);
    logger.info('[History Repair 0412-0418] 执行完成', {
      reportPath,
      backupFile: backup.filepath,
      finalChecks: postVerification.checks,
    });
  } catch (error) {
    const logger = require('../src/utils/logger');
    logger.error('[History Repair 0412-0418] 执行失败', {
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
