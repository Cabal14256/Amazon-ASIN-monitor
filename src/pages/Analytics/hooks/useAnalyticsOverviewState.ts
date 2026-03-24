import { debugError } from '@/utils/debug';
import { useCallback, useState } from 'react';
import type {
  AnalyticsOverviewData,
  PeakMarkArea,
  TimeSlotGranularity,
} from '../types';

type MessageApi = {
  error: (content: string) => void;
  warning: (content: string) => void;
};

export type OverviewRequestOverrides = {
  allCountriesTimeSlotGranularity?: TimeSlotGranularity;
  regionTimeSlotGranularity?: TimeSlotGranularity;
};

type UseAnalyticsOverviewStateParams = {
  country: string;
  groupBy: string;
  loadOverviewSummaryData: (
    overrides?: OverviewRequestOverrides,
  ) => Promise<AnalyticsOverviewData>;
  message: MessageApi;
};

const useAnalyticsOverviewState = ({
  country,
  groupBy,
  loadOverviewSummaryData,
  message,
}: UseAnalyticsOverviewStateParams) => {
  const [timeStatistics, setTimeStatistics] = useState<API.TimeStatistics[]>(
    [],
  );
  const [countryStatistics, setCountryStatistics] = useState<
    API.CountryStatistics[]
  >([]);
  const [variantGroupStatistics, setVariantGroupStatistics] = useState<
    API.VariantGroupStatistics[]
  >([]);
  const [overallStatistics, setOverallStatistics] =
    useState<API.MonitorStatistics>({});
  const [peakHoursStatistics, setPeakHoursStatistics] =
    useState<API.PeakHoursStatistics>({});
  const [allCountriesSummary, setAllCountriesSummary] =
    useState<API.AllCountriesSummary | null>(null);
  const [regionSummary, setRegionSummary] = useState<API.RegionSummary[]>([]);
  const [peakHoursMarkAreas, setPeakHoursMarkAreas] = useState<PeakMarkArea[]>(
    [],
  );

  const applyOverviewData = useCallback(
    (overviewData: AnalyticsOverviewData) => {
      setTimeStatistics(
        Array.isArray(overviewData.timeSeries) ? overviewData.timeSeries : [],
      );
      setCountryStatistics(
        Array.isArray(overviewData.countryDuration)
          ? overviewData.countryDuration
          : [],
      );
      setVariantGroupStatistics(
        Array.isArray(overviewData.variantGroupTop)
          ? overviewData.variantGroupTop
          : [],
      );
      setOverallStatistics(
        overviewData.overallStatistics &&
          typeof overviewData.overallStatistics === 'object'
          ? overviewData.overallStatistics
          : {},
      );
      setPeakHoursStatistics(
        country &&
          overviewData.peakHoursStatistics &&
          typeof overviewData.peakHoursStatistics === 'object'
          ? overviewData.peakHoursStatistics
          : {},
      );
      setAllCountriesSummary(overviewData.allCountriesSummary ?? null);
      setRegionSummary(
        Array.isArray(overviewData.regionSummary)
          ? overviewData.regionSummary
          : [],
      );
      setPeakHoursMarkAreas(
        groupBy === 'hour' && Array.isArray(overviewData.peakMarkAreas)
          ? overviewData.peakMarkAreas
          : [],
      );
    },
    [country, groupBy],
  );

  const reloadAllCountriesSummary = useCallback(
    async (timeSlotGranularity: TimeSlotGranularity) => {
      try {
        const overviewData = await loadOverviewSummaryData({
          allCountriesTimeSlotGranularity: timeSlotGranularity,
        });
        setAllCountriesSummary(overviewData.allCountriesSummary ?? null);
      } catch (error) {
        debugError('加载全国家汇总失败:', error);
        message.error('加载全国家汇总失败，请重试');
      }
    },
    [loadOverviewSummaryData, message],
  );

  const reloadRegionSummary = useCallback(
    async (timeSlotGranularity: TimeSlotGranularity) => {
      try {
        const overviewData = await loadOverviewSummaryData({
          regionTimeSlotGranularity: timeSlotGranularity,
        });
        setRegionSummary(
          Array.isArray(overviewData.regionSummary)
            ? overviewData.regionSummary
            : [],
        );
      } catch (error) {
        debugError('加载区域汇总失败:', error);
        message.error('加载区域汇总失败，请重试');
      }
    },
    [loadOverviewSummaryData, message],
  );

  return {
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
  };
};

export default useAnalyticsOverviewState;
