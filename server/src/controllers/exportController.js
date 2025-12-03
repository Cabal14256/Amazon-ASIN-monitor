const XLSX = require('xlsx');
const VariantGroup = require('../models/VariantGroup');
const ASIN = require('../models/ASIN');
const MonitorHistory = require('../models/MonitorHistory');

/**
 * 导出ASIN数据为Excel
 */
async function exportASINData(req, res) {
  try {
    const { keyword, country, variantStatus } = req.query;

    // 获取所有变体组和ASIN数据
    const result = await VariantGroup.findAll({
      keyword: keyword || '',
      country: country || '',
      variantStatus: variantStatus || '',
      current: 1,
      pageSize: 10000, // 导出所有数据
    });

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
    for (const group of result.list) {
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
    }

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

    // 生成Excel文件
    const excelBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    // 设置响应头
    const filename = `ASIN数据_${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(filename)}"`,
    );

    res.send(excelBuffer);
  } catch (error) {
    console.error('导出ASIN数据失败:', error);
    res.status(500).json({
      success: false,
      errorMessage: '导出ASIN数据失败',
    });
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
    } = req.query;

    // 获取所有监控历史数据（根据筛选条件）
    const result = await MonitorHistory.findAll({
      country: country || '',
      checkType: checkType || '',
      variantGroupId: variantGroupId || '',
      asinId: asinId || '',
      startTime: startTime || '',
      endTime: endTime || '',
      isBroken: isBroken || '',
      current: 1,
      pageSize: 10000, // 导出所有数据
    });

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
    for (const history of result.list) {
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
    }

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

    XLSX.utils.book_append_sheet(wb, ws, '监控历史');

    // 生成Excel文件
    const excelBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    // 设置响应头
    const filename = `监控历史_${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(filename)}"`,
    );

    res.send(excelBuffer);
  } catch (error) {
    console.error('导出监控历史失败:', error);
    res.status(500).json({
      success: false,
      errorMessage: '导出监控历史失败',
    });
  }
}

/**
 * 导出变体组数据为Excel
 */
async function exportVariantGroupData(req, res) {
  try {
    const { keyword, country, variantStatus } = req.query;

    // 获取所有变体组数据
    const result = await VariantGroup.findAll({
      keyword: keyword || '',
      country: country || '',
      variantStatus: variantStatus || '',
      current: 1,
      pageSize: 10000, // 导出所有数据
    });

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
    for (const group of result.list) {
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
    }

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

    // 生成Excel文件
    const excelBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    // 设置响应头
    const filename = `变体组数据_${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(filename)}"`,
    );

    res.send(excelBuffer);
  } catch (error) {
    console.error('导出变体组数据失败:', error);
    res.status(500).json({
      success: false,
      errorMessage: '导出变体组数据失败',
    });
  }
}

module.exports = {
  exportASINData,
  exportMonitorHistory,
  exportVariantGroupData,
};
