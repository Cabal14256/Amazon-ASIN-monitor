const ExcelJS = require('exceljs');
const fs = require('fs').promises;
const path = require('path');
const { Worker } = require('worker_threads');
const VariantGroup = require('../models/VariantGroup');
const MonitorHistory = require('../models/MonitorHistory');
const CompetitorVariantGroup = require('../models/CompetitorVariantGroup');
const CompetitorMonitorHistory = require('../models/CompetitorMonitorHistory');
const { getUTC8String } = require('../utils/dateTime');
const logger = require('../utils/logger');
const analyticsViewService = require('./analyticsViewService');
const websocketService = require('./websocketService');
const taskRegistryService = require('./taskRegistryService');
const { buildFileTaskResult } = require('./taskResultService');
const {
  throwIfTaskCancelled,
  isTaskCancelledError,
} = require('./taskCancellationService');
const variantCheckService = require('./variantCheckService');

const EXPORT_WORKER_SCRIPT = path.join(
  __dirname,
  '../workers/export/excelBuilderWorker.js',
);
const EXPORT_WORKER_TIMEOUT_MS =
  Number(process.env.EXPORT_WORKER_TIMEOUT_MS) || 5 * 60 * 1000;
const EXPORT_WORKER_ENABLED = !['false', '0', 'no', 'off'].includes(
  String(process.env.EXPORT_WORKER_ENABLED || 'false')
    .trim()
    .toLowerCase(),
);

// 确保导出文件目录存在
const EXPORT_DIR = path.join(__dirname, '../../tasks/export');
async function ensureExportDir() {
  try {
    await fs.mkdir(EXPORT_DIR, { recursive: true });
  } catch (error) {
    logger.error('创建导出目录失败:', error);
  }
}

function buildWorkbookFromAoa(excelData, sheetName, columnWidths = []) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);
  if (columnWidths.length > 0) {
    worksheet.columns = columnWidths.map((width) => ({ width }));
  }
  if (Array.isArray(excelData) && excelData.length > 0) {
    worksheet.addRows(excelData);
  }
  return workbook;
}

function runExportExcelWorker(payload, timeoutMs = EXPORT_WORKER_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const worker = new Worker(EXPORT_WORKER_SCRIPT);
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      worker.terminate().catch(() => {});
      reject(new Error(`导出Excel Worker超时（${timeoutMs}ms）`));
    }, timeoutMs);

    worker.once('message', (message) => {
      const {
        success,
        result,
        error,
        requestId: responseRequestId,
      } = message || {};
      if (responseRequestId !== requestId || settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      worker.terminate().catch(() => {});

      if (!success) {
        reject(new Error(error || '导出Excel Worker执行失败'));
        return;
      }

      resolve(result);
    });

    worker.once('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      worker.terminate().catch(() => {});
      reject(error);
    });

    worker.once('exit', (code) => {
      if (settled || code === 0) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(new Error(`导出Excel Worker异常退出，code=${code}`));
    });

    worker.postMessage({
      requestId,
      payload,
    });
  });
}

async function writeAoaWorkbookToFile({
  excelData,
  sheetName,
  columnWidths = [],
  filepath,
}) {
  if (EXPORT_WORKER_ENABLED) {
    try {
      await runExportExcelWorker({
        rows: excelData,
        sheetName,
        columnWidths,
        outputPath: filepath,
      });
      return { usedWorker: true };
    } catch (error) {
      logger.warn(
        `[导出任务] Excel Worker执行失败，回退主线程: ${error.message}`,
      );
    }
  }

  const workbook = buildWorkbookFromAoa(excelData, sheetName, columnWidths);
  const excelBuffer = await workbook.xlsx.writeBuffer();
  await fs.writeFile(filepath, excelBuffer);
  return { usedWorker: false };
}

/**
 * 分页循环查询所有数据
 */
async function fetchAllData(
  queryFn,
  baseParams,
  pageSize = 10000,
  progressCallback = null,
  beforePage = null,
) {
  if (typeof beforePage === 'function') {
    await beforePage(1);
  }
  const firstPage = await queryFn({ ...baseParams, current: 1, pageSize });
  const total = firstPage.total;
  let allData = [...firstPage.list];

  if (total > pageSize) {
    const totalPages = Math.ceil(total / pageSize);
    if (progressCallback) {
      progressCallback(
        10 + Math.floor((1 / totalPages) * 20),
        `正在查询数据... (1/${totalPages}页)`,
      );
    }

    for (let page = 2; page <= totalPages; page++) {
      if (typeof beforePage === 'function') {
        await beforePage(page);
      }
      const pageResult = await queryFn({
        ...baseParams,
        current: page,
        pageSize,
      });
      allData = allData.concat(pageResult.list);

      if (progressCallback) {
        const queryProgress = 10 + Math.floor((page / totalPages) * 20);
        progressCallback(
          queryProgress,
          `正在查询数据... (${page}/${totalPages}页)`,
        );
      }
    }
  }

  return allData;
}

