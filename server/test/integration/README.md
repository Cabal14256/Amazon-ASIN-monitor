# Redis / MySQL 集成测试

`npm --prefix server run test:integration` 只面向隔离的本机或 CI 服务，验证：

- Redis 7 中真实 Lua 的全窗口、全 token 原子扣减；
- API/Worker 两个 limiter 实例共享 response-header 元数据与窗口用量；
- Redis 服务重启后现有客户端恢复连接；
- MySQL 8 初始化 SQL 可重复执行，并能从真实 `sp_api_config` 行验证数据库值与空配置回退。

测试要求 `RUN_INTEGRATION_TESTS=true`、回环地址 Redis/MySQL、动态测试库名以及 `INTEGRATION_ALLOW_DROP_DATABASES=true`。不满足这些保护条件时不会连接或删除数据库。测试不会启动 API/Worker，不调用 Amazon、飞书或其他外部服务。

## 必需检查晋级

`integration` 初始为非必需检查。使用以下命令审阅最近运行，并在连续 10 次成功且每次总耗时低于 10 分钟后，才把它加入 `main` 的必需检查：

```bash
gh run list --workflow integration.yml --limit 10 \
  --json conclusion,databaseId,startedAt,updatedAt,url
```

任何失败或超时都会重新开始连续成功计数。晋级时应在治理 Issue 中记录 10 个 run ID、结论和耗时。
