import { debugLog } from '@/utils/debug';
import { hasAuthSession } from '@/utils/token';
import type { InitialStateType } from '@@/plugin-initialState/@@initialState';

export default function accessFactory(initialState: InitialStateType) {
  const {
    currentUser,
    permissions: initialStatePermissions = [],
    roles: initialStateRoles = [],
  } = initialState || {};

  // 从 initialState 根级别获取权限和角色（不是从 currentUser 中）
  const permissions = initialStatePermissions || [];
  const roles = initialStateRoles || [];
  const permissionSet = new Set(permissions);

  // 检查是否有 token（用于判断是否正在加载中）
  const hasToken = typeof window !== 'undefined' && hasAuthSession();

  // 检查是否已登录（有用户信息）
  // 如果有 token 但用户信息还没加载完，也认为是已登录（数据正在加载中）
  const hasUser = !!currentUser?.id;
  const isLogin = hasUser || hasToken;

  // 调试日志（仅在开发环境）
  if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
    const pathname = window.location.pathname;
    if (pathname === '/home' || pathname === '/') {
      debugLog('[Access] 权限检查:', {
        pathname,
        hasToken,
        hasUser,
        isLogin,
        currentUser: currentUser
          ? { id: currentUser.id, username: currentUser.username }
          : null,
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

    canAccessUserManagement:
      hasUser &&
      (permissionSet.has('user:read') || permissionSet.has('role:read')),

    // 权限检查（需要用户信息已加载）
    canReadASIN: hasUser && permissionSet.has('asin:read'),
    canWriteASIN: hasUser && permissionSet.has('asin:write'),
    canDeleteASIN: hasUser && permissionSet.has('asin:delete'),
    canReadMonitor: hasUser && permissionSet.has('monitor:read'),
    canWriteMonitor: hasUser && permissionSet.has('monitor:write'),
    canReadAnalytics: hasUser && permissionSet.has('analytics:read'),
    canReadSettings: hasUser && permissionSet.has('settings:read'),
    canWriteSettings: hasUser && permissionSet.has('settings:write'),
    canReadUser: hasUser && permissionSet.has('user:read'),
    canWriteUser: hasUser && permissionSet.has('user:write'),
    canDeleteUser: hasUser && permissionSet.has('user:delete'),
    canReadRole: hasUser && permissionSet.has('role:read'),
    canWriteRole: hasUser && permissionSet.has('role:write'),
    canReadAudit: hasUser && permissionSet.has('audit:read'),
    mustChangePassword:
      hasUser && Boolean(currentUser?.force_password_change),
  };
}
