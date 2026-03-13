function buildEmptyDurationMetrics() {
  return {
    totalDurationHours: 0,
    abnormalDurationHours: 0,
    normalDurationHours: 0,
    ratioAllAsin: 0,
    ratioAllTime: 0,
    globalPeakRate: 0,
    globalLowRate: 0,
    ratioHigh: 0,
    ratioLow: 0,
    totalChecks: 0,
    brokenCount: 0,
    totalAsinsDedup: 0,
    brokenAsinsDedup: 0,
    peakDurationHours: 0,
    peakAbnormalDurationHours: 0,
    lowDurationHours: 0,
    lowAbnormalDurationHours: 0,
  };
}

function buildPeriodSummaryGroupKey(country = '', site = '', brand = '') {
  return [country || '', site || '', brand || ''].join('|');
}

module.exports = {
  buildEmptyDurationMetrics,
  buildPeriodSummaryGroupKey,
};
