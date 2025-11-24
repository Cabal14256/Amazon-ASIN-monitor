/* eslint-disable */
import { request } from '@umijs/max';

/** 获取所有飞书配置 */
export async function getFeishuConfigs(options?: { [key: string]: any }) {
  return request<API.Result_FeishuConfig_[]>('/api/v1/feishu-configs', {
    method: 'GET',
    ...(options || {}),
  });
}

/** 根据国家获取飞书配置 */
export async function getFeishuConfigByCountry(
  params: {
    country: string;
  },
  options?: { [key: string]: any },
) {
  const { country: param0 } = params;
  return request<API.Result_FeishuConfig_>(`/api/v1/feishu-configs/${param0}`, {
    method: 'GET',
    params: { ...params },
    ...(options || {}),
  });
}

/** 创建或更新飞书配置 */
export async function upsertFeishuConfig(
  body: {
    country: string;
    webhookUrl: string;
    enabled?: boolean;
  },
  options?: { [key: string]: any },
) {
  return request<API.Result_FeishuConfig_>('/api/v1/feishu-configs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 更新飞书配置 */
export async function updateFeishuConfig(
  params: {
    country: string;
  },
  body: {
    webhookUrl: string;
    enabled?: boolean;
  },
  options?: { [key: string]: any },
) {
  const { country: param0 } = params;
  return request<API.Result_FeishuConfig_>(`/api/v1/feishu-configs/${param0}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    params: { ...params },
    data: body,
    ...(options || {}),
  });
}

/** 删除飞书配置 */
export async function deleteFeishuConfig(
  params: {
    country: string;
  },
  options?: { [key: string]: any },
) {
  const { country: param0 } = params;
  return request<API.Result_string_>(`/api/v1/feishu-configs/${param0}`, {
    method: 'DELETE',
    params: { ...params },
    ...(options || {}),
  });
}

/** 启用/禁用飞书配置 */
export async function toggleFeishuConfig(
  params: {
    country: string;
  },
  body: {
    enabled: boolean;
  },
  options?: { [key: string]: any },
) {
  const { country: param0 } = params;
  return request<API.Result_FeishuConfig_>(
    `/api/v1/feishu-configs/${param0}/toggle`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      params: { ...params },
      data: body,
      ...(options || {}),
    },
  );
}
