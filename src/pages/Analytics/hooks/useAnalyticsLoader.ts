import analyticsServices from '@/services/analytics';
import { debugError } from '@/utils/debug';
import type { Dayjs } from 'dayjs';
import { useCallback, useEffect, useRef } from 'react';
import {
  normalizeOverviewResponse,
  normalizeTimeSlotGranularity,
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
    scheduleRetry,
  } = useAnalyticsProgress();
  const initialLoadRef = useRef<typeof loadStatistics | null>(null);

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
      periodFilter,
      periodTimeSlot,
    });

  const loadStatistics = useCallback(
    async (retryCount = 0) => {
      const daysDiff = dateRange[1].diff(dateRange[0], 'day');
      if (daysDiff > 30) {
        message.warning(
          '查询时间范围较大，可能影响加载速度，建议选择30天以内的范围',
        );
      }

      clearRetryTimer();
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
                timeSlotGranularity:
                  normalizeTimeSlotGranularity(periodTimeSlot),
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

        const results = await runTasksWithProgress(tasks);
        const failedResults = getRejectedResults(results);

        if (failedResults.length > 0) {
          const errorMessages = failedResults
            .map(extractTaskErrorMessage)
            .join('; ');
          const hasRetryableError = failedResults.some((result) =>
            isRetryableErrorMessage(extractTaskErrorMessage(result)),
          );
          const maxRetries = 3;

          if (hasRetryableError && retryCount < maxRetries) {
            const delay = (retryCount + 1) * 2000;
            message.warning(
              `数据加载部分失败，${delay / 1000}秒后自动重试 (${
                retryCount + 1
              }/${maxRetries})...`,
            );
            scheduleRetry(() => {
              void loadStatistics(retryCount + 1);
            }, delay);
            return;
          }

          if (failedResults.length === results.length) {
            throw new Error(`所有数据加载失败: ${errorMessages}`);
          }

          message.warning(
            `部分数据加载失败 (${failedResults.length}/${results.length})，将显示可用数据`,
          );
        }

        const overviewResult = results[0];
        const periodDataResult = results[1];
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
        debugError('加载统计数据失败:', error);
        const errorMessage =
          error instanceof Error ? error.message : '未知错误';
        const maxRetries = 3;
        if (isRetryableErrorMessage(errorMessage) && retryCount < maxRetries) {
          const delay = (retryCount + 1) * 2000;
          message.warning(
            `数据加载失败，${delay / 1000}秒后自动重试 (${
              retryCount + 1
            }/${maxRetries})...`,
          );
          scheduleRetry(() => {
            void loadStatistics(retryCount + 1);
          }, delay);
          return;
        }

        message.error(
          `加载统计数据失败${retryCount > 0 ? '（已重试）' : ''}，请稍后重试`,
        );
      }
    },
    [
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
      runTasksWithProgress,
      scheduleRetry,
      setPeriodSummary,
    ],
  );

  useEffect(() => {
    initialLoadRef.current = loadStatistics;
  }, [loadStatistics]);

  useEffect(() => {
    if (initialLoadRef.current) {
      void initialLoadRef.current();
    }
  }, []);

  return {
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
