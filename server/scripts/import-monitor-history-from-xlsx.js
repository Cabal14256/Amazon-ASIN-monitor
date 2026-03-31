#!/usr/bin/env node
const path = require('path');
const ExcelJS = require('exceljs');
const mysql = require('mysql2/promise');
const { loadEnv } = require('./utils/loadEnv');
const {
  buildEffectiveStatus,
  decorateVariantGroupStatus,
} = require('../src/utils/variantStatus');
let logger = require('../src/utils/logger');

const REQUIRED_HEADERS = ['国家', 'ASIN', '被拆时间-以监控为准', '共享时间'];
const WINDOW_BUFFER_MINUTES = 120;
const NON_GENERATED_COLUMNS = [
  'id',
  'variant_group_id',
  'variant_group_name',
  'asin_id',
  'asin_code',
  'asin_name',
  'site_snapshot',
  'brand_snapshot',
  'check_type',
  'country',
  'is_broken',
  'check_time',
  'check_result',
  'notification_sent',
  'create_time',
];
const MAIN_INSERT_COLUMNS = NON_GENERATED_COLUMNS.filter(
  (column) => column !== 'id',
);
const ARCHIVE_EXTRA_COLUMNS = ['source_table', 'archived_at', 'archive_reason'];

function parseArgs(argv) {
  const args = {
    file: '',
    sheet: '',
    envPath: '',
    execute: false,
    archiveTable: '',
    sourceTables: [],
    archiveReason: 'xlsx-history-repair',
    syncGroup: false,
    skipAsin: false,
  };

  for (const item of argv) {
    if (item === '--execute') {
      args.execute = true;
      continue;
    }
    if (item === '--sync-group') {
      args.syncGroup = true;
      continue;
    }
    if (item === '--skip-asin') {
      args.skipAsin = true;
      continue;
    }
    if (item.startsWith('--file=')) {
      args.file = item.slice('--file='.length).trim();
      continue;
    }
    if (item.startsWith('--sheet=')) {
      args.sheet = item.slice('--sheet='.length).trim();
      continue;
    }
    if (item.startsWith('--env=')) {
      args.envPath = item.slice('--env='.length).trim();
      continue;
    }
    if (item.startsWith('--archive-table=')) {
      args.archiveTable = item.slice('--archive-table='.length).trim();
      continue;
    }
    if (item.startsWith('--source-table=')) {
      const tableName = item.slice('--source-table='.length).trim();
      if (tableName) {
        args.sourceTables.push(tableName);
      }
      continue;
    }
    if (item.startsWith('--archive-reason=')) {
      args.archiveReason = item.slice('--archive-reason='.length).trim();
    }
  }

  return args;
}

function buildArchiveTableName() {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `monitor_history_archive_import_${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

function usage() {
  return [
    '用法:',
    '  node scripts/import-monitor-history-from-xlsx.js --file="C:/path/to/file.xlsx"',
    '  node scripts/import-monitor-history-from-xlsx.js --file="C:/path/to/file.xlsx" --execute',
    '参数:',
    '  --file=...              Excel 文件路径（必填）',
    '  --sheet=...             指定工作表名称，默认取第一张',
    '  --env=...               指定 .env 路径，默认 server/.env',
    '  --archive-table=...     指定本次新建存档表名，默认自动生成',
    '  --source-table=...      额外指定只读源表，可重复传入；未指定时自动读取 monitor_history 与 monitor_history_archive_%',
    '  --archive-reason=...    新存档表中的归档原因标记',
    '  --sync-group            同步重算对应 GROUP 历史',
    '  --skip-asin             跳过 ASIN 历史修复，仅执行 GROUP 同步',
    '  --execute               真正执行写库；不带该参数时仅预演',
  ].join('\n');
}

function normalizeCellValue(value) {
  if (value === undefined) {
    return null;
  }
  if (value === null) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'object') {
    if (value.text) {
      return value.text;
    }
    if (value.result !== undefined) {
      return value.result;
    }
    if (Array.isArray(value.richText)) {
      return value.richText.map((item) => item.text || '').join('');
    }
  }
  return value;
}

function asDate(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function toSqlDateTime(date) {
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mi = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function quoteIdentifier(name) {
  return `\`${String(name).replace(/`/g, '``')}\``;
}

function mergeIntervals(intervals = []) {
  const sorted = [...intervals].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );
  const result = [];
  for (const interval of sorted) {
    const last = result[result.length - 1];
    if (!last) {
      result.push({ ...interval });
      continue;
    }
    if (interval.start.getTime() <= last.end.getTime()) {
      if (interval.end.getTime() > last.end.getTime()) {
        last.end = interval.end;
      }
      continue;
    }
    result.push({ ...interval });
  }
  return result;
}

