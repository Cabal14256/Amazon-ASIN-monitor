import services from '@/services/auditLog';
import { toBeijingDayjs } from '@/utils/beijingTime';
import { useMessage } from '@/utils/message';
import {
  ActionType,
  PageContainer,
  ProColumns,
  ProTable,
} from '@ant-design/pro-components';
import { DatePicker, Space, Tag } from 'antd';
import { Dayjs } from 'dayjs';
import React, { useRef, useState } from 'react';

const { RangePicker } = DatePicker;
const { getAuditLogList } = services.AuditLogController;

// 操作类型映射
const actionMap: Record<string, { text: string; color: string }> = {
  CREATE: { text: '创建', color: 'green' },
  UPDATE: { text: '更新', color: 'blue' },
  DELETE: { text: '删除', color: 'red' },
  READ: { text: '查看', color: 'default' },
  LOGIN: { text: '登录', color: 'success' },
  LOGOUT: { text: '登出', color: 'default' },
  CHANGE_PASSWORD: { text: '修改密码', color: 'orange' },
  RESET_PASSWORD: { text: '重置密码', color: 'red' },
  REVOKE_SESSION: { text: '踢出会话', color: 'volcano' },
  EXPORT: { text: '导出', color: 'purple' },
  TRIGGER_MONITOR: { text: '触发监控', color: 'orange' },
  UPDATE_ROLE_PERMISSIONS: { text: '更新角色权限', color: 'cyan' },
  UNKNOWN: { text: '未知', color: 'default' },
};

// 资源类型映射
const resourceMap: Record<string, string> = {
  variant_group: '变体组',
  asin: 'ASIN',
  user: '用户',
  role: '角色',
  permission: '权限',
  feishu_config: '飞书配置',
  sp_api_config: 'SP-API配置',
  auth: '认证',
  audit: '审计',
  monitor: '监控',
  monitor_history: '监控历史',
};

const AuditLogPage: React.FC<unknown> = () => {
  const message = useMessage();
  const actionRef = useRef<ActionType | null>(null);
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null);

  const columns: ProColumns<API.AuditLog>[] = [
    {
      title: '操作时间',
      dataIndex: 'createTime',
      width: 180,
      valueType: 'dateTime',
      sorter: true,
    },
    {
      title: '用户',
      dataIndex: 'username',
      width: 120,
      render: (_: React.ReactNode, record: API.AuditLog) => (
        <Space>
          <span>{record.username || '-'}</span>
          {record.userId && (
            <Tag color="default" style={{ fontSize: '11px' }}>
              {record.userId.substring(0, 8)}...
            </Tag>
          )}
        </Space>
      ),
    },
    {
      title: '操作类型',
      dataIndex: 'action',
      width: 120,
      valueType: 'select' as const,
      valueEnum: Object.keys(actionMap).reduce((acc, key) => {
        acc[key] = { text: actionMap[key].text };
        return acc;
      }, {} as Record<string, { text: string }>),
      render: (_: any, record: API.AuditLog) => {
        const action = record.action || 'UNKNOWN';
        const actionInfo = actionMap[action] || actionMap.UNKNOWN;
        return <Tag color={actionInfo.color}>{actionInfo.text}</Tag>;
      },
    },
    {
      title: '资源类型',
      dataIndex: 'resource',
      width: 120,
      valueType: 'select' as const,
      valueEnum: Object.keys(resourceMap).reduce((acc, key) => {
        acc[key] = { text: resourceMap[key] };
        return acc;
      }, {} as Record<string, { text: string }>),
      render: (_: React.ReactNode, record: API.AuditLog) => {
        const text = record.resource;
        return text ? resourceMap[text] || text : '-';
      },
    },
    {
      title: '资源名称',
      dataIndex: 'resourceName',
      width: 200,
      render: (_: React.ReactNode, record: API.AuditLog) =>
        record.resourceName || '-',
    },
    {
      title: '请求路径',
      dataIndex: 'path',
      width: 300,
      ellipsis: true,
      hideInSearch: true,
    },
    {
      title: 'HTTP方法',
      dataIndex: 'method',
      width: 100,
      hideInSearch: true,
      render: (_: React.ReactNode, record: API.AuditLog) => {
        const text = record.method || '-';
        return (
          <Tag
            color={
              text === 'GET'
                ? 'blue'
                : text === 'POST'
                ? 'green'
                : text === 'PUT'
                ? 'orange'
                : text === 'DELETE'
                ? 'red'
                : 'default'
            }
          >
            {text}
          </Tag>
        );
      },
    },
    {
      title: '响应状态',
      dataIndex: 'responseStatus',
      width: 100,
      hideInSearch: true,
      render: (_: React.ReactNode, record: API.AuditLog) => {
        const status = record.responseStatus;
        if (!status) return '-';
        const color =
          status >= 200 && status < 300
            ? 'success'
            : status >= 400 && status < 500
            ? 'error'
            : 'warning';
        return <Tag color={color}>{status}</Tag>;
      },
    },
    {
      title: 'IP地址',
      dataIndex: 'ipAddress',
      width: 150,
      hideInSearch: true,
    },
    {
      title: '错误信息',
      dataIndex: 'errorMessage',
      width: 200,
      ellipsis: true,
      hideInSearch: true,
      render: (_: React.ReactNode, record: API.AuditLog) =>
        record.errorMessage ? (
          <Tag color="error">{record.errorMessage}</Tag>
        ) : (
          '-'
        ),
    },
  ];

  return (
    <PageContainer
      header={{
        title: '操作审计日志',
        breadcrumb: {},
      }}
    >
      <ProTable<API.AuditLog>
        headerTitle="审计日志列表"
        actionRef={actionRef}
        rowKey="id"
        search={{
          labelWidth: 120,
        }}
        request={async (params) => {
          try {
            const requestParams: API.AuditLogListParams = {
              ...params,
              current: params.current || 1,
              pageSize: params.pageSize || 10,
            };

            // 处理日期范围
            if (dateRange && dateRange[0] && dateRange[1]) {
              requestParams.startTime = toBeijingDayjs(dateRange[0])
                .startOf('day')
                .format('YYYY-MM-DD HH:mm:ss');
              requestParams.endTime = toBeijingDayjs(dateRange[1])
                .endOf('day')
                .format('YYYY-MM-DD HH:mm:ss');
            }

            const { data, success } = await getAuditLogList(requestParams);
            return {
              data: data?.list || [],
              success,
              total: data?.total || 0,
            };
          } catch (_error) {
            message.error('获取审计日志列表失败');
            return {
              data: [],
              success: false,
              total: 0,
            };
          }
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
          <RangePicker
            key="date-range"
            value={dateRange}
            onChange={(dates) => setDateRange(dates as [Dayjs, Dayjs] | null)}
            format="YYYY-MM-DD"
            placeholder={['开始日期', '结束日期']}
          />,
        ]}
      />
    </PageContainer>
  );
};

export default AuditLogPage;
