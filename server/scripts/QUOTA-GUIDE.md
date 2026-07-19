# SP-API 配额分析与监控

本项目提供两个不同用途的工具：计划负载估算和本地限流器实时观测。它们都不能代表 Amazon 账户的“剩余配额”。

## 三种数据不要混用

1. **计划负载估算**：根据数据库中的监控变体组、调度间隔和批次数，估算定时任务会发起多少请求。
2. **本地限流器状态**：读取共享 Redis 滑动窗口，显示本系统最近一秒、一分钟和一小时已放行的请求数。
3. **Amazon usage plan**：Amazon 按 operation、账号、应用和区域等因素分配，可能动态变化。以 operation 文档、响应中的 `x-amzn-RateLimit-Limit`（存在时）和实际 429 为准。

Amazon 官方说明：

- [Usage Plans and Rate Limits](https://developer-docs.amazon.com/sp-api/docs/usage-plans-and-rate-limits)
- [getCatalogItem](https://developer-docs.amazon.com/sp-api/reference/getcatalogitem)

## 估算定时任务负载

在仓库根目录执行：

```bash
npm --prefix server run analyze-quota
```

脚本会：

- 从主营库读取 `sp_api_config`，数据库中的监控间隔和竞品开关优先于同名环境变量；
- 只统计已经属于监控变体组的 ASIN，不把未分组记录算入定时任务；
- 在竞品监控开启时，通过 `COMPETITOR_DB_*` 独立连接竞品库；连接或查询失败会以非零状态退出，不输出不完整结论；
- 按 US、EU 分别报告主营与竞品数量、完整轮转时间、operation 请求数和本地区域上限占用；
- 明确排除重试、手动检查、缓存未命中和兜底请求，这些都会增加实际流量。

默认逐个检查时，一个计划内 ASIN 通常对应一次 `getCatalogItem` 尝试：

```text
每小时计划请求 = 完整轮转请求数 ÷ MONITOR_BATCH_COUNT × (60 ÷ 区域调度间隔)
完整轮转时间 = 区域调度间隔 × MONITOR_BATCH_COUNT
```

因此 `MONITOR_BATCH_COUNT=N` 不只是削峰：每次只处理一批，也会让每个变体组的有效检查间隔扩大为原来的 N 倍。

### 实验性批量查询

`MONITOR_BATCH_ASIN_THRESHOLD` 默认为 `0`，即关闭。启用后，主营监控可能先按每 20 个 ASIN 发起 `searchCatalogItems`，再根据返回结果进行详细查询；详细请求数无法在执行前精确得知，所以分析工具只报告上下界。竞品监控仍按 ASIN 逐个查询。

该路径属于实验性功能，不能仅凭估算结果在生产环境启用，必须先在测试账号验证请求兼容性和返回结果。

## 实时观测本地限流器

持续刷新：

```bash
npm --prefix server run monitor-quota
```

只输出一次快照：

```bash
npm --prefix server run monitor-quota -- --once
```

实时监控必须与 API/Worker 使用同一个 Redis 配置。独立脚本无法读取其他进程的内存令牌桶，因此 Redis 不可用时会明确报错并退出，而不会显示一组看似健康的空数据。

输出按 US/EU 展示：

- 区域总窗口的分钟、小时用量；
- `getCatalogItem` 和 `searchCatalogItems` 的秒、分钟、小时用量；
- operation 限额来源：启动默认值或 Amazon 响应头；
- 已用、剩余和本地上限占比。

内部状态接口提供相同快照：

```text
GET /api/v1/rate-limiter/status
GET /api/v1/rate-limiter/status?region=US
GET /api/v1/rate-limiter/status?region=EU&operation=getCatalogItem
```

`region` 仅支持 `US`、`EU`；不支持的 region 或 operation 返回 400。

## 相关配置

| 配置 | 含义 |
| --- | --- |
| `MONITOR_US_SCHEDULE_MINUTES` | US 调度间隔，仅支持 15/30/60；数据库配置优先 |
| `MONITOR_EU_SCHEDULE_MINUTES` | EU 调度间隔，仅支持 15/30/60；数据库配置优先 |
| `COMPETITOR_MONITOR_ENABLED` | 是否计入并执行竞品监控；数据库配置优先 |
| `MONITOR_BATCH_COUNT` | 调度轮转批次数；增大后完整覆盖时间同步增长 |
| `MONITOR_MAX_GROUPS_PER_TASK` | 每个国家、每个批次最多处理的变体组；超出部分不会进入当前计划覆盖 |
| `MONITOR_BATCH_ASIN_THRESHOLD` | 主营实验性批量查询阈值，默认 0（关闭） |
| `SP_API_RATE_LIMIT_PER_MINUTE` | 每个区域的本地分钟保护上限，不是 Amazon 配额 |
| `SP_API_RATE_LIMIT_PER_HOUR` | 每个区域的本地小时保护上限，不是 Amazon 配额 |
| `QUOTA_MONITOR_INTERVAL` | 实时监控刷新间隔，单位毫秒，最小 1000 |

已识别的请求会同时经过区域级和 operation 级限制。operation 启动默认值来自当前官方文档；收到有效 `x-amzn-RateLimit-Limit` 后，运行进程会更新对应限流器，并把非敏感的速率元数据写入 Redis 供监控读取。

## 429 排查顺序

1. 运行一次负载估算，确认完整覆盖周期、竞品调用和任务上限是否符合预期。
2. 使用实时监控确认触达的是区域窗口还是某个 operation 窗口。
3. 检查服务端 429、重试和响应头日志；少量瞬时 429 仍可能发生，客户端必须保留退避重试。
4. 根据业务时效要求延长调度间隔或增加批次数，并接受有效检查间隔同步增长的取舍。
5. 降低 Worker 和变体组并发以减少突发流量；并发调整不会自动降低完整轮转的请求总量。
6. 不要为了消除本地等待而把保护上限盲目调高到账号实际 usage plan 之上。

## 常见失败

- **分析脚本无法连接主营库**：检查 `server/.env` 中 `DB_*` 和数据库权限。
- **竞品开启但分析失败**：检查 `COMPETITOR_DB_*` 是否指向包含竞品表的独立 schema；脚本不会回退为忽略竞品。
- **实时监控提示未使用 Redis**：确认脚本、API 和 Worker 的 `REDIS_URL`/`REDIS_URI`、数据库编号及 `RATE_LIMITER_KEY_PREFIX` 一致。
- **估算值低于实际请求**：检查重试、手动任务、兜底客户端、实验性批量查询和多个调度器实例。
