import { request } from '@umijs/max';

/** 登录 POST /api/v1/auth/login */
export async function login(
  body: API.LoginParams & { rememberMe?: boolean },
  options?: { [key: string]: any },
) {
  return request<API.Result_Login_>('/api/v1/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 获取当前用户信息 GET /api/v1/auth/current-user */
export async function getCurrentUser(options?: { [key: string]: any }) {
  return request<API.Result_CurrentUser_>('/api/v1/auth/current-user', {
    method: 'GET',
    ...(options || {}),
  });
}

/** 登出 POST /api/v1/auth/logout */
export async function logout(options?: { [key: string]: any }) {
  return request<API.Result_void_>('/api/v1/auth/logout', {
    method: 'POST',
    ...(options || {}),
  });
}

/** 修改当前用户密码 POST /api/v1/auth/change-password */
export async function changePassword(
  body: { oldPassword: string; newPassword: string },
  options?: { [key: string]: any },
) {
  return request<API.Result_void_>('/api/v1/auth/change-password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 更新当前用户信息 PUT /api/v1/auth/profile */
export async function updateProfile(
  body: { email?: string; real_name?: string },
  options?: { [key: string]: any },
) {
  return request<API.Result_CurrentUser_>('/api/v1/auth/profile', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 获取当前用户会话 GET /api/v1/auth/sessions */
export async function getSessions(options?: { [key: string]: any }) {
  return request<API.Result_SessionList_>('/api/v1/auth/sessions', {
    method: 'GET',
    ...(options || {}),
  });
}

/** 踢出会话 POST /api/v1/auth/sessions/revoke */
export async function revokeSession(
  body: { sessionId: string },
  options?: { [key: string]: any },
) {
  return request<API.Result_void_>('/api/v1/auth/sessions/revoke', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}
