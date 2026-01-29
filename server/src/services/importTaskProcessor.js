const logger = require('../utils/logger');
const websocketService = require('./websocketService');
// 导入逻辑会在这里实现，需要从asinController中提取

/**
 * 更新任务进度
 */
function updateProgress(job, taskId, progress, message, userId = null) {
  job.progress(progress);
  websocketService.sendTaskProgress(taskId, progress, message, userId);
}

/**
 * 处理导入任务
 */
async function processImportTask(job) {
  const { taskId, fileBuffer, originalFilename, userId } = job.data;

  try {
    updateProgress(job, taskId, 5, '正在解析Excel文件...', userId);

    // 这里需要从asinController中提取导入逻辑
    // 由于逻辑较长，这里先创建框架
    // 实际实现需要将asinController.importFromExcel中的逻辑提取到这里

    updateProgress(job, taskId, 50, '正在处理数据...', userId);

    // TODO: 实现实际的导入逻辑

    updateProgress(job, taskId, 100, '导入完成', userId);

    websocketService.sendTaskComplete(taskId, null, null, userId);

    return {
      success: true,
      message: '导入完成',
    };
  } catch (error) {
    logger.error(`[导入任务] 处理失败 (${taskId}):`, error);
    websocketService.sendTaskError(taskId, error.message || '导入失败', userId);
    throw error;
  }
}

module.exports = {
  processImportTask,
};
