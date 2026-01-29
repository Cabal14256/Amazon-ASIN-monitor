const SPAPIConfig = require('../models/SPAPIConfig');
const riskControlService = require('../services/riskControlService');
const logger = require('../utils/logger');

const MONITOR_CONFIG_KEY = 'MONITOR_MAX_CONCURRENT_GROUP_CHECKS';
const DEFAULT_CONCURRENCY =
  Number(process.env.MONITOR_MAX_CONCURRENT_GROUP_CHECKS) || 3;
const MAX_ALLOWED_CONCURRENT_GROUP_CHECKS =
  Number(process.env.MAX_ALLOWED_CONCURRENT_GROUP_CHECKS) || 10;

const monitorConfig = {
  maxConcurrentGroupChecks: limitConcurrency(DEFAULT_CONCURRENCY),
  // 是否启用自动调整（默认启用）
  autoAdjustEnabled: process.env.AUTO_ADJUST_CONCURRENCY !== 'false',
};

async function loadMonitorConfigFromDatabase() {
  try {
    const config = await SPAPIConfig.findByKey(MONITOR_CONFIG_KEY);
    if (config && config.config_value) {
      const parsed = Number.parseInt(config.config_value, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        monitorConfig.maxConcurrentGroupChecks = limitConcurrency(parsed);
      } else {
        monitorConfig.maxConcurrentGroupChecks =
          limitConcurrency(DEFAULT_CONCURRENCY);
      }
    } else {
      // 如果没有配置，使用默认值
      monitorConfig.maxConcurrentGroupChecks =
        limitConcurrency(DEFAULT_CONCURRENCY);
    }

    // 更新风控服务的当前并发数
    riskControlService.setCurrentConcurrency(
      monitorConfig.maxConcurrentGroupChecks,
    );

    logger.info(
      `✅ 监控并发配置: ${
        monitorConfig.maxConcurrentGroupChecks
      } 个变体组（自动调整: ${
        monitorConfig.autoAdjustEnabled ? '启用' : '禁用'
      }）`,
    );
  } catch (error) {
    logger.warn('⚠️ 加载监控并发配置失败:', error.message);
  }
}

async function reloadMonitorConfig() {
  await loadMonitorConfigFromDatabase();
}

function limitConcurrency(value) {
  const normalized = Number.isFinite(value) && value > 0 ? value : 1;
  const atLeastOne = Math.max(Math.floor(normalized), 1);
  return Math.min(atLeastOne, MAX_ALLOWED_CONCURRENT_GROUP_CHECKS);
}

/**
 * 获取最大并发数（支持自动调整）
 */
function getMaxConcurrentGroupChecks() {
  if (monitorConfig.autoAdjustEnabled) {
    // 使用风控服务计算最优并发数
    const optimalConcurrency = riskControlService.calculateOptimalConcurrency(
      monitorConfig.maxConcurrentGroupChecks,
    );

    // 如果计算出的并发数与当前不同，更新配置
    if (optimalConcurrency !== monitorConfig.maxConcurrentGroupChecks) {
      const oldValue = monitorConfig.maxConcurrentGroupChecks;
      monitorConfig.maxConcurrentGroupChecks =
        limitConcurrency(optimalConcurrency);
      logger.info(
        `🔄 [自动调整] 并发数已调整: ${oldValue} -> ${monitorConfig.maxConcurrentGroupChecks}`,
      );
    }
  }

  return monitorConfig.maxConcurrentGroupChecks;
}

/**
 * 手动设置并发数（用于测试或手动调整）
 */
function setMaxConcurrentGroupChecks(value) {
  monitorConfig.maxConcurrentGroupChecks = limitConcurrency(value);
  riskControlService.setCurrentConcurrency(
    monitorConfig.maxConcurrentGroupChecks,
  );
  logger.info(
    `📝 [手动设置] 并发数已设置为: ${monitorConfig.maxConcurrentGroupChecks}`,
  );
}

/**
 * 启用/禁用自动调整
 */
function setAutoAdjustEnabled(enabled) {
  monitorConfig.autoAdjustEnabled = enabled;
  logger.info(`📝 [配置] 自动调整已${enabled ? '启用' : '禁用'}`);
}

loadMonitorConfigFromDatabase();

module.exports = {
  MONITOR_CONFIG_KEY,
  getMaxConcurrentGroupChecks,
  setMaxConcurrentGroupChecks,
  setAutoAdjustEnabled,
  reloadMonitorConfig,
  loadMonitorConfigFromDatabase,
};
