const FeishuConfig = require('../models/FeishuConfig');
const logger = require('../utils/logger');

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
    logger.error('获取飞书配置错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '获取失败',
      errorCode: 500,
    });
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
    logger.error('获取飞书配置错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '获取失败',
      errorCode: 500,
    });
  }
};

// 创建或更新飞书配置
exports.upsertFeishuConfig = async (req, res) => {
  try {
    const { country, webhookUrl, enabled } = req.body;

    if (!country || !webhookUrl) {
      return res.status(400).json({
        success: false,
        errorMessage: 'country 和 webhookUrl 为必填项',
        errorCode: 400,
      });
    }

    const config = await FeishuConfig.upsert({
      country,
      webhookUrl,
      enabled: enabled !== undefined ? enabled : 1,
    });

    res.json({
      success: true,
      data: config,
      errorCode: 0,
    });
  } catch (error) {
    logger.error('创建/更新飞书配置错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '操作失败',
      errorCode: 500,
    });
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
    logger.error('删除飞书配置错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '删除失败',
      errorCode: 500,
    });
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
    logger.error('启用/禁用飞书配置错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '操作失败',
      errorCode: 500,
    });
  }
};
