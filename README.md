# Amazon ASIN Monitor

Amazon ASIN 监控系统，用于监控和管理 Amazon 产品 ASIN 信息。

## 项目结构

- **前端**：基于 UmiJS (React) 的单页应用
- **后端**：Node.js/Express API 服务
- **数据库**：MySQL
- **缓存/队列**：Redis + Bull

## 快速开始

### 本地开发

请参考以下文档：

- [快速开始指南](QUICK-START.md)
- [完整设置指南](SETUP.md)

### 生产环境部署

#### 1Panel 部署（推荐）

如果您使用 1Panel 面板，请参考：

- **[1Panel 部署详细指南](DEPLOY-1PANEL.md)** - 完整的部署步骤
- **[部署检查清单](DEPLOY-CHECKLIST.md)** - 确保所有步骤完成
- **自动化部署脚本**：`deploy.sh`

#### 其他部署方式

请参考 [SETUP.md](SETUP.md) 了解手动部署步骤。

## 功能特性

- ASIN 管理和监控
- 变体组管理
- 监控历史记录
- 数据分析
- 用户权限管理
- 操作审计日志
- 飞书通知集成
- Amazon SP-API 集成

## 文档

- [项目状态](PROJECT-STATUS.md)
- [数据库连接配置](DATABASE-CONNECTION.md)
- [用户认证指南](USER-AUTH-GUIDE.md)
- [故障排查](TROUBLESHOOTING.md)
- [SP-API 设置](server/SP-API-SETUP.md)
- [调度器指南](server/SCHEDULER-GUIDE.md)

## Redis 验证脚本

项目根目录提供 `scripts/check-redis.js` 验证脚本，可以确认 Redis 与 Bull 队列是否连通：

```bash
npm run check-redis -- redis://127.0.0.1:6379
```

如果不传参数，会自动读取 `REDIS_URL`/`REDIS_URI` 环境变量，或者回退到 `redis://127.0.0.1:6379`。脚本会输出 ping、Redis 版本、队列状态和最近失败任务，便于在本地开发时验证 Redis 服务是否可用。
