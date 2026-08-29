# 数据库迁移操作手册

本仓库没有自动 migration runner，也没有 `schema_migrations` 表。`active/` 必须按下列顺序逐个、人工审查执行；`legacy/` 仅供追溯，完整清单和原文件 SHA-256 见 [`migrations/legacy/MANIFEST.md`](./migrations/legacy/MANIFEST.md)。

## 固定顺序

| 顺序 | 文件 | 目标 | 主要变更与风险 |
| --- | --- | --- | --- |
| 1 | `20260829_001_main_asin_extensions.sql` | 主营 | 条件化纳入 18 个字段，单次 ALTER 规范 `asin_note`、`parent_title` 为 NULL |
| 2 | `20260829_002_main_indexes.sql` | 主营 | 清理重复签名并在线补父体、历史、聚合和用户索引；大表建索引耗时较长 |
| 3 | `20260829_003_main_history_fk_cleanup.sql` | 主营 | 每批 10000 行回填身份快照，完整性通过后删除历史实体外键 |
| 4 | `20260829_004_competitor_reconcile.sql` | 竞品 | 回填快照、移除历史外键；无重复数据时把唯一键改为 `(asin,country)` |
| 5 | `20260829_005_normalize_collation.sql` | 两库 | 只转换 21+4 张 canonical 表到 `utf8mb4_0900_ai_ci`；可能重建表 |

所有 active 脚本使用 `information_schema` 判断并可重复执行。索引和约束 DDL 明确请求 `LOCK=NONE`；当前 MySQL/表结构不支持在线执行时应直接失败，禁止删除在线选项后在生产静默重试。字符集转换通常需要重建表，不承诺无锁执行，只能在已验证时长的维护窗口运行。

## 维护窗口流程

1. 固定部署提交并确认目标库名，暂停会修改相关表的写入任务。
2. 分别执行一致性备份，并验证备份可以恢复。

   ```bash
   git rev-parse HEAD
   mysqldump --single-transaction --routines --triggers -u <user> -p amazon_asin_monitor > main_before_schema.sql
   mysqldump --single-transaction --routines --triggers -u <user> -p amazon_competitor_monitor > competitor_before_schema.sql
   ```

3. 把备份恢复到隔离的 MySQL 8 测试实例。先执行下方预检，再依序执行五个文件两次，记录每个 ALTER 的耗时、metadata lock 等待、临时磁盘、复制延迟和业务查询影响。
4. 生产维护窗口逐文件执行；任一语句失败立即停止，不把重复列/索引等错误视为成功。MySQL DDL 通常隐式提交，不能依赖事务整体回滚。

   ```bash
   mysql --show-warnings --default-character-set=utf8mb4 -u <user> -p < server/database/migrations/active/<specific-file.sql>
   ```

5. 执行只读审计与应用回归。审计为 `ok` 后再恢复写入任务。

## 必做预检

```sql
SELECT TABLE_SCHEMA, TABLE_NAME, ENGINE, TABLE_COLLATION, TABLE_ROWS
FROM information_schema.TABLES
WHERE TABLE_SCHEMA IN ('amazon_asin_monitor', 'amazon_competitor_monitor');

SELECT asin, country, COUNT(*) AS duplicates
FROM amazon_competitor_monitor.competitor_asins
GROUP BY asin, country HAVING COUNT(*) > 1;

SELECT COUNT(*) AS missing_identity_snapshot
FROM amazon_asin_monitor.monitor_history
WHERE (variant_group_id IS NOT NULL AND variant_group_name IS NULL)
   OR (asin_id IS NOT NULL AND asin_code IS NULL)
   OR (asin_id IS NOT NULL AND site_snapshot IS NULL)
   OR (asin_id IS NOT NULL AND brand_snapshot IS NULL);

SELECT COUNT(*) AS missing_identity_snapshot
FROM amazon_competitor_monitor.competitor_monitor_history
WHERE (variant_group_id IS NOT NULL AND variant_group_name IS NULL)
   OR (asin_id IS NOT NULL AND asin_code IS NULL);
```

还必须使用 `SHOW INDEX` 检查同签名索引、使用 `information_schema.KEY_COLUMN_USAGE` 检查历史外键，并确认大表有足够磁盘空间。迁移 003/004 在无法从当前实体补齐身份快照时会主动失败，必须先定位孤儿历史，不得绕过验证。

## 验证

```bash
npm --prefix server run db:schema:audit -- --target=all --json
npm run test:contracts
npm --prefix server run test:unit
npx --no-install tsc --noEmit --pretty false
npm run build
git diff --check
```

同时验证 init 在空库连续执行两次、active 五个迁移在恢复库连续执行两次、历史记录在删除当前 ASIN/变体组后仍可查询，并检查应用启动日志未出现 DDL。

## 回滚

- 001/002/005 属于结构重建或索引变更，回滚以已验证备份恢复或经审查的反向 DDL 为准。
- 003/004 删除外键前已保留身份快照；如业务必须恢复外键，先清理孤儿引用，再用 `SHOW CREATE TABLE` 记录的名称和规则重新创建。
- 004 唯一键回滚为单列 `asin` 前，必须先证明跨国家没有重复 ASIN，否则会失败或丢失合法数据。
- 任何失败都保留日志、耗时与 `SHOW CREATE TABLE` 结果；不要直接执行 `legacy/` 猜测修复。
