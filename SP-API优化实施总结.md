# SP-API 优化实施总结

本文档总结了为降低 SP-API 限流风险而实施的所有优化措施。

## 已实施的优化措施

### 1. 并发控制 ✅

**实现位置**: `server/src/config/monitor-config.js`, `server/src/services/variantCheckService.js`

- **变体组并发检查**: 从 3 降低到 2（可配置，默认 2）
- **ASIN 并发检查**: 从 5 降低到 3
- **效果**: 减少同时进行的 SP-API 请求数量

**配置项**:

- `MONITOR_MAX_CONCURRENT_GROUP_CHECKS`: 每次最多同时检查的变体组数量（默认 2）

### 2. 请求延迟 ✅

**实现位置**: `server/src/services/variantCheckService.js`

- **机制**: 每 20 个请求延迟 150ms
- **效果**: 平滑请求速率，避免突发请求

**配置项**:

- `SP_API_REQUEST_DELAY_INTERVAL`: 延迟间隔（默认 20）
- `SP_API_REQUEST_DELAY_MS`: 延迟毫秒数（默认 150）

### 3. 缓存优化 ✅

**实现位置**: `server/src/services/variantCheckService.js`

- **缓存时间**: 从 5 分钟增加到 12 分钟
- **效果**: 减少重复请求，降低 API 调用频率

**配置项**:

- `VARIANT_CACHE_TTL_MS`: 缓存 TTL（默认 12 分钟）

### 4. 分批处理 ✅

**实现位置**: `server/src/services/schedulerService.js`, `server/src/services/monitorTaskRunner.js`, `server/src/models/VariantGroup.js`

- **机制**: 将监控任务分成多个批次，分散执行时间
- **效果**: 避免在短时间内处理大量变体组

**配置项**:

- `MONITOR_BATCH_COUNT`: 总批次数（默认 1，即不分批）
  - 设置为 1 时，完全取消分批
  - 设置为 2+ 时，启用分批处理

**实现细节**:

- 使用变体组 ID 的哈希值分配批次，确保同一变体组总是分配到同一批次
- 基于小时和分钟计算批次索引，分散执行时间

### 5. 单次任务限制 ✅

**实现位置**: `server/src/services/monitorTaskRunner.js`

- **机制**: 限制单次任务处理的变体组数量
- **效果**: 防止单次任务过大，避免长时间占用资源

**配置项**:

- `MONITOR_MAX_GROUPS_PER_TASK`: 单次任务最多处理的变体组数量（默认 0，即不限制）

### 6. Bull 队列限流器 ✅

**实现位置**: `server/src/services/monitorTaskQueue.js`

- **机制**: 队列级别限流，每 200ms 最多处理 1 个任务（相当于 5 rps）
- **效果**: 控制整体任务处理速率

**配置**:

```javascript
limiter: {
  max: 1,
  duration: 200, // 每 200ms 最多 1 个任务
}
```

### 7. SP-API 版本策略优化 ✅

**实现位置**: `server/src/services/variantCheckService.js`

- **默认版本**: `2022-04-01`（优先使用）
- **回退版本**: `2020-12-01`（备用）
- **效果**: 优先使用新版本 API，失败时自动回退

**实现细节**:

- 循环尝试所有可用版本
- 对 400/404 错误自动回退到下一个版本
- 对 429 错误也尝试下一个版本

### 8. SP-API 简化模式 ✅

**实现位置**: `server/src/config/sp-api.js`

- **机制**: 可选 AWS 签名，简化模式仅使用 Access Token
- **效果**: 简化 API 调用流程，减少配置复杂度

**配置项**:

- `SP_API_USE_AWS_SIGNATURE`: 是否启用 AWS 签名（默认 false，简化模式）
  - `false`: 简化模式，无需 AWS 签名
  - `true`: 标准模式，需要完整的 AWS 签名

**前端管理**: 可在系统设置页面切换

### 9. HTML 抓取兜底 ✅

**实现位置**: `server/src/services/htmlScraperService.js`, `server/src/services/variantCheckService.js`

- **机制**: 当所有 SP-API 版本都失败时，使用 HTML 抓取作为最后兜底
- **效果**: 提高系统可用性，即使 SP-API 完全失败也能获取数据

**配置项**:

- `ENABLE_HTML_SCRAPER_FALLBACK`: 是否启用 HTML 抓取兜底（默认 false）

**实现细节**:

- 按国家选择 Amazon 域名
- 使用 axios 请求，设置 User-Agent 和 Accept-Language
- 15 秒超时，不使用代理
- 使用多个正则表达式提取 `parentAsin`:
  - `"parentAsin": "B0XXXXX"`
  - `"parent_asin": "B0XXXXX"`
  - `data-asin-parent="B0XXXXX"`
  - `twisterJsInit` 中的 `parentAsin`
  - `variationDisplayData` 中的 `parentAsin`

