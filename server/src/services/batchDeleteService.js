const { v4: uuidv4 } = require('uuid');
const mainDatabase = require('../config/database');
const competitorDatabase = require('../config/competitor-database');
const VariantGroup = require('../models/VariantGroup');
const CompetitorVariantGroup = require('../models/CompetitorVariantGroup');
const logger = require('../utils/logger');

const MAX_IN_CLAUSE_ITEMS = 500;
const DEFAULT_SYNC_MAX_ITEMS = 50;
const DEFAULT_SYNC_MAX_ASINS = 500;
const DEFAULT_CHUNK_SIZE = 50;

const DOMAIN_CONFIG = {
  asin: {
    domain: 'asin',
    taskSubType: 'variant-group',
    label: '主营',
    database: mainDatabase,
    groupTable: 'variant_groups',
    asinTable: 'asins',
    clearCache: () => VariantGroup.clearCache(),
  },
  competitor: {
    domain: 'competitor',
    taskSubType: 'competitor-variant-group',
    label: '竞品',
    database: competitorDatabase,
    groupTable: 'competitor_variant_groups',
    asinTable: 'competitor_asins',
    clearCache: () => CompetitorVariantGroup.clearCache(),
  },
};

function toPositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function getBatchDeleteThresholds() {
  return {
    syncMaxItems: toPositiveInteger(
      process.env.BATCH_DELETE_SYNC_MAX_ITEMS,
      DEFAULT_SYNC_MAX_ITEMS,
    ),
    syncMaxAsins: toPositiveInteger(
      process.env.BATCH_DELETE_SYNC_MAX_ASINS,
      DEFAULT_SYNC_MAX_ASINS,
    ),
    chunkSize: toPositiveInteger(
      process.env.BATCH_DELETE_CHUNK_SIZE,
      DEFAULT_CHUNK_SIZE,
    ),
  };
}

function createValidationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function getDomainConfig(domain) {
  const config = DOMAIN_CONFIG[domain];
  if (!config) {
    throw createValidationError('不支持的批量删除数据域');
  }
  return config;
}

function normalizeIdList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set();
  const result = [];
  for (const item of value) {
    const normalized = String(item || '').trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function normalizeUseAsync(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'off'].includes(normalized)) {
      return false;
    }
  }
  return undefined;
}

function buildPlaceholders(items) {
  return items.map(() => '?').join(',');
}

function chunkArray(items, size = MAX_IN_CLAUSE_ITEMS) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function selectExistingIds(queryExecutor, tableName, ids) {
  if (ids.length === 0) {
    return [];
  }

  const rows = [];
  for (const chunk of chunkArray(ids)) {
    const placeholders = buildPlaceholders(chunk);
    const result = await queryExecutor(
      `SELECT id FROM ${tableName} WHERE id IN (${placeholders})`,
      chunk,
    );
    rows.push(...result);
  }

  const found = new Set(rows.map((row) => row.id));
  return ids.filter((id) => found.has(id));
}

async function selectAsinRows(queryExecutor, tableName, ids) {
  if (ids.length === 0) {
    return [];
  }

  const rows = [];
  for (const chunk of chunkArray(ids)) {
    const placeholders = buildPlaceholders(chunk);
    const result = await queryExecutor(
      `SELECT id, variant_group_id FROM ${tableName} WHERE id IN (${placeholders})`,
      chunk,
    );
    rows.push(...result);
  }

  const rowById = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => rowById.get(id)).filter(Boolean);
}

async function countNestedAsins(queryExecutor, tableName, groupIds) {
  if (groupIds.length === 0) {
    return 0;
  }

  let total = 0;
  for (const chunk of chunkArray(groupIds)) {
    const placeholders = buildPlaceholders(chunk);
    const [row] = await queryExecutor(
      `SELECT COUNT(*) AS total FROM ${tableName} WHERE variant_group_id IN (${placeholders})`,
      chunk,
    );
    total += Number(row?.total || 0);
  }
  return total;
}

function buildSkippedIds(requestedIds, existingIds) {
  const existing = new Set(existingIds);
  return requestedIds.filter((id) => !existing.has(id));
}

