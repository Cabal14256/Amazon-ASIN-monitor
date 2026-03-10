const CompetitorVariantGroup = require('../models/CompetitorVariantGroup');
const CompetitorASIN = require('../models/CompetitorASIN');
const logger = require('../utils/logger');
const { importFromFile } = require('../services/importService');
const taskRegistryService = require('../services/taskRegistryService');
const {
  sendSuccessResponse,
  sendErrorResponse,
  validateRequiredFields,
  handleControllerError,
} = require('../services/sharedService');

// 查询变体组列表
exports.getCompetitorVariantGroups = async (req, res) => {
  try {
    const { keyword, country, variantStatus, current, pageSize } = req.query;
    logger.info('查询参数:', {
      keyword,
      country,
      variantStatus,
      current,
      pageSize,
    });
    const result = await CompetitorVariantGroup.findAll({
      keyword,
      country,
      variantStatus,
      current: current || 1,
      pageSize: pageSize || 10,
    });
    sendSuccessResponse(res, result);
  } catch (error) {
    handleControllerError(error, req, res);
  }
};

// 获取变体组详情
exports.getCompetitorVariantGroupById = async (req, res) => {
  try {
    const { groupId } = req.params;
    const group = await CompetitorVariantGroup.findById(groupId);
    if (!group) {
      return sendErrorResponse(res, 404, '竞品变体组不存在');
    }
    sendSuccessResponse(res, group);
  } catch (error) {
    handleControllerError(error, req, res);
  }
};

// 创建变体组
exports.createCompetitorVariantGroup = async (req, res) => {
  try {
    validateRequiredFields(req.body, ['name', 'country', 'brand']);
    const { name, country, brand } = req.body;
    const group = await CompetitorVariantGroup.create({ name, country, brand });
    sendSuccessResponse(res, group);
  } catch (error) {
    if (error.statusCode === 400) {
      return sendErrorResponse(res, 400, error.message);
    }
    handleControllerError(error, req, res);
  }
};

// 更新变体组
exports.updateCompetitorVariantGroup = async (req, res) => {
  try {
    validateRequiredFields(req.body, ['name', 'country', 'brand']);
    const { groupId } = req.params;
    const { name, country, brand } = req.body;
    const group = await CompetitorVariantGroup.update(groupId, {
      name,
      country,
      brand,
    });
    if (!group) {
      return sendErrorResponse(res, 404, '竞品变体组不存在');
    }
    sendSuccessResponse(res, group);
  } catch (error) {
    if (error.statusCode === 400) {
      return sendErrorResponse(res, 400, error.message);
    }
    handleControllerError(error, req, res);
  }
};

// 删除变体组
exports.deleteCompetitorVariantGroup = async (req, res) => {
  try {
    const { groupId } = req.params;
    const deleted = await CompetitorVariantGroup.delete(groupId);
    if (!deleted) {
      return sendErrorResponse(res, 404, '竞品变体组不存在');
    }
    sendSuccessResponse(res, '删除成功');
  } catch (error) {
    handleControllerError(error, req, res);
  }
};

// 添加ASIN
exports.createCompetitorASIN = async (req, res) => {
  try {
    validateRequiredFields(req.body, ['asin', 'country', 'brand', 'parentId']);
    const { asin, name, country, brand, parentId, asinType } = req.body;
    // 验证asinType值
    if (asinType && !['1', '2'].includes(String(asinType))) {
      return sendErrorResponse(
        res,
        400,
        'ASIN类型必须是 1（主链）或 2（副评）',
      );
    }
    const asinData = await CompetitorASIN.create({
      asin,
      name: name || null, // name字段可选
      country,
      brand,
      variantGroupId: parentId,
      asinType: asinType || null,
    });
    sendSuccessResponse(res, asinData);
  } catch (error) {
    if (error.statusCode === 400) {
      return sendErrorResponse(res, 400, error.message);
    }
    handleControllerError(error, req, res);
  }
};

// 更新ASIN
exports.updateCompetitorASIN = async (req, res) => {
  try {
    validateRequiredFields(req.body, ['asin', 'country', 'brand']);
    const { asinId } = req.params;
    const { asin, name, country, brand, asinType } = req.body;

    if (asinType && !['1', '2'].includes(String(asinType))) {
      return sendErrorResponse(
        res,
        400,
        'ASIN类型必须是 1（主链）或 2（副评）',
      );
    }
    const asinData = await CompetitorASIN.update(asinId, {
      asin,
      name,
      country,
      brand,
      asinType,
    });
    if (!asinData) {
      return sendErrorResponse(res, 404, '竞品ASIN不存在');
    }
    sendSuccessResponse(res, asinData);
  } catch (error) {
    if (error.statusCode === 400) {
      return sendErrorResponse(res, 400, error.message);
    }
    handleControllerError(error, req, res);
  }
};