function ensureHeaders(headers) {
  const missing = REQUIRED_HEADERS.filter(
    (header) => !headers.includes(header),
  );
  if (missing.length > 0) {
    throw new Error(`Excel 缺少必要表头: ${missing.join(', ')}`);
  }
}

async function readWorkbookIntervals(filePath, sheetName = '') {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = sheetName
    ? workbook.getWorksheet(sheetName)
    : workbook.worksheets[0];

  if (!worksheet) {
    throw new Error(`未找到工作表: ${sheetName || '(first sheet)'}`);
  }

  const headers = worksheet.getRow(1).values.slice(1).map(normalizeCellValue);
  ensureHeaders(headers);

  const intervalMap = new Map();
  const rawRowCount = Math.max(worksheet.rowCount - 1, 0);

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const values = worksheet.getRow(rowNumber).values.slice(1);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = normalizeCellValue(values[index]);
    });

    const country = String(row['国家'] || '')
      .trim()
      .toUpperCase();
    const asin = String(row.ASIN || '')
      .trim()
      .toUpperCase();
    const start = asDate(row['被拆时间-以监控为准']);
    const end = asDate(row['共享时间']);

    if (!country || !asin || !start || !end || end <= start) {
      logger.warn('[Excel导入] 跳过无效行', {
        rowNumber,
        country,
        asin,
        start: row['被拆时间-以监控为准'] || null,
        end: row['共享时间'] || null,
      });
      continue;
    }

    const key = `${country}|${asin}`;
    const bucket = intervalMap.get(key) || {
      country,
      asin,
      intervals: [],
      workbookRows: 0,
    };
    bucket.intervals.push({
      start,
      end,
      rowNumber,
    });
    bucket.workbookRows += 1;
    intervalMap.set(key, bucket);
  }

  const normalizedItems = [...intervalMap.values()].map((item) => {
    const intervals = mergeIntervals(item.intervals);
    return {
      country: item.country,
      asin: item.asin,
      workbookRows: item.workbookRows,
      intervalCount: intervals.length,
      intervals,
      windowStart: intervals[0].start,
      windowEnd: intervals[intervals.length - 1].end,
      queryWindowStart: addMinutes(intervals[0].start, -WINDOW_BUFFER_MINUTES),
      queryWindowEnd: addMinutes(
        intervals[intervals.length - 1].end,
        WINDOW_BUFFER_MINUTES,
      ),
    };
  });

  return {
    sheetName: worksheet.name,
    rawRowCount,
    itemCount: normalizedItems.length,
    items: normalizedItems,
  };
}

async function createConnection() {
  return mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
    timezone: '+00:00',
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT) || 20000,
  });
}

async function discoverSourceTables(connection, explicitTables = []) {
  if (explicitTables.length > 0) {
    return [
      'monitor_history',
      ...explicitTables.filter((name) => name && name !== 'monitor_history'),
    ];
  }

  const [tables] = await connection.query(
    `SHOW TABLES LIKE 'monitor_history_archive_%'`,
  );
  const archiveTables = tables
    .map((row) => Object.values(row)[0])
    .filter((name) => typeof name === 'string')
    .sort();
  return ['monitor_history', ...archiveTables];
}

async function resolveAsinIdMap(connection, items) {
  const values = [];
  const placeholders = items.map(() => '(?, ?)').join(', ');
  for (const item of items) {
    values.push(item.asin, item.country);
  }

  if (!placeholders) {
    return new Map();
  }

  const [rows] = await connection.query(
    `SELECT asin, country, id
       FROM asins
      WHERE (asin, country) IN (${placeholders})`,
    values,
  );

  const result = new Map();
  rows.forEach((row) => {
    result.set(
      `${String(row.country).toUpperCase()}|${String(row.asin).toUpperCase()}`,
      row.id,
    );
  });
  return result;
}

function buildWindowWhere(items, asinIdMap) {
  const clauses = [];
  const params = [];

  for (const item of items) {
    const asinId = asinIdMap.get(`${item.country}|${item.asin}`) || null;
    clauses.push(
      `(
        country = ?
        AND (asin_code = ?${asinId ? ' OR asin_id = ?' : ''})
        AND check_type = 'ASIN'
        AND check_time >= ?
        AND check_time <= ?
      )`,
    );
    params.push(item.country, item.asin);
    if (asinId) {
      params.push(asinId);
    }
    params.push(
      toSqlDateTime(item.queryWindowStart),
      toSqlDateTime(item.queryWindowEnd),
    );
  }

  return {
    whereSql: clauses.length > 0 ? clauses.join(' OR ') : '1 = 0',
    params,
  };
}

