# SP-API 配置指南

本文档说明如何配置 Amazon Selling Partner API (SP-API) 来检查 ASIN 的变体状态。

## 前置要求

1. Amazon Seller Central 账户
2. AWS 账户
3. SP-API 开发者账户

## 配置步骤

### 1. 创建 IAM 用户和角色

1. 登录 AWS 控制台
2. 创建 IAM 用户：

   - 用户名：`sp-api-user`
   - 访问类型：编程访问
   - 保存 Access Key ID 和 Secret Access Key

3. 创建 IAM 角色：

   - 角色名称：`sp-api-role`
   - 信任实体：选择 "另一个 AWS 账户"
   - 输入你的 AWS 账户 ID
   - 附加策略：`AmazonSellingPartnerAPIReadOnlyAccess`（或自定义策略）

4. 记录 Role ARN（格式：`arn:aws:iam::ACCOUNT_ID:role/sp-api-role`）

### 2. 在 Seller Central 注册应用程序

1. 登录 Seller Central
2. 进入 "应用和服务" > "开发应用程序"
3. 点击 "添加新应用程序"
4. 填写信息：
   - 应用程序名称
   - OAuth 重定向 URI（开发环境可以使用 `https://localhost`）
5. 保存后获得：
   - LWA Client ID
   - LWA Client Secret

### 3. 获取 Refresh Token

1. 使用 OAuth 2.0 授权流程获取 Refresh Token
2. 可以使用 SP-API 授权工具或手动授权
3. 授权工具：https://sellercentral.amazon.com/apps/authorize/consent

### 4. 配置环境变量

在 `server/.env` 文件中添加以下配置：

```env
# SP-API LWA 配置
SP_API_LWA_CLIENT_ID=your_lwa_client_id
SP_API_LWA_CLIENT_SECRET=your_lwa_client_secret
SP_API_REFRESH_TOKEN=your_refresh_token

# SP-API AWS 配置
SP_API_ACCESS_KEY_ID=your_aws_access_key_id
SP_API_SECRET_ACCESS_KEY=your_aws_secret_access_key
SP_API_ROLE_ARN=arn:aws:iam::YOUR_ACCOUNT_ID:role/sp-api-role
```

## API 端点说明

系统会根据国家代码自动选择正确的 API 端点：

- **US 区域（美国）**: `https://sellingpartnerapi-na.amazon.com`
- **EU 区域（英国、德国、法国、意大利、西班牙）**: `https://sellingpartnerapi-eu.amazon.com`

## Marketplace ID 映射

系统已配置以下 Marketplace ID：

**US 区域：**

- US: `ATVPDKIKX0DER` (美国)

**EU 区域：**

- UK: `A1F83G8C2ARO7P` (英国)
- DE: `A1PA6795UKMFR9` (德国)
- FR: `A13V1IB3VIYZZH` (法国)
- IT: `APJ6JRA9NG5V4` (意大利)
- ES: `A1RKKUPIHCS9HS` (西班牙)

## API 接口

### 检查变体组

```http
POST /api/v1/variant-groups/:groupId/check
```

### 检查单个 ASIN

```http
POST /api/v1/asins/:asinId/check
```

### 批量检查变体组

```http
POST /api/v1/variant-groups/batch-check
Content-Type: application/json

{
  "groupIds": ["group-id-1", "group-id-2"],
  "country": "US"
}
```

## 检查逻辑

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

## 错误处理

- **404 错误**：ASIN 不存在或无法访问，标记为无变体
- **认证错误**：检查 LWA 配置和 Refresh Token
- **权限错误**：检查 IAM 角色和策略配置
- **限流错误**：SP-API 有速率限制，系统会自动重试

## 测试

配置完成后，可以使用以下方式测试：

1. 通过 API 接口手动触发检查
2. 查看监控历史记录
3. 检查数据库中的变体状态更新

## 注意事项

1. SP-API 有速率限制，请合理控制检查频率
2. Refresh Token 可能会过期，需要定期更新
3. 确保 IAM 角色有正确的权限
4. 不同 Marketplace 的 API 端点不同，系统会自动处理

## 参考文档

- [SP-API 官方文档](https://developer-docs.amazon.com/sp-api/)
- [SP-API 认证指南](https://developer-docs.amazon.com/sp-api/docs/connecting-to-the-selling-partner-api)
- [Catalog Items API](https://developer-docs.amazon.com/sp-api/docs/catalog-items-api-v2022-04-01-reference)
