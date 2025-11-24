# 故障排查指南 - 创建变体组失败

## 🔍 问题诊断

如果点击"新建变体组"后显示"创建失败"，请按以下步骤排查：

### 第一步：检查后端服务

1. **确认后端服务正在运行**：

   ```bash
   # 检查端口3001是否被占用
   netstat -ano | findstr :3001
   ```

2. **查看后端日志**：
   - 在运行 `npm run dev` 的终端中查看错误信息
   - 如果看到 `创建变体组错误:` 开头的日志，说明后端收到了请求但处理失败

### 第二步：检查数据库连接

1. **测试数据库连接**：

   ```bash
   cd server
   npm run test-db
   ```

2. **检查数据库表是否存在**：
   ```sql
   USE amazon_asin_monitor;
   SHOW TABLES;
   ```
   应该看到 `variant_groups` 表

### 第三步：检查浏览器控制台

1. **打开浏览器开发者工具**（F12）
2. **查看 Console 标签**：
   - 查找红色错误信息
   - 查看是否有网络请求失败
3. **查看 Network 标签**：
   - 找到 `POST /api/v1/variant-groups` 请求
   - 查看请求状态码和响应内容

### 第四步：常见错误及解决方案

#### 错误 1：网络连接失败

**现象**：浏览器控制台显示 `ERR_CONNECTION_REFUSED` 或 `Failed to fetch`

**解决方案**：

1. 确认后端服务正在运行（`npm run dev`）
2. 检查 `server/.env` 中的 `PORT` 配置
3. 确认前端代理配置正确（`.umirc.ts`）

#### 错误 2：数据库错误

**现象**：后端日志显示数据库相关错误

**解决方案**：

1. 检查 `server/.env` 中的数据库配置
2. 确认数据库 `amazon_asin_monitor` 已创建
3. 确认表结构已初始化（执行了 `init.sql`）

#### 错误 3：请求格式错误

**现象**：后端返回 400 错误

**解决方案**：

1. 检查表单是否填写完整（名称和国家）
2. 查看后端日志中的具体错误信息

#### 错误 4：CORS 错误

**现象**：浏览器控制台显示 CORS 相关错误

**解决方案**：

1. 检查 `server/.env` 中的 `CORS_ORIGIN` 配置
2. 确认前端地址与配置一致（默认 `http://localhost:8000`）

## 🛠️ 快速修复步骤

1. **重启后端服务**：

   ```bash
   cd server
   npm run dev
   ```

2. **重启前端服务**：

   ```bash
   npm run dev
   ```

3. **清除浏览器缓存**：

   - 按 `Ctrl + Shift + Delete`
   - 清除缓存和 Cookie

4. **检查浏览器控制台**：
   - 查看具体错误信息
   - 根据错误信息定位问题

## 📝 调试技巧

### 查看后端日志

后端服务启动后，所有请求和错误都会在终端中显示：

- `创建变体组错误:` - 表示创建失败
- `数据库查询错误:` - 表示数据库操作失败

### 查看网络请求

在浏览器开发者工具的 Network 标签中：

1. 找到 `variant-groups` 请求
2. 查看 Request Payload（请求数据）
3. 查看 Response（响应数据）
4. 查看 Status Code（状态码）

### 测试 API

使用 PowerShell 测试 API：

```powershell
$body = @{
    name = "测试变体组"
    country = "US"
} | ConvertTo-Json

Invoke-WebRequest -Uri "http://localhost:3001/api/v1/variant-groups" `
    -Method POST `
    -Headers @{"Content-Type"="application/json"} `
    -Body $body
```

## 💡 如果问题仍然存在

请提供以下信息：

1. 浏览器控制台的完整错误信息
2. 后端服务的日志输出
3. Network 标签中的请求详情（Request 和 Response）

这样我可以更准确地帮你定位问题。
