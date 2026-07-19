# 数据库初始化

本目录提供全新环境的数据库初始化脚本，以及已有数据库使用的历史迁移脚本。运行环境要求 MySQL 8.0+。

## 文件职责

| 路径 | 用途 |
| --- | --- |
| `init.sql` | 创建主营数据库 `amazon_asin_monitor` 及当前完整 schema |
| `competitor-init.sql` | 创建竞品数据库 `amazon_competitor_monitor` 及当前完整 schema |
| `migrations/` | 已有数据库的历史人工迁移脚本，不是可自动连续执行的迁移链 |
| `MIGRATION.md` | 已有数据库的备份、选取迁移、执行和验证指南 |

两个初始化脚本都写死了上表中的数据库名，并在脚本内部执行 `USE`。仅修改 `.env` 中的 `DB_NAME` 或 `COMPETITOR_DB_NAME` 不会改变 SQL 的执行目标；如需自定义数据库名，应先复制并审查 SQL，再同步修改运行配置。

## 全新安装

在仓库根目录执行：

```bash
mysql --default-character-set=utf8mb4 -u root -p < server/database/init.sql
mysql --default-character-set=utf8mb4 -u root -p < server/database/competitor-init.sql
```

运行配置应与初始化结果一致：

| 数据库 | 后端配置 |
| --- | --- |
| `amazon_asin_monitor` | `DB_HOST`、`DB_PORT`、`DB_USER`、`DB_PASSWORD`、`DB_NAME` |
| `amazon_competitor_monitor` | `COMPETITOR_DB_HOST`、`COMPETITOR_DB_PORT`、`COMPETITOR_DB_USER`、`COMPETITOR_DB_PASSWORD`、`COMPETITOR_DB_NAME` |

若明确设置 `COMPETITOR_MONITOR_ENABLED=false`，可以不初始化竞品库。启用竞品监控时，必须保证 `COMPETITOR_DB_*` 指向已初始化的竞品 schema；数据库中的系统配置可能覆盖同名环境变量。

## 初始化验证

```bash
mysql -u root -p -e "USE amazon_asin_monitor; SHOW TABLES;"
mysql -u root -p -e "USE amazon_competitor_monitor; SHOW TABLES;"
npm run test:init-schema
```

随后按根目录 README 创建管理员并启动后端，确认 `/health` 中数据库状态正常。

## 已有数据库

不要对已有数据库重新执行初始化脚本来代替升级。`CREATE TABLE IF NOT EXISTS` 只会跳过已经存在的表，不会为旧表补列、改索引或回填数据，因而可能留下代码无法使用的混合 schema。

已有数据库必须先备份，再按 [`MIGRATION.md`](./MIGRATION.md) 比对实际结构并逐个选择迁移。当前 schema 的唯一完整参考是 `init.sql` 与 `competitor-init.sql`，不要依赖手工维护的版本号或表清单。
