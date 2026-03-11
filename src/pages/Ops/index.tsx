import opsServices from '@/services/ops';
import { useMessage } from '@/utils/message';
import { PageContainer } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Row,
  Space,
  Statistic,
  Tag,
} from 'antd';
import React, { useCallback, useEffect, useState } from 'react';

const { getOpsOverview, clearAnalyticsCache, refreshAnalyticsAgg } =
  opsServices.OpsController;

const formatTime = (value?: string | null) => {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
};

const OpsPage: React.FC = () => {
  const access = useAccess();
  const message = useMessage();
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<'cache' | 'agg' | ''>('');
  const [overview, setOverview] = useState<any>(null);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getOpsOverview();
      setOverview(result?.data || null);
    } catch (error) {
      message.error('加载运维概览失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const handleClearAnalyticsCache = useCallback(async () => {
    setActionLoading('cache');
    try {
      await clearAnalyticsCache();
      message.success('分析缓存已清理');
      await loadOverview();
    } catch (error) {
      message.error('清理分析缓存失败');
    } finally {
      setActionLoading('');
    }
  }, [loadOverview, message]);

  const handleRefreshAnalyticsAgg = useCallback(async () => {
    setActionLoading('agg');
    try {
      await refreshAnalyticsAgg();
      message.success('聚合刷新任务已执行');
      await loadOverview();
    } catch (error) {
      message.error('刷新聚合失败');
    } finally {
      setActionLoading('');
    }
  }, [loadOverview, message]);

  return (
    <PageContainer
      header={{
        title: '运维观测',
      }}
      extra={[
        <Button
          key="reload"
          onClick={() => void loadOverview()}
          loading={loading}
        >
          刷新概览
        </Button>,
        <Button
          key="clear-cache"
          onClick={() => void handleClearAnalyticsCache()}
          loading={actionLoading === 'cache'}
          disabled={!access.canWriteSettings}
        >
          清分析缓存
        </Button>,
        <Button
          key="refresh-agg"
          type="primary"
          onClick={() => void handleRefreshAnalyticsAgg()}
          loading={actionLoading === 'agg'}
          disabled={!access.canWriteSettings}
        >
          刷新聚合
        </Button>,
      ]}
    >
      <Alert
        showIcon
        type="info"
        style={{ marginBottom: 16 }}
        message="分析结果由结果缓存和聚合表共同加速"
        description="清分析缓存只会清除查询结果缓存；刷新聚合会重建 monitor_history_agg* 预计算数据。"
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}>
          <Card loading={loading}>
            <Statistic
              title="分析缓存条目"
              value={Number(overview?.cache?.activeEntries || 0)}
            />
            <div style={{ marginTop: 12, color: '#666' }}>
              上次清理：{formatTime(overview?.analyticsCache?.lastClearedAt)}
            </div>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card loading={loading}>
            <Statistic
              title="聚合刷新状态"
              value={overview?.analyticsAgg?.isRefreshing ? '执行中' : '空闲'}
            />
            <div style={{ marginTop: 12 }}>
              <Tag color={overview?.analyticsAgg?.enabled ? 'green' : 'red'}>
                聚合{overview?.analyticsAgg?.enabled ? '已启用' : '未启用'}
              </Tag>
              <Tag
                color={
                  overview?.analyticsAgg?.refreshDimAgg ? 'blue' : 'default'
                }
              >
                维度聚合
              </Tag>
              <Tag
                color={
                  overview?.analyticsAgg?.refreshVariantGroupAgg
                    ? 'purple'
                    : 'default'
                }
              >
                变体组聚合
              </Tag>
            </div>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card loading={loading}>
            <Statistic
              title="调度器"
              value={overview?.schedulerEnabled ? '已启用' : '未启用'}
            />
            <div style={{ marginTop: 12, color: '#666' }}>
              进程角色：{overview?.processRole || '-'}
            </div>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card title="分析缓存" loading={loading}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="缓存前缀">
                <Space wrap>
                  {(overview?.analyticsCache?.prefixes || []).map(
                    (prefix: string) => (
                      <Tag key={prefix}>{prefix}</Tag>
                    ),
                  )}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="活动条目">
                {overview?.cache?.activeEntries ?? '-'}
              </Descriptions.Item>
              <Descriptions.Item label="总条目">
                {overview?.cache?.totalEntries ?? '-'}
              </Descriptions.Item>
              <Descriptions.Item label="缓存占用">
                {overview?.cache?.estimatedCacheMemoryMB ?? '-'} MB
              </Descriptions.Item>
              <Descriptions.Item label="上次清理">
                {formatTime(overview?.analyticsCache?.lastClearedAt)}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="聚合与队列" loading={loading}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="回填小时">
                {overview?.analyticsAgg?.backfillHours ?? '-'}
              </Descriptions.Item>
              <Descriptions.Item label="回填天数">
                {overview?.analyticsAgg?.backfillDays ?? '-'}
              </Descriptions.Item>
              <Descriptions.Item label="监控队列等待">
                {overview?.queues?.monitor?.counts?.waiting ?? '-'}
              </Descriptions.Item>
              <Descriptions.Item label="竞品队列等待">
                {overview?.queues?.competitor?.counts?.waiting ?? '-'}
              </Descriptions.Item>
              <Descriptions.Item label="Worker 注册队列">
                {(overview?.workerRegisteredQueues || []).join(', ') || '-'}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
      </Row>
    </PageContainer>
  );
};

export default OpsPage;