async function fetchSourceRows(connection, sourceTable, items, asinIdMap) {
  const { whereSql, params } = buildWindowWhere(items, asinIdMap);
  const [rows] = await connection.query(
    `SELECT
       id,
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
     FROM ${quoteIdentifier(sourceTable)}
     WHERE ${whereSql}
     ORDER BY country, asin_code, check_time, id`,
    params,
  );

  return rows.map((row) => ({
    ...row,
    source_table: sourceTable,
  }));
}

function buildIntervalLookup(items) {
  const map = new Map();
  for (const item of items) {
    map.set(`${item.country}|${item.asin}`, item);
  }
  return map;
}

function shouldBeBroken(checkTime, item) {
  const targetMs = new Date(checkTime).getTime();
  return item.intervals.some(
    (interval) =>
      targetMs >= interval.start.getTime() && targetMs < interval.end.getTime(),
  );
}

function buildNaturalKey(row) {
  const asinKey = row.asin_id || row.asin_code || '';
  return [
    row.check_type || '',
    row.country || '',
    asinKey,
    row.check_time instanceof Date
      ? row.check_time.toISOString()
      : String(row.check_time),
  ].join('|');
}

function parseCheckResult(value) {
  if (!value) {
    return {};
  }
  if (typeof value === 'object') {
    return { ...value };
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    return {};
  }
}

function stringifyCheckResult(row, broken) {
  const result = parseCheckResult(row.check_result);
  result.asin = row.asin_code || result.asin || null;
  result.isBroken = broken;
  result.statusSource = broken ? 'AUTO' : 'NORMAL';
  if (result.manualBrokenReason === undefined) {
    result.manualBrokenReason = '';
  }
  return JSON.stringify(result);
}

function buildReplacementRows(sourceRows, intervalLookup) {
  const deduped = new Map();
  const stats = {
    totalSourceRows: sourceRows.length,
    dedupedRows: 0,
    changedToBroken: 0,
    changedToNormal: 0,
    unchanged: 0,
    missingWorkbookKeyRows: 0,
  };

  const sortedRows = [...sourceRows].sort((left, right) => {
    if (left.source_table === right.source_table) {
      return (
        new Date(left.check_time).getTime() -
        new Date(right.check_time).getTime()
      );
    }
    return left.source_table === 'monitor_history' ? -1 : 1;
  });

  for (const row of sortedRows) {
    const key = buildNaturalKey(row);
    if (!deduped.has(key)) {
      deduped.set(key, row);
    }
  }

  const replacements = [];
  for (const row of deduped.values()) {
    const workbookKey = `${String(row.country).toUpperCase()}|${String(
      row.asin_code || '',
    ).toUpperCase()}`;
    const item = intervalLookup.get(workbookKey);
    if (!item) {
      stats.missingWorkbookKeyRows += 1;
      continue;
    }

    const nextBroken = shouldBeBroken(row.check_time, item) ? 1 : 0;
    const currentBroken = Number(row.is_broken || 0) === 1 ? 1 : 0;
    if (nextBroken === currentBroken) {
      stats.unchanged += 1;
    } else if (nextBroken === 1) {
      stats.changedToBroken += 1;
    } else {
      stats.changedToNormal += 1;
    }

    replacements.push({
      variant_group_id: row.variant_group_id || null,
      variant_group_name: row.variant_group_name || null,
      asin_id: row.asin_id || null,
      asin_code: row.asin_code || null,
      asin_name: row.asin_name || null,
      site_snapshot: row.site_snapshot || null,
      brand_snapshot: row.brand_snapshot || null,
      check_type: row.check_type || 'ASIN',
      country: row.country,
      is_broken: nextBroken,
      check_time: row.check_time,
      check_result: stringifyCheckResult(row, nextBroken === 1),
      notification_sent: row.notification_sent || 0,
      create_time: row.create_time || row.check_time,
    });
  }

  stats.dedupedRows = replacements.length;
  return { replacements, stats };
}

function buildGroupWindowWhere(groupTargets, checkType) {
  const clauses = [];
  const params = [];

  for (const item of groupTargets) {
    clauses.push(
      `(
        variant_group_id = ?
        AND country = ?
        AND check_type = ?
        AND check_time >= ?
        AND check_time <= ?
      )`,
    );
    params.push(
      item.variant_group_id,
      item.country,
      checkType,
      toSqlDateTime(item.queryWindowStart),
      toSqlDateTime(item.queryWindowEnd),
    );
  }

  return {
    whereSql: clauses.length > 0 ? clauses.join(' OR ') : '1 = 0',
    params,
  };
}

