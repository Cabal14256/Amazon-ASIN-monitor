const ExcelJS = require('exceljs');
const VariantGroup = require('../models/VariantGroup');
const ASIN = require('../models/ASIN');
const MonitorHistory = require('../models/MonitorHistory');
const CompetitorVariantGroup = require('../models/CompetitorVariantGroup');
const CompetitorMonitorHistory = require('../models/CompetitorMonitorHistory');
const { getUTC8String } = require('../utils/dateTime');
const logger = require('../utils/logger');

/**
 * 检查响应是否仍然有效（未被关闭）
 * 注意：对于SSE响应，headersSent 可能为 true，但连接仍然有效
 */
function isResponseValid(res) {
  if (!res) return false;
  // 检查响应是否已被销毁
  if (res.destroyed) return false;
  // 检查响应是否仍然可写
  if (!res.writable && !res.writableEnded) return false;
  // 对于SSE，只要响应对象存在且未销毁，就认为有效
  // headersSent 检查只在响应头未发送时才有意义（普通HTTP响应）
  return true;
}

/**
 * 发送 SSE 进度消息
 */
function sendProgress(res, progress, message, stage) {
  if (!res) {
    logger.warn('sendProgress: res 对象不存在');
    return false;
  }

  // 检查响应状态
  if (res.destroyed) {
    logger.warn('sendProgress: 响应已销毁');
    return false;
  }

  if (!res.writable && !res.writableEnded) {
    logger.warn('sendProgress: 响应不可写');
    return false;
  }

  try {
    const data = JSON.stringify({
      type: 'progress',
      progress,
      message,
      stage,
    });
    const success = res.write(`data: ${data}\n\n`);

    // 如果缓冲区满了，等待 drain 事件
    if (!success && res.once) {
      res.once('drain', () => {
        logger.debug('SSE 响应缓冲区已清空');
      });
    }

    // 尝试刷新响应（如果支持）
    if (typeof res.flush === 'function') {
      res.flush();
    }

    return true;
  } catch (error) {
    logger.error('发送SSE进度消息失败:', {
      message: error?.message || error?.toString(),
      stack: error?.stack,
      error: error,
    });
    return false;
  }
}

/**
 * 发送 SSE 完成消息（包含文件数据）
 */
function sendComplete(res, excelBuffer, filename) {
  if (!isResponseValid(res)) {
    logger.warn('响应已关闭，无法发送完成消息');
    return false;
  }
  try {
    const base64 = excelBuffer.toString('base64');
    const data = JSON.stringify({
      type: 'complete',
      filename,
      data: base64,
    });
    res.write(`data: ${data}\n\n`);
    res.end();
    return true;
  } catch (error) {
    logger.error('发送SSE完成消息失败:', error);
    try {
      res.end();
    } catch (e) {
      // 忽略关闭错误
    }
    return false;
  }
}

/**
 * 发送 SSE 错误消息
 */
