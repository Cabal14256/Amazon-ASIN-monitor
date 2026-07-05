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
const INSERT_CHUNK = 500;
const UPDATE_CHUNK = 500;
const PAIR_CHUNK = 150;
const INSERT_SOURCE = 'MANUAL_SHEET_SLOT_INSERT';
const OVERRIDE_SOURCE = 'MANUAL_SHEET_SLOT_OVERRIDE';
const LEGACY_SOURCES = [
  'MANUAL_SHEET_BACKFILL',
  'MANUAL_SHEET_TIMELINE_BACKFILL',
];
const DELETE_SOURCES = [...LEGACY_SOURCES, INSERT_SOURCE];
const ALL_MANUAL_SOURCES = [...DELETE_SOURCES, OVERRIDE_SOURCE];
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
  if (!text) {
    return null;
  }
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

function addHours(value, hours) {
  return addMinutes(value, hours * 60);
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function uniq(values = []) {
  return Array.from(new Set((values || []).filter(Boolean))).sort();
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

function splitPairKey(pairKey) {
  const [country = '', asin = ''] = String(pairKey || '').split('|');
  return { country, asin };
}

function getSlotIntervalMinutes(country) {
  return INTERVALS[country] || 60;
}

function floorToSlot(country, value) {
  const normalizedCountry = getCountry(country);
  const date = parseSqlText(value);
  if (!normalizedCountry || !date) {
    return null;
  }
  date.setSeconds(0, 0);
  if (normalizedCountry === 'US') {
    date.setMinutes(date.getMinutes() >= 30 ? 30 : 0, 0, 0);
    return date;
  }
  date.setMinutes(0, 0, 0);
  return date;
}

function ceilToSlot(country, value) {
  const date = parseSqlText(value);
  const floored = floorToSlot(country, value);
  if (!date || !floored) {
    return null;
  }
  if (floored.getTime() < date.getTime()) {
    return addMinutes(floored, getSlotIntervalMinutes(getCountry(country)));
  }
  return floored;
}

function getSlotText(country, value) {
  const slot = floorToSlot(country, value);
  return slot ? formatSqlText(slot) : '';
}

function slotRange(country, startTime, endTime) {
  const normalizedCountry = getCountry(country);
  const start = parseSqlText(startTime);
  const end = parseSqlText(endTime);
  if (!normalizedCountry || !start || !end || end <= start) {
    return [];
  }

  const interval = getSlotIntervalMinutes(normalizedCountry);
  const slots = [];
  let cursor = ceilToSlot(normalizedCountry, start);
  while (cursor && cursor < end) {
    slots.push(formatSqlText(cursor));
    cursor = addMinutes(cursor, interval);
  }
  return slots;
}

function parseDurationValue(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return { kind: 'missing', raw };
  }
  if (raw === '未转为正常') {
    return { kind: 'open', raw };
  }
  const normalized = raw
    .replace(/小时$/u, '')
    .replace(/hours?$/iu, '')
    .trim();
  const hours = Number(normalized);
  if (!Number.isFinite(hours) || hours < 0) {
    return { kind: 'invalid', raw };
  }
  return { kind: 'hours', raw, hours };
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
        raise ValueError('缺少列: ' + ' / '.join(names))
    return None

wb = load_workbook('${escaped}', read_only=True, data_only=True)
ws = wb[wb.sheetnames[0]]
rows = []
header_row = next(ws.iter_rows(values_only=True))
headers = ['' if value is None else str(value).strip() for value in header_row]
site_idx = find_index(headers, ['站点'], True)
region_idx = find_index(headers, ['区域'])
country_idx = find_index(headers, ['国家'], True)
area_shop_idx = find_index(headers, ['区域店铺'])
parent_variant_idx = find_index(headers, ['父变体'])
brand_idx = find_index(headers, ['品牌'], True)
asin_idx = find_index(headers, ['ASIN'], True)
broken_idx = find_index(headers, ['被拆时间-以监控为准'], True)
duration_idx = find_index(headers, ['拆变体时长'])
execute_idx = find_index(headers, ['执行时间'])

for idx, row in enumerate(ws.iter_rows(values_only=True), start=2):
    values = list(row)
    broken_time = cell_text(values[broken_idx]) if broken_idx is not None and broken_idx < len(values) else None
    duration_text = cell_text(values[duration_idx]) if duration_idx is not None and duration_idx < len(values) else None
    execute_time = cell_text(values[execute_idx]) if execute_idx is not None and execute_idx < len(values) else None
    execute_time = None if execute_time in (None, '', '未执行') else execute_time
    rows.append({
        'rowNumber': idx,
        'site': '' if site_idx is None or site_idx >= len(values) or values[site_idx] is None else str(values[site_idx]).strip(),
        'region': '' if region_idx is None or region_idx >= len(values) or values[region_idx] is None else str(values[region_idx]).strip(),
        'country': '' if country_idx >= len(values) or values[country_idx] is None else str(values[country_idx]).strip().upper(),
        'areaShop': '' if area_shop_idx is None or area_shop_idx >= len(values) or values[area_shop_idx] is None else str(values[area_shop_idx]).strip(),
        'parentVariant': '' if parent_variant_idx is None or parent_variant_idx >= len(values) or values[parent_variant_idx] is None else str(values[parent_variant_idx]).strip(),
        'brand': '' if brand_idx >= len(values) or values[brand_idx] is None else str(values[brand_idx]).strip(),
        'asin': '' if asin_idx >= len(values) or values[asin_idx] is None else str(values[asin_idx]).strip().upper(),
        'brokenTime': broken_time,
        'durationText': '' if duration_text is None else str(duration_text).strip(),
        'executeTime': execute_time,
    })
print(json.dumps(rows))
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
  return `( ${alias}.check_result IS NULL OR (${ALL_MANUAL_SOURCES.map(
    () => `${alias}.check_result NOT LIKE ?`,
  ).join(' AND ')}) )`;
}

function syntheticParams() {
  return ALL_MANUAL_SOURCES.map((source) => `%${source}%`);
}

function mergeMetadata(base = {}, patch = {}) {
  const next = { ...base };
  Object.entries(patch || {}).forEach(([key, value]) => {
    if (key === 'mappingSources') {
      return;
    }
    if (value !== undefined && value !== null && value !== '') {
      next[key] = value;
    }
  });
  next.mappingSources = uniq([
    ...(base.mappingSources || []),
    ...(patch.mappingSources || []),
  ]);
  return next;
}

function buildSheetMetadataMap(rows = []) {
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
      mergeMetadata(map.get(key), {
        country,
        asinCode: asin,
        siteSnapshot: row.site || row.areaShop || null,
        brandSnapshot: row.brand || null,
        variantGroupName: row.parentVariant || null,
        mappingSources: ['sheet'],
      }),
    );
  });
  return map;
}

