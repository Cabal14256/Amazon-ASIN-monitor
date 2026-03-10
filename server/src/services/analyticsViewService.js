const { getPeakHours } = require('../utils/peakHours');

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function normalizeMonthToken(monthToken, fallbackDate = new Date()) {
  const fallbackYear = fallbackDate.getFullYear();
  const fallbackMonth = fallbackDate.getMonth() + 1;
  const match = String(monthToken || '').match(/^(\d{4})-(\d{2})$/);

  if (!match) {
    return {
      year: fallbackYear,
      month: fallbackMonth,
      token: `${fallbackYear}-${pad2(fallbackMonth)}`,
    };
  }

  const year = Number(match[1]) || fallbackYear;
  const month = Math.min(12, Math.max(1, Number(match[2]) || fallbackMonth));

  return {
    year,
    month,
    token: `${year}-${pad2(month)}`,
  };
}

function buildMonthlyBreakdownRows(statistics = [], monthToken) {
  const normalizedMonth = normalizeMonthToken(monthToken);
  const rowMap = new Map();

  if (Array.isArray(statistics)) {
    statistics.forEach((item) => {
      const dateKey = String(item?.time_period || '').slice(0, 10);
      if (dateKey) {
        rowMap.set(dateKey, item);
      }
    });
  }

  const daysInMonth = new Date(
    normalizedMonth.year,
    normalizedMonth.month,
    0,
  ).getDate();
  const rows = [];
  let abnormalDurationTotal = 0;
  let totalDurationTotal = 0;

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${normalizedMonth.token}-${pad2(day)}`;
    const stat = rowMap.get(date);
    const abnormalDurationHours = toNumber(
      stat?.abnormalDurationHours ?? stat?.abnormal_duration_hours,
    );
    const totalDurationHours = toNumber(
      stat?.totalDurationHours ?? stat?.total_duration_hours,
    );
    const fallbackRatio = toNumber(stat?.ratioAllTime ?? stat?.ratio_all_time);
    const abnormalDurationRate =
      totalDurationHours > 0
        ? (abnormalDurationHours / totalDurationHours) * 100
        : fallbackRatio;

    abnormalDurationTotal += abnormalDurationHours;
    totalDurationTotal += totalDurationHours;

    rows.push({
      date,
      day,
      abnormalDurationHours,
      totalDurationHours,
      abnormalDurationRate: Number.isFinite(abnormalDurationRate)
        ? abnormalDurationRate
        : 0,
    });
  }

  const averageRatio =
    totalDurationTotal > 0
      ? (abnormalDurationTotal / totalDurationTotal) * 100
      : 0;

  return {
    month: normalizedMonth.token,
    rows,
    summary: {
      abnormalDurationTotal,
      totalDurationTotal,
      averageRatio: Number.isFinite(averageRatio) ? averageRatio : 0,
    },
  };
}

function formatDateTime(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate(),
  )} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function getPeakColor(regionCode) {
  if (regionCode === 'US') {
    return 'rgba(255, 152, 0, 0.15)';
  }
  if (regionCode === 'UK') {
    return 'rgba(156, 39, 176, 0.15)';
  }
  if (regionCode === 'EU_OTHER') {
    return 'rgba(33, 150, 243, 0.15)';
  }
  return 'rgba(255, 193, 7, 0.1)';
}

function resolveRegionsToShow(country) {
  if (country) {
    if (country === 'US') {
      return [{ code: 'US', countries: ['US'] }];
    }
    if (country === 'UK') {
      return [{ code: 'UK', countries: ['UK'] }];
    }
    if (['DE', 'FR', 'ES', 'IT'].includes(country)) {
      return [{ code: 'EU_OTHER', countries: ['DE', 'FR', 'ES', 'IT'] }];
    }
    return [];
  }

  return [
    { code: 'US', countries: ['US'] },
    { code: 'UK', countries: ['UK'] },
    { code: 'EU_OTHER', countries: ['DE', 'FR', 'ES', 'IT'] },
  ];
}

function buildPeakHoursMarkAreas({
  groupBy = 'hour',
  country = '',
  startTime,
  endTime,
}) {
  if (groupBy !== 'hour') {
    return [];
  }

  const startDate = new Date(startTime);
  const endDate = new Date(endTime);
  if (
    !Number.isFinite(startDate.getTime()) ||
    !Number.isFinite(endDate.getTime())
  ) {
    return [];
  }

  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(23, 59, 59, 999);

  const regionsToShow = resolveRegionsToShow(country);
  const result = [];

  regionsToShow.forEach((region) => {
    const representativeCountry = region.countries[0];
    const peakHours = getPeakHours(representativeCountry);
    const areas = [];
    const loopDate = new Date(startDate);

    while (loopDate <= endDate) {
      peakHours.forEach((peak) => {
        const startHour = peak.start;
        const endHour = peak.end === 24 ? 0 : peak.end;
        const peakStart = new Date(loopDate);
        peakStart.setHours(startHour, 0, 0, 0);

        const peakEnd = new Date(loopDate);
        if (endHour === 0) {
          peakEnd.setDate(peakEnd.getDate() + 1);
          peakEnd.setHours(0, 0, 0, 0);
        } else {
          peakEnd.setHours(endHour, 0, 0, 0);
        }

        areas.push([
          {
            name: `${region.code}高峰期`,
            xAxis: formatDateTime(peakStart),
          },
          {
            xAxis: formatDateTime(peakEnd),
          },
        ]);
      });

      loopDate.setDate(loopDate.getDate() + 1);
    }

    if (areas.length > 0) {
      result.push({
        name: region.code,
        color: getPeakColor(region.code),
        areas,
      });
    }
  });

  return result;
}

module.exports = {
  buildMonthlyBreakdownRows,
  buildPeakHoursMarkAreas,
};
