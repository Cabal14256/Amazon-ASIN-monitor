/* eslint-disable */
import { request } from '@umijs/max';

/** 检查变体组 */
export async function checkVariantGroup(
  params: {
    groupId: string;
    forceRefresh?: boolean;
  },
  options?: { [key: string]: any },
) {
  const { groupId: param0, forceRefresh } = params;
  return request<API.Result_any_>(`/api/v1/variant-groups/${param0}/check`, {
    method: 'POST',
    params: {
      forceRefresh: forceRefresh !== false, // 默认为 true，立即检查时强制刷新
    },
    ...(options || {}),
  });
}

/** 检查单个ASIN */
export async function checkASIN(
  params: {
    asinId: string;
    forceRefresh?: boolean;
  },
  options?: { [key: string]: any },
) {
  const { asinId: param0, forceRefresh } = params;
  return request<API.Result_any_>(`/api/v1/asins/${param0}/check`, {
    method: 'POST',
    params: {
      forceRefresh: forceRefresh !== false, // 默认为 true，立即检查时强制刷新
    },
    ...(options || {}),
  });
}

/** 批量检查变体组 */
export async function batchCheckVariantGroups(
  body: {
    groupIds: string[];
    country?: string;
  },
  options?: { [key: string]: any },
) {
  return request<API.Result_any_>('/api/v1/variant-groups/batch-check', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 批量查询ASIN的父变体 */
export async function batchQueryParentAsin(
  body: {
    asins: string[];
    country: string;
  },
  options?: { [key: string]: any },
) {
  return request<API.Result_any_>(
    '/api/v1/variant-check/batch-query-parent-asin',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      data: body,
      timeout: 300000, // 5分钟超时，因为批量查询可能需要较长时间
      ...(options || {}),
    },
  );
}
