const SPAPIConfig = require('../models/SPAPIConfig');
const { reloadSPAPIConfig } = require('../config/sp-api');

// 获取所有SP-API配置
exports.getSPAPIConfigs = async (req, res) => {
  try {
    const configs = await SPAPIConfig.findAll();
    res.json({
      success: true,
      data: configs,
      errorCode: 0,
    });
  } catch (error) {
    console.error('获取SP-API配置错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '获取失败',
      errorCode: 500,
    });
  }
};

// 根据键获取配置
exports.getSPAPIConfigByKey = async (req, res) => {
  try {
    const { configKey } = req.params;
    const config = await SPAPIConfig.findByKey(configKey);
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
    console.error('获取SP-API配置错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '获取失败',
      errorCode: 500,
    });
  }
};

// 更新SP-API配置
exports.updateSPAPIConfig = async (req, res) => {
  try {
    const { configs } = req.body; // 配置数组 [{configKey, configValue, description}]

    if (!configs || !Array.isArray(configs) || configs.length === 0) {
      return res.status(400).json({
        success: false,
        errorMessage: '请提供配置数据',
        errorCode: 400,
      });
    }

    // 批量更新配置
    const results = await SPAPIConfig.batchUpdate(configs);

    // 重新加载SP-API配置
    try {
      await reloadSPAPIConfig();
      console.log('✅ SP-API配置已重新加载');
    } catch (reloadError) {
      console.error('⚠️ 重新加载SP-API配置失败:', reloadError);
      // 不阻止响应，配置已保存到数据库
    }

    res.json({
      success: true,
      data: results,
      errorCode: 0,
    });
  } catch (error) {
    console.error('更新SP-API配置错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '更新失败',
      errorCode: 500,
    });
  }
};

// 获取SP-API配置（用于前端显示，隐藏敏感信息）
exports.getSPAPIConfigForDisplay = async (req, res) => {
  try {
    const configs = await SPAPIConfig.findAll();

    // 定义所有需要的配置键
    const requiredKeys = [
      'SP_API_LWA_CLIENT_ID',
      'SP_API_LWA_CLIENT_SECRET',
      'SP_API_REFRESH_TOKEN',
      'SP_API_ACCESS_KEY_ID',
      'SP_API_SECRET_ACCESS_KEY',
      'SP_API_ROLE_ARN',
    ];

    // 创建配置映射
    const configMap = {};
    configs.forEach((config) => {
      configMap[config.config_key] = config;
    });

    // 为每个必需的键创建配置项（如果不存在，从环境变量读取）
    const displayConfigs = requiredKeys.map((key) => {
      let config = configMap[key];
      let value = '';

      if (config && config.config_value) {
        value = config.config_value;
      } else {
        // 从环境变量读取
        const envKey = key;
        value = process.env[envKey] || '';
      }

      let displayValue = value;
      // 对于敏感字段，只显示部分内容
      if (
        key.includes('SECRET') ||
        key.includes('TOKEN') ||
        key.includes('KEY')
      ) {
        if (value.length > 8) {
          displayValue =
            value.substring(0, 4) + '****' + value.substring(value.length - 4);
        } else if (value.length > 0) {
          displayValue = '****';
        }
      }

      return {
        id: config?.id || null,
        configKey: key,
        configValue: value, // 返回真实值，前端需要用于编辑
        displayValue, // 用于显示（隐藏敏感信息）
        hasValue: !!value,
        description: config?.description || getConfigDescription(key),
        createTime: config?.create_time || null,
        updateTime: config?.update_time || null,
      };
    });

    res.json({
      success: true,
      data: displayConfigs,
      errorCode: 0,
    });
  } catch (error) {
    console.error('获取SP-API配置错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '获取失败',
      errorCode: 500,
    });
  }
};

// 获取配置说明
function getConfigDescription(key) {
  const descriptions = {
    SP_API_LWA_CLIENT_ID: 'LWA Client ID',
    SP_API_LWA_CLIENT_SECRET: 'LWA Client Secret',
    SP_API_REFRESH_TOKEN: 'LWA Refresh Token',
    SP_API_ACCESS_KEY_ID: 'AWS Access Key ID',
    SP_API_SECRET_ACCESS_KEY: 'AWS Secret Access Key',
    SP_API_ROLE_ARN: 'AWS IAM Role ARN',
  };
  return descriptions[key] || key;
}
