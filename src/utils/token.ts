export const TOKEN_KEY = 'token';
export const REMEMBER_ME_KEY = 'rememberMe';

export function setToken(token: string, rememberMe = true) {
  if (rememberMe) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(REMEMBER_ME_KEY, '1');
    sessionStorage.removeItem(TOKEN_KEY);
  } else {
    sessionStorage.setItem(TOKEN_KEY, token);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.setItem(REMEMBER_ME_KEY, '0');
  }
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REMEMBER_ME_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
}

export function isRemembered() {
  return localStorage.getItem(REMEMBER_ME_KEY) === '1';
}