**风险提示**:

- ⚠️ 可能违反 Amazon 服务条款
- ⚠️ 可能触发反爬虫机制（IP 封禁、验证码等）
- ⚠️ 需要持续维护以适应页面结构变化
- ⚠️ 建议仅在 SP-API 完全失败时使用

**前端管理**: 可在系统设置页面切换，带有风险提示

### 10. 指数退避重试 ✅

**实现位置**: `server/src/config/sp-api.js`

- **机制**: 对 429/QuotaExceeded 错误进行指数退避重试
- **效果**: 自动处理临时限流，提高请求成功率

**配置**:

- 默认最多重试 3 次
- 初始延迟 1000ms，每次重试延迟翻倍（1s → 2s → 4s）

**实现细节**:

- `callSPAPI` 函数包装了 `callSPAPIInternal`，自动处理重试逻辑
- 检测 429 状态码或包含 "QuotaExceeded"/"TooManyRequests" 的错误消息
- 指数退避延迟：`initialDelay * 2^(attempt-1)`

### 11. 旧客户端备用方案 ✅

**实现位置**: `server/src/services/legacySPAPIClient.js`, `server/src/services/variantCheckService.js`

- **机制**: 当标准 SP-API 调用失败时，使用旧客户端方式作为备用
- **效果**: 提供额外的备用方案，提高系统可用性

**配置项**:

- `ENABLE_LEGACY_CLIENT_FALLBACK`: 是否启用旧客户端备用（默认 false）

**实现细节**:

- 使用简化的请求头（仅 Access Token，无需 AWS 签名）
- 降级顺序：SP-API → 旧客户端 → HTML 抓取
- 在 SP-API 所有版本都失败后，尝试旧客户端
- 如果旧客户端也失败，继续尝试 HTML 抓取（如果启用）

**前端管理**: 可在系统设置页面切换

## 配置汇总

### 环境变量

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `MONITOR_MAX_CONCURRENT_GROUP_CHECKS` | 2 | 每次最多同时检查的变体组数量 |
| `SP_API_REQUEST_DELAY_INTERVAL` | 20 | 请求延迟间隔（每 N 个请求） |
| `SP_API_REQUEST_DELAY_MS` | 150 | 请求延迟毫秒数 |
| `MONITOR_BATCH_COUNT` | 1 | 分批处理的总批次数（1=不分批） |
| `MONITOR_MAX_GROUPS_PER_TASK` | 0 | 单次任务最多处理的变体组数量（0=不限制） |
| `SP_API_USE_AWS_SIGNATURE` | false | 是否启用 AWS 签名（false=简化模式） |
| `ENABLE_LEGACY_CLIENT_FALLBACK` | false | 是否启用旧客户端备用 |
| `ENABLE_HTML_SCRAPER_FALLBACK` | false | 是否启用 HTML 抓取兜底 |

### 前端配置

所有配置项都可以在系统设置页面进行管理：

- **SP-API 配置** Tab: 管理所有 SP-API 相关配置
- **启用 AWS 签名**: 开关控制简化/标准模式
- **启用旧客户端备用**: 开关控制旧客户端备用功能
- **启用 HTML 抓取兜底**: 开关控制 HTML 抓取功能（带风险提示）

## 优化效果预期

1. **降低限流风险**: 通过并发控制、请求延迟、分批处理等措施，显著降低触发 SP-API 限流的风险
2. **提高可用性**: 三级降级策略（SP-API → 旧客户端 → HTML 抓取）确保即使 SP-API 完全失败也能获取数据
3. **自动恢复**: 指数退避重试自动处理临时限流，提高请求成功率
4. **简化配置**: 简化模式无需 AWS 签名，降低配置复杂度
5. **灵活调整**: 所有关键参数都可通过环境变量或前端界面调整

## 注意事项

1. **分批处理与实时性**: 分批处理会影响飞书通知的实时性，如果对实时性要求高，可以设置 `MONITOR_BATCH_COUNT=1` 完全取消分批
2. **降级策略顺序**: 降级顺序为 SP-API → 旧客户端 → HTML 抓取，建议按需启用
3. **HTML 抓取风险**: HTML 抓取可能违反 Amazon 服务条款，建议仅在必要时启用
4. **缓存一致性**: 缓存时间增加到 12 分钟，可能影响数据实时性，但可以显著降低 API 调用频率
5. **版本兼容性**: SP-API 版本策略会自动适配不同版本的响应格式
6. **重试延迟**: 指数退避重试会增加请求延迟，但能提高成功率

## 后续优化建议

1. **监控和告警**: 添加 SP-API 限流监控和告警机制
2. **动态调整**: 根据限流情况动态调整并发数和延迟参数
3. **请求优先级**: 实现请求优先级机制，优先处理重要变体组
4. **分布式限流**: 如果部署多个实例，考虑使用 Redis 实现分布式限流
