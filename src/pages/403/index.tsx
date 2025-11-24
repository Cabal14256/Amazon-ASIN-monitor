import { Button, Result } from 'antd';
import { history, useModel } from '@umijs/max';
import React, { useEffect, useState } from 'react';

const NoAccessPage: React.FC = () => {
  const { initialState } = useModel('@@initialState');
  const [checked, setChecked] = useState(false);
  const currentUser = initialState?.currentUser;
  const hasToken = typeof window !== 'undefined' && !!localStorage.getItem('token');
  const isLogin = !!currentUser?.id;

  useEffect(() => {
    // 如果未登录且没有token，自动跳转到登录页
    if (!hasToken && !isLogin) {
      const currentPath = window.location.pathname;
      history.replace(`/login?redirect=${encodeURIComponent(currentPath)}`);
      return;
    }

    // 如果有 token（无论是否有用户信息），访问主页时显示403，说明可能是初始化问题
    // 立即重定向到主页，触发权限重新检查
    const currentPath = window.location.pathname;
    if (hasToken && (currentPath === '/home' || currentPath === '/')) {
      console.log('[403页面] 检测到token且访问主页，自动重定向');
      // 立即重定向，触发权限重新检查
      setTimeout(() => {
        window.location.href = '/home';
      }, 100);
      return;
    }

    // 如果有 token 但用户信息还没加载完（访问其他页面）
    if (hasToken && !isLogin) {
      // 等待一下，如果数据加载完成会自动跳转
      const timer = setTimeout(() => {
        // 如果还是没有用户信息，重定向到主页
        if (!initialState?.currentUser?.id) {
          history.replace('/home');
        }
      }, 1000);

      return () => clearTimeout(timer);
    }
  }, [hasToken, isLogin, initialState]);

  // 如果未登录且没有token，返回null（会被重定向到登录页）
  if (!hasToken && !isLogin) {
    return null;
  }

  // 如果有token但用户信息还没加载完（可能是初始化阶段），显示加载中
  if (hasToken && !isLogin) {
    return (
      <Result
        status="loading"
        title="加载中..."
        subTitle="正在验证您的身份，请稍候"
      />
    );
  }

  // 如果已登录但没有权限，显示403页面
  return (
    <Result
      status="403"
      title="403"
      subTitle="抱歉，您没有权限访问该页面"
      extra={
        <Button type="primary" onClick={() => history.push('/home')}>
          返回首页
        </Button>
      }
    />
  );
};

export default NoAccessPage;

