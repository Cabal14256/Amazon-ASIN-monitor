#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { loadEnv } = require('./utils/loadEnv');

const DEFAULT_INPUT_PATH = path.resolve(
  __dirname,
  '../../docs/0329-0404不共享.xlsx',
);
const DEFAULT_BACKUP_DIR = path.resolve(
  __dirname,
  '../../backups/manual-history-repair',
);
const REQUIRED_HEADERS = [
  '国家',
  'ASIN',
  '被拆时间-以监控为准',
  '共享时间',
  '勿删-未执行原因',
];
const PREVIEW_SAMPLE_LIMIT = 12;
const QUERY_CHUNK_SIZE = 80;
const UPDATE_CHUNK_SIZE = 200;

function parseArgs(argv) {
  const args = {
    help: false,
    apply: false,
    inputPath: DEFAULT_INPUT_PATH,
    backupDir: DEFAULT_BACKUP_DIR,
    envPath: '',
    rollbackFile: '',
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
    if (item.startsWith('--input=')) {
      args.inputPath = path.resolve(item.slice('--input='.length).trim());
      continue;
    }
    if (item.startsWith('--backup-dir=')) {
      args.backupDir = path.resolve(item.slice('--backup-dir='.length).trim());
      continue;
    }
    if (item.startsWith('--env=')) {
      args.envPath = path.resolve(item.slice('--env='.length).trim());
      continue;
    }
    if (item.startsWith('--rollback=')) {
      args.rollbackFile = path.resolve(item.slice('--rollback='.length).trim());
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
    '  node scripts/repair-monitor-history-from-manual-records.js',
    '  node scripts/repair-monitor-history-from-manual-records.js --apply',
    '  node scripts/repair-monitor-history-from-manual-records.js --rollback=/path/to/backup.json',
    '参数:',
    '  --apply                 按 Excel 手工区间更新 monitor_history',
    '  --rollback=...          按备份文件回滚历史状态',
    '  --input=...             指定 Excel 文件路径',
    '  --backup-dir=...        指定备份输出目录',
    '  --env=...               指定 .env 文件路径（默认 server/.env）',
    '  --sample-limit=...      预览样例数量，默认 12',
  ].join('\n');
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
    // ExcelJS reads datetime cells as UTC-based Date objects. Rebuild a local
    // wall-clock datetime from UTC components so "2026-03-29 01:00:00" stays
    // "2026-03-29 01:00:00" instead of shifting to UTC+8.
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

function pairKey(country, asinCode) {
  return `${country}::${asinCode}`;
}

function splitPairKey(key) {
  const dividerIndex = String(key).indexOf('::');
  return {
    country: String(key).slice(0, dividerIndex),
    asinCode: String(key).slice(dividerIndex + 2),
  };
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

function buildHeaderMap(worksheet) {
  const headerRow = worksheet.getRow(1);
  const headerMap = new Map();
  headerRow.eachCell((cell, colNumber) => {
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
  next.asin = next.asin || row.asin_code;
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

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const country = normalizeText(readCellValue(row, headerMap, '国家'));
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

  logger.info('[Manual Repair] Excel 解析完成', {
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
    logger.warn('[Manual Repair] 发现无效手工记录，已跳过', {
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
    startTime,
    endTime,
    countryCount: Object.fromEntries(countryCount),
  };
}

async function fetchExistingHistoryRows(query, pairKeys, startTime, endTime) {
  const rows = [];
  const keySet = new Set(pairKeys);

  for (const pairChunk of chunk(pairKeys, QUERY_CHUNK_SIZE)) {
    const tuplePlaceholders = pairChunk.map(() => '(?, ?)').join(', ');
    const params = [formatDateTime(startTime), formatDateTime(endTime)];
    for (const key of pairChunk) {
      const { country, asinCode } = splitPairKey(key);
      params.push(asinCode, country);
    }

    const chunkRows = await query(
      `
        SELECT
          id,
          asin_code,
          country,
          is_broken,
          check_result,
          notification_sent,
          variant_group_id,
          variant_group_name,
          asin_id,
          site_snapshot,
          brand_snapshot,
          DATE_FORMAT(check_time, '%Y-%m-%d %H:%i:%s') AS check_time
        FROM monitor_history
        WHERE check_type = 'ASIN'
          AND check_time >= ?
          AND check_time <= ?
          AND (asin_code, country) IN (${tuplePlaceholders})
        ORDER BY country ASC, asin_code ASC, check_time ASC, id ASC
      `,
      params,
    );

    for (const row of chunkRows) {
      const key = pairKey(row.country, row.asin_code);
      if (keySet.has(key)) {
        rows.push(row);
      }
    }
  }

  return rows;
}

function buildPreview(manualData, existingRows, sampleLimit) {
  const existingRowCountByPair = new Map();
  const previewByPair = new Map();
  const changes = [];

  for (const row of existingRows) {
    const key = pairKey(row.country, row.asin_code);
    const intervals = manualData.intervalsByPair.get(key) || [];
    const checkTime = parseDateTimeInput(row.check_time);
    const matchedInterval = checkTime
      ? findMatchedInterval(intervals, checkTime)
      : null;
    const desiredBroken = Boolean(matchedInterval);
    const currentBroken = Number(row.is_broken) === 1;

    existingRowCountByPair.set(key, (existingRowCountByPair.get(key) || 0) + 1);

    if (!previewByPair.has(key)) {
      previewByPair.set(key, {
        pairKey: key,
        country: row.country,
        asinCode: row.asin_code,
        existingRowCount: 0,
        changedRowCount: 0,
        currentBrokenCount: 0,
        desiredBrokenCount: 0,
        intervalCount: intervals.length,
      });
    }

    const pairSummary = previewByPair.get(key);
    pairSummary.existingRowCount += 1;
    if (currentBroken) {
      pairSummary.currentBrokenCount += 1;
    }
    if (desiredBroken) {
      pairSummary.desiredBrokenCount += 1;
    }

    if (currentBroken !== desiredBroken) {
      const nextCheckResult = buildPatchedCheckResult(
        row,
        desiredBroken,
        matchedInterval,
        manualData.inputPath,
      );

      pairSummary.changedRowCount += 1;
      changes.push({
        id: row.id,
        asinCode: row.asin_code,
        country: row.country,
        checkTime: row.check_time,
        beforeIsBroken: currentBroken ? 1 : 0,
        afterIsBroken: desiredBroken ? 1 : 0,
        beforeCheckResult: row.check_result,
        afterCheckResult: nextCheckResult,
        matchedInterval: matchedInterval
          ? {
              rowNumber: matchedInterval.rowNumber,
              start: matchedInterval.startText,
              end: matchedInterval.endText,
              reason: matchedInterval.reason,
            }
          : null,
      });
    }
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

  const pairSummaries = Array.from(previewByPair.values()).sort(
    (left, right) => {
      if (right.changedRowCount !== left.changedRowCount) {
        return right.changedRowCount - left.changedRowCount;
      }
      if (left.country !== right.country) {
        return left.country.localeCompare(right.country);
      }
      return left.asinCode.localeCompare(right.asinCode);
    },
  );

  return {
    summary: {
      pairCount: manualData.pairKeys.length,
      existingRowCount: existingRows.length,
      changedRowCount: changes.length,
      missingPairCount: missingPairs.length,
      countryCount: manualData.countryCount,
      startTime: formatDateTime(manualData.startTime),
      endTime: formatDateTime(manualData.endTime),
    },
    pairSummaries,
    missingPairs,
    changes,
    sampleChanges: changes.slice(0, sampleLimit),
  };
}

async function applyChangeSet(withTransaction, changeSet, logger) {
  if (!Array.isArray(changeSet) || changeSet.length === 0) {
    return 0;
  }

  return withTransaction(async ({ query: transactionQuery }) => {
    await transactionQuery(`
      CREATE TEMPORARY TABLE tmp_manual_history_repair_updates (
        id BIGINT PRIMARY KEY,
        is_broken TINYINT(1) NOT NULL,
        check_result TEXT NULL
      ) ENGINE=InnoDB
    `);

    for (const batch of chunk(changeSet, UPDATE_CHUNK_SIZE)) {
      const placeholders = batch.map(() => '(?, ?, ?)').join(', ');
      const values = [];
      for (const item of batch) {
        values.push(item.id, item.afterIsBroken, item.afterCheckResult);
      }
      await transactionQuery(
        `
          INSERT INTO tmp_manual_history_repair_updates
            (id, is_broken, check_result)
          VALUES ${placeholders}
        `,
        values,
      );
    }

    const result = await transactionQuery(`
      UPDATE monitor_history mh
      INNER JOIN tmp_manual_history_repair_updates t
        ON t.id = mh.id
      SET
        mh.is_broken = t.is_broken,
        mh.check_result = t.check_result
    `);

    return Number(result?.affectedRows || 0);
  });
}

async function rollbackChangeSet(withTransaction, rows, logger) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return 0;
  }

  return withTransaction(async ({ query: transactionQuery }) => {
    await transactionQuery(`
      CREATE TEMPORARY TABLE tmp_manual_history_repair_rollback (
        id BIGINT PRIMARY KEY,
        is_broken TINYINT(1) NOT NULL,
        check_result TEXT NULL
      ) ENGINE=InnoDB
    `);

    for (const batch of chunk(rows, UPDATE_CHUNK_SIZE)) {
      const placeholders = batch.map(() => '(?, ?, ?)').join(', ');
      const values = [];
      for (const item of batch) {
        values.push(item.id, item.beforeIsBroken, item.beforeCheckResult);
      }
      await transactionQuery(
        `
          INSERT INTO tmp_manual_history_repair_rollback
            (id, is_broken, check_result)
          VALUES ${placeholders}
        `,
        values,
      );
    }

    const result = await transactionQuery(`
      UPDATE monitor_history mh
      INNER JOIN tmp_manual_history_repair_rollback t
        ON t.id = mh.id
      SET
        mh.is_broken = t.is_broken,
        mh.check_result = t.check_result
    `);

    return Number(result?.affectedRows || 0);
  });
}

async function refreshAggWindow(
  analyticsAggService,
  startTime,
  endTime,
  logger,
) {
  const options = {
    startTime: formatDateTime(startTime),
    endTime: formatDateTime(endTime),
  };
  const hourResult = await analyticsAggService.refreshAnalyticsAggBundle(
    'hour',
    options,
  );
  const dayResult = await analyticsAggService.refreshAnalyticsAggBundle(
    'day',
    options,
  );

  logger.info('[Manual Repair] 聚合刷新完成', {
    startTime: options.startTime,
    endTime: options.endTime,
    hourResult,
    dayResult,
  });
}

function writeBackupFile(backupDir, payload) {
  ensureDir(backupDir);
  const filePath = path.join(
    backupDir,
    `manual-history-repair-backup-${buildBackupSuffix()}.json`,
  );
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return filePath;
}

function loadBackupFile(backupFilePath) {
  const raw = fs.readFileSync(backupFilePath, 'utf8');
  return JSON.parse(raw);
}

function buildBackupPayload(manualData, preview, changedRows) {
  return {
    kind: 'manual-monitor-history-repair-backup',
    createdAt: new Date().toISOString(),
    inputPath: manualData.inputPath,
    sheetName: manualData.sheetName,
    window: {
      startTime: formatDateTime(manualData.startTime),
      endTime: formatDateTime(manualData.endTime),
    },
    summary: preview.summary,
    rows: changedRows.map((row) => ({
      id: row.id,
      country: row.country,
      asinCode: row.asinCode,
      checkTime: row.checkTime,
      beforeIsBroken: row.beforeIsBroken,
      afterIsBroken: row.afterIsBroken,
      beforeCheckResult: row.beforeCheckResult,
      afterCheckResult: row.afterCheckResult,
      matchedInterval: row.matchedInterval,
    })),
  };
}

async function closeResources(pool, redisConfig, logger, code) {
  try {
    if (redisConfig) {
      await redisConfig.closeRedis();
    }
  } catch (error) {
    logger.warn('[Manual Repair] 关闭 Redis 失败', { message: error.message });
  }

  try {
    await pool.end();
  } catch (error) {
    logger.warn('[Manual Repair] 关闭数据库连接池失败', {
      message: error.message,
    });
  }

  process.exit(code);
}

async function runPreview(args, logger, query, sampleLimit) {
  const manualData = await loadManualIntervals(args.inputPath, logger);
  const existingRows = await fetchExistingHistoryRows(
    query,
    manualData.pairKeys,
    manualData.startTime,
    manualData.endTime,
  );

  const preview = buildPreview(manualData, existingRows, sampleLimit);
  logger.info('[Manual Repair] 预览汇总', preview.summary);

  if (preview.sampleChanges.length > 0) {
    logger.info('[Manual Repair] 预览样例', preview.sampleChanges);
  }

  if (preview.missingPairs.length > 0) {
    logger.warn(
      '[Manual Repair] Excel 中部分目标 ASIN 在 monitor_history 内未找到',
      {
        missingPairs: preview.missingPairs.slice(0, sampleLimit),
        missingPairCount: preview.missingPairs.length,
      },
    );
  }

  return { manualData, existingRows, preview };
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

  if (args.help) {
    logger.info(usage());
    await closeResources(pool, redisConfig, logger, 0);
    return;
  }

  if (args.apply && args.rollbackFile) {
    logger.error('[Manual Repair] --apply 与 --rollback 不能同时使用');
    await closeResources(pool, redisConfig, logger, 1);
    return;
  }

  const connected = await testConnection();
  if (!connected) {
    logger.error('[Manual Repair] 数据库连接失败，终止执行');
    await closeResources(pool, redisConfig, logger, 1);
    return;
  }

  if (args.rollbackFile) {
    if (!fs.existsSync(args.rollbackFile)) {
      logger.error('[Manual Repair] 备份文件不存在', {
        rollbackFile: args.rollbackFile,
      });
      await closeResources(pool, redisConfig, logger, 1);
      return;
    }

    const payload = loadBackupFile(args.rollbackFile);
    if (payload?.kind !== 'manual-monitor-history-repair-backup') {
      logger.error('[Manual Repair] 备份文件格式无效', {
        rollbackFile: args.rollbackFile,
      });
      await closeResources(pool, redisConfig, logger, 1);
      return;
    }

    logger.info('[Manual Repair] 开始回滚', {
      rollbackFile: args.rollbackFile,
      rowCount: Array.isArray(payload.rows) ? payload.rows.length : 0,
      window: payload.window,
    });

    const affectedRows = await rollbackChangeSet(
      withTransaction,
      payload.rows || [],
      logger,
    );
    await refreshAggWindow(
      analyticsAggService,
      parseDateTimeInput(payload.window?.startTime),
      parseDateTimeInput(payload.window?.endTime),
      logger,
    );
    MonitorHistory.invalidateCaches();

    logger.info('[Manual Repair] 回滚完成', {
      rollbackFile: args.rollbackFile,
      affectedRows,
    });
    await closeResources(pool, redisConfig, logger, 0);
    return;
  }

  if (!fs.existsSync(args.inputPath)) {
    logger.error('[Manual Repair] Excel 文件不存在', {
      inputPath: args.inputPath,
    });
    await closeResources(pool, redisConfig, logger, 1);
    return;
  }

  const { manualData, preview } = await runPreview(
    args,
    logger,
    query,
    args.sampleLimit,
  );

  if (!args.apply) {
    logger.info(
      '[Manual Repair] 当前为预览模式；确认无误后请追加 --apply 执行更新',
    );
    await closeResources(pool, redisConfig, logger, 0);
    return;
  }

  if (preview.changes.length === 0) {
    logger.info('[Manual Repair] 没有需要更新的行，跳过 apply');
    await closeResources(pool, redisConfig, logger, 0);
    return;
  }

  const backupPayload = buildBackupPayload(
    manualData,
    preview,
    preview.changes,
  );
  const backupFilePath = writeBackupFile(args.backupDir, backupPayload);
  logger.info('[Manual Repair] 已写入回滚备份', {
    backupFilePath,
    rowCount: preview.changes.length,
  });

  const affectedRows = await applyChangeSet(
    withTransaction,
    preview.changes,
    logger,
  );

  await refreshAggWindow(
    analyticsAggService,
    manualData.startTime,
    manualData.endTime,
    logger,
  );
  MonitorHistory.invalidateCaches();

  logger.info('[Manual Repair] 更新完成', {
    backupFilePath,
    affectedRows,
    changedRowCount: preview.changes.length,
    pairCount: preview.summary.pairCount,
    window: {
      startTime: formatDateTime(manualData.startTime),
      endTime: formatDateTime(manualData.endTime),
    },
  });

  await closeResources(pool, redisConfig, logger, 0);
}

main().catch(async (error) => {
  const logger = require('../src/utils/logger');
  logger.error('[Manual Repair] 未捕获异常', {
    message: error?.message || String(error),
  });

  try {
    const redisConfig = require('../src/config/redis');
    await redisConfig.closeRedis();
  } catch (closeError) {
    logger.warn('[Manual Repair] 异常退出时关闭 Redis 失败', {
      message: closeError.message,
    });
  }

  try {
    const { pool } = require('../src/config/database');
    await pool.end();
  } catch (closeError) {
    logger.warn('[Manual Repair] 异常退出时关闭数据库连接池失败', {
      message: closeError.message,
    });
  }

  process.exit(1);
});
