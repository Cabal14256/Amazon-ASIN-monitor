# 数据库迁移说明

## 添加 ASIN 类型字段

执行以下 SQL 语句为 ASIN 表添加类型字段（主链/副评）：

```sql
USE `amazon_asin_monitor`;

-- 如果之前添加了main_link和sub_review字段，先删除它们
ALTER TABLE `asins`
DROP COLUMN IF EXISTS `main_link`,
DROP COLUMN IF EXISTS `sub_review`;

-- 添加ASIN类型字段
ALTER TABLE `asins`
ADD COLUMN `asin_type` VARCHAR(20) DEFAULT NULL COMMENT 'ASIN类型: MAIN_LINK-主链, SUB_REVIEW-副评' AFTER `name`;

-- 添加索引
ALTER TABLE `asins`
ADD INDEX `idx_asin_type` (`asin_type`);
```

或者直接执行迁移脚本：

```bash
mysql -u root -p amazon_asin_monitor < server/database/add_asin_type.sql
```

## 功能说明

**ASIN 类型字段 (asin_type)**:

- 表示 ASIN 的类型属性
- 可选值：`MAIN_LINK`（主链）、`SUB_REVIEW`（副评）
- 可以为 NULL（表示未设置类型）
- 每个 ASIN 只能有一个类型，要么是主链，要么是副评，或者不设置

---

## 添加站点和品牌字段

执行以下 SQL 语句为变体组表和 ASIN 表添加站点和品牌字段：

```sql
USE `amazon_asin_monitor`;

-- 为变体组表添加站点和品牌字段
ALTER TABLE `variant_groups`
ADD COLUMN `site` VARCHAR(100) DEFAULT NULL COMMENT '站点' AFTER `country`,
ADD COLUMN `brand` VARCHAR(100) DEFAULT NULL COMMENT '品牌' AFTER `site`;

-- 为ASIN表添加站点和品牌字段
ALTER TABLE `asins`
ADD COLUMN `site` VARCHAR(100) DEFAULT NULL COMMENT '站点' AFTER `country`,
ADD COLUMN `brand` VARCHAR(100) DEFAULT NULL COMMENT '品牌' AFTER `site`;

-- 添加索引
ALTER TABLE `variant_groups`
ADD INDEX `idx_site` (`site`),
ADD INDEX `idx_brand` (`brand`);

ALTER TABLE `asins`
ADD INDEX `idx_site` (`site`),
ADD INDEX `idx_brand` (`brand`);
```

或者直接执行迁移脚本：

```bash
mysql -u root -p amazon_asin_monitor < server/database/migrations/003_add_site_and_brand.sql
```

## 功能说明

**站点字段 (site)**:

- 表示内部店铺代号（不是 Amazon 站点信息）
- 例如：12, 15, 20 等数字代号
- **必填字段**，不能为 NULL

**品牌字段 (brand)**:

- 表示产品品牌名称
- 例如：Apple, Samsung, Sony 等
- **必填字段**，不能为 NULL

---

## 删除批次管理相关表

执行以下 SQL 语句删除批次管理相关的表（批次管理功能已不再需要）：

```sql
USE `amazon_asin_monitor`;

-- 删除批次变体组关联表（先删除，因为有外键依赖）
DROP TABLE IF EXISTS `batch_variant_groups`;

-- 删除批次表
DROP TABLE IF EXISTS `batches`;
```

或者直接执行迁移脚本：

```bash
mysql -u root -p amazon_asin_monitor < server/database/migrations/005_remove_batch_tables.sql
```

## 功能说明

**删除原因**:

- 批次管理功能已不再需要
- 删除 `batches` 表（批次表）
- 删除 `batch_variant_groups` 表（批次变体组关联表）

**注意事项**:

- ⚠️ 执行前请备份数据库
- ⚠️ 删除操作不可逆，请确认后再执行
- ⚠️ 如果表中有数据，删除前请先导出备份
