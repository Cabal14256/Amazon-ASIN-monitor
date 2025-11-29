# 1Panel 部署 Amazon ASIN Monitor 项目详细指南

本文档提供在已安装 1Panel 的阿里云服务器上部署该项目的完整步骤。

## 项目架构

- **前端**：UmiJS (React) 应用，需构建为静态文件
- **后端**：Node.js/Express API 服务，运行在 3001 端口
- **数据库**：MySQL，数据库名 `amazon_asin_monitor`
- **缓存/队列**：Redis，用于 Bull 任务队列

## 前置要求

- 已安装 1Panel 面板
- 服务器有公网 IP
- 已通过 SSH 访问服务器

## 部署步骤

### 第一步：在 1Panel 中安装依赖服务

#### 1.1 安装 MySQL

1. 进入 1Panel → **应用商店** → 搜索"MySQL"
2. 安装 MySQL（建议版本 8.0+）
3. 记录 MySQL root 密码（安装完成后会显示）

#### 1.2 安装 Redis

1. 进入 1Panel → **应用商店** → 搜索"Redis"
2. 安装 Redis
3. 默认端口 6379，无需密码（或按需配置）

#### 1.3 安装 Node.js 运行环境

1. 进入 1Panel → **运行环境** → **Node.js**
2. 安装 Node.js（建议版本 18+）
3. 验证安装：在终端执行 `node -v`

### 第二步：上传项目代码到服务器

#### 2.1 通过 SSH 连接到服务器

```bash
ssh root@你的公网IP
```

#### 2.2 创建项目目录

```bash
mkdir -p /opt/amazon-asin-monitor
cd /opt/amazon-asin-monitor
```

#### 2.3 上传项目文件

**方式 1：使用 git 克隆（推荐）**

```bash
git clone <你的仓库地址> /opt/amazon-asin-monitor
cd /opt/amazon-asin-monitor
```

**方式 2：使用 1Panel 的文件管理功能**

1. 进入 1Panel → **系统** → **文件**
2. 导航到 `/opt` 目录
3. 上传项目压缩包
4. 解压到 `amazon-asin-monitor` 目录

**方式 3：使用 scp 命令从本地上传**

```bash
# 在本地执行
scp -r ./Amazon-ASIN-monitor root@你的公网IP:/opt/amazon-asin-monitor
```

### 第三步：初始化 MySQL 数据库

#### 3.1 在 1Panel 中创建数据库

1. 进入 1Panel → **数据库** → **MySQL**
2. 点击"**创建数据库**"
3. 填写信息：
   - **数据库名**：`amazon_asin_monitor`
   - **字符集**：`utf8mb4`
   - **排序规则**：`utf8mb4_unicode_ci`
4. 记录数据库用户名和密码

#### 3.2 执行初始化 SQL 脚本

**方式 1：使用 1Panel 的数据库管理工具（推荐）**

1. 进入 1Panel → **数据库** → 选择 `amazon_asin_monitor` 数据库
2. 点击"**SQL 执行**"
3. 打开 `server/database/init.sql` 文件
4. 复制全部内容到 SQL 执行窗口
5. 点击"**执行**"

**方式 2：使用命令行**

```bash
cd /opt/amazon-asin-monitor
mysql -u root -p < server/database/init.sql
# 输入MySQL root密码
```

### 第四步：配置后端服务

#### 4.1 安装后端依赖

```bash
cd /opt/amazon-asin-monitor/server
npm install --production
```

#### 4.2 创建环境变量文件

```bash
cd /opt/amazon-asin-monitor/server
cp env.template .env
nano .env
```

**注意**：如果项目中没有 `env.template` 文件，可以手动创建 `.env` 文件。

#### 4.3 配置.env 文件内容

修改以下配置（替换为实际值）：

```env
# 数据库配置（使用1Panel创建的数据库信息）
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=amazon_asin_monitor  # 或使用root
DB_PASSWORD=你的数据库密码
DB_NAME=amazon_asin_monitor

# 服务器配置
PORT=3001
NODE_ENV=production

# CORS配置（使用公网IP）
CORS_ORIGIN=http://你的公网IP

# Redis配置
REDIS_URL=redis://127.0.0.1:6379
REDIS_URI=redis://127.0.0.1:6379

# JWT密钥（生产环境请修改为强密码）
JWT_SECRET=your_jwt_secret_key_change_this_in_production
```

**重要提示**：

- 将 `你的公网IP` 替换为实际的公网 IP 地址
- 将 `你的数据库密码` 替换为 1Panel 中创建的数据库密码
- `JWT_SECRET` 应该是一个随机生成的强密码

