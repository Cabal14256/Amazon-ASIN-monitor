const XLSX = require('xlsx');
const VariantGroup = require('../models/VariantGroup');
const ASIN = require('../models/ASIN');
const MonitorHistory = require('../models/MonitorHistory');
const CompetitorMonitorHistory = require('../models/CompetitorMonitorHistory');
const { getUTC8String } = require('../utils/dateTime');

/**
 * 发送 SSE 进度消息
 */
function sendProgress(res, progress, message, stage) {
  const data = JSON.stringify({
    type: 'progress',
    progress,
    message,
    stage,
  });
  res.write(`data: ${data}\n\n`);
}

/**
 * 发送 SSE 完成消息（包含文件数据）
 */
function sendComplete(res, excelBuffer, filename) {
  const base64 = excelBuffer.toString('base64');
  const data = JSON.stringify({
    type: 'complete',
    filename,
    data: base64,
  });
  res.write(`data: ${data}\n\n`);
  res.end();
}

/**
 * 发送 SSE 错误消息
 */
function sendError(res, errorMessage) {
  const data = JSON.stringify({
    type: 'error',
    errorMessage,
  });
  res.write(`data: ${data}\n\n`);
  res.end();
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

    // 创建工作簿
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(excelData);

    // 设置列宽
    ws['!cols'] = [
      { wch: 20 }, // 变体组名称
      { wch: 40 }, // 变体组ID
      { wch: 10 }, // 国家
      { wch: 10 }, // 站点
      { wch: 15 }, // 品牌
      { wch: 10 }, // 变体状态
      { wch: 15 }, // ASIN
      { wch: 50 }, // ASIN名称
      { wch: 15 }, // ASIN类型
      { wch: 10 }, // ASIN状态
      { wch: 20 }, // 创建时间
      { wch: 20 }, // 最后检查时间
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'ASIN数据');

    sendProgress(res, 90, '正在生成Excel文件...', 'generating');

    // 生成Excel文件
    const excelBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

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
    console.error('导出ASIN数据失败:', error);
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
 * 导出监控历史数据为Excel
 */
async function exportMonitorHistory(req, res) {
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

    // 获取所有监控历史数据（根据筛选条件，分页循环查询）
    const allHistory = await fetchAllData(
      (params) => MonitorHistory.findAll(params),
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
      'ASIN名称',
      'ASIN类型',
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

      // 格式化检查时间，确保显示完整的时间（日期+时间）
      // 优先使用原始数据库字段 check_time，因为它包含完整的日期时间信息
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

      // 将后端格式(1/2)转换为前端显示格式(主链/副评)
      let asinTypeText = '';
      if (history.asinType) {
        const normalizedType =
          history.asinType === 'MAIN_LINK'
            ? '1'
            : history.asinType === 'SUB_REVIEW'
            ? '2'
            : history.asinType;
        if (normalizedType === '1') {
          asinTypeText = '主链';
        } else if (normalizedType === '2') {
          asinTypeText = '副评';
        } else {
          asinTypeText = normalizedType;
        }
      }

      excelData.push([
        checkTimeStr,
        history.checkType === 'GROUP' ? '变体组' : 'ASIN',
        history.variantGroupName || '',
        history.asin || '',
        history.asinName || '',
        asinTypeText,
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

    // 创建工作簿
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(excelData);

    // 设置列宽
    ws['!cols'] = [
      { wch: 20 }, // 检查时间
      { wch: 10 }, // 检查类型
      { wch: 30 }, // 变体组名称
      { wch: 15 }, // ASIN
      { wch: 50 }, // ASIN名称
      { wch: 10 }, // ASIN类型
      { wch: 10 }, // 国家
      { wch: 10 }, // 检查结果
      { wch: 100 }, // 检查详情
    ];

    XLSX.utils.book_append_sheet(wb, ws, '监控历史');

    sendProgress(res, 90, '正在生成Excel文件...', 'generating');

    // 生成Excel文件
    const excelBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    // 设置响应头
    const filename = `监控历史_${getUTC8String('YYYY-MM-DD')}.xlsx`;

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
    console.error('导出监控历史失败:', error);
    if (req.query.useProgress === 'true') {
      sendError(res, '导出监控历史失败');
    } else {
      res.status(500).json({
        success: false,
        errorMessage: '导出监控历史失败',
      });
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

    // 创建工作簿
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(excelData);

    // 设置列宽
    ws['!cols'] = [
      { wch: 30 }, // 变体组名称
      { wch: 40 }, // 变体组ID
      { wch: 10 }, // 国家
      { wch: 10 }, // 站点
      { wch: 15 }, // 品牌
      { wch: 10 }, // 变体状态
      { wch: 10 }, // ASIN数量
      { wch: 12 }, // 异常ASIN数量
      { wch: 20 }, // 创建时间
      { wch: 20 }, // 更新时间
      { wch: 20 }, // 最后检查时间
    ];

    XLSX.utils.book_append_sheet(wb, ws, '变体组数据');

    sendProgress(res, 90, '正在生成Excel文件...', 'generating');

    // 生成Excel文件
    const excelBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

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
    console.error('导出变体组数据失败:', error);
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
      'ASIN名称',
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
        history.asinName || '',
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

    // 创建工作簿
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(excelData);

    // 设置列宽
    ws['!cols'] = [
      { wch: 20 }, // 检查时间
      { wch: 10 }, // 检查类型
      { wch: 30 }, // 变体组名称
      { wch: 15 }, // ASIN
      { wch: 50 }, // ASIN名称
      { wch: 10 }, // 国家
      { wch: 10 }, // 检查结果
      { wch: 100 }, // 检查详情
    ];

    XLSX.utils.book_append_sheet(wb, ws, '竞品监控历史');

    sendProgress(res, 90, '正在生成Excel文件...', 'generating');

    // 生成Excel文件
    const excelBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

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
    console.error('导出竞品监控历史失败:', error);
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

module.exports = {
  exportASINData,
  exportMonitorHistory,
  exportVariantGroupData,
  exportCompetitorMonitorHistory,
};
