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

- **ASIN 父变体查询**
  - 批量查询 ASIN 的父变体信息
  - 支持多 ASIN 同时查询（逗号或换行分隔）
  - 显示变体关系、数量和状态
  - 支持按国家/区域查询

### 企业级特性

- **用户权限管理**

  - 基于角色的访问控制（RBAC）
  - 用户管理、角色管理、权限管理
  - JWT 认证
  - 密码重置功能
  - 密码安全策略
  - 多设备会话管理

- **审计日志**

  - 操作记录追踪
  - 审计日志查询

- **通知集成**

  - 飞书 Webhook 通知
  - 按国家/区域配置通知
  - 异常情况自动推送
  - 独立的飞书配置管理页面
  - 按区域（US/EU）配置通知
  - 启用/禁用开关管理

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
- **构建工具**: @umijs/max (UmiJS 4)
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

- **Node.js**: >= 14.0.0 (推荐 16.x 或 18.x LTS 版本)
- **MySQL**: >= 5.7 (推荐 8.0+)
- **Redis**: >= 5.0 (推荐 6.0+，用于队列和缓存)
- **npm**: >= 6.0.0 (推荐 8.x 或更高版本)

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
# JWT过期时间（默认7天）
JWT_EXPIRES_IN=7d
# 记住我功能的过期时间（默认30天）
JWT_REMEMBER_EXPIRES_IN=30d

# 服务器配置
PORT=3001
CORS_ORIGIN=http://localhost:8000

# SP-API 配置（可选，可通过前端配置）
SP_API_LWA_CLIENT_ID=your_client_id
SP_API_LWA_CLIENT_SECRET=your_client_secret
SP_API_REFRESH_TOKEN=your_refresh_token
# 是否启用AWS签名（false=简化模式，无需AWS签名；true=标准模式，需要完整AWS配置）
SP_API_USE_AWS_SIGNATURE=false
# 是否启用HTML抓取兜底（当SP-API失败时使用HTML抓取，有风险）
ENABLE_HTML_SCRAPER_FALLBACK=false
# 是否启用旧客户端备用方案（当标准SP-API失败时使用）
ENABLE_LEGACY_CLIENT_FALLBACK=false
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

如果是从旧版本升级，需要按顺序执行迁移脚本。**新安装请跳过此步骤**，直接使用 `init.sql` 即可。

```bash
# 按顺序执行 migrations 目录下的 SQL 文件
mysql -u root -p amazon_asin_monitor < database/migrations/001_add_asin_type.sql
mysql -u root -p amazon_asin_monitor < database/migrations/002_add_monitor_fields.sql
# ... 其他迁移文件
```

详细迁移说明请参考下方"数据库文档"章节。

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
│   │   ├── ASINParentQuery/ # ASIN 父变体查询
│   │   ├── CompetitorASIN/ # 竞品 ASIN 管理
│   │   ├── MonitorHistory/ # 监控历史
│   │   ├── CompetitorMonitorHistory/ # 竞品监控历史
│   │   ├── Analytics/     # 数据分析
│   │   ├── Settings/       # 系统设置
│   │   ├── FeishuConfig/   # 飞书配置管理
│   │   ├── UserManagement/ # 用户管理
│   │   ├── AuditLog/       # 操作审计
│   │   ├── Profile/        # 个人中心
│   │   ├── ResetPassword/  # 密码重置
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
│   │   ├── competitor-init.sql # 竞品数据库初始化脚本
│   │   ├── migrations/   # 数据库迁移
│   │   ├── MIGRATION.md  # 迁移说明文档
│   │   └── README.md     # 数据库文档
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

支持多区域配置（US、EU 等）。

#### SP-API 配置步骤

**前置要求**：

1. Amazon Seller Central 账户
2. AWS 账户
3. SP-API 开发者账户

**配置步骤**：

