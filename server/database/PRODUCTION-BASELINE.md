# 生产结构基线（脱敏）

记录日期：2026-08-29。本文只包含结构元数据和取舍，不包含主机、账号、连接串、业务数据或原始 binlog SQL。

## 对比范围与结论

- 主营生产库共观察到 89 张表；canonical 仅保留应用使用的 21 张。其余 68 张 `*_bak_*`、`op_*` 等运维/备份表不纳入 init，也不由 schema 审计报告为漂移。
- 竞品库 canonical 为 4 张表。
- 两库 canonical 引擎为 InnoDB，字符集/排序规则统一为 MySQL 8 的 `utf8mb4_0900_ai_ci`。
- `asins` canonical 为 40 列：原仓库 22 列，加上生产有效的 18 个采集/父体扩展列。
- 本仓库从本次变更起是这 18 个字段的唯一 DDL 所有者；其他采集系统只维护字段数据。

## 18 个扩展字段

`variant_group`、`asin_note`、`latest_rating`、`latest_rating_count`、`previous_rating`、`previous_rating_count`、`last_collection_status`、`last_error_code`、`last_error_message`、`last_collected_at`、`enabled`、`deleted`、`created_by`、`parent_asin`、`parent_title`、`parent_query_status`、`parent_query_error`、`parent_queried_at`。

其中 `asin_note`、`parent_title` 明确定义为 `TEXT NULL DEFAULT NULL`。其余列采用对比时的生产类型和可安全导入的默认值。扩展列进入 DDL，但本次不扩大现有 ASIN API 返回结构。

## 索引、外键与唯一键取舍

- 吸收生产有效的父体查询索引、6 个 `monitor_history` 查询索引、两个聚合 covering 索引，并保留代码实际使用的 `users.idx_status`。
- 不保留生产重复签名 `idx_asins_asin`、`idx_asins_variant_group_id`，也从 canonical 移除两组旧聚合重复索引。
- 主营与竞品历史表依靠身份快照独立保存，不保留指向当前 ASIN/变体组的外键；当前实体删除后历史仍须可查询。
- 竞品 ASIN 使用 `(asin,country)` 复合唯一键，不沿用生产的单列 `asin` 唯一旧结构。

## DDL 来源证据

生产 MySQL 启用了约 30 天、约 6 GB 的 binlog 保留；未启用 general log，也未发现数据库审计插件。最近 binlog 已确认两次人工结构修改，分别把 `asins.asin_note` 和 `asins.parent_title` 改为允许 NULL，这与两次失败导入后的人工修正一致。

18 个字段最初的 `ADD COLUMN` 操作者仍是非阻塞审计项。如需继续追查，只能在数据库主机用原生 `mysqlbinlog` 定向搜索 `ALTER TABLE asins`，并结合数据库审计日志或部署记录；不得把原始 binlog 或业务 SQL 提交到仓库。MySQL 默认不会保存完整 DDL 历史。