/**
 * 格式化检查时间
 */
function formatCheckTime(timeValue) {
  if (!timeValue) return '';
  if (typeof timeValue === 'string') {
    return timeValue;
  }
  if (timeValue instanceof Date) {
    const d = new Date(timeValue);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }
  return '';
}

/**
 * 格式化ASIN类型
 */
function formatAsinType(asinType) {
  if (!asinType) return '';
  const normalizedType =
    asinType === 'MAIN_LINK' ? '1' : asinType === 'SUB_REVIEW' ? '2' : asinType;
  if (normalizedType === '1') {
    return '主链';
  } else if (normalizedType === '2') {
    return '副评';
  }
  return normalizedType;
}

/**
 * 格式化检查结果详情
 */
function formatCheckResult(checkResult) {
  if (!checkResult) return '';
  try {
    const parsed =
      typeof checkResult === 'string' ? JSON.parse(checkResult) : checkResult;
    return JSON.stringify(parsed, null, 2);
  } catch (e) {
    return checkResult;
  }
}

function parseCheckResultPayload(checkResult) {
  if (!checkResult) {
    return null;
  }

  if (typeof checkResult === 'string') {
    try {
      return JSON.parse(checkResult);
    } catch (error) {
      return null;
    }
  }

  return typeof checkResult === 'object' ? checkResult : null;
}

function formatCheckTypeLabel(checkType) {
  if (checkType === 'GROUP') {
    return '变体组';
  }
  if (checkType === 'ASIN') {
    return 'ASIN';
  }
  return checkType || '';
}

function extractManualExportInfo(checkResult) {
  const payload = parseCheckResultPayload(checkResult);
  if (!payload) {
    return {
      statusSource: '',
      manualAction: '',
      manualReason: '',
      operator: '',
    };
  }

  let manualAction = '';
  if (payload.source === 'MANUAL_ACTION') {
    manualAction =
      payload.action === 'MARK_BROKEN' ? '人工标记异常' : '取消人工标记';
  }

  return {
    statusSource: payload.statusSource || '',
    manualAction,
    manualReason: payload.reason || payload.manualBrokenReason || '',
    operator: payload.operator || payload.manualBrokenUpdatedBy || '',
  };
}

/**
 * 规范化ASIN筛选参数
 * - 单个值：保持字符串（兼容模糊搜索）
 * - 多个值：返回数组（精确匹配）
 */
function normalizeAsinFilter(asinValue) {
  if (!asinValue) {
    return '';
  }

  if (Array.isArray(asinValue)) {
    const normalized = [
      ...new Set(
        asinValue
          .map((item) => String(item || '').trim())
          .filter((item) => item.length > 0),
      ),
    ];
    if (normalized.length === 0) {
      return '';
    }
    return normalized.length === 1 ? normalized[0] : normalized;
  }

  if (typeof asinValue === 'string') {
    const trimmed = asinValue.trim();
    if (!trimmed) {
      return '';
    }
    if (!/[,\s]/.test(trimmed)) {
      return trimmed;
    }
    const normalized = [
      ...new Set(
        trimmed
          .split(/[,\s]+/)
          .map((item) => item.trim())
          .filter((item) => item.length > 0),
      ),
    ];
    if (normalized.length === 0) {
      return '';
    }
    return normalized.length === 1 ? normalized[0] : normalized;
  }

  return '';
}

/**
 * 更新任务进度
 */
function updateProgress(job, taskId, progress, message, userId = null) {
  job.progress(progress);
  taskRegistryService
    .updateTaskProgress(taskId, progress, message)
    .catch((error) => {
      logger.warn('[导出任务] 更新任务注册表进度失败:', error.message);
    });
  websocketService.sendTaskProgress(taskId, progress, message, userId);
}

/**
 * 处理导出任务
 */
