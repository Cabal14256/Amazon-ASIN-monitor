#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { loadEnv } = require('./utils/loadEnv');

const DEFAULT_INPUT_PATH = path.resolve(__dirname, '../../docs/4.19-4.25.xlsx');
const DEFAULT_REPORT_DIR = path.resolve(
  __dirname,
  '../../backups/manual-history-import',
);
let SOURCE_FILENAME = path.basename(DEFAULT_INPUT_PATH);
let REPORT_TAG = buildReportTag(DEFAULT_INPUT_PATH);
const QUERY_CHUNK_SIZE = 80;
const INSERT_CHUNK_SIZE = 250;
const BACKUP_BATCH_SIZE = 200;
const SAMPLE_LIMIT = 20;

function buildReportTag(inputPath) {
  const basename = path.basename(inputPath, path.extname(inputPath));
  return basename.replace(/[^0-9A-Za-z_-]+/g, '-').replace(/^-|-$/g, '');
}

function parseArgs(argv) {
  const args = {
    apply: false,
    help: false,
    envPath: '',
    inputPath: DEFAULT_INPUT_PATH,
    reportDir: DEFAULT_REPORT_DIR,
    maxUpdate: 0,
    sampleLimit: SAMPLE_LIMIT,
  };

  for (const item of argv) {
    if (item === '--apply') {
      args.apply = true;
      continue;
    }
    if (item === '--help' || item === '-h') {
      args.help = true;
      continue;
    }
    if (item.startsWith('--env=')) {
      args.envPath = path.resolve(item.slice('--env='.length).trim());
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
    if (item.startsWith('--max-update=')) {
      const value = Number(item.slice('--max-update='.length).trim());
      if (Number.isFinite(value) && value > 0) {
        args.maxUpdate = Math.floor(value);
      }
      continue;
    }
    if (item.startsWith('--sample-limit=')) {
      const value = Number(item.slice('--sample-limit='.length).trim());
      if (Number.isFinite(value) && value >= 0) {
        args.sampleLimit = Math.floor(value);
      }
    }
  }

  return args;
}

function usage() {
  return [
    '用法:',
    '  node scripts/import-manual-monitor-history-2026-04-19-to-04-25.js',
    '  node scripts/import-manual-monitor-history-2026-04-19-to-04-25.js --apply --max-update=10000',
    '参数:',
    '  --apply             执行备份、覆盖写入、聚合刷新；不带时只生成预览',
    '  --env=...           指定 .env 路径，默认 server/.env',
    '  --input=...         指定 Excel 文件，默认 docs/4.19-4.25.xlsx',
    '  --report-dir=...    指定报告/备份目录',
    '  --max-update=N      apply 模式安全阈值，更新行数超过 N 时中止',
    '  --sample-limit=N    报告样例行数，默认 20',
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

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeAsin(value) {
  return normalizeText(value).toUpperCase();
}

function normalizeCountry(value) {
  return normalizeText(value).toUpperCase();
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatDateTimeParts(year, month, day, hour, minute, second) {
  return `${year}-${pad2(month)}-${pad2(day)} ${pad2(hour)}:${pad2(
    minute,
  )}:${pad2(second)}`;
}

function formatExcelDate(value) {
  if (!value) {
    return '';
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return '';
    }
    return formatDateTimeParts(
      value.getUTCFullYear(),
      value.getUTCMonth() + 1,
      value.getUTCDate(),
      value.getUTCHours(),
      value.getUTCMinutes(),
      value.getUTCSeconds(),
    );
  }

  const raw = normalizeText(value).replace('T', ' ').replace(/\//g, '-');
  if (!raw) {
    return '';
  }
  const match = raw.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/,
  );
  if (!match) {
    return '';
  }
  const [, year, month, day, hour = '0', minute = '0', second = '0'] = match;
  return formatDateTimeParts(
    Number(year),
    Number(month),
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
}

function parseDateTime(value) {
  const formatted = formatExcelDate(value);
  if (!formatted) {
    return null;
  }
  const match = formatted.match(
    /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/,
  );
  if (!match) {
    return null;
  }
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    0,
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '';
  }
  return formatDateTimeParts(
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
  );
}

function floorToDayText(value) {
  const date = parseDateTime(value);
  if (!date) {
    return '';
  }
  date.setHours(0, 0, 0, 0);
  return formatDateTime(date);
}

function endOfDayText(value) {
  const date = parseDateTime(value);
  if (!date) {
    return '';
  }
  date.setHours(23, 59, 59, 0);
  return formatDateTime(date);
}

function buildSuffix() {
  const now = new Date();
  return `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(
    now.getDate(),
  )}_${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
}

function getCellText(cell) {
  const value = cell?.value;
  if (value === null || value === undefined) {
    return '';
  }
  if (value instanceof Date) {
    return formatExcelDate(value);
  }
  if (typeof value === 'object') {
    if (value.text !== undefined) {
      return normalizeText(value.text);
    }
    if (value.result !== undefined) {
      return normalizeText(value.result);
    }
    if (Array.isArray(value.richText)) {
      return value.richText
        .map((part) => part.text || '')
        .join('')
        .trim();
    }
  }
  return normalizeText(value);
}

function getHeaderIndex(headers, names) {
  for (const name of names) {
    const index = headers.findIndex((header) => header === name);
    if (index !== -1) {
      return index + 1;
    }
  }
  return 0;
}

async function parseWorkbook(inputPath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(inputPath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('Excel 文件不包含工作表');
  }

  const headers = [];
  const headerRow = worksheet.getRow(1);
  for (let column = 1; column <= worksheet.columnCount; column++) {
    headers.push(getCellText(headerRow.getCell(column)));
  }

  const indexes = {
    site: getHeaderIndex(headers, ['站点']),
    country: getHeaderIndex(headers, ['国家', '区域']),
    brand: getHeaderIndex(headers, ['品牌']),
    parentGroup: getHeaderIndex(headers, ['父变体']),
    asin: getHeaderIndex(headers, ['ASIN']),
    start: getHeaderIndex(headers, ['被拆时间-以监控为准']),
    reason: getHeaderIndex(headers, ['勿删-未执行原因']),
    end: getHeaderIndex(headers, ['共享时间']),
  };

  const missingColumns = Object.entries(indexes)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missingColumns.length > 0) {
    throw new Error(`Excel 缺少必要列: ${missingColumns.join(', ')}`);
  }

  const intervals = [];
  const invalidRows = [];

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    const country = normalizeCountry(getCellText(row.getCell(indexes.country)));
    const asin = normalizeAsin(getCellText(row.getCell(indexes.asin)));
    const start = formatExcelDate(row.getCell(indexes.start).value);
    const end = formatExcelDate(row.getCell(indexes.end).value);
    const reason = getCellText(row.getCell(indexes.reason));
    const site = getCellText(row.getCell(indexes.site));
    const brand = getCellText(row.getCell(indexes.brand));
    const parentGroup = getCellText(row.getCell(indexes.parentGroup));

    if (!country && !asin && !start && !end) {
      continue;
    }

    const startDate = parseDateTime(start);
    const endDate = parseDateTime(end);
    if (!country || !asin || !startDate || !endDate || startDate >= endDate) {
      invalidRows.push({
        rowNumber,
        country,
        asin,
        start,
        end,
        reason,
        error: 'required_fields_missing_or_invalid_time_range',
      });
      continue;
    }

    intervals.push({
      rowNumber,
      country,
      asin,
      site,
      brand,
      parentGroup,
      start,
      end,
      startDate,
      endDate,
      reason,
    });
  }

  if (intervals.length === 0) {
    throw new Error('Excel 未解析到有效人工记录');
  }

  const pairs = new Map();
  let minStart = intervals[0].startDate;
  let maxEnd = intervals[0].endDate;
  const countryCount = {};

  for (const interval of intervals) {
    const pairKey = `${interval.country}|${interval.asin}`;
    if (!pairs.has(pairKey)) {
      pairs.set(pairKey, {
        country: interval.country,
        asin: interval.asin,
        intervals: [],
      });
    }
    pairs.get(pairKey).intervals.push(interval);
    if (interval.startDate < minStart) {
      minStart = interval.startDate;
    }
    if (interval.endDate > maxEnd) {
      maxEnd = interval.endDate;
    }
    countryCount[interval.country] = (countryCount[interval.country] || 0) + 1;
  }

  return {
    inputPath,
    sheetName: worksheet.name,
    headers,
    intervals,
    invalidRows,
    pairs: Array.from(pairs.values()),
    window: {
      startTime: formatDateTime(minStart),
      endTime: formatDateTime(maxEnd),
    },
    aggRefreshWindow: {
      startTime: floorToDayText(formatDateTime(minStart)),
      endTime: endOfDayText(formatDateTime(maxEnd)),
    },
    countryCount,
  };
}

function buildPairMap(parsed) {
  const map = new Map();
  for (const pair of parsed.pairs) {
    const key = `${pair.country}|${pair.asin}`;
    map.set(
      key,
      pair.intervals.slice().sort((a, b) => a.startDate - b.startDate),
    );
  }
  return map;
}

function rowCheckTimeText(row) {
  return row.check_time_text || formatDateTime(row.check_time);
}

function resolveRowAsin(row) {
  return normalizeAsin(row.asin_code || row.asin || row.matched_asin_code);
}

function findMatchedInterval(row, pairMap) {
  const key = `${normalizeCountry(row.country)}|${resolveRowAsin(row)}`;
  const intervals = pairMap.get(key) || [];
  if (intervals.length === 0) {
    return null;
  }
  const checkDate = parseDateTime(rowCheckTimeText(row));
  if (!checkDate) {
    return null;
  }
  return (
    intervals.find(
      (interval) =>
        checkDate >= interval.startDate && checkDate < interval.endDate,
    ) || null
  );
}

function safeParseJson(value) {
  if (!value) {
    return {};
  }
  if (typeof value === 'object') {
    return { ...value };
  }
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
}

function buildAsinCheckResult(row, afterIsBroken, matchedInterval) {
  const parsed = safeParseJson(row.check_result);
  return JSON.stringify({
    ...parsed,
    asin: parsed.asin || resolveRowAsin(row),
    isBroken: afterIsBroken === 1,
    statusSource:
      afterIsBroken === 1 ? parsed.statusSource || 'NORMAL' : 'NORMAL',
    manualBrokenReason: '',
    manualRepair: {
      source: SOURCE_FILENAME,
      rule: 'attachment_full_sheet',
      matchedInterval: Boolean(matchedInterval),
      intervalStart: matchedInterval?.start || null,
      intervalEnd: matchedInterval?.end || null,
      reason: matchedInterval?.reason || null,
      rowNumber: matchedInterval?.rowNumber || null,
    },
  });
}

function buildGroupCheckResult(row, afterIsBroken, brokenAsins) {
  const parsed = safeParseJson(row.check_result);
  return JSON.stringify({
    ...parsed,
    isBroken: afterIsBroken === 1,
    brokenASINs: afterIsBroken === 1 ? brokenAsins : [],
    manualRepair: {
      source: SOURCE_FILENAME,
      rule: 'group_rebuild_from_attachment',
      childBrokenCount: brokenAsins.length,
    },
  });
}

async function fetchAsinIds(query, pairs) {
  const result = new Map();
  const byCountry = new Map();
  for (const pair of pairs) {
    if (!byCountry.has(pair.country)) {
      byCountry.set(pair.country, []);
    }
    byCountry.get(pair.country).push(pair.asin);
  }

  for (const [country, asins] of byCountry) {
    for (const asinChunk of chunk(
      Array.from(new Set(asins)),
      QUERY_CHUNK_SIZE,
    )) {
      const rows = await query(
        `
          SELECT id, country, asin
          FROM asins
          WHERE country = ?
            AND asin IN (${asinChunk.map(() => '?').join(', ')})
        `,
        [country, ...asinChunk],
      );
      for (const row of rows) {
        result.set(
          `${normalizeCountry(row.country)}|${normalizeAsin(row.asin)}`,
          {
            id: row.id,
            country: normalizeCountry(row.country),
            asin: normalizeAsin(row.asin),
          },
        );
      }
    }
  }

  return result;
}

async function fetchHistoryRows(query, parsed, asinIdMap) {
  const rowMap = new Map();
  const pairsByCountry = new Map();
  for (const pair of parsed.pairs) {
    if (!pairsByCountry.has(pair.country)) {
      pairsByCountry.set(pair.country, []);
    }
    pairsByCountry.get(pair.country).push(pair);
  }

  for (const [country, pairs] of pairsByCountry) {
    const asins = Array.from(new Set(pairs.map((pair) => pair.asin)));
    for (const asinChunk of chunk(asins, QUERY_CHUNK_SIZE)) {
      const rows = await query(
        `
          SELECT
            mh.*,
            DATE_FORMAT(mh.check_time, '%Y-%m-%d %H:%i:%s') AS check_time_text,
            mh.asin_code AS matched_asin_code
          FROM monitor_history mh FORCE INDEX (idx_asin_code_country_check_time)
          WHERE mh.check_type = 'ASIN'
            AND mh.country = ?
            AND mh.asin_code IN (${asinChunk.map(() => '?').join(', ')})
            AND mh.check_time >= ?
            AND mh.check_time <= ?
          ORDER BY mh.check_time ASC, mh.id ASC
        `,
        [country, ...asinChunk, parsed.window.startTime, parsed.window.endTime],
      );
      for (const row of rows) {
        rowMap.set(Number(row.id), row);
      }
    }

    const asinIds = pairs
      .map((pair) => asinIdMap.get(`${country}|${pair.asin}`)?.id)
      .filter(Boolean);
    for (const idChunk of chunk(
      Array.from(new Set(asinIds)),
      QUERY_CHUNK_SIZE,
    )) {
      const rows = await query(
        `
          SELECT
            mh.*,
            DATE_FORMAT(mh.check_time, '%Y-%m-%d %H:%i:%s') AS check_time_text,
            COALESCE(NULLIF(mh.asin_code, ''), a.asin) AS matched_asin_code
          FROM monitor_history mh FORCE INDEX (idx_asin_country_check_time_broken)
          LEFT JOIN asins a ON a.id = mh.asin_id
          WHERE mh.check_type = 'ASIN'
            AND mh.country = ?
            AND mh.asin_id IN (${idChunk.map(() => '?').join(', ')})
            AND mh.check_time >= ?
            AND mh.check_time <= ?
          ORDER BY mh.check_time ASC, mh.id ASC
        `,
        [country, ...idChunk, parsed.window.startTime, parsed.window.endTime],
      );
      for (const row of rows) {
        rowMap.set(Number(row.id), row);
      }
    }
  }

  return Array.from(rowMap.values()).sort((a, b) => {
    const timeDiff =
      parseDateTime(rowCheckTimeText(a)) - parseDateTime(rowCheckTimeText(b));
    if (timeDiff !== 0) {
      return timeDiff;
    }
    return Number(a.id) - Number(b.id);
  });
}

function summarizeAsinUpdates(rows, updates, parsed) {
  const byCountry = {};
  const byAsin = {};
  const byBroken = { normal: 0, broken: 0 };
  const pairWithRows = new Set();

  for (const row of rows) {
    const country = normalizeCountry(row.country);
    const asin = resolveRowAsin(row);
    pairWithRows.add(`${country}|${asin}`);
    byCountry[country] = (byCountry[country] || 0) + 1;
    byAsin[asin] = (byAsin[asin] || 0) + 1;
  }

  for (const update of updates) {
    if (update.isBroken === 1) {
      byBroken.broken += 1;
    } else {
      byBroken.normal += 1;
    }
  }

  const missingPairs = parsed.pairs
    .filter((pair) => !pairWithRows.has(`${pair.country}|${pair.asin}`))
    .map((pair) => ({
      country: pair.country,
      asin: pair.asin,
      intervalCount: pair.intervals.length,
    }));

  return { byCountry, byAsin, byBroken, missingPairs };
}

function buildAsinUpdates(rows, pairMap) {
  return rows.map((row) => {
    const matchedInterval = findMatchedInterval(row, pairMap);
    const isBroken = matchedInterval ? 1 : 0;
    return {
      id: Number(row.id),
      type: 'ASIN',
      country: normalizeCountry(row.country),
      asin: resolveRowAsin(row),
      checkTime: rowCheckTimeText(row),
      variantGroupId: row.variant_group_id || null,
      isBroken,
      notificationSent: isBroken ? 1 : 0,
      checkResult: buildAsinCheckResult(row, isBroken, matchedInterval),
      matchedInterval: matchedInterval
        ? {
            rowNumber: matchedInterval.rowNumber,
            start: matchedInterval.start,
            end: matchedInterval.end,
            reason: matchedInterval.reason,
          }
        : null,
    };
  });
}

function buildGroupKey(row) {
  return [
    normalizeCountry(row.country),
    normalizeText(row.variant_group_id),
    rowCheckTimeText(row),
  ].join('|');
}

async function fetchRowsByGroupKeys(query, keys, checkType) {
  if (!keys.length) {
    return [];
  }

  const rows = [];
  for (const keyChunk of chunk(keys, QUERY_CHUNK_SIZE)) {
    const clauses = [];
    const params = [];
    for (const key of keyChunk) {
      clauses.push(
        '(mh.country = ? AND mh.variant_group_id = ? AND mh.check_time = ?)',
      );
      params.push(key.country, key.variantGroupId, key.checkTime);
    }
    rows.push(
      ...(await query(
        `
          SELECT
            mh.*,
            DATE_FORMAT(mh.check_time, '%Y-%m-%d %H:%i:%s') AS check_time_text
          FROM monitor_history mh
          WHERE mh.check_type = ?
            AND (${clauses.join(' OR ')})
          ORDER BY mh.check_time ASC, mh.id ASC
        `,
        [checkType, ...params],
      )),
    );
  }
  return rows;
}

async function buildGroupUpdates(query, asinRows, asinUpdates) {
  const keyMap = new Map();
  for (const row of asinRows) {
    if (!row.variant_group_id) {
      continue;
    }
    const key = buildGroupKey(row);
    if (!keyMap.has(key)) {
      keyMap.set(key, {
        country: normalizeCountry(row.country),
        variantGroupId: normalizeText(row.variant_group_id),
        checkTime: rowCheckTimeText(row),
      });
    }
  }

  const keys = Array.from(keyMap.values());
  if (keys.length === 0) {
    return { groupRows: [], updates: [], missingGroupKeys: [] };
  }

  const allAsinRows = await fetchRowsByGroupKeys(query, keys, 'ASIN');
  const groupRows = await fetchRowsByGroupKeys(query, keys, 'GROUP');
  const asinUpdateMap = new Map(asinUpdates.map((item) => [item.id, item]));
  const groupState = new Map();

  for (const row of allAsinRows) {
    const key = buildGroupKey(row);
    if (!groupState.has(key)) {
      groupState.set(key, { brokenAsins: [], isBroken: 0 });
    }
    const state = groupState.get(key);
    const update = asinUpdateMap.get(Number(row.id));
    const rowBroken = update
      ? update.isBroken
      : Number(row.is_broken) === 1
      ? 1
      : 0;
    if (rowBroken === 1) {
      state.isBroken = 1;
      state.brokenAsins.push({
        asin: resolveRowAsin(row),
        name: row.asin_name || '',
        statusSource: safeParseJson(row.check_result).statusSource || 'NORMAL',
      });
    }
  }

  const existingGroupKeys = new Set(groupRows.map((row) => buildGroupKey(row)));
  const missingGroupKeys = keys.filter(
    (key) =>
      !existingGroupKeys.has(
        [key.country, key.variantGroupId, key.checkTime].join('|'),
      ),
  );

  const updates = groupRows.map((row) => {
    const state = groupState.get(buildGroupKey(row)) || {
      isBroken: 0,
      brokenAsins: [],
    };
    return {
      id: Number(row.id),
      type: 'GROUP',
      country: normalizeCountry(row.country),
      asin: '',
      checkTime: rowCheckTimeText(row),
      variantGroupId: row.variant_group_id || null,
      isBroken: state.isBroken,
      notificationSent: state.isBroken ? 1 : 0,
      checkResult: buildGroupCheckResult(
        row,
        state.isBroken,
        state.brokenAsins,
      ),
      matchedInterval: null,
    };
  });

  return { groupRows, updates, missingGroupKeys };
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

async function fetchRowsByIds(query, tableName, ids) {
  if (!ids.length) {
    return [];
  }
  const rows = [];
  for (const idChunk of chunk(ids, 500)) {
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

async function fetchAggRows(query, tableName, window) {
  return query(
    `
      SELECT *
      FROM \`${tableName}\`
      WHERE time_slot >= ?
        AND time_slot <= ?
      ORDER BY time_slot ASC
    `,
    [window.startTime, window.endTime],
  );
}

function buildAggRestoreDeleteSql(tableName, window) {
  return [
    `DELETE FROM \`${tableName}\``,
    `WHERE time_slot >= ${escapeSqlValue(window.startTime)}`,
    `  AND time_slot <= ${escapeSqlValue(window.endTime)};`,
    '',
  ].join('\n');
}

async function createBackup(query, updateIds, parsed, reportDir, logger) {
  ensureDir(reportDir);
  const filename = `manual-history-import-backup-${REPORT_TAG}-${buildSuffix()}.sql`;
  const filepath = path.join(reportDir, filename);
  const stream = fs.createWriteStream(filepath, { encoding: 'utf8' });

  try {
    const monitorRows = await fetchRowsByIds(
      query,
      'monitor_history',
      updateIds,
    );
    const aggRows = await fetchAggRows(
      query,
      'monitor_history_agg',
      parsed.aggRefreshWindow,
    );
    const aggDimRows = await fetchAggRows(
      query,
      'monitor_history_agg_dim',
      parsed.aggRefreshWindow,
    );
    const aggVariantRows = await fetchAggRows(
      query,
      'monitor_history_agg_variant_group',
      parsed.aggRefreshWindow,
    );

    await writeSqlChunks(
      stream,
      [
        '-- Scoped SQL backup for manual monitor_history import',
        `-- source: ${SOURCE_FILENAME}`,
        `-- created_at: ${new Date().toISOString()}`,
        `-- raw_update_ids: ${updateIds.length}`,
        `-- agg_window: ${parsed.aggRefreshWindow.startTime} ~ ${parsed.aggRefreshWindow.endTime}`,
        'SET NAMES utf8mb4;',
        'SET FOREIGN_KEY_CHECKS = 0;',
        '',
      ].join('\n'),
    );

    await appendTableBackup(stream, query, 'monitor_history', monitorRows);

    for (const [tableName, rows] of [
      ['monitor_history_agg', aggRows],
      ['monitor_history_agg_dim', aggDimRows],
      ['monitor_history_agg_variant_group', aggVariantRows],
    ]) {
      await writeSqlChunks(
        stream,
        `\n-- restore aggregate window for ${tableName}\n${buildAggRestoreDeleteSql(
          tableName,
          parsed.aggRefreshWindow,
        )}`,
      );
      await appendTableBackup(stream, query, tableName, rows);
    }

    await writeSqlChunks(stream, '\nSET FOREIGN_KEY_CHECKS = 1;\n');

    await new Promise((resolve, reject) => {
      stream.end(() => resolve());
      stream.on('error', reject);
    });

    const stats = fs.statSync(filepath);
    const summary = {
      monitor_history: monitorRows.length,
      monitor_history_agg: aggRows.length,
      monitor_history_agg_dim: aggDimRows.length,
      monitor_history_agg_variant_group: aggVariantRows.length,
    };

    logger.info('[Manual History Import] Scoped SQL 备份完成', {
      filepath,
      size: stats.size,
      summary,
    });

    return {
      filepath,
      filename,
      size: stats.size,
      createdAt: new Date().toISOString(),
      summary,
    };
  } catch (error) {
    stream.destroy();
    try {
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }
    } catch (unlinkError) {
      logger.warn('[Manual History Import] 清理失败备份文件失败', {
        message: unlinkError.message,
      });
    }
    throw error;
  }
}

async function applyUpdates(txQuery, updates) {
  if (updates.length === 0) {
    return 0;
  }

  await txQuery(`
    CREATE TEMPORARY TABLE tmp_manual_history_import_updates (
      id BIGINT PRIMARY KEY,
      is_broken TINYINT(1) NOT NULL,
      check_result MEDIUMTEXT NULL,
      notification_sent TINYINT(1) NOT NULL
    ) ENGINE=InnoDB
  `);

  for (const updateChunk of chunk(updates, INSERT_CHUNK_SIZE)) {
    const placeholders = updateChunk.map(() => '(?, ?, ?, ?)').join(', ');
    const params = [];
    for (const update of updateChunk) {
      params.push(
        update.id,
        update.isBroken,
        update.checkResult,
        update.notificationSent,
      );
    }
    await txQuery(
      `
        INSERT INTO tmp_manual_history_import_updates
          (id, is_broken, check_result, notification_sent)
        VALUES ${placeholders}
      `,
      params,
    );
  }

  const result = await txQuery(`
    UPDATE monitor_history mh
    JOIN tmp_manual_history_import_updates t ON t.id = mh.id
    SET
      mh.is_broken = t.is_broken,
      mh.check_result = t.check_result,
      mh.notification_sent = t.notification_sent
  `);

  return Number(result?.affectedRows || 0);
}

async function refreshAgg(parsed, logger) {
  const analyticsAggService = require('../src/services/analyticsAggService');
  const analyticsCacheService = require('../src/services/analyticsCacheService');
  const options = {
    startTime: parsed.aggRefreshWindow.startTime,
    endTime: parsed.aggRefreshWindow.endTime,
  };

  const result = {
    hour: await analyticsAggService.refreshAnalyticsAggBundle('hour', options),
    day: await analyticsAggService.refreshAnalyticsAggBundle('day', options),
  };

  await analyticsCacheService.deleteByPrefix('statisticsByTime:');
  await analyticsCacheService.deleteByPrefix('allCountriesSummary:');
  await analyticsCacheService.deleteByPrefix('regionSummary:');
  await analyticsCacheService.deleteByPrefix('periodSummary:');
  await analyticsCacheService.deleteByPrefix('asinStatisticsByCountry:');
  await analyticsCacheService.deleteByPrefix('asinStatisticsByVariantGroup:');

  logger.info('[Manual History Import] 聚合刷新完成', {
    options,
    result,
  });

  return result;
}

function writeReport(reportDir, payload, mode) {
  ensureDir(reportDir);
  const reportPath = path.join(
    reportDir,
    `manual-history-import-${mode}-report-${REPORT_TAG}-${buildSuffix()}.json`,
  );
  fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2), 'utf8');
  return reportPath;
}

