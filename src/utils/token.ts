export const TOKEN_KEY = 'token';
export const REMEMBER_ME_KEY = 'rememberMe';
export const AUTH_SESSION_KEY = 'authSession';
export const AUTH_HINT_COOKIE_NAME = 'amazon_asin_monitor_session';

function setAuthHintCookie() {
  if (typeof document === 'undefined') {
    return;
  }
  document.cookie = `${AUTH_HINT_COOKIE_NAME}=1; path=/; samesite=lax`;
}

function clearAuthHintCookie() {
  if (typeof document === 'undefined') {
    return;
  }
  document.cookie = `${AUTH_HINT_COOKIE_NAME}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; samesite=lax`;
}

function hasAuthHintCookie() {
  if (typeof document === 'undefined') {
    return false;
  }

  return document.cookie
    .split(';')
    .map((item) => item.trim())
    .some((item) => item.startsWith(`${AUTH_HINT_COOKIE_NAME}=`));
}

export function setToken(token: string, rememberMe = true) {
  if (rememberMe) {
    localStorage.setItem(AUTH_SESSION_KEY, '1');
    localStorage.setItem(REMEMBER_ME_KEY, '1');
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(AUTH_SESSION_KEY);
  } else {
    sessionStorage.setItem(AUTH_SESSION_KEY, '1');
    localStorage.removeItem(AUTH_SESSION_KEY);
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.setItem(REMEMBER_ME_KEY, '0');
  }
  setAuthHintCookie();
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
}

export function hasAuthSession() {
  return Boolean(
    getToken() ||
      localStorage.getItem(AUTH_SESSION_KEY) ||
      sessionStorage.getItem(AUTH_SESSION_KEY) ||
      hasAuthHintCookie(),
  );
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(AUTH_SESSION_KEY);
  localStorage.removeItem(REMEMBER_ME_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(AUTH_SESSION_KEY);
  clearAuthHintCookie();
}

export function isRemembered() {
  return localStorage.getItem(REMEMBER_ME_KEY) === '1';
}