function buildPairItems(pairKeys = []) {
  return pairKeys.map((pairKey) => {
    const { country, asin } = splitPairKey(pairKey);
    return { pairKey, country, asin };
  });
}

async function loadCurrentMetadata(pairItems, endTime) {
  const map = new Map();
  for (const chunk of chunkArray(pairItems, PAIR_CHUNK)) {
    const tupleSql = chunk.map(() => '(?, ?)').join(', ');
    const tupleParams = chunk.flatMap((item) => [item.country, item.asin]);
    const rows = await query(
      `
        SELECT
          a.id,
          a.asin,
          a.name,
          a.country,
          a.site,
          a.brand,
          a.variant_group_id,
          vg.name AS variant_group_name
        FROM asins a
        LEFT JOIN variant_groups vg ON vg.id = a.variant_group_id
        WHERE a.create_time <= ?
          AND (a.country, a.asin) IN (${tupleSql})
      `,
      [endTime, ...tupleParams],
    );

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
        mergeMetadata(map.get(key), {
          asinId: row.id || null,
          asinCode: asin,
          asinName: row.name || null,
          country,
          siteSnapshot: row.site || null,
          brandSnapshot: row.brand || null,
          variantGroupId: row.variant_group_id || null,
          variantGroupName: row.variant_group_name || null,
          mappingSources: ['asins'],
        }),
      );
    });
  }
  return map;
}

