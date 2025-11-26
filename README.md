# README

`@umijs/max` 模板项目，更多功能参考 [Umi Max 简介](https://umijs.org/docs/max/introduce)

## Redis 验证脚本

项目根目录提供 `scripts/check-redis.js` 验证脚本，可以确认 Redis 与 Bull 队列是否连通：

```bash
npm run check-redis -- redis://127.0.0.1:6379
```

如果不传参数，会自动读取 `REDIS_URL`/`REDIS_URI` 环境变量，或者回退到 `redis://127.0.0.1:6379`。脚本会输出 ping、Redis 版本、队列状态和最近失败任务，便于在本地开发时验证 Redis 服务是否可用。
