# Amazon ASIN Monitor

一个功能完善的 Amazon ASIN 监控管理系统，支持 ASIN 管理、定时监控、竞品分析、飞书通知等功能。

## 📋 项目简介

Amazon ASIN Monitor 是一个全栈 Web 应用，用于监控和管理 Amazon 商品 ASIN。系统支持通过 Amazon SP-API 获取商品数据，提供定时监控、变体检查、竞品分析等功能，并支持飞书通知、数据导出、用户权限管理等企业级特性。

## ✨ 功能特性

### 核心功能

- **ASIN 管理**

  - 变体组管理（创建、编辑、删除）
  - ASIN 批量导入/导出（支持 Excel）
  - ASIN 移动和分组管理
  - 多站点支持（US、UK、DE、FR、IT、ES 等）

- **监控任务**

  - 定时自动监控（按区域设置不同频率）
  - 手动触发监控
  - 变体组检查
  - 监控历史记录查询

- **竞品监控**

  - 竞品 ASIN 管理
  - 竞品监控任务
  - 竞品变体检查
  - 独立数据库隔离

- **数据分析**
  - 监控数据可视化
  - 趋势分析图表
  - 数据统计报表

### 企业级特性

- **用户权限管理**

  - 基于角色的访问控制（RBAC）
  - 用户管理、角色管理、权限管理
  - JWT 认证

- **审计日志**

  - 操作记录追踪
  - 审计日志查询

- **通知集成**

  - 飞书 Webhook 通知
  - 按国家/区域配置通知
  - 异常情况自动推送

- **系统管理**

  - SP-API 配置管理
  - 系统设置
  - 数据备份与恢复
  - 全局告警消息

- **数据导出**
  - Excel 格式导出
  - 监控历史导出

## 🛠 技术栈

### 前端

- **框架**: React 18 + TypeScript
- **UI 库**: Ant Design 5
- **构建工具**: UmiJS 4
- **图表**: ECharts + @ant-design/charts
- **状态管理**: UmiJS Model
- **路由**: UmiJS Router

### 后端

- **运行时**: Node.js
- **框架**: Express
- **数据库**: MySQL 5.7+
- **缓存/队列**: Redis + Bull
- **认证**: JWT (jsonwebtoken)
- **定时任务**: node-cron
- **WebSocket**: ws
- **监控指标**: Prometheus (prom-client)

### 开发工具

- **代码格式化**: Prettier
- **Git Hooks**: Husky
- **进程管理**: PM2 (生产环境)

## 📦 环境要求

- **Node.js**: >= 14.0.0 (推荐 16.x 或更高版本)
- **MySQL**: >= 5.7
- **Redis**: >= 5.0 (用于队列和缓存)
- **npm**: >= 6.0.0

## 🚀 快速开始

### 1. 克隆项目

```bash
git clone <repository-url>
cd Amazon-ASIN-monitor
```

### 2. 安装依赖

#### 安装后端依赖

```bash
cd server
npm install
```

#### 安装前端依赖

```bash
cd ..
npm install
```

### 3. 配置环境变量

复制后端环境变量模板：

```bash
cd server
cp env.template .env
```

编辑 `.env` 文件，配置以下关键信息：

```env
# 数据库配置
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=amazon_asin_monitor

# Redis 配置
REDIS_URL=redis://127.0.0.1:6379

# JWT 配置
JWT_SECRET=your_jwt_secret_key_change_this_in_production

# 服务器配置
PORT=3001
CORS_ORIGIN=http://localhost:8000

# SP-API 配置（可选，可通过前端配置）
SP_API_LWA_CLIENT_ID=your_client_id
SP_API_LWA_CLIENT_SECRET=your_client_secret
SP_API_REFRESH_TOKEN=your_refresh_token
```

详细配置说明请参考 `server/env.template` 文件。

### 4. 初始化数据库

#### 创建数据库

```sql
CREATE DATABASE amazon_asin_monitor CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

#### 执行初始化脚本

```bash
cd server
mysql -u root -p amazon_asin_monitor < database/init.sql
```

#### 执行数据库迁移（如有）

```bash
# 按顺序执行 migrations 目录下的 SQL 文件
mysql -u root -p amazon_asin_monitor < database/migrations/001_add_asin_type.sql
# ... 其他迁移文件
```

#### 初始化管理员用户

```bash
cd server
node init-admin-user.js
```

### 5. 启动服务

#### 开发环境

**启动后端服务**（在 `server` 目录）：

```bash
cd server
npm run dev
```

后端服务将运行在 `http://localhost:3001`

**启动前端服务**（在项目根目录）：

```bash
npm run dev
```

前端应用将运行在 `http://localhost:8000`

#### 生产环境

**构建前端**：

```bash
npm run build
```