async function loadHistoryMetadata(pairItems, startTime, endTime) {
  const map = new Map();
  for (const chunk of chunkArray(pairItems, PAIR_CHUNK)) {
    const tupleSql = chunk.map(() => '(?, ?)').join(', ');
    const tupleParams = chunk.flatMap((item) => [item.country, item.asin]);
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
          AND ${syntheticFilter('mh')}
          AND (
            COALESCE(mh.country, a.country),
            COALESCE(NULLIF(mh.asin_code, ''), a.asin)
          ) IN (${tupleSql})
        ORDER BY mh.check_time DESC, mh.id DESC
      `,
      [startTime, endTime, ...syntheticParams(), ...tupleParams],
    );

    rows.forEach((row) => {
      const country = getCountry(row.country);
      const asin = String(row.asin_code || '')
        .trim()
        .toUpperCase();
      if (!country || !asin) {
        return;
      }
      const key = getPairKey(country, asin);
      if (map.has(key)) {
        return;
      }
      map.set(
        key,
        mergeMetadata(map.get(key), {
          asinId: row.asin_id || null,
          asinCode: asin,
          asinName: row.asin_name || null,
          country,
          siteSnapshot: row.site_snapshot || null,
          brandSnapshot: row.brand_snapshot || null,
          variantGroupId: row.variant_group_id || null,
          variantGroupName: row.variant_group_name || null,
          mappingSources: ['history'],
        }),
      );
    });
  }
  return map;
}

function buildMetadataMap(
  pairItems,
  sheetMetadata,
  currentMetadata,
  historyMetadata,
) {
  const map = new Map();
  pairItems.forEach((item) => {
    let merged = mergeMetadata(
      {
        country: item.country,
        asinCode: item.asin,
        mappingSources: [],
      },
      sheetMetadata.get(item.pairKey),
    );
    merged = mergeMetadata(merged, currentMetadata.get(item.pairKey));
    merged = mergeMetadata(merged, historyMetadata.get(item.pairKey));
    if (!merged.variantGroupName) {
      merged.variantGroupName =
        sheetMetadata.get(item.pairKey)?.variantGroupName || null;
    }
    map.set(item.pairKey, merged);
  });
  return map;
}

function resolveSheetInterval(row, startTime, endTime) {
  const country = getCountry(row.country);
  const asin = String(row.asin || '')
    .trim()
    .toUpperCase();
  const brokenTime = parseSqlText(row.brokenTime);
  const windowStart = parseSqlText(startTime);
  const windowEnd = parseSqlText(endTime);
  if (!country || !asin || !brokenTime || !windowStart || !windowEnd) {
    return null;
  }

  let actualEnd = null;
  let openEnded = false;
  let usedZeroDurationFallback = false;
  const executeTime = parseSqlText(row.executeTime);
  if (executeTime && executeTime > brokenTime) {
    actualEnd = executeTime;
  } else {
    const duration = parseDurationValue(row.durationText);
    if (duration.kind === 'open') {
      actualEnd = windowEnd;
      openEnded = true;
    } else if (duration.kind === 'hours') {
      let effectiveHours = duration.hours;
      if (effectiveHours === 0) {
        effectiveHours = getSlotIntervalMinutes(country) / 60;
        usedZeroDurationFallback = true;
      }
      actualEnd = addHours(brokenTime, effectiveHours);
    } else {
      return null;
    }
  }

  if (!actualEnd || actualEnd <= brokenTime) {
    return null;
  }

  const clippedStart =
    brokenTime > windowStart ? new Date(brokenTime.getTime()) : windowStart;
  const clippedEnd =
    actualEnd < windowEnd ? new Date(actualEnd.getTime()) : windowEnd;
  if (clippedEnd <= clippedStart) {
    return null;
  }

  return {
    pairKey: getPairKey(country, asin),
    country,
    asin,
    start: formatSqlText(clippedStart),
    end: formatSqlText(clippedEnd),
    actualEnd: formatSqlText(actualEnd),
    openEnded: openEnded || actualEnd > windowEnd,
    rowNumbers: [row.rowNumber],
    durationTexts: row.durationText ? [row.durationText] : [],
    usedZeroDurationFallback,
  };
}

function buildIntervals(rows, startTime, endTime) {
  const map = new Map();
  const stats = {
    sheetRows: rows.length,
    validRows: 0,
    skippedRows: 0,
    openRows: 0,
    zeroDurationRows: 0,
    mergedIntervals: 0,
  };

  rows.forEach((row) => {
    const interval = resolveSheetInterval(row, startTime, endTime);
    if (!interval) {
      stats.skippedRows += 1;
      return;
    }
    stats.validRows += 1;
    if (interval.openEnded) {
      stats.openRows += 1;
    }
    if (interval.usedZeroDurationFallback) {
      stats.zeroDurationRows += 1;
    }
    if (!map.has(interval.pairKey)) {
      map.set(interval.pairKey, []);
    }
    map.get(interval.pairKey).push(interval);
  });

  map.forEach((intervals, pairKey) => {
    const merged = intervals
      .slice()
      .sort((left, right) => left.start.localeCompare(right.start))
      .reduce((acc, current) => {
        const last = acc[acc.length - 1];
        if (!last || current.start > last.end) {
          acc.push({
            ...current,
            rowNumbers: uniq(current.rowNumbers),
            durationTexts: uniq(current.durationTexts),
          });
          return acc;
        }

        if (current.end > last.end) {
          last.end = current.end;
          last.actualEnd = current.actualEnd;
        }
        last.openEnded = last.openEnded || current.openEnded;
        last.rowNumbers = uniq([
          ...(last.rowNumbers || []),
          ...current.rowNumbers,
        ]);
        last.durationTexts = uniq([
          ...(last.durationTexts || []),
          ...(current.durationTexts || []),
        ]);
        return acc;
      }, []);

    map.set(pairKey, merged);
    stats.mergedIntervals += merged.length;
  });

  return { intervalsByPair: map, stats };
}

function buildCheckResult({ asinCode, isBroken, sourceFile, interval, mode }) {
  return {
    asin: asinCode,
    isBroken: Boolean(isBroken),
    statusSource: isBroken ? 'MANUAL' : 'NORMAL',
    source: mode === 'insert' ? INSERT_SOURCE : OVERRIDE_SOURCE,
    operator: 'codex-backfill-script',
    sourceFile: path.basename(sourceFile),
    intervalStart: interval.start,
    intervalEnd: interval.openEnded ? null : interval.end,
    sourceRowNumbers: interval.rowNumbers || [],
    manualBrokenReason: isBroken
      ? '根据技术部手动登记表覆盖异常槽位'
      : '根据技术部手动登记表补充恢复槽位',
  };
}

function buildDesiredSlots(intervalsByPair, sourceFile, endTime) {
  const desiredSlots = new Map();
  const stats = {
    pairCount: intervalsByPair.size,
    intervalCount: 0,
    brokenSlots: 0,
    normalSlots: 0,
  };

  intervalsByPair.forEach((intervals, pairKey) => {
    const { country, asin } = splitPairKey(pairKey);
    intervals.forEach((interval) => {
      stats.intervalCount += 1;
      const brokenCheckResult = buildCheckResult({
        asinCode: asin,
        isBroken: true,
        sourceFile,
        interval,
        mode: 'insert',
      });
      const brokenPayloadKey = `${pairKey}|${interval.start}|${interval.end}|BROKEN`;
      slotRange(country, interval.start, interval.end).forEach((slotText) => {
        desiredSlots.set(`${pairKey}|${slotText}`, {
          pairKey,
          country,
          asinCode: asin,
          slotText,
          isBroken: 1,
          checkResult: brokenCheckResult,
          payloadKey: brokenPayloadKey,
        });
        stats.brokenSlots += 1;
      });

      if (!interval.openEnded) {
        const closingSlot = formatSqlText(ceilToSlot(country, interval.end));
        if (closingSlot && closingSlot <= endTime) {
          desiredSlots.set(`${pairKey}|${closingSlot}`, {
            pairKey,
            country,
            asinCode: asin,
            slotText: closingSlot,
            isBroken: 0,
            checkResult: buildCheckResult({
              asinCode: asin,
              isBroken: false,
              sourceFile,
              interval,
              mode: 'insert',
            }),
            payloadKey: `${pairKey}|${interval.start}|${interval.end}|NORMAL`,
          });
          stats.normalSlots += 1;
        }
      }
    });
  });

  return { desiredSlots, stats };
}

function isDeleteSourceRow(checkResult) {
  const text = String(checkResult || '');
  return DELETE_SOURCES.some((source) => text.includes(source));
}

async function loadExistingHistoryRows(pairItems, startTime, endTime) {
  const realRowsBySlot = new Map();
  const rows = [];

  for (const chunk of chunkArray(pairItems, PAIR_CHUNK)) {
    const tupleSql = chunk.map(() => '(?, ?)').join(', ');
    const tupleParams = chunk.flatMap((item) => [item.country, item.asin]);
    const result = await query(
      `
        SELECT
          mh.id,
          DATE_FORMAT(mh.check_time, '%Y-%m-%d %H:%i:%s') AS check_time,
          COALESCE(mh.country, a.country) AS country,
          COALESCE(NULLIF(mh.asin_code, ''), a.asin) AS asin_code,
          mh.is_broken,
          mh.check_result
        FROM monitor_history mh
        LEFT JOIN asins a ON a.id = mh.asin_id
        WHERE mh.check_type = 'ASIN'
          AND mh.check_time >= ?
          AND mh.check_time <= ?
          AND (
            COALESCE(mh.country, a.country),
            COALESCE(NULLIF(mh.asin_code, ''), a.asin)
          ) IN (${tupleSql})
        ORDER BY mh.check_time ASC, mh.id ASC
      `,
      [startTime, endTime, ...tupleParams],
    );
    rows.push(...result);
  }

  let deleteCandidateRows = 0;
  rows.forEach((row) => {
    const country = getCountry(row.country);
    const asin = String(row.asin_code || '')
      .trim()
      .toUpperCase();
    if (!country || !asin) {
      return;
    }
    if (isDeleteSourceRow(row.check_result)) {
      deleteCandidateRows += 1;
      return;
    }
    const slotText = getSlotText(country, row.check_time);
    if (!slotText) {
      return;
    }
    const slotKey = `${getPairKey(country, asin)}|${slotText}`;
    if (!realRowsBySlot.has(slotKey)) {
      realRowsBySlot.set(slotKey, []);
    }
    realRowsBySlot.get(slotKey).push({
      id: row.id,
      isBroken: Number(row.is_broken) === 1 ? 1 : 0,
    });
  });

  return {
    realRowsBySlot,
    deleteCandidateRows,
    totalRowsInRange: rows.length,
  };
}

function planMutations({ desiredSlots, realRowsBySlot, metadataMap }) {
  const updatePlans = new Map();
  const insertEntries = [];
  const stats = {
    desiredSlots: desiredSlots.size,
    desiredBrokenSlots: 0,
    desiredNormalSlots: 0,
    slotsWithRealRows: 0,
    alreadyCorrectSlots: 0,
    updateSlots: 0,
    updateRows: 0,
    insertSlots: 0,
  };

  desiredSlots.forEach((desired) => {
    if (desired.isBroken === 1) {
      stats.desiredBrokenSlots += 1;
    } else {
      stats.desiredNormalSlots += 1;
    }

    const realRows =
      realRowsBySlot.get(`${desired.pairKey}|${desired.slotText}`) || [];
    if (realRows.length > 0) {
      stats.slotsWithRealRows += 1;
      const needsUpdate = realRows.some(
        (row) => Number(row.isBroken) !== desired.isBroken,
      );
      if (!needsUpdate) {
        stats.alreadyCorrectSlots += 1;
        return;
      }

      const payloadKey = desired.payloadKey;
      if (!updatePlans.has(payloadKey)) {
        updatePlans.set(payloadKey, {
          isBroken: desired.isBroken,
          checkResult: {
            ...desired.checkResult,
            source: OVERRIDE_SOURCE,
          },
          rowIds: new Set(),
        });
      }

      realRows.forEach((row) => {
        updatePlans.get(payloadKey).rowIds.add(row.id);
      });
      stats.updateSlots += 1;
      stats.updateRows += realRows.length;
      return;
    }

    const metadata = metadataMap.get(desired.pairKey) || {};
    insertEntries.push({
      asinId: metadata.asinId || null,
      asinCode: metadata.asinCode || desired.asinCode,
      asinName: metadata.asinName || null,
      siteSnapshot: metadata.siteSnapshot || null,
      brandSnapshot: metadata.brandSnapshot || null,
      variantGroupId: metadata.variantGroupId || null,
      variantGroupName: metadata.variantGroupName || null,
      checkType: 'ASIN',
      country: metadata.country || desired.country,
      isBroken: desired.isBroken,
      checkTime: desired.slotText,
      checkResult: {
        ...desired.checkResult,
        source: INSERT_SOURCE,
      },
    });
    stats.insertSlots += 1;
  });

  return {
    updatePlans: Array.from(updatePlans.values()).map((plan) => ({
      ...plan,
      rowIds: Array.from(plan.rowIds.values()),
    })),
    insertEntries,
    stats,
  };
}

async function deleteSyntheticRows(pairItems, startTime, endTime) {
  let deletedRows = 0;
  for (const chunk of chunkArray(pairItems, PAIR_CHUNK)) {
    const tupleSql = chunk.map(() => '(?, ?)').join(', ');
    const tupleParams = chunk.flatMap((item) => [item.country, item.asin]);
    const result = await query(
      `
        DELETE mh
        FROM monitor_history mh
        LEFT JOIN asins a ON a.id = mh.asin_id
        WHERE mh.check_type = 'ASIN'
          AND mh.check_time >= ?
          AND mh.check_time <= ?
          AND (
            COALESCE(mh.country, a.country),
            COALESCE(NULLIF(mh.asin_code, ''), a.asin)
          ) IN (${tupleSql})
          AND (${DELETE_SOURCES.map(() => 'mh.check_result LIKE ?').join(
            ' OR ',
          )})
      `,
      [
        startTime,
        endTime,
        ...tupleParams,
        ...DELETE_SOURCES.map((source) => `%${source}%`),
      ],
    );
    deletedRows += Number(result?.affectedRows || 0);
  }
  return deletedRows;
}

async function applyUpdatePlans(updatePlans) {
  let updatedRows = 0;
  for (const plan of updatePlans) {
    const checkResultText = JSON.stringify(plan.checkResult);
    for (const idChunk of chunkArray(plan.rowIds || [], UPDATE_CHUNK)) {
      if (idChunk.length === 0) {
        continue;
      }
      const placeholders = idChunk.map(() => '?').join(', ');
      const result = await query(
        `
          UPDATE monitor_history
          SET is_broken = ?,
              check_result = ?
          WHERE id IN (${placeholders})
        `,
        [plan.isBroken ? 1 : 0, checkResultText, ...idChunk],
      );
      updatedRows += Number(result?.affectedRows || 0);
    }
  }
  return updatedRows;
}

async function applyInsertEntries(entries) {
  let insertedRows = 0;
  for (const chunk of chunkArray(entries, INSERT_CHUNK)) {
    if (chunk.length === 0) {
      continue;
    }
    await MonitorHistory.bulkCreate(chunk);
    insertedRows += chunk.length;
  }
  return insertedRows;
}

async function hasTable(tableName) {
  const rows = await query(
    `
      SELECT COUNT(*) AS total
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
    `,
    [tableName],
  );
  return Number(rows?.[0]?.total || 0) > 0;
}

async function hasColumn(tableName, columnName) {
  const rows = await query(
    `
      SELECT COUNT(*) AS total
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
    `,
    [tableName, columnName],
  );
  return Number(rows?.[0]?.total || 0) > 0;
}

async function supportsMonthGranularity(tableName) {
  const rows = await query(
    `SHOW COLUMNS FROM \`${tableName}\` LIKE 'granularity'`,
  );
  return String(rows?.[0]?.Type || '').includes("'month'");
}