async function analyzeBatchDelete({
  domain,
  groupIds = [],
  asinIds = [],
  queryExecutor = null,
}) {
  const config = getDomainConfig(domain);
  const normalizedGroupIds = normalizeIdList(groupIds);
  const normalizedAsinIds = normalizeIdList(asinIds);
  const totalRequested = normalizedGroupIds.length + normalizedAsinIds.length;

  if (totalRequested === 0) {
    throw createValidationError('请提供变体组ID或ASIN ID列表');
  }

  const execute = queryExecutor || config.database.query;
  const existingGroupIds = await selectExistingIds(
    execute,
    config.groupTable,
    normalizedGroupIds,
  );
  const asinRows = await selectAsinRows(
    execute,
    config.asinTable,
    normalizedAsinIds,
  );

  const existingGroupSet = new Set(existingGroupIds);
  const existingAsinIds = asinRows.map((row) => row.id);
  const directAsinRows = asinRows.filter(
    (row) => !existingGroupSet.has(row.variant_group_id),
  );
  const directAsinIds = directAsinRows.map((row) => row.id);
  const directAsinGroupIds = Array.from(
    new Set(
      directAsinRows
        .map((row) => row.variant_group_id)
        .filter((id) => typeof id === 'string' && id.trim()),
    ),
  );
  const deletedNestedAsinCount = await countNestedAsins(
    execute,
    config.asinTable,
    existingGroupIds,
  );

  return {
    domain,
    taskSubType: config.taskSubType,
    totalRequested,
    requestedGroupIds: normalizedGroupIds,
    requestedAsinIds: normalizedAsinIds,
    groupIds: existingGroupIds,
    directAsinIds,
    directAsinGroupIds,
    skipped: {
      groupIds: buildSkippedIds(normalizedGroupIds, existingGroupIds),
      asinIds: buildSkippedIds(normalizedAsinIds, existingAsinIds),
    },
    deletedGroupCount: existingGroupIds.length,
    deletedDirectAsinCount: directAsinIds.length,
    deletedNestedAsinCount,
    estimatedAsinCount: deletedNestedAsinCount + directAsinIds.length,
  };
}

function shouldUseAsyncForBatchDelete(analysis, useAsync) {
  const requestedMode = normalizeUseAsync(useAsync);
  if (requestedMode !== undefined) {
    return requestedMode;
  }

  const thresholds = getBatchDeleteThresholds();
  return (
    analysis.totalRequested > thresholds.syncMaxItems ||
    analysis.estimatedAsinCount > thresholds.syncMaxAsins
  );
}

async function deleteByIds(queryExecutor, tableName, ids) {
  if (ids.length === 0) {
    return 0;
  }

  let affectedRows = 0;
  for (const chunk of chunkArray(ids)) {
    const placeholders = buildPlaceholders(chunk);
    const result = await queryExecutor(
      `DELETE FROM ${tableName} WHERE id IN (${placeholders})`,
      chunk,
    );
    affectedRows += Number(result?.affectedRows || 0);
  }
  return affectedRows;
}

async function updateGroupTime(queryExecutor, tableName, groupIds) {
  if (groupIds.length === 0) {
    return;
  }

  for (const chunk of chunkArray(groupIds)) {
    const placeholders = buildPlaceholders(chunk);
    await queryExecutor(
      `UPDATE ${tableName} SET update_time = NOW() WHERE id IN (${placeholders})`,
      chunk,
    );
  }
}

function mergeSkipped(target, source) {
  for (const id of source.groupIds || []) {
    target.groupIds.add(id);
  }
  for (const id of source.asinIds || []) {
    target.asinIds.add(id);
  }
}

function toResponseResult(base) {
  return {
    mode: base.mode || 'sync',
    totalRequested: Number(base.totalRequested || 0),
    deletedGroupCount: Number(base.deletedGroupCount || 0),
    deletedDirectAsinCount: Number(base.deletedDirectAsinCount || 0),
    deletedNestedAsinCount: Number(base.deletedNestedAsinCount || 0),
    skipped: {
      groupIds: Array.from(base.skipped?.groupIds || []),
      asinIds: Array.from(base.skipped?.asinIds || []),
    },
  };
}

