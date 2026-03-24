import type {
  AnalyticsOverviewData,
  AnalyticsResponseLike,
  TimeSlotGranularity,
} from './types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const createEmptyOverviewData = (): AnalyticsOverviewData => ({
  allCountriesSummary: null,
  countryDuration: [],
  overallStatistics: {},
  peakHoursStatistics: null,
  peakMarkAreas: [],
  regionSummary: [],
  timeSeries: [],
  variantGroupTop: [],
});

export const unwrapAnalyticsResponse = <T>(
  result: AnalyticsResponseLike<T> | unknown,
  fallback: T,
): {
  data: T;
  meta?: API.AnalyticsResponseMeta;
} => {
  if (isRecord(result) && 'success' in result) {
    return {
      data: (result.data ?? fallback) as T,
      meta:
        'meta' in result
          ? (result.meta as API.AnalyticsResponseMeta | undefined)
          : undefined,
    };
  }

  if (isRecord(result) && ('data' in result || 'meta' in result)) {
    return {
      data: ((result.data as T | undefined) ?? fallback) as T,
      meta:
        'meta' in result
          ? (result.meta as API.AnalyticsResponseMeta | undefined)
          : undefined,
    };
  }

  return {
    data: ((result as T | null | undefined) ?? fallback) as T,
    meta: undefined,
  };
};

export const normalizePeriodSummaryResponse = (
  result: unknown,
  fallbackCurrent: number,
  fallbackPageSize: number,
) => {
  const fallback = {
    list: [] as API.PeriodSummary[],
    total: 0,
    current: fallbackCurrent,
    pageSize: fallbackPageSize,
  };

  const payload = unwrapAnalyticsResponse<{
    current?: number;
    list?: API.PeriodSummary[];
    pageSize?: number;
    total?: number;
  }>(result, fallback).data;

  if (!isRecord(payload) || !Array.isArray(payload.list)) {
    return fallback;
  }

  return {
    list: payload.list,
    total: Number(payload.total) || 0,
    current: Number(payload.current) || fallbackCurrent,
    pageSize: Number(payload.pageSize) || fallbackPageSize,
  };
};

export const normalizeOverviewResponse = (
  result: AnalyticsResponseLike<AnalyticsOverviewData> | unknown,
): AnalyticsOverviewData => {
  const payload = unwrapAnalyticsResponse<AnalyticsOverviewData>(
    result,
    createEmptyOverviewData(),
  ).data;

  return {
    allCountriesSummary:
      payload?.allCountriesSummary &&
      typeof payload.allCountriesSummary === 'object'
        ? payload.allCountriesSummary
        : null,
    countryDuration: Array.isArray(payload?.countryDuration)
      ? payload.countryDuration
      : [],
    overallStatistics:
      payload?.overallStatistics &&
      typeof payload.overallStatistics === 'object'
        ? payload.overallStatistics
        : {},
    peakHoursStatistics:
      payload?.peakHoursStatistics &&
      typeof payload.peakHoursStatistics === 'object'
        ? payload.peakHoursStatistics
        : null,
    peakMarkAreas: Array.isArray(payload?.peakMarkAreas)
      ? payload.peakMarkAreas
      : [],
    regionSummary: Array.isArray(payload?.regionSummary)
      ? payload.regionSummary
      : [],
    timeSeries: Array.isArray(payload?.timeSeries) ? payload.timeSeries : [],
    variantGroupTop: Array.isArray(payload?.variantGroupTop)
      ? payload.variantGroupTop
      : [],
  };
};

export const normalizeTimeSlotGranularity = (
  value?: string,
): TimeSlotGranularity => (value === 'day' ? 'day' : 'hour');