#### 4.4 测试后端服务

```bash
cd /opt/amazon-asin-monitor/server
node test-db-connection.js
```

如果看到 `✅ 数据库连接成功`，说明配置正确。

然后测试启动：

```bash
npm start
```

如果看到 `✅ 数据库连接成功` 和 `🚀 服务器运行在 http://localhost:3001`，按 `Ctrl+C` 停止服务。

### 第五步：使用 PM2 运行后端服务

#### 5.1 在 1Panel 中配置进程守护

1. 进入 1Panel → **系统** → **进程守护**
2. 点击"**创建守护进程**"

#### 5.2 配置 PM2 进程

填写以下信息：

- **名称**：`amazon-asin-monitor-api`
- **运行目录**：`/opt/amazon-asin-monitor/server`
- **启动命令**：`node src/index.js`
- **运行用户**：`root`（或创建专用用户）
- **自动启动**：开启
- **环境变量**：
  - 方式 1：选择"从文件加载"，路径：`/opt/amazon-asin-monitor/server/.env`
  - 方式 2：手动添加环境变量（从.env 文件复制）

#### 5.3 启动并验证

1. 点击"**启动**"
2. 等待几秒钟，检查状态是否为"运行中"
3. 点击"**查看日志**"，确认看到：

   - `✅ 数据库连接成功`
   - `🚀 服务器运行在 http://localhost:3001`

4. 测试 API：

```bash
curl http://localhost:3001/health
```

应该返回：`{"status":"ok","message":"Server is running"}`

### 第六步：构建前端应用

#### 6.1 安装前端依赖

```bash
cd /opt/amazon-asin-monitor
npm install
```

#### 6.2 修改前端配置以适配生产环境

编辑 `.umirc.ts` 文件：

```bash
nano /opt/amazon-asin-monitor/.umirc.ts
```

确认 `request.baseURL` 配置为：

```typescript
request: {
  baseURL:
    process.env.NODE_ENV === 'production'
      ? process.env.API_BASE_URL || '/api'  // 使用Nginx反向代理时用'/api'
      : '/api',
}
```

**说明**：

- 如果使用 Nginx 反向代理（推荐），保持 `/api` 即可
- 如果直接访问后端，需要设置环境变量 `API_BASE_URL=http://你的公网IP:3001`

#### 6.3 构建前端

```bash
cd /opt/amazon-asin-monitor
npm run build
```

构建完成后，产物在 `dist` 目录。

### 第七步：配置 Nginx 网站托管前端

#### 7.1 在 1Panel 中创建网站

1. 进入 1Panel → **网站** → **创建网站**
2. 填写信息：
   - **网站类型**：静态网站
   - **网站域名**：填写公网 IP（如：`123.456.789.0`）
   - **网站目录**：`/opt/amazon-asin-monitor/dist`
   - **运行目录**：`/opt/amazon-asin-monitor/dist`
3. 点击"**确认**"

#### 7.2 配置反向代理到后端 API

1. 进入网站列表，找到刚创建的网站
2. 点击"**设置**" → **反向代理**
3. 点击"**创建反向代理**"
4. 配置：
   - **代理名称**：`api`
   - **代理路径**：`/api`
   - **目标地址**：`http://127.0.0.1:3001/api/v1`
   - **重写路径**：开启，将 `/api` 重写为 `/api/v1`
5. 点击"**确认**"

#### 7.3 （可选）手动配置 Nginx

如果需要更精细的控制，可以在网站设置 → **其他设置** → **配置文件** 中，参考 `nginx.conf.example` 文件进行配置。

### 第八步：配置防火墙和安全组

#### 8.1 在 1Panel 中配置防火墙

1. 进入 1Panel → **系统** → **防火墙**
2. 开放端口：
   - **80 端口**：HTTP 访问前端
   - **443 端口**：HTTPS（如果配置 SSL）
   - **3001 端口**：后端 API（如果直接访问，建议仅内网访问）

#### 8.2 在阿里云控制台配置安全组

1. 登录阿里云控制台 → **ECS** → **安全组**
2. 找到你的 ECS 实例对应的安全组
3. 点击"**配置规则**" → **入方向** → **添加安全组规则**
4. 添加规则：
   - **端口范围**：`80/80`
   - **协议类型**：TCP
   - **授权对象**：`0.0.0.0/0`
   - **描述**：HTTP 访问
5. （可选）添加 HTTPS 规则：
   - **端口范围**：`443/443`
   - **协议类型**：TCP
   - **授权对象**：`0.0.0.0/0`
   - **描述**：HTTPS 访问

