/* eslint-disable */
import { request } from '@umijs/max';

/** 检查变体组 */
export async function checkVariantGroup(
  params: {
    groupId: string;
  },
  options?: { [key: string]: any },
) {
  const { groupId: param0 } = params;
  return request<API.Result_any_>(`/api/v1/variant-groups/${param0}/check`, {
    method: 'POST',
    params: { ...params },
    ...(options || {}),
  });
}

/** 检查单个ASIN */
export async function checkASIN(
  params: {
    asinId: string;
  },
  options?: { [key: string]: any },
) {
  const { asinId: param0 } = params;
  return request<API.Result_any_>(`/api/v1/asins/${param0}/check`, {
    method: 'POST',
    params: { ...params },
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
