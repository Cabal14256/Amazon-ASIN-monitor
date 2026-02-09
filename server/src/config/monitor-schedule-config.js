const SPAPIConfig = require('../models/SPAPIConfig');
const logger = require('../utils/logger');

const MONITOR_US_SCHEDULE_KEY = 'MONITOR_US_SCHEDULE_MINUTES';
const MONITOR_EU_SCHEDULE_KEY = 'MONITOR_EU_SCHEDULE_MINUTES';
const ALLOWED_INTERVAL_MINUTES = [15, 30, 60];

const DEFAULT_US_INTERVAL = normalizeInterval(
  process.env.MONITOR_US_SCHEDULE_MINUTES,
  30,
);
const DEFAULT_EU_INTERVAL = normalizeInterval(
  process.env.MONITOR_EU_SCHEDULE_MINUTES,
  60,
);

const monitorScheduleConfig = {
  usIntervalMinutes: DEFAULT_US_INTERVAL,
  euIntervalMinutes: DEFAULT_EU_INTERVAL,
};

function normalizeInterval(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (!ALLOWED_INTERVAL_MINUTES.includes(parsed)) {
    return fallback;
  }
  return parsed;
}

async function loadMonitorScheduleConfigFromDatabase() {
  try {
    const [usConfig, euConfig] = await Promise.all([
      SPAPIConfig.findByKey(MONITOR_US_SCHEDULE_KEY),
      SPAPIConfig.findByKey(MONITOR_EU_SCHEDULE_KEY),
    ]);

    const nextUsInterval = normalizeInterval(
      usConfig?.config_value,
      DEFAULT_US_INTERVAL,
    );
    const nextEuInterval = normalizeInterval(
      euConfig?.config_value,
      DEFAULT_EU_INTERVAL,
    );

    if (
      usConfig?.config_value &&
      nextUsInterval === DEFAULT_US_INTERVAL &&
      String(usConfig.config_value) !== String(DEFAULT_US_INTERVAL)
    ) {
      logger.warn(
        `[监控频率] US 配置 ${usConfig.config_value} 无效，使用默认值 ${DEFAULT_US_INTERVAL}`,
      );
    }

    if (
      euConfig?.config_value &&
      nextEuInterval === DEFAULT_EU_INTERVAL &&
      String(euConfig.config_value) !== String(DEFAULT_EU_INTERVAL)
    ) {
      logger.warn(
        `[监控频率] EU 配置 ${euConfig.config_value} 无效，使用默认值 ${DEFAULT_EU_INTERVAL}`,
      );
    }

    monitorScheduleConfig.usIntervalMinutes = nextUsInterval;
    monitorScheduleConfig.euIntervalMinutes = nextEuInterval;

    logger.info(
      `✅ 监控频率配置: US 每${monitorScheduleConfig.usIntervalMinutes}分钟, EU 每${monitorScheduleConfig.euIntervalMinutes}分钟`,
    );
  } catch (error) {
    logger.warn('⚠️ 加载监控频率配置失败:', error.message);
  }
}

function getMonitorScheduleConfig() {
  return { ...monitorScheduleConfig };
}

async function reloadMonitorScheduleConfig() {
  await loadMonitorScheduleConfigFromDatabase();
}

loadMonitorScheduleConfigFromDatabase();

module.exports = {
  MONITOR_US_SCHEDULE_KEY,
  MONITOR_EU_SCHEDULE_KEY,
  ALLOWED_INTERVAL_MINUTES,
  getMonitorScheduleConfig,
  reloadMonitorScheduleConfig,
  loadMonitorScheduleConfigFromDatabase,
};
