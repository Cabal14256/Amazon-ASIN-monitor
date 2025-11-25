import services from '@/services/role';
import { useMessage } from '@/utils/message';
import {
  PageContainer,
  ProColumns,
  ProTable,
} from '@ant-design/pro-components';
import { Card, Space, Tag } from 'antd';
import React, { useRef } from 'react';

const { getRoleList } = services.RoleController;

const RoleManagement: React.FC<unknown> = () => {
  const message = useMessage();
  const actionRef = useRef<any>();

  const columns: ProColumns<API.Role>[] = [
    {
      title: '角色代码',
      dataIndex: 'code',
      width: 120,
    },
    {
      title: '角色名称',
      dataIndex: 'name',
      width: 150,
    },
    {
      title: '描述',
      dataIndex: 'description',
      width: 200,
      ellipsis: true,
    },
    {
      title: '权限',
      dataIndex: 'permissions',
      width: 400,
      render: (_: any, record: API.Role) => (
        <Space wrap>
          {record.permissions?.map((perm) => (
            <Tag key={perm.id} color="blue">
              {perm.name}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'create_time',
      width: 180,
      valueType: 'dateTime',
      hideInSearch: true,
    },
  ];

  return (
    <PageContainer
      header={{
        title: '角色管理',
        breadcrumb: {},
      }}
    >
      <Card>
        <ProTable<API.Role>
          headerTitle="角色列表"
          actionRef={actionRef}
          rowKey="id"
          search={false}
          request={async () => {
            try {
              const response = await getRoleList();

              let data: API.Role[] = [];
              if (response && typeof response === 'object') {
                if ('data' in response) {
                  data = response.data || [];
                } else if (Array.isArray(response)) {
                  data = response;
                }
              }

              return {
                data,
                success: true,
                total: data.length,
              };
            } catch (error: any) {
              console.error('获取角色列表失败:', error);
              const errorMessage =
                error?.response?.data?.errorMessage ||
                error?.data?.errorMessage ||
                error?.errorMessage ||
                error?.message ||
                '获取角色列表失败';
              message.error(errorMessage);
              return {
                data: [],
                success: false,
                total: 0,
              };
            }
          }}
          columns={columns}
          pagination={false}
        />
      </Card>
    </PageContainer>
  );
};

export default RoleManagement;