**启动后端**：

```bash
cd server
npm start
```

或使用 PM2：

```bash
pm2 start ecosystem.config.js
```

## 📁 项目结构

```
Amazon-ASIN-monitor/
├── src/                    # 前端源代码
│   ├── pages/             # 页面组件
│   │   ├── Home/          # 首页/仪表盘
│   │   ├── ASIN/          # ASIN 管理
│   │   ├── CompetitorASIN/ # 竞品 ASIN 管理
│   │   ├── MonitorHistory/ # 监控历史
│   │   ├── Analytics/     # 数据分析
│   │   ├── Settings/       # 系统设置
│   │   ├── UserManagement/ # 用户管理
│   │   └── ...
│   ├── components/        # 公共组件
│   ├── services/          # API 服务
│   ├── utils/             # 工具函数
│   └── app.tsx            # 应用配置
├── server/                # 后端源代码
│   ├── src/
│   │   ├── config/        # 配置文件
│   │   ├── controllers/   # 控制器
│   │   ├── models/        # 数据模型
│   │   ├── routes/        # 路由
│   │   ├── services/      # 业务逻辑
│   │   ├── middleware/    # 中间件
│   │   └── utils/         # 工具函数
│   ├── database/          # 数据库脚本
│   │   ├── init.sql       # 初始化脚本
│   │   └── migrations/   # 数据库迁移
│   ├── env.template       # 环境变量模板
│   └── index.js           # 入口文件
├── dist/                  # 前端构建输出（生产环境）
├── scripts/               # 脚本文件
├── deploy.sh              # 部署脚本
├── nginx.conf.example     # Nginx 配置示例
├── ecosystem.config.js    # PM2 配置
└── package.json           # 前端依赖配置
```

## ⚙️ 配置说明

### 数据库配置

系统支持两个数据库：

1. **主数据库** (`amazon_asin_monitor`): 用于存储 ASIN、监控历史等主要数据
2. **竞品数据库** (`amazon_competitor_monitor`): 用于存储竞品相关数据（可选，如不配置则使用主数据库）

### Redis 配置

Redis 用于：

- Bull 任务队列
- 数据缓存

支持两种配置方式：

1. **Redis URL**（推荐）：

   ```env
   REDIS_URL=redis://127.0.0.1:6379
   # 或带密码
   REDIS_URL=redis://:password@127.0.0.1:6379
   ```

2. **单独配置项**：
   ```env
   REDIS_HOST=127.0.0.1
   REDIS_PORT=6379
   REDIS_PASSWORD=your_password
   ```

### SP-API 配置

Amazon Selling Partner API 配置可以通过两种方式：

1. **环境变量**（在 `.env` 文件中）
2. **前端系统设置页面**（推荐，更灵活）

支持多区域配置（US、EU 等），详细配置说明请参考 `server/SP-API-SETUP.md`。

### 监控任务配置

在 `.env` 文件中可以配置：

```env
# 并发控制
MONITOR_MAX_CONCURRENT_GROUP_CHECKS=3
MAX_ALLOWED_CONCURRENT_GROUP_CHECKS=10

# 分批处理
MONITOR_BATCH_COUNT=1
MONITOR_MAX_GROUPS_PER_TASK=0

# 请求延迟（避免限流）
SP_API_REQUEST_DELAY_INTERVAL=20
SP_API_REQUEST_DELAY_MS=150
```

定时任务配置：

- **美国区域 (US)**: 每小时整点和 30 分执行
- **欧洲区域 (UK, DE, FR, IT, ES)**: 每小时整点执行

详细说明请参考 `server/SCHEDULER-GUIDE.md`。

## 🚢 部署说明

### 开发环境部署

