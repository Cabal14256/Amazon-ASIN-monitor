// 运行时配置
import GlobalAlert from '@/components/GlobalAlert';
import { logout } from '@/services/auth/AuthController';
import { debugError, debugLog, debugWarn } from '@/utils/debug';
import { clearToken, getToken } from '@/utils/token';
import * as Icons from '@ant-design/icons';
import {
  FileTextOutlined,
  LogoutOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { history, request as umiRequest } from '@umijs/max';
import { App as AntdApp, Avatar, Badge, Button, Dropdown, Space } from 'antd';
import React, { useEffect } from 'react';

// 全局初始化数据配置，用于 Layout 用户信息和权限初始化
// 更多信息见文档：https://umijs.org/docs/api/runtime-config#getinitialstate
export async function getInitialState(): Promise<{
  currentUser?: API.CurrentUser;
  permissions?: string[];
  roles?: string[];
  sessionId?: string;
}> {
  // 从storage获取token
  const token = getToken();

  // 调试日志
  if (process.env.NODE_ENV === 'development') {
    debugLog('[getInitialState] 开始执行', {
      hasToken: !!token,
      pathname: window.location.pathname,
    });
  }

  // 获取当前路径
  const currentPath = window.location.pathname;
  const isLoginPage =
    currentPath === '/login' || currentPath.startsWith('/login');

  if (!token) {
    // 调试日志
    if (process.env.NODE_ENV === 'development') {
      debugLog('[getInitialState] 没有token', {
        isLoginPage,
        currentPath,
      });
    }

    // 如果没有token且不在登录页，强制重定向到登录页
    if (!isLoginPage) {
      // 使用 window.location 强制重定向，避免路由拦截
      const targetPath = currentPath === '/' ? '/home' : currentPath;
      window.location.href = `/login?redirect=${encodeURIComponent(
        targetPath,
      )}`;
      // 返回空对象，阻止后续渲染
      return {};
    }
    return {};
  }

  // 调试日志：有token，准备调用API
  if (process.env.NODE_ENV === 'development') {
    debugLog('[getInitialState] 有token，准备调用API', {
      tokenLength: token.length,
      isLoginPage,
      currentPath,
    });
  }

  try {
    // 获取当前用户信息
    if (process.env.NODE_ENV === 'development') {
      debugLog('[getInitialState] 正在调用API: /api/v1/auth/current-user');
    }

    const response = await umiRequest<API.Result_CurrentUser_>(
      '/api/v1/auth/current-user',
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        skipErrorHandler: true,
        timeout: 5000, // 5秒超时
      },
    );

    // 调试日志：打印响应
    if (process.env.NODE_ENV === 'development') {
      debugLog('[getInitialState] API 响应:', {
        success: response?.success,
        hasData: !!response?.data,
        errorMessage: response?.errorMessage,
        errorCode: response?.errorCode,
      });
    }

    if (response?.success && response?.data) {
      const userData = {
        currentUser: response.data.user,
        permissions: response.data.permissions || [],
        roles: response.data.roles || [],
        sessionId: response.data.sessionId,
      };

      // 调试日志
      if (process.env.NODE_ENV === 'development') {
        debugLog('[getInitialState] 用户数据加载成功:', {
          userId: userData.currentUser?.id,
          username: userData.currentUser?.username,
          permissionsCount: userData.permissions.length,
          rolesCount: userData.roles.length,
        });
      }

      return userData;
    }

    // 如果响应不成功，记录日志
    if (response && !response.success) {
      debugWarn('[getInitialState] API 返回失败:', {
        errorMessage: response.errorMessage,
        errorCode: response.errorCode,
      });

      // 如果是401错误，清除token并重定向
      if (response.errorCode === 401) {
        clearToken();
        if (!isLoginPage) {
          setTimeout(() => {
            history.push(`/login?redirect=${encodeURIComponent(currentPath)}`);
          }, 0);
        }
        return {};
      }

      // 其他错误（非401），如果是401才清除token
      // 其他错误可能是临时问题，不应该清除token
      if (response.errorCode === 401 && token) {
        debugWarn('[getInitialState] API返回401，清除token并重定向到登录页');
        clearToken();
        if (!isLoginPage) {
          window.location.href = `/login?redirect=${encodeURIComponent(
            currentPath,
          )}`;
        }
        return {};
      }

      // 非401错误，如果是临时问题，允许继续访问
      if (token) {
        debugWarn(
          '[getInitialState] API返回失败，但token存在，允许继续访问（可能是临时问题）',
        );
        return {
          permissions: [],
          roles: [],
        };
      }
    }
  } catch (error: any) {
    debugError('[getInitialState] 获取用户信息失败:', error);
    debugError('[getInitialState] 错误详情:', {
      message: error?.message,
      response: error?.response,
      status: error?.response?.status,
      data: error?.data,
      errorCode: error?.data?.errorCode,
    });

    // 检查错误状态码
    const errorStatus = error?.response?.status || error?.status;
    const errorCode =
      error?.data?.errorCode || error?.response?.data?.errorCode;

    // 如果是401或403错误，说明token无效或过期
    if (
      errorStatus === 401 ||
      errorStatus === 403 ||
      errorCode === 401 ||
      errorCode === 403
    ) {
      debugWarn('[getInitialState] Token无效或过期，清除token并重定向到登录页');
      clearToken();
      // 如果不在登录页，重定向到登录页
      if (!isLoginPage) {
        // 使用 window.location 强制重定向，避免路由拦截
        window.location.href = `/login?redirect=${encodeURIComponent(
          currentPath,
        )}`;
      }
      return {};
    }

    // 检查是否是网络错误或超时
    const isNetworkError =
      error?.message?.includes('timeout') ||
      error?.message?.includes('Network Error') ||
      error?.message?.includes('Failed to fetch') ||
      error?.response?.status === 0 ||
      !error?.response?.status;

    // 如果是网络错误或超时，且有token，可能是临时问题
    // 返回一个状态让权限检查通过，这样用户可以看到页面（虽然可能没有完整功能）
    if (isNetworkError && token) {
      debugWarn(
        '[getInitialState] 网络错误，但token存在，允许继续访问（可能是临时问题）',
      );
      return {
        permissions: [],
        roles: [],
      };
    }

    // 如果是500错误（服务器错误），可能是数据库连接问题或后端问题
    // 如果后端返回500，说明后端有问题，不应该清除token（token可能仍然有效）
    // 返回一个状态让权限检查通过，但用户可能无法使用完整功能
    if ((errorStatus === 500 || errorCode === 500) && token) {
      debugError(
        '[getInitialState] 服务器错误，但token存在，允许继续访问（可能是临时问题）',
      );
      return {
        permissions: [],
        roles: [],
      };
    }

    // 其他错误，如果有token，也允许继续访问（可能是临时问题）
    if (token) {
      debugWarn(
        '[getInitialState] 获取用户信息失败，但token存在，允许继续访问（可能是临时问题）',
      );
      return {
        permissions: [],
        roles: [],
      };
    }
  }

  // 如果没有token，返回空对象
  if (!token) {
    return {};
  }

  // 如果到这里，说明有token但获取用户信息失败（没有返回数据）
  // 可能是网络问题或后端问题，不应该清除token
  // 返回一个状态让权限检查通过，这样用户可以看到页面
  if (token) {
    debugWarn(
      '[getInitialState] 有token但未获取到用户数据，允许继续访问（可能是临时问题）',
    );
    return {
      permissions: [],
      roles: [],
    };
  }

  return {};
}

