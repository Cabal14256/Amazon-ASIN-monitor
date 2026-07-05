#!/usr/bin/env node

const path = require('path');
const ExcelJS = require('exceljs');
const { loadEnv } = require('./utils/loadEnv');

function parseArgs(argv) {
  const args = {
    file: '',
    envPath: '',
    yes: false,
    skipAggRefresh: false,
    help: false,
  };

  for (const arg of argv) {
    if (arg === '--yes') {
      args.yes = true;
    } else if (arg === '--skip-agg-refresh') {
      args.skipAggRefresh = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg.startsWith('--file=')) {
      args.file = arg.slice('--file='.length).trim();
    } else if (arg.startsWith('--env=')) {
      args.envPath = arg.slice('--env='.length).trim();
    }
  }

  return args;
}

function usage() {
  return [
    '用法:',
    '  node scripts/overwrite-monitor-history-from-weekly-xlsx.js --file="../docs/5.17-5.23.xlsx"',
    '  node scripts/overwrite-monitor-history-from-weekly-xlsx.js --file="../docs/5.17-5.23.xlsx" --yes',
    '参数:',
    '  --file=...             周度变体拆合登记表 xlsx 路径',
    '  --yes                  执行备份和覆盖；不加时仅 dry-run',
    '  --skip-agg-refresh     跳过聚合表刷新',
    '  --env=...              指定 .env 路径（默认 server/.env）',
  ].join('\n');
}

const args = parseArgs(process.argv.slice(2));
const envPath = args.envPath
  ? path.resolve(args.envPath)
  : path.join(__dirname, '../.env');
loadEnv(envPath);

const logger = require('../src/utils/logger');
const { pool, query } = require('../src/config/database');
const analyticsAggService = require('../src/services/analyticsAggService');
const analyticsCacheService = require('../src/services/analyticsCacheService');
const cacheService = require('../src/services/cacheService');

const REQUIRED_HEADERS = {
  site: '站点',
  country: '国家',
  brand: '品牌',
  groupName: '父变体',
  asin: 'ASIN',
  brokenTime: '被拆时间-以监控为准',
  reason: '勿删-未执行原因',
  shareTime: '共享时间',
};

const SQL_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const EXCEL_TO_DB_OFFSET_HOURS = 8;
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatDateUtc(date) {
  return [
    date.getUTCFullYear(),
    '-',
    pad2(date.getUTCMonth() + 1),
    '-',
    pad2(date.getUTCDate()),
    ' ',
    pad2(date.getUTCHours()),
    ':',
    pad2(date.getUTCMinutes()),
    ':',
    pad2(date.getUTCSeconds()),
  ].join('');
}

function parseSqlDateTime(value) {
  const match = String(value || '').match(SQL_DATETIME_RE);
  if (!match) {
    return null;
  }
  const [, year, month, day, hour, minute, second] = match;
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
}

function formatSqlDateTimeFromMs(ms) {
  return formatDateUtc(new Date(ms));
}

function excelDateToDbSql(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return '';
  }
  return formatDateUtc(
    new Date(value.getTime() + EXCEL_TO_DB_OFFSET_HOURS * MS_PER_HOUR),
  );
}

function getDayStartSql(sqlDateTime) {
  const ms = parseSqlDateTime(sqlDateTime);
  if (ms === null) {
    return '';
  }
  const date = new Date(ms);
  return [
    date.getUTCFullYear(),
    '-',
    pad2(date.getUTCMonth() + 1),
    '-',
    pad2(date.getUTCDate()),
    ' 00:00:00',
  ].join('');
}

function getNextDayStartSql(sqlDateTime) {
  const dayStartMs = parseSqlDateTime(getDayStartSql(sqlDateTime));
  return formatSqlDateTimeFromMs(dayStartMs + MS_PER_DAY);
}

function getDayEndSql(sqlDateTime) {
  const nextDayStartMs = parseSqlDateTime(getNextDayStartSql(sqlDateTime));
  return formatSqlDateTimeFromMs(nextDayStartMs - 1000);
}

function compareSqlDateTime(a, b) {
  return parseSqlDateTime(a) - parseSqlDateTime(b);
}

function isTimeInInterval(time, interval) {
  return (
    compareSqlDateTime(time, interval.start) >= 0 &&
    compareSqlDateTime(time, interval.end) < 0
  );
}

