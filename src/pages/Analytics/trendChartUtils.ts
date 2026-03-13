import { formatBeijing } from '@/utils/beijingTime';
import { parseTimeLabel, peakAreaNameMap, toNumber } from './helpers';
import type {
  ChartOption,
  NormalizedOverall,
  PeakMarkArea,
  TimeChartDatum,
} from './types';

type TooltipPoint = {
  axisValue?: string;
  seriesName?: string;
  value?: unknown;
};

type BuildLineChartOptionsParams = {
  groupBy: string;
  peakAreaVisible: Record<string, boolean>;
  peakHoursMarkAreas: PeakMarkArea[];
  timeChartData: TimeChartDatum[];
};

const lineTypes = ['所有ASIN异常时长占比'];

const lineColorMap: Record<string, string> = {
  所有ASIN异常时长占比: '#1890ff',
};

export const buildNormalizedOverall = (
  overallStatistics: API.MonitorStatistics,
): NormalizedOverall => ({
  totalDurationHours: toNumber(overallStatistics.totalDurationHours || 0),
  abnormalDurationHours: toNumber(overallStatistics.abnormalDurationHours || 0),
  normalDurationHours: toNumber(overallStatistics.normalDurationHours || 0),
  ratioAllTime: toNumber(overallStatistics.ratioAllTime || 0),
});

export const buildTimeChartData = (
  timeStatistics: API.TimeStatistics[],
): TimeChartDatum[] =>
  timeStatistics.flatMap((item) => {
    const timeLabel = item.time_period || item.timePeriod || '';
    const parsedTime = parseTimeLabel(timeLabel);
    if (!parsedTime) {
      return [];
    }

    const ratioAllTime = toNumber(
      item.ratioAllTime ?? item.ratio_all_time ?? 0,
    );
    const totalDurationHours = toNumber(item.totalDurationHours || 0);
    const abnormalDurationHours = toNumber(item.abnormalDurationHours || 0);

    if (!Number.isFinite(ratioAllTime)) {
      return [];
    }

    return [
      {
        time: parsedTime,
        type: '所有ASIN异常时长占比',
        value: ratioAllTime,
        rawValue: ratioAllTime,
        totalDurationHours,
        abnormalDurationHours,
        labelValue: `${ratioAllTime.toFixed(
          2,
        )}% (${abnormalDurationHours.toFixed(2)}/${totalDurationHours.toFixed(
          2,
        )} 小时)`,
      },
    ];
  });

export const buildLineChartOptions = ({
  groupBy,
  peakAreaVisible,
  peakHoursMarkAreas,
  timeChartData,
}: BuildLineChartOptionsParams): ChartOption => {
  const series: Array<Record<string, unknown>> = lineTypes.map(
    (type, index) => {
      const data = timeChartData
        .filter((item) => item.type === type)
        .map((item) => [
          formatBeijing(item.time, 'YYYY-MM-DD HH:mm'),
          Number(item.value),
          Number(item.rawValue),
          item.labelValue,
        ]);

      let markAreaConfig: Record<string, unknown> | undefined;
      if (index === 0 && peakHoursMarkAreas.length > 0) {
        const allAreas: Array<
          [Record<string, unknown>, Record<string, unknown>]
        > = [];
        peakHoursMarkAreas.forEach((region) => {
          if (peakAreaVisible[region.name] !== false) {
            region.areas.forEach((area) => {
              allAreas.push([
                {
                  ...area[0],
                  itemStyle: {
                    color: region.color,
                  },
                },
                {
                  ...area[1],
                  itemStyle: {
                    color: region.color,
                  },
                },
              ]);
            });
          }
        });

        if (allAreas.length > 0) {
          markAreaConfig = {
            label: {
              show: false,
            },
            data: allAreas,
          };
        }
      }

      return {
        name: type,
        type: 'line',
        smooth: true,
        showSymbol: true,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: {
          width: 3,
          color: lineColorMap[type],
        },
        itemStyle: {
          color: lineColorMap[type],
        },
        emphasis: {
          focus: 'series',
        },
        connectNulls: true,
        data,
        yAxisIndex: 0,
        markArea: markAreaConfig,
      };
    },
  );

  if (groupBy === 'hour' && peakHoursMarkAreas.length > 0) {
    peakHoursMarkAreas.forEach((region) => {
      const areaName = peakAreaNameMap[region.name] || region.name;
      series.push({
        name: areaName,
        type: 'line',
        data: [],
        lineStyle: {
          width: 0,
          color: 'transparent',
        },
        itemStyle: {
          color: region.color.replace('0.15', '0.8'),
        },
        areaStyle: {
          color: region.color.replace('0.15', '0.3'),
        },
        showSymbol: false,
        silent: true,
        legendHoverLink: false,
      });
    });
  }

  return {
    tooltip: {
      trigger: 'axis',
      formatter: (params: TooltipPoint | TooltipPoint[]) => {
        const points = Array.isArray(params) ? params : [params];
        const content = points
          .map((param) => {
            const labelValue = Array.isArray(param.value) ? param.value[3] : '';
            return `
              <div style="display:flex;justify-content:space-between">
                <span>${param.seriesName}</span>
                <span>${labelValue}</span>
              </div>`;
          })
          .join('');
        const axisVal = points[0]?.axisValue ?? '';
        return `<div style="margin-bottom:4px;font-weight:600;">${axisVal}</div>${content}`;
      },
    },
    legend: {
      data: [
        ...lineTypes,
        ...(groupBy === 'hour' && peakHoursMarkAreas.length > 0
          ? peakHoursMarkAreas.map(
              (region) => peakAreaNameMap[region.name] || region.name,
            )
          : []),
      ],
      top: 8,
      selected: {
        ...(groupBy === 'hour' && peakHoursMarkAreas.length > 0
          ? peakHoursMarkAreas.reduce((acc, region) => {
              const name = peakAreaNameMap[region.name] || region.name;
              acc[name] = peakAreaVisible[region.name] !== false;
              return acc;
            }, {} as Record<string, boolean>)
          : {}),
      },
    },
    grid: {
      left: '3%',
      right: '3%',
      bottom: '10%',
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
    },
    yAxis: [
      {
        type: 'value',
        name: '异常占比 (%)',
        position: 'left',
        min: 0,
        max: 100,
        axisLabel: {
          formatter: '{value}%',
        },
      },
    ],
    dataZoom: [
      {
        type: 'slider',
        show: true,
        xAxisIndex: [0],
        start: 0,
        end: 100,
        height: 30,
        bottom: 10,
        handleIcon:
          'path://M30.9,53.2C16.8,53.2,5.3,41.7,5.3,27.6S16.8,2,30.9,2C45,2,56.4,13.5,56.4,27.6S45,53.2,30.9,53.2z M30.9,3.5C17.6,3.5,6.8,14.4,6.8,27.6c0,13.3,10.8,24.1,24.1,24.1C44.2,51.7,55,40.9,55,27.6C54.9,14.4,44.1,3.5,30.9,3.5z M36.9,35.8c0,0.6-0.4,1-1,1H26.8c-0.6,0-1-0.4-1-1V19.5c0-0.6,0.4-1,1-1h9.2c0.6,0,1,0.4,1,1V35.8z',
        handleSize: '80%',
        handleStyle: {
          color: '#fff',
          shadowBlur: 3,
          shadowColor: 'rgba(0, 0, 0, 0.6)',
          shadowOffsetX: 2,
          shadowOffsetY: 2,
        },
      },
      {
        type: 'inside',
        xAxisIndex: [0],
        start: 0,
        end: 100,
      },
    ],
    series,
  };
};
