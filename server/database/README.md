# 数据库文件说明

本目录包含 Amazon ASIN 监控系统的所有数据库相关文件。

## 目录结构

```
database/
├── init.sql              # 完整的数据库初始化脚本（包含所有最新字段）
├── migrations/           # 数据库迁移脚本目录
│   ├── 001_add_asin_type.sql
│   └── 002_add_monitor_fields.sql
├── MIGRATION.md          # 迁移说明文档
└── README.md             # 本文件
```

## 文件说明

### init.sql

**用途**: 完整的数据库初始化脚本  
**适用场景**:

- 全新安装系统
- 创建新的数据库实例

**包含内容**:

- 创建数据库 `amazon_asin_monitor`
- 创建所有数据表（包含所有最新字段）
- 创建所有索引和外键约束

**执行方式**:

```bash
mysql -u root -p < server/database/init.sql
```

### migrations/

**用途**: 数据库迁移脚本目录  
**适用场景**:

- 已有数据库需要升级
- 按版本逐步添加新功能

**迁移脚本**:

- `001_add_asin_type.sql`: 添加 ASIN 类型字段
- `002_add_monitor_fields.sql`: 添加监控更新时间和飞书通知字段
- `003_add_site_and_brand.sql`: 添加站点和品牌字段

**执行方式**:

```bash
# 按顺序执行迁移脚本
mysql -u root -p amazon_asin_monitor < server/database/migrations/001_add_asin_type.sql
mysql -u root -p amazon_asin_monitor < server/database/migrations/002_add_monitor_fields.sql
```

### MIGRATION.md

**用途**: 详细的迁移说明文档  
**内容**:

- 每个迁移脚本的详细说明
- 字段变更说明
- 执行方式和注意事项
- 回滚脚本

## 使用指南

### 场景 1: 全新安装

直接执行 `init.sql`：

```bash
mysql -u root -p < server/database/init.sql
```

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
mysql -u root -p amazon_asin_monitor < server/database/migrations/001_add_asin_type.sql
mysql -u root -p amazon_asin_monitor < server/database/migrations/002_add_monitor_fields.sql
mysql -u root -p amazon_asin_monitor < server/database/migrations/003_add_site_and_brand.sql
```

## 数据库表结构

### 核心表

- `variant_groups`: 变体组表
- `asins`: ASIN 表（包含类型、监控时间、通知开关等字段）
- `monitor_history`: 监控历史表
- `batches`: 批次表
- `batch_variant_groups`: 批次变体组关联表
- `feishu_config`: 飞书通知配置表

详细表结构请查看 `init.sql` 文件。

## 注意事项

1. ⚠️ **执行前务必备份数据库**
2. ⚠️ **迁移脚本必须按版本号顺序执行**
3. ⚠️ **建议先在测试环境验证**
4. ✅ `init.sql` 已包含所有最新字段，新安装无需执行迁移脚本

## 版本历史

- **v1.0**: 初始数据库结构
- **v1.1**: 添加 ASIN 类型字段（001_add_asin_type.sql）
- **v1.2**: 添加监控更新时间和飞书通知字段（002_add_monitor_fields.sql）
- **v1.3**: 添加站点和品牌字段（003_add_site_and_brand.sql）
