# 已有数据库升级指南

本仓库没有自动迁移执行器，也没有记录已执行版本的 `schema_migrations` 表。`migrations/` 中的文件是历史补丁，存在编号重用、一次性 DDL 和数据回填，不能按文件名通配或仅按编号全部执行。

## 升级流程

1. 记录当前部署提交，并分别备份主营库和竞品库。

   ```bash
   git rev-parse HEAD
   mysqldump --single-transaction --routines --triggers -u root -p amazon_asin_monitor > amazon_asin_monitor_before_upgrade.sql
   mysqldump --single-transaction --routines --triggers -u root -p amazon_competitor_monitor > amazon_competitor_monitor_before_upgrade.sql
   ```

2. 把备份恢复到测试实例。所有候选迁移先在测试实例执行并记录耗时、锁表影响和行数变化。
3. 若已知当前部署提交，用以下命令找出候选文件；候选文件仍需结合实际 schema 审查。

   ```bash
   git diff --name-only <deployed-commit>..origin/main -- server/database/migrations
   ```

4. 使用 `SHOW CREATE TABLE`、`SHOW INDEX` 和 `INFORMATION_SCHEMA` 对照初始化 SQL 及候选迁移。确认目标列、索引或表不存在，并检查迁移依赖的前置结构。
5. 每次只执行一个经过确认的文件。脚本内含固定 `USE`，执行前必须核对目标数据库名。

   ```bash
   mysql --show-warnings --default-character-set=utf8mb4 -u root -p < server/database/migrations/<specific-file.sql>
   ```

6. 任一语句报错都应立即停止并检查实际 schema。不要把“重复列/索引”错误当作成功后继续执行后续文件；MySQL DDL 通常会隐式提交，不能依赖事务整体回滚。
7. 复核表结构、索引、关键数据量和应用日志，再运行项目基线检查。聚合结构发生变化后，按维护窗口执行：

   ```bash
   npm --prefix server run rebuild:agg -- --yes --backup
   ```

## 编号与兼容性警告

- `013`、`021`、`030` 均被不同迁移重复使用，编号不是唯一版本标识；始终使用完整文件名。
- 当前 `021` 聚合建表脚本已经包含 `has_peak`。只有旧库的聚合表缺少该列时才执行 `022`；把当前两个文件连续执行会触发重复列错误。
- 标记为“一次性”的脚本通常含无条件 `ADD COLUMN` 或 `ADD INDEX`，部分执行后再次运行也可能失败。
- 删除、约束调整和大表回填必须在备份及测试实例验证后执行，并预留锁表和重建索引时间。

## 迁移目录

| 文件 | 目标数据库 | 用途 | 重复执行与主要风险 |
| --- | --- | --- | --- |
| `001_add_asin_type.sql` | 主营 | 移除旧类型列并添加 `asin_type` | 一次性；删除旧列 |
| `002_add_monitor_fields.sql` | 主营 | 添加 ASIN 检查时间和通知字段 | 一次性 DDL |
| `003_add_site_and_brand.sql` | 主营 | 为变体组和 ASIN 添加站点、品牌 | 一次性；旧数据与非空列需先验证 |
| `004_add_user_auth_tables.sql` | 主营 | 创建用户、角色和权限基础表 | 基本幂等；需核对旧用户表结构 |
| `005_remove_batch_tables.sql` | 主营 | 删除旧批次表 | 可重复执行但会永久删除表和数据 |
| `006_add_audit_log_table.sql` | 主营 | 创建审计日志表 | 幂等建表 |
| `008_add_monitor_history_index.sql` | 主营 | 添加国家与检查时间索引 | 一次性索引 |
| `009_remove_user_email_and_reset_table.sql` | 主营 | 删除邮箱列与密码重置表 | 一次性且会删除数据 |
| `010_add_sessions_table.sql` | 主营 | 创建登录会话表 | 幂等建表 |
| `011_add_variant_group_fields.sql` | 主营 | 添加变体组检查时间和通知字段 | 一次性 DDL |
| `012_add_composite_indexes.sql` | 主营 | 添加业务查询复合索引 | 一次性索引 |
| `013_add_competitor_variant_group_fields.sql` | 竞品 | 添加竞品变体组检查时间 | 一次性 DDL |
| `013_add_password_security_tables.sql` | 主营 | 创建密码安全表并补用户安全字段 | 条件化补列；先核对 `users.status` |
| `014_add_granular_permissions.sql` | 主营 | 补充细粒度权限与角色授权 | 幂等 upsert |
| `015_change_asin_unique_to_composite.sql` | 主营 | 把 ASIN 唯一键改为 ASIN+国家 | 一次性；重复数据会导致建索引失败 |
| `016_add_snapshot_fields_to_monitor_history.sql` | 主营 | 添加历史快照列并回填 | 一次性；大表更新 |
| `017_optimize_monitor_history_indexes.sql` | 主营 | 添加历史查询索引 | 一次性索引 |
| `018_add_analytics_query_index.sql` | 主营 | 添加分析查询索引 | 一次性索引 |
| `019_add_backup_config_table.sql` | 主营 | 创建自动备份配置 | 幂等建表与默认数据 |
| `020_add_status_change_indexes.sql` | 主营 | 添加状态变化查询索引 | 一次性索引 |
| `021_add_monitor_history_agg_table.sql` | 主营 | 创建基础历史聚合表 | 幂等建表；当前定义已含 `has_peak` |
| `021_optimize_variant_group_indexes.sql` | 主营 | 添加变体组和 ASIN 查询索引 | 一次性索引 |
| `022_add_monitor_history_agg_peak.sql` | 主营 | 为旧聚合表补 `has_peak` | 一次性；当前 `021` 后不可再执行 |
| `023_add_analytics_fastpath.sql` | 主营 | 添加历史维度快照、生成列和维度聚合表 | 一次性；历史回填和索引重建 |
| `024_fix_missing_password_security_schema.sql` | 主营 | 幂等补齐密码安全 schema | 可重复执行；仍需确认外键前置表 |
| `025_add_manual_variant_flags.sql` | 主营 | 添加人工异常标记 | 一次性 DDL |
| `026_normalize_user_status_and_audit_permissions.sql` | 主营 | 规范用户状态并补角色、审计权限 | 条件化迁移；会改写用户状态 |
| `027_normalize_competitor_schema.sql` | 竞品 | 创建或补齐旧竞品 schema | 基本幂等；会规范状态数据 |
| `028_add_variant_group_agg_table.sql` | 主营 | 创建变体组维度聚合表 | 幂等建表；完成后重建聚合数据 |
| `029_add_asin_group_manual_exclusion.sql` | 主营 | 添加人工排除父变体字段 | 一次性 DDL |
| `030_add_analytics_rollup_and_status_interval.sql` | 主营 | 增加月聚合、水位和状态区间表 | 一次性；依赖此前聚合表 |
| `030_optimize_batch_delete_history_fks.sql` | 主营与竞品 | 回填竞品历史快照并移除历史外键 | 条件化；大表回填和约束变更 |
| `031_optimize_analytics_refresh_indexes.sql` | 主营 | 补充分析刷新索引 | 幂等条件索引 |
| `032_add_feishu_emergency.sql` | 主营 | 添加飞书电话加急配置和 UTC 冷却时间 | 幂等条件补列；上线应用前执行，不覆盖已有通知规则 |
| `033_add_variant_split_tracking.sql` | 主营 | 创建变体组拆分基准和新增拆分事件表 | 幂等建表；上线应用前执行，无外键、不回填旧异常；首次监控仅建立基准 |

