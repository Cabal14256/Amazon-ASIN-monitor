import analyticsServices from '@/services/analytics';
import { debugError } from '@/utils/debug';
import type { Dayjs } from 'dayjs';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createEmptyOverviewData,
  normalizeOverviewResponse,
  normalizeTimeSlotGranularity,
  unwrapAnalyticsResponse,
} from '../helpers';
import {
  extractPeriodSummaryTotal,
  extractTaskErrorMessage,
  getRejectedResults,
  resolveOverviewData,
  resolvePeriodSummaryState,
} from '../loaderUtils';
import type { PeriodFilter, TimeSlotGranularity } from '../types';
import useAnalyticsOverviewState, {
  type OverviewRequestOverrides,
} from './useAnalyticsOverviewState';
import useAnalyticsPeriodSummaryState from './useAnalyticsPeriodSummaryState';
import useAnalyticsProgress, {
  type ProgressTask,
} from './useAnalyticsProgress';

const { getOverview, getPeriodSummary } = analyticsServices.AnalyticsController;

type MessageApi = {
  error: (content: string) => void;
  warning: (content: string) => void;
};

export type UseAnalyticsLoaderParams = {
  allCountriesTimeSlot: TimeSlotGranularity;
  country: string;
  dateRange: [Dayjs, Dayjs];
  groupBy: string;
  message: MessageApi;
  periodFilter: PeriodFilter;
  periodTimeSlot: TimeSlotGranularity;
  regionTimeSlot: TimeSlotGranularity;
};

type AnalyticsTaskResult = Awaited<
  ReturnType<typeof getOverview> | ReturnType<typeof getPeriodSummary>
>;

const isRetryableErrorMessage = (errorMessage: string) =>
  errorMessage.includes('timeout') ||
  errorMessage.includes('network') ||
  errorMessage.includes('ECONNRESET') ||
  errorMessage.includes('Connection lost');

const shouldShowCachedNotice = (meta?: API.AnalyticsResponseMeta) =>
  Boolean(
    meta?.busyFallback ||
      meta?.cacheHit ||
      String(meta?.source || '').startsWith('cache'),
  );

const pickNoticeMeta = (
  ...metas: Array<API.AnalyticsResponseMeta | undefined>
) => {
  const candidates = metas.filter(Boolean);
  const busyFallbackMeta = candidates.find((meta) => meta?.busyFallback);
  if (busyFallbackMeta) {
    return busyFallbackMeta;
  }

  return candidates.find((meta) => shouldShowCachedNotice(meta));
};

const buildAnalyticsNotice = (
  ...metas: Array<API.AnalyticsResponseMeta | undefined>
) => {
  const meta = pickNoticeMeta(...metas);
  if (!meta || !shouldShowCachedNotice(meta)) {
    return null;
  }

  const timeText = meta.lastUpdatedAt
    ? `，缓存时间：${meta.lastUpdatedAt}`
    : '';
  if (meta.busyFallback) {
    return {
      type: 'warning' as const,
      message: `当前数据库繁忙，已返回最近缓存结果${timeText}`,
    };
  }

  return {
    type: 'info' as const,
    message: `当前显示缓存结果${timeText}`,
  };
};

