# 定时任务和飞书通知功能说明

## 功能概述

### 1. 定时任务

系统会自动按以下时间表执行监控检查：

- **美国区域** (US): 每小时整点和 30 分执行（如 10:00、10:30、11:00、11:30...）
- **欧洲区域** (UK, DE, FR, IT, ES): 每小时整点执行（如 10:00、11:00、12:00...）

### 2. 飞书通知

- 按国家/区域推送监控结果
- 只发送异常情况的通知（有异常 ASIN 时）
- 支持配置每个国家的 Webhook URL

## 配置说明

### 飞书 Webhook 配置

#### 1. 获取飞书 Webhook URL

1. 打开飞书，进入需要接收通知的群聊
2. 点击群设置 → 群机器人 → 添加机器人 → 自定义机器人
3. 设置机器人名称和描述
4. 复制生成的 Webhook URL

#### 2. 配置 Webhook URL

**方式 1: 通过 API 配置**

```bash
# 创建/更新配置
curl -X POST http://localhost:3001/api/v1/feishu-configs \
  -H "Content-Type: application/json" \
  -d '{
    "country": "US",
    "webhookUrl": "https://open.feishu.cn/open-apis/bot/v2/hook/xxxxx",
    "enabled": true
  }'
```

**方式 2: 直接插入数据库**

```sql
INSERT INTO feishu_config (country, webhook_url, enabled)
VALUES ('US', 'https://open.feishu.cn/open-apis/bot/v2/hook/xxxxx', 1);
```

### 支持的国家代码

- `US`: 美国
- `UK`: 英国
- `DE`: 德国
- `FR`: 法国
- `IT`: 意大利
- `ES`: 西班牙

## API 接口

### 飞书配置管理

#### 1. 获取所有配置

```
GET /api/v1/feishu-configs
```

#### 2. 根据国家获取配置

```
GET /api/v1/feishu-configs/:country
```

#### 3. 创建/更新配置

```
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

```
DELETE /api/v1/feishu-configs/:country
```

#### 5. 启用/禁用配置

```
PATCH /api/v1/feishu-configs/:country/toggle

Body:
{
  "enabled": true
}
```

## 通知规则

### 通知触发条件

1. **定时任务执行时**：

   - 检查所有开启了飞书通知的 ASIN（`feishu_notify_enabled = 1`）
   - 如果发现异常 ASIN，按国家分组发送通知

2. **通知内容**：
   - 只发送有异常的通知（正常情况不发送）
   - 包含异常 ASIN 列表
   - 包含检查统计信息

### 通知格式

飞书通知卡片包含：

- 标题：ASIN 变体监控通知
- 国家/区域信息
- 检查时间
- 检查状态（正常/异常）
- 检查统计（总数、正常数、异常数）
- 异常 ASIN 列表（最多显示 10 个）

## 手动触发检查

如果需要手动触发监控检查（用于测试），可以调用：

```javascript
const { triggerManualCheck } = require('./services/schedulerService');

// 检查所有国家
await triggerManualCheck();

// 检查指定国家
await triggerManualCheck(['US', 'UK']);
```

## 日志说明

定时任务执行时会输出以下日志：

```
⏰ [2024-01-20 10:00:00] 开始执行监控任务，国家: US
📊 国家 US: 找到 5 个变体组
  🔍 检查变体组: iPhone 15 Pro 变体组 (group-1)
    ✅ 正常 - 异常ASIN: 0
  🔍 检查变体组: MacBook Pro 变体组 (group-2)
    ❌ 异常 - 异常ASIN: 1
📨 开始发送飞书通知...
📨 通知发送完成: 总计 1, 成功 1, 失败 0, 跳过 0
✅ 监控任务完成: 检查 5 个变体组, 异常 1 个
```

## 注意事项

1. **时区问题**：定时任务使用服务器本地时间，请确保服务器时区设置正确
2. **SP-API 限制**：注意 SP-API 的调用频率限制，避免触发限流
3. **通知频率**：目前只发送异常通知，避免通知过多
4. **ASIN 通知开关**：只有开启了飞书通知的 ASIN 才会被检查和通知（`feishu_notify_enabled = 1`）

## 故障排查

### 定时任务未执行

1. 检查服务器日志，确认定时任务已启动
2. 检查服务器时间是否正确
3. 检查数据库连接是否正常

### 飞书通知未发送

1. 检查 Webhook URL 是否正确配置
2. 检查飞书机器人是否被移除或禁用
3. 查看服务器日志中的错误信息
4. 确认 ASIN 的`feishu_notify_enabled`字段是否为 1

### 通知发送失败

1. 检查网络连接
2. 验证 Webhook URL 是否有效
3. 检查飞书 API 是否正常