## 变体组新增拆分告警升级说明

执行目录中的 033 迁移后再上线应用。电话加急阈值改为时间窗口内从正常转为拆分的不同变体组数，同组多个 ASIN 或持续异常只计一组；已用于电话加急的事件不重复拨打。

新状态表不从历史异常回填。首次取得可信 SP-API 关系只建立状态和原父体基准，已有异常不会立即生成新增事件；只有全组已确认正常后再次失去关系，或成功查询确认当前父 ASIN 标题为空，才生成新增健康异常事件。改挂其他有效父体且当前标题正常时，当前关系健康状态为正常；历史父体变化独立记录，原父体基准固定，变更后的父体不会自动取代原基准。人工标记、API 错误和父体标题查询失败不属于新增拆分事件。增删或移动成员的当轮不生成新增健康异常事件，以防编辑动作造成误报；已有成员可信的父体迁移仍独立写入审计。

父体空标题判断复用 033 的状态和事件存储，无需新增迁移或回填。已有基准首次取得标题结果时只建立标题基准，不把存量空标题追溯为新增事件；已有正常标题随后成功确认为空，才参与正常转异常的组级判断。查询失败、超时或返回不存在均暂不判定，也不解除已确认的标题异常。群卡片以 `PARENT_TITLE_EMPTY` 展示成功确认的空标题信号。

历史父体与当前健康状态拆分同样无需新增 SQL 迁移或回填。`members` JSON 中的 `parentHistory` 独立保留 `UNKNOWN` / `UNCHANGED` / `CHANGED` 状态，以及原父体、最近确认的父体、上次父体、最近变化和观测时间；一旦观察到变化，回到原父体也不清除 `CHANGED`。旧版仅因 `PARENT_CHANGED` 保持异常的成员将在下一次可信监控后按当前关系和标题重新确认健康状态，不能通过清空原父体或删除审计来恢复。父体变化审计仍以 `PARENT_CHANGED` 写入现有事件表，但电话评估、抢占复核和事件消费均只接受 `RELATIONSHIP_LOST` / `PARENT_TITLE_EMPTY`，因此升级前已开启通知的父体变化事件也不会触发或消费电话加急。

`occurred_at` 使用与监控窗口一致的北京时间，`phone_attempted_at` 使用 UTC。发布后核对两张新表结构和索引，观察首次监控完成后状态表有数据、事件表未把旧异常批量写入。回滚应用无需删除新表；保留数据便于再次升级，勿清空状态表后期待保留原父体基准。

## 验证清单

- `SHOW TABLES` 与当前初始化 SQL 中的目标表一致。
- `SHOW CREATE TABLE` 确认新增列类型、默认值、生成列和外键符合预期。
- `SHOW INDEX` 确认候选索引存在且没有意外重复索引。
- 登录、定时监控、竞品监控、数据分析和备份配置可正常访问。
- 服务端日志没有 `Unknown column`、`Table doesn't exist` 或聚合刷新失败。
- 完成 `npm run test:contracts`、TypeScript 检查、构建和 `git diff --check`。