async function processExportTask(job) {
  const { taskId, exportType, params, userId } = job.data;

  try {
    await ensureExportDir();
    await taskRegistryService.markTaskProcessing(taskId, {
      taskSubType: exportType,
      message: '导出任务开始处理',
    });
    await throwIfTaskCancelled(taskId, '导出任务已取消');
    updateProgress(job, taskId, 5, '正在初始化...', userId);

    let result;
    switch (exportType) {
      case 'asin':
        result = await processASINExport(job, taskId, params, userId);
        break;
      case 'monitor-history':
        result = await processMonitorHistoryExport(job, taskId, params, userId);
        break;
      case 'variant-group':
        result = await processVariantGroupExport(job, taskId, params, userId);
        break;
      case 'competitor-asin':
        result = await processCompetitorASINExport(job, taskId, params, userId);
        break;
      case 'competitor-variant-group':
        result = await processCompetitorVariantGroupExport(
          job,
          taskId,
          params,
          userId,
        );
        break;
      case 'competitor-monitor-history':
        result = await processCompetitorMonitorHistoryExport(
          job,
          taskId,
          params,
          userId,
        );
        break;
      case 'analytics-monthly-breakdown':
        result = await processAnalyticsMonthlyBreakdownExport(
          job,
          taskId,
          params,
          userId,
        );
        break;
      case 'parent-asin-query':
        result = await processParentAsinQueryExport(
          job,
          taskId,
          params,
          userId,
        );
        break;
      default:
        throw new Error(`不支持的导出类型: ${exportType}`);
    }

    updateProgress(job, taskId, 100, '导出完成', userId);

    // 通知任务完成
    const downloadUrl = `/api/v1/tasks/${taskId}/download`;
    const completedResult = await buildFileTaskResult({
      filepath: result.filepath,
      filename: result.filename,
      downloadUrl,
      summary: `导出文件已生成：${result.filename || taskId}`,
      extra: result,
    });
    await taskRegistryService.markTaskCompleted(taskId, completedResult, {
      message: '导出完成',
    });
    websocketService.sendTaskComplete(
      taskId,
      downloadUrl,
      result.filename,
      userId,
    );

    return completedResult;
  } catch (error) {
    if (isTaskCancelledError(error)) {
      logger.info(`[导出任务] 任务已取消 (${taskId}): ${error.message}`);
      await taskRegistryService.markTaskCancelled(taskId, {
        message: error.message || '导出任务已取消',
      });
      websocketService.sendTaskCancelled(
        taskId,
        error.message || '导出任务已取消',
        userId,
      );
      return {
        cancelled: true,
        message: error.message || '导出任务已取消',
      };
    }

    logger.error(`[导出任务] 处理失败 (${taskId}):`, error);
    await taskRegistryService.markTaskFailed(
      taskId,
      error.message || '导出失败',
      {
        message: error.message || '导出失败',
      },
    );
    websocketService.sendTaskError(taskId, error.message || '导出失败', userId);
    throw error;
  }
}

/**
 * 处理ASIN数据导出
 */
async function processASINExport(job, taskId, params, userId) {
  const { keyword, country, variantStatus } = params;

  updateProgress(job, taskId, 10, '正在查询数据...', userId);

  const allGroups = await fetchAllData(
    (params) => VariantGroup.findAll(params),
    {
      keyword: keyword || '',
      country: country || '',
      variantStatus: variantStatus || '',
    },
    10000,
    (progress, message) => {
      updateProgress(job, taskId, progress, message, userId);
    },
    async (page) => {
      await throwIfTaskCancelled(
        taskId,
        `导出任务已取消（在查询第 ${page} 页前停止）`,
      );
    },
  );

  updateProgress(job, taskId, 30, '正在处理数据...', userId);

  const excelData = [];
  excelData.push([
    '变体组名称',
    '变体组ID',
    '国家',
    '站点',
    '品牌',
    '变体状态',
    'ASIN',
    'ASIN名称',
    'ASIN类型',
    'ASIN状态',
    '创建时间',
    '最后检查时间',
  ]);

  const totalItems = allGroups.length;
  let processedItems = 0;
  for (const group of allGroups) {
    if (processedItems % 20 === 0) {
      await throwIfTaskCancelled(
        taskId,
        `导出任务已取消（已处理 ${processedItems}/${totalItems} 个分组）`,
      );
    }
    if (group.children && group.children.length > 0) {
      for (const asin of group.children) {
        excelData.push([
          group.name || '',
          group.id || '',
          group.country || '',
          group.site || '',
          group.brand || '',
          group.isBroken === 1 ? '异常' : '正常',
          asin.asin || '',
          asin.name || '',
          asin.asinType || '',
          asin.isBroken === 1 ? '异常' : '正常',
          asin.createTime || '',
          asin.lastCheckTime || '',
        ]);
      }
    } else {
      excelData.push([
        group.name || '',
        group.id || '',
        group.country || '',
        group.site || '',
        group.brand || '',
        group.isBroken === 1 ? '异常' : '正常',
        '',
        '',
        '',
        '',
        group.createTime || '',
        '',
      ]);
    }
    processedItems++;
    if (totalItems > 0) {
      const progress = 30 + Math.floor((processedItems / totalItems) * 40);
      updateProgress(
        job,
        taskId,
        progress,
        `正在处理数据... (${processedItems}/${totalItems})`,
        userId,
      );
    }
  }

  updateProgress(job, taskId, 75, '正在生成Excel文件...', userId);
  const filename = `ASIN数据_${getUTC8String('YYYY-MM-DD')}.xlsx`;
  const filepath = path.join(EXPORT_DIR, `${taskId}.xlsx`);

  updateProgress(job, taskId, 90, '正在生成Excel文件...', userId);

  await writeAoaWorkbookToFile({
    excelData,
    sheetName: 'ASIN数据',
    columnWidths: [20, 40, 10, 10, 15, 10, 15, 50, 15, 10, 20, 20],
    filepath,
  });

  return { filename, filepath };
}

