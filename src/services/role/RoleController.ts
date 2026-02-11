import { request } from '@umijs/max';

/** 获取角色列表 GET /api/v1/roles */
export async function getRoleList(options?: { [key: string]: any }) {
  return request<API.Result_RoleList_>('/api/v1/roles', {
    method: 'GET',
    ...(options || {}),
  });
}

/** 获取角色详情 GET /api/v1/roles/:roleId */
export async function getRoleDetail(
  roleId: string,
  options?: { [key: string]: any },
) {
  return request<API.Result_RoleList_>(`/api/v1/roles/${roleId}`, {
    method: 'GET',
    ...(options || {}),
  });
}

/** 获取权限列表 GET /api/v1/permissions */
export async function getPermissionList(options?: { [key: string]: any }) {
  return request<API.Result_PermissionList_>('/api/v1/permissions', {
    method: 'GET',
    ...(options || {}),
  });
}

/** 更新角色权限 PUT /api/v1/roles/:roleId/permissions */
export async function updateRolePermissions(
  roleId: string,
  body: { permissionIds: string[] },
  options?: { [key: string]: any },
) {
  return request<API.Result_void_>(`/api/v1/roles/${roleId}/permissions`, {
    method: 'PUT',
    data: body,
    ...(options || {}),
  });
}
