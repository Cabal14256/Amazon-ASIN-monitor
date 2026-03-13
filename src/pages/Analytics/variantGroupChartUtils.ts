import {
  attachLabelValue,
  countryMap,
  filterValidValuesByKey,
  formatTooltipValue,
  toNumber,
} from './helpers';
import type { ChartOption, ValueMode, VariantGroupChartDatum } from './types';

type TooltipPoint = {
  data?: Record<string, unknown>;
  seriesName?: string;
  value?: unknown;
};

export const buildVariantGroupColumnData = (
  variantGroupStatistics: API.VariantGroupStatistics[],
  valueMode: ValueMode,
): VariantGroupChartDatum[] => {
  const data = variantGroupStatistics.map((item) => {
    const abnormalDurationHours = toNumber(item.abnormalDurationHours || 0);
    const abnormalDurationRate = toNumber(item.ratioAllTime || 0);
    const countryName = item.country
      ? countryMap[item.country] || item.country
      : '';
    const displayName = countryName
      ? `${item.variant_group_name || '未知'} (${countryName})`
      : item.variant_group_name || '未知';

    return attachLabelValue(
      {
        name: displayName,
        originalName: item.variant_group_name || '未知',
        country: item.country || '',
        countryName,
        variantGroupId: item.variant_group_id || '',
        value: abnormalDurationHours,
        rawValue: abnormalDurationHours,
        abnormalDurationRate,
      },
      valueMode,
    );
  });

  return filterValidValuesByKey(data, 'value');
};

export const buildVariantGroupDisplayData = (
  variantGroupColumnData: VariantGroupChartDatum[],
  valueMode: ValueMode,
): VariantGroupChartDatum[] => {
  if (valueMode === 'count') {
    return variantGroupColumnData;
  }

  const percentData = variantGroupColumnData.map((item) =>
    attachLabelValue(
      {
        ...item,
        value: toNumber(item.abnormalDurationRate || 0),
        rawValue: toNumber(item.rawValue),
      },
      valueMode,
    ),
  );

  return filterValidValuesByKey(percentData, 'value');
};

export const buildVariantGroupOptions = (
  variantGroupDisplayData: VariantGroupChartDatum[],
  valueMode: ValueMode,
): ChartOption => {
  if (!variantGroupDisplayData.length) {
    return {};
  }

  const categories = variantGroupDisplayData.map((item) => item.name);
  const data = variantGroupDisplayData.map((item) => ({
    value: Number(item.value),
    rawValue: item.rawValue ?? Number(item.value),
    labelValue: item.labelValue,
    variantGroupId: item.variantGroupId || '',
    originalName: item.originalName || item.name,
    country: item.country || '',
    countryName: item.countryName || '',
  }));

  return {
    tooltip: {
      trigger: 'axis',
      formatter: (params: TooltipPoint | TooltipPoint[]) => {
        const point = Array.isArray(params) ? params[0] : params;
        const rawValue = Number(point?.data?.rawValue ?? point?.value) || 0;
        const value = Number(point?.data?.value ?? point?.value) || 0;
        const formatted = formatTooltipValue(valueMode, value, rawValue);
        const countryName = point?.data?.countryName || '';
        const countryInfo = countryName
          ? `<div>国家: ${countryName}</div>`
          : '';
        return `
          <div>${point?.seriesName}</div>
          <div>${formatted}</div>
          ${countryInfo}`;
      },
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      containLabel: true,
    },
    xAxis: {
      type: 'value',
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: categories,
    },
    series: [
      {
        name: valueMode === 'percent' ? '异常时长占比' : '异常时长',
        type: 'bar',
        data: data.map((item) => ({
          value: item.value,
          rawValue: item.rawValue,
          labelValue: item.labelValue,
          variantGroupId: item.variantGroupId,
          originalName: item.originalName,
          country: item.country,
          countryName: item.countryName,
        })),
        itemStyle: {
          color: '#ff4d4f',
        },
      },
    ],
  };
};
