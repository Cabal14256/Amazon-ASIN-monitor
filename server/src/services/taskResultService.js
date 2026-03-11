const fs = require('fs').promises;
const path = require('path');
const { query } = require('../config/database');

function normalizeWarnings(warnings) {
  if (!Array.isArray(warnings)) {
    return [];
  }
  return warnings
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function inferMimeType(filename = '') {
  const ext = path.extname(String(filename || '')).toLowerCase();
  switch (ext) {
    case '.xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.csv':
      return 'text/csv; charset=utf-8';
    case '.sql':
      return 'application/sql; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

function buildStructuredTaskResult(base = {}) {
  return {
    ...base,
    summary:
      typeof base.summary === 'string' && base.summary.trim()
        ? base.summary.trim()
        : '任务已完成',
    verificationPassed:
      typeof base.verificationPassed === 'boolean'
        ? base.verificationPassed
        : true,
    warnings: normalizeWarnings(base.warnings),
  };
}

async function buildFileTaskResult({
  filepath,
  filename,
  downloadUrl = null,
  mimeType,
  summary,
  warnings = [],
  extra = {},
}) {
  await fs.access(filepath);
  const stats = await fs.stat(filepath);
  if (!stats.isFile() || stats.size <= 0) {
    throw new Error('任务结果文件无效或为空');
  }

  const normalizedFilename = filename || path.basename(filepath);
  return buildStructuredTaskResult({
    ...extra,
    filepath,
    filename: normalizedFilename,
    downloadUrl,
    mimeType: mimeType || inferMimeType(normalizedFilename),
    fileSizeBytes: stats.size,
    summary: summary || `已生成文件 ${normalizedFilename}`,
    verificationPassed: true,
    warnings,
  });
}

function normalizeImportTaskResult(result = {}, extra = {}) {
  const successCount = Number(result.successCount) || 0;
  const failedCount = Number(result.failedCount) || 0;
  const processedCount =
    Number(result.processedCount) || successCount + failedCount;
  const total = Math.max(
    Number(result.total) || processedCount,
    processedCount,
  );
  const missingCount = Math.max(
    Number(result.missingCount) || total - processedCount,
    0,
  );
  const verificationPassed =
    typeof result.verificationPassed === 'boolean'
      ? result.verificationPassed
      : missingCount === 0;
  const warnings = [];

  if (missingCount > 0) {
    warnings.push(`仍有 ${missingCount} 条记录未归类`);
  }

  return buildStructuredTaskResult({
    ...result,
    ...extra,
    total,
    processedCount,
    successCount,
    failedCount,
    missingCount,
    summary: `总计 ${total} 条，成功 ${successCount} 条，失败 ${failedCount} 条`,
    verificationPassed,
    warnings,
  });
}

function normalizeBatchCheckTaskResult(result = {}, extra = {}) {
  const total = Number(result.total) || 0;
  const successCount = Number(result.successCount) || 0;
  const failedCount = Number(result.failedCount) || 0;
  const failedSamples = Array.isArray(result.results)
    ? result.results
        .filter((item) => item && item.success === false)
        .slice(0, 20)
        .map((item) => ({
          groupId: item.groupId || '',
          error: item.error || '检查失败',
        }))
    : [];
  const warnings = [];

  if (failedCount > 0) {
    warnings.push(`有 ${failedCount} 个检查项失败`);
  }

  return buildStructuredTaskResult({
    ...result,
    ...extra,
    total,
    successCount,
    failedCount,
    failedSamples,
    summary: `共 ${total} 项，成功 ${successCount} 项，失败 ${failedCount} 项`,
    verificationPassed: failedCount === 0,
    warnings,
  });
}

async function verifyDatabaseHealth() {
  try {
    const rows = await query('SELECT 1 AS ok');
    return {
      passed: rows?.[0]?.ok === 1,
      checkedAt: new Date().toISOString(),
      message:
        rows?.[0]?.ok === 1 ? '数据库健康检查通过' : '数据库健康检查未通过',
    };
  } catch (error) {
    return {
      passed: false,
      checkedAt: new Date().toISOString(),
      message: error.message || '数据库健康检查失败',
    };
  }
}

function getDownloadableTaskArtifact(result) {
  if (!result || !result.filepath) {
    return null;
  }

  return {
    filepath: result.filepath,
    filename: result.filename || path.basename(result.filepath),
    downloadUrl: result.downloadUrl || null,
    mimeType:
      result.mimeType || inferMimeType(result.filename || result.filepath),
    fileSizeBytes: Number(result.fileSizeBytes) || null,
  };
}

module.exports = {
  buildStructuredTaskResult,
  buildFileTaskResult,
  getDownloadableTaskArtifact,
  inferMimeType,
  normalizeBatchCheckTaskResult,
  normalizeImportTaskResult,
  verifyDatabaseHealth,
};
