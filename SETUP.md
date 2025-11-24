# Amazon ASIN Monitor 项目设置指南

本文档将指导你完成项目的完整设置。

## 📋 前置要求

- Node.js >= 14.0.0
- MySQL >= 5.7
- npm 或 yarn

## 🚀 设置步骤

### 第一步：初始化数据库

1. 登录 MySQL：

```bash
mysql -u root -p
```

2. 执行初始化 SQL 脚本：

```bash
mysql -u root -p < server/database/init.sql
```

或者使用 MySQL 客户端工具（如 Navicat、DBeaver 等）执行 `server/database/init.sql` 文件。

这将创建：

- 数据库 `amazon_asin_monitor`
- 所有必要的表结构

### 第二步：配置后端服务

1. 进入后端目录：

```bash
cd server
```

2. 安装依赖：

```bash
npm install
```

3. 配置环境变量：

```bash
# 复制环境变量模板
cp .env.example .env
```

4. 编辑 `.env` 文件，填入你的数据库信息：

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password  # 修改为你的MySQL密码
DB_NAME=amazon_asin_monitor

PORT=3001
NODE_ENV=development
CORS_ORIGIN=http://localhost:8000
```

5. 启动后端服务：

```bash
# 开发模式（自动重启）
npm run dev

# 或生产模式
npm start
```

后端服务将运行在 `http://localhost:3001`

### 第三步：配置前端服务

1. 返回项目根目录：

```bash
cd ..
```

2. 安装前端依赖（如果还没安装）：

```bash
npm install
```

3. 启动前端开发服务器：

```bash
npm run dev
```

前端服务将运行在 `http://localhost:8000`

### 第四步：验证设置

1. 检查后端服务：

   - 访问 `http://localhost:3001/health`
   - 应该返回 `{"status":"ok","message":"Server is running"}`

2. 检查前端服务：

   - 访问 `http://localhost:8000`
   - 应该能看到应用界面

3. 测试 API 连接：
   - 在前端访问 ASIN 管理页面 (`/asin`)
   - 如果数据库为空，表格应该显示为空
   - 如果后端连接失败，会显示错误信息

## ⚠️ 重要提示

**Mock 数据已禁用**：系统已配置为使用真实的后端 API 和 MySQL 数据库，不再使用 mock 数据。

如果前端仍显示测试数据，请：

1. 确认 `.umirc.ts` 中已设置 `mock: false`
2. 重启前端开发服务器（`npm run dev`）
3. 清除浏览器缓存

## 🔧 故障排查

### 数据库连接失败

**错误信息**：`❌ 数据库连接失败`

**解决方案**：

1. 检查 MySQL 服务是否运行
2. 检查 `.env` 文件中的数据库配置是否正确
3. 确认数据库 `amazon_asin_monitor` 已创建
4. 检查 MySQL 用户权限

### 前端无法连接后端

**错误信息**：`网络错误` 或 `CORS错误`

**解决方案**：

1. 确认后端服务正在运行（`http://localhost:3001`）
2. 检查 `.umirc.ts` 中的 proxy 配置
3. 检查后端 `server/src/index.js` 中的 CORS 配置
4. 确认 `server/.env` 中的 `CORS_ORIGIN` 配置正确

### 端口冲突

如果端口被占用，可以修改：

- 后端端口：修改 `server/.env` 中的 `PORT`
- 前端端口：Umi 默认使用 8000，可在启动时指定 `PORT=8001 npm run dev`

## 📁 项目结构

```
Amazon-ASIN-monitor/
├── server/                 # 后端服务
│   ├── src/
│   │   ├── config/         # 配置文件
│   │   ├── models/         # 数据模型
│   │   ├── controllers/    # 控制器
│   │   ├── routes/         # 路由
│   │   └── index.js        # 入口文件
│   ├── database/
│   │   └── init.sql        # 数据库初始化脚本
│   └── package.json
├── src/                    # 前端代码
│   ├── pages/              # 页面
│   ├── services/           # API服务
│   └── components/         # 组件
├── .umirc.ts              # Umi配置
└── package.json           # 前端依赖
```

## 🎯 下一步

设置完成后，你可以：

1. 在前端 ASIN 管理页面添加变体组和 ASIN
2. 测试 CRUD 功能
3. 继续实现其他功能（定时任务、飞书通知等）

## 💡 提示

- 开发时，后端和前端需要同时运行
- 建议使用两个终端窗口分别运行前后端
- 数据库操作建议使用事务，确保数据一致性
- 生产环境部署时，记得修改环境变量和 CORS 配置