/**
 * 处理监控历史导出
 */
async function processMonitorHistoryExport(job, taskId, params, userId) {
  const {
    country,
    checkType,
    variantGroupId,
    asinId,
    asin,
    variantGroupName,
    asinName,
    asinType,
    startTime,
    endTime,
    isBroken,
    exportType = 'records',
  } = params;

  const isStatusChanges = exportType === 'statusChanges';

  updateProgress(job, taskId, 10, '正在查询数据...', userId);

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(
    isStatusChanges ? '状态变动' : '监控历史',
  );

  const headers = isStatusChanges
    ? [
        '检查时间',
        '检查类型',
        '变体组名称',
        'ASIN',
        'ASIN名称',
        'ASIN类型',
        '国家',
        '状态变动',
        '检查结果',
        '状态来源',
        '人工操作',
        '人工原因',
        '操作人',
        '检查详情',
      ]
    : [
        '检查时间',
        '检查类型',
        '变体组名称',
        'ASIN',
        'ASIN名称',
        'ASIN类型',
        '国家',
        '检查结果',
        '状态来源',
        '人工操作',
        '人工原因',
        '操作人',
        '检查详情',
      ];

  worksheet.addRow(headers);

  const columnWidths = isStatusChanges
    ? [
        { width: 20 },
        { width: 10 },
        { width: 30 },
        { width: 15 },
        { width: 50 },
        { width: 10 },
        { width: 10 },
        { width: 15 },
        { width: 10 },
        { width: 14 },
        { width: 16 },
        { width: 30 },
        { width: 16 },
        { width: 100 },
      ]
    : [
        { width: 20 },
        { width: 10 },
        { width: 30 },
        { width: 15 },
        { width: 50 },
        { width: 10 },
        { width: 10 },
        { width: 10 },
        { width: 14 },
        { width: 16 },
        { width: 30 },
        { width: 16 },
        { width: 100 },
      ];

  worksheet.columns = columnWidths;
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' },
  };

  const asinParam = normalizeAsinFilter(asin);
  const effectiveEndTime = endTime || getUTC8String('YYYY-MM-DD HH:mm:ss');

  const queryParams = {
    country: country || '',
    checkType: checkType || '',
    variantGroupId: variantGroupId || '',
    asinId: asinId || '',
    asin: asinParam,
    variantGroupName: variantGroupName || '',
    asinName: asinName || '',
    asinType: asinType || '',
    startTime: startTime || '',
    endTime: effectiveEndTime,
    isBroken: isBroken || '',
  };

  const batchSize = 10000;

  const queryBatch = async (page) => {
    const batchParams = {
      ...queryParams,
      current: page,
      pageSize: batchSize,
      skipCount: true,
    };

    return isStatusChanges
      ? await MonitorHistory.findStatusChanges(batchParams)
      : await MonitorHistory.findAll(batchParams);
  };

  await throwIfTaskCancelled(taskId, '导出任务已取消');
  const firstBatch = await queryBatch(1);
  const total = Number(firstBatch?.total) || 0;
  const totalMessage =
    total > 0 ? `找到 ${total} 条记录，开始处理...` : '开始处理记录...';
  updateProgress(job, taskId, 15, totalMessage, userId);

  let processedCount = 0;

  const processBatch = (batch) => {
    const rowsData = [];
    for (const history of batch.list || []) {
      const checkTimeStr = formatCheckTime(
        history.check_time || history.checkTime,
      );
      const asinTypeText = formatAsinType(history.asinType);
      const rawCheckResult = history.checkResult || history.check_result;
      const checkResult = formatCheckResult(rawCheckResult);
      const manualInfo = extractManualExportInfo(rawCheckResult);

      const rowData = isStatusChanges
        ? [
            checkTimeStr,
            formatCheckTypeLabel(history.checkType),
            history.variantGroupName || '',
            history.asin || '',
            history.asinName || '',
            asinTypeText,
            history.country || '',
            history.statusChange || '',
            history.isBroken === 1 ? '异常' : '正常',
            manualInfo.statusSource,
            manualInfo.manualAction,
            manualInfo.manualReason,
            manualInfo.operator,
            checkResult,
          ]
        : [
            checkTimeStr,
            formatCheckTypeLabel(history.checkType),
            history.variantGroupName || '',
            history.asin || '',
            history.asinName || '',
            asinTypeText,
            history.country || '',
            history.isBroken === 1 ? '异常' : '正常',
            manualInfo.statusSource,
            manualInfo.manualAction,
            manualInfo.manualReason,
            manualInfo.operator,
            checkResult,
          ];

      rowsData.push(rowData);
    }

    if (rowsData.length > 0) {
      worksheet.addRows(rowsData);
      processedCount += rowsData.length;
    }

    const progressDenominator = total > 0 ? total : processedCount + batchSize;
    const progress = Math.min(
      15 + Math.floor((processedCount / progressDenominator) * 60),
      75,
    );
    const progressText =
      total > 0 ? `${processedCount}/${total}` : `${processedCount} 条`;
    updateProgress(
      job,
      taskId,
      progress,
      `正在处理数据... (${progressText})`,
      userId,
    );
  };

  let currentBatch = firstBatch;
  let page = 1;
  while ((currentBatch.list || []).length > 0) {
    await throwIfTaskCancelled(
      taskId,
      `导出任务已取消（在处理第 ${page} 批监控历史前停止）`,
    );
    processBatch(currentBatch);
    if ((currentBatch.list || []).length < batchSize) {
      break;
    }
    page += 1;
    await throwIfTaskCancelled(
      taskId,
      `导出任务已取消（在查询第 ${page} 批监控历史前停止）`,
    );
    currentBatch = await queryBatch(page);
  }

  updateProgress(job, taskId, 80, '正在生成Excel文件...', userId);

  const filename = isStatusChanges
    ? `状态变动_${getUTC8String('YYYY-MM-DD')}.xlsx`
    : `监控历史_${getUTC8String('YYYY-MM-DD')}.xlsx`;

  const filepath = path.join(EXPORT_DIR, `${taskId}.xlsx`);
  await workbook.xlsx.writeFile(filepath);

  return { filename, filepath };
}

