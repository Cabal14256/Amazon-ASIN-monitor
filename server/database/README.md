# 数据库文件说明

本目录包含 Amazon ASIN 监控系统的所有数据库相关文件。

## 目录结构

```
database/
├── init.sql                    # 完整的数据库初始化脚本（包含所有最新字段和表）
├── competitor-init.sql         # 竞品监控数据库初始化脚本
├── migrations/                # 数据库迁移脚本目录
│   ├── 001_add_asin_type.sql
│   ├── 002_add_monitor_fields.sql
│   ├── 003_add_site_and_brand.sql
│   ├── 004_add_user_auth_tables.sql
│   ├── 005_remove_batch_tables.sql
│   ├── 006_add_audit_log_table.sql
│   ├── 008_add_monitor_history_index.sql
│   ├── 009_remove_user_email_and_reset_table.sql
│   ├── 010_add_sessions_table.sql
│   ├── 011_add_variant_group_fields.sql
│   ├── 012_add_composite_indexes.sql
│   ├── 013_add_competitor_variant_group_fields.sql
│   ├── 016_add_snapshot_fields_to_monitor_history.sql
│   ├── 017_optimize_monitor_history_indexes.sql
│   ├── 018_add_analytics_query_index.sql
│   ├── 020_add_status_change_indexes.sql
│   ├── 021_add_monitor_history_agg_table.sql
│   └── 022_add_monitor_history_agg_peak.sql
├── MIGRATION.md                # 迁移说明文档
└── README.md                   # 本文件
```

## 文件说明

### init.sql

**用途**: 完整的数据库初始化脚本  
**适用场景**:

- 全新安装系统
- 创建新的数据库实例
- 生产环境部署

**包含内容**:

- 创建数据库 `amazon_asin_monitor`
- 创建所有数据表（包含所有最新字段和索引）
- 创建所有索引和外键约束
- 插入默认角色和权限数据

**执行方式**:

```bash
mysql -u root -p < server/database/init.sql
```

### competitor-init.sql

**用途**: 竞品监控数据库初始化脚本  
**适用场景**:

- 创建竞品监控数据库实例

**包含内容**:

- 创建数据库 `amazon_competitor_monitor`
- 创建竞品相关的所有数据表

**执行方式**:

```bash
mysql -u root -p < server/database/competitor-init.sql
```

### migrations/

**用途**: 数据库迁移脚本目录  
**适用场景**:

- 已有数据库需要升级
- 按版本逐步添加新功能

**迁移脚本列表**:

- `001_add_asin_type.sql`: 添加 ASIN 类型字段
- `002_add_monitor_fields.sql`: 添加监控更新时间和飞书通知字段
- `003_add_site_and_brand.sql`: 添加站点和品牌字段
- `004_add_user_auth_tables.sql`: 添加用户认证和权限管理表
- `005_remove_batch_tables.sql`: 删除批次管理相关表
- `006_add_audit_log_table.sql`: 添加操作审计日志表
- `008_add_monitor_history_index.sql`: 添加监控历史联合索引
- `009_remove_user_email_and_reset_table.sql`: 移除用户表邮箱字段和密码重置表
- `010_add_sessions_table.sql`: 添加多设备会话记录表
- `011_add_variant_group_fields.sql`: 为变体组表添加监控字段
- `012_add_composite_indexes.sql`: 添加复合索引优化查询性能
- `013_add_competitor_variant_group_fields.sql`: 为竞品变体组表添加监控字段
- `016_add_snapshot_fields_to_monitor_history.sql`: 为监控历史表补充快照字段
- `017_optimize_monitor_history_indexes.sql`: 优化监控历史表索引
- `018_add_analytics_query_index.sql`: 添加数据分析查询索引
- `020_add_status_change_indexes.sql`: 添加状态变化查询索引
- `021_add_monitor_history_agg_table.sql`: 添加监控历史聚合表（数据分析加速）
- `022_add_monitor_history_agg_peak.sql`: 聚合表补充高峰期字段（period-summary 加速）

**执行方式**:

```bash
# 按顺序执行迁移脚本
mysql -u root -p amazon_asin_monitor < server/database/migrations/001_add_asin_type.sql
mysql -u root -p amazon_asin_monitor < server/database/migrations/002_add_monitor_fields.sql
# ... 依此类推
```

### MIGRATION.md

**用途**: 详细的迁移说明文档  
**内容**:

- 每个迁移脚本的详细说明
- 字段变更说明
- 执行方式和注意事项

## 使用指南

### 场景 1: 全新安装（推荐）

直接执行 `init.sql`，该文件已包含所有最新变更：

```bash
mysql -u root -p < server/database/init.sql
```

**优势**:

- 一步完成所有表结构创建
- 包含所有最新字段和索引
- 无需执行迁移脚本
- 适合生产环境部署

### 场景 2: 已有数据库升级

1. **备份数据库**（重要！）

```bash
mysqldump -u root -p amazon_asin_monitor > backup_$(date +%Y%m%d_%H%M%S).sql
```

2. **查看迁移文档**

```bash
cat server/database/MIGRATION.md
```

3. **按顺序执行迁移脚本**

```bash
# 按版本号顺序执行，跳过已执行的版本
mysql -u root -p amazon_asin_monitor < server/database/migrations/001_add_asin_type.sql
mysql -u root -p amazon_asin_monitor < server/database/migrations/002_add_monitor_fields.sql
# ... 依此类推
```

## 数据库表结构

### 核心业务表

- `variant_groups`: 变体组表（包含监控字段和通知开关）
- `asins`: ASIN 表（包含类型、监控时间、通知开关等字段）
- `monitor_history`: 监控历史表（包含复合索引优化查询）
- `monitor_history_agg`: 监控历史聚合表（数据分析加速）

### 配置表

- `feishu_config`: 飞书通知配置表
- `sp_api_config`: SP-API 配置表

### 用户权限表

- `users`: 用户表
- `sessions`: 多设备会话表
- `roles`: 角色表
- `permissions`: 权限表
- `user_roles`: 用户角色关联表
- `role_permissions`: 角色权限关联表

### 审计表

- `audit_logs`: 操作审计日志表

详细表结构请查看 `init.sql` 文件。

## 注意事项

1. ⚠️ **执行前务必备份数据库**
2. ⚠️ **迁移脚本必须按版本号顺序执行**
3. ⚠️ **建议先在测试环境验证**
4. ✅ **新安装直接使用 `init.sql`，无需执行迁移脚本**
5. ✅ `init.sql` 已包含所有最新字段、表和索引，适合生产环境部署

## 版本历史

- **v1.0**: 初始数据库结构
- **v1.1**: 添加 ASIN 类型字段（001）
- **v1.2**: 添加监控更新时间和飞书通知字段（002）
- **v1.3**: 添加站点和品牌字段（003）
- **v1.4**: 添加用户认证和权限管理（004）
- **v1.5**: 删除批次管理相关表（005）
- **v1.6**: 添加操作审计日志表（006）
- **v1.7**: 添加监控历史联合索引（008）
- **v1.8**: 移除用户邮箱字段和密码重置表（009）
- **v1.9**: 添加多设备会话表（010）
- **v2.0**: 为变体组表添加监控字段（011）
- **v2.1**: 添加复合索引优化查询性能（012）
- **v2.2**: 添加监控历史聚合表（021）
- **v2.3**: 聚合表补充高峰期字段（022）

**当前版本**: v2.3（init.sql 已包含所有变更）
