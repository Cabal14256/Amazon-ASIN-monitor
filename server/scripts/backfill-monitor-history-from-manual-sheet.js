require('dotenv').config({ path: 'server/.env' });

const { spawnSync } = require('child_process');
const path = require('path');

const MonitorHistory = require('../src/models/MonitorHistory');
const { query } = require('../src/config/database');
const {
  refreshAnalyticsAggBundle,
  refreshMonitorHistoryStatusIntervals,
} = require('../src/services/analyticsAggService');
const logger = require('../src/utils/logger');

const FILE =
  'C:\\Users\\Admin\\Downloads\\技术部日常表格_1-1 变体拆合登记表_登记-被拆变体.xlsx';
const START = '2026-03-01 00:00:00';
const END = '2026-03-31 23:59:59';
const SAFE_LAG_MINUTES = 20;
const CHUNK = 500;
const SOURCES = ['MANUAL_SHEET_BACKFILL', 'MANUAL_SHEET_TIMELINE_BACKFILL'];
const COUNTRIES = ['US', 'UK', 'DE', 'FR', 'ES', 'IT'];
const INTERVALS = { US: 30, UK: 60, DE: 60, FR: 60, ES: 60, IT: 60 };

function parseArgs(argv = []) {
  const options = { file: FILE, startTime: START, endTime: END, apply: false };
  argv.forEach((arg) => {
    if (arg === '--apply') {
      options.apply = true;
    } else if (arg.startsWith('--file=')) {
      options.file = arg.slice(7);
    } else if (arg.startsWith('--start=')) {
      options.startTime = arg.slice(8);
    } else if (arg.startsWith('--end=')) {
      options.endTime = arg.slice(6);
    }
  });
  return options;
}