/**
 * 处理变体组数据导出
 */
async function processVariantGroupExport(job, taskId, params, userId) {
  const { keyword, country, variantStatus } = params;

  updateProgress(job, taskId, 10, '正在查询数据...', userId);

  const allGroups = await fetchAllData(
    (params) => VariantGroup.findAll(params),
    {
      keyword: keyword || '',
      country: country || '',
      variantStatus: variantStatus || '',
    },
    10000,
    (progress, message) => {
      updateProgress(job, taskId, progress, message, userId);
    },
    async (page) => {
      await throwIfTaskCancelled(
        taskId,
        `导出任务已取消（在查询第 ${page} 页前停止）`,
      );
    },
  );

  updateProgress(job, taskId, 30, '正在处理数据...', userId);

  const excelData = [];
  excelData.push([
    '变体组名称',
    '变体组ID',
    '国家',
    '站点',
    '品牌',
    '变体状态',
    'ASIN数量',
    '异常ASIN数量',
    '创建时间',
    '更新时间',
    '最后检查时间',
  ]);

  const totalItems = allGroups.length;
  let processedItems = 0;
  for (const group of allGroups) {
    if (processedItems % 20 === 0) {
      await throwIfTaskCancelled(
        taskId,
        `导出任务已取消（已处理 ${processedItems}/${totalItems} 个分组）`,
      );
    }
    const asinCount = group.children?.length || 0;
    const brokenAsinCount =
      group.children?.filter((asin) => asin.isBroken === 1).length || 0;

    excelData.push([
      group.name || '',
      group.id || '',
      group.country || '',
      group.site || '',
      group.brand || '',
      group.isBroken === 1 ? '异常' : '正常',
      asinCount,
      brokenAsinCount,
      group.createTime || '',
      group.updateTime || '',
      group.lastCheckTime || '',
    ]);
    processedItems++;
    if (totalItems > 0) {
      const progress = 30 + Math.floor((processedItems / totalItems) * 40);
      updateProgress(
        job,
        taskId,
        progress,
        `正在处理数据... (${processedItems}/${totalItems})`,
        userId,
      );
    }
  }

  updateProgress(job, taskId, 75, '正在生成Excel文件...', userId);
  const filename = `变体组数据_${getUTC8String('YYYY-MM-DD')}.xlsx`;
  const filepath = path.join(EXPORT_DIR, `${taskId}.xlsx`);

  updateProgress(job, taskId, 90, '正在生成Excel文件...', userId);

  await writeAoaWorkbookToFile({
    excelData,
    sheetName: '变体组数据',
    columnWidths: [30, 40, 10, 10, 15, 10, 10, 12, 20, 20, 20],
    filepath,
  });

  return { filename, filepath };
}

/**
 * 处理竞品ASIN数据导出
 */
