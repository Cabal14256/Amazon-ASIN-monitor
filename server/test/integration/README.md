# Redis / MySQL 集成测试

`npm --prefix server run test:integration` 只面向隔离的本机或 CI 服务，验证：

- Redis 7 中真实 Lua 的全窗口、全 token 原子扣减；
- API/Worker 两个 limiter 实例共享 response-header 元数据与窗口用量；
- Redis 服务重启后现有客户端恢复连接；
- MySQL 8 初始化 SQL 可重复执行，并能从真实 `sp_api_config` 行验证数据库值与空配置回退。
- 飞书电话加急迁移可升级缺列的旧配置表并重复执行，保留已有通知配置；
- 真实 `FeishuConfig` 模型在隔离库中按国家和 ASIN 去重统计异常，验证通知开关、窗口边界、并发抢占与各区域独立的 UTC 冷却。

测试要求 `RUN_INTEGRATION_TESTS=true`、回环地址 Redis/MySQL、动态测试库名以及 `INTEGRATION_ALLOW_DROP_DATABASES=true`。不满足这些保护条件时不会连接或删除数据库。测试不会启动 API/Worker，不调用 Amazon、飞书或其他外部服务。

应用数据库连接池仅在验证上述条件并初始化 CI 数据库后加载，强制使用该隔离库的连接参数。迁移测试对本次测试创建的配置表模拟旧结构；测试结束时关闭应用连接池并删除两个 CI 数据库。

## 必需检查晋级

`integration` 初始为非必需检查。使用以下命令审阅最近运行，并在连续 10 次成功且每次总耗时低于 10 分钟后，才把它加入 `main` 的必需检查：

```bash
gh run list --workflow integration.yml --limit 10 \
  --json conclusion,databaseId,startedAt,updatedAt,url
```

用每次 run 的 `startedAt` 到 `updatedAt` 计算包含 service container 初始化在内的总耗时；job summary 中的测试步骤耗时只用于诊断，不能替代总耗时。任何失败或超时都会重新开始连续成功计数。晋级时应在治理 Issue 中记录 10 个 run ID、结论和总耗时。
