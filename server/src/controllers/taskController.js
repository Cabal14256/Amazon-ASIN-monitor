const fs = require('fs').promises;
const taskRegistryService = require('../services/taskRegistryService');
const { getQueueByTaskType } = require('../services/taskQueueRegistry');
const exportTaskQueue = require('../services/exportTaskQueue');
const batchCheckTaskQueue = require('../services/batchCheckTaskQueue');
const importTaskQueue = require('../services/importTaskQueue');
const backupTaskQueue = require('../services/backupTaskQueue');
const variantCheckTaskQueue = require('../services/variantCheckTaskQueue');
const websocketService = require('../services/websocketService');
const {
  getDownloadableTaskArtifact,
} = require('../services/taskResultService');
const logger = require('../utils/logger');

async function findTaskFromQueues(taskId) {
  const queueResolvers = [
    { taskType: 'export', resolver: () => exportTaskQueue.getJobState(taskId) },
    {
      taskType: 'batch-check',
      resolver: () => batchCheckTaskQueue.getJobState(taskId),
    },
    { taskType: 'import', resolver: () => importTaskQueue.getJobState(taskId) },
    { taskType: 'backup', resolver: () => backupTaskQueue.getJobState(taskId) },
    {
      taskType: 'variant-check',
      resolver: () => variantCheckTaskQueue.getJobState(taskId),
    },
  ];

  for (const item of queueResolvers) {
    const state = await item.resolver();
    if (state) {
      const statusMap = {
        completed: 'completed',
        failed: 'failed',
        active: 'processing',
        waiting: 'pending',
        delayed: 'pending',
      };
      return {
        taskId: state.taskId,
        taskType: item.taskType,
        taskSubType: state.data?.taskSubType || state.data?.exportType || null,
        title: state.data?.title || state.data?.exportType || item.taskType,
        userId: state.data?.userId || null,
        status: statusMap[state.state] || 'pending',
        progress: state.progress || 0,
        message:
          state.failedReason ||
          state.returnvalue?.summary ||
          state.returnvalue?.message ||
          state.data?.message ||
          '任务处理中',
        createdAt: state.data?.createdAt || null,
        updatedAt: null,
        result: state.returnvalue || null,
        error: state.failedReason || null,
      };
    }
  }

  return null;
}

function getRequestUserId(req) {
  return req.user?.userId || req.user?.id;
}

function sanitizeTaskForResponse(task) {
  const serialized = taskRegistryService.serializeTaskForClient(task);
  if (!serialized) {
    return null;
  }
  const artifact = getDownloadableTaskArtifact(serialized.result);

  return {
    taskId: serialized.taskId,
    taskType: serialized.taskType,
    taskSubType: serialized.taskSubType || null,
    title: serialized.title || serialized.taskType,
    status: serialized.status,
    progress: serialized.progress || 0,
    message: serialized.message || '',
    error: serialized.error || null,
    createdAt: serialized.createdAt || null,
    updatedAt: serialized.updatedAt || null,
    startedAt: serialized.startedAt || null,
    completedAt: serialized.completedAt || null,
    cancelRequestedAt: serialized.cancelRequestedAt || null,
    cancelledAt: serialized.cancelledAt || null,
    canCancel: serialized.canCancel,
    filename: serialized.filename || artifact?.filename || null,
    downloadUrl: serialized.downloadUrl || artifact?.downloadUrl || null,
    result: serialized.result || null,
  };
}

async function reconcileTaskWithQueue(taskId, task, queueTask = null) {
  const currentTask = task || (await taskRegistryService.readTask(taskId));
  if (!currentTask) {
    return queueTask || null;
  }
  if (taskRegistryService.isTerminalTaskStatus(currentTask.status)) {
    return currentTask;
  }

  const latestQueueTask = queueTask || (await findTaskFromQueues(taskId));
  if (!latestQueueTask) {
    return currentTask;
  }
  if (!taskRegistryService.isTerminalTaskStatus(latestQueueTask.status)) {
    return currentTask;
  }

  if (latestQueueTask.status === 'completed') {
    return taskRegistryService.markTaskCompleted(
      taskId,
      latestQueueTask.result || currentTask.result || null,
      {
        message: latestQueueTask.message || currentTask.message || '任务已完成',
      },
    );
  }

  if (latestQueueTask.status === 'failed') {
    const errorMessage =
      latestQueueTask.error ||
      latestQueueTask.message ||
      currentTask.error ||
      '任务失败';
    return taskRegistryService.markTaskFailed(taskId, errorMessage, {
      message: latestQueueTask.message || errorMessage,
    });
  }

  if (latestQueueTask.status === 'cancelled') {
    return taskRegistryService.markTaskCancelled(taskId, {
      message: latestQueueTask.message || '任务已取消',
    });
  }

  return currentTask;
}

async function listTasks(req, res) {
  try {
    const userId = getRequestUserId(req);
    const status = String(req.query.status || 'all');
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);

    const tasks = await taskRegistryService.listUserTasks(userId, {
      status,
      limit,
    });
    const reconciledTasks = await Promise.all(
      tasks.map(async (task) => {
        if (!task || taskRegistryService.isTerminalTaskStatus(task.status)) {
          return task;
        }
        try {
          return await reconcileTaskWithQueue(task.taskId, task);
        } catch (error) {
          logger.warn('[任务中心] 队列状态对账失败:', error.message);
          return task;
        }
      }),
    );

    res.json({
      success: true,
      data: reconciledTasks.map(sanitizeTaskForResponse),
      errorCode: 0,
    });
  } catch (error) {
    logger.error('查询任务列表失败:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '查询任务列表失败',
      errorCode: 500,
    });
  }
}