function sendError(res, errorMessage) {
  if (!isResponseValid(res)) {
    logger.warn('响应已关闭，无法发送错误消息');
    return false;
  }
  try {
    const data = JSON.stringify({
      type: 'error',
      errorMessage,
    });
    res.write(`data: ${data}\n\n`);
    res.end();
    return true;
  } catch (error) {
    logger.error('发送SSE错误消息失败:', error);
    try {
      res.end();
    } catch (e) {
      // 忽略关闭错误
    }
    return false;
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

/**
 * 分页循环查询所有数据
 * @param {Function} queryFn - 查询函数，接收 (params) => Promise<{list, total}>
 * @param {Object} baseParams - 基础查询参数
 * @param {number} pageSize - 每页大小，默认10000
 * @param {Function} progressCallback - 进度回调函数，接收 (progress, message) => void
 * @returns {Promise<Array>} 所有数据的数组
 */
async function fetchAllData(
  queryFn,
  baseParams,
  pageSize = 10000,
  progressCallback = null,
) {
  // 先查询第一页获取总数
  const firstPage = await queryFn({ ...baseParams, current: 1, pageSize });
  const total = firstPage.total;
  let allData = [...firstPage.list];

  // 如果总数超过单页大小，继续查询剩余页
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
 * 导出ASIN数据为Excel
 */
async function exportASINData(req, res) {
  try {
    const { keyword, country, variantStatus, useProgress } = req.query;
    const isProgressMode = useProgress === 'true';

    // 如果使用进度模式，设置 SSE 响应头
    if (isProgressMode) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // 禁用 nginx 缓冲
    }

    sendProgress(res, 10, '正在查询数据...', 'querying');

    // 获取所有变体组和ASIN数据（分页循环查询）
    const allGroups = await fetchAllData(
      (params) => VariantGroup.findAll(params),
      {
        keyword: keyword || '',
        country: country || '',
        variantStatus: variantStatus || '',
      },
      10000,
      (progress, message) => {
        if (isProgressMode) {
          sendProgress(res, progress, message, 'querying');
        }
      },
    );

    sendProgress(res, 30, '正在处理数据...', 'processing');

    // 准备Excel数据
    const excelData = [];

    // 表头
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

    // 遍历变体组和ASIN
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
        // 如果变体组没有ASIN，也导出变体组信息
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
      // 更新进度：30% - 70%
      if (isProgressMode && totalItems > 0) {
        const progress = 30 + Math.floor((processedItems / totalItems) * 40);
        sendProgress(
          res,
          progress,
          `正在处理数据... (${processedItems}/${totalItems})`,
          'processing',
        );
      }
    }

    sendProgress(res, 75, '正在生成Excel文件...', 'generating');

    const workbook = buildWorkbookFromAoa(excelData, 'ASIN数据', [
      20, // 变体组名称
      40, // 变体组ID
      10, // 国家
      10, // 站点
      15, // 品牌
      10, // 变体状态
      15, // ASIN
      50, // ASIN名称
      15, // ASIN类型
      10, // ASIN状态
      20, // 创建时间
      20, // 最后检查时间
    ]);

    sendProgress(res, 90, '正在生成Excel文件...', 'generating');

    // 生成Excel文件
    const excelBuffer = await workbook.xlsx.writeBuffer();

    // 设置响应头
    const filename = `ASIN数据_${getUTC8String('YYYY-MM-DD')}.xlsx`;

    if (isProgressMode) {
      sendProgress(res, 95, '准备下载文件...', 'generating');
      sendComplete(res, excelBuffer, filename);
    } else {
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(filename)}"`,
      );
      res.send(excelBuffer);
    }
  } catch (error) {
    logger.error('导出ASIN数据失败:', error);
    if (req.query.useProgress === 'true') {
      sendError(res, '导出ASIN数据失败');
    } else {
      res.status(500).json({
        success: false,
        errorMessage: '导出ASIN数据失败',
      });
    }
  }
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
 * 导出监控历史数据为Excel（优化版本，使用流式查询和ExcelJS）
 */
