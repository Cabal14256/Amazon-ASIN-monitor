const { v4: uuidv4 } = require('uuid');
const redisConfig = require('../config/redis');

const PREVIEW_TTL_SECONDS = 30 * 60;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const KEY_PREFIX = 'asin:incremental-preview:';

function previewKey(previewId, suffix) {
  return `${KEY_PREFIX}${previewId}:${suffix}`;
}

function createHttpError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

async function getClient() {
  const client =
    redisConfig.getRedisClient() || (await redisConfig.initRedis());
  if (!client) {
    throw createHttpError('预览服务暂不可用', 503, 'PREVIEW_STORE_UNAVAILABLE');
  }
  try {
    await client.ping();
  } catch (_) {
    throw createHttpError('预览服务暂不可用', 503, 'PREVIEW_STORE_UNAVAILABLE');
  }
  return client;
}

function normalizePreviewRow(item) {
  const before = item.before || item.current || null;
  const after = item.after || item.target || null;
  const errors = item.errors || item.error || null;
  const error = Array.isArray(errors)
    ? errors.map((entry) => entry?.message || String(entry)).join('；')
    : errors?.message || errors || null;
  return {
    row: Number(item.row ?? item.rowNumber) || 0,
    action: item.action || 'skipped',
    asin: item.asin || after?.asin || before?.asin || null,
    country: item.country || after?.country || before?.country || null,
    before,
    after,
    changes: item.changes || null,
    groupChanges: item.groupChanges || null,
    error,
  };
}

function pageOptions(query = {}) {
  const requestedPage = Number(query.page);
  const requestedPageSize = Number(query.pageSize);
  return {
    page:
      Number.isSafeInteger(requestedPage) && requestedPage > 0
        ? requestedPage
        : 1,
    pageSize:
      Number.isSafeInteger(requestedPageSize) && requestedPageSize > 0
        ? Math.min(requestedPageSize, MAX_PAGE_SIZE)
        : DEFAULT_PAGE_SIZE,
  };
}

async function createPreview({ file, userId, mode, preview }) {
  const client = await getClient();
  const previewId = uuidv4();
  const rows = Array.isArray(preview.rows)
    ? preview.rows.map(normalizePreviewRow)
    : [];
  const categoryCounts = {};
  const categoryRows = new Map();
  for (const row of rows) {
    const action = row.action;
    categoryCounts[action] = (categoryCounts[action] || 0) + 1;
    if (!categoryRows.has(action)) {
      categoryRows.set(action, []);
    }
    categoryRows.get(action).push(row);
  }

  const expiresAt = new Date(
    Date.now() + PREVIEW_TTL_SECONDS * 1000,
  ).toISOString();
  const meta = {
    previewId,
    userId: String(userId),
    mode,
    originalFilename: file.originalname,
    digest: preview.digest,
    fileHash: preview.fileHash,
    summary: preview.summary,
    categoryCounts,
    rowCount: rows.length,
    expiresAt,
  };

  const pipeline = client.pipeline();
  pipeline.set(
    previewKey(previewId, 'file'),
    file.buffer,
    'EX',
    PREVIEW_TTL_SECONDS,
  );
  const lists = new Map([['all', rows], ...categoryRows]);
  for (const [category, items] of lists) {
    if (items.length === 0) {
      continue;
    }
    const key = previewKey(previewId, `rows:${category}`);
    for (let offset = 0; offset < items.length; offset += 200) {
      pipeline.rpush(
        key,
        ...items
          .slice(offset, offset + 200)
          .map((item) => JSON.stringify(item)),
      );
    }
    pipeline.expire(key, PREVIEW_TTL_SECONDS);
  }
  const results = await pipeline.exec();
  if (results?.some(([error]) => error)) {
    throw createHttpError('保存预览失败，请重试', 503, 'PREVIEW_STORE_FAILED');
  }
  await client.set(
    previewKey(previewId, 'meta'),
    JSON.stringify(meta),
    'EX',
    PREVIEW_TTL_SECONDS,
  );
  return getPreviewPage({ previewId, userId, mode, page: 1, pageSize: 50 });
}

async function readPreviewMeta({ previewId, userId, mode }) {
  const client = await getClient();
  const raw = await client.get(previewKey(previewId, 'meta'));
  if (!raw) {
    throw createHttpError('预览已过期，请重新上传文件', 410, 'PREVIEW_EXPIRED');
  }
  const meta = JSON.parse(raw);
  if (meta.userId !== String(userId) || meta.mode !== mode) {
    throw createHttpError('预览不存在', 404, 'PREVIEW_NOT_FOUND');
  }
  return meta;
}

async function getPreviewPage({ previewId, userId, mode, kind, ...query }) {
  const meta = await readPreviewMeta({ previewId, userId, mode });
  const { page, pageSize } = pageOptions(query);
  const category = kind || 'all';
  if (category !== 'all' && !Object.hasOwn(meta.categoryCounts, category)) {
    throw createHttpError('无效的差异分类', 400, 'INVALID_PREVIEW_KIND');
  }
  const total =
    category === 'all' ? meta.rowCount : meta.categoryCounts[category] || 0;
  const offset = (page - 1) * pageSize;
  const client = await getClient();
  const rawRows =
    offset < total
      ? await client.lrange(
          previewKey(previewId, `rows:${category}`),
          offset,
          offset + pageSize - 1,
        )
      : [];
  return {
    previewId,
    expiresAt: meta.expiresAt,
    summary: meta.summary,
    categoryCounts: meta.categoryCounts,
    rows: rawRows.map((raw) => JSON.parse(raw)),
    pagination: { page, pageSize, total },
  };
}

async function getPreviewFile({ previewId, userId, mode }) {
  const meta = await readPreviewMeta({ previewId, userId, mode });
  const client = await getClient();
  const buffer = await client.getBuffer(previewKey(previewId, 'file'));
  if (!buffer) {
    throw createHttpError('预览已过期，请重新上传文件', 410, 'PREVIEW_EXPIRED');
  }
  return {
    meta,
    file: { buffer, originalname: meta.originalFilename },
  };
}

module.exports = {
  createPreview,
  getPreviewPage,
  getPreviewFile,
  readPreviewMeta,
  normalizePreviewRow,
};
