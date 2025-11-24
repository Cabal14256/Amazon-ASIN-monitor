# 定时任务和飞书通知功能使用指南

## 功能概述

系统已实现以下两个核心功能：

### 1. 定时任务自动监控

- **美国区域** (US): 每小时整点和 30 分执行（如 10:00、10:30、11:00、11:30...）
- **欧洲区域** (UK, DE, FR, IT, ES): 每小时整点执行（如 10:00、11:00、12:00...）

### 2. 飞书通知推送

- 按国家/区域推送监控结果
- 只发送异常情况的通知（有异常 ASIN 时）
- 支持配置每个国家的 Webhook URL

## 快速开始

### 第一步：启动后端服务

```bash
cd server
npm install  # 如果还没安装依赖
npm start    # 启动服务
```

服务启动后，定时任务会自动初始化并开始运行。

### 第二步：配置飞书 Webhook

#### 方式 1：通过 API 配置（推荐）

```bash
# 配置美国区域的飞书Webhook
curl -X POST http://localhost:3001/api/v1/feishu-configs \
  -H "Content-Type: application/json" \
  -d '{
    "country": "US",
    "webhookUrl": "https://open.feishu.cn/open-apis/bot/v2/hook/xxxxx",
    "enabled": true
  }'

# 配置英国区域的飞书Webhook
curl -X POST http://localhost:3001/api/v1/feishu-configs \
  -H "Content-Type: application/json" \
  -d '{
    "country": "UK",
    "webhookUrl": "https://open.feishu.cn/open-apis/bot/v2/hook/xxxxx",
    "enabled": true
  }'
```

#### 方式 2：直接插入数据库

```sql
USE amazon_asin_monitor;

-- 配置美国
INSERT INTO feishu_config (country, webhook_url, enabled)
VALUES ('US', 'https://open.feishu.cn/open-apis/bot/v2/hook/xxxxx', 1)
ON DUPLICATE KEY UPDATE webhook_url = VALUES(webhook_url), enabled = VALUES(enabled);

-- 配置英国
INSERT INTO feishu_config (country, webhook_url, enabled)
VALUES ('UK', 'https://open.feishu.cn/open-apis/bot/v2/hook/xxxxx', 1)
ON DUPLICATE KEY UPDATE webhook_url = VALUES(webhook_url), enabled = VALUES(enabled);
```

### 第三步：获取飞书 Webhook URL

1. 打开飞书，进入需要接收通知的群聊
2. 点击群设置 → 群机器人 → 添加机器人 → 自定义机器人
3. 设置机器人名称和描述
4. 复制生成的 Webhook URL
5. 使用上面的方式配置到系统中

## 功能说明

### 定时任务执行流程

1. **每分钟检查时间**：系统每分钟检查当前时间
2. **判断执行条件**：
   - 如果是整点（分钟=0）：执行美国区域和欧洲区域的检查
   - 如果是 30 分（分钟=30）：只执行美国区域的检查
3. **执行监控检查**：
   - 查询对应国家的所有变体组
   - 对每个变体组调用 SP-API 检查变体状态
   - 更新 ASIN 的监控时间（`last_check_time`）
   - 记录监控历史（`monitor_history`表）
4. **发送飞书通知**：
   - 按国家分组检查结果
   - 只发送有异常 ASIN 的通知
   - 跳过无异常的国家（不发送通知）

### 飞书通知内容

通知卡片包含以下信息：

- **国家/区域**：检查的国家代码和名称
- **检查时间**：执行检查的时间
- **检查状态**：✅ 全部正常 或 ⚠️ 发现异常
- **检查总数**：本次检查的 ASIN 总数
- **正常数量**：状态正常的 ASIN 数量
- **异常数量**：状态异常的 ASIN 数量
- **异常 ASIN 列表**：列出所有异常的 ASIN（最多显示 10 个）

### ASIN 通知开关

每个 ASIN 都有一个 `feishu_notify_enabled` 字段，用于控制是否接收飞书通知：

- `1`：开启通知（默认）
- `0`：关闭通知

**注意**：即使关闭了通知，监控检查仍会正常执行，只是不会发送飞书通知。

## API 接口

### 飞书配置管理

#### 1. 获取所有配置

```bash
GET /api/v1/feishu-configs
```

#### 2. 根据国家获取配置