async function exportMonitorHistory(req, res) {
  let isProgressMode = false;
  try {
    const {
      country,
      checkType,
      variantGroupId,
      asinId,
      asin,
      startTime,
      endTime,
      isBroken,
      useProgress,
      exportType = 'records', // 新增：导出类型，records=检查记录，statusChanges=状态变动
    } = req.query;
    isProgressMode = useProgress === 'true';
    const isStatusChanges = exportType === 'statusChanges';

    // 如果使用进度模式，设置 SSE 响应头
    if (isProgressMode) {
      // 监听客户端断开连接（在设置响应头之前）
      let clientDisconnected = false;
      req.on('close', () => {
        clientDisconnected = true;
        logger.info('客户端断开连接，取消导出操作');
      });

      // 保存断开连接状态到请求对象，以便在批处理中检查
      req._clientDisconnected = () => clientDisconnected;

      // 检查连接是否已经断开
      if (clientDisconnected || req.aborted) {
        logger.warn('请求已中断，无法开始导出');
        return;
      }

      try {
        // 设置响应头，禁用压缩和缓存
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        // 明确告诉压缩中间件不要压缩
        res.setHeader('Content-Encoding', 'identity');

        // 禁用响应压缩（通过设置请求属性）
        req.noCompression = true;

        // 立即发送初始消息以保持连接
        // 这很重要，因为如果响应头设置后没有立即发送数据，某些代理或客户端可能会关闭连接
        try {
          res.write(': connected\n\n');

          // 刷新响应，确保数据立即发送（如果支持）
          if (typeof res.flush === 'function') {
            res.flush();
          }
        } catch (writeError) {
          logger.error('发送SSE初始连接消息失败:', writeError);
          // 如果写入失败，尝试发送错误响应
          if (!res.headersSent) {
            try {
              res.status(500).json({
                success: false,
                errorMessage: '无法建立连接',
              });
            } catch (e) {
              // 忽略错误
            }
          }
          return;
        }
      } catch (headerError) {
        logger.error('设置SSE响应头失败:', headerError);
        if (!res.headersSent) {
          try {
            res.status(500).json({
              success: false,
              errorMessage: '无法建立连接',
            });
          } catch (e) {
            // 忽略错误
          }
        }
        return;
      }
    }

    // 发送初始进度（只有在连接有效时）
    if (isProgressMode) {
      if (req._clientDisconnected && req._clientDisconnected()) {
        logger.warn('发送初始进度前检测到连接已断开');
        return;
      }
      if (!isResponseValid(res)) {
        logger.warn('发送初始进度前检测到响应无效');
        return;
      }
      if (!sendProgress(res, 5, '正在初始化...', 'initializing')) {
        logger.warn('无法发送初始进度消息，连接可能已断开');
        return;
      }
    }

    // 使用 ExcelJS 创建工作簿
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(
      isStatusChanges ? '状态变动' : '监控历史',
    );

    // 设置表头
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

    // 设置列宽
    const columnWidths = isStatusChanges
      ? [
          { width: 20 }, // 检查时间
          { width: 10 }, // 检查类型
          { width: 30 }, // 变体组名称
          { width: 15 }, // ASIN
          { width: 50 }, // ASIN名称
          { width: 10 }, // ASIN类型
          { width: 10 }, // 国家
          { width: 15 }, // 状态变动
          { width: 10 }, // 检查结果
          { width: 100 }, // 检查详情
        ]
      : [
          { width: 20 }, // 检查时间
          { width: 10 }, // 检查类型
          { width: 30 }, // 变体组名称
          { width: 15 }, // ASIN
          { width: 50 }, // ASIN名称
          { width: 10 }, // ASIN类型
          { width: 10 }, // 国家
          { width: 10 }, // 检查结果
          { width: 100 }, // 检查详情
        ];

    worksheet.columns = columnWidths;

    // 设置表头样式
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' },
    };

    if (!sendProgress(res, 10, '正在查询数据...', 'querying')) {
      logger.warn('无法发送查询进度消息，连接可能已断开');
      return;
    }

    // 使用流式查询（批量分页）
    // 处理 asin 参数：如果是逗号分隔的字符串，转换为数组以支持多ASIN精确查询
    let asinParam = asin || '';
    if (asinParam && typeof asinParam === 'string' && asinParam.includes(',')) {
      // 逗号分隔的字符串转换为数组
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

    // 先获取总数用于进度计算
    // 在查询前检查连接状态
    if (isProgressMode) {
      if (req._clientDisconnected && req._clientDisconnected()) {
        logger.info('查询前检测到客户端已断开连接');
        return;
      }
      if (!isResponseValid(res)) {
        logger.info('查询前检测到响应连接无效');
        return;
      }
    }

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

    // 查询后再次检查连接状态
    if (isProgressMode) {
      if (req._clientDisconnected && req._clientDisconnected()) {
        logger.info('查询后检测到客户端已断开连接');
        return;
      }
      if (!isResponseValid(res)) {
        logger.info('查询后检测到响应连接无效');
        return;
      }
    }

    const total = firstPage.total || 0;

    // 更新进度，告知总数
    if (isProgressMode) {
      if (
        !sendProgress(res, 15, `找到 ${total} 条记录，开始处理...`, 'querying')
      ) {
        logger.warn('无法发送总数进度消息，连接可能已断开');
        return;
      }
    }

    let processedCount = 0;
    const batchSize = 10000; // 每批处理10000条

    // 流式处理数据
    const processBatch = async (page) => {
      // 检查客户端是否断开连接
      if (isProgressMode) {
        if (req._clientDisconnected && req._clientDisconnected()) {
          logger.info('客户端已断开连接，停止处理');
          throw new Error('客户端断开连接');
        }
        if (!isResponseValid(res)) {
          logger.info('响应连接无效，停止处理');
          throw new Error('响应连接无效');
        }
      }

      const batchParams = {
        ...queryParams,
        current: page,
        pageSize: batchSize,
      };

      const batch = isStatusChanges
        ? await MonitorHistory.findStatusChanges(batchParams)
        : await MonitorHistory.findAll(batchParams);

      // 优化：先收集所有行数据，然后批量添加（性能提升：批量添加比逐条添加快5-10倍）
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

      // 批量添加所有行（性能优化：一次性添加比逐条添加快得多）
      if (rowsData.length > 0) {
        worksheet.addRows(rowsData);
        processedCount += rowsData.length;
      }

      // 每批处理完后更新进度
      if (isProgressMode) {
        if (req._clientDisconnected && req._clientDisconnected()) {
          logger.info('批处理完成后检测到客户端已断开连接');
          throw new Error('客户端断开连接');
        }
        if (!isResponseValid(res)) {
          logger.info('批处理完成后检测到响应连接无效');
          throw new Error('响应连接无效');
        }
        const progress = Math.min(
          10 + Math.floor((processedCount / total) * 60),
          70,
        );
        if (
          !sendProgress(
            res,
            progress,
            `正在处理数据... (${processedCount}/${total})`,
            'processing',
          )
        ) {
          logger.warn('无法发送批处理进度消息，连接可能已断开');
          throw new Error('无法发送进度更新');
        }
      }
    };

    // 分批处理所有数据
    const totalPages = Math.ceil(total / batchSize);
    try {
      for (let page = 1; page <= totalPages; page++) {
        await processBatch(page);
      }
    } catch (batchError) {
      // 如果是客户端断开连接的错误，直接返回
      if (
        batchError.message?.includes('客户端断开连接') ||
        batchError.message?.includes('响应连接无效') ||
        batchError.message?.includes('无法发送进度更新')
      ) {
        logger.info('批处理中断:', batchError.message);
        return;
      }
      // 其他错误继续抛出
      throw batchError;
    }

    // 处理完成后，再次检查连接状态
    if (isProgressMode) {
      if (req._clientDisconnected && req._clientDisconnected()) {
        logger.info('数据处理完成后检测到客户端已断开连接');
        return;
      }
      if (!isResponseValid(res)) {
        logger.info('数据处理完成后检测到响应连接无效');
        return;
      }
    }

    if (!sendProgress(res, 75, '正在生成Excel文件...', 'generating')) {
      logger.warn('无法发送生成Excel进度消息，连接可能已断开');
      return;
    }

    // 生成Excel文件
    const filename = isStatusChanges
      ? `状态变动_${getUTC8String('YYYY-MM-DD')}.xlsx`
      : `监控历史_${getUTC8String('YYYY-MM-DD')}.xlsx`;

    if (isProgressMode) {
      // 再次检查连接状态
      if (req._clientDisconnected && req._clientDisconnected()) {
        logger.info('生成Excel文件前检测到客户端已断开连接');
        return;
      }
      if (!isResponseValid(res)) {
        logger.info('生成Excel文件前检测到响应连接无效');
        return;
      }

      // 生成Excel文件
      const buffer = await workbook.xlsx.writeBuffer();

      // 生成文件后再次检查连接状态
      if (req._clientDisconnected && req._clientDisconnected()) {
        logger.info('生成Excel文件后检测到客户端已断开连接');
        return;
      }
      if (!isResponseValid(res)) {
        logger.info('生成Excel文件后检测到响应连接无效');
        return;
      }

      // 检查文件大小：如果超过10MB，使用直接下载而不是SSE base64传输
      // base64编码会增加约33%的大小，10MB原始文件base64后约13.3MB
      // 同时，SSE消息大小也有限制，大文件可能导致传输失败
      const FILE_SIZE_THRESHOLD = 10 * 1024 * 1024; // 10MB

      if (buffer.length > FILE_SIZE_THRESHOLD) {
        // 文件太大，发送错误消息告诉前端改用直接下载
        logger.info(
          `文件大小 ${(buffer.length / 1024 / 1024).toFixed(
            2,
          )}MB 超过阈值，通知前端改用直接下载`,
        );

        // 发送特殊消息，告诉前端文件太大，需要改用直接下载
        const redirectData = JSON.stringify({
          type: 'redirect',
          message: '文件较大，改用直接下载',
          downloadUrl: `${req.originalUrl.split('?')[0]}?${new URLSearchParams({
            ...req.query,
            useProgress: 'false', // 禁用进度模式，使用直接下载
          }).toString()}`,
        });

        if (!isResponseValid(res)) {
          logger.warn('响应已无效，无法发送重定向消息');
          return;
        }

        try {
          res.write(`data: ${redirectData}\n\n`);
          res.end();
        } catch (e) {
          logger.error('发送重定向消息失败:', e);
          try {
            res.end();
          } catch (e2) {
            // 忽略关闭错误
          }
        }
        return;
      }

      // 文件较小，使用SSE base64传输
      if (!sendProgress(res, 95, '准备下载文件...', 'generating')) {
        logger.warn('无法发送准备下载进度消息，连接可能已断开');
        return;
      }
      sendComplete(res, buffer, filename);
    } else {
      // 直接流式写入响应
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(filename)}"`,
      );
      await workbook.xlsx.write(res);
      res.end();
    }
  } catch (error) {
    // 改进错误日志记录
    const errorMessage = error?.message || error?.toString() || '未知错误';
    const errorStack = error?.stack || '';
    logger.error('导出监控历史失败:', {
      message: errorMessage,
      stack: errorStack,
      error: error,
    });

    if (isProgressMode) {
      // 检查是否是客户端断开连接的错误，这种情况下不需要发送错误消息
      if (
        errorMessage.includes('客户端断开连接') ||
        errorMessage.includes('响应连接无效')
      ) {
        logger.info('客户端已断开，跳过错误消息发送');
        return;
      }

      if (!sendError(res, '导出监控历史失败: ' + errorMessage)) {
        // 如果SSE发送失败，尝试普通错误响应
        if (!res.headersSent) {
          try {
            res.status(500).json({
              success: false,
              errorMessage: '导出监控历史失败: ' + errorMessage,
            });
          } catch (e) {
            logger.error('无法发送错误响应:', {
              message: e?.message || e?.toString(),
              stack: e?.stack,
            });
          }
        }
      }
    } else {
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          errorMessage: '导出监控历史失败: ' + errorMessage,
        });
      }
    }
  }
}

