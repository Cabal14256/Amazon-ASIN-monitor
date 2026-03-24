import { toBeijingDayjs } from '@/utils/beijingTime';
import { useMessage } from '@/utils/message';
import { PageContainer } from '@ant-design/pro-components';
import { history, useAccess } from '@umijs/max';
import { Alert, Button } from 'antd';
import { type Dayjs } from 'dayjs';
import React, { useCallback, useState } from 'react';
import ChartsSection from './components/ChartsSection';
import FiltersCard from './components/FiltersCard';
import OverviewCards from './components/OverviewCards';
import SummaryTables from './components/SummaryTables';
import { countryMap, formatHours } from './helpers';
import useAnalyticsCharts from './hooks/useAnalyticsCharts';
import useAnalyticsData from './hooks/useAnalyticsData';
import useAnalyticsExport from './hooks/useAnalyticsExport';
import type { PeriodFilter, TimeSlotGranularity } from './types';

const MAX_HOURLY_RANGE_HOURS = 7 * 24;

const exceedsHourlyRangeLimit = ([start, end]: [Dayjs, Dayjs]) =>
  end.diff(start, 'hour', true) > MAX_HOURLY_RANGE_HOURS;

const AnalyticsPageContent: React.FC<unknown> = () => {
  const access = useAccess();
  const message = useMessage();
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([
    toBeijingDayjs().startOf('day'),
    toBeijingDayjs().endOf('day'),
  ]);
  const [country, setCountry] = useState<string>('');
  const [groupBy, setGroupBy] = useState<string>('hour');
  // 三个表格各自的时间槽粒度
  const [allCountriesTimeSlot, setAllCountriesTimeSlot] =
    useState<TimeSlotGranularity>('hour');
  const [regionTimeSlot, setRegionTimeSlot] =
    useState<TimeSlotGranularity>('hour');
  const [periodTimeSlot, setPeriodTimeSlot] =
    useState<TimeSlotGranularity>('hour');
  // 周期汇总表格筛选条件
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>({});
  const {
    analyticsNotice,
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
  } = useAnalyticsData({
    allCountriesTimeSlot,
    country,
    dateRange,
    groupBy,
    message,
    periodFilter,
    periodTimeSlot,
    regionTimeSlot,
  });
  const {
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
  } = useAnalyticsCharts({
    countryStatistics,
    groupBy,
    overallStatistics,
    peakHoursMarkAreas,
    timeStatistics,
    variantGroupStatistics,
  });
  const handleExport = useAnalyticsExport({
    country,
    dateRange,
    message,
  });

  const {
    totalDurationHours,
    abnormalDurationHours,
    normalDurationHours,
    ratioAllTime,
  } = normalizedOverall;
  const hourGranularityDisabled = exceedsHourlyRangeLimit(dateRange);
  const hourlyLimitWarningMessage = `时间范围超过 ${
    MAX_HOURLY_RANGE_HOURS / 24
  } 天时不支持按小时统计，已切换或限制为按天`;

  const normalizeRangeGranularity = useCallback(
    (nextRange: [Dayjs, Dayjs]) => {
      if (!exceedsHourlyRangeLimit(nextRange)) {
        return false;
      }

      let changed = false;
      if (groupBy === 'hour') {
        setGroupBy('day');
        changed = true;
      }
      if (allCountriesTimeSlot === 'hour') {
        setAllCountriesTimeSlot('day');
        changed = true;
      }
      if (regionTimeSlot === 'hour') {
        setRegionTimeSlot('day');
        changed = true;
      }
      if (periodTimeSlot === 'hour') {
        setPeriodTimeSlot('day');
        changed = true;
      }

      if (changed) {
        message.warning(hourlyLimitWarningMessage);
      }

      return changed;
    },
    [
      allCountriesTimeSlot,
      groupBy,
      hourlyLimitWarningMessage,
      message,
      periodTimeSlot,
      regionTimeSlot,
    ],
  );

  const handleRefreshAll = useCallback(() => {
    void loadStatistics();
  }, [loadStatistics]);
  const handleDateRangeChange = useCallback(
    (nextRange: [Dayjs, Dayjs]) => {
      setDateRange(nextRange);
      normalizeRangeGranularity(nextRange);
    },
    [normalizeRangeGranularity],
  );
  const handleGroupByChange = useCallback(
    (value: string) => {
      if (value === 'hour' && hourGranularityDisabled) {
        message.warning(hourlyLimitWarningMessage);
        return;
      }
      setGroupBy(value);
      if (value !== 'hour') {
        if (allCountriesTimeSlot === 'hour') {
          setAllCountriesTimeSlot('day');
        }
        if (regionTimeSlot === 'hour') {
          setRegionTimeSlot('day');
        }
        if (periodTimeSlot === 'hour') {
          setPeriodTimeSlot('day');
        }
      }
    },
    [
      allCountriesTimeSlot,
      hourGranularityDisabled,
      hourlyLimitWarningMessage,
      message,
      periodTimeSlot,
      regionTimeSlot,
    ],
  );
  const handleAllCountriesTimeSlotChange = useCallback(
    (value: TimeSlotGranularity) => {
      if (value === 'hour' && hourGranularityDisabled) {
        message.warning(hourlyLimitWarningMessage);
        return;
      }
      setAllCountriesTimeSlot(value);
      void reloadAllCountriesSummary(value);
    },
    [
      hourGranularityDisabled,
      hourlyLimitWarningMessage,
      message,
      reloadAllCountriesSummary,
    ],
  );
  const handleRegionTimeSlotChange = useCallback(
    (value: TimeSlotGranularity) => {
      if (value === 'hour' && hourGranularityDisabled) {
        message.warning(hourlyLimitWarningMessage);
        return;
      }
      setRegionTimeSlot(value);
      void reloadRegionSummary(value);
    },
    [
      hourGranularityDisabled,
      hourlyLimitWarningMessage,
      message,
      reloadRegionSummary,
    ],
  );
  const handlePeriodTimeSlotChange = useCallback(
    (value: TimeSlotGranularity) => {
      if (value === 'hour' && hourGranularityDisabled) {
        message.warning(hourlyLimitWarningMessage);
        return;
      }
      setPeriodTimeSlot(value);
      void loadPeriodSummaryTable(
        periodSummary.current,
        periodSummary.pageSize,
        periodFilter,
        value,
      );
    },
    [
      hourGranularityDisabled,
      hourlyLimitWarningMessage,
      loadPeriodSummaryTable,
      message,
      periodFilter,
      periodSummary.current,
      periodSummary.pageSize,
    ],
  );

  return (
    <PageContainer
      header={{
        title: '数据分析',
        breadcrumb: {},
      }}
      extra={[
        <Button key="export-excel" onClick={() => handleExport('excel')}>
          导出Excel
        </Button>,
        <Button key="export-csv" onClick={() => handleExport('csv')}>
          导出CSV
        </Button>,
        access.canReadSettings ? (
          <Button key="ops" onClick={() => history.push('/ops')}>
            运维页
          </Button>
        ) : null,
        <Button
          key="refresh"
          type="primary"
          onClick={handleRefreshAll}
          loading={loading}
        >
          刷新
        </Button>,
      ]}
    >
      <FiltersCard
        country={country}
        countryMap={countryMap}
        dateRange={dateRange}
        groupBy={groupBy}
        hourGranularityDisabled={hourGranularityDisabled}
        loading={loading}
        progress={progress}
        progressText={progressText}
        onCountryChange={setCountry}
        onDateRangeChange={handleDateRangeChange}
        onGroupByChange={handleGroupByChange}
        onQuery={handleRefreshAll}
      />

      {analyticsNotice && (
        <Alert
          style={{ marginBottom: 16 }}
          showIcon
          type={analyticsNotice.type}
          message={analyticsNotice.message}
        />
      )}

      <OverviewCards
        abnormalDurationHours={abnormalDurationHours}
        country={country}
        formatHours={formatHours}
        normalDurationHours={normalDurationHours}
        peakHoursStatistics={peakHoursStatistics}
        ratioAllTime={ratioAllTime}
        totalDurationHours={totalDurationHours}
      />

      <ChartsSection
        countryBarOptions={countryBarOptions}
        countryBarValueMode={countryBarValueMode}
        countryColumnDisplayData={countryColumnDisplayData}
        countryPieData={countryPieData}
        countryPieOptions={countryPieOptions}
        countryPieValueMode={countryPieValueMode}
        handleLegendSelectChanged={handleLegendSelectChanged}
        lineChartOptions={lineChartOptions}
        loading={loading}
        onCountryBarValueModeChange={setCountryBarValueMode}
        onCountryPieValueModeChange={setCountryPieValueMode}
        onVariantGroupClick={(variantGroupId) =>
          history.push(`/monitor-history?type=group&id=${variantGroupId}`)
        }
        onVariantGroupValueModeChange={setVariantGroupValueMode}
        timeChartData={timeChartData}
        variantGroupDisplayData={variantGroupDisplayData}
        variantGroupOptions={variantGroupOptions}
        variantGroupValueMode={variantGroupValueMode}
      />

      <SummaryTables
        allCountriesSummary={allCountriesSummary}
        allCountriesTimeSlot={allCountriesTimeSlot}
        hourGranularityDisabled={hourGranularityDisabled}
        loading={loading}
        onAllCountriesTimeSlotChange={handleAllCountriesTimeSlotChange}
        onPeriodFilterChange={setPeriodFilter}
        onPeriodPageChange={(page, pageSize) => {
          setPeriodSummary({
            ...periodSummary,
            current: page,
            pageSize,
          });
          void loadPeriodSummaryTable(
            page,
            pageSize,
            periodFilter,
            periodTimeSlot,
          );
        }}
        onPeriodQuery={handleRefreshAll}
        onPeriodTimeSlotChange={handlePeriodTimeSlotChange}
        onRegionTimeSlotChange={handleRegionTimeSlotChange}
        periodFilter={periodFilter}
        periodSummary={periodSummary}
        periodTimeSlot={periodTimeSlot}
        regionSummary={regionSummary}
        regionTimeSlot={regionTimeSlot}
      />
    </PageContainer>
  );
};

export default AnalyticsPageContent;
