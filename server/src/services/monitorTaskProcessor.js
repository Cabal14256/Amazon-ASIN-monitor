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
  { runMonitorTask, enqueueCompetitor },
) {
  const jobData = job?.data || {};
  const { countries, batchConfig } = jobData;
  if (!countries || countries.length === 0) {
    return undefined;
  }

  const freshness = evaluateScheduledJobFreshness(jobData, job.timestamp);
  if (freshness.stale) {
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

  const followUp = getCompetitorFollowUp(jobData);
  let result;

  if (!jobData.standardCompleted) {
    result = await runMonitorTask(countries, batchConfig);

    if (followUp) {
      await job.update({
        ...jobData,
        standardCompleted: true,
      });
    }
  }

  if (!followUp) {
    return result;
  }

  await enqueueCompetitor(followUp.countries, followUp.batchConfig || null, {
    source: followUp.source || jobData.source || 'scheduled',
    requestedAt: followUp.requestedAt || jobData.requestedAt,
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