1. **创建 IAM 用户和角色**

   - 登录 AWS 控制台
   - 创建 IAM 用户：
     - 用户名：`sp-api-user`
     - 访问类型：编程访问
     - 保存 Access Key ID 和 Secret Access Key
   - 创建 IAM 角色：
     - 角色名称：`sp-api-role`
     - 信任实体：选择 "另一个 AWS 账户"
     - 输入你的 AWS 账户 ID
     - 附加策略：`AmazonSellingPartnerAPIReadOnlyAccess`（或自定义策略）
   - 记录 Role ARN（格式：`arn:aws:iam::ACCOUNT_ID:role/sp-api-role`）

2. **在 Seller Central 注册应用程序**

   - 登录 Seller Central
   - 进入 "应用和服务" > "开发应用程序"
   - 点击 "添加新应用程序"
   - 填写信息：
     - 应用程序名称
     - OAuth 重定向 URI（开发环境可以使用 `https://localhost`）
   - 保存后获得：
     - LWA Client ID
     - LWA Client Secret

3. **获取 Refresh Token**

   - 使用 OAuth 2.0 授权流程获取 Refresh Token
   - 可以使用 SP-API 授权工具或手动授权
   - 授权工具：https://sellercentral.amazon.com/apps/authorize/consent

4. **配置环境变量**

   在 `server/.env` 文件中添加以下配置：

   ```env
   # SP-API LWA 配置
   SP_API_LWA_CLIENT_ID=your_lwa_client_id
   SP_API_LWA_CLIENT_SECRET=your_lwa_client_secret
   SP_API_REFRESH_TOKEN=your_refresh_token

   # SP-API AWS 配置（如启用 AWS 签名）
   SP_API_ACCESS_KEY_ID=your_aws_access_key_id
   SP_API_SECRET_ACCESS_KEY=your_aws_secret_access_key
   SP_API_ROLE_ARN=arn:aws:iam::YOUR_ACCOUNT_ID:role/sp-api-role
   ```

#### API 端点说明

系统会根据国家代码自动选择正确的 API 端点：

- **US 区域（美国）**: `https://sellingpartnerapi-na.amazon.com`
- **EU 区域（英国、德国、法国、意大利、西班牙）**: `https://sellingpartnerapi-eu.amazon.com`

#### Marketplace ID 映射

系统已配置以下 Marketplace ID：

**US 区域：**

- US: `ATVPDKIKX0DER` (美国)

**EU 区域：**

- UK: `A1F83G8C2ARO7P` (英国)
- DE: `A1PA6795UKMFR9` (德国)
- FR: `A13V1IB3VIYZZH` (法国)
- IT: `APJ6JRA9NG5V4` (意大利)
- ES: `A1RKKUPIHCS9HS` (西班牙)

#### 错误处理

- **404 错误**：ASIN 不存在或无法访问，标记为无变体
- **认证错误**：检查 LWA 配置和 Refresh Token
- **权限错误**：检查 IAM 角色和策略配置
- **限流错误**：SP-API 有速率限制，系统会自动重试

#### SP-API 检查接口

系统提供以下 API 接口用于检查变体状态：

- `POST /api/v1/variant-groups/:groupId/check` - 检查变体组
- `POST /api/v1/asins/:asinId/check` - 检查单个 ASIN
- `POST /api/v1/variant-groups/batch-check` - 批量检查变体组

批量检查示例：

```http
POST /api/v1/variant-groups/batch-check
Content-Type: application/json

{
  "groupIds": ["group-id-1", "group-id-2"],
  "country": "US"
}
```

#### 检查逻辑说明

1. **变体组检查**：

   - 检查组内所有 ASIN 的变体关系
   - 如果任何一个 ASIN 没有变体，整个组标记为异常（is_broken=1）
   - 更新所有 ASIN 和变体组的状态
   - 记录监控历史

2. **ASIN 检查**：
   - 调用 SP-API 获取 ASIN 的变体信息
   - 如果没有变体，标记为异常（is_broken=1）
   - 更新 ASIN 状态
   - 记录监控历史

#### 测试 SP-API 配置

配置完成后，可以使用以下方式测试：

