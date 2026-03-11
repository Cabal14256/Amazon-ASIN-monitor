import { request } from '@umijs/max';

export async function getOpsOverview(options?: { [key: string]: any }) {
  return request<any>('/api/v1/ops/overview', {
    method: 'GET',
    ...(options || {}),
  });
}

export async function clearAnalyticsCache(options?: { [key: string]: any }) {
  return request<any>('/api/v1/ops/analytics/cache/clear', {
    method: 'POST',
    ...(options || {}),
  });
}

export async function refreshAnalyticsAgg(
  data?: {
    granularity?: 'hour' | 'day';
    startTime?: string;
    endTime?: string;
  },
  options?: { [key: string]: any },
) {
  return request<any>('/api/v1/ops/analytics/refresh', {
    method: 'POST',
    data,
    ...(options || {}),
  });
}
