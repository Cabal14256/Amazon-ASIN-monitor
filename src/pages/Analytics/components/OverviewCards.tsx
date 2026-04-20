import { StatisticCard } from '@ant-design/pro-components';
import React from 'react';

type OverviewCardsProps = {
  abnormalDurationHours: number;
  country: string;
  formatHours: (value?: number) => string;
  normalDurationHours: number;
  peakHoursStatistics: API.PeakHoursStatistics;
  ratioAllTime: number;
  totalDurationHours: number;
};

const OverviewCards: React.FC<OverviewCardsProps> = ({
  abnormalDurationHours,
  country,
  formatHours,
  normalDurationHours,
  peakHoursStatistics,
  ratioAllTime,
  totalDurationHours,
}) => (
  <StatisticCard.Group>
    <StatisticCard
      statistic={{
        title: '总监控时长',
        value: formatHours(totalDurationHours),
      }}
    />
    <StatisticCard
      statistic={{
        title: '正常时长',
        value: formatHours(normalDurationHours),
        status: 'success',
      }}
    />
    <StatisticCard
      statistic={{
        title: '异常时长',
        value: formatHours(abnormalDurationHours),
        status: 'error',
      }}
    />
    <StatisticCard
      statistic={{
        title: '异常时长占比',
        value: `${ratioAllTime.toFixed(2)}%`,
      }}
    />
    {country && peakHoursStatistics.peakDurationHours !== undefined && (
      <>
        <StatisticCard
          statistic={{
            title: '高峰期异常时长占比',
            value: peakHoursStatistics.peakDurationHours
              ? `${(peakHoursStatistics.peakDurationRate || 0).toFixed(2)}%`
              : '0%',
            description: `高峰期: ${formatHours(
              peakHoursStatistics.peakAbnormalDurationHours || 0,
            )}/${formatHours(peakHoursStatistics.peakDurationHours || 0)}`,
          }}
        />
        <StatisticCard
          statistic={{
            title: '低峰期异常时长占比',
            value: peakHoursStatistics.offPeakDurationHours
              ? `${(peakHoursStatistics.offPeakDurationRate || 0).toFixed(2)}%`
              : '0%',
            description: `低峰期: ${formatHours(
              peakHoursStatistics.offPeakAbnormalDurationHours || 0,
            )}/${formatHours(peakHoursStatistics.offPeakDurationHours || 0)}`,
          }}
        />
      </>
    )}
  </StatisticCard.Group>
);

export default OverviewCards;
