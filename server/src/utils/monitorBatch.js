function normalizePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function calculateScheduledBatchIndex(date, intervalMinutes, totalBatches) {
  const batches = normalizePositiveInteger(totalBatches, 1);
  if (batches <= 1) {
    return 0;
  }

  const interval = normalizePositiveInteger(intervalMinutes, 1);
  const timestamp =
    date instanceof Date ? date.getTime() : new Date(date).getTime();
  if (!Number.isFinite(timestamp)) {
    throw new TypeError('date 必须是有效时间');
  }

  const scheduleSlot = Math.floor(timestamp / (interval * 60 * 1000));
  return ((scheduleSlot % batches) + batches) % batches;
}

function calculateFullSweepIntervalMinutes(intervalMinutes, totalBatches) {
  const interval = normalizePositiveInteger(intervalMinutes, 1);
  const batches = normalizePositiveInteger(totalBatches, 1);
  return interval * batches;
}

module.exports = {
  calculateScheduledBatchIndex,
  calculateFullSweepIntervalMinutes,
};