/**
 * 导出变体组数据为Excel
 */
async function exportVariantGroupData(req, res) {
  try {
    const { keyword, country, variantStatus, useProgress } = req.query;
    const isProgressMode = useProgress === 'true';

    // 如果使用进度模式，设置 SSE 响应头
    if (isProgressMode) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
    }

    sendProgress(res, 10, '正在查询数据...', 'querying');

    // 获取所有变体组数据（分页循环查询）
    const allGroups = await fetchAllData(
      (params) => VariantGroup.findAll(params),
      {
        keyword: keyword || '',
        country: country || '',
        variantStatus: variantStatus || '',
      },
      10000,
      (progress, message) => {
        if (isProgressMode) {
          sendProgress(res, progress, message, 'querying');
        }
      },
    );

    sendProgress(res, 30, '正在处理数据...', 'processing');

    // 准备Excel数据
    const excelData = [];

    // 表头
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

    // 遍历变体组
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
      // 更新进度：30% - 70%
      if (isProgressMode && totalItems > 0) {
        const progress = 30 + Math.floor((processedItems / totalItems) * 40);
        sendProgress(
          res,
          progress,
          `正在处理数据... (${processedItems}/${totalItems})`,
          'processing',
        );
      }
    }

    sendProgress(res, 75, '正在生成Excel文件...', 'generating');

    const workbook = buildWorkbookFromAoa(excelData, '变体组数据', [
      30, // 变体组名称
      40, // 变体组ID
      10, // 国家
      10, // 站点
      15, // 品牌
      10, // 变体状态
      10, // ASIN数量
      12, // 异常ASIN数量
      20, // 创建时间
      20, // 更新时间
      20, // 最后检查时间
    ]);

    sendProgress(res, 90, '正在生成Excel文件...', 'generating');

    // 生成Excel文件
    const excelBuffer = await workbook.xlsx.writeBuffer();

    // 设置响应头
    const filename = `变体组数据_${getUTC8String('YYYY-MM-DD')}.xlsx`;

    if (isProgressMode) {
      sendProgress(res, 95, '准备下载文件...', 'generating');
      sendComplete(res, excelBuffer, filename);
    } else {
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(filename)}"`,
      );
      res.send(excelBuffer);
    }
  } catch (error) {
    logger.error('导出变体组数据失败:', error);
    if (req.query.useProgress === 'true') {
      sendError(res, '导出变体组数据失败');
    } else {
      res.status(500).json({
        success: false,
        errorMessage: '导出变体组数据失败',
      });
    }
  }
}

