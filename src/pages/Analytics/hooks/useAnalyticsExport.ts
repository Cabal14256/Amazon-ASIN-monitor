import { debugError } from '@/utils/debug';
import { exportToExcel } from '@/utils/export';
import type { Dayjs } from 'dayjs';
import { useCallback } from 'react';

type MessageApi = {
  error: (content: string) => void;
};

type UseAnalyticsExportParams = {
  country: string;
  dateRange: [Dayjs, Dayjs];
  message: MessageApi;
};

type ExportFormat = 'excel' | 'csv';

const useAnalyticsExport = ({
  country,
  dateRange,
  message,
}: UseAnalyticsExportParams) =>
  useCallback(
    async (format: ExportFormat = 'excel') => {
      try {
        const startTime = dateRange[0].format('YYYY-MM-DD 00:00:00');
        const endTime = dateRange[1].format('YYYY-MM-DD 23:59:59');
        const queryParams: {
          country?: string;
          endTime: string;
          startTime: string;
        } = {
          startTime,
          endTime,
        };
        if (country) {
          queryParams.country = country;
        }

        await exportToExcel(
          '/v1/export/monitor-history',
          queryParams,
          `监控历史_${dateRange[0].format('YYYY-MM-DD')}_${dateRange[1].format(
            'YYYY-MM-DD',
          )}_${format.toUpperCase()}`,
        );
      } catch (error) {
        debugError('导出失败:', error);
        message.error('导出失败，请重试');
      }
    },
    [country, dateRange, message],
  );

export default useAnalyticsExport;