async function refreshAgg(startTime, endTime) {
  logger.info(`[补录历史] 开始刷新聚合，范围 ${startTime} ~ ${endTime}`);
  await refreshAnalyticsAggBundle('hour', { startTime, endTime });
  await refreshAnalyticsAggBundle('day', { startTime, endTime });
  const canRefreshMonth =
    (await hasColumn('monitor_history', 'month_ts')) &&
    (await supportsMonthGranularity('monitor_history_agg')) &&
    (await supportsMonthGranularity('monitor_history_agg_dim')) &&
    (await supportsMonthGranularity('monitor_history_agg_variant_group'));
  if (canRefreshMonth) {
    await refreshAnalyticsAggBundle('month', { startTime, endTime });
    return;
  }
  logger.warn('[补录历史] 当前库未完成 month 聚合相关迁移，已跳过 month 刷新');
}

async function rebuildStatusIntervals() {
  const hasIntervalTable = await hasTable('monitor_history_status_interval');
  const hasWatermarkTable = await hasTable('analytics_refresh_watermark');
  if (!hasIntervalTable || !hasWatermarkTable) {
    logger.warn('[补录历史] 当前库未创建状态区间相关表，已跳过区间重建');
    return { skipped: true, reason: 'schema_missing' };
  }
  logger.info('[补录历史] 开始全量重建状态区间表');
  await query('TRUNCATE TABLE monitor_history_status_interval');
  await query(
    `DELETE FROM analytics_refresh_watermark
     WHERE processor_name = 'monitor_history_status_interval'`,
  );
  const result = await refreshMonitorHistoryStatusIntervals();
  logger.info('[补录历史] 状态区间表重建完成', result);
  return result;
}