/**
 * 导出竞品ASIN数据为Excel
 */
async function exportCompetitorASINData(req, res) {
  try {
    const { keyword, country, variantStatus, useProgress } = req.query;
    const isProgressMode = useProgress === 'true';

    if (isProgressMode) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
    }

    sendProgress(res, 10, '正在查询数据...', 'querying');

    const allGroups = await fetchAllData(
      (params) => CompetitorVariantGroup.findAll(params),
      {
        keyword: keyword || '',
        country: country || '',
        variantStatus: variantStatus || '',
      },
      10000,
      (progress, message) => {
        if (isProgressMode) {
          sendProgress(res, progress, message, 'querying');
        }
      },
    );

    sendProgress(res, 30, '正在处理数据...', 'processing');

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
      processedItems++;
      if (isProgressMode && totalItems > 0) {
        const progress = 30 + Math.floor((processedItems / totalItems) * 40);
        sendProgress(
          res,
          progress,
          `正在处理数据... (${processedItems}/${totalItems})`,
          'processing',
        );
      }
    }

    sendProgress(res, 75, '正在生成Excel文件...', 'generating');

    const workbook = buildWorkbookFromAoa(excelData, '竞品ASIN数据', [
      20, // 变体组名称
      40, // 变体组ID
      10, // 国家
      15, // 品牌
      10, // 变体状态
      15, // ASIN
      50, // ASIN名称
      15, // ASIN类型
      10, // ASIN状态
      20, // 创建时间
      20, // 最后检查时间
    ]);

    sendProgress(res, 90, '正在生成Excel文件...', 'generating');

    const excelBuffer = await workbook.xlsx.writeBuffer();
    const filename = `竞品ASIN数据_${getUTC8String('YYYY-MM-DD')}.xlsx`;

    if (isProgressMode) {
      sendProgress(res, 95, '准备下载文件...', 'generating');
      sendComplete(res, excelBuffer, filename);
    } else {
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(filename)}"`,
      );
      res.send(excelBuffer);
    }
  } catch (error) {
    logger.error('导出竞品ASIN数据失败:', error);
    if (req.query.useProgress === 'true') {
      sendError(res, '导出竞品ASIN数据失败');
    } else {
      res.status(500).json({
        success: false,
        errorMessage: '导出竞品ASIN数据失败',
      });
    }
  }
}