async function resolveGroupTargets(connection, items, asinIdMap) {
  const { whereSql, params } = buildWindowWhere(items, asinIdMap);
  const [rows] = await connection.query(
    `SELECT
       variant_group_id,
       MAX(variant_group_name) AS variant_group_name,
       country,
       MIN(check_time) AS min_check_time,
       MAX(check_time) AS max_check_time
     FROM monitor_history
     WHERE ${whereSql}
       AND variant_group_id IS NOT NULL
     GROUP BY variant_group_id, country
     ORDER BY country, variant_group_id`,
    params,
  );

  return rows
    .filter((row) => row.variant_group_id)
    .map((row) => ({
      variant_group_id: row.variant_group_id,
      variant_group_name: row.variant_group_name || null,
      country: row.country,
      windowStart: new Date(row.min_check_time),
      windowEnd: new Date(row.max_check_time),
      queryWindowStart: addMinutes(
        new Date(row.min_check_time),
        -WINDOW_BUFFER_MINUTES,
      ),
      queryWindowEnd: addMinutes(
        new Date(row.max_check_time),
        WINDOW_BUFFER_MINUTES,
      ),
    }));
}

async function fetchGroupScopedRows(connection, groupTargets, checkType) {
  const { whereSql, params } = buildGroupWindowWhere(groupTargets, checkType);
  const [rows] = await connection.query(
    `SELECT
       id,
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
     FROM monitor_history
     WHERE ${whereSql}
     ORDER BY variant_group_id, country, check_time, id`,
    params,
  );
  return rows.map((row) => ({
    ...row,
    source_table: 'monitor_history',
  }));
}

function buildGroupSlotKey(row) {
  return [
    row.variant_group_id || '',
    row.country || '',
    row.check_time instanceof Date
      ? row.check_time.toISOString()
      : String(row.check_time),
  ].join('|');
}

function buildAsinMapByGroupSlot(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = buildGroupSlotKey(row);
    const bucket = map.get(key) || [];
    bucket.push(row);
    map.set(key, bucket);
  }
  return map;
}

function buildBrokenByType(items) {
  const result = {
    SP_API_ERROR: 0,
    NO_VARIANTS: 0,
  };

  for (const item of items) {
    const key = item.errorType || 'NO_VARIANTS';
    result[key] = (result[key] || 0) + 1;
  }

  return result;
}

function stringifyJson(value) {
  return JSON.stringify(value);
}

function buildGroupResultTemplate(result, child, existingBrokenInfo) {
  const next = { ...result };
  next.isBroken = Number(child?.isBroken || 0) === 1;
  if (next.isBroken) {
    next.errorType =
      existingBrokenInfo?.errorType ||
      (child?.statusSource === 'MANUAL' ? 'MANUAL_MARKED' : 'NO_VARIANTS');
  } else if (Object.prototype.hasOwnProperty.call(next, 'errorType')) {
    delete next.errorType;
  }
  return next;
}