async function executeBatchDelete({
  domain,
  groupIds = [],
  asinIds = [],
  clearCache = true,
}) {
  const config = getDomainConfig(domain);
  const startedAt = Date.now();

  const result = await config.database.withTransaction(async ({ query }) => {
    const analysis = await analyzeBatchDelete({
      domain,
      groupIds,
      asinIds,
      queryExecutor: query,
    });

    await deleteByIds(query, config.asinTable, analysis.directAsinIds);
    await deleteByIds(query, config.groupTable, analysis.groupIds);
    await updateGroupTime(
      query,
      config.groupTable,
      analysis.directAsinGroupIds,
    );

    return toResponseResult({
      ...analysis,
      mode: 'sync',
      skipped: {
        groupIds: new Set(analysis.skipped.groupIds),
        asinIds: new Set(analysis.skipped.asinIds),
      },
    });
  });

  if (clearCache) {
    config.clearCache();
  }

  logger.info('[批量删除] 同步删除完成', {
    domain,
    totalRequested: result.totalRequested,
    deletedGroupCount: result.deletedGroupCount,
    deletedDirectAsinCount: result.deletedDirectAsinCount,
    deletedNestedAsinCount: result.deletedNestedAsinCount,
    durationMs: Date.now() - startedAt,
  });

  return result;
}

function clearBatchDeleteCache(domain) {
  const config = getDomainConfig(domain);
  config.clearCache();
}

function createEmptyAggregateResult(totalRequested = 0) {
  return {
    mode: 'async',
    totalRequested,
    deletedGroupCount: 0,
    deletedDirectAsinCount: 0,
    deletedNestedAsinCount: 0,
    skipped: {
      groupIds: new Set(),
      asinIds: new Set(),
    },
    failedCount: 0,
    failedSamples: [],
  };
}

function addDeleteResult(target, result) {
  target.totalRequested += Number(result.totalRequested || 0);
  target.deletedGroupCount += Number(result.deletedGroupCount || 0);
  target.deletedDirectAsinCount += Number(result.deletedDirectAsinCount || 0);
  target.deletedNestedAsinCount += Number(result.deletedNestedAsinCount || 0);
  mergeSkipped(target.skipped, result.skipped || {});
}

function finalizeAggregateResult(result) {
  const skippedGroupIds = Array.from(result.skipped.groupIds);
  const skippedAsinIds = Array.from(result.skipped.asinIds);
  return {
    mode: result.mode,
    totalRequested: result.totalRequested,
    deletedGroupCount: result.deletedGroupCount,
    deletedDirectAsinCount: result.deletedDirectAsinCount,
    deletedNestedAsinCount: result.deletedNestedAsinCount,
    skippedCount: skippedGroupIds.length + skippedAsinIds.length,
    skipped: {
      groupIds: skippedGroupIds,
      asinIds: skippedAsinIds,
    },
    failedCount: result.failedCount,
    failedSamples: result.failedSamples,
  };
}

function splitPlanIntoChunks(analysis) {
  const { chunkSize } = getBatchDeleteThresholds();
  const chunks = [];
  for (const groupChunk of chunkArray(analysis.groupIds, chunkSize)) {
    chunks.push({ groupIds: groupChunk, asinIds: [] });
  }
  for (const asinChunk of chunkArray(analysis.directAsinIds, chunkSize)) {
    chunks.push({ groupIds: [], asinIds: asinChunk });
  }
  return chunks;
}

function createBatchDeleteTaskId() {
  return uuidv4();
}

module.exports = {
  analyzeBatchDelete,
  shouldUseAsyncForBatchDelete,
  executeBatchDelete,
  clearBatchDeleteCache,
  createEmptyAggregateResult,
  addDeleteResult,
  finalizeAggregateResult,
  splitPlanIntoChunks,
  createBatchDeleteTaskId,
  getBatchDeleteThresholds,
  normalizeIdList,
  normalizeUseAsync,
};
