const DEFAULT_API_BASE_URL = '/api';
const API_SUFFIX_PATTERN = /\/api(?:\/(?:api|v\d+))*$/i;
const ABSOLUTE_URL_PATTERN = /^(?:[a-z][a-z\d+.-]*:)?\/\//i;
const VERSION_SEGMENT_PATTERN = /^v\d+$/i;

/**
 * 去掉基础地址末尾多余的斜杠；空配置回退到同源 /api。
 */
export function normalizeBaseURL(baseURL?: string | null): string {
  const normalized = String(baseURL || DEFAULT_API_BASE_URL).trim();
  if (normalized === '/') {
    return '';
  }
  return normalized.replace(/\/+$/, '');
}

/**
 * 将 API_BASE_URL 归一为部署根地址。
 *
 * API_BASE_URL 可以是站点源地址，也可以兼容以 /api、/api/v1 结尾的旧配置；
 * 请求路径会由 normalizeApiPath 统一补上唯一的 /api 前缀。
 */
export function resolveApiBaseURL(baseURL?: string | null): string {
  const normalizedBaseURL = normalizeBaseURL(baseURL);
  const absoluteBaseMatch = normalizedBaseURL.match(
    /^((?:[a-z][a-z\d+.-]*:)?\/\/[^/]+)(\/.*)?$/i,
  );

  if (absoluteBaseMatch) {
    const [, origin, pathname = ''] = absoluteBaseMatch;
    return `${origin}${pathname.replace(API_SUFFIX_PATTERN, '')}`;
  }

  return normalizedBaseURL.replace(API_SUFFIX_PATTERN, '');
}

/**
 * 将 /v1/...、/api/v1/... 及历史重复前缀统一为 /api/v1/...。
 */
export function normalizeApiPath(path: string): string {
  const trimmedPath = String(path || '').trim();
  if (ABSOLUTE_URL_PATTERN.test(trimmedPath)) {
    throw new Error('API 请求路径必须使用相对地址');
  }

  const suffixIndex = trimmedPath.search(/[?#]/);
  const pathname =
    suffixIndex >= 0 ? trimmedPath.slice(0, suffixIndex) : trimmedPath;
  const suffix = suffixIndex >= 0 ? trimmedPath.slice(suffixIndex) : '';
  const hasTrailingSlash = pathname.length > 1 && pathname.endsWith('/');
  const segments = pathname.split('/').filter(Boolean);

  let cursor = 0;
  let versionSegment: string | undefined;
  while (cursor < segments.length) {
    const segment = segments[cursor];
    if (segment.toLowerCase() === 'api') {
      cursor += 1;
      continue;
    }
    if (
      VERSION_SEGMENT_PATTERN.test(segment) &&
      (!versionSegment ||
        segment.toLowerCase() === versionSegment.toLowerCase())
    ) {
      versionSegment = segment.toLowerCase();
      cursor += 1;
      continue;
    }
    break;
  }

  const normalizedSegments = [
    'api',
    ...(versionSegment ? [versionSegment] : []),
    ...segments.slice(cursor),
  ];
  let normalizedPath = `/${normalizedSegments.join('/')}`;
  if (hasTrailingSlash) {
    normalizedPath += '/';
  }
  return `${normalizedPath}${suffix}`;
}

export function resolveApiRequest(
  baseURL: string | null | undefined,
  path: string,
): { baseURL: string; url: string } {
  const normalizedPath = normalizeApiPath(path);
  return {
    baseURL: resolveApiBaseURL(baseURL),
    url: normalizedPath,
  };
}

/**
 * 请求层与 fetch/导出层共用的唯一 URL 合并入口。
 * endpoint 必须是相对路径，避免下载重定向把认证信息发送到未授权来源。
 */
export function buildApiURL(
  baseURL: string | null | undefined,
  path: string,
): string {
  const resolved = resolveApiRequest(baseURL, path);
  return `${resolved.baseURL}${resolved.url}`;
}
