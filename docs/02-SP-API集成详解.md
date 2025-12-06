# SP-API 集成详解

## 概述

Amazon SP-API (Selling Partner API) 是 Amazon 提供的官方 API，用于获取商品信息。本系统通过 SP-API 的 Catalog Items API 来查询 ASIN 的变体关系。

## SP-API 客户端初始化

### 多区域凭据管理

系统支持 US 和 EU 两个区域，通过 `regionCreds.js` 管理不同区域的凭据：

```1:19:backend/utils/regionCreds.js
// backend/utils/regionCreds.js
const REGION_BY_COUNTRY = { US:'US', UK:'EU', DE:'EU', FR:'EU', IT:'EU', ES:'EU' };

function pickRegion(country='US') {
  return REGION_BY_COUNTRY[country] || 'US';
}

function pickCredsByRegion(region) {
  const R = String(region || 'US').toUpperCase(); // US / EU

  return {
    clientId:     process.env[`SP_API_CLIENT_ID_${R}`]     || process.env.SP_API_CLIENT_ID     || '',
    clientSecret: process.env[`SP_API_CLIENT_SECRET_${R}`] || process.env.SP_API_CLIENT_SECRET || '',
    refreshToken: process.env[`SP_API_TOKENS_${R}`]        || process.env.SP_API_TOKENS        || '',
    region: R,
  };
}

module.exports = { pickRegion, pickCredsByRegion };
```

**凭据优先级**：

1. 区域特定凭据：`SP_API_CLIENT_ID_US` / `SP_API_CLIENT_ID_EU`
2. 通用凭据：`SP_API_CLIENT_ID`（向后兼容）

### 创建 SP-API 客户端

`makeSp()` 函数根据国家代码创建对应的 SP-API 客户端：

```19:55:backend/utils/spapi.js
function makeSp(country = 'US') {
  // regionKey = 'US' 或 'EU'
  const regionKey = pickRegion(country);
  const creds = pickCredsByRegion(regionKey);

  if (!creds.clientId || !creds.clientSecret || !creds.refreshToken) {
    throw new Error(
      `[SP-API] 缺少凭据 region=${regionKey} ` +
      `clientId=${!!creds.clientId} secret=${!!creds.clientSecret} token=${!!creds.refreshToken}`
    );
  }

  // amazon-sp-api 库里 region 只能是 'na' | 'eu' | 'fe'
  const region = regionKey === 'EU' ? 'eu' : 'na';

  const sp = new SellingPartnerAPI({
    region,
    refresh_token: creds.refreshToken,
    credentials: {
      SELLING_PARTNER_APP_CLIENT_ID:     creds.clientId,
      SELLING_PARTNER_APP_CLIENT_SECRET: creds.clientSecret,
      AWS_ACCESS_KEY_ID:                 process.env.AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY:             process.env.AWS_SECRET_ACCESS_KEY,
      AWS_SELLING_PARTNER_ROLE:          process.env.SP_API_ROLE_ARN,
    },
    auto_request_tokens: true,
    auto_request_threshold: 60,
  });

  if (process.env.SP_DEBUG === '1') {
    console.log(
      `初始化 SP-API 客户端: country=${country}, region=${region}, lib=amazon-sp-api, id=${(creds.clientId || '').slice(0, 18)}…`
    );
  }

  return sp;
}
```

**关键配置说明**：

- **region**: 根据区域转换为 'na'（北美）或 'eu'（欧洲）
- **auto_request_tokens**: 自动刷新访问令牌
- **auto_request_threshold**: 令牌过期前 60 秒自动刷新
- **AWS 凭据**: 需要 AWS 访问密钥和 SP-API 角色 ARN 用于签名请求

### Marketplace ID 映射

不同国家对应不同的 Marketplace ID：

```6:13:backend/utils/spapi.js
// 各站点 marketplaceId
const MARKETPLACE = {
  US:'ATVPDKIKX0DER',
  UK:'A1F83G8C2ARO7P',
  DE:'A1PA6795UKMFR9',
  FR:'A13V1IB3VIYZZH',
  IT:'APJ6JRA9NG5V4',
  ES:'A1RKKUPIHCS9HS',
};
```

