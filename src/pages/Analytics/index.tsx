import services from '@/services/asin';
import { useMessage } from '@/utils/message';
import { getPeakHours } from '@/utils/peakHours';
import { PageContainer, StatisticCard } from '@ant-design/pro-components';
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Input,
  Radio,
  Row,
  Select,
  Space,
  Table,
  Tag,
} from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import ReactECharts from 'echarts-for-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

const { RangePicker } = DatePicker;
const {
  getStatisticsByTime,
  getStatisticsByCountry,
  getStatisticsByVariantGroup,
  getMonitorStatistics,
  getPeakHoursStatistics,
  getAllCountriesSummary,
  getRegionSummary,
  getPeriodSummary,
  getASINStatisticsByCountry,
  getASINStatisticsByVariantGroup,
} = services.MonitorController;

// 国家选项映射
const countryMap: Record<string, string> = {
  US: '美国',
  UK: '英国',
  DE: '德国',
  FR: '法国',
  IT: '意大利',
  ES: '西班牙',
};

const formatTooltipValue = (
  valueMode: 'count' | 'percent',
  value: number,
  rawValue?: number,
) => {
  if (valueMode === 'percent') {
    const percent = isNaN(value) ? 0 : value;
    const base = rawValue !== undefined ? ` (${rawValue} 条)` : '';
    return `${percent.toFixed(2)}%${base}`;
  }
  return rawValue !== undefined
    ? `${value}${rawValue === value ? '' : ` (${rawValue})`}`
    : `${value}`;
};

const toNumber = (value: unknown) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const filterValidValuesByKey = <T, K extends keyof T>(data: T[], key: K) =>
  data.filter((item) => {
    const value = Number(item[key]);
    return Number.isFinite(value) && value > 0;
  });

const attachLabelValue = (row: any, mode: 'count' | 'percent') => ({
  ...row,
  labelValue: formatTooltipValue(
    mode,
    toNumber(row.value),
    toNumber(row.rawValue),
  ),
});

