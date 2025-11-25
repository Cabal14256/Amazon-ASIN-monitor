import services from '@/services/auth';
import { useMessage } from '@/utils/message';
import {
  PageContainer,
  ProForm,
  ProFormText,
} from '@ant-design/pro-components';
import { useModel } from '@umijs/max';
import { Card, Tabs } from 'antd';
import React, { useEffect, useState } from 'react';

const { changePassword, updateProfile, getCurrentUser } =
  services.AuthController;

const ProfilePage: React.FC<unknown> = () => {
  const message = useMessage();
  const { initialState, setInitialState } = useModel('@@initialState');
  const [profileForm] = ProForm.useForm();
  const [passwordForm] = ProForm.useForm();
  const [activeTab, setActiveTab] = useState<string>('profile');
  const [loading, setLoading] = useState(false);

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
          email: user.email,
          real_name: user.real_name,
        });
      }
    } catch (error) {
      console.error('加载用户信息失败:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (currentUser) {
      profileForm.setFieldsValue({
        username: currentUser.username,
        email: currentUser.email,
        real_name: currentUser.real_name,
      });
    } else {
      loadUserInfo();
    }
  }, [currentUser]);

  // 更新个人资料
  const handleUpdateProfile = async (values: {
    email?: string;
    real_name?: string;
  }) => {
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
              name="email"
              label="邮箱"
              placeholder="请输入邮箱"
              rules={[{ type: 'email', message: '请输入有效的邮箱地址' }]}
              fieldProps={{
                maxLength: 100,
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
