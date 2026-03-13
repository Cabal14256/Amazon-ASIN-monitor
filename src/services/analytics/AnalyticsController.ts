import { request } from '@umijs/max';

export async function getOverview(
  params: {
    country?: string;
    startTime: string;
    endTime: string;
    groupBy?: 'hour' | 'day' | 'week' | 'month';
    timeSlotGranularity?: 'hour' | 'day';
    allCountriesTimeSlotGranularity?: 'hour' | 'day';
    regionTimeSlotGranularity?: 'hour' | 'day';
    variantGroupLimit?: number;
  },
  options?: { [key: string]: any },
) {
  return request<any>('/api/v1/analytics/overview', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

export async function getMonitorHistorySummary(
  params: {
    variantGroupId?: string;
    asinId?: string;
    country?: string;
    checkType?: string;
    startTime?: string;
    endTime?: string;
  },
  options?: { [key: string]: any },
) {
  return request<any>('/api/v1/analytics/monitor-history/summary', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

export async function getMonitorHistoryPeakHours(
  params: {
    country: string;
    checkType?: string;
    startTime?: string;
    endTime?: string;
  },
  options?: { [key: string]: any },
) {
  return request<any>('/api/v1/analytics/monitor-history/peak-hours', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

export async function getPeriodSummary(
  params: {
    country?: string;
    site?: string;
    brand?: string;
    startTime?: string;
    endTime?: string;
    timeSlotGranularity?: 'hour' | 'day';
    current?: number;
    pageSize?: number;
  },
  options?: { [key: string]: any },
) {
  return request<any>('/api/v1/analytics/period-summary', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

export async function getPeriodSummaryTimeSlotDetails(
  params: {
    country?: string;
    site?: string;
    brand?: string;
    startTime?: string;
    endTime?: string;
    timeSlotGranularity?: 'hour' | 'day';
  },
  options?: { [key: string]: any },
) {
  return request<any>('/api/v1/analytics/period-summary/details', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

export async function getMonthlyBreakdown(
  params: {
    country?: string;
    month?: string;
    startTime?: string;
    endTime?: string;
  },
  options?: { [key: string]: any },
) {
  return request<any>('/api/v1/analytics/monthly-breakdown', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}