async function processCompetitorASINExport(job, taskId, params, userId) {
  const { keyword, country, variantStatus } = params;

  updateProgress(job, taskId, 10, '正在查询数据...', userId);

  const allGroups = await fetchAllData(
    (queryParams) => CompetitorVariantGroup.findAll(queryParams),
    {
      keyword: keyword || '',
      country: country || '',
      variantStatus: variantStatus || '',
    },
    10000,
    (progress, message) => {
      updateProgress(job, taskId, progress, message, userId);
    },
    async (page) => {
      await throwIfTaskCancelled(
        taskId,
        `导出任务已取消（在查询第 ${page} 页前停止）`,
      );
    },
  );

  updateProgress(job, taskId, 30, '正在处理数据...', userId);

  const excelData = [];
  excelData.push([
    '变体组名称',
    '变体组ID',
    '国家',
    '品牌',
    '变体状态',
    'ASIN',
    'ASIN名称',
    'ASIN类型',
    'ASIN状态',
    '创建时间',
    '最后检查时间',
  ]);

  const totalItems = allGroups.length;
  let processedItems = 0;
  for (const group of allGroups) {
    if (processedItems % 20 === 0) {
      await throwIfTaskCancelled(
        taskId,
        `导出任务已取消（已处理 ${processedItems}/${totalItems} 个分组）`,
      );
    }
    if (group.children && group.children.length > 0) {
      for (const asin of group.children) {
        excelData.push([
          group.name || '',
          group.id || '',
          group.country || '',
          group.brand || '',
          group.isBroken === 1 ? '异常' : '正常',
          asin.asin || '',
          asin.name || '',
          asin.asinType || '',
          asin.isBroken === 1 ? '异常' : '正常',
          asin.createTime || '',
          asin.lastCheckTime || '',
        ]);
      }
    } else {
      excelData.push([
        group.name || '',
        group.id || '',
        group.country || '',
        group.brand || '',
        group.isBroken === 1 ? '异常' : '正常',
        '',
        '',
        '',
        '',
        group.createTime || '',
        '',
      ]);
    }
    processedItems += 1;
    if (totalItems > 0) {
      const progress = 30 + Math.floor((processedItems / totalItems) * 40);
      updateProgress(
        job,
        taskId,
        progress,
        `正在处理数据... (${processedItems}/${totalItems})`,
        userId,
      );
    }
  }

  updateProgress(job, taskId, 75, '正在生成Excel文件...', userId);
  const filename = `竞品ASIN数据_${getUTC8String('YYYY-MM-DD')}.xlsx`;
  const filepath = path.join(EXPORT_DIR, `${taskId}.xlsx`);

  updateProgress(job, taskId, 90, '正在生成Excel文件...', userId);

  await writeAoaWorkbookToFile({
    excelData,
    sheetName: '竞品ASIN数据',
    columnWidths: [20, 40, 10, 15, 10, 15, 50, 15, 10, 20, 20],
    filepath,
  });

  return { filename, filepath };
}

/**
 * 处理竞品变体组数据导出
 */
async function processCompetitorVariantGroupExport(
  job,
  taskId,
  params,
  userId,
) {
  const { keyword, country, variantStatus } = params;

  updateProgress(job, taskId, 10, '正在查询数据...', userId);

  const allGroups = await fetchAllData(
    (queryParams) => CompetitorVariantGroup.findAll(queryParams),
    {
      keyword: keyword || '',
      country: country || '',
      variantStatus: variantStatus || '',
    },
    10000,
    (progress, message) => {
      updateProgress(job, taskId, progress, message, userId);
    },
    async (page) => {
      await throwIfTaskCancelled(
        taskId,
        `导出任务已取消（在查询第 ${page} 页前停止）`,
      );
    },
  );

  updateProgress(job, taskId, 30, '正在处理数据...', userId);

  const excelData = [];
  excelData.push([
    '变体组名称',
    '变体组ID',
    '国家',
    '品牌',
    '变体状态',
    'ASIN数量',
    '异常ASIN数量',
    '创建时间',
    '更新时间',
    '最后检查时间',
  ]);

  const totalItems = allGroups.length;
  let processedItems = 0;
  for (const group of allGroups) {
    if (processedItems % 20 === 0) {
      await throwIfTaskCancelled(
        taskId,
        `导出任务已取消（已处理 ${processedItems}/${totalItems} 个分组）`,
      );
    }
    const asinCount = group.children?.length || 0;
    const brokenAsinCount =
      group.children?.filter((asin) => asin.isBroken === 1).length || 0;

    excelData.push([
      group.name || '',
      group.id || '',
      group.country || '',
      group.brand || '',
      group.isBroken === 1 ? '异常' : '正常',
      asinCount,
      brokenAsinCount,
      group.createTime || '',
      group.updateTime || '',
      group.lastCheckTime || '',
    ]);
    processedItems += 1;
    if (totalItems > 0) {
      const progress = 30 + Math.floor((processedItems / totalItems) * 40);
      updateProgress(
        job,
        taskId,
        progress,
        `正在处理数据... (${processedItems}/${totalItems})`,
        userId,
      );
    }
  }

  updateProgress(job, taskId, 75, '正在生成Excel文件...', userId);
  const filename = `竞品变体组数据_${getUTC8String('YYYY-MM-DD')}.xlsx`;
  const filepath = path.join(EXPORT_DIR, `${taskId}.xlsx`);

  updateProgress(job, taskId, 90, '正在生成Excel文件...', userId);

  await writeAoaWorkbookToFile({
    excelData,
    sheetName: '竞品变体组数据',
    columnWidths: [30, 40, 10, 15, 10, 10, 12, 20, 20, 20],
    filepath,
  });

  return { filename, filepath };
}