function parseSqlText(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }
  const text = String(value).trim().replace('T', ' ');
  const match = text.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (!match) {
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const [, y, m, d, hh = '00', mm = '00', ss = '00'] = match;
  const parsed = new Date(
    Number(y),
    Number(m) - 1,
    Number(d),
    Number(hh),
    Number(mm),
    Number(ss),
    0,
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatSqlText(value) {
  const date = parseSqlText(value);
  if (!date) {
    return '';
  }
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function addMinutes(value, minutes) {
  const date = parseSqlText(value);
  if (!date) {
    return null;
  }
  date.setMinutes(date.getMinutes() + minutes);
  return date;
}

function getCountry(country) {
  const normalized = String(country || '')
    .trim()
    .toUpperCase();
  return COUNTRIES.includes(normalized) ? normalized : '';
}

function getPairKey(country, asin) {
  return `${country}|${asin}`;
}

function getSlotText(country, value) {
  const date = parseSqlText(value);
  if (!date) {
    return '';
  }
  const normalized = getCountry(country);
  if (!normalized) {
    return '';
  }
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  if (normalized === 'US') {
    const minute = date.getMinutes() >= 30 ? '30' : '00';
    return `${yyyy}-${mm}-${dd} ${hh}:${minute}:00`;
  }
  return `${yyyy}-${mm}-${dd} ${hh}:00:00`;
}

function floorToSlot(country, value) {
  const date = parseSqlText(value);
  if (!date) {
    return null;
  }
  date.setSeconds(0, 0);
  if (country === 'US') {
    date.setMinutes(date.getMinutes() >= 30 ? 30 : 0, 0, 0);
    return date;
  }
  date.setMinutes(0, 0, 0);
  return date;
}

function slotRange(country, startTime, endTime) {
  const start = parseSqlText(startTime);
  const end = parseSqlText(endTime);
  if (!start || !end || end < start) {
    return [];
  }
  const slots = [];
  const interval = INTERVALS[country] || 60;
  let cursor = floorToSlot(country, start);
  while (cursor && cursor < start) {
    cursor = addMinutes(cursor, interval);
  }
  while (cursor && cursor <= end) {
    slots.push(formatSqlText(cursor));
    cursor = addMinutes(cursor, interval);
  }
  return slots;
}

function buildPythonParser(filePath) {
  const escaped = String(filePath).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `
import json
from openpyxl import load_workbook

def cell_text(value):
    if value is None:
        return None
    if hasattr(value, 'strftime'):
        return value.strftime('%Y-%m-%d %H:%M:%S')
    return str(value).strip()

def find_index(headers, names, required=False):
    for name in names:
        if name in headers:
            return headers.index(name)
    if required:
        raise ValueError(f'缺少列: {" / ".join(names)}')
    return None

wb = load_workbook('${escaped}', read_only=True, data_only=True)
ws = wb[wb.sheetnames[0]]
rows = []
header_row = next(ws.iter_rows(values_only=True))
headers = ['' if value is None else str(value).strip() for value in header_row]
site_idx = find_index(headers, ['站点'], True)
region_idx = find_index(headers, ['区域'])
country_idx = find_index(headers, ['国家'], True)
brand_idx = find_index(headers, ['品牌'], True)
asin_idx = find_index(headers, ['ASIN'], True)
broken_idx = find_index(headers, ['被拆时间-以监控为准'], True)
execute_idx = find_index(headers, ['执行时间'])

for idx, row in enumerate(ws.iter_rows(values_only=True), start=2):
    values = list(row)
    broken_time = cell_text(values[broken_idx]) if broken_idx is not None and broken_idx < len(values) else None
    execute_time = cell_text(values[execute_idx]) if execute_idx is not None and execute_idx < len(values) else None
    execute_time = None if execute_time in (None, '', '未执行') else execute_time
    rows.append({
        'rowNumber': idx,
        'site': '' if site_idx is None or site_idx >= len(values) or values[site_idx] is None else str(values[site_idx]).strip(),
        'region': '' if region_idx is None or region_idx >= len(values) or values[region_idx] is None else str(values[region_idx]).strip(),
        'country': '' if country_idx >= len(values) or values[country_idx] is None else str(values[country_idx]).strip().upper(),
        'brand': '' if brand_idx >= len(values) or values[brand_idx] is None else str(values[brand_idx]).strip(),
        'asin': '' if asin_idx >= len(values) or values[asin_idx] is None else str(values[asin_idx]).strip().upper(),
        'brokenTime': broken_time,
        'executeTime': execute_time,
    })
print(json.dumps(rows, ensure_ascii=False))
`;
}

function loadSheetRows(filePath) {
  const result = spawnSync('python', ['-c', buildPythonParser(filePath)], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || '解析 Excel 失败');
  }
  return JSON.parse(result.stdout || '[]');
}

function syntheticFilter(alias = 'mh') {
  return `( ${alias}.check_result IS NULL OR (${SOURCES.map(
    () => `${alias}.check_result NOT LIKE ?`,
  ).join(' AND ')}) )`;
}

function syntheticParams() {
  return SOURCES.map((source) => `%${source}%`);
}

function merge(base = {}, patch = {}) {
  const next = { ...base };
  Object.entries(patch).forEach(([key, value]) => {
    if (
      key === 'mappingSources' ||
      key === 'activeFrom' ||
      key === 'activeTo'
    ) {
      return;
    }
    if (value !== undefined && value !== null && value !== '') {
      next[key] = value;
    } else if (!(key in next)) {
      next[key] = value;
    }
  });
  next.mappingSources = Array.from(
    new Set([...(base.mappingSources || []), ...(patch.mappingSources || [])]),
  );
  const activeFrom = [base.activeFrom, patch.activeFrom]
    .filter(Boolean)
    .sort()[0];
  const activeTo = [base.activeTo, patch.activeTo]
    .filter(Boolean)
    .sort()
    .slice(-1)[0];
  if (activeFrom) {
    next.activeFrom = activeFrom;
  }
  if (activeTo) {
    next.activeTo = activeTo;
  }
  return next;
}

async function loadCurrentUniverse(endTime) {
  const rows = await query(
    `
      SELECT
        a.id, a.asin, a.name, a.country, a.site, a.brand,
        a.variant_group_id, vg.name AS variant_group_name, a.create_time
      FROM asins a
      LEFT JOIN variant_groups vg ON vg.id = a.variant_group_id
      WHERE a.country IN (${COUNTRIES.map(() => '?').join(',')})
        AND a.create_time <= ?
    `,
    [...COUNTRIES, endTime],
  );
  const map = new Map();
  rows.forEach((row) => {
    const country = getCountry(row.country);
    const asin = String(row.asin || '')
      .trim()
      .toUpperCase();
    if (!country || !asin) {
      return;
    }
    const key = getPairKey(country, asin);
    map.set(
      key,
      merge(map.get(key), {
        asinId: row.id || null,
        asinCode: asin,
        asinName: row.name || null,
        country,
        siteSnapshot: row.site || null,
        brandSnapshot: row.brand || null,
        variantGroupId: row.variant_group_id || null,
        variantGroupName: row.variant_group_name || null,
        activeFrom: formatSqlText(row.create_time || START),
        activeTo: endTime,
        mappingSources: ['asins'],
      }),
    );
  });
  return map;
}

async function loadHistoryUniverse(startTime, endTime) {
  const rows = await query(
    `
      SELECT
        COALESCE(NULLIF(mh.asin_code, ''), a.asin) AS asin_code,
        COALESCE(mh.country, a.country) AS country,
        mh.asin_id,
        COALESCE(NULLIF(mh.asin_name, ''), a.name) AS asin_name,
        COALESCE(NULLIF(mh.site_snapshot, ''), a.site) AS site_snapshot,
        COALESCE(NULLIF(mh.brand_snapshot, ''), a.brand) AS brand_snapshot,
        mh.variant_group_id,
        COALESCE(NULLIF(mh.variant_group_name, ''), vg.name) AS variant_group_name,
        mh.check_time
      FROM monitor_history mh
      LEFT JOIN asins a ON a.id = mh.asin_id
      LEFT JOIN variant_groups vg ON vg.id = mh.variant_group_id
      WHERE mh.check_type = 'ASIN'
        AND mh.check_time >= ?
        AND mh.check_time <= ?
        AND COALESCE(mh.country, a.country) IN (${COUNTRIES.map(() => '?').join(
          ',',
        )})
        AND ${syntheticFilter('mh')}
      ORDER BY mh.check_time DESC
    `,
    [startTime, endTime, ...COUNTRIES, ...syntheticParams()],
  );
  const map = new Map();
  rows.forEach((row) => {
    const country = getCountry(row.country);
    const asin = String(row.asin_code || '')
      .trim()
      .toUpperCase();
    if (!country || !asin) {
      return;
    }
    const key = getPairKey(country, asin);
    map.set(
      key,
      merge(map.get(key), {
        asinId: row.asin_id || null,
        asinCode: asin,
        asinName: row.asin_name || null,
        country,
        siteSnapshot: row.site_snapshot || null,
        brandSnapshot: row.brand_snapshot || null,
        variantGroupId: row.variant_group_id || null,
        variantGroupName: row.variant_group_name || null,
        activeFrom: formatSqlText(row.check_time),
        activeTo: formatSqlText(row.check_time),
        mappingSources: ['history'],
      }),
    );
  });
  return map;
}

function buildIntervals(rows, endTime) {
  const map = new Map();
  rows.forEach((row) => {
    const country = getCountry(row.country);
    const asin = String(row.asin || '')
      .trim()
      .toUpperCase();
    const intervalEnd =
      row.executeTime && row.executeTime > row.brokenTime
        ? row.executeTime
        : endTime;
    if (!country || !asin || !row.brokenTime || intervalEnd <= row.brokenTime) {
      return;
    }
    const key = getPairKey(country, asin);
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push({
      start: row.brokenTime,
      end: intervalEnd,
      rowNumber: row.rowNumber,
      sourceSite: row.site || '',
      sourceBrand: row.brand || '',
      sourceRegion: row.region || '',
    });
  });
  map.forEach((items, key) => {
    const merged = [...items]
      .sort((a, b) => a.start.localeCompare(b.start))
      .reduce((acc, item) => {
        const last = acc[acc.length - 1];
        if (!last || item.start > last.end) {
          acc.push({ ...item, rowNumbers: [item.rowNumber] });
        } else {
          if (item.end > last.end) {
            last.end = item.end;
          }
          last.rowNumbers = Array.from(
            new Set([...(last.rowNumbers || []), item.rowNumber]),
          );
        }
        return acc;
      }, []);
    map.set(key, merged);
  });
  return map;
}

function buildBrokenSlots(intervalsByPair, endTime) {
  const map = new Map();
  intervalsByPair.forEach((intervals, pairKey) => {
    const country = pairKey.split('|')[0];
    const set = new Set();
    intervals.forEach((interval) => {
      slotRange(country, interval.start, interval.end).forEach((slotText) => {
        if (
          slotText >= interval.start &&
          slotText < interval.end &&
          slotText <= endTime
        ) {
          set.add(slotText);
        }
      });
    });
    map.set(pairKey, set);
  });
  return map;
}

async function loadExistingRealSlots(startTime, endTime) {
  const rows = await query(
    `
      SELECT
        COALESCE(NULLIF(mh.asin_code, ''), a.asin) AS asin_code,
        COALESCE(mh.country, a.country) AS country,
        mh.check_time
      FROM monitor_history mh
      LEFT JOIN asins a ON a.id = mh.asin_id
      WHERE mh.check_type = 'ASIN'
        AND mh.check_time >= ?
        AND mh.check_time <= ?
        AND COALESCE(mh.country, a.country) IN (${COUNTRIES.map(() => '?').join(
          ',',
        )})
        AND ${syntheticFilter('mh')}
    `,
    [startTime, endTime, ...COUNTRIES, ...syntheticParams()],
  );
  const set = new Set();
  rows.forEach((row) => {
    const country = getCountry(row.country);
    const asin = String(row.asin_code || '')
      .trim()
      .toUpperCase();
    const slot = getSlotText(country, row.check_time);
    if (!country || !asin || !slot) {
      return;
    }
    set.add(`${getPairKey(country, asin)}|${slot}`);
  });
  return set;
}

async function deleteSynthetic(startTime, endTime) {
  const result = await query(
    `
      DELETE FROM monitor_history
      WHERE check_time >= ?
        AND check_time <= ?
        AND (${SOURCES.map(() => 'check_result LIKE ?').join(' OR ')})
    `,
    [startTime, endTime, ...SOURCES.map((source) => `%${source}%`)],
  );
  return Number(result?.affectedRows || 0);
}

function effectiveEndTime(requestedEndTime) {
  const requested = parseSqlText(requestedEndTime);
  const safeNow = addMinutes(new Date(), -SAFE_LAG_MINUTES);
  return formatSqlText(requested && requested < safeNow ? requested : safeNow);
}

function buildUniverse(rows, currentMap, historyMap, startTime, endTime) {
  const map = new Map();
  currentMap.forEach((value, key) => {
    map.set(key, merge(map.get(key), value));
  });
  historyMap.forEach((value, key) => {
    map.set(key, merge(map.get(key), value));
  });
  rows.forEach((row) => {
    const country = getCountry(row.country);
    const asin = String(row.asin || '')
      .trim()
      .toUpperCase();
    if (!country || !asin) {
      return;
    }
    const key = getPairKey(country, asin);
    map.set(
      key,
      merge(map.get(key), {
        asinCode: asin,
        country,
        siteSnapshot: row.site || null,
        brandSnapshot: row.brand || null,
        activeFrom: row.brokenTime,
        activeTo: row.executeTime || endTime,
        mappingSources: ['sheet'],
      }),
    );
  });
  map.forEach((value, key) => {
    map.set(key, {
      ...value,
      activeFrom: value.activeFrom < startTime ? startTime : value.activeFrom,
      activeTo: value.activeTo > endTime ? endTime : value.activeTo,
    });
  });
  return map;
}

function buildCheckResult(pair, slotText, isBroken, sourceFile) {
  const intervals = pair.intervals || [];
  const matched = intervals.filter(
    (interval) => slotText >= interval.start && slotText < interval.end,
  );
  return {
    asin: pair.asinCode,
    isBroken,
    statusSource: isBroken ? 'MANUAL' : 'NORMAL',
    source: 'MANUAL_SHEET_TIMELINE_BACKFILL',
    operator: 'codex-backfill-script',
    sourceFile: path.basename(sourceFile),
    slotTime: slotText,
    mappingSources: pair.mappingSources || [],
    manualBrokenReason: isBroken ? '根据技术部手动登记表回补异常区间' : '',
    sourceRowNumbers: matched.flatMap((item) => item.rowNumbers || []),
  };
}

async function flush(buffer, stats) {
  if (buffer.length === 0) {
    return;
  }
  await MonitorHistory.bulkCreate(buffer.splice(0, buffer.length));
  stats.inserted += stats.pending;
  stats.pending = 0;
  logger.info(`[补录历史] 已写入 ${stats.inserted} 条 ASIN 时间线补录记录`);
}

async function planEntries({
  universe,
  brokenSlots,
  existingSlots,
  startTime,
  endTime,
  sourceFile,
  apply,
}) {
  const summary = new Map();
  const stats = {
    inserted: 0,
    pending: 0,
    asinEntries: 0,
    brokenEntries: 0,
    normalEntries: 0,
  };
  const buffer = [];
  const byCountry = new Map();
  universe.forEach((value, key) => {
    if (!byCountry.has(value.country)) {
      byCountry.set(value.country, []);
    }
    byCountry.get(value.country).push({ pairKey: key, ...value });
  });
  const slotCache = new Map();
  COUNTRIES.forEach((country) => {
    slotCache.set(country, slotRange(country, startTime, endTime));
  });

  for (const country of COUNTRIES) {
    const pairs = byCountry.get(country) || [];
    const slots = slotCache.get(country) || [];
    for (const pair of pairs) {
      const pairSlots = slots.filter(
        (slotText) => slotText >= pair.activeFrom && slotText <= pair.activeTo,
      );
      const brokenSet = brokenSlots.get(pair.pairKey) || new Set();
      for (const slotText of pairSlots) {
        const slotKey = `${pair.pairKey}|${slotText}`;
        if (existingSlots.has(slotKey)) {
          continue;
        }
        const isBroken = brokenSet.has(slotText);
        stats.asinEntries += 1;
        if (isBroken) {
          stats.brokenEntries += 1;
        } else {
          stats.normalEntries += 1;
        }
        const dayKey = `${slotText.slice(0, 10)}|${country}`;
        summary.set(dayKey, (summary.get(dayKey) || 0) + 1);
        if (apply) {
          buffer.push({
            asinId: pair.asinId || null,
            asinCode: pair.asinCode,
            asinName: pair.asinName || null,
            siteSnapshot: pair.siteSnapshot || null,
            brandSnapshot: pair.brandSnapshot || null,
            variantGroupId: pair.variantGroupId || null,
            variantGroupName: pair.variantGroupName || null,
            checkType: 'ASIN',
            country,
            isBroken: isBroken ? 1 : 0,
            checkTime: slotText,
            checkResult: buildCheckResult(pair, slotText, isBroken, sourceFile),
          });
          stats.pending += 1;
          if (buffer.length >= CHUNK) {
            await flush(buffer, stats);
          }
        }
      }
    }
  }

  if (apply) {
    await flush(buffer, stats);
  }

  return {
    ...stats,
    summary: Array.from(summary.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, count]) => ({ key, count })),
  };
}