function buildGroupCheckResult(templateRow, asinRowsAtSlot) {
  const parsed = parseCheckResult(templateRow.check_result);
  const templateBrokenList = Array.isArray(parsed.brokenASINs)
    ? parsed.brokenASINs
    : [];
  const brokenInfoMap = new Map(
    templateBrokenList.map((item) => [
      String(item.asin || '').toUpperCase(),
      item,
    ]),
  );
  const templateSnapshot = parsed.groupSnapshot || {};
  const templateChildren = Array.isArray(templateSnapshot.children)
    ? templateSnapshot.children
    : [];
  const childMap = new Map(
    templateChildren.map((child) => [
      String(child.asin || '').toUpperCase(),
      child,
    ]),
  );
  const asinRowMap = new Map(
    asinRowsAtSlot.map((row) => [
      String(row.asin_code || '').toUpperCase(),
      row,
    ]),
  );

  const updatedChildren = templateChildren.map((child) => {
    const asinKey = String(child.asin || '').toUpperCase();
    const asinRow = asinRowMap.get(asinKey);
    if (!asinRow) {
      return child;
    }

    const effectiveStatus = buildEffectiveStatus({
      autoBroken: Number(asinRow.is_broken || 0),
      manualBroken: Number(child.manualBroken || 0),
    });

    return {
      ...child,
      isBroken: effectiveStatus.isBroken,
      variantStatus: effectiveStatus.variantStatus,
      autoIsBroken: effectiveStatus.autoIsBroken,
      autoVariantStatus: effectiveStatus.autoVariantStatus,
      statusSource: effectiveStatus.statusSource,
    };
  });

  for (const asinRow of asinRowsAtSlot) {
    const asinKey = String(asinRow.asin_code || '').toUpperCase();
    if (childMap.has(asinKey)) {
      continue;
    }

    const asinPayload = parseCheckResult(asinRow.check_result);
    const effectiveStatus = buildEffectiveStatus({
      autoBroken: Number(asinRow.is_broken || 0),
      manualBroken: 0,
    });
    updatedChildren.push({
      id: asinRow.asin_id || null,
      asin: asinRow.asin_code || null,
      name: asinRow.asin_name || null,
      country: asinRow.country,
      site: asinRow.site_snapshot || null,
      brand: asinRow.brand_snapshot || null,
      parentId: asinRow.variant_group_id || null,
      isBroken: effectiveStatus.isBroken,
      variantStatus: effectiveStatus.variantStatus,
      autoIsBroken: effectiveStatus.autoIsBroken,
      autoVariantStatus: effectiveStatus.autoVariantStatus,
      manualBroken: 0,
      manualBrokenScope: 'NONE',
      manualBrokenReason: asinPayload.manualBrokenReason || null,
      manualBrokenUpdatedAt: null,
      manualBrokenUpdatedBy: null,
      selfManualBroken: 0,
      selfManualBrokenReason: null,
      selfManualBrokenUpdatedAt: null,
      selfManualBrokenUpdatedBy: null,
      manualExcludedFromGroup: 0,
      manualExcludedReason: null,
      manualExcludedUpdatedAt: null,
      manualExcludedUpdatedBy: null,
      inheritedManualBroken: 0,
      inheritedManualBrokenReason: null,
      inheritedManualBrokenUpdatedAt: null,
      inheritedManualBrokenUpdatedBy: null,
      statusSource: effectiveStatus.statusSource,
      createTime: asinRow.create_time || asinRow.check_time,
      updateTime: asinRow.create_time || asinRow.check_time,
      lastCheckTime: asinRow.check_time,
      feishuNotifyEnabled: 1,
    });
  }

  const autoBroken = updatedChildren.some(
    (child) => Number(child.autoIsBroken || 0) === 1,
  );
  const decoratedGroup = decorateVariantGroupStatus(
    {
      ...templateSnapshot,
      is_broken: autoBroken ? 1 : 0,
      variant_group_id:
        templateRow.variant_group_id || templateSnapshot.id || null,
      country: templateRow.country || templateSnapshot.country || null,
    },
    updatedChildren,
  );

  const brokenASINs = updatedChildren
    .filter((child) => Number(child.isBroken || 0) === 1)
    .map((child) => {
      const existingBrokenInfo = brokenInfoMap.get(
        String(child.asin || '').toUpperCase(),
      );
      return {
        asin: child.asin,
        errorType:
          existingBrokenInfo?.errorType ||
          (child.statusSource === 'MANUAL' ? 'MANUAL_MARKED' : 'NO_VARIANTS'),
        statusSource: child.statusSource || 'NORMAL',
        manualBroken: Number(child.manualBroken || 0),
        manualBrokenReason: child.manualBrokenReason || '',
        manualBrokenUpdatedAt: child.manualBrokenUpdatedAt || null,
        manualBrokenUpdatedBy: child.manualBrokenUpdatedBy || null,
      };
    });

  const updatedResults = [];
  const templateResults = Array.isArray(parsed.details?.results)
    ? parsed.details.results
    : [];
  const resultSeen = new Set();

  for (const result of templateResults) {
    const asinKey = String(result?.asin || '').toUpperCase();
    const child = updatedChildren.find(
      (item) => String(item.asin || '').toUpperCase() === asinKey,
    );
    if (!child) {
      updatedResults.push(result);
      continue;
    }
    const existingBrokenInfo = brokenInfoMap.get(asinKey);
    updatedResults.push(
      buildGroupResultTemplate(result, child, existingBrokenInfo),
    );
    resultSeen.add(asinKey);
  }

  for (const child of updatedChildren) {
    const asinKey = String(child.asin || '').toUpperCase();
    if (resultSeen.has(asinKey)) {
      continue;
    }
    const existingBrokenInfo = brokenInfoMap.get(asinKey);
    updatedResults.push(
      buildGroupResultTemplate(
        {
          asin: child.asin,
          country: templateRow.country,
          details: null,
        },
        child,
        existingBrokenInfo,
      ),
    );
  }

  const next = {
    ...parsed,
    isBroken: decoratedGroup.isBroken === 1,
    brokenASINs,
    brokenByType: buildBrokenByType(brokenASINs),
    groupStatus: {
      ...(parsed.groupStatus || {}),
      id:
        parsed.groupStatus?.id ||
        templateRow.variant_group_id ||
        templateSnapshot.id ||
        null,
      name:
        parsed.groupStatus?.name ||
        templateRow.variant_group_name ||
        templateSnapshot.name ||
        null,
      is_broken: decoratedGroup.isBroken === 1 ? 1 : 0,
      statusSource: decoratedGroup.statusSource || 'NORMAL',
      manualBroken: Number(decoratedGroup.manualBroken || 0),
      manualBrokenReason: decoratedGroup.manualBrokenReason || '',
    },
    groupSnapshot: {
      ...templateSnapshot,
      ...decoratedGroup,
      id: templateSnapshot.id || templateRow.variant_group_id || null,
      name: templateSnapshot.name || templateRow.variant_group_name || null,
      children: updatedChildren,
    },
    details: {
      ...(parsed.details || {}),
      results: updatedResults,
    },
  };

  return stringifyJson(next);
}

