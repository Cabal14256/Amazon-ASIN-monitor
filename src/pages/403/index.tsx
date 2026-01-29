import { history, useModel } from '@umijs/max';
import { debugLog } from '@/utils/debug';
import { Button, Result } from 'antd';
import React, { useEffect } from 'react';

const NoAccessPage: React.FC = () => {
  const { initialState } = useModel('@@initialState');
  const currentUser = initialState?.currentUser;
  const hasToken =
    typeof window !== 'undefined' && !!localStorage.getItem('token');
  const isLogin = !!currentUser?.id;

  useEffect(() => {
    // 如果未登录且没有token，自动跳转到登录页
    if (!hasToken && !isLogin) {
      const currentPath = window.location.pathname;
      history.replace(`/login?redirect=${encodeURIComponent(currentPath)}`);
      return;
    }

    // 如果有 token 但用户信息还没加载完（可能是刚登录，状态还在更新中）
    if (hasToken && !isLogin) {
      // 等待一下，让 getInitialState 有时间执行
      const timer = setTimeout(() => {
        // 如果还是没有用户信息，可能是初始化问题，强制刷新页面
        if (!initialState?.currentUser?.id) {
          debugLog('[403页面] 检测到token但用户信息未加载，强制刷新页面');
          window.location.href = '/home';
        }
      }, 500);

      return () => clearTimeout(timer);
    }

    // 如果有 token 且有用户信息，但仍然显示 403，可能是权限问题
    // 但如果是刚登录后立即访问需要权限的页面，可能是状态更新延迟
    if (hasToken && isLogin) {
      // 检查是否是刚登录后的情况（用户信息存在但权限可能还没更新）
      const timer = setTimeout(() => {
        // 如果用户信息存在，尝试重新加载页面以刷新权限状态
        if (
          initialState?.currentUser?.id &&
          !initialState?.permissions?.length
        ) {
          debugLog('[403页面] 检测到用户信息但权限未加载，刷新页面');
          window.location.reload();
        }
      }, 500);

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
