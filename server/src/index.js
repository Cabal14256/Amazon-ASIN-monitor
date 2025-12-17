const express = require('express');
const cors = require('cors');
require('dotenv').config();
const logger = require('./utils/logger');
const { validateEnv } = require('./config/envValidator');
const { testConnection } = require('./config/database');
const {
  testConnection: testCompetitorConnection,
} = require('./config/competitor-database');
const { initScheduler } = require('./services/schedulerService');
const authRoutes = require('./routes/authRoutes');
const asinRoutes = require('./routes/asinRoutes');
const monitorRoutes = require('./routes/monitorRoutes');
const variantCheckRoutes = require('./routes/variantCheckRoutes');
const competitorAsinRoutes = require('./routes/competitorAsinRoutes');
const competitorMonitorRoutes = require('./routes/competitorMonitorRoutes');
const competitorVariantCheckRoutes = require('./routes/competitorVariantCheckRoutes');
const feishuRoutes = require('./routes/feishuRoutes');
const spApiConfigRoutes = require('./routes/spApiConfigRoutes');
const userRoutes = require('./routes/userRoutes');
const roleRoutes = require('./routes/roleRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const auditLogRoutes = require('./routes/auditLogRoutes');
const exportRoutes = require('./routes/exportRoutes');
const systemRoutes = require('./routes/systemRoutes');
const backupRoutes = require('./routes/backupRoutes');
const websocketService = require('./services/websocketService');
const auditLogMiddleware = require('./middleware/auditLog');
const metricsMiddleware = require('./middleware/metrics');
const metricsService = require('./services/metricsService');

const app = express();
const PORT = process.env.PORT || 3001;

// 中间件
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:8000',
    credentials: true,
  }),
);
// 响应压缩（如果安装了compression包）
// 注意：排除 SSE 响应和导出路由，因为压缩会缓冲数据，破坏 SSE 流式特性
try {
  const compression = require('compression');
  app.use(
    compression({
      threshold: 1024, // 只压缩大于1KB的响应
      level: 6, // 压缩级别
      filter: (req, res) => {
        // 如果请求标记为不压缩，则不压缩
        if (req.noCompression) {
          return false;
        }
        // 排除导出路由（使用 SSE 流式响应）
        if (req.path && req.path.includes('/export')) {
          return false;
        }
        // 排除 SSE 响应（如果响应头已设置）
        const contentType = res.getHeader('Content-Type');
        if (contentType && contentType.includes('text/event-stream')) {
          return false;
        }
        // 使用默认的压缩过滤器
        return compression.filter(req, res);
      },
    }),
  );
} catch (error) {
  // compression包未安装，跳过
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Prometheus 监控
app.use(metricsMiddleware);

// 请求超时处理
const timeout = require('./middleware/timeout');
// 为导出路由设置更长的超时时间（10分钟），因为数据量大时可能需要较长时间
app.use('/api/v1/export', timeout(600000));
// 为统计查询和仪表盘设置更长的超时时间（120秒）
app.use('/api/v1/analytics', timeout(120000));
app.use('/api/v1/dashboard', timeout(120000));
// 其他 API 使用默认超时（30秒）
app.use('/api/v1', timeout(30000));

// API限流（应用到所有API路由）
try {
  const { apiLimiter } = require('./middleware/rateLimit');
  app.use('/api/v1/', apiLimiter);
} catch (error) {
  // 限流中间件加载失败，继续运行
}

// 健康检查
const healthController = require('./controllers/healthController');
app.get('/health', healthController.getHealth);
app.get('/api/v1/health', healthController.getHealth);

// API路由
app.use('/api/v1', authRoutes); // 认证路由（放在最前面，登录不需要认证）

// 审计日志中间件（在需要记录的操作路由之前）
app.use('/api/v1', auditLogMiddleware);

app.use('/api/v1', dashboardRoutes); // 仪表盘路由
app.use('/api/v1', asinRoutes);
app.use('/api/v1', monitorRoutes);
app.use('/api/v1', variantCheckRoutes);
app.use('/api/v1', competitorAsinRoutes);
app.use('/api/v1', competitorMonitorRoutes);
app.use('/api/v1', competitorVariantCheckRoutes);
app.use('/api/v1', feishuRoutes);
app.use('/api/v1', spApiConfigRoutes);
app.use('/api/v1', userRoutes); // 用户管理路由
app.use('/api/v1', roleRoutes); // 角色和权限管理路由
app.use('/api/v1', auditLogRoutes); // 审计日志路由
app.use('/api/v1', exportRoutes); // 导出路由
app.use('/api/v1', systemRoutes); // 系统级别配置
app.use('/api/v1', backupRoutes); // 备份恢复路由

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', metricsService.register.contentType);
  res.send(await metricsService.register.metrics());
});

// 404处理
app.use((req, res) => {
  res.status(404).json({
    success: false,
    errorMessage: '接口不存在',
    errorCode: 404,
  });
});

// 错误处理
const errorHandler = require('./middleware/errorHandler');
app.use(errorHandler);

// 启动服务器
async function startServer() {
  // 首先验证环境变量
  validateEnv();

  // 测试数据库连接
  const dbConnected = await testConnection();
  if (!dbConnected) {
    logger.error('⚠️  警告: 数据库连接失败，请检查配置');
    logger.info('💡 提示: 请确保已创建数据库并配置 .env 文件');
  }

  const competitorDbConnected = await testCompetitorConnection();
  if (!competitorDbConnected) {
    logger.error('⚠️  警告: 竞品数据库连接失败，请检查配置');
    logger.info('💡 提示: 请确保已创建竞品数据库并配置 .env 文件');
  }

  // 初始化定时任务
  initScheduler();

  const server = app.listen(PORT, () => {
    logger.info(`🚀 服务器运行在 http://localhost:${PORT}`);
    logger.info(`📝 API文档: http://localhost:${PORT}/api/v1`);
    logger.info(`📊 仪表盘API: http://localhost:${PORT}/api/v1/dashboard`);

    // 初始化WebSocket服务器
    websocketService.init(server);
  });
}

startServer();