function buildGroupReplacementRows(groupRows, asinRows) {
  const asinRowsBySlot = buildAsinMapByGroupSlot(asinRows);
  const stats = {
    totalSourceRows: groupRows.length,
    replacementRows: 0,
    changedToBroken: 0,
    changedToNormal: 0,
    unchanged: 0,
    missingAsinSlots: 0,
  };

  const replacements = groupRows.map((row) => {
    const asinRowsAtSlot = asinRowsBySlot.get(buildGroupSlotKey(row)) || [];
    if (asinRowsAtSlot.length === 0) {
      stats.missingAsinSlots += 1;
      stats.unchanged += 1;
      return {
        variant_group_id: row.variant_group_id || null,
        variant_group_name: row.variant_group_name || null,
        asin_id: null,
        asin_code: null,
        asin_name: null,
        site_snapshot: row.site_snapshot || null,
        brand_snapshot: row.brand_snapshot || null,
        check_type: 'GROUP',
        country: row.country,
        is_broken: Number(row.is_broken || 0),
        check_time: row.check_time,
        check_result: row.check_result || null,
        notification_sent: row.notification_sent || 0,
        create_time: row.create_time || row.check_time,
      };
    }

    const nextCheckResult = buildGroupCheckResult(row, asinRowsAtSlot);
    const parsedNext = parseCheckResult(nextCheckResult);
    const nextBroken = parsedNext.isBroken ? 1 : 0;
    const currentBroken = Number(row.is_broken || 0) === 1 ? 1 : 0;

    if (nextBroken === currentBroken) {
      stats.unchanged += 1;
    } else if (nextBroken === 1) {
      stats.changedToBroken += 1;
    } else {
      stats.changedToNormal += 1;
    }

    return {
      variant_group_id: row.variant_group_id || null,
      variant_group_name: row.variant_group_name || null,
      asin_id: null,
      asin_code: null,
      asin_name: null,
      site_snapshot: row.site_snapshot || null,
      brand_snapshot: row.brand_snapshot || null,
      check_type: 'GROUP',
      country: row.country,
      is_broken: nextBroken,
      check_time: row.check_time,
      check_result: nextCheckResult,
      notification_sent: row.notification_sent || 0,
      create_time: row.create_time || row.check_time,
    };
  });

  stats.replacementRows = replacements.length;
  return { replacements, stats };
}

async function ensureArchiveTable(connection, archiveTable) {
  await connection.query(
    `CREATE TABLE ${quoteIdentifier(archiveTable)} LIKE monitor_history`,
  );

  await connection.query(
    `ALTER TABLE ${quoteIdentifier(archiveTable)}
       ADD COLUMN source_table VARCHAR(128) NOT NULL DEFAULT 'monitor_history' COMMENT '源表名',
       ADD COLUMN archived_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '归档时间',
       ADD COLUMN archive_reason VARCHAR(255) DEFAULT NULL COMMENT '归档原因'`,
  );
}

async function insertArchiveRows(
  connection,
  archiveTable,
  rows,
  archiveReason,
) {
  if (rows.length === 0) {
    return 0;
  }

  const sql = `INSERT INTO ${quoteIdentifier(archiveTable)} (
      ${[...NON_GENERATED_COLUMNS, ...ARCHIVE_EXTRA_COLUMNS].join(', ')}
    ) VALUES `;
  let inserted = 0;

  for (let offset = 0; offset < rows.length; offset += 400) {
    const batch = rows.slice(offset, offset + 400);
    const placeholders = batch
      .map(
        () =>
          `(${[...NON_GENERATED_COLUMNS, ...ARCHIVE_EXTRA_COLUMNS]
            .map(() => '?')
            .join(', ')})`,
      )
      .join(', ');
    const params = [];
    batch.forEach((row) => {
      params.push(
        row.id,
        row.variant_group_id || null,
        row.variant_group_name || null,
        row.asin_id || null,
        row.asin_code || null,
        row.asin_name || null,
        row.site_snapshot || null,
        row.brand_snapshot || null,
        row.check_type || null,
        row.country || null,
        Number(row.is_broken || 0),
        row.check_time,
        row.check_result || null,
        row.notification_sent || 0,
        row.create_time || row.check_time,
        row.source_table,
        new Date(),
        archiveReason,
      );
    });
    await connection.query(sql + placeholders, params);
    inserted += batch.length;
  }

  return inserted;
}