```bash
GET /api/v1/feishu-configs/:country
```

#### 3. 创建/更新配置

```bash
POST /api/v1/feishu-configs
PUT /api/v1/feishu-configs/:country

Body:
{
  "country": "US",
  "webhookUrl": "https://open.feishu.cn/open-apis/bot/v2/hook/xxxxx",
  "enabled": true
}
```

#### 4. 删除配置

```bash
DELETE /api/v1/feishu-configs/:country
```

#### 5. 启用/禁用配置

```bash
PATCH /api/v1/feishu-configs/:country/toggle

Body:
{
  "enabled": true
}
```

### 手动触发监控任务（用于测试）

可以通过 API 手动触发监控任务：

```bash
POST /api/v1/monitor/trigger

Body:
{
  "countries": ["US", "UK"]  // 可选，不提供则检查所有国家
}
```

## 支持的国家代码

- `US`: 美国（美国区域，整点和 30 分执行）
- `UK`: 英国（欧洲区域，整点执行）
- `DE`: 德国（欧洲区域，整点执行）
- `FR`: 法国（欧洲区域，整点执行）
- `IT`: 意大利（欧洲区域，整点执行）
- `ES`: 西班牙（欧洲区域，整点执行）

## 日志说明

定时任务执行时会输出详细的日志：

```
⏰ [2024-01-20 10:00:00] 开始执行监控任务，国家: US
📊 国家 US: 找到 5 个变体组
  🔍 检查变体组: iPhone 15 Pro 变体组 (group-1)
    ✅ 正常 - 异常ASIN: 0
  🔍 检查变体组: MacBook Pro 变体组 (group-2)
    ❌ 异常 - 异常ASIN: 1

📨 开始发送飞书通知...
✅ 飞书通知发送成功: US
📨 通知发送完成: 总计 1, 成功 1, 失败 0, 跳过 0

✅ 监控任务完成: 检查 5 个变体组, 异常 1 个
```

## 常见问题

### Q1: 定时任务没有执行？

**A**: 检查以下几点：

1. 确保后端服务正在运行
2. 检查服务器时间是否正确
3. 查看控制台日志，确认定时任务已初始化
4. 确认当前时间是否满足执行条件（整点或 30 分）

### Q2: 飞书通知没有收到？

**A**: 检查以下几点：

1. 确认已配置对应国家的 Webhook URL
2. 确认 Webhook URL 是否正确（可以在浏览器中测试）
3. 确认该国家是否有异常 ASIN（正常情况不发送通知）
4. 确认 ASIN 的 `feishu_notify_enabled` 是否为 1
5. 查看控制台日志，确认通知发送状态

### Q3: 如何测试定时任务？

**A**: 可以使用手动触发 API：

```bash
curl -X POST http://localhost:3001/api/v1/monitor/trigger \
  -H "Content-Type: application/json" \
  -d '{"countries": ["US"]}'
```

### Q4: 如何修改定时任务的执行时间？

**A**: 编辑 `server/src/services/schedulerService.js` 文件中的 `getCountriesToCheck` 函数，修改时间判断逻辑。

### Q5: 如何查看监控历史？

**A**: 通过监控历史 API 查看：

```bash
GET /api/v1/monitor/history?country=US&current=1&pageSize=10
```

## 注意事项

1. ⚠️ **时区问题**：定时任务使用服务器本地时间，请确保服务器时区正确
2. ⚠️ **SP-API 配置**：确保已正确配置 SP-API 凭证，否则检查会失败
3. ⚠️ **数据库连接**：确保数据库连接正常，否则无法记录监控历史
4. ✅ **性能优化**：大量 ASIN 时，检查可能需要较长时间，请耐心等待
5. ✅ **通知频率**：为避免通知过多，系统只发送异常通知，正常情况不发送

## 技术实现

- **定时任务库**：`node-cron`
- **HTTP 请求**：`axios`
- **数据库**：MySQL
- **日志**：控制台输出

## 相关文件

- `server/src/services/schedulerService.js` - 定时任务服务
- `server/src/services/feishuService.js` - 飞书通知服务
- `server/src/models/FeishuConfig.js` - 飞书配置模型
- `server/src/models/MonitorHistory.js` - 监控历史模型
- `server/src/controllers/feishuController.js` - 飞书配置控制器
