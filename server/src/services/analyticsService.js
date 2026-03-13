const analyticsViewService = require('./analyticsViewService');
const analyticsQueryService = require('./analyticsQueryService');

function normalizeAnalyticsEnvelope(result) {
  return {
    data: result?.data ?? result,
    meta: result?.meta,
  };
}

function resolveMonthlyWindow({
  month = '',
  startTime: startTimeParam = '',
  endTime: endTimeParam = '',
} = {}) {
  const now = new Date();
  const fallbackMonth = `${now.getFullYear()}-${String(
    now.getMonth() + 1,
  ).padStart(2, '0')}`;
  const monthTokenCandidate = month || String(startTimeParam || '').slice(0, 7);
  const monthToken = /^\d{4}-\d{2}$/.test(monthTokenCandidate)
    ? monthTokenCandidate
    : fallbackMonth;
  const [yearText, monthText] = monthToken.split('-');
  const year = Number(yearText) || now.getFullYear();
  const monthNumber = Math.min(
    12,
    Math.max(1, Number(monthText) || now.getMonth() + 1),
  );
  const normalizedMonthToken = `${year}-${String(monthNumber).padStart(
    2,
    '0',
  )}`;
  const daysInMonth = new Date(year, monthNumber, 0).getDate();

  return {
    monthToken: normalizedMonthToken,
    startTime: startTimeParam || `${normalizedMonthToken}-01 00:00:00`,
    endTime:
      endTimeParam ||
      `${normalizedMonthToken}-${String(daysInMonth).padStart(
        2,
        '0',
      )} 23:59:59`,
  };
}

async function getOverview({
  country = '',
  startTime = '',
  endTime = '',
  groupBy = 'day',
  timeSlotGranularity = 'day',
  allCountriesTimeSlotGranularity = '',
  regionTimeSlotGranularity = '',
  variantGroupLimit = 10,
} = {}) {
  const allCountriesGranularity =
    allCountriesTimeSlotGranularity || timeSlotGranularity;
  const regionGranularity = regionTimeSlotGranularity || timeSlotGranularity;
  const tasks = [
    analyticsQueryService.getOverallStatistics({
      country,
      startTime,
      endTime,
    }),
    analyticsQueryService.getStatisticsByTime({
      country,
      startTime,
      endTime,
      groupBy,
      includeMeta: true,
    }),
    analyticsQueryService.getASINStatisticsByCountry({
      country,
      startTime,
      endTime,
      includeMeta: true,
    }),
    analyticsQueryService.getASINStatisticsByVariantGroup({
      country,
      startTime,
      endTime,
      limit: variantGroupLimit,
      includeMeta: true,
    }),
    analyticsQueryService.getAllCountriesSummary({
      startTime,
      endTime,
      timeSlotGranularity: allCountriesGranularity,
      includeMeta: true,
    }),
    analyticsQueryService.getRegionSummary({
      startTime,
      endTime,
      timeSlotGranularity: regionGranularity,
      includeMeta: true,
    }),
  ];

  if (country) {
    tasks.push(
      analyticsQueryService.getPeakHoursStatistics({
        country,
        startTime,
        endTime,
      }),
    );
  }

  const [
    overallStatistics,
    timeSeriesResult,
    countryDurationResult,
    variantGroupTopResult,
    allCountriesSummaryResult,
    regionSummaryResult,
    peakHoursStatistics,
  ] = await Promise.all(tasks);

  const timeSeries = normalizeAnalyticsEnvelope(timeSeriesResult);
  const countryDuration = normalizeAnalyticsEnvelope(countryDurationResult);
  const variantGroupTop = normalizeAnalyticsEnvelope(variantGroupTopResult);
  const allCountriesSummary = normalizeAnalyticsEnvelope(
    allCountriesSummaryResult,
  );
  const regionSummary = normalizeAnalyticsEnvelope(regionSummaryResult);

  return {
    data: {
      overallStatistics,
      timeSeries: timeSeries.data,
      countryDuration: countryDuration.data,
      variantGroupTop: variantGroupTop.data,
      allCountriesSummary: allCountriesSummary.data,
      regionSummary: regionSummary.data,
      peakHoursStatistics: peakHoursStatistics || null,
      peakMarkAreas: analyticsViewService.buildPeakHoursMarkAreas({
        groupBy,
        country,
        startTime,
        endTime,
      }),
    },
    meta: {
      timeSeries: timeSeries.meta,
      countryDuration: countryDuration.meta,
      variantGroupTop: variantGroupTop.meta,
      allCountriesSummary: allCountriesSummary.meta,
      regionSummary: regionSummary.meta,
    },
  };
}

async function getPeriodSummary(params = {}) {
  return normalizeAnalyticsEnvelope(
    await analyticsQueryService.getPeriodSummary({
      ...params,
      includeMeta: true,
    }),
  );
}

async function getPeriodSummaryTimeSlotDetails(params = {}) {
  return normalizeAnalyticsEnvelope(
    await analyticsQueryService.getPeriodSummaryTimeSlotDetails({
      ...params,
      includeMeta: true,
    }),
  );
}

async function getMonitorHistorySummary(params = {}) {
  return normalizeAnalyticsEnvelope(
    await analyticsQueryService.getOverallStatistics({
      ...params,
      includeMeta: true,
    }),
  );
}

async function getMonitorHistoryPeakHours(params = {}) {
  return normalizeAnalyticsEnvelope(
    await analyticsQueryService.getPeakHoursStatistics({
      ...params,
      includeMeta: true,
    }),
  );
}

async function getMonthlyBreakdown(params = {}) {
  const { country = '' } = params;
  const window = resolveMonthlyWindow(params);
  const statistics = normalizeAnalyticsEnvelope(
    await analyticsQueryService.getStatisticsByTime({
      country,
      startTime: window.startTime,
      endTime: window.endTime,
      groupBy: 'day',
      includeMeta: true,
      sourceGranularityOverride: 'day',
    }),
  );

  return {
    data: analyticsViewService.buildMonthlyBreakdownRows(
      statistics.data,
      window.monthToken,
    ),
    meta: statistics.meta,
  };
}

module.exports = {
  getOverview,
  getMonitorHistoryPeakHours,
  getMonitorHistorySummary,
  getPeriodSummary,
  getPeriodSummaryTimeSlotDetails,
  getMonthlyBreakdown,
  resolveMonthlyWindow,
};