/**
 * 导出竞品变体组数据为Excel
 */
async function exportCompetitorVariantGroupData(req, res) {
  try {
    const { keyword, country, variantStatus, useProgress } = req.query;
    const isProgressMode = useProgress === 'true';

    if (isProgressMode) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
    }

    sendProgress(res, 10, '正在查询数据...', 'querying');

    const allGroups = await fetchAllData(
      (params) => CompetitorVariantGroup.findAll(params),
      {
        keyword: keyword || '',
        country: country || '',
        variantStatus: variantStatus || '',
      },
      10000,
      (progress, message) => {
        if (isProgressMode) {
          sendProgress(res, progress, message, 'querying');
        }
      },
    );

    sendProgress(res, 30, '正在处理数据...', 'processing');

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
      processedItems++;
      if (isProgressMode && totalItems > 0) {
        const progress = 30 + Math.floor((processedItems / totalItems) * 40);
        sendProgress(
          res,
          progress,
          `正在处理数据... (${processedItems}/${totalItems})`,
          'processing',
        );
      }
    }

    sendProgress(res, 75, '正在生成Excel文件...', 'generating');

    const workbook = buildWorkbookFromAoa(excelData, '竞品变体组数据', [
      30, // 变体组名称
      40, // 变体组ID
      10, // 国家
      15, // 品牌
      10, // 变体状态
      10, // ASIN数量
      12, // 异常ASIN数量
      20, // 创建时间
      20, // 更新时间
      20, // 最后检查时间
    ]);

    sendProgress(res, 90, '正在生成Excel文件...', 'generating');

    const excelBuffer = await workbook.xlsx.writeBuffer();
    const filename = `竞品变体组数据_${getUTC8String('YYYY-MM-DD')}.xlsx`;

    if (isProgressMode) {
      sendProgress(res, 95, '准备下载文件...', 'generating');
      sendComplete(res, excelBuffer, filename);
    } else {
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(filename)}"`,
      );
      res.send(excelBuffer);
    }
  } catch (error) {
    logger.error('导出竞品变体组数据失败:', error);
    if (req.query.useProgress === 'true') {
      sendError(res, '导出竞品变体组数据失败');
    } else {
      res.status(500).json({
        success: false,
        errorMessage: '导出竞品变体组数据失败',
      });
    }
  }
}

