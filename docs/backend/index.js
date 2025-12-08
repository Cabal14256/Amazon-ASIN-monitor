require('dotenv').config();
const express = require('express');
const path = require('path');

process.env.LC_ALL = 'zh_CN.UTF-8';
process.env.LANG = 'zh_CN.UTF-8';
process.env.NODE_ENV = 'production';

const app = express();
const port = process.env.PORT || 3000;

/* 解析器 */
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

/* ============== 后端 API ============== */
// 普通监控（组 & 历史 & 分析）
const variantGroupRouter = require('./routes/variantGroup');
app.use('/api/variant-groups', variantGroupRouter);
console.log('✅ 路由已挂载: /api/variant-groups');

const historyRouter = require('./routes/history');
app.use('/api/history', historyRouter);
console.log('✅ 路由已挂载: /api/history');

const analyticsRouter = require('./routes/analytics');
app.use('/api/analytics', analyticsRouter);
console.log('✅ 路由已挂载: /api/analytics');

// 竞品：分析/列表/导入/手动运行/历史
const compAnalyticsRouter = require('./routes/comp-analytics');
app.use('/api/comp-analytics', compAnalyticsRouter);
console.log('✅ 路由已挂载: /api/comp-analytics');

const compGroupsRouter = require('./routes/comp-groups');
app.use('/api/comp-groups', compGroupsRouter); // ← 只挂载一次即可
console.log('✅ 路由已挂载: /api/comp-groups');

const compHistoryRouter = require('./routes/comp-history');
app.use('/api/comp-history', compHistoryRouter);
console.log('✅ 路由已挂载: /api/comp-history');

/* ============== 定时任务 ============== */
// 方案 A：集中在 scheduler 内部注册所有 cron（推荐）
require('./jobs/scheduler');
console.log('⏰ 定时任务: 已通过 jobs/scheduler 注册');

// 方案 B：如果你不打算使用 jobs/scheduler，可改用下方直连注册（两者二选一）
// const { registerCompMonitorJobs } = require('./services/compMonitor');
// registerCompMonitorJobs();
// console.log('⏰ 定时任务: 已由 services/compMonitor.registerCompMonitorJobs() 注册');

/* ============== 静态资源 (Vue) ============== */
app.use(express.static(path.join(__dirname, '../frontend/dist')));

// Vue Router history 模式兜底到 index.html（API 开头的跳过）
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

/* ============== 启动 ============== */
app.listen(port, '0.0.0.0', () => {
  console.log(`✅ 服务已启动，监听端口：${port}`);
});
