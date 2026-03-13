import { toBeijingDayjs } from '@/utils/beijingTime';
import { useMessage } from '@/utils/message';
import { PageContainer } from '@ant-design/pro-components';
import { history, useAccess } from '@umijs/max';
import { Button } from 'antd';
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
  const handleRefreshAll = useCallback(() => {
    void loadStatistics();
  }, [loadStatistics]);

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
        loading={loading}
        progress={progress}
        progressText={progressText}
        onCountryChange={setCountry}
        onDateRangeChange={setDateRange}
        onGroupByChange={setGroupBy}
        onQuery={handleRefreshAll}
      />

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
        loading={loading}
        onAllCountriesTimeSlotChange={(value) => {
          setAllCountriesTimeSlot(value);
          void reloadAllCountriesSummary(value);
        }}
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
        onPeriodTimeSlotChange={(value) => {
          setPeriodTimeSlot(value);
          void loadPeriodSummaryTable(
            periodSummary.current,
            periodSummary.pageSize,
            periodFilter,
            value,
          );
        }}
        onRegionTimeSlotChange={(value) => {
          setRegionTimeSlot(value);
          void reloadRegionSummary(value);
        }}
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