const useAnalyticsLoader = ({
  allCountriesTimeSlot,
  country,
  dateRange,
  groupBy,
  message,
  periodFilter,
  periodTimeSlot,
  regionTimeSlot,
}: UseAnalyticsLoaderParams) => {
  const {
    clearRetryTimer,
    loading,
    progress,
    progressText,
    runTasksWithProgress,
  } = useAnalyticsProgress();
  const initialLoadRef = useRef<typeof loadStatistics | null>(null);
  const activeLoadIdRef = useRef(0);
  const [latestOverviewMeta, setLatestOverviewMeta] = useState<
    API.AnalyticsResponseMeta | undefined
  >(undefined);
  const [latestPeriodMeta, setLatestPeriodMeta] = useState<
    API.AnalyticsResponseMeta | undefined
  >(undefined);

  const buildOverviewParams = useCallback(
    (overrides?: OverviewRequestOverrides) => {
      const startTime = dateRange[0].format('YYYY-MM-DD HH:mm:ss');
      const endTime = dateRange[1].format('YYYY-MM-DD HH:mm:ss');

      return {
        startTime,
        endTime,
        groupBy: groupBy as 'hour' | 'day' | 'week' | 'month',
        country: country || undefined,
        allCountriesTimeSlotGranularity: normalizeTimeSlotGranularity(
          overrides?.allCountriesTimeSlotGranularity || allCountriesTimeSlot,
        ),
        regionTimeSlotGranularity: normalizeTimeSlotGranularity(
          overrides?.regionTimeSlotGranularity || regionTimeSlot,
        ),
        variantGroupLimit: 10,
      };
    },
    [allCountriesTimeSlot, country, dateRange, groupBy, regionTimeSlot],
  );

  const loadOverviewSummaryData = useCallback(
    async (overrides?: OverviewRequestOverrides) => {
      const result = await getOverview(buildOverviewParams(overrides));
      setLatestOverviewMeta(
        unwrapAnalyticsResponse(result, normalizeOverviewResponse(result)).meta,
      );
      return normalizeOverviewResponse(result);
    },
    [buildOverviewParams],
  );

  const {
    allCountriesSummary,
    applyOverviewData,
    countryStatistics,
    overallStatistics,
    peakHoursMarkAreas,
    peakHoursStatistics,
    regionSummary,
    reloadAllCountriesSummary,
    reloadRegionSummary,
    timeStatistics,
    variantGroupStatistics,
  } = useAnalyticsOverviewState({
    country,
    groupBy,
    loadOverviewSummaryData,
    message,
  });
  const { loadPeriodSummaryTable, periodSummary, setPeriodSummary } =
    useAnalyticsPeriodSummaryState({
      dateRange,
      message,
      onMetaChange: setLatestPeriodMeta,
      periodFilter,
      periodTimeSlot,
    });

  const resetAnalyticsState = useCallback(() => {
    setLatestOverviewMeta(undefined);
    setLatestPeriodMeta(undefined);
    applyOverviewData(createEmptyOverviewData());
    setPeriodSummary((currentState) => ({
      ...currentState,
      list: [],
      total: 0,
    }));
  }, [applyOverviewData, setPeriodSummary]);

  const loadStatistics = useCallback(async () => {
    const loadId = activeLoadIdRef.current + 1;
    activeLoadIdRef.current = loadId;
    const isActiveLoad = () => activeLoadIdRef.current === loadId;
    const daysDiff = dateRange[1].diff(dateRange[0], 'day');
    if (daysDiff > 30) {
      message.warning(
        '查询时间范围较大，可能影响加载速度，建议选择30天以内的范围',
      );
    }

    clearRetryTimer();
    resetAnalyticsState();
    try {
      const startTime = dateRange[0].format('YYYY-MM-DD HH:mm:ss');
      const endTime = dateRange[1].format('YYYY-MM-DD HH:mm:ss');
      const baseParams: {
        country?: string;
        endTime: string;
        startTime: string;
      } = {
        startTime,
        endTime,
      };
      if (country) {
        baseParams.country = country;
      }

      const tasks: Array<ProgressTask<AnalyticsTaskResult>> = [
        {
          label: '总览统计',
          run: () =>
            getOverview({
              ...baseParams,
              groupBy: groupBy as 'hour' | 'day' | 'week' | 'month',
              allCountriesTimeSlotGranularity:
                normalizeTimeSlotGranularity(allCountriesTimeSlot),
              regionTimeSlotGranularity:
                normalizeTimeSlotGranularity(regionTimeSlot),
              variantGroupLimit: 10,
            }),
        },
        {
          label: '周期汇总',
          run: () =>
            getPeriodSummary({
              ...baseParams,
              ...periodFilter,
              timeSlotGranularity: normalizeTimeSlotGranularity(periodTimeSlot),
              current: periodSummary.current,
              pageSize: periodSummary.pageSize,
            }),
          updateProfile: ({ duration, previousProfile, result }) => {
            const total = extractPeriodSummaryTotal(result);
            if (!total) {
              return undefined;
            }
            const perItemMs = duration / total;
            const previousPerItem = previousProfile.avgPerItemMs;
            return {
              avgPerItemMs: previousPerItem
                ? previousPerItem * 0.7 + perItemMs * 0.3
                : perItemMs,
              lastTotal: total,
            };
          },
        },
      ];

      const resultsWithOrder = await runTasksWithProgress(tasks, {
        maxConcurrency: 1,
      });
      if (!isActiveLoad()) {
        return;
      }
      const failedResults = getRejectedResults(resultsWithOrder);

      if (failedResults.length > 0) {
        const errorMessages = failedResults
          .map(extractTaskErrorMessage)
          .join('; ');

        if (failedResults.length === resultsWithOrder.length) {
          throw new Error(`所有数据加载失败: ${errorMessages}`);
        }

        message.warning(
          `部分数据加载失败 (${failedResults.length}/${resultsWithOrder.length})，将显示可用数据`,
        );
      }

      const overviewResult = resultsWithOrder[0];
      const periodDataResult = resultsWithOrder[1];
      if (overviewResult?.status === 'fulfilled') {
        setLatestOverviewMeta(
          unwrapAnalyticsResponse(
            overviewResult.value,
            normalizeOverviewResponse(overviewResult.value),
          ).meta,
        );
      }
      if (periodDataResult?.status === 'fulfilled') {
        setLatestPeriodMeta(
          unwrapAnalyticsResponse(periodDataResult.value, {
            current: periodSummary.current,
            list: [],
            pageSize: periodSummary.pageSize,
            total: 0,
          }).meta,
        );
      }
      const overviewData = resolveOverviewData(overviewResult);
      applyOverviewData(overviewData);

      const fallbackPeriodSummary = {
        list: [],
        total: 0,
        current: periodSummary.current,
        pageSize: periodSummary.pageSize,
      };
      setPeriodSummary(
        resolvePeriodSummaryState(periodDataResult, fallbackPeriodSummary),
      );
    } catch (error) {
      if (!isActiveLoad()) {
        return;
      }
      debugError('加载统计数据失败:', error);
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      resetAnalyticsState();
      message.error(
        isRetryableErrorMessage(errorMessage)
          ? '加载统计数据失败，请手动重试'
          : '加载统计数据失败，请稍后重试',
      );
    }
  }, [
    allCountriesTimeSlot,
    applyOverviewData,
    clearRetryTimer,
    country,
    dateRange,
    groupBy,
    message,
    periodFilter,
    periodSummary.current,
    periodSummary.pageSize,
    periodTimeSlot,
    regionTimeSlot,
    resetAnalyticsState,
    runTasksWithProgress,
    setPeriodSummary,
  ]);

  useEffect(() => {
    initialLoadRef.current = loadStatistics;
  }, [loadStatistics]);

  useEffect(() => {
    if (initialLoadRef.current) {
      void initialLoadRef.current();
    }
  }, []);

  return {
    analyticsNotice: buildAnalyticsNotice(latestOverviewMeta, latestPeriodMeta),
    allCountriesSummary,
    countryStatistics,
    loadPeriodSummaryTable,
    loadStatistics,
    loading,
    overallStatistics,
    peakHoursMarkAreas,
    peakHoursStatistics,
    periodSummary,
    progress,
    progressText,
    regionSummary,
    reloadAllCountriesSummary,
    reloadRegionSummary,
    setPeriodSummary,
    timeStatistics,
    variantGroupStatistics,
  };
};

export default useAnalyticsLoader;
