import {
  attachLabelValue,
  countryMap,
  filterValidValuesByKey,
  formatTooltipValue,
  toNumber,
} from './helpers';
import type {
  ChartOption,
  CountryColumnDatum,
  CountryPieDatum,
  ValueMode,
} from './types';

type TooltipPoint = {
  axisValue?: string;
  data?: Record<string, unknown>;
  name?: string;
  seriesName?: string;
  value?: unknown;
};

const countryColorPalette: Record<string, { normal: string; broken: string }> =
  {
    美国: { normal: '#52c41a', broken: '#ff4d4f' },
    欧洲汇总: { normal: '#73d13d', broken: '#ff7875' },
    英国: { normal: '#95de64', broken: '#ffa39e' },
    德国: { normal: '#b7eb8f', broken: '#ffccc7' },
    法国: { normal: '#d9f7be', broken: '#ffe7e6' },
    意大利: { normal: '#f6ffed', broken: '#fff1f0' },
    西班牙: { normal: '#e6f7ff', broken: '#ffadd2' },
  };

const pieColorArray = [
  '#1890ff',
  '#52c41a',
  '#faad14',
  '#f5222d',
  '#722ed1',
  '#13c2c2',
  '#eb2f96',
  '#fa8c16',
  '#2f54eb',
  '#a0d911',
];

export const buildCountryColumnData = (
  countryStatistics: API.CountryStatistics[],
  valueMode: ValueMode,
): CountryColumnDatum[] => {
  const data = countryStatistics.flatMap((item) => {
    const countryLabel = countryMap[item.country || ''] || item.country || '';
    const abnormalDurationHours = toNumber(item.abnormalDurationHours || 0);
    const normalDurationHours = toNumber(item.normalDurationHours || 0);
    return [
      attachLabelValue(
        {
          country: countryLabel,
          type: '异常' as const,
          value: abnormalDurationHours,
          rawValue: abnormalDurationHours,
        },
        valueMode,
      ),
      attachLabelValue(
        {
          country: countryLabel,
          type: '正常' as const,
          value: normalDurationHours,
          rawValue: normalDurationHours,
        },
        valueMode,
      ),
    ];
  });

  return filterValidValuesByKey(data, 'value');
};

export const buildCountryColumnDisplayData = (
  countryColumnData: CountryColumnDatum[],
  valueMode: ValueMode,
): CountryColumnDatum[] => {
  if (valueMode === 'count') {
    return countryColumnData;
  }

  const totalsByCountry = countryColumnData.reduce((acc, item) => {
    acc[item.country] = (acc[item.country] || 0) + toNumber(item.rawValue);
    return acc;
  }, {} as Record<string, number>);

  const percentData = countryColumnData.map((item) =>
    attachLabelValue(
      {
        ...item,
        value: totalsByCountry[item.country]
          ? (toNumber(item.rawValue) / totalsByCountry[item.country]) * 100
          : 0,
      },
      valueMode,
    ),
  );

  return filterValidValuesByKey(percentData, 'value');
};

export const buildCountryPieData = (
  countryStatistics: API.CountryStatistics[],
  valueMode: ValueMode,
): CountryPieDatum[] => {
  const data = countryStatistics.map((item) =>
    attachLabelValue(
      {
        type: countryMap[item.country || ''] || item.country || '',
        value: toNumber(item.abnormalDurationHours || 0),
        rawValue: toNumber(item.abnormalDurationHours || 0),
      },
      valueMode,
    ),
  );

  if (valueMode === 'count') {
    return filterValidValuesByKey(data, 'value');
  }

  const total = data.reduce((sum, item) => sum + item.value, 0);
  const percentData = data.map((item) =>
    attachLabelValue(
      {
        ...item,
        value: total ? (item.value / total) * 100 : 0,
      },
      valueMode,
    ),
  );

  return filterValidValuesByKey(percentData, 'value');
};

