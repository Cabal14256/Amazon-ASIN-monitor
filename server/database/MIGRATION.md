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
| 6 | `20260930_006_feishu_emergency.sql` | 主营 | 条件化新增电话加急配置与 UTC 冷却时间，保留已有通知规则 |
| 7 | `20260930_007_variant_split_tracking.sql` | 主营 | 幂等创建健康基准与事件表，不回填存量异常 |
| 8 | `20261011_008_import_confirmation_receipts.sql` | 两库 | 幂等创建增量导入事务回执，分别保存在对应业务库 |

所有 active 脚本使用 `information_schema` 判断并可重复执行。索引和约束 DDL 明确请求 `LOCK=NONE`；当前 MySQL/表结构不支持在线执行时应直接失败，禁止删除在线选项后在生产静默重试。字符集转换通常需要重建表，不承诺无锁执行，只能在已验证时长的维护窗口运行。

## 维护窗口流程

1. 固定部署提交并确认目标库名，暂停会修改相关表的写入任务。
2. 分别执行一致性备份，并验证备份可以恢复。

   ```bash
   git rev-parse HEAD
   mysqldump --single-transaction --routines --triggers -u <user> -p amazon_asin_monitor > main_before_schema.sql
   mysqldump --single-transaction --routines --triggers -u <user> -p amazon_competitor_monitor > competitor_before_schema.sql
   ```

3. 把备份恢复到隔离的 MySQL 8 测试实例。先执行下方预检，再依序执行全部 active 文件两次，记录每个 ALTER 的耗时、metadata lock 等待、临时磁盘、复制延迟和业务查询影响。
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

同时验证 init 在空库连续执行两次、全部 active 迁移在恢复库连续执行两次、历史记录在删除当前 ASIN/变体组后仍可查询，并检查应用启动日志未出现 DDL。

## 回滚

- 001/002/005 属于结构重建或索引变更，回滚以已验证备份恢复或经审查的反向 DDL 为准。
- 003/004 删除外键前已保留身份快照；如业务必须恢复外键，先清理孤儿引用，再用 `SHOW CREATE TABLE` 记录的名称和规则重新创建。
- 004 唯一键回滚为单列 `asin` 前，必须先证明跨国家没有重复 ASIN，否则会失败或丢失合法数据。
- 任何失败都保留日志、耗时与 `SHOW CREATE TABLE` 结果；不要直接执行 `legacy/` 猜测修复。

## 变体组新增拆分告警升级说明

执行固定顺序中的健康跟踪迁移后再上线应用。电话加急阈值改为时间窗口内从正常转为拆分的不同变体组数，同组多个 ASIN 或持续异常只计一组；已用于电话加急的事件不重复拨打。

新状态表不从历史异常回填。首次取得可信 SP-API 关系只建立状态和原父体基准，已有异常不会立即生成新增事件；只有全组已确认正常后再次失去关系，或成功查询确认当前父 ASIN 标题为空，才生成新增健康异常事件。改挂其他有效父体且当前标题正常时，当前关系健康状态为正常；历史父体变化独立记录，原父体基准固定，变更后的父体不会自动取代原基准。人工标记、API 错误和父体标题查询失败不属于新增拆分事件。增删或移动成员的当轮不生成新增健康异常事件，以防编辑动作造成误报；已有成员可信的父体迁移仍独立写入审计。

父体空标题判断复用健康跟踪迁移的状态和事件存储，无需新增迁移或回填。已有基准首次取得标题结果时只建立标题基准，不把存量空标题追溯为新增事件；已有正常标题随后成功确认为空，才参与正常转异常的组级判断。查询失败、超时或返回不存在均暂不判定，也不解除已确认的标题异常。群卡片以 `PARENT_TITLE_EMPTY` 展示成功确认的空标题信号。

历史父体与当前健康状态拆分同样无需新增 SQL 迁移或回填。`members` JSON 中的 `parentHistory` 独立保留 `UNKNOWN` / `UNCHANGED` / `CHANGED` 状态，以及原父体、最近确认的父体、上次父体、最近变化和观测时间；一旦观察到变化，回到原父体也不清除 `CHANGED`。旧版仅因 `PARENT_CHANGED` 保持异常的成员将在下一次可信监控后按当前关系和标题重新确认健康状态，不能通过清空原父体或删除审计来恢复。父体变化审计仍以 `PARENT_CHANGED` 写入现有事件表，但电话评估、抢占复核和事件消费均只接受 `RELATIONSHIP_LOST` / `PARENT_TITLE_EMPTY`，因此升级前已开启通知的父体变化事件也不会触发或消费电话加急。

`occurred_at` 使用与监控窗口一致的北京时间，`phone_attempted_at` 使用 UTC。发布后核对两张新表结构和索引，观察首次监控完成后状态表有数据、事件表未把旧异常批量写入。回滚应用无需删除新表；保留数据便于再次升级，勿清空状态表后期待保留原父体基准。

## 增量导入升级说明

先完成前述固定迁移链，再上线增量导入 API 和 Worker。事务回执表在主营和竞品库分别创建；自定义库名需审查并替换脚本中的两个目标库。旧流程无需删除回执；回滚应用时保留回执数据。
