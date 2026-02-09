const SPAPIConfig = require('../models/SPAPIConfig');
const {
  reloadSPAPIConfig,
  loadUseAwsSignatureConfig,
} = require('../config/sp-api');
const { reloadMonitorConfig } = require('../config/monitor-config');
const {
  reloadCompetitorMonitorConfig,
} = require('../config/competitor-monitor-config');
const {
  reloadHtmlScraperFallbackConfig,
  reloadLegacyClientFallbackConfig,
} = require('../services/variantCheckService');
const { reloadMonitorSchedule } = require('../services/schedulerService');
const rateLimiter = require('../services/rateLimiter');
const errorStatsService = require('../services/errorStatsService');
const riskControlService = require('../services/riskControlService');
const logger = require('../utils/logger');

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
    logger.error('获取SP-API配置错误:', error);
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
    logger.error('获取SP-API配置错误:', error);
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
      logger.info('✅ SP-API配置已重新加载');
    } catch (reloadError) {
      logger.error('⚠️ 重新加载SP-API配置失败:', reloadError);
    }

    // 重新加载AWS签名配置
    try {
      await loadUseAwsSignatureConfig();
      logger.info('✅ AWS签名配置已重新加载');
    } catch (awsError) {
      logger.error('⚠️ 重新加载AWS签名配置失败:', awsError);
    }

    // 重新加载HTML抓取兜底配置
    try {
      await reloadHtmlScraperFallbackConfig();
      logger.info('✅ HTML抓取兜底配置已重新加载');
    } catch (htmlError) {
      logger.error('⚠️ 重新加载HTML抓取兜底配置失败:', htmlError);
    }

    // 重新加载旧客户端备用配置
    try {
      await reloadLegacyClientFallbackConfig();
      logger.info('✅ 旧客户端备用配置已重新加载');
    } catch (legacyError) {
      logger.error('⚠️ 重新加载旧客户端备用配置失败:', legacyError);
    }

    try {
      await reloadMonitorConfig();
      logger.info('✅ 监控并发配置已重新加载');
    } catch (monitorError) {
      logger.error('⚠️ 重新加载监控并发配置失败:', monitorError);
    }

    try {
      await reloadCompetitorMonitorConfig();
      logger.info('? 竞品监控开关已重新加载');
    } catch (competitorError) {
      logger.error('?? 重新加载竞品监控开关失败:', competitorError);
    }

    try {
      await reloadMonitorSchedule();
      logger.info('✅ 监控频率配置已重新加载');
    } catch (scheduleError) {
      logger.error('⚠️ 重新加载监控频率配置失败:', scheduleError);
    }

    res.json({
      success: true,
      data: results,
      errorCode: 0,
    });
  } catch (error) {
    logger.error('更新SP-API配置错误:', error);
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
      'SP_API_US_LWA_CLIENT_ID',
      'SP_API_US_LWA_CLIENT_SECRET',
      'SP_API_US_REFRESH_TOKEN',
      'SP_API_EU_LWA_CLIENT_ID',
      'SP_API_EU_LWA_CLIENT_SECRET',
      'SP_API_EU_REFRESH_TOKEN',
      'SP_API_LWA_CLIENT_ID',
      'SP_API_LWA_CLIENT_SECRET',
      'SP_API_REFRESH_TOKEN',
      'SP_API_ACCESS_KEY_ID',
      'SP_API_SECRET_ACCESS_KEY',
      'SP_API_ROLE_ARN',
      'MONITOR_MAX_CONCURRENT_GROUP_CHECKS',
      'MONITOR_US_SCHEDULE_MINUTES',
      'MONITOR_EU_SCHEDULE_MINUTES',
      'COMPETITOR_MONITOR_ENABLED',
      'SP_API_USE_AWS_SIGNATURE',
      'ENABLE_HTML_SCRAPER_FALLBACK',
      'ENABLE_LEGACY_CLIENT_FALLBACK',
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

      if (
        config &&
        config.config_value !== undefined &&
        config.config_value !== null
      ) {
        value = config.config_value;
      } else {
        // 从环境变量读取
        const envKey = key;
        value = process.env[envKey];
        if (value === undefined || value === '') {
          if (key === 'COMPETITOR_MONITOR_ENABLED') {
            value = 'true';
          } else if (key === 'MONITOR_US_SCHEDULE_MINUTES') {
            value = '30';
          } else if (key === 'MONITOR_EU_SCHEDULE_MINUTES') {
            value = '60';
          } else {
            value = '';
          }
        }
      }
      if (value === undefined || value === null) {
        value = '';
      }

      let displayValue = value;
      // 对于敏感字段，只显示部分内容（布尔值字段不需要隐藏）
      if (
        !['SP_API_USE_AWS_SIGNATURE', 'ENABLE_HTML_SCRAPER_FALLBACK'].includes(
          key,
        ) &&
        (key.includes('SECRET') || key.includes('TOKEN') || key.includes('KEY'))
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
    logger.error('获取SP-API配置错误:', error);
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
    SP_API_US_LWA_CLIENT_ID: 'US 区域 LWA Client ID',
    SP_API_US_LWA_CLIENT_SECRET: 'US 区域 LWA Client Secret',
    SP_API_US_REFRESH_TOKEN: 'US 区域 Refresh Token',
    SP_API_EU_LWA_CLIENT_ID: 'EU 区域 LWA Client ID',
    SP_API_EU_LWA_CLIENT_SECRET: 'EU 区域 LWA Client Secret',
    SP_API_EU_REFRESH_TOKEN: 'EU 区域 Refresh Token',
    SP_API_LWA_CLIENT_ID: 'LWA Client ID（通用）',
    SP_API_LWA_CLIENT_SECRET: 'LWA Client Secret（通用）',
    SP_API_REFRESH_TOKEN: 'Refresh Token（通用）',
    SP_API_ACCESS_KEY_ID: 'AWS Access Key ID（US+EU共用）',
    SP_API_SECRET_ACCESS_KEY: 'AWS Secret Access Key（US+EU共用）',
    SP_API_ROLE_ARN: 'AWS IAM Role ARN（US+EU共用）',
    MONITOR_MAX_CONCURRENT_GROUP_CHECKS: '每次并发检查的变体组数量',
    MONITOR_US_SCHEDULE_MINUTES: 'US 区域定时监控间隔（分钟）',
    MONITOR_EU_SCHEDULE_MINUTES: 'EU 区域定时监控间隔（分钟）',
    COMPETITOR_MONITOR_ENABLED: '竞品监控开关',
    SP_API_USE_AWS_SIGNATURE:
      '是否启用AWS签名（简化模式：关闭，标准模式：开启）',
    ENABLE_HTML_SCRAPER_FALLBACK: '是否启用HTML抓取兜底（SP-API失败时使用）',
    ENABLE_LEGACY_CLIENT_FALLBACK: '是否启用旧客户端备用（SP-API失败时使用）',
  };
  return descriptions[key] || key;
}

// 获取限流器状态
exports.getRateLimiterStatus = async (req, res) => {
  try {
    const { region } = req.query;
    if (region) {
      const status = rateLimiter.getStatus(region);
      res.json({
        success: true,
        data: { [region]: status },
        errorCode: 0,
      });
    } else {
      const usStatus = rateLimiter.getStatus('US');
      const euStatus = rateLimiter.getStatus('EU');
      res.json({
        success: true,
        data: {
          US: usStatus,
          EU: euStatus,
        },
        errorCode: 0,
      });
    }
  } catch (error) {
    logger.error('获取限流器状态错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '获取失败',
      errorCode: 500,
    });
  }
};

// 获取错误统计
exports.getErrorStats = async (req, res) => {
  try {
    const { hours = 1 } = req.query;
    const stats = errorStatsService.getErrorStats({ hours: Number(hours) });
    res.json({
      success: true,
      data: stats,
      errorCode: 0,
    });
  } catch (error) {
    logger.error('获取错误统计错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '获取失败',
      errorCode: 500,
    });
  }
};
