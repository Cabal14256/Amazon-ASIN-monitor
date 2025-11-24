const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { testConnection } = require('./config/database');
const { initScheduler } = require('./services/schedulerService');
const authRoutes = require('./routes/authRoutes');
const asinRoutes = require('./routes/asinRoutes');
const monitorRoutes = require('./routes/monitorRoutes');
const variantCheckRoutes = require('./routes/variantCheckRoutes');
const feishuRoutes = require('./routes/feishuRoutes');
const spApiConfigRoutes = require('./routes/spApiConfigRoutes');

const app = express();
const PORT = process.env.PORT || 3001;

// 中间件
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:8000',
    credentials: true,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// API路由
app.use('/api/v1', authRoutes); // 认证路由（放在最前面，登录不需要认证）
app.use('/api/v1', asinRoutes);
app.use('/api/v1', monitorRoutes);
app.use('/api/v1', variantCheckRoutes);
app.use('/api/v1', feishuRoutes);
app.use('/api/v1', spApiConfigRoutes);

// 404处理
app.use((req, res) => {
  res.status(404).json({
    success: false,
    errorMessage: '接口不存在',
    errorCode: 404,
  });
});

// 错误处理
app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  res.status(500).json({
    success: false,
    errorMessage: err.message || '服务器内部错误',
    errorCode: 500,
  });
});

// 启动服务器
async function startServer() {
  // 测试数据库连接
  const dbConnected = await testConnection();
  if (!dbConnected) {
    console.error('⚠️  警告: 数据库连接失败，请检查配置');
    console.log('💡 提示: 请确保已创建数据库并配置 .env 文件');
  }

  // 初始化定时任务
  initScheduler();

  app.listen(PORT, () => {
    console.log(`🚀 服务器运行在 http://localhost:${PORT}`);
    console.log(`📝 API文档: http://localhost:${PORT}/api/v1`);
  });
}

startServer();
