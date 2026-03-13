import React from 'react';
import type {
  PeriodFilter,
  PeriodSummaryState,
  TimeSlotGranularity,
} from '../types';
import AllCountriesSummaryCard from './AllCountriesSummaryCard';
import PeriodSummaryCard from './PeriodSummaryCard';
import RegionSummaryCard from './RegionSummaryCard';

type SummaryTablesProps = {
  allCountriesSummary: API.AllCountriesSummary | null;
  allCountriesTimeSlot: TimeSlotGranularity;
  loading: boolean;
  onAllCountriesTimeSlotChange: (value: TimeSlotGranularity) => void;
  onPeriodFilterChange: (next: PeriodFilter) => void;
  onPeriodPageChange: (page: number, pageSize: number) => void;
  onPeriodQuery: () => void;
  onPeriodTimeSlotChange: (value: TimeSlotGranularity) => void;
  onRegionTimeSlotChange: (value: TimeSlotGranularity) => void;
  periodFilter: PeriodFilter;
  periodSummary: PeriodSummaryState;
  periodTimeSlot: TimeSlotGranularity;
  regionSummary: API.RegionSummary[];
  regionTimeSlot: TimeSlotGranularity;
};

const SummaryTables: React.FC<SummaryTablesProps> = ({
  allCountriesSummary,
  allCountriesTimeSlot,
  loading,
  onAllCountriesTimeSlotChange,
  onPeriodFilterChange,
  onPeriodPageChange,
  onPeriodQuery,
  onPeriodTimeSlotChange,
  onRegionTimeSlotChange,
  periodFilter,
  periodSummary,
  periodTimeSlot,
  regionSummary,
  regionTimeSlot,
}) => (
  <>
    <AllCountriesSummaryCard
      allCountriesSummary={allCountriesSummary}
      allCountriesTimeSlot={allCountriesTimeSlot}
      loading={loading}
      onTimeSlotChange={onAllCountriesTimeSlotChange}
    />
    <RegionSummaryCard
      loading={loading}
      onTimeSlotChange={onRegionTimeSlotChange}
      regionSummary={regionSummary}
      regionTimeSlot={regionTimeSlot}
    />
    <PeriodSummaryCard
      loading={loading}
      onFilterChange={onPeriodFilterChange}
      onPageChange={onPeriodPageChange}
      onQuery={onPeriodQuery}
      onTimeSlotChange={onPeriodTimeSlotChange}
      periodFilter={periodFilter}
      periodSummary={periodSummary}
      periodTimeSlot={periodTimeSlot}
    />
  </>
);

export default SummaryTables;