async function deleteExistingMainRows(connection, items, asinIdMap) {
  const { whereSql, params } = buildWindowWhere(items, asinIdMap);
  const [result] = await connection.query(
    `DELETE FROM monitor_history WHERE ${whereSql}`,
    params,
  );
  return Number(result.affectedRows || 0);
}

async function deleteMainRowsByIds(connection, ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return 0;
  }

  let deleted = 0;
  for (let offset = 0; offset < ids.length; offset += 500) {
    const batch = ids.slice(offset, offset + 500);
    const placeholders = batch.map(() => '?').join(', ');
    const [result] = await connection.query(
      `DELETE FROM monitor_history WHERE id IN (${placeholders})`,
      batch,
    );
    deleted += Number(result.affectedRows || 0);
  }
  return deleted;
}

async function insertMainRows(connection, rows) {
  if (rows.length === 0) {
    return 0;
  }

  const sql = `INSERT INTO monitor_history (
      ${MAIN_INSERT_COLUMNS.join(', ')}
    ) VALUES `;
  let inserted = 0;

  for (let offset = 0; offset < rows.length; offset += 400) {
    const batch = rows.slice(offset, offset + 400);
    const placeholders = batch
      .map(() => `(${MAIN_INSERT_COLUMNS.map(() => '?').join(', ')})`)
      .join(', ');
    const params = [];
    batch.forEach((row) => {
      params.push(
        row.variant_group_id || null,
        row.variant_group_name || null,
        row.asin_id || null,
        row.asin_code || null,
        row.asin_name || null,
        row.site_snapshot || null,
        row.brand_snapshot || null,
        row.check_type || 'ASIN',
        row.country,
        Number(row.is_broken || 0),
        row.check_time,
        row.check_result || null,
        row.notification_sent || 0,
        row.create_time || row.check_time,
      );
    });
    await connection.query(sql + placeholders, params);
    inserted += batch.length;
  }

  return inserted;
}

