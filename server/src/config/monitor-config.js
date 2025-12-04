const SPAPIConfig = require('../models/SPAPIConfig');

const MONITOR_CONFIG_KEY = 'MONITOR_MAX_CONCURRENT_GROUP_CHECKS';
const DEFAULT_CONCURRENCY =
  Number(process.env.MONITOR_MAX_CONCURRENT_GROUP_CHECKS) || 3;
const MAX_ALLOWED_CONCURRENT_GROUP_CHECKS =
  Number(process.env.MAX_ALLOWED_CONCURRENT_GROUP_CHECKS) || 10;

const monitorConfig = {
  maxConcurrentGroupChecks: limitConcurrency(DEFAULT_CONCURRENCY),
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
    }
    console.log(
      `✅ 监控并发配置: ${monitorConfig.maxConcurrentGroupChecks} 个变体组`,
    );
  } catch (error) {
    console.error('⚠️ 加载监控并发配置失败:', error.message);
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

function getMaxConcurrentGroupChecks() {
  return monitorConfig.maxConcurrentGroupChecks;
}

loadMonitorConfigFromDatabase();

module.exports = {
  MONITOR_CONFIG_KEY,
  getMaxConcurrentGroupChecks,
  reloadMonitorConfig,
  loadMonitorConfigFromDatabase,
};
