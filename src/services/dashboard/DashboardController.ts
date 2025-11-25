import { request } from '@umijs/max';

/** 获取仪表盘数据 GET /api/v1/dashboard */
export async function getDashboardData(options?: { [key: string]: any }) {
  return request<API.Result_DashboardData_>('/api/v1/dashboard', {
    method: 'GET',
    ...(options || {}),
  });
}
