# Redis / MySQL 集成测试

`npm --prefix server run test:integration` 只面向隔离的本机或 CI 服务，验证：

- Redis 7 中真实 Lua 的全窗口、全 token 原子扣减；
- API/Worker 两个 limiter 实例共享 response-header 元数据与窗口用量；
- Redis 服务重启后现有客户端恢复连接；
- MySQL 8 初始化 SQL 可重复执行，并能从真实 `sp_api_config` 行验证数据库值与空配置回退。
- 飞书电话加急迁移可升级缺列的旧配置表并重复执行，保留已有通知配置；
- 拆分跟踪迁移可重复执行且保留真实基准和事件；22 个关系丢失 ASIN 只计 11 个新增健康异常组，持续异常及首次已异常不新增，恢复健康后再次拆分仍按窗口内组去重；
- 真实 `VariantSplitState` 事务验证当前健康与历史父体变化独立：有效新父体保持正常、恢复原父体仍保留变化记录、健康异常与父体审计可同时产生、旧版父体变化异常重新监控后恢复；关系丢失、排除标题查询失败/API/人工异常、过期观测及删除/移组，并发观测只生成一个事件；
- 父体标题从已确认非空变为查询成功且为空时，仅产生一个新增组事件；标题未知、404、API 失败、超时及旧缓存缺少标题状态不会解除异常，全部成员恢复后再次异常仍按窗口内组去重；首次空标题及升级前没有标题状态的存量数据不产生新增事件；
- 真实 `FeishuConfig` 模型验证区域、通知开关、毫秒窗口边界、严格超过阈值、并发抢占与各区域独立的 UTC 冷却；每日窗口已消费事件不重拨，统计之后到达的新事件不会被提前消费；父体变化审计（包括升级前 `notify_enabled = 1` 的事件）不参与健康异常数量，也不会被电话抢占消费。

测试要求 `RUN_INTEGRATION_TESTS=true`、回环地址 Redis/MySQL、动态测试库名以及 `INTEGRATION_ALLOW_DROP_DATABASES=true`。不满足这些保护条件时不会连接或删除数据库。测试不会启动 API/Worker，不调用 Amazon、飞书或其他外部服务。

应用数据库连接池仅在验证上述条件并初始化 CI 数据库后加载，强制使用该隔离库的连接参数。迁移测试对本次测试创建的配置表模拟旧结构；测试结束时关闭应用连接池并删除两个 CI 数据库。

## 必需检查晋级

`integration` 初始为非必需检查。使用以下命令审阅最近运行，并在连续 10 次成功且每次总耗时低于 10 分钟后，才把它加入 `main` 的必需检查：

```bash
gh run list --workflow integration.yml --limit 10 \
  --json conclusion,databaseId,startedAt,updatedAt,url
```

用每次 run 的 `startedAt` 到 `updatedAt` 计算包含 service container 初始化在内的总耗时；job summary 中的测试步骤耗时只用于诊断，不能替代总耗时。任何失败或超时都会重新开始连续成功计数。晋级时应在治理 Issue 中记录 10 个 run ID、结论和总耗时。
