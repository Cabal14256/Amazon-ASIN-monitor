const fs = require('fs').promises;
const path = require('path');
const exportTaskQueue = require('../services/exportTaskQueue');
const batchCheckTaskQueue = require('../services/batchCheckTaskQueue');
const importTaskQueue = require('../services/importTaskQueue');
const backupTaskQueue = require('../services/backupTaskQueue');
const logger = require('../utils/logger');

const EXPORT_DIR = path.join(__dirname, '../../tasks/export');

/**
 * 查询任务状态（支持导出任务和批量检查任务）
 */
async function getTaskStatus(req, res) {
  try {
    const { taskId } = req.params;
    const userId = req.user?.userId || req.user?.id;

    if (!taskId) {
      return res.status(400).json({
        success: false,
        errorMessage: '任务ID不能为空',
        errorCode: 400,
      });
    }

    // 尝试从各个任务队列查询
    let jobState = await exportTaskQueue.getJobState(taskId);
    let taskType = 'export';

    if (!jobState) {
      jobState = await batchCheckTaskQueue.getJobState(taskId);
      taskType = 'batch-check';
    }

    if (!jobState) {
      jobState = await importTaskQueue.getJobState(taskId);
      taskType = 'import';
    }

    if (!jobState) {
      jobState = await backupTaskQueue.getJobState(taskId);
      taskType = 'backup';
    }

    if (!jobState) {
      return res.status(404).json({
        success: false,
        errorMessage: '任务不存在',
        errorCode: 404,
      });
    }

    // 检查任务是否属于当前用户
    if (jobState.data?.userId && jobState.data.userId !== userId) {
      return res.status(403).json({
        success: false,
        errorMessage: '无权访问此任务',
        errorCode: 403,
      });
    }

    // 转换状态
    let status = 'pending';
    if (jobState.state === 'completed') {
      status = 'completed';
    } else if (jobState.state === 'failed') {
      status = 'failed';
    } else if (jobState.state === 'active') {
      status = 'processing';
    }

    res.json({
      success: true,
      data: {
        taskId: jobState.taskId,
        taskType,
        status,
        progress: jobState.progress || 0,
        exportType: jobState.data?.exportType,
        error: jobState.failedReason || null,
        result: jobState.returnvalue || null,
      },
      errorCode: 0,
    });
  } catch (error) {
    logger.error('查询任务状态失败:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '查询任务状态失败',
      errorCode: 500,
    });
  }
}

/**
 * 下载任务结果文件
 */
async function downloadTaskFile(req, res) {
  try {
    const { taskId } = req.params;
    const userId = req.user?.userId || req.user?.id;

    if (!taskId) {
      return res.status(400).json({
        success: false,
        errorMessage: '任务ID不能为空',
        errorCode: 400,
      });
    }

    // 检查任务状态
    const jobState = await exportTaskQueue.getJobState(taskId);

    if (!jobState) {
      return res.status(404).json({
        success: false,
        errorMessage: '任务不存在',
        errorCode: 404,
      });
    }

    // 检查任务是否属于当前用户
    if (jobState.data?.userId && jobState.data.userId !== userId) {
      return res.status(403).json({
        success: false,
        errorMessage: '无权访问此任务',
        errorCode: 403,
      });
    }

    // 检查任务是否完成
    if (jobState.state !== 'completed') {
      return res.status(400).json({
        success: false,
        errorMessage: '任务尚未完成',
        errorCode: 400,
      });
    }

    // 获取文件信息
    const result = jobState.returnvalue;
    if (!result || !result.filepath) {
      return res.status(404).json({
        success: false,
        errorMessage: '文件不存在',
        errorCode: 404,
      });
    }

    // 检查文件是否存在
    try {
      await fs.access(result.filepath);
    } catch (error) {
      return res.status(404).json({
        success: false,
        errorMessage: '文件不存在或已过期',
        errorCode: 404,
      });
    }

    // 发送文件
    const filename = result.filename || `导出文件_${taskId}.xlsx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(filename)}"`,
    );

    const fileStream = require('fs').createReadStream(result.filepath);
    fileStream.pipe(res);

    fileStream.on('error', (error) => {
      logger.error('下载文件失败:', error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          errorMessage: '下载文件失败',
          errorCode: 500,
        });
      }
    });
  } catch (error) {
    logger.error('下载任务文件失败:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        errorMessage: error.message || '下载任务文件失败',
        errorCode: 500,
      });
    }
  }
}

module.exports = {
  getTaskStatus,
  downloadTaskFile,
};
