# 数据库迁移说明

本文档详细说明所有数据库迁移脚本的用途、执行方式和注意事项。

## 迁移脚本列表

| 版本 | 文件名 | 说明 | 状态 |
| --- | --- | --- | --- |
| 001 | `001_add_asin_type.sql` | 添加 ASIN 类型字段 | ✅ 已整合到 init.sql |
| 002 | `002_add_monitor_fields.sql` | 添加监控更新时间和飞书通知字段 | ✅ 已整合到 init.sql |
| 003 | `003_add_site_and_brand.sql` | 添加站点和品牌字段 | ✅ 已整合到 init.sql |
| 004 | `004_add_user_auth_tables.sql` | 添加用户认证和权限管理表 | ✅ 已整合到 init.sql |
| 005 | `005_remove_batch_tables.sql` | 删除批次管理相关表 | ⚠️ 仅用于升级 |
| 006 | `006_add_audit_log_table.sql` | 添加操作审计日志表 | ✅ 已整合到 init.sql |
| 008 | `008_add_monitor_history_index.sql` | 添加监控历史联合索引 | ✅ 已整合到 init.sql |
| 009 | `009_remove_user_email_and_reset_table.sql` | 移除用户表邮箱字段和密码重置表 | ⚠️ 仅用于升级 |
| 010 | `010_add_sessions_table.sql` | 添加多设备会话记录表 | ✅ 已整合到 init.sql |
| 011 | `011_add_variant_group_fields.sql` | 为变体组表添加监控字段 | ✅ 已整合到 init.sql |
| 012 | `012_add_composite_indexes.sql` | 添加复合索引优化查询性能 | ✅ 已整合到 init.sql |
| 013 | `013_add_competitor_variant_group_fields.sql` | 为竞品变体组表添加监控字段 | ?? 仅用于升级 |
| 016 | `016_add_snapshot_fields_to_monitor_history.sql` | 为监控历史表补充快照字段 | ✅ 已整合到 init.sql |
| 017 | `017_optimize_monitor_history_indexes.sql` | 优化监控历史表索引 | ✅ 已整合到 init.sql |
| 018 | `018_add_analytics_query_index.sql` | 添加数据分析查询索引 | ✅ 已整合到 init.sql |
| 020 | `020_add_status_change_indexes.sql` | 添加状态变化查询索引 | ✅ 已整合到 init.sql |
| 021 | `021_add_monitor_history_agg_table.sql` | 添加监控历史聚合表 | ✅ 已整合到 init.sql |
| 022 | `022_add_monitor_history_agg_peak.sql` | 聚合表补充高峰期字段 | ✅ 已整合到 init.sql |

> **注意**: 所有标记为 "✅ 已整合到 init.sql" 的迁移脚本，其功能已包含在 `init.sql` 中。新安装系统时直接使用 `init.sql` 即可，无需执行这些迁移脚本。竞品数据库相关的迁移脚本已整合到 `competitor-init.sql`。

---

## 迁移脚本详细说明

### 001: 添加 ASIN 类型字段

**文件**: `001_add_asin_type.sql`

**说明**: 为 ASIN 表添加类型字段（主链/副评），替代之前的 main_link 和 sub_review 字段。

**变更内容**:

- 删除 `main_link` 和 `sub_review` 字段（如果存在）
- 添加 `asin_type` 字段：`VARCHAR(20)`，可选值：`MAIN_LINK`（主链）、`SUB_REVIEW`（副评）
- 添加索引 `idx_asin_type`

**执行方式**:

```bash
mysql -u root -p amazon_asin_monitor < server/database/migrations/001_add_asin_type.sql
```

---

### 002: 添加监控更新时间和飞书通知字段

**文件**: `002_add_monitor_fields.sql`

**说明**: 为 ASIN 表添加监控更新时间和飞书通知开关字段。

**变更内容**:

- 添加 `last_check_time` 字段：`DATETIME`，记录上一次检查的时间
- 添加 `feishu_notify_enabled` 字段：`TINYINT(1)`，默认值为 1（开启）
- 添加索引 `idx_last_check_time` 和 `idx_feishu_notify_enabled`

**执行方式**:

```bash
mysql -u root -p amazon_asin_monitor < server/database/migrations/002_add_monitor_fields.sql
```

---

### 003: 添加站点和品牌字段

**文件**: `003_add_site_and_brand.sql`

**说明**: 为变体组表和 ASIN 表添加站点和品牌字段。

**变更内容**:

- 为 `variant_groups` 表添加 `site` 和 `brand` 字段（必填）
- 为 `asins` 表添加 `site` 和 `brand` 字段（必填）
- 添加相应索引

**字段说明**:

- `site`: 内部店铺代号（如：12, 15, 20），不是 Amazon 站点信息
- `brand`: 产品品牌名称（如：Apple, Samsung, Sony）

**执行方式**:

```bash
mysql -u root -p amazon_asin_monitor < server/database/migrations/003_add_site_and_brand.sql
```

---

### 004: 添加用户认证和权限管理表

**文件**: `004_add_user_auth_tables.sql`

**说明**: 为系统添加用户认证、角色管理和权限控制功能。

**变更内容**:

- 创建 `users` 表（用户表）
- 创建 `roles` 表（角色表）
- 创建 `permissions` 表（权限表）
- 创建 `user_roles` 表（用户角色关联表）
- 创建 `role_permissions` 表（角色权限关联表）
- 插入默认角色：READONLY（只读用户）、EDITOR（编辑用户）、ADMIN（管理员）
- 插入默认权限和角色权限关联

**执行方式**:

```bash
mysql -u root -p amazon_asin_monitor < server/database/migrations/004_add_user_auth_tables.sql
```

---

### 005: 删除批次管理相关表

**文件**: `005_remove_batch_tables.sql`

**说明**: 删除批次管理功能相关的表（批次管理功能已不再需要）。

**变更内容**:

- 删除 `batch_variant_groups` 表（批次变体组关联表）
- 删除 `batches` 表（批次表）

**注意事项**:

- ⚠️ 执行前请备份数据库
- ⚠️ 删除操作不可逆，请确认后再执行
- ⚠️ 如果表中有数据，删除前请先导出备份

**执行方式**:

```bash
mysql -u root -p amazon_asin_monitor < server/database/migrations/005_remove_batch_tables.sql
```

---

### 006: 添加操作审计日志表

**文件**: `006_add_audit_log_table.sql`

**说明**: 记录用户的所有操作，用于审计和追踪。

**变更内容**:

- 创建 `audit_logs` 表
- 记录字段包括：用户信息、操作类型、资源信息、请求信息、响应状态等
- 添加相关索引优化查询

**执行方式**:

```bash
mysql -u root -p amazon_asin_monitor < server/database/migrations/006_add_audit_log_table.sql
```

---

### 008: 添加监控历史联合索引

**文件**: `008_add_monitor_history_index.sql`

**说明**: 为监控历史表添加国家+检查时间的联合索引，优化查询性能。

**变更内容**:

- 添加索引 `idx_country_check_time` (`country`, `check_time`)

**执行方式**:

```bash
mysql -u root -p amazon_asin_monitor < server/database/migrations/008_add_monitor_history_index.sql
```

---

### 009: 移除用户表邮箱字段和密码重置表

**文件**: `009_remove_user_email_and_reset_table.sql`

**说明**: 取消邮箱字段与相关功能，简化用户模型。

**变更内容**:

- 删除 `users.email` 字段
- 删除 `password_reset_tokens` 表（如果存在）

**执行方式**:

```bash
mysql -u root -p amazon_asin_monitor < server/database/migrations/009_remove_user_email_and_reset_table.sql
```

---

### 010: 添加多设备会话记录表

**文件**: `010_add_sessions_table.sql`

**说明**: 为系统添加多设备登录会话管理功能。

**变更内容**:

- 创建 `sessions` 表
- 支持多设备同时登录
- 支持会话状态管理（ACTIVE/REVOKED）
- 支持记住我功能

**执行方式**:

```bash
mysql -u root -p amazon_asin_monitor < server/database/migrations/010_add_sessions_table.sql
```

---

### 011: 为变体组表添加监控字段

**文件**: `011_add_variant_group_fields.sql`

**说明**: 为变体组表添加监控更新时间和飞书通知开关字段。

**变更内容**:

- 添加 `last_check_time` 字段：`DATETIME`，记录上一次检查的时间
- 添加 `feishu_notify_enabled` 字段：`TINYINT(1)`，默认值为 1（开启）
- 添加相应索引

**执行方式**:

```bash
mysql -u root -p amazon_asin_monitor < server/database/migrations/011_add_variant_group_fields.sql
```

---

### 012: 添加复合索引优化查询性能

**文件**: `012_add_composite_indexes.sql`

**说明**: 为频繁查询的字段组合添加复合索引，提升查询性能。

**变更内容**:

- 为 `asins` 表添加 `idx_variant_group_country_broken` 索引
- 为 `monitor_history` 表添加 `idx_variant_group_check_time_broken` 索引
- 为 `monitor_history` 表添加 `idx_country_check_time_broken` 索引
- 为 `variant_groups` 表添加 `idx_country_broken` 索引

**执行方式**:

```bash
mysql -u root -p amazon_asin_monitor < server/database/migrations/012_add_composite_indexes.sql
```

---

### 013: 为竞品变体组表添加监控字段

**文件**: `013_add_competitor_variant_group_fields.sql`

**说明**: 为竞品数据库的 `competitor_variant_groups` 表添加监控更新时间字段。

**变更内容**:

- 添加 `last_check_time` 字段：`DATETIME`，记录上一次检查的时间
- 添加索引 `idx_last_check_time`

**执行方式**:

```bash
mysql -u root -p amazon_competitor_monitor < server/database/migrations/013_add_competitor_variant_group_fields.sql
```

---

### 016: 为监控历史表补充快照字段

**文件**: `016_add_snapshot_fields_to_monitor_history.sql`

**说明**: 为监控历史表添加名称/编码快照字段，便于历史回溯与统计。

**变更内容**:

- 添加 `variant_group_name`、`asin_code`、`asin_name` 等快照字段
- 回填已有数据快照（基于关联表）

**执行方式**:

```bash
mysql -u root -p amazon_asin_monitor < server/database/migrations/016_add_snapshot_fields_to_monitor_history.sql
```

---

### 017: 优化监控历史表索引

**文件**: `017_optimize_monitor_history_indexes.sql`

**说明**: 根据常见查询模式添加复合索引，提高统计与筛选性能。

**变更内容**:

- 添加 `idx_check_time_country_broken` 索引
- 添加 `idx_asin_code_country_check_time` 索引

**执行方式**:

```bash
mysql -u root -p amazon_asin_monitor < server/database/migrations/017_optimize_monitor_history_indexes.sql
```

---

### 018: 添加数据分析查询索引

**文件**: `018_add_analytics_query_index.sql`

**说明**: 针对数据分析统计查询添加复合索引。

**变更内容**:

- 添加 `idx_country_time_broken_asin` 索引

**执行方式**:

```bash
mysql -u root -p amazon_asin_monitor < server/database/migrations/018_add_analytics_query_index.sql
```

---

### 020: 添加状态变化查询索引

**文件**: `020_add_status_change_indexes.sql`

**说明**: 为状态变化窗口函数查询添加索引。

**变更内容**:

- 添加 `idx_asin_country_check_time_broken` 索引
- 确保 `idx_asin_id` 索引存在

**执行方式**:

```bash
mysql -u root -p amazon_asin_monitor < server/database/migrations/020_add_status_change_indexes.sql
```

---

### 021: 添加监控历史聚合表

**文件**: `021_add_monitor_history_agg_table.sql`