function safeJsonParse(value) {
  if (!value) {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch (error) {
    return {};
  }
}

function normalizeCellValue(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object' && value.text) {
    return String(value.text).trim();
  }
  return String(value).trim();
}

function getHeaderIndexes(headers) {
  const indexes = {};
  const missing = [];

  for (const [key, headerName] of Object.entries(REQUIRED_HEADERS)) {
    const index = headers.findIndex((header) => header === headerName);
    if (index === -1) {
      missing.push(headerName);
    } else {
      indexes[key] = index + 1;
    }
  }

  if (missing.length > 0) {
    throw new Error(`Excel缺少必要列: ${missing.join('、')}`);
  }

  return indexes;
}

function normalizeFallbackGroupName(entry) {
  const beforeFbt = String(entry.excelGroupName || '').split('-FBT-')[0];
  const parts = beforeFbt.split('-').filter(Boolean);
  if (parts.length >= 2 && /^\d+$/.test(parts[0]) && parts[1] === entry.site) {
    return parts.slice(1).join('-');
  }
  return beforeFbt || entry.excelGroupName;
}

async function parseWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('Excel文件不包含工作表');
  }

  const headers = worksheet.getRow(1).values.slice(1).map(normalizeCellValue);
  const indexes = getHeaderIndexes(headers);
  const entries = [];

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const hasData = row.values
      .slice(1)
      .some((value) => normalizeCellValue(value) !== '');
    if (!hasData) {
      continue;
    }

    const site = normalizeCellValue(row.getCell(indexes.site).value);
    const country = normalizeCellValue(
      row.getCell(indexes.country).value,
    ).toUpperCase();
    const brand = normalizeCellValue(row.getCell(indexes.brand).value);
    const excelGroupName = normalizeCellValue(
      row.getCell(indexes.groupName).value,
    );
    const asin = normalizeCellValue(
      row.getCell(indexes.asin).value,
    ).toUpperCase();
    const reason = normalizeCellValue(row.getCell(indexes.reason).value);
    const start = excelDateToDbSql(row.getCell(indexes.brokenTime).value);
    const end = excelDateToDbSql(row.getCell(indexes.shareTime).value);

    if (!site || !country || !brand || !excelGroupName || !asin) {
      throw new Error(`第 ${rowNumber} 行存在必填字段为空`);
    }
    if (!start || !end) {
      throw new Error(`第 ${rowNumber} 行缺少有效的被拆时间或共享时间`);
    }
    if (compareSqlDateTime(end, start) <= 0) {
      throw new Error(
        `第 ${rowNumber} 行共享时间不能早于或等于被拆时间: ${start} ~ ${end}`,
      );
    }

    entries.push({
      rowNumber,
      site,
      country,
      brand,
      excelGroupName,
      asin,
      asinName: '',
      reason,
      start,
      end,
      groupName: '',
      variantGroupId: null,
    });
  }

  if (entries.length === 0) {
    throw new Error('Excel没有可导入的数据行');
  }

  return { worksheetName: worksheet.name, entries };
}

function pairKey(asin, country) {
  return `${country}||${asin}`;
}

function groupKey(country, groupName) {
  return `${country}||${groupName}`;
}

function groupIdKey(variantGroupId) {
  return `ID||${variantGroupId}`;
}