async function refreshAgg(startTime, endTime) {
  logger.info(`[补录历史] 开始刷新聚合，范围 ${startTime} ~ ${endTime}`);
  await refreshAnalyticsAggBundle('hour', { startTime, endTime });
  await refreshAnalyticsAggBundle('day', { startTime, endTime });
  await refreshAnalyticsAggBundle('month', { startTime, endTime });
  await refreshMonitorHistoryStatusIntervals();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const endTime = effectiveEndTime(options.endTime);
  if (!endTime || endTime < options.startTime) {
    throw new Error('有效结束时间不合法');
  }

  logger.info('[补录历史] 开始执行手工登记表 ASIN 时间线回补', {
    file: options.file,
    apply: options.apply,
    startTime: options.startTime,
    requestedEndTime: options.endTime,
    effectiveEndTime: endTime,
  });

  const sheetRows = loadSheetRows(options.file).filter(
    (row) =>
      row.asin &&
      getCountry(row.country) &&
      row.brokenTime &&
      row.brokenTime <= endTime &&
      (row.executeTime || endTime) >= options.startTime,
  );

  const currentUniverse = await loadCurrentUniverse(endTime);
  const historyUniverse = await loadHistoryUniverse(options.startTime, endTime);
  const intervals = buildIntervals(sheetRows, endTime);
  const universe = buildUniverse(
    sheetRows,
    currentUniverse,
    historyUniverse,
    options.startTime,
    endTime,
  );
  universe.forEach((value, key) => {
    universe.set(key, { ...value, intervals: intervals.get(key) || [] });
  });

  const brokenSlots = buildBrokenSlots(intervals, endTime);
  const existingSlots = await loadExistingRealSlots(options.startTime, endTime);

  const preview = await planEntries({
    universe,
    brokenSlots,
    existingSlots,
    startTime: options.startTime,
    endTime,
    sourceFile: options.file,
    apply: false,
  });

  logger.info('[补录历史] 干跑统计', {
    sheetRows: sheetRows.length,
    universeSize: universe.size,
    existingRealSlots: existingSlots.size,
    asinEntriesToInsert: preview.asinEntries,
    brokenEntriesToInsert: preview.brokenEntries,
    normalEntriesToInsert: preview.normalEntries,
    summary: preview.summary,
  });

  if (!options.apply) {
    logger.info('[补录历史] 当前为 dry-run，添加 --apply 才会真正写库');
    return;
  }

  const deletedRows = await deleteSynthetic(options.startTime, endTime);
  logger.info('[补录历史] 已清理旧的手工补录记录', { deletedRows });

  const result = await planEntries({
    universe,
    brokenSlots,
    existingSlots,
    startTime: options.startTime,
    endTime,
    sourceFile: options.file,
    apply: true,
  });

  await refreshAgg(options.startTime, endTime);

  logger.info('[补录历史] ASIN 时间线回补完成', {
    deletedRows,
    inserted: result.asinEntries,
    brokenInserted: result.brokenEntries,
    normalInserted: result.normalEntries,
    effectiveRange: `${options.startTime} ~ ${endTime}`,
  });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error('[补录历史] 执行失败', { message: error.message });
    process.exit(1);
  });