1. 通过 API 接口手动触发检查
2. 查看监控历史记录
3. 检查数据库中的变体状态更新

#### 注意事项

1. SP-API 有速率限制，请合理控制检查频率
2. Refresh Token 可能会过期，需要定期更新
3. 确保 IAM 角色有正确的权限
4. 不同 Marketplace 的 API 端点不同，系统会自动处理

#### 参考文档

- [SP-API 官方文档](https://developer-docs.amazon.com/sp-api/)
- [SP-API 认证指南](https://developer-docs.amazon.com/sp-api/docs/connecting-to-the-selling-partner-api)
- [Catalog Items API](https://developer-docs.amazon.com/sp-api/docs/catalog-items-api-v2022-04-01-reference)

### SP-API 配额管理

系统提供了配额分析和监控工具，帮助管理 SP-API 的调用频率。

#### 快速开始

**1. 分析配额使用情况（推荐首次使用）**

```bash
# 方法1：使用 npm 脚本（推荐）
cd server
npm run analyze-quota

# 方法2：直接运行脚本
node scripts/analyze-quota-usage.js
```

**2. 实时监控配额使用**

```bash
# 方法1：使用 npm 脚本（推荐）
npm run monitor-quota

# 方法2：直接运行脚本
node scripts/monitor-quota-realtime.js
```

#### 配额说明

**当前配额限制**：

根据系统配置：

- **每分钟：60 次请求**
- **每小时：1,000 次请求**

这些限制在 `rateLimiter.js` 中配置，可以通过环境变量修改：

- `SP_API_RATE_LIMIT_PER_MINUTE`：每分钟限制（默认 60）
- `SP_API_RATE_LIMIT_PER_HOUR`：每小时限制（默认 1000）

#### 理解分析结果

**配额使用率指标**：

- **< 70%**：✅ 健康 - 配额充足，系统运行良好
- **70-85%**：⚠️ 注意 - 配额使用率较高，建议监控
- **85-95%**：⚠️ 警告 - 需要优化，否则可能触发限流
- **> 95%**：❌ 危险 - 超过配额限制，系统将被限流

**调用频率计算**：

系统会按照以下规则计算：

1. **US 区域**：按系统设置的监控间隔执行（默认每 30 分钟）

   - 每次检查所有 US 的 ASIN
   - 标准监控 + 竞品监控 = 双倍调用

2. **EU 区域**：按系统设置的监控间隔执行（默认每 60 分钟）

   - 每次检查所有 EU 的 ASIN
   - 标准监控 + 竞品监控 = 双倍调用

3. **计算公式**：
   ```
   US每小时调用 = ASIN数量 × (60/US间隔分钟) × 2个任务
   EU每小时调用 = ASIN数量 × (60/EU间隔分钟) × 2个任务
   总调用 = US调用 + EU调用
   ```

#### 优化建议

**如果配额使用率过高**：

1. **启用分批处理（推荐）**

   在 `.env` 文件中添加：

   ```env
   MONITOR_BATCH_COUNT=2
   ```

   这将把 ASIN 分散到 2 个批次检查，有效降低峰值调用频率。

2. **增加缓存时间**

   系统已实现缓存机制（默认 10 分钟），可以减少重复检查。

3. **调整检查频率**

   在系统设置 → SP-API 配置 → 定时监控频率中调整 US/EU 的执行间隔，减少检查次数。

4. **申请更高配额**

   如果优化后仍不足，可以联系 Amazon 申请提高配额限制。

#### 监控建议

**日常监控**：

1. **定期运行分析脚本**（每周一次）

   ```bash
   npm run analyze-quota
   ```

   特别是在添加大量 ASIN 后。

2. **实时监控**（需要时）
   ```bash
   npm run monitor-quota
   ```
   当系统出现限流错误时使用。

**警告信号**：

- **配额使用率 > 70%**：开始监控配额使用情况，考虑启用分批处理
- **配额使用率 > 85%**：立即优化，检查是否有不必要的 API 调用
- **出现 429 错误（限流）**：检查配额使用情况，启用分批处理或减少检查频率

### 监控任务配置

在 `.env` 文件中可以配置：

```env
# 并发控制
MONITOR_MAX_CONCURRENT_GROUP_CHECKS=3
MAX_ALLOWED_CONCURRENT_GROUP_CHECKS=10

# 分批处理
MONITOR_BATCH_COUNT=1
MONITOR_MAX_GROUPS_PER_TASK=0

# 定时监控频率（分钟，可选值：15/30/60）
MONITOR_US_SCHEDULE_MINUTES=30
MONITOR_EU_SCHEDULE_MINUTES=60

# 是否启用自动调整并发数（默认启用，设置为false禁用）
# 启用后，系统会根据限流情况自动调整并发数
AUTO_ADJUST_CONCURRENCY=true

# SP-API速率限制配置（令牌桶限流器）
# 每分钟允许的请求数（默认60）
SP_API_RATE_LIMIT_PER_MINUTE=60
# 每小时允许的请求数（默认1000）
SP_API_RATE_LIMIT_PER_HOUR=1000

# 缓存配置
# 缓存默认TTL（毫秒，默认30秒）
CACHE_DEFAULT_TTL_MS=30000
# 缓存最大条目数（默认2000）
CACHE_MAX_ENTRIES=2000
# 缓存清理间隔（毫秒，默认60秒）
CACHE_CLEANUP_INTERVAL_MS=60000
```

定时任务配置：

- **美国区域 (US)**: 通过系统设置中的「定时监控频率」配置执行间隔（默认每 30 分钟）
- **欧洲区域 (UK, DE, FR, IT, ES)**: 通过系统设置中的「定时监控频率」配置执行间隔（默认每 60 分钟）

#### 定时任务和飞书通知使用指南

**功能概述**：

系统已实现以下两个核心功能：

1. **定时任务自动监控**

   - 美国区域 (US): 可在系统设置配置执行间隔（默认每 30 分钟）
   - 欧洲区域 (UK, DE, FR, IT, ES): 可在系统设置配置执行间隔（默认每 60 分钟）

2. **飞书通知推送**
   - 按国家/区域推送监控结果
   - 只发送异常情况的通知（有异常 ASIN 时）
   - 支持配置每个国家的 Webhook URL

**快速开始**：

1. **启动后端服务**

   ```bash
   cd server
   npm install  # 如果还没安装依赖
   npm start    # 启动服务
   ```

   服务启动后，定时任务会自动初始化并开始运行。

2. **配置飞书 Webhook**

   **方式 1：通过 API 配置（推荐）**

   ```bash
   # 配置美国区域的飞书Webhook
   curl -X POST http://localhost:3001/api/v1/feishu-configs \
     -H "Content-Type: application/json" \
     -d '{
       "country": "US",
       "webhookUrl": "https://open.feishu.cn/open-apis/bot/v2/hook/xxxxx",
       "enabled": true
     }'
   ```

   **方式 2：直接插入数据库**

   ```sql
   USE amazon_asin_monitor;

   INSERT INTO feishu_config (country, webhook_url, enabled)
   VALUES ('US', 'https://open.feishu.cn/open-apis/bot/v2/hook/xxxxx', 1)
   ON DUPLICATE KEY UPDATE webhook_url = VALUES(webhook_url), enabled = VALUES(enabled);
   ```

3. **获取飞书 Webhook URL**

   - 打开飞书，进入需要接收通知的群聊
   - 点击群设置 → 群机器人 → 添加机器人 → 自定义机器人
   - 设置机器人名称和描述
   - 复制生成的 Webhook URL
   - 使用上面的方式配置到系统中

**定时任务执行流程**：

1. **按配置间隔触发**：系统按 US/EU 设定的分钟间隔触发任务
2. **执行监控检查**：
   - 查询对应国家的所有变体组
   - 对每个变体组调用 SP-API 检查变体状态
   - 更新 ASIN 的监控时间（`last_check_time`）
   - 记录监控历史（`monitor_history`表）
3. **发送飞书通知**：
   - 按国家分组检查结果
   - 只发送有异常 ASIN 的通知
   - 跳过无异常的国家（不发送通知）

**飞书通知内容**：

通知卡片包含以下信息：

- **国家/区域**：检查的国家代码和名称
- **检查时间**：执行检查的时间
- **检查状态**：✅ 全部正常 或 ⚠️ 发现异常
- **检查总数**：本次检查的 ASIN 总数
- **正常数量**：状态正常的 ASIN 数量
- **异常数量**：状态异常的 ASIN 数量
- **异常 ASIN 列表**：列出所有异常的 ASIN（最多显示 10 个）

**ASIN 通知开关**：

每个 ASIN 都有一个 `feishu_notify_enabled` 字段，用于控制是否接收飞书通知：

- `1`：开启通知（默认）
- `0`：关闭通知

**注意**：即使关闭了通知，监控检查仍会正常执行，只是不会发送飞书通知。

**飞书配置管理 API**：

- `GET /api/v1/feishu-configs` - 获取所有配置
- `GET /api/v1/feishu-configs/:country` - 根据国家获取配置
- `POST /api/v1/feishu-configs` - 创建/更新配置
- `PUT /api/v1/feishu-configs/:country` - 更新配置
- `DELETE /api/v1/feishu-configs/:country` - 删除配置
- `PATCH /api/v1/feishu-configs/:country/toggle` - 启用/禁用配置

**手动触发监控任务**：

可以通过 API 手动触发监控任务（用于测试）：

```bash
POST /api/v1/monitor/trigger

Body:
{
  "countries": ["US", "UK"]  // 可选，不提供则检查所有国家
}
```

**支持的国家代码**：

- `US`: 美国（美国区域）
- `UK`: 英国（欧洲区域）
- `DE`: 德国（欧洲区域）
- `FR`: 法国（欧洲区域）
- `IT`: 意大利（欧洲区域）
- `ES`: 西班牙（欧洲区域）

**常见问题**：

**Q1: 定时任务没有执行？**

- 确保后端服务正在运行
- 检查服务器时间是否正确
- 查看控制台日志，确认定时任务已初始化
- 确认当前系统设置中的定时监控频率是否合理

**Q2: 飞书通知没有收到？**

- 确认已配置对应国家的 Webhook URL
- 确认 Webhook URL 是否正确（可以在浏览器中测试）
- 确认该国家是否有异常 ASIN（正常情况不发送通知）
- 确认 ASIN 的 `feishu_notify_enabled` 是否为 1
- 查看控制台日志，确认通知发送状态

**Q3: 如何测试定时任务？**

可以使用手动触发 API：

```bash
curl -X POST http://localhost:3001/api/v1/monitor/trigger \
  -H "Content-Type: application/json" \
  -d '{"countries": ["US"]}'
```

**Q4: 如何修改定时任务的执行时间？**

在系统设置 → SP-API 配置 → 定时监控频率中调整 US/EU 的监控间隔。

**Q5: 如何查看监控历史？**

通过监控历史 API 查看：

```bash
GET /api/v1/monitor/history?country=US&current=1&pageSize=10
```

**注意事项**：

1. ⚠️ **时区问题**：定时任务使用服务器本地时间，请确保服务器时区正确
2. ⚠️ **SP-API 配置**：确保已正确配置 SP-API 凭证，否则检查会失败
3. ⚠️ **数据库连接**：确保数据库连接正常，否则无法记录监控历史
4. ✅ **性能优化**：大量 ASIN 时，检查可能需要较长时间，请耐心等待
5. ✅ **通知频率**：为避免通知过多，系统只发送异常通知，正常情况不发送

## 📊 数据库文档

### 数据库文件说明

`server/database/` 目录包含所有数据库相关文件：

```
database/
├── init.sql                    # 完整的数据库初始化脚本（包含所有最新字段和表）
├── competitor-init.sql         # 竞品监控数据库初始化脚本
├── migrations/                # 数据库迁移脚本目录
│   ├── 001_add_asin_type.sql
│   ├── 002_add_monitor_fields.sql
│   ├── 003_add_site_and_brand.sql
│   ├── 004_add_user_auth_tables.sql
│   ├── 005_remove_batch_tables.sql
│   ├── 006_add_audit_log_table.sql
│   ├── 008_add_monitor_history_index.sql
│   ├── 009_remove_user_email_and_reset_table.sql
│   ├── 010_add_sessions_table.sql
│   ├── 011_add_variant_group_fields.sql
│   ├── 012_add_composite_indexes.sql
│   └── ...
└── MIGRATION.md               # 迁移说明文档
```

### 使用场景

#### 场景 1: 全新安装（推荐）

直接执行 `init.sql`，该文件已包含所有最新变更：

```bash
mysql -u root -p < server/database/init.sql
```

**优势**：

- 一步完成所有表结构创建
- 包含所有最新字段和索引
- 无需执行迁移脚本
- 适合生产环境部署

#### 场景 2: 已有数据库升级

1. **备份数据库**（重要！）

   ```bash
   mysqldump -u root -p amazon_asin_monitor > backup_$(date +%Y%m%d_%H%M%S).sql
   ```

2. **按顺序执行迁移脚本**

   ```bash
   # 按版本号顺序执行，跳过已执行的版本
   mysql -u root -p amazon_asin_monitor < server/database/migrations/001_add_asin_type.sql
   mysql -u root -p amazon_asin_monitor < server/database/migrations/002_add_monitor_fields.sql
   # ... 依此类推
   ```

### 数据库表结构

#### 核心业务表

- `variant_groups`: 变体组表（包含监控字段和通知开关）
- `asins`: ASIN 表（包含类型、监控时间、通知开关等字段）
- `monitor_history`: 监控历史表（包含复合索引优化查询）

#### 配置表

- `feishu_config`: 飞书通知配置表
- `sp_api_config`: SP-API 配置表

#### 用户权限表

- `users`: 用户表
- `sessions`: 多设备会话表
- `roles`: 角色表
- `permissions`: 权限表
- `user_roles`: 用户角色关联表
- `role_permissions`: 角色权限关联表

#### 审计表

- `audit_logs`: 操作审计日志表

详细表结构请查看 `init.sql` 文件。

### 数据库迁移说明

#### 迁移脚本列表

| 版本 | 文件名 | 说明 | 状态 |
| --- | --- | --- | --- |
| 001 | `001_add_asin_type.sql` | 添加 ASIN 类型字段 | ✅ 已整合到 init.sql |
| 002 | `002_add_monitor_fields.sql` | 添加监控更新时间和飞书通知字段 | ✅ 已整合到 init.sql |
| 003 | `003_add_site_and_brand.sql` | 添加站点和品牌字段 | ✅ 已整合到 init.sql |
| 004 | `004_add_user_auth_tables.sql` | 添加用户认证和权限管理表 | ✅ 已整合到 init.sql |
| 005 | `005_remove_batch_tables.sql` | 删除批次管理相关表 | ⚠️ 仅用于升级 |
| 006 | `006_add_audit_log_table.sql` | 添加操作审计日志表 | ✅ 已整合到 init.sql |
| 008 | `008_add_monitor_history_index.sql` | 添加监控历史联合索引 | ✅ 已整合到 init.sql |
| 009 | `009_remove_user_email_and_reset_table.sql` | 移除用户表邮箱字段和密码重置表 | ⚠️ 仅用于升级 |
| 010 | `010_add_sessions_table.sql` | 添加多设备会话记录表 | ✅ 已整合到 init.sql |
| 011 | `011_add_variant_group_fields.sql` | 为变体组表添加监控字段 | ✅ 已整合到 init.sql |
| 012 | `012_add_composite_indexes.sql` | 添加复合索引优化查询性能 | ✅ 已整合到 init.sql |
| 013 | `013_add_password_security_tables.sql` | 添加密码安全相关表 | ✅ 已整合到 init.sql |
| 014 | `014_add_granular_permissions.sql` | 添加细粒度权限 | ✅ 已整合到 init.sql |
| 015 | `015_change_asin_unique_to_composite.sql` | 修改 ASIN 唯一约束为复合索引 | ✅ 已整合到 init.sql |
| 016 | `016_add_snapshot_fields_to_monitor_history.sql` | 为监控历史添加快照字段 | ✅ 已整合到 init.sql |
| 017 | `017_optimize_monitor_history_indexes.sql` | 优化监控历史索引 | ✅ 已整合到 init.sql |
| 018 | `018_add_analytics_query_index.sql` | 添加数据分析查询索引 | ✅ 已整合到 init.sql |
| 019 | `019_add_backup_config_table.sql` | 添加备份配置表 | ✅ 已整合到 init.sql |
| 020 | `020_add_status_change_indexes.sql` | 添加状态变更索引 | ✅ 已整合到 init.sql |
| 021 | `021_optimize_variant_group_indexes.sql` | 优化变体组索引 | ✅ 已整合到 init.sql |

> **注意**: 所有标记为 "✅ 已整合到 init.sql" 的迁移脚本，其功能已包含在 `init.sql` 中。新安装系统时直接使用 `init.sql` 即可，无需执行这些迁移脚本。

#### 主要迁移说明

**001: 添加 ASIN 类型字段**

- 删除 `main_link` 和 `sub_review` 字段（如果存在）
- 添加 `asin_type` 字段：`VARCHAR(20)`，可选值：`MAIN_LINK`（主链）、`SUB_REVIEW`（副评）

**002: 添加监控更新时间和飞书通知字段**

- 添加 `last_check_time` 字段：`DATETIME`，记录上一次检查的时间
- 添加 `feishu_notify_enabled` 字段：`TINYINT(1)`，默认值为 1（开启）

**003: 添加站点和品牌字段**

- 为 `variant_groups` 表添加 `site` 和 `brand` 字段（必填）
- 为 `asins` 表添加 `site` 和 `brand` 字段（必填）

**004: 添加用户认证和权限管理表**

- 创建用户、角色、权限相关表
- 插入默认角色：READONLY（只读用户）、EDITOR（编辑用户）、ADMIN（管理员）

**005: 删除批次管理相关表**

- 删除 `batch_variant_groups` 表
- 删除 `batches` 表
- ⚠️ 执行前请备份数据库

**006: 添加操作审计日志表**

- 创建 `audit_logs` 表
- 记录用户的所有操作，用于审计和追踪

**008: 添加监控历史联合索引**

- 添加索引 `idx_country_check_time` (`country`, `check_time`)

**009: 移除用户表邮箱字段和密码重置表**

- 删除 `users.email` 字段
- 删除 `password_reset_tokens` 表（如果存在）

**010: 添加多设备会话记录表**

- 创建 `sessions` 表
- 支持多设备同时登录和会话状态管理

**011: 为变体组表添加监控字段**

- 添加 `last_check_time` 字段
- 添加 `feishu_notify_enabled` 字段

**012: 添加复合索引优化查询性能**

- 为频繁查询的字段组合添加复合索引
- 提升查询性能

**013: 添加密码安全相关表**

- 创建密码安全策略相关表
- 支持密码重置和密码历史记录

**014: 添加细粒度权限**

- 扩展权限系统，支持更细粒度的权限控制
- 优化权限查询性能

**015: 修改 ASIN 唯一约束为复合索引**

- 将 ASIN 的唯一约束改为复合索引（country + asin）
- 支持同一 ASIN 在不同国家存在

**016: 为监控历史添加快照字段**

- 添加快照相关字段，支持数据快照功能
- 便于历史数据分析和对比

**017: 优化监控历史索引**

- 优化监控历史表的索引结构
- 提升查询性能

**018: 添加数据分析查询索引**

- 为数据分析相关查询添加专用索引
- 优化数据分析页面加载速度

**019: 添加备份配置表**

- 创建备份配置表
- 支持备份策略配置

**020: 添加状态变更索引**

- 为状态变更相关查询添加索引
- 优化状态查询性能

**021: 优化变体组索引**

- 优化变体组表的索引结构
- 提升变体组查询性能

### 注意事项

1. ⚠️ **执行前务必备份数据库**
2. ⚠️ **迁移脚本必须按版本号顺序执行**
3. ⚠️ **建议先在测试环境验证**
4. ✅ **新安装直接使用 `init.sql`，无需执行迁移脚本**
5. ✅ `init.sql` 已包含所有最新字段、表和索引，适合生产环境部署

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
- WebSocket 代理：`/ws` -> `http://127.0.0.1:3001/ws`（用于实时监控进度推送）
- SPA 路由支持：`try_files $uri $uri/ /index.html;`
- 建议开启 `gzip` 并配置 `client_max_body_size`，与后端上传限制保持一致（参考 `nginx.conf.example`）

**重要**：WebSocket 配置需要设置较长的超时时间（建议 7 天），以保持长连接。完整配置示例见 `nginx.conf.example`。

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
- `POST /api/v1/asins/:asinId/move` - 移动 ASIN 到其他变体组
- `PUT /api/v1/asins/:asinId/feishu-notify` - 更新 ASIN 的飞书通知开关
- `PUT /api/v1/variant-groups/:groupId/feishu-notify` - 更新变体组的飞书通知开关

### 监控接口

- `POST /api/v1/monitor/check` - 手动触发监控
- `POST /api/v1/monitor/check-variant-group` - 检查变体组
- `GET /api/v1/monitor/history` - 查询监控历史

### 变体检查接口

- `POST /api/v1/variant-groups/:groupId/check` - 检查变体组
- `POST /api/v1/asins/:asinId/check` - 检查单个 ASIN
- `POST /api/v1/variant-groups/batch-check` - 批量检查变体组
- `POST /api/v1/variant-check/batch-query-parent-asin` - 批量查询 ASIN 的父变体信息

### 竞品监控接口

- `GET /api/v1/competitor-asins` - 查询竞品 ASIN 列表
- `POST /api/v1/competitor-monitor/check` - 触发竞品监控

### 用户管理接口

- `GET /api/v1/users` - 查询用户列表
- `POST /api/v1/users` - 创建用户
- `PUT /api/v1/users/:userId` - 更新用户
- `DELETE /api/v1/users/:userId` - 删除用户

### 飞书配置接口

- `GET /api/v1/feishu-configs` - 获取所有飞书配置
- `GET /api/v1/feishu-configs/:country` - 根据国家获取飞书配置
- `POST /api/v1/feishu-configs` - 创建/更新飞书配置
- `PUT /api/v1/feishu-configs/:country` - 更新飞书配置
- `DELETE /api/v1/feishu-configs/:country` - 删除飞书配置
- `PATCH /api/v1/feishu-configs/:country/toggle` - 启用/禁用飞书配置

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
- 参考本文档"监控任务配置"章节了解定时任务配置

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

本文档已整合了以下内容：

- ✅ **SP-API 配置指南** - 已整合到"配置说明 > SP-API 配置"章节
- ✅ **定时任务和飞书通知指南** - 已整合到"配置说明 > 监控任务配置"章节
- ✅ **SP-API 配额管理** - 已整合到"配置说明 > SP-API 配额管理"章节
- ✅ **数据库文档** - 已整合到"数据库文档"章节
- ✅ **数据库迁移说明** - 已整合到"数据库文档 > 数据库迁移说明"章节

如需查看详细的子目录文档，可参考：

- `server/database/MIGRATION.md` - 详细的数据库迁移说明（可选参考）
- `server/scripts/QUOTA-GUIDE.md` - 详细的配额管理指南（可选参考）

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

个人私货：Cabal，你的代码是手搓还是 AI 呢？😨😨😨😨 我的天哪 😫😫😫😫 是 AI 啊 😩😩😩😩 全都是 AI 啊 😭😭😭😭 没有一点手工 😵😵😵😵
