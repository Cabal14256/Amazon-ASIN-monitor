import { QuestionCircleOutlined } from '@ant-design/icons';
import { Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { formatHours, formatPercent } from './formatters';

const durationSummaryMetricCopy = {
  ratioAllTime: {
    label: '整体异常时长占比',
    tooltip: '异常时长 / 总监控时长，反映整体异常程度。',
  },
  globalPeakRate: {
    label: '高峰异常时长占总时长',
    tooltip: '高峰时段异常时长 / 总监控时长，分母是全部监控时长。',
  },
  globalLowRate: {
    label: '低峰异常时长占总时长',
    tooltip: '低峰时段异常时长 / 总监控时长，分母是全部监控时长。',
  },
  ratioHigh: {
    label: '高峰时段内异常占比',
    tooltip: '高峰时段异常时长 / 高峰时段总监控时长，只看高峰时段内部。',
  },
  ratioLow: {
    label: '低峰时段内异常占比',
    tooltip: '低峰时段异常时长 / 低峰时段总监控时长，只看低峰时段内部。',
  },
} as const;

type DurationSummaryMetricKey = keyof typeof durationSummaryMetricCopy;

const renderDurationSummaryMetricTitle = (key: DurationSummaryMetricKey) => {
  const metric = durationSummaryMetricCopy[key];

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span>{metric.label}</span>
      <Tooltip title={metric.tooltip}>
        <QuestionCircleOutlined
          style={{ color: 'rgba(0, 0, 0, 0.45)', fontSize: 12 }}
        />
      </Tooltip>
    </span>
  );
};

type DurationSummaryMetricsRow = Pick<
  API.AllCountriesSummary,
  'globalLowRate' | 'globalPeakRate' | 'ratioAllTime' | 'ratioHigh' | 'ratioLow'
>;

export const createDurationSummaryRateColumns = <
  T extends DurationSummaryMetricsRow,
>(): ColumnsType<T> => [
  {
    title: renderDurationSummaryMetricTitle('ratioAllTime'),
    dataIndex: 'ratioAllTime',
    key: 'ratioAllTime',
    align: 'right',
    render: (value?: number) => formatPercent(value),
  },
  {
    title: renderDurationSummaryMetricTitle('globalPeakRate'),
    dataIndex: 'globalPeakRate',
    key: 'globalPeakRate',
    align: 'right',
    render: (value?: number) => formatPercent(value),
  },
  {
    title: renderDurationSummaryMetricTitle('globalLowRate'),
    dataIndex: 'globalLowRate',
    key: 'globalLowRate',
    align: 'right',
    render: (value?: number) => formatPercent(value),
  },
  {
    title: renderDurationSummaryMetricTitle('ratioHigh'),
    dataIndex: 'ratioHigh',
    key: 'ratioHigh',
    align: 'right',
    render: (value?: number) => formatPercent(value),
  },
  {
    title: renderDurationSummaryMetricTitle('ratioLow'),
    dataIndex: 'ratioLow',
    key: 'ratioLow',
    align: 'right',
    render: (value?: number) => formatPercent(value),
  },
];

export const periodTimeSlotColumns: ColumnsType<API.PeriodSummaryTimeSlotDetail> =
  [
    {
      title: '时间槽',
      dataIndex: 'timeSlot',
      key: 'timeSlot',
    },
    {
      title: '总监控时长',
      dataIndex: 'totalDurationHours',
      key: 'totalDurationHours',
      align: 'right' as const,
      render: (value: number) => formatHours(value),
    },
    {
      title: '所有ASIN异常时长占比 (ratio_all_time)',
      dataIndex: 'ratioAllTime',
      key: 'ratioAllTime',
      align: 'right' as const,
      render: (value: number) => formatPercent(value),
    },
    {
      title: '全局高峰异常时长占比 (global_peak_rate)',
      dataIndex: 'globalPeakRate',
      key: 'globalPeakRate',
      align: 'right' as const,
      render: (value: number) => formatPercent(value),
    },
    {
      title: '全局低峰异常时长占比 (global_low_rate)',
      dataIndex: 'globalLowRate',
      key: 'globalLowRate',
      align: 'right' as const,
      render: (value: number) => formatPercent(value),
    },
    {
      title: '局部高峰异常时长占比 (ratio_high)',
      dataIndex: 'ratioHigh',
      key: 'ratioHigh',
      align: 'right' as const,
      render: (value: number) => formatPercent(value),
    },
    {
      title: '局部低峰异常时长占比 (ratio_low)',
      dataIndex: 'ratioLow',
      key: 'ratioLow',
      align: 'right' as const,
      render: (value: number) => formatPercent(value),
    },
  ];
