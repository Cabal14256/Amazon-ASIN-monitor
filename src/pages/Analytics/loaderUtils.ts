import {
  createEmptyOverviewData,
  normalizeOverviewResponse,
  unwrapAnalyticsResponse,
} from './helpers';
import type { AnalyticsOverviewData, PeriodSummaryState } from './types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const getRejectedResults = <T>(
  results: PromiseSettledResult<T>[],
): PromiseRejectedResult[] =>
  results.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );

export const extractTaskErrorMessage = (result: PromiseRejectedResult) =>
  result.reason instanceof Error ? result.reason.message : '未知错误';

export const extractPeriodSummaryTotal = (result: unknown): number | null => {
  if (!isRecord(result)) {
    return null;
  }

  const data =
    'success' in result
      ? result.success
        ? result.data
        : null
      : 'data' in result
      ? result.data
      : result;

  if (!isRecord(data) || !('total' in data)) {
    return null;
  }

  const total = Number(data.total);
  return Number.isFinite(total) && total > 0 ? total : null;
};

export const resolveOverviewData = (
  result?: PromiseSettledResult<unknown>,
): AnalyticsOverviewData =>
  result?.status === 'fulfilled'
    ? normalizeOverviewResponse(result.value)
    : createEmptyOverviewData();

export const resolvePeriodSummaryState = (
  result: PromiseSettledResult<unknown> | undefined,
  fallback: PeriodSummaryState,
): PeriodSummaryState => {
  if (result?.status !== 'fulfilled') {
    return fallback;
  }

  const payload = unwrapAnalyticsResponse<{
    current?: number;
    list?: API.PeriodSummary[];
    pageSize?: number;
    total?: number;
  }>(result.value, fallback);
  const normalizedData = payload.data || {};

  return {
    list: normalizedData.list || [],
    total: normalizedData.total || 0,
    current: normalizedData.current || fallback.current,
    pageSize: normalizedData.pageSize || fallback.pageSize,
  };
};