## getCatalogItem API 调用

### API 封装函数

系统封装了 `getCatalogItem()` 函数来调用 Catalog Items API：

```57:97:backend/utils/spapi.js
/**
 * 统一封装 getCatalogItem (v2022-04-01)
 * 👉 直接走 /catalog/2022-04-01/items/{asin}?marketplaceIds=ATV...&includedData=...
 *    避免 endpoint/operation 映射出问题导致 400 InvalidInput
 */
async function getCatalogItem(sp, asin, marketplaceId) {
  const upperAsin = String(asin || '').trim().toUpperCase();
  const mp        = String(marketplaceId || '').trim();

  if (!upperAsin || !mp) {
    throw new Error(`[SP-API] getCatalogItem 参数错误 asin=${upperAsin} marketplaceId=${mp}`);
  }

  try {
    const res = await sp.callAPI({
      // 直接使用文档里的路径
      api_path: `/catalog/2022-04-01/items/${encodeURIComponent(upperAsin)}`,
      method: 'GET',
      // 官方文档：marketplaceIds / includedData 是 comma-delimited csv
      // 这里直接用字符串，避免 SDK 把数组转成奇怪格式导致 InvalidInput
      query: {
        marketplaceIds: mp,
        // 只要我们真的用到的几类数据，越少越安全
        includedData: 'summaries,attributes,relationships,images,productTypes,identifiers',
      },
    });

    return res;
  } catch (e) {
    if (process.env.SP_DEBUG === '1') {
      const body = e?.response?.data;
      console.error(
        '[SP-API getCatalogItem] 调用失败:',
        e?.code || '',
        e?.message || e,
        body ? JSON.stringify(body) : ''
      );
    }
    throw e;
  }
}
```

### 关键设计决策

1. **直接使用 API 路径**：使用 `api_path` 而不是 `endpoint/operation`，避免 SDK 映射问题
2. **字符串格式参数**：`marketplaceIds` 和 `includedData` 使用字符串而非数组，符合 API 文档要求
3. **最小化数据请求**：只请求必要的数据类型，减少响应大小和 API 配额消耗

### API 参数说明

#### `marketplaceIds`

- 类型：字符串（逗号分隔）
- 说明：目标市场的 Marketplace ID
- 示例：`"ATVPDKIKX0DER"`（美国）

#### `includedData`

- 类型：字符串（逗号分隔）
- 说明：需要包含的数据类型
- 包含的数据类型：
  - `summaries`: 商品摘要信息（包含 parentAsin）
  - `attributes`: 商品属性（包含 brand）
  - `relationships`: 商品关系
  - `images`: 商品图片
  - `productTypes`: 商品类型
  - `identifiers`: 商品标识符

## API 响应结构

### 响应数据结构

SP-API 返回的 Catalog Item 数据结构如下：

```json
{
  "asin": "B08XYZ1234",
  "summaries": [
    {
      "brandName": "Brand Name",
      "parentAsin": "B08PARENT123",  // 父体ASIN（如果存在）
      "browseClassification": {...},
      "color": "...",
      "itemName": "...",
      "manufacturer": "...",
      "modelNumber": "...",
      "size": "...",
      "style": "...",
      "websiteDisplayGroup": "...",
      "websiteDisplayGroupName": "..."
    }
  ],
  "attributes": {
    "brand": ["Brand Name"]  // 品牌信息
  },
  "relationships": [
    {
      "relationships": [
        {
          "type": "PARENT",
          "asin": "B08PARENT123"
        }
      ]
    }
  ],
  "variations": [
    {
      "asins": ["B08XYZ1234", "B08XYZ5678"],  // 兄弟ASIN列表
      "relationships": [
        {
          "parentAsins": ["B08PARENT123"]  // 新结构：父体ASIN数组
        }
      ]
    }
  ]
}
```

