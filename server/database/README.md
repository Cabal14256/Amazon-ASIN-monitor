# 数据库结构基线

本目录是主营库与竞品库唯一的 DDL 定义来源，要求 MySQL 8.0+。采集器和其他应用只能读写数据，不得自行 `CREATE TABLE`、`ALTER TABLE` 或补索引。

## 文件职责

| 路径 | 用途 |
| --- | --- |
| `init.sql` | 主营库 `amazon_asin_monitor` 的 21 张 canonical 表 |
| `competitor-init.sql` | 竞品库 `amazon_competitor_monitor` 的 4 张 canonical 表 |
| `migrations/active/` | 现有环境按固定顺序人工审查执行的当前迁移 |
| `migrations/legacy/` | 原历史迁移的只读归档；不得作为连续迁移链执行 |
| `PRODUCTION-BASELINE.md` | 脱敏生产结构对比、取舍和 DDL 所有权记录 |
| `MIGRATION.md` | 备份、预检、执行、验证和回滚手册 |

两个 init 均固定使用 `utf8mb4_0900_ai_ci`，并在脚本内 `USE` 固定数据库名。环境变量不会改写 SQL 目标库；自定义库名必须复制并人工审查脚本，同时更新运行配置。

## 全新初始化

```bash
mysql --show-warnings --default-character-set=utf8mb4 -u root -p < server/database/init.sql
mysql --show-warnings --default-character-set=utf8mb4 -u root -p < server/database/competitor-init.sql
```

两个 init 使用 `CREATE TABLE IF NOT EXISTS` 和幂等种子写入，可在空库连续执行两次。不要对已有数据库重新执行初始化脚本来代替升级：已有表会被跳过，旧列、索引和外键不会被修正。

## 只读审计

```bash
npm --prefix server run db:schema:audit -- --target=all
npm --prefix server run db:schema:audit -- --target=all --json
```

npm 11 在部分 Windows 环境需要在参数前再加一个分隔符：`npm --prefix server run db:schema:audit -- -- --target=all --json`。

退出码：无差异为 `0`，结构漂移为 `1`，参数、配置或连接错误为 `2`。API 与 worker 启动时各审计一次并缓存结果，健康检查默认每 60 秒最多刷新一次（可通过 `SCHEMA_AUDIT_CACHE_TTL_MS` 调整），应用绝不自动执行 DDL；`/health` 会返回 `schema.status`、`schema.checkedAt`、主营/竞品状态及限量差异摘要。

已有数据库必须遵循 [MIGRATION.md](./MIGRATION.md)。生产 DDL 只能在独立维护窗口人工执行，本仓库合并或应用启动不会自动执行迁移。
