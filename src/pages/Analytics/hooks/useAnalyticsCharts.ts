import { useCallback, useMemo, useState } from 'react';
import {
  buildCountryBarOptions,
  buildCountryColumnData,
  buildCountryColumnDisplayData,
  buildCountryPieData,
  buildCountryPieOptions,
  buildCountryTotals,
  buildVariantGroupColumnData,
  buildVariantGroupDisplayData,
  buildVariantGroupOptions,
} from '../distributionChartUtils';
import { peakAreaNameMap } from '../helpers';
import {
  buildLineChartOptions,
  buildNormalizedOverall,
  buildTimeChartData,
} from '../trendChartUtils';
import type {
  LegendSelectChangedParams,
  PeakMarkArea,
  ValueMode,
} from '../types';

const initialPeakAreaVisible: Record<string, boolean> = {
  US: true,
  UK: true,
  EU_OTHER: true,
};

type UseAnalyticsChartsParams = {
  countryStatistics: API.CountryStatistics[];
  groupBy: string;
  overallStatistics: API.MonitorStatistics;
  peakHoursMarkAreas: PeakMarkArea[];
  timeStatistics: API.TimeStatistics[];
  variantGroupStatistics: API.VariantGroupStatistics[];
};

const useAnalyticsCharts = ({
  countryStatistics,
  groupBy,
  overallStatistics,
  peakHoursMarkAreas,
  timeStatistics,
  variantGroupStatistics,
}: UseAnalyticsChartsParams) => {
  const [countryBarValueMode, setCountryBarValueMode] =
    useState<ValueMode>('count');
  const [countryPieValueMode, setCountryPieValueMode] =
    useState<ValueMode>('count');
  const [variantGroupValueMode, setVariantGroupValueMode] =
    useState<ValueMode>('count');
  const [peakAreaVisible, setPeakAreaVisible] = useState(
    initialPeakAreaVisible,
  );

  const normalizedOverall = useMemo(
    () => buildNormalizedOverall(overallStatistics),
    [overallStatistics],
  );

  const timeChartData = useMemo(
    () => buildTimeChartData(timeStatistics),
    [timeStatistics],
  );

  const lineChartOptions = useMemo(
    () =>
      buildLineChartOptions({
        groupBy,
        peakAreaVisible,
        peakHoursMarkAreas,
        timeChartData,
      }),
    [groupBy, peakAreaVisible, peakHoursMarkAreas, timeChartData],
  );

  const handleLegendSelectChanged = useCallback(
    (params: LegendSelectChangedParams) => {
      const peakAreaNames = Object.values(peakAreaNameMap);
      if (peakAreaNames.includes(params.name)) {
        const regionCode = Object.keys(peakAreaNameMap).find(
          (key) => peakAreaNameMap[key] === params.name,
        );
        if (regionCode) {
          setPeakAreaVisible((prev) => ({
            ...prev,
            [regionCode]: params.selected[params.name] !== false,
          }));
        }
      }
    },
    [],
  );

  const countryColumnData = useMemo(
    () => buildCountryColumnData(countryStatistics, countryBarValueMode),
    [countryBarValueMode, countryStatistics],
  );

  const countryColumnDisplayData = useMemo(
    () => buildCountryColumnDisplayData(countryColumnData, countryBarValueMode),
    [countryBarValueMode, countryColumnData],
  );

  const countryPieData = useMemo(
    () => buildCountryPieData(countryStatistics, countryPieValueMode),
    [countryPieValueMode, countryStatistics],
  );

  const variantGroupColumnData = useMemo(
    () =>
      buildVariantGroupColumnData(
        variantGroupStatistics,
        variantGroupValueMode,
      ),
    [variantGroupStatistics, variantGroupValueMode],
  );

  const variantGroupDisplayData = useMemo(
    () =>
      buildVariantGroupDisplayData(
        variantGroupColumnData,
        variantGroupValueMode,
      ),
    [variantGroupColumnData, variantGroupValueMode],
  );

  const countryTotals = useMemo(
    () => buildCountryTotals(countryColumnDisplayData),
    [countryColumnDisplayData],
  );

  const countryBarOptions = useMemo(
    () =>
      buildCountryBarOptions(
        countryColumnDisplayData,
        countryBarValueMode,
        countryTotals,
      ),
    [countryBarValueMode, countryColumnDisplayData, countryTotals],
  );

  const countryPieOptions = useMemo(
    () => buildCountryPieOptions(countryPieData, countryPieValueMode),
    [countryPieData, countryPieValueMode],
  );

  const variantGroupOptions = useMemo(
    () =>
      buildVariantGroupOptions(variantGroupDisplayData, variantGroupValueMode),
    [variantGroupDisplayData, variantGroupValueMode],
  );

  return {
    countryBarOptions,
    countryBarValueMode,
    countryColumnDisplayData,
    countryPieData,
    countryPieOptions,
    countryPieValueMode,
    handleLegendSelectChanged,
    lineChartOptions,
    normalizedOverall,
    setCountryBarValueMode,
    setCountryPieValueMode,
    setVariantGroupValueMode,
    timeChartData,
    variantGroupDisplayData,
    variantGroupOptions,
    variantGroupValueMode,
  };
};

export default useAnalyticsCharts;