const parseTimeLabel = (value?: string) => {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

const AnalyticsPageContent: React.FC<unknown> = () => {
  const message = useMessage();
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([
    dayjs().startOf('day'),
    dayjs().endOf('day'),
  ]);
  const [country, setCountry] = useState<string>('');
  const [groupBy, setGroupBy] = useState<string>('hour');
  const [loading, setLoading] = useState(false);
  // 三个表格各自的时间槽粒度
  const [allCountriesTimeSlot, setAllCountriesTimeSlot] = useState<string>('hour');
  const [regionTimeSlot, setRegionTimeSlot] = useState<string>('hour');
  const [periodTimeSlot, setPeriodTimeSlot] = useState<string>('hour');
  // 三个图表各自的数量/百分比模式
  const [countryBarValueMode, setCountryBarValueMode] = useState<'count' | 'percent'>('count');
  const [countryPieValueMode, setCountryPieValueMode] = useState<'count' | 'percent'>('count');
  const [variantGroupValueMode, setVariantGroupValueMode] = useState<'count' | 'percent'>('count');

  // 统计数据
  const [timeStatistics, setTimeStatistics] = useState<API.TimeStatistics[]>(
    [],
  );
  const [countryStatistics, setCountryStatistics] = useState<
    API.CountryStatistics[]
  >([]);
  const [variantGroupStatistics, setVariantGroupStatistics] = useState<
    API.VariantGroupStatistics[]
  >([]);
  const [overallStatistics, setOverallStatistics] =
    useState<API.MonitorStatistics>({});
  const [peakHoursStatistics, setPeakHoursStatistics] =
    useState<API.PeakHoursStatistics>({});
  // 汇总表格数据
  const [allCountriesSummary, setAllCountriesSummary] =
    useState<API.AllCountriesSummary | null>(null);
  const [regionSummary, setRegionSummary] = useState<API.RegionSummary[]>([]);
  const [periodSummary, setPeriodSummary] = useState<{
    list: API.PeriodSummary[];
    total: number;
    current: number;
    pageSize: number;
  }>({
    list: [],
    total: 0,
    current: 1,
    pageSize: 10,
  });
  // 周期汇总表格筛选条件
  const [periodFilter, setPeriodFilter] = useState<{
    country?: string;
    site?: string;
    brand?: string;
  }>({});

  // 加载所有统计数据（使用useCallback优化）
  const loadStatistics = useCallback(async () => {
    setLoading(true);
    try {
      const startTime = dateRange[0].format('YYYY-MM-DD HH:mm:ss');
      const endTime = dateRange[1].format('YYYY-MM-DD HH:mm:ss');
      const params: any = {
        startTime,
        endTime,
      };
      if (country) {
        params.country = country;
      }

      // 并行加载所有统计数据
      const promises: any[] = [
        getStatisticsByTime({ ...params, groupBy }),
        // 使用ASIN当前状态统计，而不是监控历史记录
        getASINStatisticsByCountry(),
        getASINStatisticsByVariantGroup({ limit: 10 }),
        getMonitorStatistics(params),
        getAllCountriesSummary({ ...params, timeSlotGranularity: allCountriesTimeSlot }),
        getRegionSummary({ ...params, timeSlotGranularity: regionTimeSlot }),
        getPeriodSummary({
          ...params,
          ...periodFilter,
          timeSlotGranularity: periodTimeSlot,
          current: periodSummary.current,
          pageSize: periodSummary.pageSize,
        }),
      ];

      // 如果选择了国家，加载高峰期统计
      if (country) {
        promises.push(getPeakHoursStatistics({ ...params, country }));
      }

      const results = await Promise.all(promises);
      const [
        timeData,
        countryData,
        variantGroupData,
        overallData,
        allCountriesData,
        regionData,
        periodData,
        peakData,
      ] = results;

      // 处理响应数据
      const timeStats =
        timeData && typeof timeData === 'object' && !('success' in timeData)
          ? timeData
          : (timeData as any)?.data || [];
      // countryData 现在是基于ASIN当前状态的统计
      const countryStats =
        countryData &&
        typeof countryData === 'object' &&
        !('success' in countryData)
          ? countryData
          : (countryData as any)?.data || [];
      // variantGroupData 现在是基于ASIN当前状态的统计
      const variantGroupStats =
        variantGroupData &&
        typeof variantGroupData === 'object' &&
        !('success' in variantGroupData)
          ? variantGroupData
          : (variantGroupData as any)?.data || [];
      const overallStats =
        overallData &&
        typeof overallData === 'object' &&
        !('success' in overallData)
          ? overallData
          : (overallData as any)?.data || {};

      setTimeStatistics(timeStats as API.TimeStatistics[]);
      setCountryStatistics(countryStats as API.CountryStatistics[]);
      setVariantGroupStatistics(
        variantGroupStats as API.VariantGroupStatistics[],
      );
      setOverallStatistics(overallStats);

      // 处理高峰期统计数据
      if (country && peakData) {
        const peakStats =
          peakData && typeof peakData === 'object' && !('success' in peakData)
            ? peakData
            : (peakData as any)?.data || {};
        setPeakHoursStatistics(peakStats);
      } else {
        setPeakHoursStatistics({});
      }

      // 处理汇总表格数据
      const allCountriesStats =
        allCountriesData && typeof allCountriesData === 'object' && !('success' in allCountriesData)
          ? allCountriesData
          : (allCountriesData as any)?.data || null;
      setAllCountriesSummary(allCountriesStats);

      const regionStats =
        regionData && typeof regionData === 'object' && !('success' in regionData)
          ? regionData
          : (regionData as any)?.data || [];
      setRegionSummary(regionStats);

      const periodStats =
        periodData && typeof periodData === 'object' && !('success' in periodData)
          ? periodData
          : (periodData as any)?.data || { list: [], total: 0, current: 1, pageSize: 10 };
      setPeriodSummary(periodStats);
    } catch (error) {
      console.error('加载统计数据失败:', error);
      message.error('加载统计数据失败');
    } finally {
      setLoading(false);
    }
  }, [
    dateRange,
    country,
    groupBy,
    allCountriesTimeSlot,
    regionTimeSlot,
    periodTimeSlot,
    periodFilter,
    periodSummary.current,
    periodSummary.pageSize,
    message,
  ]);

  useEffect(() => {
    loadStatistics();
  }, [loadStatistics]);

  // 时间趋势图表数据
  // 注意：确保数据顺序与颜色数组顺序一致（按字母顺序：异常、正常、总计）
  const normalizedOverall = useMemo(() => {
    return {
      totalChecks: toNumber(overallStatistics.totalChecks),
      brokenCount: toNumber(overallStatistics.brokenCount),
      normalCount: toNumber(overallStatistics.normalCount),
    };
  }, [overallStatistics]);

  const timeChartData = useMemo(() => {
    return timeStatistics.flatMap((item) => {
      const timeLabel = item.time_period || (item as any).timePeriod || '';
      const parsedTime = parseTimeLabel(timeLabel);
      if (!parsedTime) {
        return [];
      }
      // 所有ASIN异常占比（快照口径）- 始终为百分比
      const ratioAllAsin = toNumber(item.ratio_all_asin || 0);
      // 所有ASIN异常占比-去重（去重口径）- 始终为百分比
      const ratioAllTime = toNumber(item.ratio_all_time || 0);
      const totalAsinsDedup = toNumber(item.total_asins_dedup || 0);
      const brokenAsinsDedup = toNumber(item.broken_asins_dedup || 0);
      const totalChecks = toNumber(item.total_checks || 0);
      const brokenCount = toNumber(item.broken_count || 0);

      const rows = [
        {
          time: parsedTime,
          type: '所有ASIN异常占比',
          value: ratioAllAsin,
          rawValue: ratioAllAsin,
          totalChecks,
          brokenCount,
        },
        {
          time: parsedTime,
          type: '所有ASIN异常占比-去重',
          value: ratioAllTime,
          rawValue: ratioAllTime,
          totalAsinsDedup,
          brokenAsinsDedup,
        },
      ];
      return rows
        .filter((row) => Number.isFinite(row.value))
        .map((row) => {
          if (row.type === '所有ASIN异常占比') {
            return {
              ...row,
              labelValue: `${ratioAllAsin.toFixed(2)}% (${brokenCount}/${totalChecks} 快照)`,
            };
          } else {
            return {
              ...row,
              labelValue: `${ratioAllTime.toFixed(2)}% (${brokenAsinsDedup}/${totalAsinsDedup} ASIN)`,
            };
          }
        });
    });
  }, [timeStatistics]);

  const lineTypes = ['所有ASIN异常占比', '所有ASIN异常占比-去重'] as const;
  const lineColorMap: Record<string, string> = {
    '所有ASIN异常占比': '#ff4d4f',
    '所有ASIN异常占比-去重': '#1890ff',
  };
  const countryColorMap: Record<string, string> = {
    异常: '#ff4d4f',
    正常: '#52c41a',
  };
  const pieColorMap: Record<string, string> = {
    ...countryColorMap,
  };

  // 高峰期背景区域（仅在按小时分组且选择了国家时显示）
  const peakHoursMarkAreas = useMemo(() => {
    if (groupBy !== 'hour' || !country) {
      return [];
    }

    const peakHours = getPeakHours(country);
    const areas: any[] = [];

    // 根据国家设置高峰时段颜色
    const peakColorMap: Record<string, string> = {
      US: 'rgba(255, 152, 0, 0.15)', // 橙色
      UK: 'rgba(156, 39, 176, 0.15)', // 紫色
      DE: 'rgba(33, 150, 243, 0.15)', // 蓝色
      FR: 'rgba(33, 150, 243, 0.15)', // 蓝色
      IT: 'rgba(33, 150, 243, 0.15)', // 蓝色
      ES: 'rgba(33, 150, 243, 0.15)', // 蓝色
    };
    const peakColor = peakColorMap[country] || 'rgba(255, 193, 7, 0.1)';

    // 获取时间范围
    if (timeChartData.length > 0) {
      const firstTime = timeChartData[0]?.time;
      const lastTime = timeChartData[timeChartData.length - 1]?.time;
      if (firstTime && lastTime) {
        const startDate = dayjs(firstTime).startOf('day');
        const endDate = dayjs(lastTime).endOf('day');
        let currentDate = startDate;

        while (currentDate <= endDate) {
          const dateForLoop = currentDate; // 创建局部变量避免闭包问题
          peakHours.forEach((peak) => {
            const startHour = peak.start;
            const endHour = peak.end === 24 ? 0 : peak.end;
            const startTime = dateForLoop.hour(startHour).minute(0).second(0);
            const endTime =
              endHour === 0
                ? dateForLoop.add(1, 'day').hour(0).minute(0).second(0)
                : dateForLoop.hour(endHour).minute(0).second(0);

            areas.push([
              {
                name: '高峰期',
                xAxis: startTime.format('YYYY-MM-DD HH:mm'),
              },
              {
                xAxis: endTime.format('YYYY-MM-DD HH:mm'),
              },
            ]);
          });
          currentDate = currentDate.add(1, 'day');
        }
      }
    }

    return { areas, color: peakColor };
  }, [groupBy, country, timeChartData]);

  const lineChartOptions = useMemo(() => {
    const series = lineTypes.map((type, index) => {
      const data = timeChartData
        .filter((item) => item.type === type)
        .map((item) => [
          dayjs(item.time).format('YYYY-MM-DD HH:mm'),
          Number(item.value),
          Number(item.rawValue),
          item.labelValue,
        ]);
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
        yAxisIndex: 0, // 都使用左侧Y轴
        // 只在第一个系列添加高峰期背景
        markArea:
          index === 0 && peakHoursMarkAreas.areas && peakHoursMarkAreas.areas.length > 0
            ? {
                itemStyle: {
                  color: peakHoursMarkAreas.color,
                },
                label: {
                  show: false,
                },
                data: peakHoursMarkAreas.areas,
              }
            : undefined,
      };
    });
    return {
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const points = Array.isArray(params) ? params : [params];
          const content = points
            .map((param: any) => {
              const labelValue = param.value?.[3] || '';
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
        data: lineTypes,
        top: 8,
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
      series,
    };
  }, [timeChartData, peakHoursMarkAreas]);

  // 国家统计柱状图数据（基于ASIN当前状态）
  // 注意：确保数据顺序与颜色数组顺序一致
  const countryColumnData = useMemo(() => {
    const data = countryStatistics.flatMap((item) => {
      const countryLabel = countryMap[item.country || ''] || item.country;
      // 使用 total_asins 和 broken_count 计算正常数量
      const totalAsins = toNumber((item as any).total_asins || 0);
      const broken = toNumber(item.broken_count || 0);
      const normal = totalAsins - broken;
      return [
        attachLabelValue(
          {
            country: countryLabel,
            type: '异常',
            value: broken,
            rawValue: broken,
          },
          countryBarValueMode,
        ),
        attachLabelValue(
          {
            country: countryLabel,
            type: '正常',
            value: normal,
            rawValue: normal,
          },
          countryBarValueMode,
        ),
      ];
    });
    return filterValidValuesByKey(data, 'value');
  }, [countryStatistics, countryBarValueMode]);

  const countryColumnDisplayData = useMemo(() => {
    if (countryBarValueMode === 'count') {
      return countryColumnData;
    }
    const total = countryColumnData.reduce((sum, item) => sum + item.value, 0);
    const percentData = countryColumnData.map((item) =>
      attachLabelValue(
        {
          ...item,
          value: total ? (item.value / total) * 100 : 0,
        },
        countryBarValueMode,
      ),
    );
    return filterValidValuesByKey(percentData, 'value');
  }, [countryColumnData, countryBarValueMode]);

  // 国家统计饼图数据（基于ASIN当前状态）
  const countryPieData = useMemo(() => {
    const data = countryStatistics.map((item) => {
      // 使用 total_asins 而不是 total_checks
      const total = toNumber((item as any).total_asins || 0);
      return attachLabelValue(
        {
          type: countryMap[item.country || ''] || item.country,
          value: total,
          rawValue: total,
        },
        countryPieValueMode,
      );
    });
    if (countryPieValueMode === 'count') {
      return filterValidValuesByKey(data, 'value');
    }
    const total = data.reduce((sum, item) => sum + item.value, 0);
    const percentData = data.map((item) =>
      attachLabelValue(
        {
          ...item,
          value: total ? (item.value / total) * 100 : 0,
        },
        countryPieValueMode,
      ),
    );
    return filterValidValuesByKey(percentData, 'value');
  }, [countryStatistics, countryPieValueMode]);

  // 变体组统计柱状图数据
  const variantGroupColumnData = useMemo(() => {
    const data = variantGroupStatistics.map((item) => {
      const broken = toNumber(item.broken_count);
      return attachLabelValue(
        {
          name: item.variant_group_name || '未知',
          broken,
          rawValue: broken,
        },
        variantGroupValueMode,
      );
    });
    return filterValidValuesByKey(data, 'broken');
  }, [variantGroupStatistics, variantGroupValueMode]);

  const variantGroupDisplayData = useMemo(() => {
    if (variantGroupValueMode === 'count') {
      return variantGroupColumnData;
    }
    const totalBroken = variantGroupColumnData.reduce(
      (sum, item) => sum + item.broken,
      0,
    );
    const percentData = variantGroupColumnData.map((item) =>
      attachLabelValue(
        {
          ...item,
          broken: totalBroken ? (item.broken / totalBroken) * 100 : 0,
        },
        variantGroupValueMode,
      ),
    );
    return filterValidValuesByKey(percentData, 'broken');
  }, [variantGroupColumnData, variantGroupValueMode]);

  const countryTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    countryColumnDisplayData.forEach((item) => {
      const raw = Number(item.rawValue ?? item.value);
      if (!Number.isFinite(raw)) {
        return;
      }
      totals[item.country] = (totals[item.country] || 0) + raw;
    });
    return totals;
  }, [countryColumnDisplayData]);

  const countryBarOptions = useMemo(() => {
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
        color: countryColorMap[type] || '#52c41a',
      },
      data: categories.map((country) => {
        const cell = countryColumnDisplayData.find(
          (item) => item.country === country && item.type === type,
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
        formatter: (params: any) => {
          const points = Array.isArray(params) ? params : [params];
          const content = points
            .map((param: any) => {
              const rawValue =
                Number(param?.data?.rawValue ?? param?.value) || 0;
              const value = Number(param?.data?.value ?? param?.value) || 0;
              const formatted = formatTooltipValue(countryBarValueMode, value, rawValue);
              return `
                <div style="display:flex;justify-content:space-between">
                  <span>${param.seriesName}</span>
                  <span>${formatted}</span>
                </div>`;
            })
            .join('');
          const axisVal = points[0]?.axisValue ?? '';
          const totalRaw = countryTotals[axisVal] ?? 0;
          const totalFormatted = formatTooltipValue(
            'count',
            totalRaw,
            totalRaw,
          );
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
  }, [countryColumnDisplayData, countryBarValueMode, countryTotals]);

  const countryPieOptions = useMemo(() => {
    if (!countryPieData.length) {
      return {};
    }
    const data = countryPieData.map((item) => ({
      name: item.type,
      value: Number(item.value),
      labelValue: item.labelValue,
    }));
    return {
      tooltip: {
        trigger: 'item',
        formatter: (param: any) => {
          const value = Number(param.value) || 0;
          const rawValue = Number(param.data?.rawValue) || value;
          const formatted = formatTooltipValue(countryPieValueMode, value, rawValue);
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
          color: Object.values(pieColorMap),
        },
      ],
    };
  }, [countryPieData, countryPieValueMode]);

  const variantGroupOptions = useMemo(() => {
    if (!variantGroupDisplayData.length) {
      return {};
    }
    const categories = variantGroupDisplayData.map((item) => item.name);
    const data = variantGroupDisplayData.map((item) => ({
      value: Number(item.broken),
      rawValue: item.rawValue ?? Number(item.broken),
      labelValue: item.labelValue,
    }));
    return {
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const point = Array.isArray(params) ? params[0] : params;
          const rawValue = Number(point?.data?.rawValue ?? point?.value) || 0;
          const value = Number(point?.data?.value ?? point?.value) || 0;
          const formatted = formatTooltipValue(variantGroupValueMode, value, rawValue);
          return `
            <div>${point?.seriesName}</div>
            <div>${formatted}</div>`;
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
          name: '异常',
          type: 'bar',
          data: data.map((item) => ({
            value: item.value,
            labelValue: item.labelValue,
          })),
          itemStyle: {
            color: '#ff4d4f',
          },
        },
      ],
    };
  }, [variantGroupDisplayData, variantGroupValueMode]);

  const { totalChecks, brokenCount, normalCount } = normalizedOverall;

  // 导出数据
  const handleExport = async (format: 'excel' | 'csv' = 'excel') => {
    try {
      const startTime = dateRange[0].format('YYYY-MM-DD 00:00:00');
      const endTime = dateRange[1].format('YYYY-MM-DD 23:59:59');

      const params = new URLSearchParams({
        startTime,
        endTime,
        format,
      });

      if (country) {
        params.append('country', country);
      }

      const url = `/api/v1/export/monitor-history?${params.toString()}`;
      const token = localStorage.getItem('token');

      // 使用 fetch 下载文件，避免 HTTPS 警告
      const response = await fetch(url, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!response.ok) {
        throw new Error('导出失败');
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `监控历史_${dateRange[0].format(
        'YYYY-MM-DD',
      )}_${dateRange[1].format('YYYY-MM-DD')}.${
        format === 'excel' ? 'xlsx' : 'csv'
      }`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);

      message.success(`正在导出${format === 'excel' ? 'Excel' : 'CSV'}文件...`);
    } catch (error) {
      console.error('导出失败:', error);
      message.error('导出失败，请重试');
    }
  };

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
        <Button
          key="refresh"
          type="primary"
          onClick={loadStatistics}
          loading={loading}
        >
          刷新
        </Button>,
      ]}
    >
      {/* 数据说明 */}
      <Alert
        message="数据说明"
        description="本页面的统计数据基于ASIN级别的监控记录，每条记录代表一次对特定ASIN的检查结果。"
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        closable
      />
      {/* 筛选条件 */}
      <Card style={{ marginBottom: 16 }}>
        <Space>
          <span>时间范围：</span>
          <RangePicker
            value={dateRange}
            onChange={(dates) => {
              if (dates) {
                setDateRange([dates[0]!, dates[1]!]);
              }
            }}
            format="YYYY-MM-DD"
          />
          <span>国家：</span>
          <Select
            style={{ width: 150 }}
            value={country}
            onChange={setCountry}
            allowClear
            placeholder="全部国家"
          >
            {Object.entries(countryMap).map(([key, value]) => (
              <Select.Option key={key} value={key}>
                {value}
              </Select.Option>
            ))}
          </Select>
          <span>时间分组：</span>
          <Select style={{ width: 120 }} value={groupBy} onChange={setGroupBy}>
            <Select.Option value="hour">按小时</Select.Option>
            <Select.Option value="day">按天</Select.Option>
            <Select.Option value="week">按周</Select.Option>
            <Select.Option value="month">按月</Select.Option>
          </Select>
          <Button type="primary" onClick={loadStatistics} loading={loading}>
            查询
          </Button>
        </Space>
      </Card>

      {/* 总体统计 */}
      <StatisticCard.Group>
        <StatisticCard
          statistic={{
            title: '总检查次数',
            value: totalChecks,
          }}
        />
        <StatisticCard
          statistic={{
            title: '正常次数',
            value: normalCount,
            status: 'success',
          }}
        />
        <StatisticCard
          statistic={{
            title: '异常次数',
            value: brokenCount,
            status: 'error',
          }}
        />
        <StatisticCard
          statistic={{
            title: '异常率',
            value: totalChecks
              ? `${((brokenCount / totalChecks) * 100).toFixed(2)}%`
              : '0%',
          }}
        />
        {country && peakHoursStatistics.peakTotal !== undefined && (
          <>
            <StatisticCard
              statistic={{
                title: '高峰期异常率',
                value: peakHoursStatistics.peakTotal
                  ? `${(peakHoursStatistics.peakRate || 0).toFixed(2)}%`
                  : '0%',
                description: `高峰期: ${peakHoursStatistics.peakBroken || 0}/${
                  peakHoursStatistics.peakTotal || 0
                }`,
              }}
            />
            <StatisticCard
              statistic={{
                title: '低峰期异常率',
                value: peakHoursStatistics.offPeakTotal
                  ? `${(peakHoursStatistics.offPeakRate || 0).toFixed(2)}%`
                  : '0%',
                description: `低峰期: ${
                  peakHoursStatistics.offPeakBroken || 0
                }/${peakHoursStatistics.offPeakTotal || 0}`,
              }}
            />
          </>
        )}
      </StatisticCard.Group>

      {/* 图表区域 */}
      <Row gutter={16} style={{ marginTop: 16 }}>
        {/* 时间趋势图 */}
        <Col span={24}>
          <Card title="监控趋势分析" loading={loading}>
            {timeChartData.length > 0 ? (
              <ReactECharts
                option={lineChartOptions}
                style={{ width: '100%', height: 420 }}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: 40 }}>暂无数据</div>
            )}
          </Card>
        </Col>

        {/* 国家统计 */}
        <Col span={12} style={{ marginTop: 16 }}>
          <Card
            title="国家维度统计（柱状图）"
            loading={loading}
            extra={
              <Radio.Group
                value={countryBarValueMode}
                onChange={(e) => setCountryBarValueMode(e.target.value)}
                optionType="button"
                buttonStyle="solid"
                size="small"
              >
                <Radio.Button value="count">数量</Radio.Button>
                <Radio.Button value="percent">百分比</Radio.Button>
              </Radio.Group>
            }
          >
            {countryColumnDisplayData.length > 0 ? (
              <ReactECharts
                option={countryBarOptions}
                style={{ width: '100%', height: 320 }}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: 40 }}>暂无数据</div>
            )}
          </Card>
        </Col>

        <Col span={12} style={{ marginTop: 16 }}>
          <Card
            title="国家维度统计（饼图）"
            loading={loading}
            extra={
              <Radio.Group
                value={countryPieValueMode}
                onChange={(e) => setCountryPieValueMode(e.target.value)}
                optionType="button"
                buttonStyle="solid"
                size="small"
              >
                <Radio.Button value="count">数量</Radio.Button>
                <Radio.Button value="percent">百分比</Radio.Button>
              </Radio.Group>
            }
          >
            {countryPieData.length > 0 ? (
              <ReactECharts
                option={countryPieOptions}
                style={{ width: '100%', height: 320 }}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: 40 }}>暂无数据</div>
            )}
          </Card>
        </Col>

        {/* 变体组统计 */}
        <Col span={24} style={{ marginTop: 16 }}>
          <Card
            title="变体组异常统计（Top 10）"
            loading={loading}
            extra={
              <Radio.Group
                value={variantGroupValueMode}
                onChange={(e) => setVariantGroupValueMode(e.target.value)}
                optionType="button"
                buttonStyle="solid"
                size="small"
              >
                <Radio.Button value="count">数量</Radio.Button>
                <Radio.Button value="percent">百分比</Radio.Button>
              </Radio.Group>
            }
          >
            {variantGroupDisplayData.length > 0 ? (
              <ReactECharts
                option={variantGroupOptions}
                style={{ width: '100%', height: 360 }}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: 40 }}>暂无数据</div>
            )}
          </Card>
        </Col>
      </Row>

      {/* 汇总表格区域 */}
      <Row gutter={16} style={{ marginTop: 16 }}>
        {/* 全部国家汇总表格 */}
        <Col span={24}>
          <Card
            title="全部国家汇总表格"
            loading={loading}
            extra={
              <Space>
                <span>时间槽粒度：</span>
                <Select
                  style={{ width: 120 }}
                  value={allCountriesTimeSlot}
                  onChange={(value) => {
                    setAllCountriesTimeSlot(value);
                    // 重新加载该表格数据
                    const startTime = dateRange[0].format('YYYY-MM-DD HH:mm:ss');
                    const endTime = dateRange[1].format('YYYY-MM-DD HH:mm:ss');
                    getAllCountriesSummary({
                      startTime,
                      endTime,
                      timeSlotGranularity: value,
                    }).then((result: any) => {
                      const allCountriesStats =
                        result && typeof result === 'object' && !('success' in result)
                          ? result
                          : result?.data || null;
                      setAllCountriesSummary(allCountriesStats);
                    });
                  }}
                >
                  <Select.Option value="hour">按小时</Select.Option>
                  <Select.Option value="day">按天</Select.Option>
                </Select>
              </Space>
            }
          >
            {allCountriesSummary ? (
              <Table
                dataSource={[allCountriesSummary]}
                pagination={false}
                columns={[
                  {
                    title: '时间段',
                    dataIndex: 'timeRange',
                    key: 'timeRange',
                  },
                  {
                    title: '总数量(监控链接)',
                    dataIndex: 'totalChecks',
                    key: 'totalChecks',
                    align: 'right',
                  },
                  {
                    title: '所有ASIN异常占比 (ratio_all_asin)',
                    dataIndex: 'ratioAllAsin',
                    key: 'ratioAllAsin',
                    align: 'right',
                    render: (value: number) => `${value.toFixed(2)}%`,
                  },
                  {
                    title: '所有ASIN异常时长占比 (ratio_all_time)',
                    dataIndex: 'ratioAllTime',
                    key: 'ratioAllTime',
                    align: 'right',
                    render: (value: number) => `${value.toFixed(2)}%`,
                  },
                  {
                    title: '全局高峰异常占比 (global_peak_rate)',
                    dataIndex: 'globalPeakRate',
                    key: 'globalPeakRate',
                    align: 'right',
                    render: (value: number) => `${value.toFixed(2)}%`,
                  },
                  {
                    title: '全局低峰异常占比 (global_low_rate)',
                    dataIndex: 'globalLowRate',
                    key: 'globalLowRate',
                    align: 'right',
                    render: (value: number) => `${value.toFixed(2)}%`,
                  },
                  {
                    title: '局部高峰异常占比 (ratio_high)',
                    dataIndex: 'ratioHigh',
                    key: 'ratioHigh',
                    align: 'right',
                    render: (value: number) => `${value.toFixed(2)}%`,
                  },
                  {
                    title: '局部低峰异常占比 (ratio_low)',
                    dataIndex: 'ratioLow',
                    key: 'ratioLow',
                    align: 'right',
                    render: (value: number) => `${value.toFixed(2)}%`,
                  },
                ]}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: 40 }}>暂无数据</div>
            )}
          </Card>
        </Col>

        {/* 美国/欧洲表格 */}
        <Col span={24} style={{ marginTop: 16 }}>
          <Card
            title="美国/欧洲表格"
            loading={loading}
            extra={
              <Space>
                <span>时间槽粒度：</span>
                <Select
                  style={{ width: 120 }}
                  value={regionTimeSlot}
                  onChange={(value) => {
                    setRegionTimeSlot(value);
                    // 重新加载该表格数据
                    const startTime = dateRange[0].format('YYYY-MM-DD HH:mm:ss');
                    const endTime = dateRange[1].format('YYYY-MM-DD HH:mm:ss');
                    getRegionSummary({
                      startTime,
                      endTime,
                      timeSlotGranularity: value,
                    }).then((result: any) => {
                      const regionStats =
                        result && typeof result === 'object' && !('success' in result)
                          ? result
                          : result?.data || [];
                      setRegionSummary(regionStats);
                    });
                  }}
                >
                  <Select.Option value="hour">按小时</Select.Option>
                  <Select.Option value="day">按天</Select.Option>
                </Select>
              </Space>
            }
          >
            {regionSummary.length > 0 ? (
              <Table
                dataSource={regionSummary}
                pagination={false}
                rowKey="regionCode"
                columns={[
                  {
                    title: '区域',
                    dataIndex: 'region',
                    key: 'region',
                    render: (text: string, record: API.RegionSummary) => (
                      <Tag color={record.regionCode === 'US' ? 'blue' : 'green'}>
                        {text}
                      </Tag>
                    ),
                  },
                  {
                    title: '时间段',
                    dataIndex: 'timeRange',
                    key: 'timeRange',
                  },
                  {
                    title: '总数量(监控链接)',
                    dataIndex: 'totalChecks',
                    key: 'totalChecks',
                    align: 'right',
                  },
                  {
                    title: '所有ASIN异常占比 (ratio_all_asin)',
                    dataIndex: 'ratioAllAsin',
                    key: 'ratioAllAsin',
                    align: 'right',
                    render: (value: number) => `${value.toFixed(2)}%`,
                  },
                  {
                    title: '所有ASIN异常时长占比 (ratio_all_time)',
                    dataIndex: 'ratioAllTime',
                    key: 'ratioAllTime',
                    align: 'right',
                    render: (value: number) => `${value.toFixed(2)}%`,
                  },
                  {
                    title: '全局高峰异常占比 (global_peak_rate)',
                    dataIndex: 'globalPeakRate',
                    key: 'globalPeakRate',
                    align: 'right',
                    render: (value: number) => `${value.toFixed(2)}%`,
                  },
                  {
                    title: '全局低峰异常占比 (global_low_rate)',
                    dataIndex: 'globalLowRate',
                    key: 'globalLowRate',
                    align: 'right',
                    render: (value: number) => `${value.toFixed(2)}%`,
                  },
                  {
                    title: '局部高峰异常占比 (ratio_high)',
                    dataIndex: 'ratioHigh',
                    key: 'ratioHigh',
                    align: 'right',
                    render: (value: number) => `${value.toFixed(2)}%`,
                  },
                  {
                    title: '局部低峰异常占比 (ratio_low)',
                    dataIndex: 'ratioLow',
                    key: 'ratioLow',
                    align: 'right',
                    render: (value: number) => `${value.toFixed(2)}%`,
                  },
                ]}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: 40 }}>暂无数据</div>
            )}
          </Card>
        </Col>

        {/* 周期汇总表格 */}
        <Col span={24} style={{ marginTop: 16 }}>
          <Card
            title="周期汇总表格"
            loading={loading}
            extra={
              <Space>
                <Select
                  style={{ width: 120 }}
                  placeholder="国家"
                  allowClear
                  value={periodFilter.country}
                  onChange={(value) =>
                    setPeriodFilter({ ...periodFilter, country: value })
                  }
                >
                  {Object.entries(countryMap).map(([key, value]) => (
                    <Select.Option key={key} value={key}>
                      {value}
                    </Select.Option>
                  ))}
                </Select>
                <Input
                  style={{ width: 150 }}
                  placeholder="站点"
                  allowClear
                  value={periodFilter.site}
                  onChange={(e) =>
                    setPeriodFilter({ ...periodFilter, site: e.target.value })
                  }
                />
                <Input
                  style={{ width: 150 }}
                  placeholder="品牌"
                  allowClear
                  value={periodFilter.brand}
                  onChange={(e) =>
                    setPeriodFilter({ ...periodFilter, brand: e.target.value })
                  }
                />
                <span>时间槽粒度：</span>
                <Select
                  style={{ width: 120 }}
                  value={periodTimeSlot}
                  onChange={(value) => {
                    setPeriodTimeSlot(value);
                    // 重新加载该表格数据
                    const startTime = dateRange[0].format('YYYY-MM-DD HH:mm:ss');
                    const endTime = dateRange[1].format('YYYY-MM-DD HH:mm:ss');
                    getPeriodSummary({
                      startTime,
                      endTime,
                      ...periodFilter,
                      timeSlotGranularity: value,
                      current: periodSummary.current,
                      pageSize: periodSummary.pageSize,
                    }).then((result: any) => {
                      const periodStats =
                        result && typeof result === 'object' && !('success' in result)
                          ? result
                          : result?.data || { list: [], total: 0, current: periodSummary.current, pageSize: periodSummary.pageSize };
                      setPeriodSummary(periodStats);
                    });
                  }}
                >
                  <Select.Option value="hour">按小时</Select.Option>
                  <Select.Option value="day">按天</Select.Option>
                </Select>
                <Button
                  type="primary"
                  onClick={loadStatistics}
                  loading={loading}
                >
                  查询
                </Button>
              </Space>
            }
          >
            {periodSummary.list.length > 0 ? (
              <Table
                dataSource={periodSummary.list}
                pagination={{
                  current: periodSummary.current,
                  pageSize: periodSummary.pageSize,
                  total: periodSummary.total,
                  showSizeChanger: true,
                  showTotal: (total) => `共 ${total} 条`,
                  onChange: (page, size) => {
                    const newSummary = {
                      ...periodSummary,
                      current: page,
                      pageSize: size || 10,
                    };
                    setPeriodSummary(newSummary);
                    // 重新加载数据
                    const startTime = dateRange[0].format('YYYY-MM-DD HH:mm:ss');
                    const endTime = dateRange[1].format('YYYY-MM-DD HH:mm:ss');
                    getPeriodSummary({
                      startTime,
                      endTime,
                      ...periodFilter,
                      timeSlotGranularity: periodTimeSlot,
                      current: page,
                      pageSize: size || 10,
                    }).then((result: any) => {
                      const periodStats =
                        result && typeof result === 'object' && !('success' in result)
                          ? result
                          : result?.data || { list: [], total: 0, current: page, pageSize: size || 10 };
                      setPeriodSummary(periodStats);
                    });
                  },
                }}
                rowKey={(record, index) =>
                  `${record.timeSlot}_${record.country}_${record.site}_${record.brand}_${index}`
                }
                columns={[
                  {
                    title: '时间槽',
                    dataIndex: 'timeSlot',
                    key: 'timeSlot',
                  },
                  {
                    title: '国家',
                    dataIndex: 'country',
                    key: 'country',
                    render: (text: string) =>
                      text ? countryMap[text] || text : '-',
                  },
                  {
                    title: '站点',
                    dataIndex: 'site',
                    key: 'site',
                    render: (text: string) => text || '-',
                  },
                  {
                    title: '品牌',
                    dataIndex: 'brand',
                    key: 'brand',
                    render: (text: string) => text || '-',
                  },
                  {
                    title: '总数量(监控链接)',
                    dataIndex: 'totalChecks',
                    key: 'totalChecks',
                    align: 'right',
                  },
                  {
                    title: '所有ASIN异常占比 (ratio_all_asin)',
                    dataIndex: 'ratioAllAsin',
                    key: 'ratioAllAsin',
                    align: 'right',
                    render: (value: number) => `${value.toFixed(2)}%`,
                  },
                  {
                    title: '所有ASIN异常时长占比 (ratio_all_time)',
                    dataIndex: 'ratioAllTime',
                    key: 'ratioAllTime',
                    align: 'right',
                    render: (value: number) => `${value.toFixed(2)}%`,
                  },
                  {
                    title: '全局高峰异常占比 (global_peak_rate)',
                    dataIndex: 'globalPeakRate',
                    key: 'globalPeakRate',
                    align: 'right',
                    render: (value: number) => `${value.toFixed(2)}%`,
                  },
                  {
                    title: '全局低峰异常占比 (global_low_rate)',
                    dataIndex: 'globalLowRate',
                    key: 'globalLowRate',
                    align: 'right',
                    render: (value: number) => `${value.toFixed(2)}%`,
                  },
                  {
                    title: '局部高峰异常占比 (ratio_high)',
                    dataIndex: 'ratioHigh',
                    key: 'ratioHigh',
                    align: 'right',
                    render: (value: number) => `${value.toFixed(2)}%`,
                  },
                  {
                    title: '局部低峰异常占比 (ratio_low)',
                    dataIndex: 'ratioLow',
                    key: 'ratioLow',
                    align: 'right',
                    render: (value: number) => `${value.toFixed(2)}%`,
                  },
                ]}
                scroll={{ x: 1400 }}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: 40 }}>暂无数据</div>
            )}
          </Card>
        </Col>
      </Row>
    </PageContainer>
  );
};

export default AnalyticsPageContent;
