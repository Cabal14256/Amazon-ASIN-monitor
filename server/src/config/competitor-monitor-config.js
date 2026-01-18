const SPAPIConfig = require('../models/SPAPIConfig');

const COMPETITOR_MONITOR_CONFIG_KEY = 'COMPETITOR_MONITOR_ENABLED';

function parseBoolean(value, defaultValue) {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return defaultValue;
}

function getDefaultEnabled() {
  if (process.env.COMPETITOR_MONITOR_ENABLED === undefined) {
    return true;
  }
  return parseBoolean(process.env.COMPETITOR_MONITOR_ENABLED, true);
}

const competitorMonitorConfig = {
  enabled: getDefaultEnabled(),
};

async function loadCompetitorMonitorConfig() {
  try {
    const config = await SPAPIConfig.findByKey(COMPETITOR_MONITOR_CONFIG_KEY);
    if (config && config.config_value !== undefined) {
      competitorMonitorConfig.enabled = parseBoolean(
        config.config_value,
        getDefaultEnabled(),
      );
    } else {
      competitorMonitorConfig.enabled = getDefaultEnabled();
    }
    console.log(
      `[competitor-monitor] enabled: ${
        competitorMonitorConfig.enabled ? 'true' : 'false'
      }`,
    );
  } catch (error) {
    console.error('[competitor-monitor] load failed:', error.message);
  }
}

async function reloadCompetitorMonitorConfig() {
  await loadCompetitorMonitorConfig();
}

function isCompetitorMonitorEnabled() {
  return competitorMonitorConfig.enabled;
}

loadCompetitorMonitorConfig();

module.exports = {
  COMPETITOR_MONITOR_CONFIG_KEY,
  isCompetitorMonitorEnabled,
  reloadCompetitorMonitorConfig,
  loadCompetitorMonitorConfig,
};
