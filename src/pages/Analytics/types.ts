export type ProgressProfile = Record<
  string,
  {
    avgDurationMs?: number;
    avgPerItemMs?: number;
    lastTotal?: number;
  }
>;

export type PeakMarkArea = {
  areas: Array<[Record<string, unknown>, Record<string, unknown>]>;
  color: string;
  name: string;
};

export type TimeSlotGranularity = 'hour' | 'day';

export type ValueMode = 'count' | 'percent';

export type PeriodFilter = {
  country?: string;
  site?: string;
  brand?: string;
};

export type PeriodSummaryState = {
  list: API.PeriodSummary[];
  total: number;
  current: number;
  pageSize: number;
};

export type AnalyticsOverviewData = {
  allCountriesSummary?: API.AllCountriesSummary | null;
  countryDuration?: API.CountryStatistics[];
  overallStatistics?: API.MonitorStatistics;
  peakHoursStatistics?: API.PeakHoursStatistics | null;
  peakMarkAreas?: PeakMarkArea[];
  regionSummary?: API.RegionSummary[];
  timeSeries?: API.TimeStatistics[];
  variantGroupTop?: API.VariantGroupStatistics[];
};

export type ChartOption = Record<string, unknown>;

export type NormalizedOverall = {
  totalDurationHours: number;
  abnormalDurationHours: number;
  normalDurationHours: number;
  ratioAllTime: number;
};

export type TimeChartDatum = {
  time: string;
  type: string;
  value: number;
  rawValue: number;
  totalDurationHours: number;
  abnormalDurationHours: number;
  labelValue: string;
};

export type CountryColumnDatum = {
  country: string;
  type: '异常' | '正常';
  value: number;
  rawValue: number;
  labelValue: string;
};

export type CountryPieDatum = {
  type: string;
  value: number;
  rawValue: number;
  labelValue: string;
};

export type VariantGroupChartDatum = {
  name: string;
  originalName: string;
  country: string;
  countryName: string;
  variantGroupId: string;
  value: number;
  rawValue: number;
  abnormalDurationRate: number;
  labelValue: string;
};

export type LegendSelectChangedParams = {
  name: string;
  selected: Record<string, boolean>;
};

export type VariantGroupClickEvent = {
  data?: {
    variantGroupId?: string;
  };
};

export type AnalyticsResponseLike<T> =
  | T
  | {
      data?: T;
      meta?: API.AnalyticsResponseMeta;
    }
  | {
      data?: T;
      errorMessage?: string;
      meta?: API.AnalyticsResponseMeta;
      success?: boolean;
    };
