const { parentPort } = require('worker_threads');
const { parseImportFile } = require('../../services/importParserService');

if (!parentPort) {
  throw new Error('导入解析 Worker 缺少 parentPort');
}

parentPort.on('message', async (message) => {
  const { requestId, payload } = message || {};

  try {
    const result = await parseImportFile(payload?.file || {}, {
      mode: payload?.mode || 'standard',
    });
    parentPort.postMessage({
      requestId,
      success: true,
      result,
    });
  } catch (error) {
    parentPort.postMessage({
      requestId,
      success: false,
      error: {
        message: error.message || '导入解析失败',
        statusCode: error.statusCode || null,
        code: error.code || null,
      },
    });
  }
});
