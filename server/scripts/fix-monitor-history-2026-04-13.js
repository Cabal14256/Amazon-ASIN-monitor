#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { loadEnv } = require('./utils/loadEnv');

const DEFAULT_INPUT_PATH = String.raw`c:\Users\Admin\Downloads\0405-0413手动记录.xlsx`;
const DEFAULT_REPORT_DIR = path.resolve(__dirname, '../../backups');
const REQUIRED_HEADERS = [
  '国家',
  'ASIN',
  '被拆时间-以监控为准',
  '共享时间',
  '勿删-未执行原因',
];
const APPLY_BATCH_SIZE = 200;
const TEMP_PAIR_BATCH_SIZE = 200;
const BACKUP_TABLES = [
  'monitor_history',
  'monitor_history_agg',
  'monitor_history_agg_dim',
  'monitor_history_agg_variant_group',
];
const RAW_WINDOW = {
  startTime: '2026-03-24 00:00:00',
  endTime: '2026-04-13 10:00:00',
};
const AGG_WINDOW = {
  hourStart: '2026-03-24 00:00:00',
  hourEnd: '2026-04-13 10:00:00',
  dayStart: '2026-03-24 00:00:00',
  dayEnd: '2026-04-13 00:00:00',
};
const E_GROUP_CUTOFF = '2026-04-10 00:00:00';
const EXPECTED_GROUPS = {
  L: {
    key: 'L',
    country: 'US',
    site: '16',
    brand: 'JavoYion',
    name: '16-JavoYion-L',
    id: '2d00d2fa-111e-4bce-8e67-3af166da9d46',
  },
  E: {
    key: 'E',
    country: 'US',
    site: '16',
    brand: 'JavoYion',
    name: '16-JavoYion-E',
    id: '75ede0db-388c-4756-9d89-40d6f8fcff72',
  },
};

function parseArgs(argv) {
  const args = {
    help: false,
    apply: false,
    inputPath: DEFAULT_INPUT_PATH,
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
    }
  }

  return args;
}

function usage() {
  return [
    '用法:',
    '  node scripts/fix-monitor-history-2026-04-13.js --apply',
    '参数:',
    '  --apply                 执行备份、历史删除、手工替换、聚合修复',
    `  --input=...             指定 Excel 文件路径（默认 ${DEFAULT_INPUT_PATH}）`,
    '  --report-dir=...        指定报告输出目录（默认 backups/）',
    '  --env=...               指定 .env 文件路径（默认 server/.env）',
  ].join('\n');
}

