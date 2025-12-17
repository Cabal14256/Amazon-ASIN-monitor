const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
const fs = require('fs').promises;
const path = require('path');
const VariantGroup = require('../models/VariantGroup');
const ASIN = require('../models/ASIN');
const MonitorHistory = require('../models/MonitorHistory');
const CompetitorMonitorHistory = require('../models/CompetitorMonitorHistory');
const { getUTC8String } = require('../utils/dateTime');
const logger = require('../utils/logger');
const websocketService = require('./websocketService');

// 确保导出文件目录存在
const EXPORT_DIR = path.join(__dirname, '../../tasks/export');
async function ensureExportDir() {
  try {
    await fs.mkdir(EXPORT_DIR, { recursive: true });
  } catch (error) {
    logger.error('创建导出目录失败:', error);
  }
}

/**
 * 分页循环查询所有数据
 */
async function fetchAllData(
  queryFn,
  baseParams,
  pageSize = 10000,
  progressCallback = null,
) {
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

/**
 * 更新任务进度
 */
function updateProgress(job, taskId, progress, message, userId = null) {
  job.progress(progress);
  websocketService.sendTaskProgress(taskId, progress, message, userId);
}

/**
 * 处理导出任务
 */
async function processExportTask(job) {
  const { taskId, exportType, params, userId } = job.data;

  try {
    await ensureExportDir();
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
      case 'competitor-monitor-history':
        result = await processCompetitorMonitorHistoryExport(
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
    websocketService.sendTaskComplete(
      taskId,
      downloadUrl,
      result.filename,
      userId,
    );

    return result;
  } catch (error) {
    logger.error(`[导出任务] 处理失败 (${taskId}):`, error);
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

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(excelData);
  ws['!cols'] = [
    { wch: 20 },
    { wch: 40 },
    { wch: 10 },
    { wch: 10 },
    { wch: 15 },
    { wch: 10 },
    { wch: 15 },
    { wch: 50 },
    { wch: 15 },
    { wch: 10 },
    { wch: 20 },
    { wch: 20 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'ASIN数据');

  updateProgress(job, taskId, 90, '正在生成Excel文件...', userId);

  const excelBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const filename = `ASIN数据_${getUTC8String('YYYY-MM-DD')}.xlsx`;
  const filepath = path.join(EXPORT_DIR, `${taskId}.xlsx`);
  await fs.writeFile(filepath, excelBuffer);

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
        { width: 100 },
      ];

  worksheet.columns = columnWidths;
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' },
  };

  let asinParam = asin || '';
  if (asinParam && typeof asinParam === 'string' && asinParam.includes(',')) {
    asinParam = asinParam
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  const queryParams = {
    country: country || '',
    checkType: checkType || '',
    variantGroupId: variantGroupId || '',
    asinId: asinId || '',
    asin: asinParam,
    startTime: startTime || '',
    endTime: endTime || '',
    isBroken: isBroken || '',
  };

  const firstPage = isStatusChanges
    ? await MonitorHistory.findStatusChanges({
        ...queryParams,
        current: 1,
        pageSize: 1,
      })
    : await MonitorHistory.findAll({
        ...queryParams,
        current: 1,
        pageSize: 1,
      });

  const total = firstPage.total || 0;
  updateProgress(job, taskId, 15, `找到 ${total} 条记录，开始处理...`, userId);

  let processedCount = 0;
  const batchSize = 10000;
  const totalPages = Math.ceil(total / batchSize);

  for (let page = 1; page <= totalPages; page++) {
    const batchParams = {
      ...queryParams,
      current: page,
      pageSize: batchSize,
    };

    const batch = isStatusChanges
      ? await MonitorHistory.findStatusChanges(batchParams)
      : await MonitorHistory.findAll(batchParams);

    const rowsData = [];
    for (const history of batch.list) {
      const checkTimeStr = formatCheckTime(
        history.check_time || history.checkTime,
      );
      const asinTypeText = formatAsinType(history.asinType);
      const checkResult = formatCheckResult(history.checkResult);

      const rowData = isStatusChanges
        ? [
            checkTimeStr,
            history.checkType === 'GROUP' ? '变体组' : 'ASIN',
            history.variantGroupName || '',
            history.asin || '',
            history.asinName || '',
            asinTypeText,
            history.country || '',
            history.statusChange || '',
            history.isBroken === 1 ? '异常' : '正常',
            checkResult,
          ]
        : [
            checkTimeStr,
            history.checkType === 'GROUP' ? '变体组' : 'ASIN',
            history.variantGroupName || '',
            history.asin || '',
            history.asinName || '',
            asinTypeText,
            history.country || '',
            history.isBroken === 1 ? '异常' : '正常',
            checkResult,
          ];

      rowsData.push(rowData);
    }

    if (rowsData.length > 0) {
      worksheet.addRows(rowsData);
      processedCount += rowsData.length;
    }

    const progress = Math.min(
      15 + Math.floor((processedCount / total) * 60),
      75,
    );
    updateProgress(
      job,
      taskId,
      progress,
      `正在处理数据... (${processedCount}/${total})`,
      userId,
    );
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

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(excelData);
  ws['!cols'] = [
    { wch: 30 },
    { wch: 40 },
    { wch: 10 },
    { wch: 10 },
    { wch: 15 },
    { wch: 10 },
    { wch: 10 },
    { wch: 12 },
    { wch: 20 },
    { wch: 20 },
    { wch: 20 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, '变体组数据');

  updateProgress(job, taskId, 90, '正在生成Excel文件...', userId);

  const excelBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const filename = `变体组数据_${getUTC8String('YYYY-MM-DD')}.xlsx`;
  const filepath = path.join(EXPORT_DIR, `${taskId}.xlsx`);
  await fs.writeFile(filepath, excelBuffer);

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
    startTime,
    endTime,
    isBroken,
  } = params;

  updateProgress(job, taskId, 10, '正在查询数据...', userId);

  const allHistory = await fetchAllData(
    (params) => CompetitorMonitorHistory.findAll(params),
    {
      country: country || '',
      checkType: checkType || '',
      variantGroupId: variantGroupId || '',
      asinId: asinId || '',
      startTime: startTime || '',
      endTime: endTime || '',
      isBroken: isBroken || '',
    },
    10000,
    (progress, message) => {
      updateProgress(job, taskId, progress, message, userId);
    },
  );

  updateProgress(job, taskId, 30, '正在处理数据...', userId);

  const excelData = [];
  excelData.push([
    '检查时间',
    '检查类型',
    '变体组名称',
    'ASIN',
    'ASIN名称',
    '国家',
    '检查结果',
    '检查详情',
  ]);

  const totalItems = allHistory.length;
  let processedItems = 0;
  for (const history of allHistory) {
    let checkResult = '';
    if (history.checkResult) {
      try {
        const parsed =
          typeof history.checkResult === 'string'
            ? JSON.parse(history.checkResult)
            : history.checkResult;
        checkResult = JSON.stringify(parsed, null, 2);
      } catch (e) {
        checkResult = history.checkResult;
      }
    }

    const checkTimeStr = formatCheckTime(
      history.check_time || history.checkTime,
    );

    excelData.push([
      checkTimeStr,
      history.checkType === 'GROUP' ? '变体组' : 'ASIN',
      history.variantGroupName || '',
      history.asin || '',
      history.asinName || '',
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

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(excelData);
  ws['!cols'] = [
    { wch: 20 },
    { wch: 10 },
    { wch: 30 },
    { wch: 15 },
    { wch: 50 },
    { wch: 10 },
    { wch: 10 },
    { wch: 100 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, '竞品监控历史');

  updateProgress(job, taskId, 90, '正在生成Excel文件...', userId);

  const excelBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const filename = `竞品监控历史_${getUTC8String('YYYY-MM-DD')}.xlsx`;
  const filepath = path.join(EXPORT_DIR, `${taskId}.xlsx`);
  await fs.writeFile(filepath, excelBuffer);

  return { filename, filepath };
}

module.exports = {
  processExportTask,
};
