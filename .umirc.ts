import { defineConfig } from '@umijs/max';

export default defineConfig({
  antd: {},
  model: {},
  initialState: {},
  mock: false, // 禁用mock数据，使用真实后端API
  request: {
    // 配置请求基础路径，开发环境使用代理，生产环境使用实际API地址
    baseURL:
      process.env.NODE_ENV === 'production' ? 'http://localhost:3001' : '/api',
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
      name: '首页',
      path: '/home',
      component: './Home',
    },
    {
      name: 'ASIN 管理',
      path: '/asin',
      component: './ASIN',
    },
    {
      name: '监控历史',
      path: '/monitor-history',
      component: './MonitorHistory',
    },
    {
      name: '数据分析',
      path: '/analytics',
      component: './Analytics',
    },
    {
      name: '系统设置',
      path: '/settings',
      component: './Settings',
    },
  ],
  npmClient: 'npm',
});