function effectiveEndTime(requestedEndTime) {
  const requested = parseSqlText(requestedEndTime);
  const safeNow = addMinutes(new Date(), -SAFE_LAG_MINUTES);
  return formatSqlText(requested && requested < safeNow ? requested : safeNow);
}

async function verifyAfterApply(pairItems, startTime, endTime) {
  let remainingDeleteSourceRows = 0;
  let insertedRows = 0;
  let overrideRows = 0;

  for (const chunk of chunkArray(pairItems, PAIR_CHUNK)) {
    const tupleSql = chunk.map(() => '(?, ?)').join(', ');
    const tupleParams = chunk.flatMap((item) => [item.country, item.asin]);
    const rows = await query(
      `
        SELECT
          SUM(CASE WHEN ${DELETE_SOURCES.map(
            () => 'mh.check_result LIKE ?',
          ).join(' OR ')} THEN 1 ELSE 0 END) AS remaining_delete_source_rows,
          SUM(CASE WHEN mh.check_result LIKE ? THEN 1 ELSE 0 END) AS insert_rows,
          SUM(CASE WHEN mh.check_result LIKE ? THEN 1 ELSE 0 END) AS override_rows
        FROM monitor_history mh
        LEFT JOIN asins a ON a.id = mh.asin_id
        WHERE mh.check_type = 'ASIN'
          AND mh.check_time >= ?
          AND mh.check_time <= ?
          AND (
            COALESCE(mh.country, a.country),
            COALESCE(NULLIF(mh.asin_code, ''), a.asin)
          ) IN (${tupleSql})
      `,
      [
        ...DELETE_SOURCES.map((source) => `%${source}%`),
        `%${INSERT_SOURCE}%`,
        `%${OVERRIDE_SOURCE}%`,
        startTime,
        endTime,
        ...tupleParams,
      ],
    );
    remainingDeleteSourceRows += Number(
      rows?.[0]?.remaining_delete_source_rows || 0,
    );
    insertedRows += Number(rows?.[0]?.insert_rows || 0);
    overrideRows += Number(rows?.[0]?.override_rows || 0);
  }

  return {
    remainingDeleteSourceRows,
    insertedRows,
    overrideRows,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const endTime = effectiveEndTime(options.endTime);
  if (!endTime || endTime < options.startTime) {
    throw new Error('有效结束时间不合法');
  }

  logger.info('[补录历史] 开始执行手工登记表历史覆盖', {
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
  const sheetMetadata = buildSheetMetadataMap(sheetRows);
  const { intervalsByPair, stats: intervalStats } = buildIntervals(
    sheetRows,
    options.startTime,
    endTime,
  );
  const pairItems = buildPairItems(Array.from(intervalsByPair.keys()));
  const currentMetadata = await loadCurrentMetadata(pairItems, endTime);
  const historyMetadata = await loadHistoryMetadata(
    pairItems,
    options.startTime,
    endTime,
  );
  const metadataMap = buildMetadataMap(
    pairItems,
    sheetMetadata,
    currentMetadata,
    historyMetadata,
  );
  const { desiredSlots, stats: desiredStats } = buildDesiredSlots(
    intervalsByPair,
    options.file,
    endTime,
  );
  const existingRows = await loadExistingHistoryRows(
    pairItems,
    options.startTime,
    endTime,
  );
  const plan = planMutations({
    desiredSlots,
    realRowsBySlot: existingRows.realRowsBySlot,
    metadataMap,
  });

  logger.info('[补录历史] 干跑统计', {
    sheetRows: intervalStats.sheetRows,
    validRows: intervalStats.validRows,
    skippedRows: intervalStats.skippedRows,
    openRows: intervalStats.openRows,
    zeroDurationRows: intervalStats.zeroDurationRows,
    pairCount: desiredStats.pairCount,
    mergedIntervals: intervalStats.mergedIntervals,
    desiredBrokenSlots: desiredStats.brokenSlots,
    desiredNormalSlots: desiredStats.normalSlots,
    rowsInRange: existingRows.totalRowsInRange,
    deleteCandidateRows: existingRows.deleteCandidateRows,
    slotsWithRealRows: plan.stats.slotsWithRealRows,
    alreadyCorrectSlots: plan.stats.alreadyCorrectSlots,
    updateSlots: plan.stats.updateSlots,
    updateRows: plan.stats.updateRows,
    insertSlots: plan.stats.insertSlots,
  });

  if (!options.apply) {
    logger.info('[补录历史] 当前为 dry-run，添加 --apply 才会真正写库');
    return;
  }

  const deletedRows = await deleteSyntheticRows(
    pairItems,
    options.startTime,
    endTime,
  );
  logger.info('[补录历史] 已清理旧的手工补录插入记录', { deletedRows });

  const updatedRows = await applyUpdatePlans(plan.updatePlans);
  logger.info('[补录历史] 已覆盖原始历史槽位', { updatedRows });

  const insertedRows = await applyInsertEntries(plan.insertEntries);
  logger.info('[补录历史] 已补插缺失历史槽位', { insertedRows });

  MonitorHistory.invalidateCaches();
  await refreshAgg(options.startTime, endTime);
  await rebuildStatusIntervals();

  const verification = await verifyAfterApply(
    pairItems,
    options.startTime,
    endTime,
  );

  logger.info('[补录历史] 历史覆盖完成', {
    deletedRows,
    updatedRows,
    insertedRows,
    verification,
    effectiveRange: `${options.startTime} ~ ${endTime}`,
  });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error('[补录历史] 执行失败', { message: error.message });
    process.exit(1);
  });
