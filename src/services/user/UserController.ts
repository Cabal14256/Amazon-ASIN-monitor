import { request } from '@umijs/max';

/** 获取用户列表 GET /api/v1/users */
export async function getUserList(
  params: API.UserListParams,
  options?: { [key: string]: any },
) {
  return request<API.Result_UserList_>('/api/v1/users', {
    method: 'GET',
    params,
    ...(options || {}),
  });
}

/** 获取用户详情 GET /api/v1/users/:userId */
export async function getUserDetail(
  userId: string,
  options?: { [key: string]: any },
) {
  return request<API.Result_UserDetail_>(`/api/v1/users/${userId}`, {
    method: 'GET',
    ...(options || {}),
  });
}

/** 创建用户 POST /api/v1/users */
export async function createUser(
  body: API.CreateUserParams,
  options?: { [key: string]: any },
) {
  return request<API.Result_UserDetail_>('/api/v1/users', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 更新用户 PUT /api/v1/users/:userId */
export async function updateUser(
  userId: string,
  body: API.UpdateUserParams,
  options?: { [key: string]: any },
) {
  return request<API.Result_UserDetail_>(`/api/v1/users/${userId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 删除用户 DELETE /api/v1/users/:userId */
export async function deleteUser(
  userId: string,
  options?: { [key: string]: any },
) {
  return request<API.Result_void_>(`/api/v1/users/${userId}`, {
    method: 'DELETE',
    ...(options || {}),
  });
}

/** 修改用户密码 PUT /api/v1/users/:userId/password */
export async function updateUserPassword(
  userId: string,
  body: API.UpdatePasswordParams,
  options?: { [key: string]: any },
) {
  return request<API.Result_void_>(`/api/v1/users/${userId}/password`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 获取所有角色 GET /api/v1/users/roles/all */
export async function getAllRoles(options?: { [key: string]: any }) {
  return request<API.Result_RoleList_>('/api/v1/users/roles/all', {
    method: 'GET',
    ...(options || {}),
  });
}
