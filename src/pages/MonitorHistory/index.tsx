import services from '@/services/asin';
import {
  ActionType,
  PageContainer,
  ProColumns,
  ProTable,
  StatisticCard,
} from '@ant-design/pro-components';
import { useSearchParams } from '@umijs/max';
import { Space, Tag } from 'antd';
import React, { useEffect, useRef, useState } from 'react';

const { queryMonitorHistory, getMonitorStatistics } =
  services.MonitorController;

// 国家选项映射
const countryMap: Record<
  string,
  { text: string; color: string; region: string }
> = {
  US: { text: '美国', color: 'blue', region: 'US' },
  UK: { text: '英国', color: 'green', region: 'EU' },
  DE: { text: '德国', color: 'orange', region: 'EU' },
  FR: { text: '法国', color: 'purple', region: 'EU' },
  IT: { text: '意大利', color: 'cyan', region: 'EU' },
  ES: { text: '西班牙', color: 'magenta', region: 'EU' },
};

const MonitorHistoryPage: React.FC<unknown> = () => {
  const actionRef = useRef<ActionType>();
  const [searchParams] = useSearchParams();
  const [statistics, setStatistics] = useState<API.MonitorStatistics>({});

  // 从URL参数获取筛选条件
  const type = searchParams.get('type') || '';
  const id = searchParams.get('id') || '';

  // 加载统计信息
  const loadStatistics = async () => {
    try {
      const params: any = {};
      if (type === 'group' && id) {
        params.variantGroupId = id;
      } else if (type === 'asin' && id) {
        params.asinId = id;
      }
      const { data } = await getMonitorStatistics(params);
      setStatistics(data || {});
    } catch (error) {
      console.error('加载统计信息失败:', error);
    }
  };

  useEffect(() => {
    loadStatistics();
  }, [type, id]);

  const columns: ProColumns<API.MonitorHistory>[] = [
    {
      title: '检查时间',
      dataIndex: 'checkTime',
      width: 180,
      valueType: 'dateTime',
      sorter: true,
    },
    {
      title: '检查类型',
      dataIndex: 'checkType',
      width: 100,
      valueType: 'select' as const,
      valueEnum: {
        GROUP: { text: '变体组', status: 'Default' },
        ASIN: { text: 'ASIN', status: 'Processing' },
      },
      render: (_: any, record: API.MonitorHistory) => (
        <Tag color={record.checkType === 'GROUP' ? 'blue' : 'default'}>
          {record.checkType === 'GROUP' ? '变体组' : 'ASIN'}
        </Tag>
      ),
    },
    {
      title: '变体组',
      dataIndex: 'variantGroupName',
      width: 200,
      hideInTable: type === 'asin', // 如果是从ASIN查看，隐藏变体组列
      render: (text: string) => text || '-',
    },
    {
      title: 'ASIN',
      dataIndex: 'asin',
      width: 150,
      hideInTable: type === 'group', // 如果是从变体组查看，隐藏ASIN列
      render: (text: string) => text || '-',
    },
    {
      title: 'ASIN名称',
      dataIndex: 'asinName',
      width: 250,
      hideInTable: type === 'group',
      render: (text: string) => text || '-',
    },
    {
      title: '所属国家',
      dataIndex: 'country',
      width: 120,
      valueType: 'select' as const,
      valueEnum: Object.keys(countryMap).reduce((acc, key) => {
        acc[key] = { text: countryMap[key].text };
        return acc;
      }, {} as Record<string, { text: string }>),
      render: (_: any, record: API.MonitorHistory) => {
        const country = record.country || '';
        const countryInfo = countryMap[country];
        return countryInfo ? (
          <Tag color={countryInfo.color}>{countryInfo.text}</Tag>
        ) : (
          '-'
        );
      },
    },
    {
      title: '检查结果',
      dataIndex: 'isBroken',
      width: 120,
      valueType: 'select' as const,
      valueEnum: {
        '0': { text: '正常', status: 'Success' },
        '1': { text: '异常', status: 'Error' },
      },
      render: (_: any, record: API.MonitorHistory) => {
        const isBroken = record.isBroken === 1;
        return (
          <Tag color={isBroken ? 'error' : 'success'}>
            {isBroken ? '异常' : '正常'}
          </Tag>
        );
      },
    },
    {
      title: '通知状态',
      dataIndex: 'notificationSent',
      width: 100,
      hideInSearch: true,
      render: (_: any, record: API.MonitorHistory) => (
        <Tag color={record.notificationSent === 1 ? 'success' : 'default'}>
          {record.notificationSent === 1 ? '已通知' : '未通知'}
        </Tag>
      ),
    },
  ];

  return (
    <PageContainer
      header={{
        title: '监控历史',
        breadcrumb: {},
      }}
    >
      {/* 统计卡片 */}
      <Space
        direction="vertical"
        size="large"
        style={{ width: '100%', marginBottom: 16 }}
      >
        <StatisticCard.Group>
          <StatisticCard
            statistic={{
              title: '总检查次数',
              value: statistics.totalChecks || 0,
            }}
          />
          <StatisticCard
            statistic={{
              title: '正常次数',
              value: statistics.normalCount || 0,
              status: 'success',
            }}
          />
          <StatisticCard
            statistic={{
              title: '异常次数',
              value: statistics.brokenCount || 0,
              status: 'error',
            }}
          />
          <StatisticCard
            statistic={{
              title: '监控对象数',
              value: (statistics.groupCount || 0) + (statistics.asinCount || 0),
            }}
          />
        </StatisticCard.Group>
      </Space>

      <ProTable<API.MonitorHistory>
        headerTitle="监控历史记录"
        actionRef={actionRef}
        rowKey="id"
        search={{
          labelWidth: 120,
        }}
        request={async (params, sorter) => {
          const requestParams: any = {
            ...params,
            current: params.current || 1,
            pageSize: params.pageSize || 10,
          };

          // 如果URL中有参数，添加到请求中
          if (type === 'group' && id) {
            requestParams.variantGroupId = id;
          } else if (type === 'asin' && id) {
            requestParams.asinId = id;
          }

          // 处理排序
          if (sorter && Object.keys(sorter).length > 0) {
            // 这里可以根据需要处理排序逻辑
          }

          const { data, success } = await queryMonitorHistory(requestParams);
          return {
            data: data?.list || [],
            success,
            total: data?.total || 0,
          };
        }}
        columns={columns}
        pagination={{
          pageSize: 10,
          showSizeChanger: true,
        }}
        toolBarRender={() => []}
      />
    </PageContainer>
  );
};

export default MonitorHistoryPage;