### 关键字段说明

#### `summaries[0].parentAsin`

- **位置**：最直接的父体 ASIN 来源
- **类型**：字符串或 null
- **说明**：如果当前 ASIN 是变体，这里会包含父体 ASIN

#### `variations[0].asins`

- **位置**：变体数组的第一个元素的 asins 字段
- **类型**：字符串数组
- **说明**：包含所有兄弟 ASIN（包括自身）

#### `variations[0].relationships[0].parentAsins`

- **位置**：新结构中的父体 ASIN
- **类型**：字符串数组
- **说明**：新版本 API 返回的父体 ASIN 数组

#### `relationships[*].relationships[*]`

- **位置**：嵌套关系结构
- **类型**：对象数组
- **说明**：旧版本 API 可能在这里返回父体关系

## 调用流程

### 在 getVariantData 中的使用

```95:100:backend/services/variantMonitor.js
  // 1) 官方 SP-API 调 catalogItems v2022-04-01
  try {
    const sp = makeSp(marketKey);                                // 按 US/EU 取凭据
    const marketplaceId = MARKETPLACE[marketKey] || MARKETPLACE.US;

    const result = await getCatalogItem(sp, asinNorm, marketplaceId);
```

**流程说明**：

1. 根据 `marketKey`（国家代码）创建 SP-API 客户端
2. 获取对应的 Marketplace ID
3. 调用 `getCatalogItem()` 获取商品信息
4. 从返回结果中提取变体信息

## 错误处理

### 错误类型

SP-API 可能返回的错误：

1. **400 InvalidInput**: 参数错误

   - ASIN 格式不正确
   - Marketplace ID 无效
   - includedData 参数错误

2. **403 Unauthorized**: 认证失败

   - 凭据无效
   - 令牌过期
   - 权限不足

3. **404 NotFound**: 商品不存在

   - ASIN 不存在
   - 商品不在指定市场

4. **429 TooManyRequests**: 请求过多

   - 超过 API 配额限制
   - 需要实现重试机制

5. **500/503**: 服务器错误
   - Amazon 服务暂时不可用
   - 需要重试

### 错误处理策略

系统采用以下错误处理策略：

```150:152:backend/services/variantMonitor.js
  } catch (e) {
    console.error(`❌ 获取 ASIN ${asinNorm} @ ${marketKey} 失败:`, e?.message || e);
  }
```

**处理方式**：

- 捕获异常但不中断流程
- 记录错误日志
- 继续执行兜底逻辑（legacy 客户端或 HTML 抓取）

### 调试模式

通过环境变量 `SP_DEBUG=1` 启用详细日志：

```48:52:backend/utils/spapi.js
  if (process.env.SP_DEBUG === '1') {
    console.log(
      `初始化 SP-API 客户端: country=${country}, region=${region}, lib=amazon-sp-api, id=${(creds.clientId || '').slice(0, 18)}…`
    );
  }
```

启用后会输出：

- 客户端初始化信息
- API 调用失败详情
- 错误响应体内容

## 最佳实践

### 1. 凭据管理

- 使用环境变量存储凭据
- 区分 US 和 EU 区域的凭据
- 定期轮换凭据

### 2. API 配额管理

- 使用 `p-limit` 控制并发数（当前设置为 5）
- 避免短时间内大量请求
- 监控 API 调用频率

### 3. 错误重试

- 对于临时错误（500/503），实现指数退避重试
- 对于认证错误，检查凭据配置
- 对于限流错误，降低请求频率

### 4. 数据缓存

- 考虑缓存商品信息（注意时效性）
- 避免重复查询相同 ASIN

### 5. 监控和告警

- 监控 API 调用成功率
- 监控 API 配额使用情况
- 设置错误率告警阈值

## 总结

SP-API 集成是系统的核心依赖，通过合理的封装和错误处理，确保了变体查询功能的稳定性。系统采用多层兜底策略，即使 SP-API 调用失败，也能通过其他方式获取变体信息。
