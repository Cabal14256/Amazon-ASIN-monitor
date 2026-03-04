/// <reference lib="webworker" />

type WorkerTask = 'buildMonthlyBreakdown' | 'buildPeakMarkAreas';

type WorkerMessage = {
  requestId: number;
  task: WorkerTask;
  payload: Record<string, any>;
};

const toNumber = (value: unknown) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const formatDateTime = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}`;
};

const getPeakHours = (
  country: string,
): Array<{ start: number; end: number }> => {
  switch (country) {
    case 'US':
      return [
        { start: 2, end: 6 },
        { start: 9, end: 12 },
      ];
    case 'UK':
      return [
        { start: 22, end: 24 },
        { start: 0, end: 2 },
        { start: 3, end: 6 },
      ];
    case 'DE':
    case 'FR':
    case 'ES':
    case 'IT':
      return [
        { start: 20, end: 24 },
        { start: 2, end: 5 },
      ];
    default:
      return [];
  }
};

const resolveRegionsToShow = (country: string) => {
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
};

const getPeakColor = (regionCode: string) => {
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
};

function buildMonthlyBreakdown(payload: Record<string, any>) {
  const { list = [], monthStart } = payload;
  const monthDate = new Date(monthStart);
  if (!Number.isFinite(monthDate.getTime())) {
    throw new Error('monthStart 非法');
  }

  const rowMap = new Map<string, Record<string, any>>();
  if (Array.isArray(list)) {
    list.forEach((item) => {
      const dateKey = String(item?.time_period || '').slice(0, 10);
      if (dateKey) {
        rowMap.set(dateKey, item);
      }
    });
  }

  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const rows = [];

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateObj = new Date(year, month, day);
    const date = `${dateObj.getFullYear()}-${String(
      dateObj.getMonth() + 1,
    ).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
    const stat = rowMap.get(date);
    const brokenAsinsDedup = toNumber(stat?.broken_asins_dedup);
    const totalAsinsDedup = toNumber(stat?.total_asins_dedup);
    const fallbackRatio = toNumber(stat?.ratio_all_time);
    const brokenRatio =
      totalAsinsDedup > 0
        ? (brokenAsinsDedup / totalAsinsDedup) * 100
        : fallbackRatio;

    rows.push({
      date,
      day,
      brokenAsinsDedup,
      totalAsinsDedup,
      brokenRatio: Number.isFinite(brokenRatio) ? brokenRatio : 0,
    });
  }

  return rows;
}

function buildPeakMarkAreas(payload: Record<string, any>) {
  const { groupBy, country = '', startTimestamp, endTimestamp } = payload;
  if (groupBy !== 'hour') {
    return [];
  }

  const startDate = new Date(startTimestamp);
  const endDate = new Date(endTimestamp);
  if (
    !Number.isFinite(startDate.getTime()) ||
    !Number.isFinite(endDate.getTime())
  ) {
    return [];
  }

  const regionsToShow = resolveRegionsToShow(country);
  const markAreas: Array<{ areas: any[]; color: string; name: string }> = [];

  regionsToShow.forEach((region) => {
    const representativeCountry = region.countries[0];
    const peakHours = getPeakHours(representativeCountry);
    const areas: any[] = [];
    const peakColor = getPeakColor(region.code);

    const loopDate = new Date(startDate);
    loopDate.setHours(0, 0, 0, 0);
    const loopEndDate = new Date(endDate);
    loopEndDate.setHours(23, 59, 59, 999);

    while (loopDate <= loopEndDate) {
      peakHours.forEach((peak) => {
        const startHour = peak.start;
        const endHour = peak.end === 24 ? 0 : peak.end;

        const startTime = new Date(loopDate);
        startTime.setHours(startHour, 0, 0, 0);

        const endTime = new Date(loopDate);
        if (endHour === 0) {
          endTime.setDate(endTime.getDate() + 1);
          endTime.setHours(0, 0, 0, 0);
        } else {
          endTime.setHours(endHour, 0, 0, 0);
        }

        areas.push([
          {
            name: `${region.code}高峰期`,
            xAxis: formatDateTime(startTime),
          },
          {
            xAxis: formatDateTime(endTime),
          },
        ]);
      });

      loopDate.setDate(loopDate.getDate() + 1);
    }

    if (areas.length > 0) {
      markAreas.push({
        areas,
        color: peakColor,
        name: region.code,
      });
    }
  });

  return markAreas;
}

const taskMap: Record<WorkerTask, (payload: Record<string, any>) => any> = {
  buildMonthlyBreakdown,
  buildPeakMarkAreas,
};

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { requestId, task, payload } = event.data || {};
  try {
    const handler = taskMap[task];
    if (!handler) {
      throw new Error(`未知任务: ${task}`);
    }
    const data = handler(payload || {});
    self.postMessage({
      requestId,
      success: true,
      data,
    });
  } catch (error: any) {
    self.postMessage({
      requestId,
      success: false,
      error: error?.message || 'worker执行失败',
    });
  }
};

export {};
