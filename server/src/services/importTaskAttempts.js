function attemptLimit(job) {
  const configured = Number(job?.opts?.attempts);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : 1;
}

function attemptsMade(job) {
  const count = Number(job?.attemptsMade);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

// Bull increments attemptsMade after the processor throws and before it emits
// `failed`, so the two call sites observe different counts for one failure.
function willRetryAfterFailure(job, { failureRecorded = false } = {}) {
  if (job?._discarded) return false;
  const failedAttempts = attemptsMade(job) + (failureRecorded ? 0 : 1);
  return failedAttempts < attemptLimit(job);
}

module.exports = { attemptLimit, attemptsMade, willRetryAfterFailure };
