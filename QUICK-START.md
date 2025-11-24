# 快速开始指南

## 🚀 连接本地 MySQL 数据库

### 第一步：配置数据库连接

1. **编辑 `server/.env` 文件**（已自动创建），填入你的 MySQL 密码：

```env
DB_PASSWORD=你的MySQL密码  # ⚠️ 修改这里
```

其他配置通常不需要修改，除非你的 MySQL 配置不同。

### 第二步：初始化数据库

**方法 1：使用命令行**（推荐）

```bash
# Windows PowerShell
mysql -u root -p < server\database\init.sql

# 或 Linux/Mac
mysql -u root -p < server/database/init.sql
```

**方法 2：使用 MySQL 客户端工具**

1. 打开 Navicat、DBeaver、MySQL Workbench 等工具
2. 连接到你的 MySQL 服务器
3. 打开并执行 `server/database/init.sql` 文件

### 第三步：测试数据库连接

在 `server` 目录下运行测试脚本：

```bash
cd server
node test-db-connection.js
```

如果看到 `✅ 数据库连接成功`，说明配置正确！

### 第四步：启动服务

**终端 1 - 启动后端服务**：

```bash
cd server
npm run dev
```

看到 `✅ 数据库连接成功` 和 `🚀 服务器运行在 http://localhost:3001` 说明启动成功。

**终端 2 - 启动前端服务**：

```bash
npm run dev
```

### 第五步：验证

1. 访问 `http://localhost:3001/health` - 应返回 `{"status":"ok"}`
2. 访问 `http://localhost:8000/asin` - 应显示 ASIN 管理页面
3. 如果数据库为空，表格会显示为空，可以开始添加数据

## ⚠️ 常见问题

### 问题：数据库连接失败

**检查清单**：

- [ ] MySQL 服务是否运行？（Windows 服务管理器）
- [ ] `server/.env` 中的 `DB_PASSWORD` 是否正确？
- [ ] 数据库 `amazon_asin_monitor` 是否已创建？
- [ ] 是否执行了 `init.sql` 创建表结构？

**快速测试**：

```bash
cd server
node test-db-connection.js
```

### 问题：找不到 MySQL 命令

如果 `mysql` 命令不可用，可以：

1. 使用 MySQL 客户端工具（Navicat、DBeaver 等）执行 SQL 文件
2. 或将 MySQL 的 bin 目录添加到系统 PATH

### 问题：前端仍显示测试数据

1. 确认 `.umirc.ts` 中 `mock: false` 已设置
2. 重启前端服务
3. 清除浏览器缓存（Ctrl+Shift+Delete）

## 📝 下一步

配置完成后，你可以：

- ✅ 在 ASIN 管理页面添加变体组和 ASIN
- ✅ 测试所有 CRUD 功能
- ✅ 查看数据是否正确保存到数据库
