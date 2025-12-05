/* eslint-disable */
import { request } from '@umijs/max';

/** 检查变体组 */
export async function checkCompetitorVariantGroup(
  params: {
    groupId: string;
    forceRefresh?: boolean;
  },
  options?: { [key: string]: any },
) {
  const { groupId: param0, forceRefresh } = params;
  return request<API.Result_any_>(
    `/api/v1/competitor/variant-groups/${param0}/check`,
    {
      method: 'POST',
      params: {
        forceRefresh: forceRefresh !== false, // 默认为 true，立即检查时强制刷新
      },
      ...(options || {}),
    },
  );
}

/** 检查单个ASIN */
export async function checkCompetitorASIN(
  params: {
    asinId: string;
    forceRefresh?: boolean;
  },
  options?: { [key: string]: any },
) {
  const { asinId: param0, forceRefresh } = params;
  return request<API.Result_any_>(`/api/v1/competitor/asins/${param0}/check`, {
    method: 'POST',
    params: {
      forceRefresh: forceRefresh !== false, // 默认为 true，立即检查时强制刷新
    },
    ...(options || {}),
  });
}

/** 批量检查变体组 */
export async function batchCheckCompetitorVariantGroups(
  body: {
    groupIds: string[];
    country?: string;
  },
  options?: { [key: string]: any },
) {
  return request<API.Result_any_>(
    '/api/v1/competitor/variant-groups/batch-check',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      data: body,
      ...(options || {}),
    },
  );
}