async function getTaskStatus(req, res) {
  try {
    const { taskId } = req.params;
    const userId = getRequestUserId(req);

    if (!taskId) {
      return res.status(400).json({
        success: false,
        errorMessage: '任务ID不能为空',
        errorCode: 400,
      });
    }

    let task = await taskRegistryService.readTask(taskId);
    const queueTask = await findTaskFromQueues(taskId);
    if (!task) {
      task = queueTask;
    } else {
      task = await reconcileTaskWithQueue(taskId, task, queueTask);
    }

    if (!task) {
      return res.status(404).json({
        success: false,
        errorMessage: '任务不存在',
        errorCode: 404,
      });
    }

    if (task.userId && task.userId !== userId) {
      return res.status(403).json({
        success: false,
        errorMessage: '无权访问此任务',
        errorCode: 403,
      });
    }

    res.json({
      success: true,
      data: sanitizeTaskForResponse(task),
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

async function cancelTask(req, res) {
  try {
    const { taskId } = req.params;
    const userId = getRequestUserId(req);

    if (!taskId) {
      return res.status(400).json({
        success: false,
        errorMessage: '任务ID不能为空',
        errorCode: 400,
      });
    }

    const task = await taskRegistryService.readTask(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        errorMessage: '任务不存在',
        errorCode: 404,
      });
    }

    if (task.userId && task.userId !== userId) {
      return res.status(403).json({
        success: false,
        errorMessage: '无权取消此任务',
        errorCode: 403,
      });
    }

    if (taskRegistryService.isTerminalTaskStatus(task.status)) {
      return res.status(400).json({
        success: false,
        errorMessage: '任务已结束，无法取消',
        errorCode: 400,
      });
    }

    const queueModule = getQueueByTaskType(task.taskType);
    if (!queueModule) {
      return res.status(400).json({
        success: false,
        errorMessage: '该任务类型不支持取消',
        errorCode: 400,
      });
    }

    const job = await queueModule.getJob(taskId);
    if (!job) {
      const cancelledTask = await taskRegistryService.markTaskCancelled(
        taskId,
        {
          message: '任务已取消',
        },
      );
      websocketService.sendTaskCancelled(taskId, '任务已取消', userId);
      return res.json({
        success: true,
        data: sanitizeTaskForResponse(cancelledTask),
        errorCode: 0,
      });
    }

    const state = await job.getState();
    if (['waiting', 'paused', 'delayed'].includes(state)) {
      await job.remove();
      const cancelledTask = await taskRegistryService.markTaskCancelled(
        taskId,
        {
          message: '任务已取消（尚未开始执行）',
        },
      );
      websocketService.sendTaskCancelled(
        taskId,
        '任务已取消（尚未开始执行）',
        userId,
      );
      return res.json({
        success: true,
        data: sanitizeTaskForResponse(cancelledTask),
        errorCode: 0,
      });
    }

    if (state === 'active') {
      try {
        await job.update({
          ...job.data,
          cancelRequestedAt: new Date().toISOString(),
        });
      } catch (error) {
        logger.warn('[任务中心] 更新运行中任务取消标记失败:', error.message);
      }

      const nextTask = await taskRegistryService.requestTaskCancellation(
        taskId,
      );
      return res.json({
        success: true,
        data: sanitizeTaskForResponse(nextTask),
        errorCode: 0,
      });
    }

    const nextTask = await taskRegistryService.requestTaskCancellation(taskId);
    res.json({
      success: true,
      data: sanitizeTaskForResponse(nextTask),
      errorCode: 0,
    });
  } catch (error) {
    logger.error('取消任务失败:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '取消任务失败',
      errorCode: 500,
    });
  }
}

async function downloadTaskFile(req, res) {
  try {
    const { taskId } = req.params;
    const userId = getRequestUserId(req);

    if (!taskId) {
      return res.status(400).json({
        success: false,
        errorMessage: '任务ID不能为空',
        errorCode: 400,
      });
    }

    let task = await taskRegistryService.readTask(taskId);
    if (!task) {
      task = await findTaskFromQueues(taskId);
    }

    if (!task) {
      return res.status(404).json({
        success: false,
        errorMessage: '任务不存在',
        errorCode: 404,
      });
    }

    if (task.userId && task.userId !== userId) {
      return res.status(403).json({
        success: false,
        errorMessage: '无权访问此任务',
        errorCode: 403,
      });
    }

    if (task.status !== 'completed') {
      return res.status(400).json({
        success: false,
        errorMessage: '任务尚未完成',
        errorCode: 400,
      });
    }

    const artifact = getDownloadableTaskArtifact(task.result);
    const result = artifact;
    if (!artifact?.filepath) {
      return res.status(404).json({
        success: false,
        errorMessage: '任务结果文件不存在',
        errorCode: 404,
      });
    }

    try {
      await fs.access(artifact.filepath);
    } catch (error) {
      return res.status(404).json({
        success: false,
        errorMessage: '文件不存在或已过期',
        errorCode: 404,
      });
    }

    const filename = result.filename || `导出文件_${taskId}.xlsx`;
    res.setHeader(
      'Content-Type',
      artifact.mimeType || 'application/octet-stream',
    );
    if (artifact.fileSizeBytes) {
      res.setHeader('Content-Length', String(artifact.fileSizeBytes));
    }
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(filename)}"`,
    );

    const fileStream = require('fs').createReadStream(result.filepath);
    fileStream.pipe(res);

    fileStream.on('error', (error) => {
      logger.error('下载任务文件失败:', error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          errorMessage: '下载任务文件失败',
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
  listTasks,
  getTaskStatus,
  cancelTask,
  downloadTaskFile,
};
