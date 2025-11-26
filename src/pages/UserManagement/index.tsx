import services from '@/services/user';
import { useMessage } from '@/utils/message';
import {
  ActionType,
  FooterToolbar,
  PageContainer,
  ProColumns,
  ProTable,
} from '@ant-design/pro-components';
import { Button, Popconfirm, Space, Tag } from 'antd';
import React, { useRef, useState } from 'react';
import PasswordForm from './components/PasswordForm';
import PermissionTab from './components/PermissionTab';
import RoleTab from './components/RoleTab';
import UserForm from './components/UserForm';

const { getUserList, deleteUser } = services.UserController;

const UserManagement: React.FC<unknown> = () => {
  const message = useMessage();
  const actionRef = useRef<ActionType>();
  const [selectedRowsState, setSelectedRows] = useState<API.UserInfo[]>([]);
  const [userModalVisible, setUserModalVisible] = useState(false);
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [editingUser, setEditingUser] = useState<Partial<API.UserInfo>>();
  const [passwordUserId, setPasswordUserId] = useState<string>();
  const [activeTab, setActiveTab] = useState<'users' | 'roles' | 'permissions'>(
    'users',
  );
  const tabList = [
    {
      tab: '用户管理',
      key: 'users',
    },
    {
      tab: '角色管理',
      key: 'roles',
    },
    {
      tab: '权限控制',
      key: 'permissions',
    },
  ];

  /**
   * 删除用户
   */
  const handleRemove = async (selectedRows: API.UserInfo[]) => {
    const hide = message.loading('正在删除');
    if (!selectedRows || selectedRows.length === 0) return true;
    try {
      for (const row of selectedRows) {
        await deleteUser(row.id || '');
      }
      hide();
      message.success('删除成功，即将刷新');
      return true;
    } catch (error: any) {
      hide();
      message.error(error?.errorMessage || '删除失败，请重试');
      return false;
    }
  };

  const columns: ProColumns<API.UserInfo>[] = [
    {
      title: '用户名',
      dataIndex: 'username',
      width: 120,
      fixed: 'left',
    },
    {
      title: '真实姓名',
      dataIndex: 'real_name',
      width: 120,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      valueType: 'select',
      valueEnum: {
        1: { text: '启用', status: 'Success' },
        0: { text: '禁用', status: 'Error' },
      },
      render: (_: any, record: API.UserInfo) => (
        <Tag color={record.status === 1 ? 'success' : 'error'}>
          {record.status === 1 ? '启用' : '禁用'}
        </Tag>
      ),
    },
    {
      title: '角色',
      dataIndex: 'roles',
      width: 200,
      render: (_: any, record: API.UserInfo) => (
        <Space>
          {record.roles?.map((role) => (
            <Tag key={role.id} color="blue">
              {role.name}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '最后登录时间',
      dataIndex: 'last_login_time',
      width: 180,
      valueType: 'dateTime',
      hideInSearch: true,
    },
    {
      title: '最后登录IP',
      dataIndex: 'last_login_ip',
      width: 140,
      hideInSearch: true,
    },
    {
      title: '创建时间',
      dataIndex: 'create_time',
      width: 180,
      valueType: 'dateTime',
      hideInSearch: true,
      sorter: true,
    },
    {
      title: '操作',
      valueType: 'option',
      width: 200,
      fixed: 'right',
      render: (_: any, record: API.UserInfo) => [
        <Button
          key="edit"
          type="link"
          size="small"
          onClick={() => {
            setEditingUser(record);
            setUserModalVisible(true);
          }}
        >
          编辑
        </Button>,
        <Button
          key="password"
          type="link"
          size="small"
          onClick={() => {
            setPasswordUserId(record.id);
            setPasswordModalVisible(true);
          }}
        >
          修改密码
        </Button>,
        <Popconfirm
          key="delete"
          title="确定要删除这个用户吗？"
          onConfirm={async () => {
            const success = await handleRemove([record]);
            if (success) {
              actionRef.current?.reload();
            }
          }}
        >
          <Button type="link" size="small" danger>
            删除
          </Button>
        </Popconfirm>,
      ],
    },
  ];

  return (
    <PageContainer
      header={{
        title: '用户与权限管理',
        breadcrumb: {},
      }}
      tabList={tabList}
      tabActiveKey={activeTab}
      onTabChange={(key) =>
        setActiveTab(key as 'users' | 'roles' | 'permissions')
      }
    >
      {activeTab === 'users' && (
        <>
          <ProTable<API.UserInfo>
            headerTitle="用户列表"
            actionRef={actionRef}
            rowKey="id"
            search={{
              labelWidth: 120,
            }}
            toolBarRender={() => [
              <Button
                key="1"
                type="primary"
                onClick={() => {
                  setEditingUser(undefined);
                  setUserModalVisible(true);
                }}
              >
                新建用户
              </Button>,
            ]}
            request={async (params) => {
              try {
                const { current, pageSize, username, status } = params;
                const response = await getUserList({
                  current: current || 1,
                  pageSize: pageSize || 10,
                  username: username as string,
                  status: status as string,
                });

                let data;
                if (response && typeof response === 'object') {
                  if ('data' in response) {
                    data = response.data;
                  } else if ('list' in response) {
                    data = response;
                  } else {
                    data = { list: [], total: 0 };
                  }
                } else {
                  data = { list: [], total: 0 };
                }

                return {
                  data: data?.list || [],
                  success: true,
                  total: data?.total || 0,
                };
              } catch (error: any) {
                console.error('获取用户列表失败:', error);
                const errorMessage =
                  error?.response?.data?.errorMessage ||
                  error?.data?.errorMessage ||
                  error?.errorMessage ||
                  error?.message ||
                  '获取用户列表失败';
                message.error(errorMessage);
                return {
                  data: [],
                  success: false,
                  total: 0,
                };
              }
            }}
            columns={columns}
            rowSelection={{
              onChange: (_, selectedRows) => {
                setSelectedRows(selectedRows);
              },
            }}
            pagination={{
              defaultPageSize: 10,
              showSizeChanger: true,
              showQuickJumper: true,
            }}
          />
          {selectedRowsState?.length > 0 && (
            <FooterToolbar
              extra={
                <div>
                  已选择{' '}
                  <a style={{ fontWeight: 600 }}>{selectedRowsState.length}</a>{' '}
                  项&nbsp;&nbsp;
                </div>
              }
            >
              <Popconfirm
                title="确定要删除选中的用户吗？"
                onConfirm={async () => {
                  const success = await handleRemove(selectedRowsState);
                  if (success) {
                    setSelectedRows([]);
                    actionRef.current?.reloadAndRest?.();
                  }
                }}
              >
                <Button type="primary" danger>
                  批量删除
                </Button>
              </Popconfirm>
            </FooterToolbar>
          )}
        </>
      )}

      {activeTab === 'roles' && <RoleTab />}

      {activeTab === 'permissions' && <PermissionTab />}

      <UserForm
        modalVisible={userModalVisible}
        onCancel={() => {
          setUserModalVisible(false);
          setEditingUser(undefined);
        }}
        onSubmit={async () => {
          setUserModalVisible(false);
          setEditingUser(undefined);
          if (actionRef.current) {
            await actionRef.current.reload();
          }
        }}
        values={editingUser}
      />

      <PasswordForm
        modalVisible={passwordModalVisible}
        userId={passwordUserId}
        onCancel={() => {
          setPasswordModalVisible(false);
          setPasswordUserId(undefined);
        }}
        onSubmit={() => {
          setPasswordModalVisible(false);
          setPasswordUserId(undefined);
        }}
      />
    </PageContainer>
  );
};

export default UserManagement;
