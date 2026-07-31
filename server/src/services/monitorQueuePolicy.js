const DEFAULT_SCHEDULED_JOB_MAX_AGE_MS = 25 * 60 * 1000;

function getScheduledJobMaxAgeMs() {
  const configured = Number(process.env.MONITOR_SCHEDULED_JOB_MAX_AGE_MS);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured);
  }
  return DEFAULT_SCHEDULED_JOB_MAX_AGE_MS;
}

function normalizeCountries(countries) {
  return Array.isArray(countries)
    ? countries
        .map((country) =>
          String(country || '')
            .trim()
            .toUpperCase(),
        )
        .filter(Boolean)
        .sort()
    : [];
}

function getRequestedAtMs(jobData, jobTimestamp) {
  const requestedAtMs = Date.parse(jobData?.requestedAt || '');
  if (Number.isFinite(requestedAtMs)) {
    return requestedAtMs;
  }

  const timestampMs = Number(jobTimestamp);
  return Number.isFinite(timestampMs) && timestampMs > 0 ? timestampMs : null;
}

function evaluateScheduledJobFreshness(
  jobData,
  jobTimestamp,
  nowMs = Date.now(),
  maxAgeMs = getScheduledJobMaxAgeMs(),
) {
  if (jobData?.source && jobData.source !== 'scheduled') {
    return {
      stale: false,
      reason: null,
      ageMs: 0,
      maxAgeMs,
    };
  }

  const requestedAtMs = getRequestedAtMs(jobData, jobTimestamp);
  if (requestedAtMs === null) {
    return {
      stale: true,
      reason: 'missing_requested_at',
      ageMs: null,
      maxAgeMs,
    };
  }

  const ageMs = Math.max(Number(nowMs) - requestedAtMs, 0);
  return {
    stale: ageMs > maxAgeMs,
    reason: ageMs > maxAgeMs ? 'scheduled_job_expired' : null,
    ageMs,
    maxAgeMs,
  };
}

function buildScheduledJobId(queueName, taskData) {
  if (taskData?.source !== 'scheduled') {
    return null;
  }

  const requestedAtMs = getRequestedAtMs(taskData, null);
  if (requestedAtMs === null) {
    return null;
  }

  const slot = new Date(requestedAtMs)
    .toISOString()
    .slice(0, 16)
    .replace(/[-:]/g, '');
  const countries = normalizeCountries(taskData.countries).join('-') || 'none';
  const batchIndex = Number.isInteger(taskData?.batchConfig?.batchIndex)
    ? taskData.batchConfig.batchIndex
    : 0;
  const totalBatches =
    Number.isInteger(taskData?.batchConfig?.totalBatches) &&
    taskData.batchConfig.totalBatches > 0
      ? taskData.batchConfig.totalBatches
      : 1;

  return `${queueName}-scheduled-${slot}-${countries}-b${batchIndex}of${totalBatches}`;
}

module.exports = {
  DEFAULT_SCHEDULED_JOB_MAX_AGE_MS,
  getScheduledJobMaxAgeMs,
  evaluateScheduledJobFreshness,
  buildScheduledJobId,
};
