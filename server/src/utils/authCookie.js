const AUTH_COOKIE_NAME =
  process.env.AUTH_COOKIE_NAME || 'amazon_asin_monitor_auth';
const AUTH_HINT_COOKIE_NAME =
  process.env.AUTH_HINT_COOKIE_NAME || 'amazon_asin_monitor_session';

function parseCookieHeader(cookieHeader = '') {
  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const separatorIndex = part.indexOf('=');
      if (separatorIndex < 0) {
        return acc;
      }

      const key = part.slice(0, separatorIndex).trim();
      const value = part.slice(separatorIndex + 1).trim();
      if (!key) {
        return acc;
      }

      try {
        acc[key] = decodeURIComponent(value);
      } catch (error) {
        acc[key] = value;
      }
      return acc;
    }, {});
}

function getCookieOptions(req, maxAge) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)[0];
  const secure = Boolean(req.secure || forwardedProto === 'https');

  const options = {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
  };

  if (Number.isFinite(maxAge) && maxAge > 0) {
    options.maxAge = maxAge;
  }

  return options;
}

function setAuthCookies(res, req, token, maxAge) {
  const authOptions = getCookieOptions(req, maxAge);
  const hintOptions = {
    ...authOptions,
    httpOnly: false,
  };

  res.cookie(AUTH_COOKIE_NAME, token, authOptions);
  res.cookie(AUTH_HINT_COOKIE_NAME, '1', hintOptions);
}

function clearAuthCookies(res, req) {
  const authOptions = getCookieOptions(req);
  const hintOptions = {
    ...authOptions,
    httpOnly: false,
  };

  res.clearCookie(AUTH_COOKIE_NAME, authOptions);
  res.clearCookie(AUTH_HINT_COOKIE_NAME, hintOptions);
}

function readAuthToken(req) {
  const cookies = parseCookieHeader(req.headers.cookie || '');
  if (cookies[AUTH_COOKIE_NAME]) {
    return cookies[AUTH_COOKIE_NAME];
  }

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }

  return null;
}

module.exports = {
  AUTH_COOKIE_NAME,
  AUTH_HINT_COOKIE_NAME,
  parseCookieHeader,
  setAuthCookies,
  clearAuthCookies,
  readAuthToken,
};
