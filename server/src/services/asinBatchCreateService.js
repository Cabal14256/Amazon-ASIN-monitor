const { v4: uuidv4 } = require('uuid');
const mainDatabase = require('../config/database');
const competitorDatabase = require('../config/competitor-database');
const VariantGroup = require('../models/VariantGroup');
const CompetitorVariantGroup = require('../models/CompetitorVariantGroup');
const logger = require('../utils/logger');

const DEFAULT_CHUNK_SIZE = 100;
const ASIN_CODE_PATTERN = /^[A-Z0-9]{10}$/;

function getChunkSize() {
  const configured = Number(process.env.ASIN_BATCH_CREATE_CHUNK_SIZE);
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : DEFAULT_CHUNK_SIZE;
}

function chunkArray(items, size = getChunkSize()) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function buildPlaceholders(count, columnsPerRow) {
  return Array.from(
    { length: count },
    () => `(${Array.from({ length: columnsPerRow }, () => '?').join(', ')})`,
  ).join(', ');
}

function normalizeAsinCode(asin) {
  return asin ? String(asin).trim().toUpperCase() : '';
}

function normalizeCountryCode(country) {
  return country ? String(country).trim().toUpperCase() : '';
}

function normalizeOptionalText(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeAsinType(asinType) {
  if (!asinType) return null;
  const type = String(asinType).trim();
  if (type === 'MAIN_LINK') return '1';
  if (type === 'SUB_REVIEW') return '2';
  if (type === '1' || type === 1) return '1';
  if (type === '2' || type === 2) return '2';
  return null;
}

function getDomainConfig(domain) {
  if (domain === 'competitor') {
    return {
      domain,
      database: competitorDatabase,
      asinTable: 'competitor_asins',
      groupTable: 'competitor_variant_groups',
      hasSite: false,
      defaultFeishuNotifyEnabled: 0,
      clearCache: () => CompetitorVariantGroup.clearCache(),
    };
  }

  return {
    domain: 'asin',
    database: mainDatabase,
    asinTable: 'asins',
    groupTable: 'variant_groups',
    hasSite: true,
    defaultFeishuNotifyEnabled: 1,
    clearCache: () => VariantGroup.clearCache(),
  };
}

function createEmptyResult(total = 0) {
  return {
    total,
    successCount: 0,
    failedCount: 0,
    results: [],
    errors: [],
  };
}

function addFailure(result, item, message) {
  result.failedCount += 1;
  const failure = {
    index: item.index,
    asin: item.asin || null,
    country: item.country || null,
    success: false,
    message,
  };
  result.results.push(failure);
  result.errors.push({
    index: item.index,
    asin: item.asin || null,
    country: item.country || null,
    message,
  });
}

function addSuccess(result, item) {
  result.successCount += 1;
  result.results.push({
    index: item.index,
    id: item.id,
    asin: item.asin,
    country: item.country,
    parentId: item.parentId,
    success: true,
  });
}

function normalizeItems(items, config, result) {
  const seen = new Set();
  const validItems = [];

  items.forEach((rawItem, index) => {
    const item = rawItem || {};
    const normalized = {
      index,
      id: uuidv4(),
      asin: normalizeAsinCode(item.asin),
      name: normalizeOptionalText(item.name),
      asinType: normalizeAsinType(item.asinType),
      country: normalizeCountryCode(item.country),
      site: normalizeOptionalText(item.site),
      brand: normalizeOptionalText(item.brand),
      parentId: normalizeOptionalText(item.parentId || item.variantGroupId),
    };

    if (!normalized.asin || !ASIN_CODE_PATTERN.test(normalized.asin)) {
      addFailure(result, normalized, 'ASIN编码必须是10位字母数字组合');
      return;
    }
    if (!normalized.country) {
      addFailure(result, normalized, '国家不能为空');
      return;
    }
    if (config.hasSite && !normalized.site) {
      addFailure(result, normalized, '站点不能为空');
      return;
    }
    if (!normalized.brand) {
      addFailure(result, normalized, '品牌不能为空');
      return;
    }
    if (!normalized.parentId) {
      addFailure(result, normalized, '所属变体组不能为空');
      return;
    }
    if (item.asinType && !normalized.asinType) {
      addFailure(result, normalized, 'ASIN类型必须是 1（主链）或 2（副评）');
      return;
    }

    const duplicateKey = `${normalized.asin}:${normalized.country}`;
    if (seen.has(duplicateKey)) {
      addFailure(result, normalized, '请求中存在重复ASIN，已跳过');
      return;
    }
    seen.add(duplicateKey);
    validItems.push(normalized);
  });

  return validItems;
}

async function findVariantGroups(queryExecutor, config, groupIds) {
  const groupMap = new Map();
  for (const chunk of chunkArray(groupIds)) {
    const placeholders = chunk.map(() => '?').join(', ');
    const rows = await queryExecutor(
      `SELECT id, country FROM ${config.groupTable} WHERE id IN (${placeholders})`,
      chunk,
    );
    for (const row of rows) {
      groupMap.set(row.id, {
        id: row.id,
        country: normalizeCountryCode(row.country),
      });
    }
  }
  return groupMap;
}

async function findExistingAsins(queryExecutor, config, items) {
  const existingKeys = new Set();
  for (const chunk of chunkArray(items)) {
    const placeholders = buildPlaceholders(chunk.length, 2);
    const params = chunk.flatMap((item) => [item.asin, item.country]);
    const rows = await queryExecutor(
      `SELECT asin, country FROM ${config.asinTable} WHERE (asin, country) IN (${placeholders})`,
      params,
    );
    for (const row of rows) {
      existingKeys.add(
        `${normalizeAsinCode(row.asin)}:${normalizeCountryCode(row.country)}`,
      );
    }
  }
  return existingKeys;
}

async function insertAsinChunk(queryExecutor, config, items) {
  if (items.length === 0) {
    return;
  }

  const columns = config.hasSite
    ? [
        'id',
        'asin',
        'name',
        'asin_type',
        'country',
        'site',
        'brand',
        'variant_group_id',
        'is_broken',
        'variant_status',
      ]
    : [
        'id',
        'asin',
        'name',
        'asin_type',
        'country',
        'brand',
        'variant_group_id',
        'is_broken',
        'variant_status',
        'feishu_notify_enabled',
      ];

  const placeholders = buildPlaceholders(items.length, columns.length);
  const params = items.flatMap((item) =>
    config.hasSite
      ? [
          item.id,
          item.asin,
          item.name,
          item.asinType,
          item.country,
          item.site,
          item.brand,
          item.parentId,
          0,
          'NORMAL',
        ]
      : [
          item.id,
          item.asin,
          item.name,
          item.asinType,
          item.country,
          item.brand,
          item.parentId,
          0,
          'NORMAL',
          config.defaultFeishuNotifyEnabled,
        ],
  );

  await queryExecutor(
    `INSERT INTO ${config.asinTable} (${columns.join(
      ', ',
    )}) VALUES ${placeholders}`,
    params,
  );
}

async function updateVariantGroupTimes(queryExecutor, config, groupIds) {
  for (const chunk of chunkArray(groupIds)) {
    const placeholders = chunk.map(() => '?').join(', ');
    await queryExecutor(
      `UPDATE ${config.groupTable} SET update_time = NOW() WHERE id IN (${placeholders})`,
      chunk,
    );
  }
}

async function batchCreateASINs({
  domain = 'asin',
  items = [],
  clearCache = true,
} = {}) {
  const config = getDomainConfig(domain);
  const startedAt = Date.now();

  if (!Array.isArray(items) || items.length === 0) {
    const error = new Error('items不能为空');
    error.statusCode = 400;
    throw error;
  }

  const result = createEmptyResult(items.length);
  const normalizedItems = normalizeItems(items, config, result);

  if (normalizedItems.length > 0) {
    await config.database.withTransaction(async ({ query }) => {
      const groupIds = Array.from(
        new Set(normalizedItems.map((item) => item.parentId)),
      );
      const groupMap = await findVariantGroups(query, config, groupIds);
      const groupValidatedItems = [];

      for (const item of normalizedItems) {
        const group = groupMap.get(item.parentId);
        if (!group) {
          addFailure(result, item, '所属变体组不存在');
          continue;
        }
        if (group.country !== item.country) {
          addFailure(
            result,
            item,
            `ASIN国家必须与所属变体组一致（${group.country}）`,
          );
          continue;
        }
        groupValidatedItems.push(item);
      }

      if (groupValidatedItems.length === 0) {
        return;
      }

      const existingKeys = await findExistingAsins(
        query,
        config,
        groupValidatedItems,
      );
      const insertItems = [];
      for (const item of groupValidatedItems) {
        const key = `${item.asin}:${item.country}`;
        if (existingKeys.has(key)) {
          addFailure(
            result,
            item,
            `ASIN ${item.asin} 在国家 ${item.country} 中已存在`,
          );
          continue;
        }
        insertItems.push(item);
      }

      const createdItems = [];
      for (const chunk of chunkArray(insertItems)) {
        try {
          await insertAsinChunk(query, config, chunk);
          createdItems.push(...chunk);
        } catch (error) {
          logger.warn('[ASIN批量新增] 分块插入失败，回退到逐条插入', {
            domain: config.domain,
            chunkSize: chunk.length,
            message: error.message,
          });

          for (const item of chunk) {
            try {
              await insertAsinChunk(query, config, [item]);
              createdItems.push(item);
            } catch (itemError) {
              addFailure(
                result,
                item,
                itemError.code === 'ER_DUP_ENTRY'
                  ? `ASIN ${item.asin} 在国家 ${item.country} 中已存在`
                  : itemError.message || '创建失败',
              );
            }
          }
        }
      }

      const affectedGroupIds = Array.from(
        new Set(createdItems.map((item) => item.parentId)),
      );
      if (affectedGroupIds.length > 0) {
        await updateVariantGroupTimes(query, config, affectedGroupIds);
      }

      for (const item of createdItems) {
        addSuccess(result, item);
      }
    });
  }

  if (clearCache && result.successCount > 0) {
    config.clearCache();
  }

  logger.info('[ASIN批量新增] 完成', {
    domain: config.domain,
    total: result.total,
    successCount: result.successCount,
    failedCount: result.failedCount,
    durationMs: Date.now() - startedAt,
  });

  return result;
}

module.exports = {
  batchCreateASINs,
  getAsinBatchCreateChunkSize: getChunkSize,
};
