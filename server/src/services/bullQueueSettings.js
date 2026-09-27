const DEFAULT_LOCK_DURATION_MS = 300000;
const DEFAULT_STALLED_INTERVAL_MS = 60000;
const DEFAULT_MAX_STALLED_COUNT = 1;

function readPositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function readNonNegativeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function getBullQueueSettings() {
  return {
    lockDuration: readPositiveNumber(
      process.env.BULL_LOCK_DURATION_MS,
      DEFAULT_LOCK_DURATION_MS,
    ),
    stalledInterval: readPositiveNumber(
      process.env.BULL_STALLED_INTERVAL_MS,
      DEFAULT_STALLED_INTERVAL_MS,
    ),
    maxStalledCount: readNonNegativeNumber(
      process.env.BULL_MAX_STALLED_COUNT,
      DEFAULT_MAX_STALLED_COUNT,
    ),
  };
}

module.exports = {
  DEFAULT_LOCK_DURATION_MS,
  DEFAULT_STALLED_INTERVAL_MS,
  DEFAULT_MAX_STALLED_COUNT,
  getBullQueueSettings,
};
