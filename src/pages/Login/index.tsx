import { LockOutlined, UserOutlined, SafetyOutlined } from '@ant-design/icons';
import { LoginForm, ProFormText } from '@ant-design/pro-components';
import { Card, Typography } from 'antd';
import { history, useModel } from '@umijs/max';
import React from 'react';
import services from '@/services/auth';
import { useMessage } from '@/utils/message';
import styles from './index.less';

const { login } = services.AuthController;
const { Title, Text } = Typography;

const LoginPage: React.FC = () => {
  const { initialState, setInitialState } = useModel('@@initialState');
  const message = useMessage();

  // 如果已登录，重定向到主页
  React.useEffect(() => {
    const token = localStorage.getItem('token');
    const currentUser = initialState?.currentUser;
    
    if (token && currentUser?.id) {
      // 已登录，重定向到主页
      const urlParams = new URL(window.location.href).searchParams;
      const redirect = urlParams.get('redirect') || '/home';
      history.replace(redirect);
    }
  }, [initialState]);

  const handleSubmit = async (values: API.LoginParams) => {
    try {
      const response = await login(values);

      if (response?.success && response?.data) {
        // 保存Token
        localStorage.setItem('token', response.data.token || '');

        // 更新全局状态
        await setInitialState({
          currentUser: response.data.user,
          permissions: response.data.permissions || [],
          roles: response.data.roles || [],
        });

        message.success('登录成功');

        // 跳转到首页或之前访问的页面
        const urlParams = new URL(window.location.href).searchParams;
        history.push(urlParams.get('redirect') || '/home');
      }
    } catch (error: any) {
      const errorMessage =
        error?.response?.data?.errorMessage ||
        error?.data?.errorMessage ||
        error?.message ||
        '登录失败';
      message.error(errorMessage);
    }
  };

  return (
    <div className={styles.loginContainer}>
      {/* 背景装饰 */}
      <div className={styles.backgroundDecoration}>
        <div className={styles.circle1}></div>
        <div className={styles.circle2}></div>
        <div className={styles.circle3}></div>
      </div>

      {/* 登录表单卡片 */}
      <div className={styles.loginWrapper}>
        <Card className={styles.loginCard} variant="outlined">
          <div className={styles.logoSection}>
            <div className={styles.logoIcon}>
              <SafetyOutlined />
            </div>
            <Title level={2} className={styles.title}>
              Amazon ASIN Monitor
            </Title>
            <Text type="secondary" className={styles.subtitle}>
              欢迎回来，请登录您的账户
            </Text>
          </div>

          <LoginForm
            onFinish={handleSubmit}
            submitter={{
              searchConfig: {
                submitText: '登录',
              },
              submitButtonProps: {
                size: 'large',
                style: {
                  width: '100%',
                  height: '44px',
                  fontSize: '16px',
                  fontWeight: 500,
                  borderRadius: '8px',
                },
              },
            }}
          >
            <ProFormText
              name="username"
              fieldProps={{
                size: 'large',
                prefix: <UserOutlined className={styles.inputIcon} />,
                style: {
                  height: '44px',
                  borderRadius: '8px',
                },
              }}
              placeholder="请输入用户名"
              rules={[{ required: true, message: '请输入用户名' }]}
            />
            <ProFormText.Password
              name="password"
              fieldProps={{
                size: 'large',
                prefix: <LockOutlined className={styles.inputIcon} />,
                style: {
                  height: '44px',
                  borderRadius: '8px',
                },
              }}
              placeholder="请输入密码"
              rules={[{ required: true, message: '请输入密码' }]}
            />
          </LoginForm>

          <div className={styles.footer}>
            <Text type="secondary" style={{ fontSize: '12px' }}>
              © 2024 Amazon ASIN Monitor. All rights reserved.
            </Text>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default LoginPage;