参考 [快速开始](#-快速开始) 章节。

### 生产环境部署

#### 使用部署脚本（1Panel）

```bash
chmod +x deploy.sh
sudo ./deploy.sh
```

脚本会自动：

1. 检查环境依赖
2. 安装依赖
3. 构建前端
4. 测试数据库连接

#### 手动部署

1. **构建前端**：

   ```bash
   npm run build
   ```

2. **配置 Nginx**：参考 `nginx.conf.example` 配置 Nginx 反向代理

3. **启动后端服务**：

   ```bash
   cd server
   npm start
   ```

   或使用 PM2：

   ```bash
   pm2 start ecosystem.config.js
   ```

4. **配置进程守护**：使用 PM2 或 systemd 确保后端服务持续运行

#### Nginx 配置要点

- 前端静态文件：`/opt/amazon-asin-monitor/dist`
- API 反向代理：`/api` -> `http://127.0.0.1:3001/api/v1`
- SPA 路由支持：`try_files $uri $uri/ /index.html;`

完整配置示例见 `nginx.conf.example`。

## 📡 API 文档

### 认证接口

- `POST /api/v1/auth/login` - 用户登录
- `POST /api/v1/auth/logout` - 用户登出
- `GET /api/v1/auth/current-user` - 获取当前用户信息

### ASIN 管理接口

- `GET /api/v1/variant-groups` - 查询变体组列表
- `POST /api/v1/variant-groups` - 创建变体组
- `PUT /api/v1/variant-groups/:groupId` - 更新变体组
- `DELETE /api/v1/variant-groups/:groupId` - 删除变体组
- `POST /api/v1/asins` - 创建 ASIN
- `PUT /api/v1/asins/:asinId` - 更新 ASIN
- `DELETE /api/v1/asins/:asinId` - 删除 ASIN

### 监控接口

- `POST /api/v1/monitor/check` - 手动触发监控
- `POST /api/v1/monitor/check-variant-group` - 检查变体组
- `GET /api/v1/monitor/history` - 查询监控历史

### 竞品监控接口

- `GET /api/v1/competitor-asins` - 查询竞品 ASIN 列表
- `POST /api/v1/competitor-monitor/check` - 触发竞品监控

### 用户管理接口

- `GET /api/v1/users` - 查询用户列表
- `POST /api/v1/users` - 创建用户
- `PUT /api/v1/users/:userId` - 更新用户
- `DELETE /api/v1/users/:userId` - 删除用户

### 系统接口

- `GET /api/v1/dashboard` - 获取仪表盘数据
- `GET /api/v1/system/config` - 获取系统配置
- `POST /api/v1/system/config` - 更新系统配置
- `GET /api/v1/audit-logs` - 查询审计日志
- `GET /api/v1/backup/list` - 获取备份列表
- `POST /api/v1/backup/create` - 创建备份
- `POST /api/v1/backup/restore` - 恢复备份

### 健康检查

- `GET /health` - 服务健康检查
- `GET /metrics` - Prometheus 监控指标

## ❓ 常见问题

### 1. 数据库连接失败

**问题**: 启动后端时提示数据库连接失败

**解决方案**:

- 检查 MySQL 服务是否运行
- 确认 `.env` 文件中的数据库配置正确
- 确认数据库已创建
- 检查数据库用户权限

### 2. Redis 连接失败

**问题**: 任务队列无法正常工作

**解决方案**:

- 检查 Redis 服务是否运行：`redis-cli ping`
- 确认 `.env` 文件中的 Redis 配置正确
- 检查 Redis 密码配置（如设置了密码）

### 3. SP-API 请求失败

**问题**: 监控任务返回 API 错误

**解决方案**:

- 检查 SP-API 配置是否正确（LWA Client ID/Secret、Refresh Token）
- 确认 AWS 凭证配置（如启用 AWS 签名）
- 检查 API 限流情况
- 查看后端日志了解详细错误信息

### 4. 前端无法连接后端

**问题**: 前端页面显示网络错误

**解决方案**:

- 确认后端服务已启动（`http://localhost:3001`）
- 检查 CORS 配置（`CORS_ORIGIN` 环境变量）
- 开发环境检查代理配置（`.umirc.ts`）
- 生产环境检查 Nginx 反向代理配置

### 5. 定时任务不执行

**问题**: 定时监控任务没有自动运行

**解决方案**:

- 确认后端服务持续运行（使用 PM2 或 systemd）
- 检查 `schedulerService` 是否正常初始化
- 查看后端日志确认定时任务是否启动
- 参考 `server/SCHEDULER.md` 了解定时任务配置

### 6. 飞书通知不发送

**问题**: 配置了飞书 Webhook 但没有收到通知

**解决方案**:

- 确认飞书 Webhook URL 正确
- 检查飞书配置是否启用（`enabled: true`）
- 确认监控任务检测到异常（只有异常情况才会发送通知）
- 查看后端日志了解通知发送情况

### 7. 权限不足错误

**问题**: 访问某些页面提示 403 权限不足

**解决方案**:

- 确认用户角色具有相应权限
- 检查权限配置（角色-权限关联）
- 联系管理员分配权限

## 📝 相关文档

- [后端服务文档](server/README.md)
- [数据库文档](server/database/README.md)
- [数据库迁移指南](server/database/MIGRATION.md)
- [定时任务指南](server/SCHEDULER-GUIDE.md)
- [定时任务详细说明](server/SCHEDULER.md)
- [SP-API 配置指南](server/SP-API-SETUP.md)

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📄 许可证

本项目采用 ISC 许可证。

## 📞 支持

如有问题或建议，请提交 Issue 或联系项目维护者。

---

**注意**: 生产环境部署前，请务必：

- 修改默认的 JWT_SECRET
- 配置强密码
- 启用 HTTPS
- 配置防火墙规则
- 定期备份数据库
