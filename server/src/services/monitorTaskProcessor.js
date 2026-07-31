const logger = require('../utils/logger');
const { evaluateScheduledJobFreshness } = require('./monitorQueuePolicy');

function getCompetitorFollowUp(jobData) {
  const followUp = jobData?.followUp;
  if (
    followUp?.type !== 'competitor' ||
    !Array.isArray(followUp.countries) ||
    followUp.countries.length === 0
  ) {
    return null;
  }

  return followUp;
}

async function processMonitorTaskJob(
  job,
  {
    runMonitorTask,
    enqueueCompetitor,
    getCurrentTimestamp = () => new Date().toISOString(),
  },
) {
  const jobData = job?.data || {};
  const { countries, batchConfig } = jobData;
  if (!countries || countries.length === 0) {
    return undefined;
  }

  const followUp =
    jobData.source === 'scheduled' ? getCompetitorFollowUp(jobData) : null;
  const freshness = evaluateScheduledJobFreshness(jobData, job.timestamp);
  if (!jobData.standardCompleted && freshness.stale) {
    logger.warn('[监控任务队列] 跳过过期定时任务', {
      jobId: String(job.id),
      countries,
      reason: freshness.reason,
      ageMs: freshness.ageMs,
      maxAgeMs: freshness.maxAgeMs,
    });
    return {
      skipped: true,
      reason: freshness.reason,
      ageMs: freshness.ageMs,
    };
  }

  const shouldWaitForDeferred = Boolean(followUp);
  let followUpRequestedAt = jobData.followUpRequestedAt || null;
  let result;

  if (!jobData.standardCompleted) {
    result = shouldWaitForDeferred
      ? await runMonitorTask(countries, batchConfig, {
          waitForDeferred: true,
        })
      : await runMonitorTask(countries, batchConfig);

    if (followUp) {
      followUpRequestedAt = getCurrentTimestamp();
      await job.update({
        ...jobData,
        standardCompleted: true,
        followUpRequestedAt,
      });
    }
  }

  if (!followUp) {
    return result;
  }

  if (!followUpRequestedAt) {
    followUpRequestedAt = getCurrentTimestamp();
    await job.update({
      ...jobData,
      standardCompleted: true,
      followUpRequestedAt,
    });
  }

  await enqueueCompetitor(followUp.countries, followUp.batchConfig || null, {
    source: followUp.source || jobData.source || 'scheduled',
    requestedAt: followUpRequestedAt,
  });

  logger.info('[监控任务队列] 标准监控已结束，竞品监控已进入队列', {
    jobId: String(job.id),
    countries: followUp.countries,
  });

  return {
    ...(result || {}),
    standardCompleted: true,
    competitorFollowUpEnqueued: true,
  };
}

module.exports = {
  getCompetitorFollowUp,
  processMonitorTaskJob,
};
