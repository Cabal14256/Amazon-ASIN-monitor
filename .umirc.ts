import { defineConfig } from '@umijs/max';

export default defineConfig({
  antd: {},
  model: {},
  initialState: {},
  access: {
    // 权限控制配置
    // 当权限检查失败时，显示自定义的 403 页面
    unAccessible: '/403',
  }, // 启用权限控制
  mock: false, // 禁用mock数据，使用真实后端API
  request: {
    // 配置请求基础路径，开发环境使用代理，生产环境使用实际API地址
    // 生产环境：如果使用Nginx反向代理，使用'/api'；如果直接访问后端，使用环境变量API_BASE_URL
    baseURL:
      process.env.NODE_ENV === 'production'
        ? process.env.API_BASE_URL || '/api'
        : '/api',
  },
  // 开发环境代理配置
  proxy: {
    '/api': {
      target: 'http://localhost:3001',
      changeOrigin: true,
      // 不重写路径，保持 /api 前缀，因为后端路由是 /api/v1/...
    },
  },
  layout: {
    title: '@umijs/max',
  },
  routes: [
    {
      path: '/',
      redirect: '/home',
    },
    {
      path: '/login',
      component: './Login',
      layout: false, // 登录页不使用布局
    },
    {
      path: '/403',
      component: './403',
      layout: false, // 403页不使用布局
    },
    {
      name: '首页',
      path: '/home',
      component: './Home',
      access: 'isLogin', // 需要登录（更宽松的检查，登录后都有权限）
      icon: 'DashboardOutlined',
    },
    {
      name: 'ASIN 管理',
      path: '/asin',
      component: './ASIN',
      access: 'canReadASIN', // 需要ASIN查看权限
      icon: 'DatabaseOutlined',
    },
    {
      name: 'ASIN父变体查询',
      path: '/asin-parent-query',
      component: './ASINParentQuery',
      access: 'canReadASIN', // 需要ASIN查看权限
      icon: 'SearchOutlined',
    },
    {
      name: '竞品ASIN 管理',
      path: '/competitor-asin',
      component: './CompetitorASIN',
      access: 'canReadASIN', // 需要ASIN查看权限
      icon: 'DatabaseOutlined',
    },
    {
      name: '监控历史',
      path: '/monitor-history',
      component: './MonitorHistory',
      access: 'canReadMonitor', // 需要监控查看权限
      icon: 'HistoryOutlined',
    },
    {
      name: '竞品监控历史',
      path: '/competitor-monitor-history',
      component: './CompetitorMonitorHistory',
      access: 'canReadMonitor', // 需要监控查看权限
      icon: 'HistoryOutlined',
    },
    {
      name: '数据分析',
      path: '/analytics',
      component: './Analytics',
      access: 'canReadAnalytics', // 需要数据分析权限
      icon: 'BarChartOutlined',
    },
    {
      name: '系统设置',
      path: '/settings',
      component: './Settings',
      access: 'canReadSettings', // 需要系统设置查看权限
      icon: 'SettingOutlined',
    },
    {
      name: '用户与权限',
      path: '/user-management',
      component: './UserManagement',
      access: 'canReadUser', // 需要用户查看权限
      icon: 'UserOutlined',
    },
    {
      name: '操作审计',
      path: '/audit-log',
      component: './AuditLog',
      access: 'canReadUser', // 需要用户查看权限（只有管理员可以查看）
      icon: 'FileTextOutlined',
    },
    {
      name: '个人中心',
      path: '/profile',
      component: './Profile',
      access: 'isLogin', // 需要登录
      icon: 'SmileOutlined',
    },
  ],
  npmClient: 'npm',
});
