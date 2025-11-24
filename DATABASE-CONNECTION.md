# 数据库连接配置指南

本文档说明如何配置系统连接到本地 MySQL 服务器。

## 📋 前置检查

1. **确认 MySQL 服务已启动**

   - Windows: 检查服务管理器中的 MySQL 服务
   - 或使用命令：`mysql --version`

2. **确认数据库已创建**
   - 执行 `server/database/init.sql` 创建数据库和表结构

## 🔧 配置步骤

### 第一步：配置后端数据库连接

1. **进入后端目录**：

```bash
cd server
```

2. **创建环境变量文件**（如果还没有）：

```bash
# Windows PowerShell
Copy-Item .env.example .env

# 或 Linux/Mac
cp .env.example .env
```

3. **编辑 `.env` 文件**，修改数据库配置：

```env
# 数据库配置
DB_HOST=localhost          # MySQL服务器地址
DB_PORT=3306              # MySQL端口（默认3306）
DB_USER=root              # MySQL用户名
DB_PASSWORD=你的MySQL密码   # ⚠️ 修改为你的实际密码
DB_NAME=amazon_asin_monitor # 数据库名称

# 服务器配置
PORT=3001
NODE_ENV=development

# CORS配置
CORS_ORIGIN=http://localhost:8000
```

### 第二步：测试数据库连接

1. **启动后端服务**：

```bash
cd server
npm run dev
```

2. **查看启动日志**：
   - 如果看到 `✅ 数据库连接成功`，说明连接正常
   - 如果看到 `❌ 数据库连接失败`，请检查：
     - MySQL 服务是否运行
     - `.env` 文件中的密码是否正确
     - 数据库 `amazon_asin_monitor` 是否已创建

### 第三步：验证数据连接

1. **检查后端 API**：

   - 访问 `http://localhost:3001/health`
   - 应该返回：`{"status":"ok","message":"Server is running"}`

2. **测试数据库查询**：
   - 访问 `http://localhost:3001/api/v1/variant-groups`
   - 如果数据库为空，应该返回空列表：`{"success":true,"data":{"list":[],"total":0}}`
   - 如果有数据，会返回变体组列表

## 🔍 常见问题

### 问题 1：数据库连接失败

**错误信息**：`❌ 数据库连接失败: Access denied for user 'root'@'localhost'`

**解决方案**：

1. 检查 `.env` 文件中的 `DB_PASSWORD` 是否正确
2. 确认 MySQL 用户权限
3. 尝试使用其他 MySQL 用户

### 问题 2：数据库不存在

**错误信息**：`Unknown database 'amazon_asin_monitor'`

**解决方案**：

1. 执行初始化 SQL 脚本：

```bash
mysql -u root -p < server/database/init.sql
```

2. 或手动创建数据库：

```sql
CREATE DATABASE amazon_asin_monitor;
USE amazon_asin_monitor;
-- 然后执行 server/database/init.sql 中的表创建语句
```

### 问题 3：端口被占用

**错误信息**：`Port 3001 is already in use`

**解决方案**：

1. 修改 `server/.env` 中的 `PORT=3002`（或其他端口）
2. 或关闭占用端口的程序

### 问题 4：前端仍显示 mock 数据

**解决方案**：

1. 确认 `.umirc.ts` 中已设置 `mock: false`
2. 重启前端开发服务器
3. 清除浏览器缓存

## 📝 数据库表结构

系统使用以下表：

- `variant_groups` - 变体组表
- `asins` - ASIN 表
- `monitor_history` - 监控历史表
- `batches` - 批次表
- `batch_variant_groups` - 批次关联表
- `feishu_config` - 飞书配置表

## ✅ 验证清单

完成配置后，请确认：

- [ ] MySQL 服务正在运行
- [ ] 数据库 `amazon_asin_monitor` 已创建
- [ ] 所有表结构已创建（执行了 init.sql）
- [ ] `server/.env` 文件已配置正确的数据库信息
- [ ] 后端服务启动成功，显示 `✅ 数据库连接成功`
- [ ] 前端可以正常访问后端 API
- [ ] ASIN 管理页面可以正常加载（即使数据为空）

## 🎯 下一步

配置完成后，你可以：

1. 在前端 ASIN 管理页面添加变体组和 ASIN
2. 测试 CRUD 功能
3. 查看数据是否正确保存到数据库