/**
 * 导出竞品监控历史数据为Excel
 */
async function exportCompetitorMonitorHistory(req, res) {
  try {
    const {
      country,
      checkType,
      variantGroupId,
      asinId,
      startTime,
      endTime,
      isBroken,
      useProgress,
    } = req.query;
    const isProgressMode = useProgress === 'true';

    // 如果使用进度模式，设置 SSE 响应头
    if (isProgressMode) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
    }

    sendProgress(res, 10, '正在查询数据...', 'querying');

    // 获取所有竞品监控历史数据（根据筛选条件，分页循环查询）
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
        if (isProgressMode) {
          sendProgress(res, progress, message, 'querying');
        }
      },
    );

    sendProgress(res, 30, '正在处理数据...', 'processing');

    // 准备Excel数据
    const excelData = [];

    // 表头
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

    // 遍历监控历史
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

      // 格式化检查时间
      let checkTimeStr = '';
      const timeValue = history.check_time || history.checkTime;
      if (timeValue) {
        if (typeof timeValue === 'string') {
          checkTimeStr = timeValue;
        } else if (timeValue instanceof Date) {
          const d = new Date(timeValue);
          const year = d.getFullYear();
          const month = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          const hours = String(d.getHours()).padStart(2, '0');
          const minutes = String(d.getMinutes()).padStart(2, '0');
          const seconds = String(d.getSeconds()).padStart(2, '0');
          checkTimeStr = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
        }
      }

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
      // 更新进度：30% - 70%
      if (isProgressMode && totalItems > 0) {
        const progress = 30 + Math.floor((processedItems / totalItems) * 40);
        sendProgress(
          res,
          progress,
          `正在处理数据... (${processedItems}/${totalItems})`,
          'processing',
        );
      }
    }

    sendProgress(res, 75, '正在生成Excel文件...', 'generating');

    const workbook = buildWorkbookFromAoa(excelData, '竞品监控历史', [
      20, // 检查时间
      10, // 检查类型
      30, // 变体组名称
      15, // ASIN
      50, // 父变体ASIN
      10, // 国家
      10, // 检查结果
      100, // 检查详情
    ]);

    sendProgress(res, 90, '正在生成Excel文件...', 'generating');

    // 生成Excel文件
    const excelBuffer = await workbook.xlsx.writeBuffer();

    // 设置响应头
    const filename = `竞品监控历史_${getUTC8String('YYYY-MM-DD')}.xlsx`;

    if (isProgressMode) {
      sendProgress(res, 95, '准备下载文件...', 'generating');
      sendComplete(res, excelBuffer, filename);
    } else {
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(filename)}"`,
      );
      res.send(excelBuffer);
    }
  } catch (error) {
    logger.error('导出竞品监控历史失败:', error);
    if (req.query.useProgress === 'true') {
      sendError(res, '导出竞品监控历史失败');
    } else {
      res.status(500).json({
        success: false,
        errorMessage: '导出竞品监控历史失败',
      });
    }
  }
}

const { v4: uuidv4 } = require('uuid');
const exportTaskQueue = require('../services/exportTaskQueue');

/**
 * 创建导出任务（后台异步）
 */
async function createExportTask(req, res) {
  try {
    const { exportType, params } = req.body;
    const userId = req.user?.userId || req.user?.id;

    if (!exportType) {
      return res.status(400).json({
        success: false,
        errorMessage: '导出类型不能为空',
        errorCode: 400,
      });
    }

    // 验证导出类型
    const validTypes = [
      'asin',
      'monitor-history',
      'variant-group',
      'competitor-monitor-history',
    ];
    if (!validTypes.includes(exportType)) {
      return res.status(400).json({
        success: false,
        errorMessage: `不支持的导出类型: ${exportType}`,
        errorCode: 400,
      });
    }

    // 检查权限（根据导出类型检查不同权限）
    const User = require('../models/User');
    const permissionMap = {
      asin: 'asin:read',
      'variant-group': 'asin:read',
      'monitor-history': 'monitor:read',
      'competitor-monitor-history': 'monitor:read',
    };
    const requiredPermission = permissionMap[exportType];
    if (requiredPermission) {
      const hasPermission = await User.hasPermission(
        userId,
        requiredPermission,
      );
      if (!hasPermission) {
        return res.status(403).json({
          success: false,
          errorMessage: '无权执行此操作',
          errorCode: 403,
        });
      }
    }

    // 生成任务ID
    const taskId = uuidv4();

    // 创建后台任务
    await exportTaskQueue.enqueue({
      taskId,
      exportType,
      params: params || {},
      userId,
    });

    logger.info(
      `[导出任务] 创建任务成功: ${taskId}, 类型: ${exportType}, 用户: ${userId}`,
    );

    res.json({
      success: true,
      data: {
        taskId,
        exportType,
        status: 'pending',
      },
      errorCode: 0,
    });
  } catch (error) {
    logger.error('创建导出任务失败:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '创建导出任务失败',
      errorCode: 500,
    });
  }
}

