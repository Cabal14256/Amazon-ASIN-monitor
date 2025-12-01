import services from '@/services/dashboard';
import { useMessage } from '@/utils/message';
import { PageContainer, StatisticCard } from '@ant-design/pro-components';
import { history } from '@umijs/max';
import {
  Button,
  Card,
  Col,
  Empty,
  List,
  Row,
  Space,
  Tag,
  Timeline,
} from 'antd';
import dayjs from 'dayjs';
import ReactECharts from 'echarts-for-react';
import React, { useEffect, useState } from 'react';
import styles from './index.less';

const { getDashboardData } = services.DashboardController;

// 国家选项映射
const countryMap: Record<string, string> = {
  US: '美国',
  UK: '英国',
  DE: '德国',
  FR: '法国',
  IT: '意大利',
  ES: '西班牙',
};

// 工具函数
const toNumber = (value: unknown) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

// 颜色映射
const countryColorMap: Record<string, string> = {
  异常: '#ff4d4f',
  正常: '#52c41a',
};

const pieColorMap: Record<string, string> = {
  ...countryColorMap,
};

const HomePage: React.FC = () => {
  const message = useMessage();
  const [loading, setLoading] = useState(false);
  const [dashboardData, setDashboardData] = useState<API.DashboardData>({});

  // 加载仪表盘数据
  const loadDashboardData = async () => {
    setLoading(true);
    try {
      const response = await getDashboardData();
      console.log('[Dashboard] API响应:', response);

      if (response?.success && response?.data) {
        setDashboardData(response.data);
      } else {
        const errorMessage =
          response?.errorMessage ||
          response?.data?.errorMessage ||
          '加载仪表盘数据失败';
        console.error('[Dashboard] 响应失败:', response);
        message.error(errorMessage);
      }
    } catch (error: any) {
      console.error('[Dashboard] 加载仪表盘数据失败:', error);
      const errorMessage =
        error?.response?.data?.errorMessage ||
        error?.data?.errorMessage ||
        error?.errorMessage ||
        error?.message ||
        '加载仪表盘数据失败';
      message.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboardData();
    // 每30秒自动刷新一次
    const interval = setInterval(loadDashboardData, 30000);
    return () => clearInterval(interval);
  }, []);

  const { overview, realtimeAlerts, distribution, recentActivities } =
    dashboardData;

  // 国家分布柱状图数据（ECharts格式）
  const countryColumnData = React.useMemo(() => {
    const data = (distribution?.byCountry || []).map((item) => {
      const countryLabel = countryMap[item.country || ''] || item.country;
      const normal = toNumber(item.normal);
      const broken = toNumber(item.broken);
      return {
        country: countryLabel,
        normal,
        broken,
        total: normal + broken,
      };
    });
    return data.filter((item) => item.total > 0);
  }, [distribution]);

  // 国家分布柱状图配置（ECharts）
  const countryBarOptions = React.useMemo(() => {
    if (!countryColumnData.length) {
      return {};
    }
    const categories = countryColumnData.map((item) => item.country);
    const series = [
      {
        name: '正常',
        type: 'bar',
        stack: 'total',
        emphasis: {
          focus: 'series',
        },
        itemStyle: {
          color: countryColorMap['正常'] || '#52c41a',
        },
        data: countryColumnData.map((item) => item.normal),
      },
      {
        name: '异常',
        type: 'bar',
        stack: 'total',
        emphasis: {
          focus: 'series',
        },
        itemStyle: {
          color: countryColorMap['异常'] || '#ff4d4f',
        },
        data: countryColumnData.map((item) => item.broken),
      },
    ];
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
              const value = Number(param.value) || 0;
              return `
                <div style="display:flex;justify-content:space-between">
                  <span>${param.seriesName}</span>
                  <span>${value}</span>
                </div>`;
            })
            .join('');
          const axisVal = points[0]?.axisValue ?? '';
          const item = countryColumnData.find((d) => d.country === axisVal);
          const total = item ? item.total : 0;
          return `<div style="margin-bottom:4px;font-weight:600;">${axisVal}（总计：${total}）</div>${content}`;
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
  }, [countryColumnData]);

  // 状态分布饼图数据（ECharts格式）
  const statusPieData = React.useMemo(() => {
    const normal = toNumber(overview?.normalGroups);
    const broken = toNumber(overview?.brokenGroups);
    return [
      {
        name: '正常',
        value: normal,
      },
      {
        name: '异常',
        value: broken,
      },
    ].filter((item) => item.value > 0);
  }, [overview]);

  // 状态分布饼图配置（ECharts）
  const statusPieOptions = React.useMemo(() => {
    if (!statusPieData.length) {
      return {};
    }
    return {
      tooltip: {
        trigger: 'item',
        formatter: (param: any) => {
          const value = Number(param.value) || 0;
          return `${param.name}<br/>${value}`;
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
          name: '状态分布',
          type: 'pie',
          radius: ['45%', '70%'],
          avoidLabelOverlap: false,
          labelLine: {
            length: 12,
            length2: 6,
          },
          data: statusPieData,
          color: statusPieData.map(
            (item) => pieColorMap[item.name] || '#52c41a',
          ),
        },
      ],
    };
  }, [statusPieData]);

  return (
    <PageContainer
      header={{
        title: '监控仪表盘',
        breadcrumb: {},
      }}
      extra={[
        <Button key="refresh" onClick={loadDashboardData} loading={loading}>
          刷新
        </Button>,
      ]}
      loading={loading}
    >
      {/* 关键指标概览卡片 */}
      <StatisticCard.Group>
        <StatisticCard
          statistic={{
            title: '总变体组数',
            value: overview?.totalGroups || 0,
            prefix: '📦',
          }}
        />
        <StatisticCard
          statistic={{
            title: '总ASIN数',
            value: overview?.totalASINs || 0,
            prefix: '🔗',
          }}
        />
        <StatisticCard
          statistic={{
            title: '异常变体组',
            value: overview?.brokenGroups || 0,
            status: overview?.brokenGroups ? 'error' : 'success',
            prefix: overview?.brokenGroups ? '⚠️' : '✅',
          }}
        />
        <StatisticCard
          statistic={{
            title: '异常ASIN',
            value: overview?.brokenASINs || 0,
            status: overview?.brokenASINs ? 'error' : 'success',
            prefix: overview?.brokenASINs ? '⚠️' : '✅',
          }}
        />
        <StatisticCard
          statistic={{
            title: '今日检查次数',
            value: overview?.todayChecks || 0,
            prefix: '📊',
          }}
        />
        <StatisticCard
          statistic={{
            title: '今日异常次数',
            value: overview?.todayBroken || 0,
            status: overview?.todayBroken ? 'error' : 'success',
            prefix: overview?.todayBroken ? '⚠️' : '✅',
          }}
        />
      </StatisticCard.Group>

      <Row gutter={16} style={{ marginTop: 16 }}>
        {/* 实时异常监控面板 */}
        <Col span={12}>
          <Card
            title="实时异常监控"
            className={styles.alertCard}
            extra={
              <Button
                type="link"
                size="small"
                onClick={() => history.push('/asin')}
              >
                查看全部
              </Button>
            }
          >
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              {/* 异常变体组 */}
              <div>
                <div style={{ marginBottom: 8, fontWeight: 600 }}>
                  异常变体组 ({realtimeAlerts?.brokenGroups?.length || 0})
                </div>
                {realtimeAlerts?.brokenGroups &&
                realtimeAlerts.brokenGroups.length > 0 ? (
                  <List
                    size="small"
                    dataSource={realtimeAlerts.brokenGroups}
                    renderItem={(item) => (
                      <List.Item>
                        <Space
                          direction="vertical"
                          size="small"
                          style={{ width: '100%' }}
                        >
                          <div>
                            <Tag color="red">异常</Tag>
                            <span style={{ fontWeight: 500 }}>{item.name}</span>
                          </div>
                          <div style={{ fontSize: 12, color: '#666' }}>
                            {countryMap[item.country || ''] || item.country} |{' '}
                            {item.brand} | 站点: {item.site}
                          </div>
                          <div style={{ fontSize: 12, color: '#999' }}>
                            更新时间:{' '}
                            {item.update_time
                              ? dayjs(item.update_time).format(
                                  'YYYY-MM-DD HH:mm:ss',
                                )
                              : '-'}
                          </div>
                        </Space>
                      </List.Item>
                    )}
                  />
                ) : (
                  <Empty
                    description="暂无异常变体组"
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                  />
                )}
              </div>

              {/* 异常ASIN */}
              <div>
                <div style={{ marginBottom: 8, fontWeight: 600 }}>
                  异常ASIN ({realtimeAlerts?.brokenASINs?.length || 0})
                </div>
                {realtimeAlerts?.brokenASINs &&
                realtimeAlerts.brokenASINs.length > 0 ? (
                  <List
                    size="small"
                    dataSource={realtimeAlerts.brokenASINs}
                    renderItem={(item) => (
                      <List.Item>
                        <Space
                          direction="vertical"
                          size="small"
                          style={{ width: '100%' }}
                        >
                          <div>
                            <Tag color="red">异常</Tag>
                            <span
                              style={{
                                fontFamily: 'monospace',
                                fontWeight: 500,
                              }}
                            >
                              {item.asin}
                            </span>
                            {item.name && <span> - {item.name}</span>}
                          </div>
                          <div style={{ fontSize: 12, color: '#666' }}>
                            变体组: {item.variant_group_name || '-'} |{' '}
                            {countryMap[item.country || ''] || item.country} |{' '}
                            {item.brand}
                          </div>
                          <div style={{ fontSize: 12, color: '#999' }}>
                            更新时间:{' '}
                            {item.update_time
                              ? dayjs(item.update_time).format(
                                  'YYYY-MM-DD HH:mm:ss',
                                )
                              : '-'}
                          </div>
                        </Space>
                      </List.Item>
                    )}
                  />
                ) : (
                  <Empty
                    description="暂无异常ASIN"
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                  />
                )}
              </div>
            </Space>
          </Card>
        </Col>

        {/* 监控状态分布图表 */}
        <Col span={12}>
          <Card title="监控状态分布">
            <Row gutter={16}>
              <Col span={12}>
                <Card
                  size="small"
                  title="按国家分布"
                  style={{ marginBottom: 16 }}
                >
                  {countryColumnData.length > 0 ? (
                    <ReactECharts
                      option={countryBarOptions}
                      style={{ height: 200 }}
                      opts={{ renderer: 'svg' }}
                    />
                  ) : (
                    <Empty
                      description="暂无数据"
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      style={{ padding: 40 }}
                    />
                  )}
                </Card>
              </Col>
              <Col span={12}>
                <Card size="small" title="状态分布">
                  {statusPieData.length > 0 ? (
                    <ReactECharts
                      option={statusPieOptions}
                      style={{ height: 200 }}
                      opts={{ renderer: 'svg' }}
                    />
                  ) : (
                    <Empty
                      description="暂无数据"
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      style={{ padding: 40 }}
                    />
                  )}
                </Card>
              </Col>
            </Row>
          </Card>
        </Col>
      </Row>

      {/* 最近监控活动时间线 */}
      <Card
        title="最近监控活动"
        className={styles.timelineCard}
        style={{ marginTop: 16 }}
        extra={
          <Button
            type="link"
            size="small"
            onClick={() => history.push('/monitor-history')}
          >
            查看全部
          </Button>
        }
      >
        {recentActivities && recentActivities.length > 0 ? (
          <Timeline
            items={recentActivities
              .slice(0, 10) // 只显示最近10条，避免卡顿
              .map((activity) => ({
                key: activity.id,
                color: activity.isBroken ? 'red' : 'green',
                children: (
                  <Space direction="vertical" size="small">
                    <div>
                      <Tag color={activity.isBroken ? 'error' : 'success'}>
                        {activity.isBroken ? '异常' : '正常'}
                      </Tag>
                      <Tag>
                        {activity.checkType === 'GROUP' ? '变体组' : 'ASIN'}
                      </Tag>
                      {activity.variantGroupName && (
                        <span style={{ fontWeight: 500 }}>
                          {activity.variantGroupName}
                        </span>
                      )}
                      {activity.asin && (
                        <span style={{ fontFamily: 'monospace' }}>
                          {activity.asin}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: '#666' }}>
                      {countryMap[activity.country || ''] || activity.country} |{' '}
                      {activity.checkTime
                        ? dayjs(activity.checkTime).format(
                            'YYYY-MM-DD HH:mm:ss',
                          )
                        : '-'}
                    </div>
                  </Space>
                ),
              }))}
          />
        ) : (
          <Empty
            description="暂无监控活动"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        )}
      </Card>
    </PageContainer>
  );
};

export default HomePage;
