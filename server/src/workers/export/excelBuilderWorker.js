const { parentPort } = require('worker_threads');
const ExcelJS = require('exceljs');
const fs = require('fs').promises;

async function buildWorkbookAndWriteFile(payload) {
  const { sheetName, columnWidths = [], rows = [], outputPath } = payload || {};
  if (!sheetName || !outputPath) {
    throw new Error('sheetName 和 outputPath 不能为空');
  }

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);

  if (Array.isArray(columnWidths) && columnWidths.length > 0) {
    worksheet.columns = columnWidths.map((width) => ({ width }));
  }

  if (Array.isArray(rows) && rows.length > 0) {
    worksheet.addRows(rows);
  }

  const excelBuffer = await workbook.xlsx.writeBuffer();
  await fs.writeFile(outputPath, excelBuffer);

  return {
    outputPath,
    rowCount: Array.isArray(rows) ? rows.length : 0,
  };
}

parentPort.on('message', async (message) => {
  const { requestId, payload } = message || {};
  try {
    const result = await buildWorkbookAndWriteFile(payload);
    parentPort.postMessage({
      requestId,
      success: true,
      result,
    });
  } catch (error) {
    parentPort.postMessage({
      requestId,
      success: false,
      error: error?.message || 'worker 执行失败',
    });
  }
});
