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

## 验证清单

- `SHOW TABLES` 与当前初始化 SQL 中的目标表一致。
- `SHOW CREATE TABLE` 确认新增列类型、默认值、生成列和外键符合预期。
- `SHOW INDEX` 确认候选索引存在且没有意外重复索引。
- 登录、定时监控、竞品监控、数据分析和备份配置可正常访问。
- 服务端日志没有 `Unknown column`、`Table doesn't exist` 或聚合刷新失败。
- 完成 `npm run test:contracts`、TypeScript 检查、构建和 `git diff --check`。
