const VariantGroup = require('../models/VariantGroup');
const ASIN = require('../models/ASIN');
const logger = require('../utils/logger');
const { importFromFile } = require('../services/importService');
const taskRegistryService = require('../services/taskRegistryService');
const {
  sendSuccessResponse,
  sendErrorResponse,
  validateRequiredFields,
  handleControllerError,
} = require('../services/sharedService');

function parseMarkedBroken(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 1 || value === '1') {
    return true;
  }
  if (value === 0 || value === '0') {
    return false;
  }
  return null;
}

// 查询变体组列表
exports.getVariantGroups = async (req, res) => {
  try {
    const { keyword, country, variantStatus, current, pageSize } = req.query;
    logger.info('查询参数:', {
      keyword,
      country,
      variantStatus,
      current,
      pageSize,
    });
    const result = await VariantGroup.findAll({
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
exports.getVariantGroupById = async (req, res) => {
  try {
    const { groupId } = req.params;
    const group = await VariantGroup.findById(groupId);
    if (!group) {
      return sendErrorResponse(res, 404, '变体组不存在');
    }
    sendSuccessResponse(res, group);
  } catch (error) {
    handleControllerError(error, req, res);
  }
};

// 创建变体组
exports.createVariantGroup = async (req, res) => {
  try {
    validateRequiredFields(req.body, ['name', 'country', 'site', 'brand']);
    const { name, country, site, brand } = req.body;
    const group = await VariantGroup.create({ name, country, site, brand });
    sendSuccessResponse(res, group);
  } catch (error) {
    if (error.statusCode === 400) {
      return sendErrorResponse(res, 400, error.message);
    }
    handleControllerError(error, req, res);
  }
};

// 更新变体组
exports.updateVariantGroup = async (req, res) => {
  try {
    validateRequiredFields(req.body, ['name', 'country', 'site', 'brand']);
    const { groupId } = req.params;
    const { name, country, site, brand } = req.body;
    const group = await VariantGroup.update(groupId, {
      name,
      country,
      site,
      brand,
    });
    if (!group) {
      return sendErrorResponse(res, 404, '变体组不存在');
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
exports.deleteVariantGroup = async (req, res) => {
  try {
    const { groupId } = req.params;
    await VariantGroup.delete(groupId);
    sendSuccessResponse(res, '删除成功');
  } catch (error) {
    handleControllerError(error, req, res);
  }
};

// 添加ASIN
exports.createASIN = async (req, res) => {
  try {
    validateRequiredFields(req.body, [
      'asin',
      'country',
      'site',
      'brand',
      'parentId',
    ]);
    const { asin, name, country, site, brand, parentId, asinType } = req.body;
    // 验证asinType值
    if (asinType && !['1', '2'].includes(String(asinType))) {
      return sendErrorResponse(
        res,
        400,
        'ASIN类型必须是 1（主链）或 2（副评）',
      );
    }
    const asinData = await ASIN.create({
      asin,
      name: name || null, // name字段可选
      country,
      site,
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
exports.updateASIN = async (req, res) => {
  try {
    const { asinId } = req.params;
    const { asin, name, country, site, brand, asinType } = req.body;
    if (!asin || !country || !site || !brand) {
      return res.status(400).json({
        success: false,
        errorMessage: 'ASIN、国家、站点和品牌为必填项',
        errorCode: 400,
      });
    }
    // 验证asinType值
    if (asinType && !['1', '2'].includes(String(asinType))) {
      return sendErrorResponse(
        res,
        400,
        'ASIN类型必须是 1（主链）或 2（副评）',
      );
    }
    const asinData = await ASIN.update(asinId, {
      asin,
      name,
      country,
      site,
      brand,
      asinType,
    });
    if (!asinData) {
      return sendErrorResponse(res, 404, 'ASIN不存在');
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
exports.moveASIN = async (req, res) => {
  try {
    const { asinId } = req.params;
    const { targetGroupId } = req.body;
    if (!targetGroupId) {
      return res.status(400).json({
        success: false,
        errorMessage: '目标变体组ID为必填项',
        errorCode: 400,
      });
    }
    const asinData = await ASIN.moveToGroup(asinId, targetGroupId);
    if (!asinData) {
      return res.status(404).json({
        success: false,
        errorMessage: 'ASIN不存在',
        errorCode: 404,
      });
    }
    res.json({
      success: true,
      data: asinData,
      errorCode: 0,
    });
  } catch (error) {
    logger.error('移动ASIN错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '移动失败',
      errorCode: 500,
    });
  }
};

// 更新ASIN飞书通知开关
exports.updateASINFeishuNotify = async (req, res) => {
  try {
    const { asinId } = req.params;
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean' && enabled !== 0 && enabled !== 1) {
      return res.status(400).json({
        success: false,
        errorMessage: 'enabled参数必须是布尔值或0/1',
        errorCode: 400,
      });
    }
    const asinData = await ASIN.updateFeishuNotify(asinId, enabled);
    if (!asinData) {
      return res.status(404).json({
        success: false,
        errorMessage: 'ASIN不存在',
        errorCode: 404,
      });
    }
    res.json({
      success: true,
      data: asinData,
      errorCode: 0,
    });
  } catch (error) {
    logger.error('更新ASIN飞书通知开关错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '更新失败',
      errorCode: 500,
    });
  }
};

// 更新ASIN人工异常标记
exports.updateASINManualBroken = async (req, res) => {
  try {
    const { asinId } = req.params;
    const markedBroken = parseMarkedBroken(req.body?.markedBroken);
    const reason = String(req.body?.reason || '').trim();

    if (markedBroken === null) {
      return sendErrorResponse(res, 400, 'markedBroken参数必须是布尔值或0/1');
    }
    if (markedBroken && !reason) {
      return sendErrorResponse(res, 400, '人工标记异常时必须填写原因');
    }
    if (reason.length > 500) {
      return sendErrorResponse(res, 400, '原因长度不能超过500个字符');
    }

    const updatedBy =
      req.user?.real_name ||
      req.user?.username ||
      req.user?.userId ||
      req.user?.id ||
      null;
    const asinData = await ASIN.updateManualBroken(
      asinId,
      markedBroken,
      reason,
      updatedBy,
    );

    if (!asinData) {
      return sendErrorResponse(res, 404, 'ASIN不存在');
    }

    sendSuccessResponse(res, asinData);
  } catch (error) {
    handleControllerError(error, req, res);
  }
};

// 更新变体组飞书通知开关
exports.updateVariantGroupFeishuNotify = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean' && enabled !== 0 && enabled !== 1) {
      return res.status(400).json({
        success: false,
        errorMessage: 'enabled参数必须是布尔值或0/1',
        errorCode: 400,
      });
    }
    const groupData = await VariantGroup.updateFeishuNotify(groupId, enabled);
    if (!groupData) {
      return res.status(404).json({
        success: false,
        errorMessage: '变体组不存在',
        errorCode: 404,
      });
    }
    res.json({
      success: true,
      data: groupData,
      errorCode: 0,
    });
  } catch (error) {
    logger.error('更新变体组飞书通知开关错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '更新失败',
      errorCode: 500,
    });
  }
};

// 更新变体组人工异常标记
exports.updateVariantGroupManualBroken = async (req, res) => {
  try {
    const { groupId } = req.params;
    const markedBroken = parseMarkedBroken(req.body?.markedBroken);
    const reason = String(req.body?.reason || '').trim();

    if (markedBroken === null) {
      return sendErrorResponse(res, 400, 'markedBroken参数必须是布尔值或0/1');
    }
    if (markedBroken && !reason) {
      return sendErrorResponse(res, 400, '人工标记异常时必须填写原因');
    }
    if (reason.length > 500) {
      return sendErrorResponse(res, 400, '原因长度不能超过500个字符');
    }

    const updatedBy =
      req.user?.real_name ||
      req.user?.username ||
      req.user?.userId ||
      req.user?.id ||
      null;
    const groupData = await VariantGroup.updateManualBroken(
      groupId,
      markedBroken,
      reason,
      updatedBy,
    );

    if (!groupData) {
      return sendErrorResponse(res, 404, '变体组不存在');
    }

    sendSuccessResponse(res, groupData);
  } catch (error) {
    handleControllerError(error, req, res);
  }
};

// 删除ASIN
exports.deleteASIN = async (req, res) => {
  try {
    const { asinId } = req.params;
    await ASIN.delete(asinId);
    sendSuccessResponse(res, '删除成功');
  } catch (error) {
    handleControllerError(error, req, res);
  }
};

// Excel导入变体组和ASIN
exports.importFromExcel = async (req, res) => {
  try {
    const shouldUseAsync =
      req.body.useAsync !== 'false' && req.body.useAsync !== false;
    const userId = req.user?.userId || req.user?.id;

    if (!req.file) {
      logger.error('Excel导入错误: 没有收到文件');
      return res.status(400).json({
        success: false,
        errorMessage: '请上传Excel文件',
        errorCode: 400,
      });
    }

    logger.info('收到导入文件:', {
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
        taskSubType: 'asin',
        title: 'ASIN导入',
        userId,
        message: '导入任务已创建，等待处理',
      });

      await importTaskQueue.enqueue({
        taskId,
        taskType: 'import',
        taskSubType: 'asin',
        fileBuffer: req.file.buffer,
        originalFilename: req.file.originalname,
        userId,
      });

      logger.info(
        `[导入任务] 创建任务成功: ${taskId}, 文件: ${req.file.originalname}, 用户: ${userId}`,
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

    const result = await importFromFile(req.file, { mode: 'standard' });

    res.json({
      success: true,
      data: result,
      errorCode: 0,
    });
  } catch (error) {
    logger.error('Excel导入错误:', error);
    logger.error('错误堆栈:', error.stack);
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