async function verifyImport(query, parsed, pairMap) {
  const rows = await fetchHistoryRows(query, parsed, new Map());
  let matchedBroken = 0;
  let outsideNormal = 0;
  let mismatchCount = 0;
  const mismatches = [];

  for (const row of rows) {
    const matchedInterval = findMatchedInterval(row, pairMap);
    const expectedBroken = matchedInterval ? 1 : 0;
    const actualBroken = Number(row.is_broken) === 1 ? 1 : 0;
    if (expectedBroken === 1 && actualBroken === 1) {
      matchedBroken += 1;
    }
    if (expectedBroken === 0 && actualBroken === 0) {
      outsideNormal += 1;
    }
    if (expectedBroken !== actualBroken) {
      mismatchCount += 1;
      if (mismatches.length < SAMPLE_LIMIT) {
        mismatches.push({
          id: row.id,
          country: row.country,
          asin: resolveRowAsin(row),
          checkTime: rowCheckTimeText(row),
          expectedBroken,
          actualBroken,
        });
      }
    }
  }

  return {
    checkedRows: rows.length,
    matchedBroken,
    outsideNormal,
    mismatchCount,
    sampleMismatches: mismatches,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const envPath = args.envPath
    ? path.resolve(args.envPath)
    : path.resolve(__dirname, '../.env');
  SOURCE_FILENAME = path.basename(args.inputPath);
  REPORT_TAG = buildReportTag(args.inputPath);
  loadEnv(envPath);

  const logger = require('../src/utils/logger');

  if (args.help) {
    logger.info(usage());
    return;
  }

  const { query, withTransaction, pool } = require('../src/config/database');
  const MonitorHistory = require('../src/models/MonitorHistory');
  const redisConfig = require('../src/config/redis');

  try {
    await query("SET time_zone = '+08:00'");
    const parsed = await parseWorkbook(args.inputPath);
    const pairMap = buildPairMap(parsed);
    const asinIdMap = await fetchAsinIds(query, parsed.pairs);
    const asinRows = await fetchHistoryRows(query, parsed, asinIdMap);
    const asinUpdates = buildAsinUpdates(asinRows, pairMap);
    const groupContext = await buildGroupUpdates(query, asinRows, asinUpdates);
    const updates = [...asinUpdates, ...groupContext.updates];
    const summary = summarizeAsinUpdates(asinRows, asinUpdates, parsed);
    const sampleUpdates = updates.slice(0, args.sampleLimit).map((item) => ({
      id: item.id,
      type: item.type,
      country: item.country,
      asin: item.asin,
      checkTime: item.checkTime,
      variantGroupId: item.variantGroupId,
      afterIsBroken: item.isBroken,
      matchedInterval: item.matchedInterval,
    }));

    const baseReport = {
      kind: `manual-monitor-history-import-${REPORT_TAG}`,
      mode: args.apply ? 'apply' : 'preview',
      generatedAt: new Date().toISOString(),
      envPath,
      inputPath: args.inputPath,
      sheetName: parsed.sheetName,
      source: SOURCE_FILENAME,
      window: parsed.window,
      aggRefreshWindow: parsed.aggRefreshWindow,
      excel: {
        effectiveRowCount: parsed.intervals.length,
        pairCount: parsed.pairs.length,
        countryCount: parsed.countryCount,
        invalidRowCount: parsed.invalidRows.length,
        invalidRows: parsed.invalidRows,
      },
      preview: {
        existingAsinRowCount: asinRows.length,
        matchedAsinRowCount: asinUpdates.filter((item) => item.isBroken === 1)
          .length,
        normalAsinRowCount: asinUpdates.filter((item) => item.isBroken === 0)
          .length,
        groupRowCount: groupContext.groupRows.length,
        groupUpdateCount: groupContext.updates.length,
        totalUpdateCount: updates.length,
        missingPairCount: summary.missingPairs.length,
        missingPairs: summary.missingPairs,
        missingGroupKeyCount: groupContext.missingGroupKeys.length,
        missingGroupKeys: groupContext.missingGroupKeys.slice(0, 50),
        summary: {
          byCountry: summary.byCountry,
          byBroken: summary.byBroken,
          topAsins: Object.entries(summary.byAsin)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 50)
            .map(([asin, count]) => ({ asin, count })),
        },
        sampleUpdates,
      },
    };

    logger.info('[Manual History Import] 预览完成', {
      effectiveRowCount: parsed.intervals.length,
      pairCount: parsed.pairs.length,
      existingAsinRowCount: asinRows.length,
      matchedAsinRowCount: baseReport.preview.matchedAsinRowCount,
      groupUpdateCount: groupContext.updates.length,
      totalUpdateCount: updates.length,
      missingPairCount: summary.missingPairs.length,
    });

    if (!args.apply) {
      const reportPath = writeReport(args.reportDir, baseReport, 'preview');
      logger.info('[Manual History Import] 预览模式完成，未写入数据库', {
        reportPath,
      });
      return;
    }

    if (updates.length === 0) {
      throw new Error('没有可覆盖的历史记录，已中止 apply');
    }
    if (args.maxUpdate > 0 && updates.length > args.maxUpdate) {
      throw new Error(
        `待更新 ${updates.length} 行，超过 --max-update=${args.maxUpdate}，已中止`,
      );
    }

    const updateIds = Array.from(new Set(updates.map((item) => item.id))).sort(
      (a, b) => a - b,
    );
    const backup = await createBackup(
      query,
      updateIds,
      parsed,
      args.reportDir,
      logger,
    );

    const mutationResult = await withTransaction(async ({ query: txQuery }) => {
      await txQuery("SET time_zone = '+08:00'");
      const affectedRows = await applyUpdates(txQuery, updates);
      return { affectedRows };
    });

    MonitorHistory.invalidateCaches();
    const aggRefreshResult = await refreshAgg(parsed, logger);
    const verify = await verifyImport(query, parsed, pairMap);

    const report = {
      ...baseReport,
      backup,
      mutationResult,
      aggRefreshResult,
      verify,
      finishedAt: new Date().toISOString(),
    };
    const reportPath = writeReport(args.reportDir, report, 'apply');
    logger.info('[Manual History Import] 执行完成', {
      reportPath,
      backupFile: backup.filepath,
      affectedRows: mutationResult.affectedRows,
      verify,
    });
  } finally {
    try {
      await redisConfig.closeRedis();
    } catch (error) {
      const logger = require('../src/utils/logger');
      logger.warn('[Manual History Import] 关闭 Redis 失败', {
        message: error.message,
      });
    }
    await pool.end();
  }
}

main().catch((error) => {
  const logger = require('../src/utils/logger');
  logger.error('[Manual History Import] 执行失败', {
    message: error.message,
  });
  process.exitCode = 1;
});