function summarizeItems(items) {
  let minTime = null;
  let maxTime = null;
  items.forEach((item) => {
    const start = item.windowStart.toISOString();
    const end = item.windowEnd.toISOString();
    if (!minTime || start < minTime) {
      minTime = start;
    }
    if (!maxTime || end > maxTime) {
      maxTime = end;
    }
  });
  return {
    affectedAsins: items.length,
    minTime,
    maxTime,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    logger.error('缺少 --file 参数');
    logger.info(usage());
    process.exit(1);
    return;
  }

  const envPath = args.envPath
    ? path.resolve(args.envPath)
    : path.resolve(__dirname, '../.env');
  const envResult = loadEnv(envPath);
  delete require.cache[require.resolve('../src/utils/logger')];
  logger = require('../src/utils/logger');
  logger.info('[HistoryImport] 环境加载完成', {
    envPath: envResult.path,
    loaded: envResult.loaded,
    execute: args.execute,
  });

  const filePath = path.resolve(args.file);
  const workbookData = await readWorkbookIntervals(filePath, args.sheet);
  const summary = summarizeItems(workbookData.items);
  const archiveTable = args.archiveTable || buildArchiveTableName();

  logger.info('[HistoryImport] Excel 解析完成', {
    filePath,
    sheetName: workbookData.sheetName,
    rawRowCount: workbookData.rawRowCount,
    affectedAsins: workbookData.itemCount,
    minTime: summary.minTime,
    maxTime: summary.maxTime,
    archiveTable,
  });

  const connection = await createConnection();
  try {
    const asinIdMap = await resolveAsinIdMap(connection, workbookData.items);
    const intervalLookup = buildIntervalLookup(workbookData.items);
    let asinSourceRows = [];
    let asinReplacements = [];
    let asinStats = null;
    let sourceTables = [];

    if (!args.skipAsin) {
      sourceTables = await discoverSourceTables(connection, args.sourceTables);
      logger.info('[HistoryImport] ASIN 源表列表', { sourceTables });

      for (const tableName of sourceTables) {
        const rows = await fetchSourceRows(
          connection,
          tableName,
          workbookData.items,
          asinIdMap,
        );
        logger.info('[HistoryImport] ASIN 源表扫描完成', {
          tableName,
          rowCount: rows.length,
        });
        asinSourceRows.push(...rows);
      }

      const byTable = asinSourceRows.reduce((accumulator, row) => {
        const key = row.source_table;
        accumulator[key] = (accumulator[key] || 0) + 1;
        return accumulator;
      }, {});
      const asinBuildResult = buildReplacementRows(
        asinSourceRows,
        intervalLookup,
      );
      asinReplacements = asinBuildResult.replacements;
      asinStats = asinBuildResult.stats;

      logger.info('[HistoryImport] ASIN 预演结果', {
        archiveTable,
        affectedAsins: workbookData.itemCount,
        sourceRowsByTable: byTable,
        totalSourceRows: asinStats.totalSourceRows,
        replacementRows: asinReplacements.length,
        changedToBroken: asinStats.changedToBroken,
        changedToNormal: asinStats.changedToNormal,
        unchanged: asinStats.unchanged,
        missingWorkbookKeyRows: asinStats.missingWorkbookKeyRows,
      });
    }

    let groupTargets = [];
    let groupSourceRows = [];
    let groupReplacements = [];
    let groupStats = null;

    if (args.syncGroup) {
      groupTargets = await resolveGroupTargets(
        connection,
        workbookData.items,
        asinIdMap,
      );
      logger.info('[HistoryImport] GROUP 目标范围', {
        groupCount: groupTargets.length,
        groups: groupTargets.slice(0, 20).map((item) => ({
          variantGroupId: item.variant_group_id,
          country: item.country,
          windowStart: toSqlDateTime(item.windowStart),
          windowEnd: toSqlDateTime(item.windowEnd),
        })),
      });

      const groupAsinRows = await fetchGroupScopedRows(
        connection,
        groupTargets,
        'ASIN',
      );
      groupSourceRows = await fetchGroupScopedRows(
        connection,
        groupTargets,
        'GROUP',
      );
      const groupBuildResult = buildGroupReplacementRows(
        groupSourceRows,
        groupAsinRows,
      );
      groupReplacements = groupBuildResult.replacements;
      groupStats = groupBuildResult.stats;

      logger.info('[HistoryImport] GROUP 预演结果', {
        archiveTable,
        groupCount: groupTargets.length,
        sourceGroupRows: groupSourceRows.length,
        sourceAsinRows: groupAsinRows.length,
        replacementRows: groupReplacements.length,
        changedToBroken: groupStats.changedToBroken,
        changedToNormal: groupStats.changedToNormal,
        unchanged: groupStats.unchanged,
        missingAsinSlots: groupStats.missingAsinSlots,
      });
    }

    if (!args.execute) {
      logger.info('[HistoryImport] 当前为预演模式，未执行任何写库操作');
      return;
    }

    await connection.beginTransaction();
    await ensureArchiveTable(connection, archiveTable);

    let archivedCount = 0;
    let deletedCount = 0;
    let insertedCount = 0;

    if (!args.skipAsin) {
      archivedCount += await insertArchiveRows(
        connection,
        archiveTable,
        asinSourceRows,
        args.archiveReason,
      );
      deletedCount += await deleteExistingMainRows(
        connection,
        workbookData.items,
        asinIdMap,
      );
      insertedCount += await insertMainRows(connection, asinReplacements);
    }

    if (args.syncGroup) {
      archivedCount += await insertArchiveRows(
        connection,
        archiveTable,
        groupSourceRows,
        `${args.archiveReason}:group`,
      );
      deletedCount += await deleteMainRowsByIds(
        connection,
        groupSourceRows.map((row) => row.id),
      );
      insertedCount += await insertMainRows(connection, groupReplacements);
    }

    await connection.commit();

    logger.info('[HistoryImport] 执行完成', {
      archiveTable,
      archivedCount,
      deletedCount,
      insertedCount,
      asinChangedToBroken: asinStats?.changedToBroken || 0,
      asinChangedToNormal: asinStats?.changedToNormal || 0,
      groupChangedToBroken: groupStats?.changedToBroken || 0,
      groupChangedToNormal: groupStats?.changedToNormal || 0,
    });
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      logger.warn('[HistoryImport] 回滚失败', {
        message: rollbackError.message,
      });
    }
    logger.error('[HistoryImport] 执行失败', {
      message: error.message,
      stack: error.stack,
    });
    process.exitCode = 1;
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  logger.error('[HistoryImport] 未捕获异常', {
    message: error.message,
    stack: error.stack,
  });
  process.exit(1);
});
