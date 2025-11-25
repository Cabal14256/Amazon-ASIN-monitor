import { request } from '@umijs/max';

/** 获取审计日志列表 */
export async function getAuditLogList(params: API.AuditLogListParams) {
  return request<API.Result<API.PageInfo<API.AuditLog>>>('/api/v1/audit-logs', {
    method: 'GET',
    params,
  });
}

/** 获取审计日志详情 */
export async function getAuditLogDetail(params: { id: number }) {
  return request<API.Result<API.AuditLog>>(`/api/v1/audit-logs/${params.id}`, {
    method: 'GET',
  });
}

/** 获取操作类型统计 */
export async function getActionStatistics(params?: {
  startTime?: string;
  endTime?: string;
}) {
  return request<API.Result<API.ActionStatistics[]>>(
    '/api/v1/audit-logs/statistics/actions',
    {
      method: 'GET',
      params,
    },
  );
}

/** 获取资源类型统计 */
export async function getResourceStatistics(params?: {
  startTime?: string;
  endTime?: string;
}) {
  return request<API.Result<API.ResourceStatistics[]>>(
    '/api/v1/audit-logs/statistics/resources',
    {
      method: 'GET',
      params,
    },
  );
}
