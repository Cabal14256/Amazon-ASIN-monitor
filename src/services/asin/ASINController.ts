/* eslint-disable */
// ASIN 管理服务接口
import { request } from '@umijs/max';

/** 查询变体组列表（树形结构） */
export async function queryVariantGroupList(
  params: {
    // query
    /** 关键词搜索 */
    keyword?: string;
    /** 国家筛选 */
    country?: string;
    /** 变体状态筛选 */
    variantStatus?: string;
    /** 当前页 */
    current?: number;
    /** 每页数量 */
    pageSize?: number;
  },
  options?: { [key: string]: any },
) {
  return request<API.Result_PageInfo_VariantGroup__>('/api/v1/variant-groups', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

/** 获取变体组详情 */
export async function getVariantGroupDetail(
  params: {
    // path
    /** 变体组ID */
    groupId?: string;
  },
  options?: { [key: string]: any },
) {
  const { groupId: param0 } = params;
  return request<API.Result_VariantGroup_>(`/api/v1/variant-groups/${param0}`, {
    method: 'GET',
    params: { ...params },
    ...(options || {}),
  });
}

/** 创建变体组 */
export async function addVariantGroup(
  body?: API.VariantGroupVO,
  options?: { [key: string]: any },
) {
  return request<API.Result_VariantGroup_>('/api/v1/variant-groups', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 更新变体组 */
export async function modifyVariantGroup(
  params: {
    // path
    /** 变体组ID */
    groupId?: string;
  },
  body?: API.VariantGroupVO,
  options?: { [key: string]: any },
) {
  const { groupId: param0 } = params;
  return request<API.Result_VariantGroup_>(`/api/v1/variant-groups/${param0}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    params: { ...params },
    data: body,
    ...(options || {}),
  });
}

/** 删除变体组 */
export async function deleteVariantGroup(
  params: {
    // path
    /** 变体组ID */
    groupId?: string;
  },
  options?: { [key: string]: any },
) {
  const { groupId: param0 } = params;
  return request<API.Result_string_>(`/api/v1/variant-groups/${param0}`, {
    method: 'DELETE',
    params: { ...params },
    ...(options || {}),
  });
}

/** 添加ASIN到变体组 */
export async function addASIN(
  body?: API.ASINInfoVO,
  options?: { [key: string]: any },
) {
  return request<API.Result_ASINInfo_>('/api/v1/asins', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 更新ASIN */
export async function modifyASIN(
  params: {
    // path
    /** ASIN ID */
    asinId?: string;
  },
  body?: API.ASINInfoVO,
  options?: { [key: string]: any },
) {
  const { asinId: param0 } = params;
  return request<API.Result_ASINInfo_>(`/api/v1/asins/${param0}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    params: { ...params },
    data: body,
    ...(options || {}),
  });
}

/** 删除ASIN */
export async function deleteASIN(
  params: {
    // path
    /** ASIN ID */
    asinId?: string;
  },
  options?: { [key: string]: any },
) {
  const { asinId: param0 } = params;
  return request<API.Result_string_>(`/api/v1/asins/${param0}`, {
    method: 'DELETE',
    params: { ...params },
    ...(options || {}),
  });
}

/** 移动ASIN到其他变体组 */
export async function moveASIN(
  params: {
    // path
    /** ASIN ID */
    asinId?: string;
  },
  body?: {
    /** 目标变体组ID */
    targetGroupId?: string;
  },
  options?: { [key: string]: any },
) {
  const { asinId: param0 } = params;
  return request<API.Result_ASINInfo_>(`/api/v1/asins/${param0}/move`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    params: { ...params },
    data: body,
    ...(options || {}),
  });
}

/** 更新ASIN飞书通知开关 */
export async function updateASINFeishuNotify(
  params: {
    // path
    /** ASIN ID */
    asinId?: string;
  },
  body?: {
    /** 是否启用：true-开启，false-关闭 */
    enabled?: boolean;
  },
  options?: { [key: string]: any },
) {
  const { asinId: param0 } = params;
  return request<API.Result_ASINInfo_>(
    `/api/v1/asins/${param0}/feishu-notify`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      params: { ...params },
      data: body,
      ...(options || {}),
    },
  );
}

/** 更新变体组飞书通知开关 */
export async function updateVariantGroupFeishuNotify(
  params: {
    // path
    /** 变体组ID */
    groupId?: string;
  },
  body?: {
    /** 是否启用：true-开启，false-关闭 */
    enabled?: boolean;
  },
  options?: { [key: string]: any },
) {
  const { groupId: param0 } = params;
  return request<API.Result_VariantGroup_>(
    `/api/v1/variant-groups/${param0}/feishu-notify`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      params: { ...params },
      data: body,
      ...(options || {}),
    },
  );
}

/** Excel导入变体组和ASIN */
export async function importFromExcel(
  formData: FormData,
  options?: { [key: string]: any },
) {
  return request<API.Result_ImportResult_>(
    '/api/v1/variant-groups/import-excel',
    {
      method: 'POST',
      data: formData,
      requestType: 'form',
      // 不设置Content-Type，让浏览器自动设置multipart/form-data边界
      headers: {},
      ...(options || {}),
    },
  );
}