**注意**：不建议开放 3001 端口到公网，后端 API 应通过 Nginx 反向代理访问。

### 第九步：验证部署

#### 9.1 测试后端 API

```bash
curl http://你的公网IP:3001/health
```

或者通过 Nginx 代理：

```bash
curl http://你的公网IP/api/health
```

应该返回：`{"status":"ok","message":"Server is running"}`

#### 9.2 测试前端访问

1. 在浏览器访问：`http://你的公网IP`
2. 应该能看到登录页面

#### 9.3 测试完整功能

1. 登录系统（默认管理员账户需要先初始化，见下方）
2. 测试 ASIN 管理功能
3. 检查数据库连接

#### 9.4 初始化管理员账户

如果数据库中没有管理员账户，需要初始化：

```bash
cd /opt/amazon-asin-monitor/server
node init-admin-user.js
```

按照提示输入管理员用户名和密码。

## 常见问题排查

### 问题 1：后端无法启动

**检查步骤**：

1. 检查 PM2 日志：

   - 1Panel → 进程守护 → 查看日志

2. 验证数据库连接：

   ```bash
   cd /opt/amazon-asin-monitor/server
   node test-db-connection.js
   ```

3. 检查端口是否被占用：

   ```bash
   netstat -tlnp | grep 3001
   ```

4. 检查.env 文件配置是否正确

### 问题 2：前端无法访问

**检查步骤**：

1. 检查 Nginx 配置：

   - 1Panel → 网站 → 设置 → 配置文件

2. 检查网站目录权限：

   ```bash
   ls -la /opt/amazon-asin-monitor/dist
   chmod -R 755 /opt/amazon-asin-monitor/dist
   ```

3. 查看 Nginx 错误日志：

   - 1Panel → 网站 → 日志

4. 确认前端已构建：
   ```bash
   ls -la /opt/amazon-asin-monitor/dist
   ```

### 问题 3：API 请求失败（CORS 错误）

**解决方案**：

1. 检查后端.env 文件中的 `CORS_ORIGIN` 配置
2. 确保 CORS_ORIGIN 包含前端访问地址（公网 IP）
3. 如果使用 Nginx 反向代理，确保代理配置正确

### 问题 4：数据库连接失败

**检查步骤**：

1. 确认 MySQL 服务运行中：

   - 1Panel → 应用商店 → MySQL → 查看状态

2. 检查数据库是否存在：

   ```bash
   mysql -u root -p -e "SHOW DATABASES LIKE 'amazon_asin_monitor';"
   ```

3. 验证数据库用户权限：
   ```bash
   mysql -u root -p -e "SELECT User, Host FROM mysql.user WHERE User='amazon_asin_monitor';"
   ```

## 生产环境优化建议

### 1. 安全性

- **配置 HTTPS**：使用 1Panel 的证书功能申请 SSL 证书
- **修改默认密码**：确保数据库、JWT 密钥等使用强密码
- **限制后端端口**：3001 端口仅允许内网访问
- **定期更新**：保持系统和依赖包更新

### 2. 性能优化

- **启用 Gzip 压缩**：在 Nginx 配置中启用
- **静态资源 CDN**：将前端静态资源放到 CDN
- **数据库优化**：定期优化数据库表
- **Redis 缓存**：充分利用 Redis 缓存

### 3. 监控和日志

- **日志管理**：
  - PM2 日志：1Panel → 进程守护 → 查看日志
  - Nginx 日志：1Panel → 网站 → 日志
- **监控**：配置服务器监控，关注 CPU、内存、磁盘使用率

### 4. 备份

- **数据库备份**：使用 1Panel 的备份功能定期备份数据库
- **代码备份**：定期备份项目代码和配置文件
- **自动备份**：配置 1Panel 的自动备份计划

## 更新部署

当需要更新代码时：

1. **更新代码**：

   ```bash
   cd /opt/amazon-asin-monitor
   git pull  # 或重新上传代码
   ```

2. **更新后端依赖**（如有变化）：

   ```bash
   cd /opt/amazon-asin-monitor/server
   npm install --production
   ```

3. **重启后端服务**：

   - 1Panel → 进程守护 → 重启 `amazon-asin-monitor-api`

4. **更新前端**（如有变化）：

   ```bash
   cd /opt/amazon-asin-monitor
   npm install
   npm run build
   ```

5. **重启 Nginx**（通常不需要）：
   - 1Panel → 网站 → 重启

## 联系支持

如遇到问题，请检查：

- 1Panel 官方文档：https://1panel.cn/docs/v2/
- 项目 README 和 TROUBLESHOOTING.md 文件