/**
 * 导出父变体查询结果
 */
async function exportParentAsinQuery(req, res) {
  try {
    const { asins, country } = req.query;
    const isProgressMode = req.query.useProgress === 'true';

    if (!asins || typeof asins !== 'string') {
      if (isProgressMode) {
        sendError(res, '请提供ASIN列表');
      } else {
        return res.status(400).json({
          success: false,
          errorMessage: '请提供ASIN列表',
        });
      }
      return;
    }

    if (!country || typeof country !== 'string') {
      if (isProgressMode) {
        sendError(res, '请提供国家代码');
      } else {
        return res.status(400).json({
          success: false,
          errorMessage: '请提供国家代码',
        });
      }
      return;
    }

    // 解析ASIN列表（支持逗号分隔或换行分隔）
    const asinList = asins
      .split(/[,\n]/)
      .map((asin) => asin.trim().toUpperCase())
      .filter((asin) => asin && /^[A-Z][A-Z0-9]{9}$/.test(asin));

    if (asinList.length === 0) {
      if (isProgressMode) {
        sendError(res, '没有有效的ASIN');
      } else {
        return res.status(400).json({
          success: false,
          errorMessage: '没有有效的ASIN',
        });
      }
      return;
    }

    // 设置SSE响应头
    if (isProgressMode) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // 禁用Nginx缓冲
    }

    sendProgress(res, 10, '开始查询ASIN父变体...', 'querying');

    // 调用批量查询服务
    const variantCheckService = require('../services/variantCheckService');
    const results = await variantCheckService.batchQueryParentAsin(
      asinList,
      country,
    );

    sendProgress(res, 80, '正在生成Excel文件...', 'generating');

    // 准备Excel数据
    const excelData = [];

    // 表头
    excelData.push([
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
    ]);

    // 添加数据行
    const queryTime = getUTC8String('YYYY-MM-DD HH:mm:ss');
    for (const result of results) {
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

    sendProgress(res, 90, '正在生成Excel文件...', 'generating');

    const workbook = buildWorkbookFromAoa(excelData, '父变体查询结果', [
      15, // ASIN
      10, // 国家
      15, // 是否有父变体
      15, // 父变体ASIN
      50, // 父体标题
      50, // 产品标题
      20, // 品牌
      15, // 是否有变体
      12, // 变体数量
      20, // 查询时间
      30, // 错误信息
    ]);

    sendProgress(res, 95, '准备下载文件...', 'generating');

    // 生成Excel文件
    const excelBuffer = await workbook.xlsx.writeBuffer();

    // 设置响应头
    const filename = `ASIN父变体查询结果_${getUTC8String('YYYY-MM-DD')}.xlsx`;

    if (isProgressMode) {
      sendProgress(res, 95, '准备下载文件...', 'generating');
      sendComplete(res, excelBuffer, filename);
    } else {
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(filename)}"`,
      );
      res.send(excelBuffer);
    }
  } catch (error) {
    logger.error('导出父变体查询结果失败:', error);
    if (req.query.useProgress === 'true') {
      sendError(res, '导出父变体查询结果失败');
    } else {
      res.status(500).json({
        success: false,
        errorMessage: '导出父变体查询结果失败',
      });
    }
  }
}

module.exports = {
  exportASINData,
  exportMonitorHistory,
  exportVariantGroupData,
  exportCompetitorASINData,
  exportCompetitorVariantGroupData,
  exportCompetitorMonitorHistory,
  exportParentAsinQuery,
  createExportTask,
};