export const buildCountryTotals = (
  countryColumnDisplayData: CountryColumnDatum[],
): Record<string, number> => {
  const totals: Record<string, number> = {};
  countryColumnDisplayData.forEach((item) => {
    const raw = Number(item.rawValue ?? item.value);
    if (!Number.isFinite(raw)) {
      return;
    }
    totals[item.country] = (totals[item.country] || 0) + raw;
  });
  return totals;
};

export const buildCountryBarOptions = (
  countryColumnDisplayData: CountryColumnDatum[],
  valueMode: ValueMode,
  countryTotals: Record<string, number>,
): ChartOption => {
  if (!countryColumnDisplayData.length) {
    return {};
  }

  const categories = Array.from(
    new Set(countryColumnDisplayData.map((item) => item.country)),
  );

  const series = ['异常', '正常'].map((type) => ({
    name: type,
    type: 'bar',
    stack: 'total',
    emphasis: {
      focus: 'series',
    },
    itemStyle: {
      color: (params: { dataIndex: number }) => {
        const countryName = categories[params.dataIndex];
        const colorConfig = countryColorPalette[countryName] || {
          normal: '#52c41a',
          broken: '#ff4d4f',
        };
        return type === '异常' ? colorConfig.broken : colorConfig.normal;
      },
    },
    data: categories.map((countryName) => {
      const cell = countryColumnDisplayData.find(
        (item) => item.country === countryName && item.type === type,
      );
      return {
        value: cell ? Number(cell.value) : 0,
        rawValue: cell?.rawValue ?? (cell ? Number(cell.value) : 0),
        labelValue: cell?.labelValue,
      };
    }),
  }));

  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'shadow',
      },
      formatter: (params: TooltipPoint | TooltipPoint[]) => {
        const points = Array.isArray(params) ? params : [params];
        const content = points
          .map((param) => {
            const rawValue = Number(param?.data?.rawValue ?? param?.value) || 0;
            const value = Number(param?.data?.value ?? param?.value) || 0;
            const formatted = formatTooltipValue(valueMode, value, rawValue);
            return `
              <div style="display:flex;justify-content:space-between">
                <span>${param.seriesName}</span>
                <span>${formatted}</span>
              </div>`;
          })
          .join('');
        const axisVal = points[0]?.axisValue ?? '';
        const totalRaw = countryTotals[axisVal] ?? 0;
        const totalFormatted = formatTooltipValue('count', totalRaw, totalRaw);
        return `<div style="margin-bottom:4px;font-weight:600;">${axisVal}（总计：${totalFormatted}）</div>${content}`;
      },
    },
    legend: {
      data: ['异常', '正常'],
      top: 8,
    },
    grid: {
      left: '3%',
      right: '3%',
      bottom: '8%',
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      data: categories,
    },
    yAxis: {
      type: 'value',
    },
    series,
  };
};

export const buildCountryPieOptions = (
  countryPieData: CountryPieDatum[],
  valueMode: ValueMode,
): ChartOption => {
  if (!countryPieData.length) {
    return {};
  }

  const data = countryPieData.map((item) => ({
    name: item.type,
    value: Number(item.value),
    rawValue: Number(item.rawValue ?? item.value),
    labelValue: item.labelValue,
  }));

  return {
    tooltip: {
      trigger: 'item',
      formatter: (param: TooltipPoint) => {
        const value = Number(param.value) || 0;
        const rawValue = Number(param.data?.rawValue) || value;
        const formatted = formatTooltipValue(valueMode, value, rawValue);
        return `${param.name}<br/>${formatted}`;
      },
    },
    legend: {
      orient: 'vertical',
      left: 'right',
      top: 0,
      itemHeight: 8,
    },
    series: [
      {
        name: '国家分布',
        type: 'pie',
        radius: ['45%', '70%'],
        avoidLabelOverlap: false,
        labelLine: {
          length: 12,
          length2: 6,
        },
        data,
        itemStyle: {
          color: (params: { name: string }) => {
            const index = data.findIndex((item) => item.name === params.name);
            return pieColorArray[index % pieColorArray.length];
          },
        },
      },
    ],
  };
};
