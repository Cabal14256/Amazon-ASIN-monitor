import analyticsServices from '@/services/analytics';
import { debugError } from '@/utils/debug';
import type { Dayjs } from 'dayjs';
import { useCallback, useState } from 'react';
import {
  normalizePeriodSummaryResponse,
  normalizeTimeSlotGranularity,
} from '../helpers';
import type {
  PeriodFilter,
  PeriodSummaryState,
  TimeSlotGranularity,
} from '../types';

const { getPeriodSummary } = analyticsServices.AnalyticsController;

type MessageApi = {
  error: (content: string) => void;
  warning: (content: string) => void;
};

export type UseAnalyticsPeriodSummaryStateParams = {
  dateRange: [Dayjs, Dayjs];
  message: MessageApi;
  periodFilter: PeriodFilter;
  periodTimeSlot: TimeSlotGranularity;
};

export const createInitialPeriodSummary = (): PeriodSummaryState => ({
  list: [],
  total: 0,
  current: 1,
  pageSize: 10,
});

const useAnalyticsPeriodSummaryState = ({
  dateRange,
  message,
  periodFilter,
  periodTimeSlot,
}: UseAnalyticsPeriodSummaryStateParams) => {
  const [periodSummary, setPeriodSummary] = useState<PeriodSummaryState>(
    createInitialPeriodSummary(),
  );

  const loadPeriodSummaryTable = useCallback(
    async (
      current = periodSummary.current,
      pageSize = periodSummary.pageSize,
      filter = periodFilter,
      timeSlotGranularity = periodTimeSlot,
    ) => {
      try {
        const startTime = dateRange[0].format('YYYY-MM-DD HH:mm:ss');
        const endTime = dateRange[1].format('YYYY-MM-DD HH:mm:ss');
        const result = await getPeriodSummary({
          startTime,
          endTime,
          ...filter,
          timeSlotGranularity:
            normalizeTimeSlotGranularity(timeSlotGranularity),
          current,
          pageSize,
        });
        setPeriodSummary(
          normalizePeriodSummaryResponse(result, current, pageSize),
        );
      } catch (error) {
        debugError('加载周期汇总失败:', error);
        message.error('加载周期汇总失败，请重试');
      }
    },
    [
      dateRange,
      message,
      periodFilter,
      periodSummary.current,
      periodSummary.pageSize,
      periodTimeSlot,
    ],
  );

  return {
    loadPeriodSummaryTable,
    periodSummary,
    setPeriodSummary,
  };
};

export default useAnalyticsPeriodSummaryState;
