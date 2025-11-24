import { InitialState } from '@umijs/max';

export default function accessFactory(initialState: InitialState) {
  const { currentUser, permissions: initialStatePermissions = [], roles: initialStateRoles = [] } = initialState || {};
  
  // 从 initialState 根级别获取权限和角色（不是从 currentUser 中）
  const permissions = initialStatePermissions || [];
  const roles = initialStateRoles || [];

  // 检查是否有 token（用于判断是否正在加载中）
  const hasToken = typeof window !== 'undefined' && !!localStorage.getItem('token');
  
  // 检查是否已登录（有用户信息）
  // 如果有 token 但用户信息还没加载完，也认为是已登录（数据正在加载中）
  const hasUser = !!currentUser?.id;
  const isLogin = hasUser || hasToken;

  // 调试日志（仅在开发环境）
  if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
    const pathname = window.location.pathname;
    if (pathname === '/home' || pathname === '/') {
      console.log('[Access] 权限检查:', {
        pathname,
        hasToken,
        hasUser,
        isLogin,
        currentUser: currentUser ? { id: currentUser.id, username: currentUser.username } : null,
        permissions: permissions.length > 0 ? permissions : 'empty',
        roles: roles.length > 0 ? roles : 'empty',
      });
    }
  }

  return {
    // 登录检查（所有需要登录的页面都先检查这个）
    // 如果有 token，即使用户信息还没加载完，也允许访问（避免初始化时的403）
    isLogin,

    // 角色检查（需要用户信息已加载）
    canAccessAdmin: hasUser && roles.includes('ADMIN'),
    canAccessEditor:
      hasUser && (roles.includes('EDITOR') || roles.includes('ADMIN')),
    canAccessReadOnly:
      hasUser &&
      (roles.includes('READONLY') ||
        roles.includes('EDITOR') ||
        roles.includes('ADMIN')),

    // 权限检查（需要用户信息已加载）
    canReadASIN: hasUser && permissions.includes('asin:read'),
    canWriteASIN: hasUser && permissions.includes('asin:write'),
    canReadMonitor: hasUser && permissions.includes('monitor:read'),
    canReadAnalytics: hasUser && permissions.includes('analytics:read'),
    canReadSettings: hasUser && permissions.includes('settings:read'),
    canWriteSettings: hasUser && permissions.includes('settings:write'),
    canReadUser: hasUser && permissions.includes('user:read'),
    canWriteUser: hasUser && permissions.includes('user:write'),
  };
}