**说明**: 创建预聚合表，用于加速数据分析汇总接口。

**变更内容**:

- 新增 `monitor_history_agg` 表
- 按 `granularity + time_slot + country + asin_key` 作为主键

**执行方式**:

```bash
mysql -u root -p amazon_asin_monitor < server/database/migrations/021_add_monitor_history_agg_table.sql
```

---

### 022: 聚合表补充高峰期字段

**文件**: `022_add_monitor_history_agg_peak.sql`

**说明**: 为聚合表补充 `has_peak` 字段，用于 period-summary 统计加速。

**变更内容**:

- 添加 `has_peak` 字段

**执行方式**:

```bash
mysql -u root -p amazon_asin_monitor < server/database/migrations/022_add_monitor_history_agg_peak.sql
```

---

## 迁移执行顺序

如果您的数据库是从旧版本升级，请按以下顺序执行迁移脚本：

```bash
# 1. 备份数据库（重要！）
mysqldump -u root -p amazon_asin_monitor > backup_$(date +%Y%m%d_%H%M%S).sql

# 2. 按顺序执行迁移脚本
mysql -u root -p amazon_asin_monitor < server/database/migrations/001_add_asin_type.sql
mysql -u root -p amazon_asin_monitor < server/database/migrations/002_add_monitor_fields.sql
mysql -u root -p amazon_asin_monitor < server/database/migrations/003_add_site_and_brand.sql
mysql -u root -p amazon_asin_monitor < server/database/migrations/004_add_user_auth_tables.sql
mysql -u root -p amazon_asin_monitor < server/database/migrations/005_remove_batch_tables.sql
mysql -u root -p amazon_asin_monitor < server/database/migrations/006_add_audit_log_table.sql
mysql -u root -p amazon_asin_monitor < server/database/migrations/008_add_monitor_history_index.sql
mysql -u root -p amazon_asin_monitor < server/database/migrations/009_remove_user_email_and_reset_table.sql
mysql -u root -p amazon_asin_monitor < server/database/migrations/010_add_sessions_table.sql
mysql -u root -p amazon_asin_monitor < server/database/migrations/011_add_variant_group_fields.sql
mysql -u root -p amazon_asin_monitor < server/database/migrations/012_add_composite_indexes.sql
mysql -u root -p amazon_asin_monitor < server/database/migrations/016_add_snapshot_fields_to_monitor_history.sql
mysql -u root -p amazon_asin_monitor < server/database/migrations/017_optimize_monitor_history_indexes.sql
mysql -u root -p amazon_asin_monitor < server/database/migrations/018_add_analytics_query_index.sql
mysql -u root -p amazon_asin_monitor < server/database/migrations/020_add_status_change_indexes.sql
mysql -u root -p amazon_asin_monitor < server/database/migrations/021_add_monitor_history_agg_table.sql
mysql -u root -p amazon_asin_monitor < server/database/migrations/022_add_monitor_history_agg_peak.sql
```

竞品数据库迁移（如使用竞品监控功能）：

```bash
mysql -u root -p amazon_competitor_monitor < server/database/migrations/013_add_competitor_variant_group_fields.sql
```

> **注意**: 如果您的数据库已经包含某些迁移的变更，可以跳过对应的迁移脚本。

---

## 新安装推荐

对于全新安装，**强烈推荐直接使用 `init.sql`**，该文件已包含所有最新变更：

```bash
mysql -u root -p < server/database/init.sql
```

这样可以：

- 一步完成所有表结构创建
- 避免迁移脚本执行顺序问题
- 确保数据库结构完整一致
- 适合生产环境部署

---

## 注意事项

1. ⚠️ **执行前务必备份数据库**
2. ⚠️ **迁移脚本必须按版本号顺序执行**
3. ⚠️ **建议先在测试环境验证**
4. ✅ **新安装直接使用 `init.sql`，无需执行迁移脚本**
5. ✅ **`init.sql` 已包含所有最新字段、表和索引，适合生产环境部署**
