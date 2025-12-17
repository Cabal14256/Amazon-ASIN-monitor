const backupService = require('./backupService');
const logger = require('../utils/logger');
const websocketService = require('./websocketService');

/**
 * 更新任务进度
 */
function updateProgress(job, taskId, progress, message, userId = null) {
  job.progress(progress);
  websocketService.sendTaskProgress(taskId, progress, message, userId);
}

/**
 * 处理备份任务
 */
async function processBackupTask(job) {
  const { taskId, taskType, params, userId } = job.data;

  try {
    updateProgress(job, taskId, 5, '正在初始化...', userId);

    let result;
    if (taskType === 'create') {
      updateProgress(job, taskId, 20, '正在创建备份...', userId);
      result = await backupService.createBackup(params);
      updateProgress(job, taskId, 90, '备份创建完成', userId);
    } else if (taskType === 'restore') {
      updateProgress(job, taskId, 20, '正在恢复备份...', userId);
      await backupService.restoreBackup(params.filepath);
      result = { message: '恢复成功' };
      updateProgress(job, taskId, 90, '备份恢复完成', userId);
    } else {
      throw new Error(`不支持的备份任务类型: ${taskType}`);
    }

    updateProgress(job, taskId, 100, '任务完成', userId);

    websocketService.sendTaskComplete(taskId, null, null, userId);

    return result;
  } catch (error) {
    logger.error(`[备份任务] 处理失败 (${taskId}):`, error);
    websocketService.sendTaskError(
      taskId,
      error.message || '备份任务失败',
      userId,
    );
    throw error;
  }
}

module.exports = {
  processBackupTask,
};