// 移动ASIN到其他变体组
exports.moveCompetitorASIN = async (req, res) => {
  try {
    const { asinId } = req.params;
    const { targetGroupId } = req.body;
    if (!targetGroupId) {
      return sendErrorResponse(res, 400, '目标变体组ID为必填项');
    }
    const asinData = await CompetitorASIN.moveToGroup(asinId, targetGroupId);
    if (!asinData) {
      return sendErrorResponse(res, 404, '竞品ASIN不存在');
    }
    sendSuccessResponse(res, asinData);
  } catch (error) {
    if (error.statusCode === 400 || error.statusCode === 404) {
      return sendErrorResponse(res, error.statusCode, error.message);
    }
    handleControllerError(error, req, res);
  }
};

// 更新ASIN飞书通知开关
exports.updateCompetitorASINFeishuNotify = async (req, res) => {
  try {
    const { asinId } = req.params;
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean' && enabled !== 0 && enabled !== 1) {
      return sendErrorResponse(res, 400, 'enabled参数必须是布尔值或0/1');
    }
    const asinData = await CompetitorASIN.updateFeishuNotify(asinId, enabled);
    if (!asinData) {
      return sendErrorResponse(res, 404, '竞品ASIN不存在');
    }
    sendSuccessResponse(res, asinData);
  } catch (error) {
    handleControllerError(error, req, res);
  }
};

// 更新变体组飞书通知开关
exports.updateCompetitorVariantGroupFeishuNotify = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean' && enabled !== 0 && enabled !== 1) {
      return sendErrorResponse(res, 400, 'enabled参数必须是布尔值或0/1');
    }
    const groupData = await CompetitorVariantGroup.updateFeishuNotify(
      groupId,
      enabled,
    );
    if (!groupData) {
      return sendErrorResponse(res, 404, '竞品变体组不存在');
    }
    sendSuccessResponse(res, groupData);
  } catch (error) {
    handleControllerError(error, req, res);
  }
};

// 删除ASIN
exports.deleteCompetitorASIN = async (req, res) => {
  try {
    const { asinId } = req.params;
    const deleted = await CompetitorASIN.delete(asinId);
    if (!deleted) {
      return sendErrorResponse(res, 404, '竞品ASIN不存在');
    }
    sendSuccessResponse(res, '删除成功');
  } catch (error) {
    handleControllerError(error, req, res);
  }
};

// Excel导入变体组和ASIN
exports.importCompetitorFromExcel = async (req, res) => {
  try {
    const shouldUseAsync =
      req.body.useAsync !== 'false' && req.body.useAsync !== false;
    const userId = req.user?.userId || req.user?.id;

    if (!req.file) {
      logger.warn('竞品Excel导入错误: 没有收到文件');
      return res.status(400).json({
        success: false,
        errorMessage: '请上传Excel文件',
        errorCode: 400,
      });
    }

    logger.info('收到竞品导入文件:', {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
    });

    if (shouldUseAsync) {
      const { v4: uuidv4 } = require('uuid');
      const importTaskQueue = require('../services/importTaskQueue');

      const taskId = uuidv4();
      await taskRegistryService.createTask({
        taskId,
        taskType: 'import',
        taskSubType: 'competitor-asin',
        title: '竞品ASIN导入',
        userId,
        message: '导入任务已创建，等待处理',
      });

      await importTaskQueue.enqueue({
        taskId,
        taskType: 'import',
        taskSubType: 'competitor-asin',
        fileBuffer: req.file.buffer,
        originalFilename: req.file.originalname,
        userId,
      });

      logger.info(
        `[导入任务] 创建竞品导入任务成功: ${taskId}, 文件: ${req.file.originalname}, 用户: ${userId}`,
      );

      return res.json({
        success: true,
        data: {
          taskId,
          status: 'pending',
        },
        errorCode: 0,
      });
    }

    const result = await importFromFile(req.file, { mode: 'competitor' });

    res.json({
      success: true,
      data: result,
      errorCode: 0,
    });
  } catch (error) {
    logger.error('Excel导入错误:', error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      errorMessage: error.message || 'Excel导入失败',
      errorCode: statusCode,
      data: {
        successCount: 0,
        failedCount: 0,
        errors: [{ message: error.message || '未知错误' }],
      },
    });
  }
};