/**
 * 处理竞品监控历史导出
 */
async function processCompetitorMonitorHistoryExport(
  job,
  taskId,
  params,
  userId,
) {
  const {
    country,
    checkType,
    variantGroupId,
    asinId,
    asin,
    variantGroupName,
    parentAsin,
    startTime,
    endTime,
    isBroken,
  } = params;

  updateProgress(job, taskId, 10, '正在查询数据...', userId);

  const effectiveEndTime = endTime || getUTC8String('YYYY-MM-DD HH:mm:ss');

  const allHistory = await fetchAllData(
    (params) => CompetitorMonitorHistory.findAll(params),
    {
      country: country || '',
      checkType: checkType || '',
      variantGroupId: variantGroupId || '',
      asinId: asinId || '',
      asin: asin || '',
      variantGroupName: variantGroupName || '',
      parentAsin: parentAsin || '',
      startTime: startTime || '',
      endTime: effectiveEndTime,
      isBroken: isBroken || '',
    },
    10000,
    (progress, message) => {
      updateProgress(job, taskId, progress, message, userId);
    },
    async (page) => {
      await throwIfTaskCancelled(
        taskId,
        `导出任务已取消（在查询第 ${page} 页前停止）`,
      );
    },
  );

  updateProgress(job, taskId, 30, '正在处理数据...', userId);

  const excelData = [];
  excelData.push([
    '检查时间',
    '检查类型',
    '变体组名称',
    'ASIN',
    '父变体ASIN',
    '国家',
    '检查结果',
    '检查详情',
  ]);

  const totalItems = allHistory.length;
  let processedItems = 0;
  for (const history of allHistory) {
    if (processedItems % 100 === 0) {
      await throwIfTaskCancelled(
        taskId,
        `导出任务已取消（已处理 ${processedItems}/${totalItems} 条记录）`,
      );
    }
    const checkResult = formatCheckResult(
      history.checkResult || history.check_result,
    );

    const checkTimeStr = formatCheckTime(
      history.check_time || history.checkTime,
    );

    excelData.push([
      checkTimeStr,
      history.checkType === 'GROUP' ? '变体组' : 'ASIN',
      history.variantGroupName || '',
      history.asin || '',
      history.parentAsin || '',
      history.country || '',
      history.isBroken === 1 ? '异常' : '正常',
      checkResult,
    ]);
    processedItems++;
    if (totalItems > 0) {
      const progress = 30 + Math.floor((processedItems / totalItems) * 40);
      updateProgress(
        job,
        taskId,
        progress,
        `正在处理数据... (${processedItems}/${totalItems})`,
        userId,
      );
    }
  }

  updateProgress(job, taskId, 75, '正在生成Excel文件...', userId);
  const filename = `竞品监控历史_${getUTC8String('YYYY-MM-DD')}.xlsx`;
  const filepath = path.join(EXPORT_DIR, `${taskId}.xlsx`);

  updateProgress(job, taskId, 90, '正在生成Excel文件...', userId);

  await writeAoaWorkbookToFile({
    excelData,
    sheetName: '竞品监控历史',
    columnWidths: [20, 10, 30, 15, 50, 10, 10, 100],
    filepath,
  });

  return { filename, filepath };
}

/**
 * 处理月度异常时长统计导出
 */
