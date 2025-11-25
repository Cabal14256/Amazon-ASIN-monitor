import services from '@/services/dashboard';
import { useMessage } from '@/utils/message';
import { Column, Pie } from '@ant-design/charts';
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

  // 国家分布图表数据
  const countryChartData =
    distribution?.byCountry?.map((item) => ({
      country: countryMap[item.country || ''] || item.country,
      type: '正常',
      value: item.normal || 0,
    })) || [];

  const countryBrokenData =
    distribution?.byCountry?.map((item) => ({
      country: countryMap[item.country || ''] || item.country,
      type: '异常',
      value: item.broken || 0,
    })) || [];

  const countryColumnData = [...countryChartData, ...countryBrokenData];

  // 状态分布饼图数据
  const statusPieData = [
    {
      type: '正常',
      value: overview?.normalGroups || 0,
    },
    {
      type: '异常',
      value: overview?.brokenGroups || 0,
    },
  ];

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
                    <Column
                      data={countryColumnData}
                      xField="country"
                      yField="value"
                      seriesField="type"
                      isStack
                      legend={{ position: 'top' }}
                      color={['#52c41a', '#ff4d4f']}
                      height={200}
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
                  {statusPieData.some((item) => item.value > 0) ? (
                    <Pie
                      data={statusPieData}
                      angleField="value"
                      colorField="type"
                      radius={0.8}
                      legend={{
                        position: 'bottom',
                      }}
                      interactions={[{ type: 'element-active' }]}
                      color={['#52c41a', '#ff4d4f']}
                      height={200}
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
