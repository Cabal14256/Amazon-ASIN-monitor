const FeishuConfig = require('../models/FeishuConfig');
const logger = require('../utils/logger');

function sendConfigError(res, error, message) {
  const status = error.status === 400 ? 400 : 500;
  if (status === 400) {
    logger.warn(message, { message: error.message });
  } else {
    logger.error(message);
  }
  return res.status(status).json({
    success: false,
    errorMessage: status === 400 ? error.message : message,
    errorCode: status,
  });
}

// 获取所有飞书配置
exports.getFeishuConfigs = async (req, res) => {
  try {
    const configs = await FeishuConfig.findAll();
    res.json({
      success: true,
      data: configs,
      errorCode: 0,
    });
  } catch (error) {
    sendConfigError(res, error, '获取飞书配置失败');
  }
};

// 根据国家获取配置
exports.getFeishuConfigByCountry = async (req, res) => {
  try {
    const { country } = req.params;
    const config = await FeishuConfig.findByCountry(country);
    if (!config) {
      return res.status(404).json({
        success: false,
        errorMessage: '配置不存在',
        errorCode: 404,
      });
    }
    res.json({
      success: true,
      data: config,
      errorCode: 0,
    });
  } catch (error) {
    sendConfigError(res, error, '获取飞书配置失败');
  }
};

// 创建或更新飞书配置
exports.upsertFeishuConfig = async (req, res) => {
  try {
    const { webhookUrl, enabled } = req.body;
    const country = req.params.country || req.body.country;

    if (
      req.params.country &&
      req.body.country &&
      req.params.country !== req.body.country
    ) {
      return res.status(400).json({
        success: false,
        errorMessage: '请求路径和配置区域不一致',
        errorCode: 400,
      });
    }

    if (!country || !webhookUrl) {
      return res.status(400).json({
        success: false,
        errorMessage: 'country 和 webhookUrl 为必填项',
        errorCode: 400,
      });
    }

    if (
      enabled !== undefined &&
      typeof enabled !== 'boolean' &&
      enabled !== 0 &&
      enabled !== 1
    ) {
      return res.status(400).json({
        success: false,
        errorMessage: 'enabled参数必须是布尔值或0/1',
        errorCode: 400,
      });
    }

    const config = await FeishuConfig.upsert({
      country,
      webhookUrl,
      enabled: enabled !== undefined ? enabled : 1,
      ...(Object.prototype.hasOwnProperty.call(req.body, 'emergency')
        ? { emergency: req.body.emergency }
        : {}),
    });

    res.json({
      success: true,
      data: config,
      errorCode: 0,
    });
  } catch (error) {
    sendConfigError(res, error, '保存飞书配置失败');
  }
};

// 删除飞书配置
exports.deleteFeishuConfig = async (req, res) => {
  try {
    const { country } = req.params;
    await FeishuConfig.delete(country);
    res.json({
      success: true,
      data: '删除成功',
      errorCode: 0,
    });
  } catch (error) {
    sendConfigError(res, error, '删除飞书配置失败');
  }
};

// 启用/禁用飞书配置
exports.toggleFeishuConfig = async (req, res) => {
  try {
    const { country } = req.params;
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean' && enabled !== 0 && enabled !== 1) {
      return res.status(400).json({
        success: false,
        errorMessage: 'enabled参数必须是布尔值或0/1',
        errorCode: 400,
      });
    }

    const config = await FeishuConfig.toggleEnabled(country, enabled);
    if (!config) {
      return res.status(404).json({
        success: false,
        errorMessage: '配置不存在',
        errorCode: 404,
      });
    }

    res.json({
      success: true,
      data: config,
      errorCode: 0,
    });
  } catch (error) {
    sendConfigError(res, error, '更新飞书配置状态失败');
  }
};