function uniqueByKey(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function buildOrConditions(items, conditionBuilder) {
  const clauses = [];
  const params = [];
  for (const item of items) {
    const { clause, values } = conditionBuilder(item);
    clauses.push(`(${clause})`);
    params.push(...values);
  }
  return {
    sql: clauses.join(' OR '),
    params,
  };
}

async function enrichEntries(entries) {
  const pairs = uniqueByKey(entries, (entry) =>
    pairKey(entry.asin, entry.country),
  );
  const pairWhere = buildOrConditions(pairs, (entry) => ({
    clause: 'a.asin = ? AND a.country = ?',
    values: [entry.asin, entry.country],
  }));

  const rows = await query(
    `SELECT
       a.id,
       a.asin,
       a.name,
       a.country,
       a.site,
       a.brand,
       a.variant_group_id,
       vg.name as variant_group_name
     FROM asins a
     LEFT JOIN variant_groups vg ON vg.id = a.variant_group_id
     WHERE ${pairWhere.sql}`,
    pairWhere.params,
  );
  const asinMap = new Map(
    rows.map((row) => [pairKey(row.asin, row.country), row]),
  );

  const missing = [];
  for (const entry of entries) {
    const matched = asinMap.get(pairKey(entry.asin, entry.country));
    if (!matched) {
      missing.push(`${entry.country}/${entry.asin}`);
      entry.groupName = normalizeFallbackGroupName(entry);
      continue;
    }
    entry.asinName = matched.name || '';
    entry.groupName =
      matched.variant_group_name || normalizeFallbackGroupName(entry);
    entry.variantGroupId = matched.variant_group_id || null;
  }

  if (missing.length > 0) {
    logger.warn(
      '[周度历史覆盖] 部分ASIN未在当前ASIN表中找到，使用Excel父变体名回退:',
      {
        missing,
      },
    );
  }
}

function buildIntervals(entries) {
  const intervalsByPair = new Map();
  const intervalsByGroup = new Map();
  const intervalsByGroupId = new Map();

  for (const entry of entries) {
    const pair = pairKey(entry.asin, entry.country);
    if (!intervalsByPair.has(pair)) {
      intervalsByPair.set(pair, []);
    }
    intervalsByPair.get(pair).push(entry);

    const group = groupKey(entry.country, entry.groupName);
    if (!intervalsByGroup.has(group)) {
      intervalsByGroup.set(group, []);
    }
    intervalsByGroup.get(group).push(entry);

    if (entry.variantGroupId) {
      const groupId = groupIdKey(entry.variantGroupId);
      if (!intervalsByGroupId.has(groupId)) {
        intervalsByGroupId.set(groupId, []);
      }
      intervalsByGroupId.get(groupId).push(entry);
    }
  }

  for (const list of intervalsByPair.values()) {
    list.sort((a, b) => compareSqlDateTime(a.start, b.start));
  }
  for (const list of intervalsByGroup.values()) {
    list.sort((a, b) => compareSqlDateTime(a.start, b.start));
  }
  for (const list of intervalsByGroupId.values()) {
    list.sort((a, b) => compareSqlDateTime(a.start, b.start));
  }

  return { intervalsByPair, intervalsByGroup, intervalsByGroupId };
}

function findPairMatch(row, intervalsByPair) {
  const list = intervalsByPair.get(pairKey(row.asin_code, row.country)) || [];
  return list.find((entry) => isTimeInInterval(row.check_time, entry)) || null;
}

function findGroupMatches(row, intervalsByGroup) {
  const candidateLists = [];
  if (row.variant_group_id && intervalsByGroup.intervalsByGroupId) {
    candidateLists.push(
      intervalsByGroup.intervalsByGroupId.get(
        groupIdKey(row.variant_group_id),
      ) || [],
    );
  }
  candidateLists.push(
    intervalsByGroup.intervalsByGroup.get(
      groupKey(row.country, row.variant_group_name),
    ) || [],
  );
  const matches = candidateLists
    .flat()
    .filter((entry) => isTimeInInterval(row.check_time, entry));
  const byAsin = new Map();
  for (const match of matches) {
    byAsin.set(match.asin, match);
  }
  return Array.from(byAsin.values());
}

function patchAsinCheckResult(row, match, sourceName) {
  const payload = safeJsonParse(row.check_result);
  payload.asin = payload.asin || row.asin_code;
  payload.isBroken = Boolean(match);
  payload.statusSource = 'NORMAL';
  payload.manualBrokenReason = payload.manualBrokenReason || '';
  payload.manualRepair = {
    source: sourceName,
    rule: 'attachment_full_sheet',
    matchedInterval: Boolean(match),
    intervalStart: match ? match.start : null,
    intervalEnd: match ? match.end : null,
    reason: match ? match.reason || null : null,
    rowNumber: match ? match.rowNumber : null,
  };
  return JSON.stringify(payload);
}

function patchGroupCheckResult(row, matches, sourceName) {
  const payload = safeJsonParse(row.check_result);
  const brokenASINs = matches.map((match) => ({
    asin: match.asin,
    name: match.asinName || '',
    statusSource: 'NORMAL',
  }));

  payload.isBroken = brokenASINs.length > 0;
  payload.brokenASINs = brokenASINs;
  payload.brokenByType = payload.brokenByType || {
    SP_API_ERROR: 0,
    NO_VARIANTS: 0,
  };
  payload.manualRepair = {
    source: sourceName,
    rule: 'group_rebuild_from_attachment',
    childBrokenCount: brokenASINs.length,
  };
  return JSON.stringify(payload);
}

async function fetchTargetRows(entries, coverageStart, coverageEnd) {
  const pairs = uniqueByKey(entries, (entry) =>
    pairKey(entry.asin, entry.country),
  );
  const pairWhere = buildOrConditions(pairs, (entry) => ({
    clause: 'asin_code = ? AND country = ?',
    values: [entry.asin, entry.country],
  }));
  const asinRows = await query(
    `SELECT
       id,
       asin_code,
       country,
       is_broken,
       DATE_FORMAT(check_time, '%Y-%m-%d %H:%i:%s') as check_time
     FROM monitor_history
     WHERE check_type = 'ASIN'
       AND check_time >= ?
       AND check_time <= ?
       AND (${pairWhere.sql})
     ORDER BY check_time, id`,
    [coverageStart, coverageEnd, ...pairWhere.params],
  );

  const groups = uniqueByKey(entries, (entry) =>
    entry.variantGroupId
      ? groupIdKey(entry.variantGroupId)
      : groupKey(entry.country, entry.groupName),
  );
  const groupRowsById = new Map();
  const groupIds = Array.from(
    new Set(groups.map((entry) => entry.variantGroupId).filter(Boolean)),
  );
  if (groupIds.length > 0) {
    const groupIdPlaceholders = groupIds.map(() => '?').join(',');
    const rows = await query(
      `SELECT
         id,
         variant_group_id,
         variant_group_name,
         country,
         is_broken,
         DATE_FORMAT(check_time, '%Y-%m-%d %H:%i:%s') as check_time
       FROM monitor_history
       WHERE check_type = 'GROUP'
         AND check_time >= ?
         AND check_time <= ?
         AND variant_group_id IN (${groupIdPlaceholders})
       ORDER BY check_time, id`,
      [coverageStart, coverageEnd, ...groupIds],
    );
    for (const row of rows) {
      groupRowsById.set(row.id, row);
    }
  }

  const fallbackGroups = groups.filter((entry) => !entry.variantGroupId);
  if (fallbackGroups.length > 0) {
    const groupWhere = buildOrConditions(fallbackGroups, (entry) => ({
      clause: 'country = ? AND variant_group_name = ?',
      values: [entry.country, entry.groupName],
    }));
    const rows = await query(
      `SELECT
         id,
         variant_group_id,
         variant_group_name,
         country,
         is_broken,
         DATE_FORMAT(check_time, '%Y-%m-%d %H:%i:%s') as check_time
       FROM monitor_history
       WHERE check_type = 'GROUP'
         AND check_time >= ?
         AND check_time <= ?
         AND (${groupWhere.sql})
       ORDER BY check_time, id`,
      [coverageStart, coverageEnd, ...groupWhere.params],
    );
    for (const row of rows) {
      groupRowsById.set(row.id, row);
    }
  }

  const groupRows = Array.from(groupRowsById.values()).sort((a, b) => {
    const timeCompare = compareSqlDateTime(a.check_time, b.check_time);
    return timeCompare === 0 ? Number(a.id) - Number(b.id) : timeCompare;
  });

  return { asinRows, groupRows };
}

function buildPlans({ asinRows, groupRows }, intervals, sourceName) {
  const asinPlans = asinRows.map((row) => {
    const match = findPairMatch(row, intervals.intervalsByPair);
    const nextBroken = match ? 1 : 0;
    return {
      id: row.id,
      nextBroken,
      previousBroken: Number(row.is_broken || 0),
      type: 'ASIN',
      checkTime: row.check_time,
      asin_code: row.asin_code,
      match,
    };
  });

  const groupPlans = groupRows.map((row) => {
    const matches = findGroupMatches(row, intervals);
    const nextBroken = matches.length > 0 ? 1 : 0;
    return {
      id: row.id,
      nextBroken,
      previousBroken: Number(row.is_broken || 0),
      type: 'GROUP',
      checkTime: row.check_time,
      matches,
    };
  });

  return { asinPlans, groupPlans, allPlans: [...asinPlans, ...groupPlans] };
}

function summarizePlans(plans) {
  const changed = plans.filter(
    (plan) => plan.previousBroken !== plan.nextBroken,
  );
  return {
    totalRowsToPatch: plans.length,
    statusChangedRows: changed.length,
    toBrokenRows: changed.filter((plan) => plan.nextBroken === 1).length,
    toNormalRows: changed.filter((plan) => plan.nextBroken === 0).length,
  };
}

function buildBackupSuffix() {
  const now = new Date();
  return [
    now.getFullYear(),
    pad2(now.getMonth() + 1),
    pad2(now.getDate()),
    '_',
    pad2(now.getHours()),
    pad2(now.getMinutes()),
    pad2(now.getSeconds()),
  ].join('');
}

function assertSafeBackupName(tableName) {
  if (!/^[a-zA-Z0-9_]+$/.test(tableName) || tableName.length > 64) {
    throw new Error(`备份表名非法: ${tableName}`);
  }
}

async function backupBySelect(tableName, selectSql, params) {
  assertSafeBackupName(tableName);
  await query(`DROP TABLE IF EXISTS \`${tableName}\``);
  await query(`CREATE TABLE \`${tableName}\` AS ${selectSql}`, params);
  const [row] = await query(`SELECT COUNT(*) as total FROM \`${tableName}\``);
  return Number(row?.total || 0);
}

async function createBackups({
  plans,
  entries,
  coverageAggStart,
  coverageAggEnd,
}) {
  const suffix = buildBackupSuffix();
  const backupTables = {};
  const ids = plans.map((plan) => plan.id);

  if (ids.length === 0) {
    throw new Error('没有可备份的目标历史记录，停止覆盖');
  }

  const idPlaceholders = ids.map(() => '?').join(',');
  const mhTable = `mh_bak_${suffix}`;
  backupTables.monitorHistory = {
    table: mhTable,
    rows: await backupBySelect(
      mhTable,
      `SELECT * FROM monitor_history WHERE id IN (${idPlaceholders})`,
      ids,
    ),
  };

  const affectedPairs = uniqueByKey(entries, (entry) =>
    pairKey(entry.asin, entry.country),
  );
  const countries = Array.from(
    new Set(affectedPairs.map((entry) => entry.country)),
  );
  const asins = Array.from(new Set(affectedPairs.map((entry) => entry.asin)));
  const groupNames = Array.from(
    new Set(entries.map((entry) => entry.groupName)),
  );
  const variantGroupIds = Array.from(
    new Set(entries.map((entry) => entry.variantGroupId).filter(Boolean)),
  );
  const countryPlaceholders = countries.map(() => '?').join(',');
  const asinPlaceholders = asins.map(() => '?').join(',');
  const groupPlaceholders = groupNames.map(() => '?').join(',');

  const aggTable = `mha_bak_${suffix}`;
  backupTables.monitorHistoryAgg = {
    table: aggTable,
    rows: await backupBySelect(
      aggTable,
      `SELECT * FROM monitor_history_agg
       WHERE country IN (${countryPlaceholders})
         AND asin_key IN (${asinPlaceholders})
         AND time_slot >= ?
         AND time_slot <= ?`,
      [...countries, ...asins, coverageAggStart, coverageAggEnd],
    ),
  };

  const aggDimTable = `mhad_bak_${suffix}`;
  backupTables.monitorHistoryAggDim = {
    table: aggDimTable,
    rows: await backupBySelect(
      aggDimTable,
      `SELECT * FROM monitor_history_agg_dim
       WHERE country IN (${countryPlaceholders})
         AND asin_key IN (${asinPlaceholders})
         AND time_slot >= ?
         AND time_slot <= ?`,
      [...countries, ...asins, coverageAggStart, coverageAggEnd],
    ),
  };

  const aggVariantTable = `mhavg_bak_${suffix}`;
  const aggVariantClauses = [];
  const aggVariantParams = [
    ...countries,
    ...asins,
    coverageAggStart,
    coverageAggEnd,
  ];
  if (variantGroupIds.length > 0) {
    const variantGroupIdPlaceholders = variantGroupIds.map(() => '?').join(',');
    aggVariantClauses.push(
      `variant_group_id IN (${variantGroupIdPlaceholders})`,
    );
    aggVariantParams.push(...variantGroupIds);
  }
  if (groupNames.length > 0) {
    aggVariantClauses.push(`variant_group_name IN (${groupPlaceholders})`);
    aggVariantParams.push(...groupNames);
  }
  backupTables.monitorHistoryAggVariantGroup = {
    table: aggVariantTable,
    rows: await backupBySelect(
      aggVariantTable,
      `SELECT * FROM monitor_history_agg_variant_group
       WHERE country IN (${countryPlaceholders})
         AND asin_key IN (${asinPlaceholders})
         AND time_slot >= ?
         AND time_slot <= ?
         AND (${aggVariantClauses.join(' OR ')})`,
      aggVariantParams,
    ),
  };

  return backupTables;
}

async function applyPlans(plans, sourceName) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    for (const chunk of chunkArray(plans, 50)) {
      const ids = chunk.map((plan) => plan.id);
      const placeholders = ids.map(() => '?').join(',');
      const [rows] = await connection.execute(
        `SELECT id, check_result
         FROM monitor_history
         WHERE id IN (${placeholders})
         FOR UPDATE`,
        ids,
      );
      const checkResultById = new Map(
        rows.map((row) => [String(row.id), row.check_result]),
      );

      for (const plan of chunk) {
        const currentRow = {
          ...plan,
          check_result: checkResultById.get(String(plan.id)) || null,
        };
        const nextCheckResult =
          plan.type === 'ASIN'
            ? patchAsinCheckResult(currentRow, plan.match, sourceName)
            : patchGroupCheckResult(currentRow, plan.matches, sourceName);

        await connection.execute(
          `UPDATE monitor_history
           SET is_broken = ?, check_result = ?
           WHERE id = ?`,
          [plan.nextBroken, nextCheckResult, plan.id],
        );
      }
    }

    await connection.commit();
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      logger.error('[周度历史覆盖] 回滚失败:', rollbackError.message);
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function refreshAggregates(coverageAggStart, coverageAggEnd) {
  const hourResult = await analyticsAggService.refreshAnalyticsAggBundle(
    'hour',
    {
      startTime: coverageAggStart,
      endTime: coverageAggEnd,
    },
  );
  const dayResult = await analyticsAggService.refreshAnalyticsAggBundle('day', {
    startTime: coverageAggStart,
    endTime: coverageAggEnd,
  });

  cacheService.deleteByPrefix('monitorHistoryCount:');
  cacheService.deleteByPrefix('statusChangesCount:');
  await analyticsCacheService.deleteByPrefix('statisticsByTime:');
  await analyticsCacheService.deleteByPrefix('allCountriesSummary:');
  await analyticsCacheService.deleteByPrefix('regionSummary:');
  await analyticsCacheService.deleteByPrefix('periodSummary:');
  await analyticsCacheService.deleteByPrefix('asinStatisticsByCountry:');
  await analyticsCacheService.deleteByPrefix('asinStatisticsByVariantGroup:');

  return { hourResult, dayResult };
}

async function verify(entries, coverageStart, coverageEnd, sourceName) {
  const pairs = uniqueByKey(entries, (entry) =>
    pairKey(entry.asin, entry.country),
  );
  const pairWhere = buildOrConditions(pairs, (entry) => ({
    clause: 'asin_code = ? AND country = ?',
    values: [entry.asin, entry.country],
  }));

  const summary = await query(
    `SELECT
       asin_code,
       country,
       COUNT(*) as total_rows,
       SUM(is_broken = 1) as broken_rows,
       DATE_FORMAT(MIN(check_time), '%Y-%m-%d %H:%i:%s') as min_time,
       DATE_FORMAT(MAX(check_time), '%Y-%m-%d %H:%i:%s') as max_time
     FROM monitor_history
     WHERE check_type = 'ASIN'
       AND check_time >= ?
       AND check_time <= ?
       AND (${pairWhere.sql})
     GROUP BY asin_code, country
     ORDER BY country, asin_code`,
    [coverageStart, coverageEnd, ...pairWhere.params],
  );

  const intervalChecks = [];
  for (const entry of entries) {
    const [row] = await query(
      `SELECT COUNT(*) as total_rows, SUM(is_broken = 1) as broken_rows
       FROM monitor_history
       WHERE check_type = 'ASIN'
         AND asin_code = ?
         AND country = ?
         AND check_time >= ?
         AND check_time < ?`,
      [entry.asin, entry.country, entry.start, entry.end],
    );
    intervalChecks.push({
      rowNumber: entry.rowNumber,
      asin: entry.asin,
      country: entry.country,
      start: entry.start,
      end: entry.end,
      totalRows: Number(row?.total_rows || 0),
      brokenRows: Number(row?.broken_rows || 0),
    });
  }

  const manualRepairCounts = await query(
    `SELECT
       check_type,
       JSON_UNQUOTE(JSON_EXTRACT(check_result, '$.manualRepair.rule')) as rule,
       COUNT(*) as total
     FROM monitor_history
     WHERE check_time >= ?
       AND check_time <= ?
       AND JSON_UNQUOTE(JSON_EXTRACT(check_result, '$.manualRepair.source')) = ?
       AND (
         (${pairWhere.sql} AND check_type = 'ASIN')
         OR check_type = 'GROUP'
       )
     GROUP BY check_type, rule
     ORDER BY check_type, rule`,
    [coverageStart, coverageEnd, sourceName, ...pairWhere.params],
  );

  return { summary, intervalChecks, manualRepairCounts };
}

async function main() {
  if (args.help || !args.file) {
    logger.info(usage());
    return 0;
  }

  const filePath = path.resolve(process.cwd(), args.file);
  const sourceName = path.basename(filePath);
  const lockName = 'overwrite_monitor_history_from_weekly_xlsx';

  logger.info('[周度历史覆盖] 开始解析Excel:', {
    filePath,
    dryRun: !args.yes,
  });

  const { worksheetName, entries } = await parseWorkbook(filePath);
  await enrichEntries(entries);

  const coverageStart = entries
    .map((entry) => entry.start)
    .sort(compareSqlDateTime)[0];
  const coverageEnd = entries
    .map((entry) => entry.end)
    .sort(compareSqlDateTime)
    .at(-1);
  const coverageAggStart = getDayStartSql(coverageStart);
  const coverageAggEnd = getDayEndSql(coverageEnd);
  const intervals = buildIntervals(entries);
  const targetRows = await fetchTargetRows(entries, coverageStart, coverageEnd);
  const plans = buildPlans(targetRows, intervals, sourceName);
  const planSummary = {
    worksheetName,
    sourceName,
    entries: entries.length,
    affectedAsins: intervals.intervalsByPair.size,
    affectedGroups: intervals.intervalsByGroup.size,
    affectedGroupIds: intervals.intervalsByGroupId.size,
    coverageStart,
    coverageEnd,
    coverageAggStart,
    coverageAggEnd,
    asinRows: targetRows.asinRows.length,
    groupRows: targetRows.groupRows.length,
    asinPlan: summarizePlans(plans.asinPlans),
    groupPlan: summarizePlans(plans.groupPlans),
  };

  logger.info('[周度历史覆盖] 计划摘要:', planSummary);

  const [lockRow] = await query('SELECT GET_LOCK(?, 5) as locked', [lockName]);
  if (Number(lockRow?.locked) !== 1) {
    throw new Error('获取数据库锁失败，可能已有覆盖任务在执行');
  }

  try {
    if (!args.yes) {
      logger.warn('[周度历史覆盖] 当前为 dry-run，未创建备份表，未更新数据');
      return 0;
    }

    const backupTables = await createBackups({
      plans: plans.allPlans,
      entries,
      coverageAggStart,
      coverageAggEnd,
    });
    logger.info('[周度历史覆盖] 备份完成:', backupTables);

    await applyPlans(plans.allPlans, sourceName);
    logger.info('[周度历史覆盖] monitor_history 覆盖完成:', {
      updatedRows: plans.allPlans.length,
    });

    let aggResult = { skipped: true };
    if (!args.skipAggRefresh) {
      aggResult = await refreshAggregates(coverageAggStart, coverageAggEnd);
      logger.info('[周度历史覆盖] 聚合表刷新和缓存清理完成');
    }

    const verification = await verify(
      entries,
      coverageStart,
      coverageEnd,
      sourceName,
    );
    logger.info('[周度历史覆盖] 验证结果:', {
      verification,
      backupTables,
      aggResult,
    });

    return 0;
  } finally {
    try {
      await query('SELECT RELEASE_LOCK(?) as released', [lockName]);
    } catch (error) {
      logger.warn('[周度历史覆盖] 释放数据库锁失败:', error.message);
    }
  }
}

main()
  .then(async (code) => {
    await pool.end();
    process.exit(code);
  })
  .catch(async (error) => {
    logger.error('[周度历史覆盖] 执行失败:', {
      message: error.message,
    });
    try {
      await pool.end();
    } catch (poolError) {
      logger.warn('[周度历史覆盖] 关闭连接池失败:', poolError.message);
    }
    process.exit(1);
  });