async function processAnalyticsMonthlyBreakdownExport(
  job,
  taskId,
  params,
  userId,
) {
  const {
    country = '',
    month = '',
    startTime = '',
    endTime = '',
  } = params || {};

  const now = new Date();
  const fallbackMonth = `${now.getFullYear()}-${String(
    now.getMonth() + 1,
  ).padStart(2, '0')}`;
  const monthTokenCandidate = month || String(startTime).slice(0, 7);
  const monthToken = /^\d{4}-\d{2}$/.test(monthTokenCandidate)
    ? monthTokenCandidate
    : fallbackMonth;

  const [yearText, monthText] = monthToken.split('-');
  const year = Number(yearText) || now.getFullYear();
  const monthNumber = Number(monthText) || now.getMonth() + 1;
  const safeMonthNumber = Math.min(12, Math.max(1, monthNumber));
  const daysInMonth = new Date(year, safeMonthNumber, 0).getDate();
  const normalizedMonthToken = `${year}-${String(safeMonthNumber).padStart(
    2,
    '0',
  )}`;

  const effectiveStartTime = startTime || `${normalizedMonthToken}-01 00:00:00`;
  const effectiveEndTime =
    endTime ||
    `${normalizedMonthToken}-${String(daysInMonth).padStart(2, '0')} 23:59:59`;

  updateProgress(job, taskId, 10, '正在查询月度数据...', userId);

  const statistics = await MonitorHistory.getStatisticsByTime({
    country,
    startTime: effectiveStartTime,
    endTime: effectiveEndTime,
    groupBy: 'day',
    sourceGranularityOverride: 'day',
  });

  updateProgress(job, taskId, 55, '正在处理月度数据...', userId);

  const breakdown = analyticsViewService.buildMonthlyBreakdownRows(
    statistics,
    normalizedMonthToken,
  );
  const excelData = [
    ['日期', '异常时长（小时）', '总监控时长（小时）', '异常时长占比'],
  ];

  for (let day = 1; day <= daysInMonth; day += 1) {
    if ((day - 1) % 7 === 0) {
      await throwIfTaskCancelled(
        taskId,
        `导出任务已取消（已处理 ${day - 1}/${daysInMonth} 天数据）`,
      );
    }
    const row = breakdown.rows[day - 1] || {
      day,
      abnormalDurationHours: 0,
      totalDurationHours: 0,
      abnormalDurationRate: 0,
    };

    excelData.push([
      row.day,
      Number(row.abnormalDurationHours.toFixed(2)),
      Number(row.totalDurationHours.toFixed(2)),
      `${row.abnormalDurationRate.toFixed(2)}%`,
    ]);
  }

  excelData.push([
    '总体异常时长占比',
    Number(breakdown.summary.abnormalDurationTotal.toFixed(2)),
    Number(breakdown.summary.totalDurationTotal.toFixed(2)),
    `${breakdown.summary.averageRatio.toFixed(2)}%`,
  ]);

  updateProgress(job, taskId, 90, '正在生成Excel文件...', userId);

  const filename = `月度异常时长统计_${normalizedMonthToken}.xlsx`;
  const filepath = path.join(EXPORT_DIR, `${taskId}.xlsx`);

  await writeAoaWorkbookToFile({
    excelData,
    sheetName: '月度异常时长统计',
    columnWidths: [12, 12, 14, 12],
    filepath,
  });

  return { filename, filepath };
}

async function processParentAsinQueryExport(job, taskId, params, userId) {
  const { asins, country } = params || {};

  if (!asins || typeof asins !== 'string') {
    throw new Error('请提供ASIN列表');
  }
  if (!country || typeof country !== 'string') {
    throw new Error('请提供国家代码');
  }

  const asinList = asins
    .split(/[,\n]/)
    .map((asin) => asin.trim().toUpperCase())
    .filter((asin) => asin && /^[A-Z][A-Z0-9]{9}$/.test(asin));

  if (asinList.length === 0) {
    throw new Error('没有有效的ASIN');
  }

  updateProgress(job, taskId, 10, '开始查询ASIN父变体...', userId);
  await throwIfTaskCancelled(taskId, '导出任务已取消');

  const results = await variantCheckService.batchQueryParentAsin(
    asinList,
    country,
  );

  updateProgress(job, taskId, 80, '正在生成Excel文件...', userId);

  const excelData = [
    [
      'ASIN',
      '国家',
      '是否有父变体',
      '父变体ASIN',
      '父体标题',
      '产品标题',
      '品牌',
      '是否有变体',
      '变体数量',
      '查询时间',
      '错误信息',
    ],
  ];

  const queryTime = getUTC8String('YYYY-MM-DD HH:mm:ss');
  for (let index = 0; index < results.length; index += 1) {
    if (index % 50 === 0) {
      await throwIfTaskCancelled(
        taskId,
        `导出任务已取消（已处理 ${index}/${results.length} 条父体记录）`,
      );
    }
    const result = results[index];
    excelData.push([
      result.asin || '',
      country || '',
      result.hasParentAsin ? '是' : '否',
      result.parentAsin || '',
      result.parentTitle || '',
      result.title || '',
      result.brand || '',
      result.hasVariants ? '是' : '否',
      result.variantCount || 0,
      queryTime,
      result.error || '',
    ]);
  }

  updateProgress(job, taskId, 90, '正在生成Excel文件...', userId);
  const filename = `ASIN父变体查询结果_${getUTC8String('YYYY-MM-DD')}.xlsx`;
  const filepath = path.join(EXPORT_DIR, `${taskId}.xlsx`);

  await writeAoaWorkbookToFile({
    excelData,
    sheetName: '父变体查询结果',
    columnWidths: [15, 10, 15, 15, 50, 50, 20, 15, 12, 20, 30],
    filepath,
  });

  return { filename, filepath };
}

module.exports = {
  processExportTask,
};
