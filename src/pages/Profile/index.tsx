import services from '@/services/auth';
import { useMessage } from '@/utils/message';
import {
  PageContainer,
  ProForm,
  ProFormText,
} from '@ant-design/pro-components';
import { useModel } from '@umijs/max';
import { Button, Card, List, Space, Tabs, Tag } from 'antd';
import React, { useEffect, useState } from 'react';

const {
  changePassword,
  getCurrentUser,
  getSessions,
  revokeSession,
  updateProfile,
} = services.AuthController;

const ProfilePage: React.FC<unknown> = () => {
  const message = useMessage();
  const { initialState, setInitialState } = useModel('@@initialState');
  const [profileForm] = ProForm.useForm();
  const [passwordForm] = ProForm.useForm();
  const [activeTab, setActiveTab] = useState<string>('profile');
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState<API.SessionInfo[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const currentSessionId = initialState?.sessionId;

  const currentUser = initialState?.currentUser;

  // 加载用户信息
  const loadUserInfo = async () => {
    setLoading(true);
    try {
      const response = await getCurrentUser();
      if (response?.success && response?.data?.user) {
        const user = response.data.user;
        profileForm.setFieldsValue({
          username: user.username,
          real_name: user.real_name,
        });
      }
    } catch (error) {
      console.error('加载用户信息失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadSessions = async () => {
    setSessionsLoading(true);
    try {
      const response = await getSessions();
      if (response?.success && response?.data) {
        setSessions(response.data);
      }
    } catch (error) {
      console.error('加载会话列表失败:', error);
      message.error('加载会话列表失败');
    } finally {
      setSessionsLoading(false);
    }
  };

  useEffect(() => {
    if (currentUser) {
      profileForm.setFieldsValue({
        username: currentUser.username,
        real_name: currentUser.real_name,
      });
    } else {
      loadUserInfo();
    }
    loadSessions();
  }, [currentUser]);

  const handleRevokeSession = async (sessionId?: string) => {
    if (!sessionId) {
      return;
    }
    try {
      await revokeSession({ sessionId });
      message.success('会话已踢出');
      loadSessions();
    } catch (error) {
      console.error('踢出会话失败:', error);
      message.error('踢出会话失败');
    }
  };

  // 更新个人资料
  const handleUpdateProfile = async (values: { real_name?: string }) => {
    try {
      const response = await updateProfile(values);
      if (response?.success && response?.data) {
        message.success('更新成功');
        // 更新全局状态
        await setInitialState({
          ...initialState,
          currentUser: response.data.user,
          permissions: response.data.permissions,
          roles: response.data.roles,
          sessionId: initialState?.sessionId,
        });
      }
      return true;
    } catch (error: any) {
      let errorMessage = '更新失败';
      if (error?.response?.data?.errorMessage) {
        errorMessage = error.response.data.errorMessage;
      } else if (error?.data?.errorMessage) {
        errorMessage = error.data.errorMessage;
      } else if (error?.errorMessage) {
        errorMessage = error.errorMessage;
      } else if (error?.message) {
        errorMessage = error.message;
      }
      message.error(errorMessage);
      return false;
    }
  };

  // 修改密码
  const handleChangePassword = async (values: {
    oldPassword: string;
    newPassword: string;
  }) => {
    try {
      await changePassword(values);
      message.success('密码修改成功');
      passwordForm.resetFields();
      return true;
    } catch (error: any) {
      let errorMessage = '修改密码失败';
      if (error?.response?.data?.errorMessage) {
        errorMessage = error.response.data.errorMessage;
      } else if (error?.data?.errorMessage) {
        errorMessage = error.data.errorMessage;
      } else if (error?.errorMessage) {
        errorMessage = error.errorMessage;
      } else if (error?.message) {
        errorMessage = error.message;
      }
      message.error(errorMessage);
      return false;
    }
  };

  const tabItems = [
    {
      key: 'profile',
      label: '个人资料',
      children: (
        <Card>
          <ProForm
            form={profileForm}
            onFinish={handleUpdateProfile}
            submitter={{
              searchConfig: {
                submitText: '保存',
              },
            }}
          >
            <ProFormText
              name="username"
              label="用户名"
              disabled
              fieldProps={{
                disabled: true,
              }}
            />
            <ProFormText
              name="real_name"
              label="真实姓名"
              placeholder="请输入真实姓名"
              fieldProps={{
                maxLength: 100,
              }}
            />
          </ProForm>
        </Card>
      ),
    },
    {
      key: 'password',
      label: '修改密码',
      children: (
        <Card>
          <ProForm
            form={passwordForm}
            onFinish={handleChangePassword}
            submitter={{
              searchConfig: {
                submitText: '修改密码',
              },
            }}
          >
            <ProFormText.Password
              name="oldPassword"
              label="原密码"
              placeholder="请输入原密码"
              rules={[{ required: true, message: '请输入原密码' }]}
            />
            <ProFormText.Password
              name="newPassword"
              label="新密码"
              placeholder="请输入新密码（至少6位）"
              rules={[
                { required: true, message: '请输入新密码' },
                { min: 6, message: '密码长度至少为6位' },
              ]}
            />
            <ProFormText.Password
              name="confirmPassword"
              label="确认密码"
              placeholder="请再次输入新密码"
              dependencies={['newPassword']}
              rules={[
                { required: true, message: '请确认新密码' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('newPassword') === value) {
                      return Promise.resolve();
                    }
                    return Promise.reject(new Error('两次输入的密码不一致'));
                  },
                }),
              ]}
            />
          </ProForm>
        </Card>
      ),
    },
    {
      key: 'sessions',
      label: '多设备管理',
      children: (
        <Card loading={sessionsLoading}>
          <List
            dataSource={sessions}
            locale={{ emptyText: '暂无其他会话' }}
            renderItem={(item) => {
              const isCurrent = item.id === currentSessionId;
              return (
                <List.Item
                  actions={[
                    isCurrent ? (
                      <Tag color="green">当前会话</Tag>
                    ) : (
                      <Button
                        type="link"
                        onClick={() => handleRevokeSession(item.id)}
                      >
                        踢出
                      </Button>
                    ),
                  ]}
                >
                  <List.Item.Meta
                    title={
                      <Space>
                        <span>{item.user_agent || '未知设备'}</span>
                        <Tag>{item.status}</Tag>
                      </Space>
                    }
                    description={
                      <>
                        <div>
                          IP: {item.ip_address || '未知'} • 创建于:{' '}
                          {item.created_at || '未知'}
                        </div>
                        <div>最近活动: {item.last_active_at || '未知'}</div>
                        {item.expires_at && (
                          <div>过期时间: {item.expires_at}</div>
                        )}
                        {item.remember_me === 1 && (
                          <Tag color="blue">已记住设备</Tag>
                        )}
                      </>
                    }
                  />
                </List.Item>
              );
            }}
          />
        </Card>
      ),
    },
  ];

  return (
    <PageContainer
      header={{
        title: '个人中心',
        breadcrumb: {},
      }}
      loading={loading}
    >
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
    </PageContainer>
  );
};

export default ProfilePage;