export const layout = ({ initialState, setInitialState }: any) => {
  return {
    logo: 'https://img.alicdn.com/tfs/TB1YHEpwUT1gK0jSZFhXXaAtVXa-28-27.svg',
    title: 'Amazon ASIN Monitor',
    menu: {
      locale: false,
      // 自定义菜单数据，将字符串图标名称转换为 React 组件
      menuDataRender: (menuData: any[]) => {
        return menuData.map((item) => {
          if (item.icon && typeof item.icon === 'string') {
            const IconComponent = (Icons as any)[item.icon];
            if (IconComponent) {
              return {
                ...item,
                icon: React.createElement(IconComponent),
              };
            }
          }
          return item;
        });
      },
    },
    childrenRender: (children: React.ReactNode) => {
      // 创建一个组件来处理动态隐藏/显示逻辑
      const LayoutWrapper = () => {
        useEffect(() => {
          const updateSiderActions = () => {
            const sider = document.querySelector(
              'aside.ant-layout-sider, aside[class*="sider"]',
            );
            if (sider) {
              const actions = sider.querySelector(
                '.ant-pro-sider-actions',
              ) as HTMLElement;
              if (actions) {
                // 检查侧边栏是否收起
                const isCollapsed =
                  sider.classList.contains('ant-layout-sider-collapsed') ||
                  sider.classList.contains('ant-pro-layout-sider-collapsed') ||
                  sider.className.includes('collapsed');

                if (isCollapsed) {
                  // 收起时隐藏
                  actions.style.setProperty('display', 'none', 'important');
                  actions.style.setProperty(
                    'visibility',
                    'hidden',
                    'important',
                  );
                  actions.style.setProperty('width', '0', 'important');
                  actions.style.setProperty('height', '0', 'important');
                  actions.style.setProperty('opacity', '0', 'important');
                  actions.style.setProperty(
                    'pointer-events',
                    'none',
                    'important',
                  );
                } else {
                  // 展开时显示
                  actions.style.removeProperty('display');
                  actions.style.removeProperty('visibility');
                  actions.style.removeProperty('width');
                  actions.style.removeProperty('height');
                  actions.style.removeProperty('opacity');
                  actions.style.removeProperty('pointer-events');
                }
              }
            }
          };

          // 初始检查
          updateSiderActions();

          // 监听 DOM 变化
          const observer = new MutationObserver(() => {
            updateSiderActions();
          });

          // 观察整个文档的变化
          observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class'],
          });

          // 定期检查（作为备用方案）
          const interval = setInterval(updateSiderActions, 100);

          return () => {
            observer.disconnect();
            clearInterval(interval);
          };
        }, []);

        return (
          <AntdApp>
            <GlobalAlert />
            {children}
          </AntdApp>
        );
      };

      return <LayoutWrapper />;
    },
    // 侧边栏底部用户信息 - 收起时隐藏
    siderFooterRender: (props: { collapsed?: boolean }) => {
      // 如果侧边栏收起，不渲染底部用户信息
      if (props?.collapsed) {
        return null;
      }

      const currentUser = initialState?.currentUser;
      if (!currentUser) {
        return null;
      }

      const displayName =
        currentUser.real_name || currentUser.username || '用户';
      const roleName = currentUser.role_name || '系统管理员';

      return (
        <div style={{ padding: '16px', textAlign: 'center' }}>
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <Avatar style={{ backgroundColor: '#87d068' }}>
              {displayName.charAt(0).toUpperCase()}
            </Avatar>
            <div style={{ fontSize: '12px', color: '#666' }}>{displayName}</div>
            <div style={{ fontSize: '11px', color: '#999' }}>{roleName}</div>
          </Space>
        </div>
      );
    },
    // 侧边栏底部操作区 - 收起时隐藏（这是实际渲染 ant-pro-sider-actions 的配置）
    siderActionsRender: (props: any) => {
      // 检查 collapsed 状态，可能在不同的属性中
      const isCollapsed =
        props?.collapsed || props?.collapsedWidth !== undefined;

      // 如果侧边栏收起，不渲染底部操作区
      if (isCollapsed) {
        return null;
      }

      const currentUser = initialState?.currentUser;
      if (!currentUser) {
        return null;
      }

      const displayName =
        currentUser.real_name || currentUser.username || '用户';
      const roleName = currentUser.role_name || '系统管理员';

      return (
        <div style={{ padding: '8px 16px' }}>
          <Button
            type="text"
            block
            style={{ textAlign: 'left', height: 'auto', padding: '8px' }}
          >
            <Space>
              <Avatar style={{ backgroundColor: '#87d068' }}>
                {displayName.charAt(0).toUpperCase()}
              </Avatar>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                }}
              >
                <span style={{ fontSize: '14px', lineHeight: '20px' }}>
                  {displayName}
                </span>
                <span
                  style={{
                    fontSize: '12px',
                    color: '#999',
                    lineHeight: '16px',
                  }}
                >
                  {roleName}
                </span>
              </div>
            </Space>
          </Button>
        </div>
      );
    },
    // 右上角用户操作区
    actionsRender: () => {
      const currentUser = initialState?.currentUser;
      if (!currentUser) {
        return [];
      }

      const displayName =
        currentUser.real_name || currentUser.username || '用户';
      const handleLogout = async () => {
        try {
          await logout();
        } catch (error) {
          debugWarn('[handleLogout] 调用后端登出接口失败，继续本地登出', {
            error,
          });
        } finally {
          clearToken();
          await setInitialState({
            currentUser: undefined,
            permissions: [],
            roles: [],
          });
          history.push('/login');
        }
      };

      const menuItems = [
        {
          key: 'profile',
          label: '个人中心',
          icon: <SettingOutlined />,
        },
        {
          key: 'audit',
          label: '操作审计',
          icon: <FileTextOutlined />,
        },
        {
          key: 'settings',
          label: '系统设置',
          icon: <SettingOutlined />,
        },
        {
          type: 'divider',
        },
        {
          key: 'logout',
          label: '退出登录',
          icon: <LogoutOutlined />,
          danger: true,
        },
      ];
      const handleMenuClick = ({ key }: any) => {
        if (key === 'profile') {
          history.push('/profile');
        } else if (key === 'audit') {
          history.push('/audit-log');
        } else if (key === 'settings') {
          history.push('/settings');
        } else if (key === 'logout') {
          handleLogout();
        }
      };

      return [
        <Dropdown
          menu={{ items: menuItems, onClick: handleMenuClick }}
          placement="bottomRight"
          trigger={['click']}
          key="userActions"
        >
          <Button type="text">
            <Space>
              <Badge dot={false}>
                <Avatar style={{ backgroundColor: '#87d068' }}>
                  {displayName.charAt(0).toUpperCase()}
                </Avatar>
              </Badge>
              <span>{displayName}</span>
            </Space>
          </Button>
        </Dropdown>,
      ];
    },
    // 路由变化时的处理
    onPageChange: () => {
      const token = getToken();
      const currentPath = window.location.pathname;
      const isLoginPage =
        currentPath === '/login' || currentPath.startsWith('/login');
      const is403Page = currentPath === '/403';

      // 如果未登录且访问的页面不是登录页和403页，重定向到登录页
      if (!token && !isLoginPage && !is403Page) {
        history.push(`/login?redirect=${encodeURIComponent(currentPath)}`);
      }
    },
  };
};

// 使用 App 组件包裹整个应用，以支持 message 的 hook API
export function rootContainer(container: React.ReactElement) {
  return React.createElement(AntdApp, null, container);
}

// 请求配置
export const request = {
  // 请求拦截器 - 添加Token
  requestInterceptors: [
    (config: any) => {
      const token = getToken();
      if (token && config.headers) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    },
  ],
  // 响应拦截器 - 处理后端返回的错误格式
  responseInterceptors: [
    (response: any) => {
      // 处理401错误，跳转到登录页
      if (response?.status === 401 || response?.data?.errorCode === 401) {
        clearToken();
        if (window.location.pathname !== '/login') {
          window.location.href = '/login';
        }
        const error: any = new Error('未认证或认证已过期');
        error.data = response?.data || response;
        error.response = response;
        throw error;
      }

      // Umi 的响应拦截器接收的 response 通常是已经解析的数据对象
      // 检查后端返回的 success: false 错误格式
      if (
        response &&
        typeof response === 'object' &&
        response.success === false
      ) {
        const error: any = new Error(response.errorMessage || '请求失败');
        error.data = response;
        error.response = response;
        throw error;
      }
      return response;
    },
  ],
};
