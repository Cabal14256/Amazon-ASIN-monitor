const logger = require('../utils/logger');
const upload = require('../middleware/fileUpload');
const taskRegistryService = require('../services/taskRegistryService');
const importTaskQueue = require('../services/importTaskQueue');
const {
  createIncrementalPreview,
} = require('../services/incrementalImportService');
const previewStore = require('../services/incrementalImportPreviewStore');

function userIdFromRequest(req) {
  return req.user?.userId || req.user?.id || null;
}

function sendFailure(res, error, context) {
  const statusCode = error.statusCode || 500;
  const message = error.message || '导入预览处理失败';
  const logContext = { message, code: error.code || null };
  if (statusCode >= 500) {
    logger.error(context, logContext);
  } else {
    logger.warn(context, logContext);
  }
  return res.status(statusCode).json({
    success: false,
    errorCode: statusCode,
    errorMessage: message,
    code: error.code || null,
  });
}

function receiveImportFile(req, res, next) {
  upload.single('file')(req, res, (error) => {
    if (error) {
      error.statusCode = 400;
      return sendFailure(res, error, '上传文件校验失败');
    }
    if (!req.file) {
      return res.status(400).json({
        success: false,
        errorCode: 400,
        errorMessage: '请上传文件',
      });
    }
    return next();
  });
}

function handlersForMode(mode) {
  const taskSubType = mode === 'competitor' ? 'competitor-asin' : 'asin';

  return {
    preview: async (req, res) => {
      try {
        const userId = userIdFromRequest(req);
        if (!userId) {
          return res.status(401).json({
            success: false,
            errorCode: 401,
            errorMessage: '请先登录',
          });
        }
        const result = await createIncrementalPreview(req.file, { mode });
        const data = await previewStore.createPreview({
          file: req.file,
          userId,
          mode,
          preview: result,
        });
        logger.info('ASIN增量导入预览已创建', {
          mode,
          previewId: data.previewId,
          total: data.summary?.total || 0,
        });
        return res.json({ success: true, data, errorCode: 0 });
      } catch (error) {
        return sendFailure(res, error, '创建ASIN增量导入预览失败');
      }
    },

    readPreview: async (req, res) => {
      try {
        const userId = userIdFromRequest(req);
        const data = await previewStore.getPreviewPage({
          previewId: req.params.previewId,
          userId,
          mode,
          kind: req.query.kind,
          page: req.query.page,
          pageSize: req.query.pageSize,
        });
        return res.json({ success: true, data, errorCode: 0 });
      } catch (error) {
        return sendFailure(res, error, '读取ASIN增量导入预览失败');
      }
    },

    confirm: async (req, res) => {
      try {
        const userId = userIdFromRequest(req);
        const previewId = String(req.body?.previewId || '').trim();
        if (!previewId) {
          return res.status(400).json({
            success: false,
            errorCode: 400,
            errorMessage: '预览ID不能为空',
          });
        }
        const taskId = previewId;
        const existingTask = await taskRegistryService.readTask(taskId);
        if (existingTask) {
          if (
            String(existingTask.userId) !== String(userId) ||
            existingTask.taskSubType !== taskSubType
          ) {
            return res.status(404).json({
              success: false,
              errorCode: 404,
              errorMessage: '预览不存在',
            });
          }
          return res.json({
            success: true,
            data: { taskId, status: existingTask.status || 'pending' },
            errorCode: 0,
          });
        }

        const existingJob = await importTaskQueue.getJob(taskId);
        if (existingJob) {
          if (
            String(existingJob.data?.userId) !== String(userId) ||
            existingJob.data?.taskSubType !== taskSubType
          ) {
            return res.status(404).json({
              success: false,
              errorCode: 404,
              errorMessage: '预览不存在',
            });
          }
          return res.json({
            success: true,
            data: { taskId, status: await existingJob.getState() },
            errorCode: 0,
          });
        }

        const { meta, file } = await previewStore.getPreviewFile({
          previewId,
          userId,
          mode,
        });

        await taskRegistryService.createTask({
          taskId,
          taskType: 'import',
          taskSubType,
          title: mode === 'competitor' ? '竞品ASIN增量导入' : 'ASIN增量导入',
          userId,
          message: '增量导入任务已创建，等待处理',
        });
        try {
          await importTaskQueue.enqueue({
            taskId,
            taskType: 'import',
            taskSubType,
            incremental: true,
            previewId,
            expectedDigest: meta.digest,
            fileBuffer: file.buffer,
            originalFilename: file.originalname,
            userId,
          });
        } catch (error) {
          await taskRegistryService.markTaskFailed(taskId, '导入任务创建失败');
          throw error;
        }
        logger.info('ASIN增量导入任务已创建', { mode, taskId });
        return res.json({
          success: true,
          data: { taskId, status: 'pending' },
          errorCode: 0,
        });
      } catch (error) {
        return sendFailure(res, error, '确认ASIN增量导入失败');
      }
    },
  };
}

module.exports = {
  receiveImportFile,
  handlersForMode,
};
