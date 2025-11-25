import services from '@/services/asin';
import { useMessage } from '@/utils/message';
import { Column, Line, Pie } from '@ant-design/charts';
import { PageContainer, StatisticCard } from '@ant-design/pro-components';
import { Button, Card, Col, DatePicker, Row, Select, Space } from 'antd';
import dayjs, { Dayjs } from 'dayjs';
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

const AnalyticsPageContent: React.FC<unknown> = () => {
  const message = useMessage();
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([
    dayjs().startOf('day'),
    dayjs().endOf('day'),
  ]);
  const [country, setCountry] = useState<string>('');
  const [groupBy, setGroupBy] = useState<string>('hour');
  const [loading, setLoading] = useState(false);

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
  const timeChartData = useMemo(() => {
    return timeStatistics.flatMap((item) => [
      { time: item.time_period, type: '异常', value: item.broken_count || 0 },
      { time: item.time_period, type: '正常', value: item.normal_count || 0 },
      { time: item.time_period, type: '总计', value: item.total_checks || 0 },
    ]);
  }, [timeStatistics]);

  // 国家统计柱状图数据
  // 注意：确保数据顺序与颜色数组顺序一致
  const countryColumnData = useMemo(() => {
    return countryStatistics.flatMap((item) => [
      {
        country: countryMap[item.country || ''] || item.country,
        type: '异常',
        value: item.broken_count || 0,
      },
      {
        country: countryMap[item.country || ''] || item.country,
        type: '正常',
        value: item.normal_count || 0,
      },
    ]);
  }, [countryStatistics]);

  // 国家统计饼图数据
  const countryPieData = countryStatistics.map((item) => ({
    type: countryMap[item.country || ''] || item.country,
    value: item.total_checks || 0,
  }));

  // 变体组统计柱状图数据
  const variantGroupColumnData = variantGroupStatistics.map((item) => ({
    name: item.variant_group_name || '未知',
    broken: item.broken_count || 0,
  }));

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
        </Space>
      </Card>

      {/* 总体统计 */}
      <StatisticCard.Group>
        <StatisticCard
          statistic={{
            title: '总检查次数',
            value: overallStatistics.totalChecks || 0,
          }}
        />
        <StatisticCard
          statistic={{
            title: '正常次数',
            value: overallStatistics.normalCount || 0,
            status: 'success',
          }}
        />
        <StatisticCard
          statistic={{
            title: '异常次数',
            value: overallStatistics.brokenCount || 0,
            status: 'error',
          }}
        />
        <StatisticCard
          statistic={{
            title: '异常率',
            value: overallStatistics.totalChecks
              ? `${(
                  ((overallStatistics.brokenCount || 0) /
                    overallStatistics.totalChecks) *
                  100
                ).toFixed(2)}%`
              : '0%',
          }}
        />
      </StatisticCard.Group>

      {/* 图表区域 */}
      <Row gutter={16} style={{ marginTop: 16 }}>
        {/* 时间趋势图 */}
        <Col span={24}>
          <Card title="监控趋势分析" loading={loading}>
            {timeStatistics.length > 0 ? (
              <Line
                data={timeChartData}
                xField="time"
                yField="value"
                seriesField="type"
                smooth
                point={{
                  size: 6,
                  shape: 'circle',
                  style: {
                    fillOpacity: 1,
                    stroke: '#fff',
                    lineWidth: 2,
                  },
                }}
                lineStyle={{
                  lineWidth: 4,
                }}
                legend={{
                  position: 'top',
                  itemName: {
                    style: {
                      fill: '#333',
                      fontSize: 14,
                      fontWeight: 'bold',
                    },
                  },
                }}
                color={['#ff4d4f', '#52c41a', '#1890ff']}
                tooltip={{
                  showCrosshairs: true,
                  shared: true,
                }}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: 40 }}>暂无数据</div>
            )}
          </Card>
        </Col>

        {/* 国家统计 */}
        <Col span={12} style={{ marginTop: 16 }}>
          <Card title="国家维度统计（柱状图）" loading={loading}>
            {countryStatistics.length > 0 ? (
              <Column
                data={countryColumnData}
                xField="country"
                yField="value"
                seriesField="type"
                isStack
                columnStyle={{
                  radius: [4, 4, 0, 0],
                  fillOpacity: 0.9,
                }}
                legend={{
                  position: 'top',
                  itemName: {
                    style: {
                      fill: '#333',
                      fontSize: 14,
                      fontWeight: 'bold',
                    },
                  },
                }}
                color={['#ff4d4f', '#52c41a']}
                tooltip={{
                  shared: true,
                  showCrosshairs: false,
                }}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: 40 }}>暂无数据</div>
            )}
          </Card>
        </Col>

        <Col span={12} style={{ marginTop: 16 }}>
          <Card title="国家维度统计（饼图）" loading={loading}>
            {countryStatistics.length > 0 ? (
              <Pie
                data={countryPieData}
                angleField="value"
                colorField="type"
                radius={0.8}
                label={{
                  type: 'inner',
                  offset: '-30%',
                  content: (item: any) => `${item.type}\n${item.value}`,
                }}
                interactions={[{ type: 'element-active' }]}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: 40 }}>暂无数据</div>
            )}
          </Card>
        </Col>

        {/* 变体组统计 */}
        <Col span={24} style={{ marginTop: 16 }}>
          <Card title="变体组异常统计（Top 10）" loading={loading}>
            {variantGroupStatistics.length > 0 ? (
              <Column
                data={variantGroupColumnData}
                xField="name"
                yField="broken"
                columnStyle={{
                  fill: '#ff4d4f',
                  radius: [4, 4, 0, 0],
                }}
                color="#ff4d4f"
                tooltip={{
                  showCrosshairs: false,
                }}
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
