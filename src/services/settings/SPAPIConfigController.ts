/* eslint-disable */
import { request } from '@umijs/max';

/** 获取SP-API配置（用于显示） */
export async function getSPAPIConfigs(options?: { [key: string]: any }) {
  return request<API.Result_SPAPIConfig_[]>('/api/v1/sp-api-configs', {
    method: 'GET',
    ...(options || {}),
  });
}

/** 根据键获取SP-API配置 */
export async function getSPAPIConfigByKey(
  params: {
    configKey: string;
  },
  options?: { [key: string]: any },
) {
  const { configKey: param0 } = params;
  return request<API.Result_SPAPIConfig_>(`/api/v1/sp-api-configs/${param0}`, {
    method: 'GET',
    params: { ...params },
    ...(options || {}),
  });
}

/** 更新SP-API配置 */
export async function updateSPAPIConfig(
  body: {
    configs: Array<{
      configKey: string;
      configValue: string;
      description?: string;
    }>;
  },
  options?: { [key: string]: any },
) {
  return request<API.Result_SPAPIConfig_[]>('/api/v1/sp-api-configs', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}
