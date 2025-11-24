import { request } from '@umijs/max';

/** 登录 POST /api/v1/auth/login */
export async function login(body: API.LoginParams, options?: { [key: string]: any }) {
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