function chunk(array, size) {
  const result = [];
  for (let index = 0; index < array.length; index += size) {
    result.push(array.slice(index, index + size));
  }
  return result;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
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

function pairKey(country, asinCode) {
  return `${country}::${asinCode}`;
}

function parsePairKey(key) {
  const divider = String(key).indexOf('::');
  return {
    country: String(key).slice(0, divider),
    asinCode: String(key).slice(divider + 2),
  };
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

function sortIntervals(intervals) {
  return intervals
    .slice()
    .sort((left, right) => left.start.getTime() - right.start.getTime());
}

function findMatchedInterval(intervals, checkTime) {
  if (!checkTime) {
    return null;
  }
  const timeValue = checkTime.getTime();
  for (const interval of intervals) {
    const startValue = interval.start.getTime();
    const endValue = interval.end.getTime();
    if (timeValue >= startValue && timeValue < endValue) {
      return interval;
    }
  }
  return null;
}

function parseJsonSafe(text) {
  if (!text) {
    return {};
  }
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
}

function buildPatchedCheckResult(
  row,
  desiredBroken,
  matchedInterval,
  sourceFile,
) {
  const parsed = parseJsonSafe(row.check_result);
  const next = { ...parsed };
  next.asin = next.asin || row.asin_code || null;
  next.isBroken = desiredBroken;
  next.manualRepair = {
    source: path.basename(sourceFile),
    matchedInterval: Boolean(matchedInterval),
    intervalStart: matchedInterval ? matchedInterval.startText : null,
    intervalEnd: matchedInterval ? matchedInterval.endText : null,
    reason: matchedInterval ? matchedInterval.reason || null : null,
  };
  return JSON.stringify(next);
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
  let startTime = null;
  let endTime = null;

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const country = normalizeText(readCellValue(row, headerMap, '国家'))
      .trim()
      .toUpperCase();
    const asinCode = normalizeText(readCellValue(row, headerMap, 'ASIN'))
      .trim()
      .toUpperCase();
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

    if (!startTime || start.getTime() < startTime.getTime()) {
      startTime = start;
    }
    if (!endTime || end.getTime() > endTime.getTime()) {
      endTime = end;
    }

    effectiveRowCount += 1;
    countryCount.set(country, (countryCount.get(country) || 0) + 1);
  }

  for (const [key, intervals] of intervalsByPair.entries()) {
    intervalsByPair.set(key, sortIntervals(intervals));
  }

  const pairKeys = Array.from(intervalsByPair.keys()).sort();
  if (pairKeys.length === 0 || !startTime || !endTime) {
    throw new Error('Excel 中没有可用于替换的有效区间');
  }

  const summary = {
    inputPath,
    sheetName: worksheet.name,
    effectiveRowCount,
    invalidRowCount: invalidRows.length,
    pairCount: pairKeys.length,
    countryCount: Object.fromEntries(countryCount),
    startTime: formatDateTime(startTime),
    endTime: formatDateTime(endTime),
  };

  logger.info('[History Fix] Excel 解析完成', summary);

  return {
    inputPath,
    sheetName: worksheet.name,
    effectiveRowCount,
    invalidRows,
    intervalsByPair,
    pairKeys,
    startTime,
    endTime,
    countryCount: Object.fromEntries(countryCount),
    summary,
  };
}

function buildTempPairsInsertSql(batch) {
  const placeholders = batch.map(() => '(?, ?)').join(', ');
  const params = [];
  for (const item of batch) {
    params.push(item.country, item.asinCode);
  }
  return {
    sql: `INSERT INTO tmp_history_fix_pairs (country, asin_code) VALUES ${placeholders}`,
    params,
  };
}

async function populateTempPairsTable(queryExecutor, pairKeys) {
  await queryExecutor(`
    CREATE TEMPORARY TABLE tmp_history_fix_pairs (
      country VARCHAR(10) NOT NULL,
      asin_code VARCHAR(50) NOT NULL,
      PRIMARY KEY (country, asin_code)
    ) ENGINE=InnoDB
  `);

  const pairEntries = pairKeys.map((key) => parsePairKey(key));
  for (const batch of chunk(pairEntries, TEMP_PAIR_BATCH_SIZE)) {
    const { sql, params } = buildTempPairsInsertSql(batch);
    await queryExecutor(sql, params);
  }
}

function buildSampleRef(row) {
  if (!row) {
    return null;
  }
  return {
    country: row.country,
    asinKey: row.asin_key,
    variantGroupId: row.variant_group_id || null,
    site: row.site || '',
    brand: row.brand || '',
    hourSlot: row.hour_slot,
    daySlot: row.day_slot,
    checkTime: row.check_time,
  };
}

async function buildManualChangePreview(
  getConnection,
  createQueryExecutor,
  manualData,
  excludedGroupIds,
  expectedGroups,
) {
  const connection = await getConnection();
  const connectionQuery = createQueryExecutor(connection);

  try {
    await populateTempPairsTable(connectionQuery, manualData.pairKeys);

    const existingRows = await connectionQuery(
      `
        SELECT
          mh.id,
          mh.asin_code,
          mh.country,
          mh.is_broken,
          mh.check_result,
          mh.variant_group_id,
          mh.variant_group_name,
          mh.asin_id,
          mh.site_snapshot,
          mh.brand_snapshot,
          DATE_FORMAT(mh.check_time, '%Y-%m-%d %H:%i:%s') AS check_time
        FROM monitor_history mh
        INNER JOIN tmp_history_fix_pairs p
          ON p.country = mh.country
         AND p.asin_code = mh.asin_code
        WHERE mh.check_type = 'ASIN'
          AND mh.check_time >= ?
          AND mh.check_time <= ?
        ORDER BY mh.country ASC, mh.asin_code ASC, mh.check_time ASC, mh.id ASC
      `,
      [
        formatDateTime(manualData.startTime),
        formatDateTime(manualData.endTime),
      ],
    );

    const changes = [];
    const missingPairSet = new Set(manualData.pairKeys);
    const excludedRows = [];

    for (const row of existingRows) {
      const key = pairKey(row.country, row.asin_code);
      missingPairSet.delete(key);

      const checkTime = parseDateTimeInput(row.check_time);
      const intervals = manualData.intervalsByPair.get(key) || [];
      const matchedInterval = findMatchedInterval(intervals, checkTime);
      const desiredBroken = Boolean(matchedInterval);
      const currentBroken = Number(row.is_broken) === 1;

      if (excludedGroupIds.has(row.variant_group_id || '')) {
        if (currentBroken !== desiredBroken) {
          excludedRows.push({
            id: row.id,
            country: row.country,
            asinCode: row.asin_code,
            checkTime: row.check_time,
            variantGroupId: row.variant_group_id || null,
            beforeIsBroken: currentBroken ? 1 : 0,
            afterIsBroken: desiredBroken ? 1 : 0,
          });
        }
        continue;
      }

      if (currentBroken === desiredBroken) {
        continue;
      }

      changes.push({
        id: row.id,
        country: row.country,
        asinCode: row.asin_code,
        checkTime: row.check_time,
        variantGroupId: row.variant_group_id || null,
        beforeIsBroken: currentBroken ? 1 : 0,
        afterIsBroken: desiredBroken ? 1 : 0,
        beforeCheckResult: row.check_result,
        afterCheckResult: buildPatchedCheckResult(
          row,
          desiredBroken,
          matchedInterval,
          manualData.inputPath,
        ),
      });
    }

    const deletedEsSampleRows = await connectionQuery(
      `
        SELECT
          mh.country,
          COALESCE(NULLIF(mh.asin_code, ''), CONCAT('ID#', mh.asin_id)) AS asin_key,
          mh.variant_group_id,
          COALESCE(mh.site_snapshot, '') AS site,
          COALESCE(mh.brand_snapshot, '') AS brand,
          DATE_FORMAT(mh.check_time, '%Y-%m-%d %H:%i:%s') AS check_time,
          DATE_FORMAT(mh.hour_ts, '%Y-%m-%d %H:%i:%s') AS hour_slot,
          DATE_FORMAT(mh.day_ts, '%Y-%m-%d %H:%i:%s') AS day_slot
        FROM monitor_history mh
        WHERE mh.check_type = 'ASIN'
          AND mh.country = 'ES'
          AND mh.check_time >= ?
          AND mh.check_time <= ?
        ORDER BY mh.check_time ASC, mh.id ASC
        LIMIT 1
      `,
      [RAW_WINDOW.startTime, RAW_WINDOW.endTime],
    );

    const deletedLGroupSampleRows = await connectionQuery(
      `
        SELECT
          mh.country,
          COALESCE(NULLIF(mh.asin_code, ''), CONCAT('ID#', mh.asin_id)) AS asin_key,
          mh.variant_group_id,
          COALESCE(mh.site_snapshot, '') AS site,
          COALESCE(mh.brand_snapshot, '') AS brand,
          DATE_FORMAT(mh.check_time, '%Y-%m-%d %H:%i:%s') AS check_time,
          DATE_FORMAT(mh.hour_ts, '%Y-%m-%d %H:%i:%s') AS hour_slot,
          DATE_FORMAT(mh.day_ts, '%Y-%m-%d %H:%i:%s') AS day_slot
        FROM monitor_history mh
        WHERE mh.check_type = 'ASIN'
          AND mh.variant_group_id = ?
        ORDER BY mh.check_time ASC, mh.id ASC
        LIMIT 1
      `,
      [expectedGroups.L.id],
    );

    const unaffectedSampleRows = await connectionQuery(
      `
        SELECT
          mh.country,
          COALESCE(NULLIF(mh.asin_code, ''), CONCAT('ID#', mh.asin_id)) AS asin_key,
          mh.variant_group_id,
          COALESCE(mh.site_snapshot, '') AS site,
          COALESCE(mh.brand_snapshot, '') AS brand,
          DATE_FORMAT(mh.check_time, '%Y-%m-%d %H:%i:%s') AS check_time,
          DATE_FORMAT(mh.hour_ts, '%Y-%m-%d %H:%i:%s') AS hour_slot,
          DATE_FORMAT(mh.day_ts, '%Y-%m-%d %H:%i:%s') AS day_slot
        FROM monitor_history mh
        LEFT JOIN tmp_history_fix_pairs p
          ON p.country = mh.country
         AND p.asin_code = mh.asin_code
        WHERE mh.check_type = 'ASIN'
          AND mh.check_time >= ?
          AND mh.check_time <= ?
          AND mh.country <> 'ES'
          AND p.country IS NULL
          AND mh.variant_group_id IS NOT NULL
          AND mh.variant_group_id NOT IN (?, ?)
        ORDER BY mh.check_time ASC, mh.id ASC
        LIMIT 1
      `,
      [
        RAW_WINDOW.startTime,
        RAW_WINDOW.endTime,
        expectedGroups.L.id,
        expectedGroups.E.id,
      ],
    );

    return {
      rowsExamined: existingRows.length,
      changes,
      missingPairs: Array.from(missingPairSet).map((key) => parsePairKey(key)),
      excludedRows,
      sampleRefs: {
        deletedEs: buildSampleRef(deletedEsSampleRows[0]),
        deletedLGroup: buildSampleRef(deletedLGroupSampleRows[0]),
        unaffected: buildSampleRef(unaffectedSampleRows[0]),
      },
    };
  } finally {
    connection.release();
  }
}

async function fetchCountSummary(query, sql, params = []) {
  const rows = await query(sql, params);
  const summary = {
    total: 0,
    byType: {},
  };

  for (const row of rows) {
    const count = Number(row.cnt || 0);
    summary.total += count;
    summary.byType[row.check_type || 'UNKNOWN'] = count;
  }

  return summary;
}

async function validateExpectedGroups(query, logger) {
  const resolved = {};

  for (const item of Object.values(EXPECTED_GROUPS)) {
    const rows = await query(
      `
        SELECT id, name, country, site, brand
        FROM variant_groups
        WHERE country = ?
          AND site = ?
          AND brand = ?
          AND name = ?
        ORDER BY create_time ASC
      `,
      [item.country, item.site, item.brand, item.name],
    );

    if (rows.length !== 1) {
      throw new Error(
        `目标变体组校验失败: ${item.name} 命中 ${rows.length} 条记录`,
      );
    }

    if (rows[0].id !== item.id) {
      throw new Error(
        `目标变体组校验失败: ${item.name} 期望 ${item.id}，实际 ${rows[0].id}`,
      );
    }

    resolved[item.key] = rows[0];
  }

  logger.info('[History Fix] 目标变体组校验通过', resolved);
  return resolved;
}

async function collectBaseline(query, expectedGroups) {
  const spainWindow = await fetchCountSummary(
    query,
    `
      SELECT check_type, COUNT(*) AS cnt
      FROM monitor_history
      WHERE country = 'ES'
        AND check_time >= ?
        AND check_time <= ?
      GROUP BY check_type
    `,
    [RAW_WINDOW.startTime, RAW_WINDOW.endTime],
  );

  const lGroupAll = await fetchCountSummary(
    query,
    `
      SELECT check_type, COUNT(*) AS cnt
      FROM monitor_history
      WHERE variant_group_id = ?
      GROUP BY check_type
    `,
    [expectedGroups.L.id],
  );

  const eGroupBefore = await fetchCountSummary(
    query,
    `
      SELECT check_type, COUNT(*) AS cnt
      FROM monitor_history
      WHERE variant_group_id = ?
        AND check_time < ?
      GROUP BY check_type
    `,
    [expectedGroups.E.id, E_GROUP_CUTOFF],
  );

  const eGroupAfter = await fetchCountSummary(
    query,
    `
      SELECT check_type, COUNT(*) AS cnt
      FROM monitor_history
      WHERE variant_group_id = ?
        AND check_time >= ?
      GROUP BY check_type
    `,
    [expectedGroups.E.id, E_GROUP_CUTOFF],
  );

  return {
    spainWindow,
    lGroupAll,
    eGroupBefore,
    eGroupAfter,
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

async function getBackupableColumns(query, tableName) {
  const rows = await query(`SHOW COLUMNS FROM \`${tableName}\``);
  return rows
    .filter(
      (row) =>
        !String(row.Extra || '')
          .toUpperCase()
          .includes('GENERATED'),
    )
    .map((row) => row.Field);
}

function dedupeRowsById(rows = []) {
  const map = new Map();
  for (const row of rows) {
    map.set(row.id, row);
  }
  return Array.from(map.values());
}

async function fetchMonitorHistoryBackupRows(query, preview, expectedGroups) {
  const deletedRows = await query(
    `
      SELECT *
      FROM monitor_history
      WHERE (country = 'ES' AND check_time >= ? AND check_time <= ?)
         OR variant_group_id = ?
         OR (variant_group_id = ? AND check_time < ?)
    `,
    [
      RAW_WINDOW.startTime,
      RAW_WINDOW.endTime,
      expectedGroups.L.id,
      expectedGroups.E.id,
      E_GROUP_CUTOFF,
    ],
  );

  const existing = new Map();
  for (const row of deletedRows) {
    existing.set(row.id, row);
  }

  const missingUpdateIds = preview.changes
    .map((item) => item.id)
    .filter((id) => !existing.has(id));

  for (const batch of chunk(missingUpdateIds, 1000)) {
    if (batch.length === 0) {
      continue;
    }
    const placeholders = batch.map(() => '?').join(', ');
    const rows = await query(
      `SELECT * FROM monitor_history WHERE id IN (${placeholders})`,
      batch,
    );
    for (const row of rows) {
      existing.set(row.id, row);
    }
  }

  return dedupeRowsById(Array.from(existing.values()));
}

async function fetchAggBackupRows(query, tableName) {
  return query(
    `
      SELECT *
      FROM \`${tableName}\`
      WHERE (granularity = 'hour' AND time_slot >= ? AND time_slot <= ?)
         OR (granularity = 'day' AND time_slot >= ? AND time_slot <= ?)
      ORDER BY granularity ASC, time_slot ASC
    `,
    [
      AGG_WINDOW.hourStart,
      AGG_WINDOW.hourEnd,
      AGG_WINDOW.dayStart,
      AGG_WINDOW.dayEnd,
    ],
  );
}

async function writeSqlChunks(stream, text) {
  if (stream.write(text)) {
    return;
  }
  await new Promise((resolve) => stream.once('drain', resolve));
}

async function appendTableBackup(stream, query, tableName, rows) {
  const columns = await getBackupableColumns(query, tableName);
  await writeSqlChunks(stream, `\n-- ${tableName}\n-- rows: ${rows.length}\n`);

  if (rows.length === 0) {
    return;
  }

  const batchSize = 100;
  const columnSql = columns.map((column) => `\`${column}\``).join(', ');
  for (const batch of chunk(rows, batchSize)) {
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

async function createScopedSqlBackup(
  query,
  preview,
  expectedGroups,
  reportDir,
  logger,
) {
  ensureDir(reportDir);
  const filename = `history-fix-backup-${buildBackupSuffix()}.sql`;
  const filepath = path.join(reportDir, filename);
  const stream = fs.createWriteStream(filepath, { encoding: 'utf8' });

  try {
    const monitorHistoryRows = await fetchMonitorHistoryBackupRows(
      query,
      preview,
      expectedGroups,
    );
    const aggRows = await fetchAggBackupRows(query, 'monitor_history_agg');
    const aggDimRows = await fetchAggBackupRows(
      query,
      'monitor_history_agg_dim',
    );
    const aggVariantRows = await fetchAggBackupRows(
      query,
      'monitor_history_agg_variant_group',
    );

    await writeSqlChunks(
      stream,
      [
        '-- Scoped SQL backup for 2026-04-13 history fix',
        `-- created_at: ${new Date().toISOString()}`,
        '-- scope: all rows/time-slots mutated by this execution',
        'SET NAMES utf8mb4;',
        'SET FOREIGN_KEY_CHECKS = 0;',
        '',
      ].join('\n'),
    );

    await appendTableBackup(
      stream,
      query,
      'monitor_history',
      monitorHistoryRows,
    );
    await appendTableBackup(stream, query, 'monitor_history_agg', aggRows);
    await appendTableBackup(
      stream,
      query,
      'monitor_history_agg_dim',
      aggDimRows,
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
      monitor_history: monitorHistoryRows.length,
      monitor_history_agg: aggRows.length,
      monitor_history_agg_dim: aggDimRows.length,
      monitor_history_agg_variant_group: aggVariantRows.length,
    };
    logger.info('[History Fix] Scoped SQL 备份完成', {
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

async function createManualUpdateTempTable(queryExecutor, changes) {
  await queryExecutor(`
    CREATE TEMPORARY TABLE tmp_history_fix_manual_updates (
      id BIGINT PRIMARY KEY,
      is_broken TINYINT(1) NOT NULL,
      check_result TEXT NULL
    ) ENGINE=InnoDB
  `);

  for (const batch of chunk(changes, APPLY_BATCH_SIZE)) {
    const placeholders = batch.map(() => '(?, ?, ?)').join(', ');
    const params = [];
    for (const item of batch) {
      params.push(item.id, item.afterIsBroken, item.afterCheckResult);
    }

    await queryExecutor(
      `
        INSERT INTO tmp_history_fix_manual_updates
          (id, is_broken, check_result)
        VALUES ${placeholders}
      `,
      params,
    );
  }
}

async function applyMonitorHistoryMutation(
  withTransaction,
  changeSet,
  expectedGroups,
) {
  return withTransaction(async ({ query }) => {
    const spainDeleteResult = await query(
      `
        DELETE FROM monitor_history
        WHERE country = 'ES'
          AND check_time >= ?
          AND check_time <= ?
      `,
      [RAW_WINDOW.startTime, RAW_WINDOW.endTime],
    );

    const lGroupDeleteResult = await query(
      `DELETE FROM monitor_history WHERE variant_group_id = ?`,
      [expectedGroups.L.id],
    );

    const eGroupDeleteResult = await query(
      `
        DELETE FROM monitor_history
        WHERE variant_group_id = ?
          AND check_time < ?
      `,
      [expectedGroups.E.id, E_GROUP_CUTOFF],
    );

    let manualUpdateAffectedRows = 0;
    if (changeSet.length > 0) {
      await createManualUpdateTempTable(query, changeSet);
      const updateResult = await query(`
        UPDATE monitor_history mh
        INNER JOIN tmp_history_fix_manual_updates u
          ON u.id = mh.id
        SET
          mh.is_broken = u.is_broken,
          mh.check_result = u.check_result
        WHERE mh.check_type = 'ASIN'
      `);
      manualUpdateAffectedRows = Number(updateResult?.affectedRows || 0);
    }

    return {
      spainDeletedRows: Number(spainDeleteResult?.affectedRows || 0),
      lGroupDeletedRows: Number(lGroupDeleteResult?.affectedRows || 0),
      eGroupDeletedRowsBeforeCutoff: Number(
        eGroupDeleteResult?.affectedRows || 0,
      ),
      manualUpdatedRows: manualUpdateAffectedRows,
    };
  });
}

async function clearAggWindow(query) {
  const statements = [
    {
      key: 'monitor_history_agg.hour',
      sql: `
        DELETE FROM monitor_history_agg
        WHERE granularity = 'hour'
          AND time_slot >= ?
          AND time_slot <= ?
      `,
      params: [AGG_WINDOW.hourStart, AGG_WINDOW.hourEnd],
    },
    {
      key: 'monitor_history_agg.day',
      sql: `
        DELETE FROM monitor_history_agg
        WHERE granularity = 'day'
          AND time_slot >= ?
          AND time_slot <= ?
      `,
      params: [AGG_WINDOW.dayStart, AGG_WINDOW.dayEnd],
    },
    {
      key: 'monitor_history_agg_dim.hour',
      sql: `
        DELETE FROM monitor_history_agg_dim
        WHERE granularity = 'hour'
          AND time_slot >= ?
          AND time_slot <= ?
      `,
      params: [AGG_WINDOW.hourStart, AGG_WINDOW.hourEnd],
    },
    {
      key: 'monitor_history_agg_dim.day',
      sql: `
        DELETE FROM monitor_history_agg_dim
        WHERE granularity = 'day'
          AND time_slot >= ?
          AND time_slot <= ?
      `,
      params: [AGG_WINDOW.dayStart, AGG_WINDOW.dayEnd],
    },
    {
      key: 'monitor_history_agg_variant_group.hour',
      sql: `
        DELETE FROM monitor_history_agg_variant_group
        WHERE granularity = 'hour'
          AND time_slot >= ?
          AND time_slot <= ?
      `,
      params: [AGG_WINDOW.hourStart, AGG_WINDOW.hourEnd],
    },
    {
      key: 'monitor_history_agg_variant_group.day',
      sql: `
        DELETE FROM monitor_history_agg_variant_group
        WHERE granularity = 'day'
          AND time_slot >= ?
          AND time_slot <= ?
      `,
      params: [AGG_WINDOW.dayStart, AGG_WINDOW.dayEnd],
    },
  ];

  const result = {};
  for (const item of statements) {
    const queryResult = await query(item.sql, item.params);
    result[item.key] = Number(queryResult?.affectedRows || 0);
  }
  return result;
}

async function refreshAggWindow(analyticsAggService) {
  const options = {
    startTime: RAW_WINDOW.startTime,
    endTime: RAW_WINDOW.endTime,
  };

  return {
    hour: await analyticsAggService.refreshAnalyticsAggBundle('hour', options),
    day: await analyticsAggService.refreshAnalyticsAggBundle('day', options),
  };
}

async function collectAggWindowRowCounts(query) {
  const sql = `
    SELECT 'monitor_history_agg' AS table_name, granularity, COUNT(*) AS cnt
    FROM monitor_history_agg
    WHERE (granularity = 'hour' AND time_slot >= ? AND time_slot <= ?)
       OR (granularity = 'day' AND time_slot >= ? AND time_slot <= ?)
    GROUP BY granularity
    UNION ALL
    SELECT 'monitor_history_agg_dim' AS table_name, granularity, COUNT(*) AS cnt
    FROM monitor_history_agg_dim
    WHERE (granularity = 'hour' AND time_slot >= ? AND time_slot <= ?)
       OR (granularity = 'day' AND time_slot >= ? AND time_slot <= ?)
    GROUP BY granularity
    UNION ALL
    SELECT 'monitor_history_agg_variant_group' AS table_name, granularity, COUNT(*) AS cnt
    FROM monitor_history_agg_variant_group
    WHERE (granularity = 'hour' AND time_slot >= ? AND time_slot <= ?)
       OR (granularity = 'day' AND time_slot >= ? AND time_slot <= ?)
    GROUP BY granularity
  `;

  const params = [
    AGG_WINDOW.hourStart,
    AGG_WINDOW.hourEnd,
    AGG_WINDOW.dayStart,
    AGG_WINDOW.dayEnd,
    AGG_WINDOW.hourStart,
    AGG_WINDOW.hourEnd,
    AGG_WINDOW.dayStart,
    AGG_WINDOW.dayEnd,
    AGG_WINDOW.hourStart,
    AGG_WINDOW.hourEnd,
    AGG_WINDOW.dayStart,
    AGG_WINDOW.dayEnd,
  ];

  const rows = await query(sql, params);
  const result = {};
  for (const row of rows) {
    const key = `${row.table_name}.${row.granularity}`;
    result[key] = Number(row.cnt || 0);
  }
  return result;
}

async function fetchRawAggRow(
  query,
  sampleRef,
  granularity,
  variantGroupId = '',
) {
  if (!sampleRef) {
    return null;
  }

  const slotField = granularity === 'hour' ? 'hour_ts' : 'day_ts';
  const slotValue =
    granularity === 'hour' ? sampleRef.hourSlot : sampleRef.daySlot;

  let sql = `
    SELECT
      COUNT(*) AS check_count,
      COALESCE(SUM(CASE WHEN is_broken = 1 THEN 1 ELSE 0 END), 0) AS broken_count,
      MAX(CASE WHEN is_broken = 1 THEN 1 ELSE 0 END) AS has_broken
    FROM monitor_history
    WHERE check_type = 'ASIN'
      AND (asin_id IS NOT NULL OR NULLIF(asin_code, '') IS NOT NULL)
      AND country = ?
      AND ${slotField} = ?
      AND COALESCE(NULLIF(asin_code, ''), CONCAT('ID#', asin_id)) = ?
  `;
  const params = [sampleRef.country, slotValue, sampleRef.asinKey];

  if (variantGroupId) {
    sql += ` AND variant_group_id = ?`;
    params.push(variantGroupId);
  }

  const [row] = await query(sql, params);
  return {
    checkCount: Number(row?.check_count || 0),
    brokenCount: Number(row?.broken_count || 0),
    hasBroken: Number(row?.has_broken || 0),
  };
}

async function fetchAggRow(
  query,
  tableName,
  sampleRef,
  granularity,
  options = {},
) {
  if (!sampleRef) {
    return null;
  }

  const slotValue =
    granularity === 'hour' ? sampleRef.hourSlot : sampleRef.daySlot;
  let sql = `
    SELECT check_count, broken_count, has_broken
    FROM ${tableName}
    WHERE granularity = ?
      AND time_slot = ?
      AND country = ?
      AND asin_key = ?
  `;
  const params = [granularity, slotValue, sampleRef.country, sampleRef.asinKey];

  if (tableName === 'monitor_history_agg_dim') {
    sql += ` AND site = ? AND brand = ?`;
    params.push(sampleRef.site || '', sampleRef.brand || '');
  }

  if (tableName === 'monitor_history_agg_variant_group') {
    if (!options.variantGroupId) {
      return null;
    }
    sql += ` AND variant_group_id = ?`;
    params.push(options.variantGroupId);
  }

  const [row] = await query(sql, params);
  if (!row) {
    return null;
  }
  return {
    checkCount: Number(row.check_count || 0),
    brokenCount: Number(row.broken_count || 0),
    hasBroken: Number(row.has_broken || 0),
  };
}

function compareAggShape(raw, agg) {
  if (!raw && !agg) {
    return true;
  }
  if (!raw || !agg) {
    return false;
  }
  return (
    Number(raw.checkCount || 0) === Number(agg.checkCount || 0) &&
    Number(raw.brokenCount || 0) === Number(agg.brokenCount || 0) &&
    Number(raw.hasBroken || 0) === Number(agg.hasBroken || 0)
  );
}

async function buildDeletedEsSampleCheck(query, sampleRef) {
  if (!sampleRef) {
    return { available: false };
  }

  const hourRaw = await fetchRawAggRow(query, sampleRef, 'hour');
  const dayRaw = await fetchRawAggRow(query, sampleRef, 'day');
  const hourBase = await fetchAggRow(
    query,
    'monitor_history_agg',
    sampleRef,
    'hour',
  );
  const dayBase = await fetchAggRow(
    query,
    'monitor_history_agg',
    sampleRef,
    'day',
  );
  const hourDim = await fetchAggRow(
    query,
    'monitor_history_agg_dim',
    sampleRef,
    'hour',
  );
  const dayDim = await fetchAggRow(
    query,
    'monitor_history_agg_dim',
    sampleRef,
    'day',
  );
  const hourVariant = await fetchAggRow(
    query,
    'monitor_history_agg_variant_group',
    sampleRef,
    'hour',
    { variantGroupId: sampleRef.variantGroupId },
  );
  const dayVariant = await fetchAggRow(
    query,
    'monitor_history_agg_variant_group',
    sampleRef,
    'day',
    { variantGroupId: sampleRef.variantGroupId },
  );

  return {
    available: true,
    sampleRef,
    hour: {
      raw: hourRaw,
      base: hourBase,
      dim: hourDim,
      variantGroup: hourVariant,
      passed:
        hourRaw.checkCount === 0 &&
        hourBase === null &&
        hourDim === null &&
        hourVariant === null,
    },
    day: {
      raw: dayRaw,
      base: dayBase,
      dim: dayDim,
      variantGroup: dayVariant,
      passed:
        dayRaw.checkCount === 0 &&
        dayBase === null &&
        dayDim === null &&
        dayVariant === null,
    },
  };
}

async function buildDeletedGroupSampleCheck(query, sampleRef, variantGroupId) {
  if (!sampleRef) {
    return { available: false };
  }

  const hourRaw = await fetchRawAggRow(
    query,
    sampleRef,
    'hour',
    variantGroupId,
  );
  const dayRaw = await fetchRawAggRow(query, sampleRef, 'day', variantGroupId);
  const hourVariant = await fetchAggRow(
    query,
    'monitor_history_agg_variant_group',
    sampleRef,
    'hour',
    { variantGroupId },
  );
  const dayVariant = await fetchAggRow(
    query,
    'monitor_history_agg_variant_group',
    sampleRef,
    'day',
    { variantGroupId },
  );

  return {
    available: true,
    sampleRef,
    hour: {
      rawVariantGroup: hourRaw,
      variantGroupAgg: hourVariant,
      passed: hourRaw.checkCount === 0 && hourVariant === null,
    },
    day: {
      rawVariantGroup: dayRaw,
      variantGroupAgg: dayVariant,
      passed: dayRaw.checkCount === 0 && dayVariant === null,
    },
  };
}

async function buildUnaffectedSampleCheck(query, sampleRef) {
  if (!sampleRef) {
    return { available: false };
  }

  const hourRaw = await fetchRawAggRow(query, sampleRef, 'hour');
  const dayRaw = await fetchRawAggRow(query, sampleRef, 'day');
  const hourVariantRaw = await fetchRawAggRow(
    query,
    sampleRef,
    'hour',
    sampleRef.variantGroupId,
  );
  const dayVariantRaw = await fetchRawAggRow(
    query,
    sampleRef,
    'day',
    sampleRef.variantGroupId,
  );
  const hourBase = await fetchAggRow(
    query,
    'monitor_history_agg',
    sampleRef,
    'hour',
  );
  const dayBase = await fetchAggRow(
    query,
    'monitor_history_agg',
    sampleRef,
    'day',
  );
  const hourDim = await fetchAggRow(
    query,
    'monitor_history_agg_dim',
    sampleRef,
    'hour',
  );
  const dayDim = await fetchAggRow(
    query,
    'monitor_history_agg_dim',
    sampleRef,
    'day',
  );
  const hourVariant = await fetchAggRow(
    query,
    'monitor_history_agg_variant_group',
    sampleRef,
    'hour',
    { variantGroupId: sampleRef.variantGroupId },
  );
  const dayVariant = await fetchAggRow(
    query,
    'monitor_history_agg_variant_group',
    sampleRef,
    'day',
    { variantGroupId: sampleRef.variantGroupId },
  );

  return {
    available: true,
    sampleRef,
    hour: {
      raw: hourRaw,
      rawVariantGroup: hourVariantRaw,
      base: hourBase,
      dim: hourDim,
      variantGroup: hourVariant,
      passed:
        compareAggShape(hourRaw, hourBase) &&
        compareAggShape(hourRaw, hourDim) &&
        compareAggShape(hourVariantRaw, hourVariant),
    },
    day: {
      raw: dayRaw,
      rawVariantGroup: dayVariantRaw,
      base: dayBase,
      dim: dayDim,
      variantGroup: dayVariant,
      passed:
        compareAggShape(dayRaw, dayBase) &&
        compareAggShape(dayRaw, dayDim) &&
        compareAggShape(dayVariantRaw, dayVariant),
    },
  };
}

async function collectPostVerification(
  query,
  expectedGroups,
  preview,
  baseline,
) {
  const postCounts = await collectBaseline(query, expectedGroups);
  const aggWindowRows = await collectAggWindowRowCounts(query);

  return {
    postCounts,
    aggWindowRows,
    checks: {
      spainWindowCleared: postCounts.spainWindow.total === 0,
      lGroupCleared: postCounts.lGroupAll.total === 0,
      eGroupBeforeCleared: postCounts.eGroupBefore.total === 0,
      eGroupAfterUntouched:
        postCounts.eGroupAfter.total === baseline.eGroupAfter.total,
      manualChangeSetOnlyAsin: true,
      invalidRowsCaptured: preview.invalidRows.length === 17,
      excludedGroupsNotInManualChangeSet: preview.changes.every(
        (item) =>
          item.variantGroupId !== expectedGroups.E.id &&
          item.variantGroupId !== expectedGroups.L.id,
      ),
    },
  };
}

function writeReport(reportDir, payload) {
  ensureDir(reportDir);
  const reportPath = path.join(
    reportDir,
    `history-fix-report-${buildBackupSuffix()}.json`,
  );
  fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2), 'utf8');
  return reportPath;
}

async function closeResources(pool, redisConfig, logger) {
  try {
    await redisConfig.closeRedis();
  } catch (error) {
    logger.warn('[History Fix] 关闭 Redis 失败', { message: error.message });
  }

  try {
    await pool.end();
  } catch (error) {
    logger.warn('[History Fix] 关闭数据库连接池失败', {
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
  const redisConfig = require('../src/config/redis');
  const {
    query,
    withTransaction,
    getConnection,
    createQueryExecutor,
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

    if (!args.apply) {
      logger.warn('[History Fix] 该脚本仅允许显式 --apply 执行');
      logger.info(usage());
      exitCode = 1;
      return;
    }

    if (!fs.existsSync(args.inputPath)) {
      throw new Error(`Excel 文件不存在: ${args.inputPath}`);
    }

    const connected = await testConnection();
    if (!connected) {
      throw new Error('数据库连接失败');
    }

    const expectedGroups = await validateExpectedGroups(query, logger);
    const manualData = await loadManualIntervals(args.inputPath, logger);
    const baseline = await collectBaseline(query, expectedGroups);
    const excludedGroupIds = new Set([
      expectedGroups.L.id,
      expectedGroups.E.id,
    ]);
    const preview = await buildManualChangePreview(
      getConnection,
      createQueryExecutor,
      manualData,
      excludedGroupIds,
      expectedGroups,
    );

    preview.invalidRows = manualData.invalidRows;
    preview.invalidRowCount = manualData.invalidRows.length;

    logger.info('[History Fix] 基线计数', {
      baseline,
      manualChangeSetRows: preview.changes.length,
      invalidRowCount: preview.invalidRows.length,
      missingPairCount: preview.missingPairs.length,
      excludedChangeCandidates: preview.excludedRows.length,
    });

    const backup = await createScopedSqlBackup(
      query,
      preview,
      expectedGroups,
      args.reportDir,
      logger,
    );
    logger.info('[History Fix] 相关表备份完成', {
      filename: backup.filename,
      filepath: backup.filepath,
      size: backup.size,
    });

    const mutationResult = await applyMonitorHistoryMutation(
      withTransaction,
      preview.changes,
      expectedGroups,
    );
    logger.info('[History Fix] monitor_history 事务已提交', mutationResult);

    const clearedAggRows = await clearAggWindow(query);
    logger.info('[History Fix] 聚合窗口清理完成', clearedAggRows);

    const aggRefreshResult = await refreshAggWindow(analyticsAggService);
    MonitorHistory.invalidateCaches();
    logger.info('[History Fix] 聚合重建与缓存失效完成', aggRefreshResult);

    const postVerification = await collectPostVerification(
      query,
      expectedGroups,
      preview,
      baseline,
    );
    const sampleChecks = {
      deletedEs: await buildDeletedEsSampleCheck(
        query,
        preview.sampleRefs.deletedEs,
      ),
      deletedLGroup: await buildDeletedGroupSampleCheck(
        query,
        preview.sampleRefs.deletedLGroup,
        expectedGroups.L.id,
      ),
      unaffected: await buildUnaffectedSampleCheck(
        query,
        preview.sampleRefs.unaffected,
      ),
    };

    const report = {
      kind: 'history-monitor-fix-2026-04-13',
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      envPath,
      inputPath: args.inputPath,
      rawWindow: RAW_WINDOW,
      aggWindow: AGG_WINDOW,
      eGroupCutoff: E_GROUP_CUTOFF,
      expectedGroups,
      backup: {
        ...backup,
      },
      excel: manualData.summary,
      preview: {
        rowsExamined: preview.rowsExamined,
        manualChangeSetRows: preview.changes.length,
        invalidRowCount: preview.invalidRows.length,
        missingPairCount: preview.missingPairs.length,
        missingPairs: preview.missingPairs,
        excludedChangeCandidates: preview.excludedRows.length,
        excludedRows: preview.excludedRows,
      },
      baseline,
      mutationResult,
      clearedAggRows,
      aggRefreshResult,
      postVerification,
      sampleChecks,
      invalidRows: preview.invalidRows,
    };

    const reportPath = writeReport(args.reportDir, report);
    logger.info('[History Fix] 报告已写入', { reportPath });

    const finalChecks = {
      spainWindowCleared: postVerification.checks.spainWindowCleared,
      lGroupCleared: postVerification.checks.lGroupCleared,
      eGroupBeforeCleared: postVerification.checks.eGroupBeforeCleared,
      eGroupAfterUntouched: postVerification.checks.eGroupAfterUntouched,
      excludedGroupsNotInManualChangeSet:
        postVerification.checks.excludedGroupsNotInManualChangeSet,
      deletedEsSamplePassed:
        sampleChecks.deletedEs.available === false ||
        (sampleChecks.deletedEs.hour.passed &&
          sampleChecks.deletedEs.day.passed),
      deletedLGroupSamplePassed:
        sampleChecks.deletedLGroup.available === false ||
        (sampleChecks.deletedLGroup.hour.passed &&
          sampleChecks.deletedLGroup.day.passed),
      unaffectedSamplePassed:
        sampleChecks.unaffected.available === false ||
        (sampleChecks.unaffected.hour.passed &&
          sampleChecks.unaffected.day.passed),
    };

    logger.info('[History Fix] 执行完成', {
      reportPath,
      backupFile: backup.filepath,
      finalChecks,
    });
  } catch (error) {
    const logger = require('../src/utils/logger');
    logger.error('[History Fix] 执行失败', {
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
