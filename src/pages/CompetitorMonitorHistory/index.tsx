import services from '@/services/competitor';
import {
  ActionType,
  PageContainer,
  ProColumns,
  ProTable,
} from '@ant-design/pro-components';
import { useSearchParams } from '@umijs/max';
import { Button, message, Tag } from 'antd';
import dayjs from 'dayjs';
import React, { useRef } from 'react';

const { queryCompetitorMonitorHistory } = services.CompetitorMonitorController;

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

const CompetitorMonitorHistoryPage: React.FC<unknown> = () => {
  const actionRef = useRef<ActionType>();
  const [searchParams] = useSearchParams();

  // 从URL参数获取筛选条件
  const type = searchParams.get('type') || '';
  const id = searchParams.get('id') || '';

  // 竞品监控不需要数据分析功能，已移除统计相关代码

  const columns: ProColumns<API.MonitorHistory>[] = [
    {
      title: '检查时间',
      dataIndex: 'checkTime',
      width: 180,
      valueType: 'dateTimeRange',
      hideInTable: true,
      fieldProps: {
        style: { width: '100%', minWidth: 380 },
        placeholder: ['开始时间', '结束时间'],
        format: 'YYYY-MM-DD HH:mm',
        showTime: { format: 'HH:mm' },
      },
      colSize: 2,
      search: {
        transform: (value: any) => {
          if (value && Array.isArray(value) && value.length === 2) {
            const start = value[0]
              ? dayjs.isDayjs(value[0])
                ? value[0]
                : dayjs(value[0])
              : null;
            const end = value[1]
              ? dayjs.isDayjs(value[1])
                ? value[1]
                : dayjs(value[1])
              : null;
            return {
              startTime: start
                ? start.format('YYYY-MM-DD HH:mm:ss')
                : undefined,
              endTime: end ? end.format('YYYY-MM-DD HH:mm:ss') : undefined,
            };
          }
          return {};
        },
      },
    },
    {
      title: '检查时间',
      dataIndex: 'checkTime',
      width: 180,
      valueType: 'dateTime',
      hideInSearch: true,
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
      render: (text: string) => text || '-',
    },
    {
      title: 'ASIN',
      dataIndex: 'asin',
      width: 150,
      hideInTable: type === 'group', // 如果是从变体组查看，隐藏ASIN列
      render: (text: string) => text || '-',
      fieldProps: {
        placeholder: '请输入ASIN编码',
      },
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
        title: '竞品监控历史',
        breadcrumb: {},
      }}
    >
      <ProTable<API.MonitorHistory>
        headerTitle="竞品监控历史记录"
        actionRef={actionRef}
        rowKey="id"
        search={{
          labelWidth: 100,
          defaultCollapsed: false,
        }}
        request={async (params, sorter) => {
          const requestParams: any = {
            current: params.current || 1,
            pageSize: params.pageSize || 10,
          };

          // 处理时间范围（transform 函数已经转换为 startTime 和 endTime）
          if (params.startTime) {
            requestParams.startTime = params.startTime;
          }
          if (params.endTime) {
            requestParams.endTime = params.endTime;
          }

          // 处理其他筛选条件
          if (params.country) {
            requestParams.country = params.country;
          }
          if (params.checkType) {
            requestParams.checkType = params.checkType;
          }
          if (params.isBroken !== undefined && params.isBroken !== '') {
            requestParams.isBroken = params.isBroken;
          }
          // 处理ASIN搜索
          if (params.asin) {
            requestParams.asin = params.asin;
          }

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

          const response = await queryCompetitorMonitorHistory(requestParams);
          const data = response.data || response;
          const success = response.success !== false;

          return {
            data: data?.list || [],
            success,
            total: data?.total || 0,
          };
        }}
        columns={columns}
        pagination={{
          defaultPageSize: 10,
          showSizeChanger: true,
          showQuickJumper: true,
          showTotal: (total, range) =>
            `第 ${range[0]}-${range[1]} 条/总共 ${total} 条`,
          pageSizeOptions: ['10', '20', '50', '100'],
        }}
        toolBarRender={() => [
          <Button
            key="export"
            onClick={async () => {
              try {
                const params = new URLSearchParams();
                // 获取当前表格的筛选条件
                const formValues = actionRef.current?.getFieldsValue?.() || {};

                // 处理时间范围（transform 函数已经转换为 startTime 和 endTime）
                if (formValues.startTime) {
                  params.append('startTime', formValues.startTime);
                }
                if (formValues.endTime) {
                  params.append('endTime', formValues.endTime);
                }

                // 处理其他筛选条件
                if (formValues.country) {
                  params.append('country', formValues.country);
                }
                if (formValues.checkType) {
                  params.append('checkType', formValues.checkType);
                }
                if (
                  formValues.isBroken !== undefined &&
                  formValues.isBroken !== ''
                ) {
                  params.append('isBroken', formValues.isBroken);
                }
                if (formValues.asin) {
                  params.append('asin', formValues.asin);
                }

                // 如果URL中有参数，添加到请求中
                if (type === 'group' && id) {
                  params.append('variantGroupId', id);
                } else if (type === 'asin' && id) {
                  params.append('asinId', id);
                }

                const token = localStorage.getItem('token');
                const url = `/api/v1/export/competitor-monitor-history?${params.toString()}`;

                const response = await fetch(url, {
                  method: 'GET',
                  headers: {
                    Authorization: `Bearer ${token}`,
                  },
                });

                if (response.ok) {
                  const blob = await response.blob();
                  const downloadUrl = window.URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = downloadUrl;
                  a.download = `竞品监控历史_${
                    new Date().toISOString().split('T')[0]
                  }.xlsx`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  window.URL.revokeObjectURL(downloadUrl);
                  message.success('导出成功');
                } else {
                  message.error('导出失败');
                }
              } catch (error) {
                console.error('导出失败:', error);
                message.error('导出失败');
              }
            }}
          >
            导出Excel
          </Button>,
        ]}
      />
    </PageContainer>
  );
};

export default CompetitorMonitorHistoryPage;
