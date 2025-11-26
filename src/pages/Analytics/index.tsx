import services from '@/services/asin';
import { useMessage } from '@/utils/message';
import { PageContainer, StatisticCard } from '@ant-design/pro-components';
import { Button, Card, Col, DatePicker, Radio, Row, Select, Space } from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import ReactECharts from 'echarts-for-react';
import React, { useEffect, useMemo, useState } from 'react';

const { RangePicker } = DatePicker;
const {
  getStatisticsByTime,
  getStatisticsByCountry,
  getStatisticsByVariantGroup,
  getMonitorStatistics,
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
  data.filter((item) => Number.isFinite(Number(item[key])));

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
  const [valueMode, setValueMode] = useState<'count' | 'percent'>('count');

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

  // 加载所有统计数据
  const loadStatistics = async () => {
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
      const [timeData, countryData, variantGroupData, overallData] =
        await Promise.all([
          getStatisticsByTime({ ...params, groupBy }),
          getStatisticsByCountry(params),
          getStatisticsByVariantGroup({ ...params, limit: 10 }),
          getMonitorStatistics(params),
        ]);

      // 处理响应数据
      const timeStats =
        timeData && typeof timeData === 'object' && !('success' in timeData)
          ? timeData
          : (timeData as any)?.data || [];
      const countryStats =
        countryData &&
        typeof countryData === 'object' &&
        !('success' in countryData)
          ? countryData
          : (countryData as any)?.data || [];
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
    } catch (error) {
      console.error('加载统计数据失败:', error);
      message.error('加载统计数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatistics();
  }, []);

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
    const multiplier =
      valueMode === 'percent'
        ? normalizedOverall.totalChecks
          ? 100 / normalizedOverall.totalChecks
          : 0
        : 1;
    return timeStatistics.flatMap((item) => {
      const timeLabel = item.time_period || (item as any).timePeriod || '';
      const parsedTime = parseTimeLabel(timeLabel);
      if (!parsedTime) {
        return [];
      }
      const brokenCount = toNumber(item.broken_count);
      const normalCount = toNumber(item.normal_count);
      const totalCount = toNumber(item.total_checks);
      const rows = [
        {
          time: parsedTime,
          type: '异常',
          value: brokenCount * multiplier,
          rawValue: brokenCount,
        },
        {
          time: parsedTime,
          type: '正常',
          value: normalCount * multiplier,
          rawValue: normalCount,
        },
        {
          time: parsedTime,
          type: '总计',
          value: totalCount * multiplier,
          rawValue: totalCount,
        },
      ];
      return rows
        .filter((row) => Number.isFinite(row.value))
        .map((row) => attachLabelValue(row, valueMode));
    });
  }, [timeStatistics, valueMode, normalizedOverall.totalChecks]);

  const lineTypes = ['异常', '正常', '总计'] as const;
  const lineColorMap: Record<string, string> = {
    异常: '#1890ff',
    正常: '#52c41a',
    总计: '#ff9c28',
  };
  const countryColorMap: Record<string, string> = {
    异常: '#ff4d4f',
    正常: '#52c41a',
  };
  const pieColorMap: Record<string, string> = {
    ...countryColorMap,
  };

  const lineChartOptions = useMemo(() => {
    const series = lineTypes.map((type) => {
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
      };
    });
    return {
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const points = Array.isArray(params) ? params : [params];
          const content = points
            .map((param: any) => {
              const value = Number(param.value?.[1]) || 0;
              const rawValue = Number(param.value?.[2]) || 0;
              const formatted = formatTooltipValue(valueMode, value, rawValue);
              return `
                <div style="display:flex;justify-content:space-between">
                  <span>${param.seriesName}</span>
                  <span>${formatted}</span>
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
      yAxis: {
        type: 'value',
      },
      series,
    };
  }, [timeChartData, valueMode]);

  // 国家统计柱状图数据
  // 注意：确保数据顺序与颜色数组顺序一致
  const countryColumnData = useMemo(() => {
    const data = countryStatistics.flatMap((item) => {
      const countryLabel = countryMap[item.country || ''] || item.country;
      const broken = toNumber(item.broken_count);
      const normal = toNumber(item.normal_count);
      return [
        attachLabelValue(
          {
            country: countryLabel,
            type: '异常',
            value: broken,
            rawValue: broken,
          },
          valueMode,
        ),
        attachLabelValue(
          {
            country: countryLabel,
            type: '正常',
            value: normal,
            rawValue: normal,
          },
          valueMode,
        ),
      ];
    });
    return filterValidValuesByKey(data, 'value');
  }, [countryStatistics, valueMode]);

  const countryColumnDisplayData = useMemo(() => {
    if (valueMode === 'count') {
      return countryColumnData;
    }
    const total = countryColumnData.reduce((sum, item) => sum + item.value, 0);
    const percentData = countryColumnData.map((item) =>
      attachLabelValue(
        {
          ...item,
          value: total ? (item.value / total) * 100 : 0,
        },
        valueMode,
      ),
    );
    return filterValidValuesByKey(percentData, 'value');
  }, [countryColumnData, valueMode]);

  // 国家统计饼图数据
  const countryPieData = useMemo(() => {
    const data = countryStatistics.map((item) => {
      const total = toNumber(item.total_checks);
      return attachLabelValue(
        {
          type: countryMap[item.country || ''] || item.country,
          value: total,
          rawValue: total,
        },
        valueMode,
      );
    });
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
  }, [countryStatistics, valueMode]);

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
        valueMode,
      );
    });
    return filterValidValuesByKey(data, 'broken');
  }, [variantGroupStatistics, valueMode]);

  const variantGroupDisplayData = useMemo(() => {
    if (valueMode === 'count') {
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
        valueMode,
      ),
    );
    return filterValidValuesByKey(percentData, 'broken');
  }, [variantGroupColumnData, valueMode]);

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
              const value = Number(param.value?.[0]) || 0;
              const rawValue = Number(param.value?.[2]) || 0;
              const formatted = formatTooltipValue(valueMode, value, rawValue);
              return `
                <div style="display:flex;justify-content:space-between">
                  <span>${param.seriesName}</span>
                  <span>${formatted}</span>
                </div>`;
            })
            .join('');
          const axisVal = points[0]?.axisValue ?? '';
          return `<div style="margin-bottom:4px;font-weight:600;">${axisVal}</div>${content}`;
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
  }, [countryColumnDisplayData, valueMode]);

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
          color: Object.values(pieColorMap),
        },
      ],
    };
  }, [countryPieData, valueMode]);

  const variantGroupOptions = useMemo(() => {
    if (!variantGroupDisplayData.length) {
      return {};
    }
    const categories = variantGroupDisplayData.map((item) => item.name);
    const data = variantGroupDisplayData.map((item) => ({
      value: Number(item.broken),
      labelValue: item.labelValue,
    }));
    return {
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const point = Array.isArray(params) ? params[0] : params;
          const value = Number(point?.value?.[0]) || 0;
          const rawValue = Number(point?.value?.[2]) || value;
          const formatted = formatTooltipValue(valueMode, value, rawValue);
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
  }, [variantGroupDisplayData, valueMode]);

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

      const url = `/api/v1/monitor-history/export?${params.toString()}`;

      // 使用 fetch 下载文件，避免 HTTPS 警告
      const response = await fetch(url);
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
          <Radio.Group
            value={valueMode}
            onChange={(e) => setValueMode(e.target.value)}
            optionType="button"
            buttonStyle="solid"
            size="small"
          >
            <Radio.Button value="count">数量</Radio.Button>
            <Radio.Button value="percent">百分比</Radio.Button>
          </Radio.Group>
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
          <Card title="国家维度统计（柱状图）" loading={loading}>
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
          <Card title="国家维度统计（饼图）" loading={loading}>
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
          <Card title="变体组异常统计（Top 10）" loading={loading}>
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
    </PageContainer>
  );
};

export default AnalyticsPageContent;
