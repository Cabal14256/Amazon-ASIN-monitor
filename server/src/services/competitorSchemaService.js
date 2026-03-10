const { pool } = require('../config/competitor-database');
const logger = require('../utils/logger');

const TABLE_DEFINITIONS = [
  {
    name: 'competitor_variant_groups',
    sql: `
      CREATE TABLE IF NOT EXISTS competitor_variant_groups (
        id VARCHAR(50) PRIMARY KEY COMMENT '变体组ID',
        name VARCHAR(255) NOT NULL COMMENT '变体组名称',
        country VARCHAR(10) NOT NULL COMMENT '所属国家(US/UK/DE等)',
        brand VARCHAR(100) NOT NULL COMMENT '品牌',
        is_broken TINYINT(1) DEFAULT 0 COMMENT '变体状态: 0-正常, 1-异常',
        variant_status VARCHAR(20) DEFAULT 'NORMAL' COMMENT '变体状态文本',
        feishu_notify_enabled TINYINT(1) DEFAULT 0 COMMENT '飞书通知开关: 0-关闭, 1-开启（默认关闭）',
        create_time DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
        last_check_time DATETIME DEFAULT NULL COMMENT '监控更新时间（上一次检查的时间）',
        INDEX idx_country (country),
        INDEX idx_brand (brand),
        INDEX idx_is_broken (is_broken),
        INDEX idx_create_time (create_time),
        INDEX idx_last_check_time (last_check_time),
        INDEX idx_feishu_notify_enabled (feishu_notify_enabled)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='竞品变体组表'
    `,
  },
  {
    name: 'competitor_asins',
    sql: `
      CREATE TABLE IF NOT EXISTS competitor_asins (
        id VARCHAR(50) PRIMARY KEY COMMENT 'ASIN ID',
        asin VARCHAR(20) NOT NULL COMMENT 'ASIN编码',
        name VARCHAR(500) COMMENT 'ASIN名称',
        asin_type VARCHAR(20) DEFAULT NULL COMMENT 'ASIN类型: MAIN_LINK-主链, SUB_REVIEW-副评',
        country VARCHAR(10) NOT NULL COMMENT '所属国家',
        brand VARCHAR(100) NOT NULL COMMENT '品牌',
        variant_group_id VARCHAR(50) NOT NULL COMMENT '所属变体组ID',
        is_broken TINYINT(1) DEFAULT 0 COMMENT '变体状态: 0-正常, 1-异常',
        variant_status VARCHAR(20) DEFAULT 'NORMAL' COMMENT '变体状态文本',
        create_time DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
        last_check_time DATETIME DEFAULT NULL COMMENT '监控更新时间（上一次检查的时间）',
        feishu_notify_enabled TINYINT(1) DEFAULT 0 COMMENT '飞书通知开关: 0-关闭, 1-开启（默认关闭）',
        INDEX idx_variant_group_id (variant_group_id),
        INDEX idx_country (country),
        INDEX idx_brand (brand),
        INDEX idx_asin (asin),
        INDEX idx_asin_type (asin_type),
        INDEX idx_is_broken (is_broken),
        INDEX idx_last_check_time (last_check_time),
        INDEX idx_feishu_notify_enabled (feishu_notify_enabled),
        UNIQUE INDEX uk_asin_country (asin, country),
        CONSTRAINT fk_competitor_asins_group
          FOREIGN KEY (variant_group_id) REFERENCES competitor_variant_groups(id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='竞品ASIN表'
    `,
  },
  {
    name: 'competitor_monitor_history',
    sql: `
      CREATE TABLE IF NOT EXISTS competitor_monitor_history (
        id BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '历史记录ID',
        variant_group_id VARCHAR(50) COMMENT '变体组ID',
        asin_id VARCHAR(50) COMMENT 'ASIN ID',
        check_type VARCHAR(20) DEFAULT 'GROUP' COMMENT '检查类型: GROUP-变体组, ASIN-单个ASIN',
        country VARCHAR(10) NOT NULL COMMENT '国家',
        is_broken TINYINT(1) DEFAULT 0 COMMENT '检查结果: 0-正常, 1-异常',
        check_time DATETIME NOT NULL COMMENT '检查时间',
        check_result TEXT COMMENT '检查结果详情(JSON格式)',
        notification_sent TINYINT(1) DEFAULT 0 COMMENT '是否已发送通知: 0-否, 1-是',
        create_time DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        INDEX idx_variant_group_id (variant_group_id),
        INDEX idx_asin_id (asin_id),
        INDEX idx_check_time (check_time),
        INDEX idx_country (country),
        CONSTRAINT fk_competitor_history_group
          FOREIGN KEY (variant_group_id) REFERENCES competitor_variant_groups(id)
          ON DELETE SET NULL,
        CONSTRAINT fk_competitor_history_asin
          FOREIGN KEY (asin_id) REFERENCES competitor_asins(id)
          ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='竞品监控历史表'
    `,
  },
  {
    name: 'competitor_feishu_config',
    sql: `
      CREATE TABLE IF NOT EXISTS competitor_feishu_config (
        id INT AUTO_INCREMENT PRIMARY KEY,
        country VARCHAR(10) NOT NULL UNIQUE COMMENT '区域代码（US或EU）',
        webhook_url VARCHAR(500) NOT NULL COMMENT '飞书Webhook URL',
        enabled TINYINT(1) DEFAULT 1 COMMENT '是否启用: 0-否, 1-是',
        create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='竞品飞书通知配置表'
    `,
  },
];

const COLUMN_DEFINITIONS = [
  {
    table: 'competitor_variant_groups',
    column: 'is_broken',
    sql: `ALTER TABLE competitor_variant_groups ADD COLUMN is_broken TINYINT(1) DEFAULT 0 COMMENT '变体状态: 0-正常, 1-异常'`,
  },
  {
    table: 'competitor_variant_groups',
    column: 'variant_status',
    sql: `ALTER TABLE competitor_variant_groups ADD COLUMN variant_status VARCHAR(20) DEFAULT 'NORMAL' COMMENT '变体状态文本'`,
  },
  {
    table: 'competitor_variant_groups',
    column: 'feishu_notify_enabled',
    sql: `ALTER TABLE competitor_variant_groups ADD COLUMN feishu_notify_enabled TINYINT(1) DEFAULT 0 COMMENT '飞书通知开关: 0-关闭, 1-开启（默认关闭）'`,
  },
  {
    table: 'competitor_variant_groups',
    column: 'create_time',
    sql: `ALTER TABLE competitor_variant_groups ADD COLUMN create_time DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间'`,
  },
  {
    table: 'competitor_variant_groups',
    column: 'update_time',
    sql: `ALTER TABLE competitor_variant_groups ADD COLUMN update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'`,
  },
  {
    table: 'competitor_variant_groups',
    column: 'last_check_time',
    sql: `ALTER TABLE competitor_variant_groups ADD COLUMN last_check_time DATETIME DEFAULT NULL COMMENT '监控更新时间（上一次检查的时间）'`,
  },
  {
    table: 'competitor_asins',
    column: 'is_broken',
    sql: `ALTER TABLE competitor_asins ADD COLUMN is_broken TINYINT(1) DEFAULT 0 COMMENT '变体状态: 0-正常, 1-异常'`,
  },
  {
    table: 'competitor_asins',
    column: 'variant_status',
    sql: `ALTER TABLE competitor_asins ADD COLUMN variant_status VARCHAR(20) DEFAULT 'NORMAL' COMMENT '变体状态文本'`,
  },
  {
    table: 'competitor_asins',
    column: 'create_time',
    sql: `ALTER TABLE competitor_asins ADD COLUMN create_time DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间'`,
  },
  {
    table: 'competitor_asins',
    column: 'update_time',
    sql: `ALTER TABLE competitor_asins ADD COLUMN update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'`,
  },
  {
    table: 'competitor_asins',
    column: 'last_check_time',
    sql: `ALTER TABLE competitor_asins ADD COLUMN last_check_time DATETIME DEFAULT NULL COMMENT '监控更新时间（上一次检查的时间）'`,
  },
  {
    table: 'competitor_asins',
    column: 'feishu_notify_enabled',
    sql: `ALTER TABLE competitor_asins ADD COLUMN feishu_notify_enabled TINYINT(1) DEFAULT 0 COMMENT '飞书通知开关: 0-关闭, 1-开启（默认关闭）'`,
  },
  {
    table: 'competitor_monitor_history',
    column: 'notification_sent',
    sql: `ALTER TABLE competitor_monitor_history ADD COLUMN notification_sent TINYINT(1) DEFAULT 0 COMMENT '是否已发送通知: 0-否, 1-是'`,
  },
  {
    table: 'competitor_monitor_history',
    column: 'create_time',
    sql: `ALTER TABLE competitor_monitor_history ADD COLUMN create_time DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间'`,
  },
  {
    table: 'competitor_feishu_config',
    column: 'enabled',
    sql: `ALTER TABLE competitor_feishu_config ADD COLUMN enabled TINYINT(1) DEFAULT 1 COMMENT '是否启用: 0-否, 1-是'`,
  },
  {
    table: 'competitor_feishu_config',
    column: 'create_time',
    sql: `ALTER TABLE competitor_feishu_config ADD COLUMN create_time DATETIME DEFAULT CURRENT_TIMESTAMP`,
  },
  {
    table: 'competitor_feishu_config',
    column: 'update_time',
    sql: `ALTER TABLE competitor_feishu_config ADD COLUMN update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`,
  },
];

const INDEX_DEFINITIONS = [
  {
    table: 'competitor_variant_groups',
    index: 'idx_is_broken',
    sql: `ALTER TABLE competitor_variant_groups ADD INDEX idx_is_broken (is_broken)`,
  },
  {
    table: 'competitor_variant_groups',
    index: 'idx_create_time',
    sql: `ALTER TABLE competitor_variant_groups ADD INDEX idx_create_time (create_time)`,
  },
  {
    table: 'competitor_variant_groups',
    index: 'idx_last_check_time',
    sql: `ALTER TABLE competitor_variant_groups ADD INDEX idx_last_check_time (last_check_time)`,
  },
  {
    table: 'competitor_variant_groups',
    index: 'idx_feishu_notify_enabled',
    sql: `ALTER TABLE competitor_variant_groups ADD INDEX idx_feishu_notify_enabled (feishu_notify_enabled)`,
  },
  {
    table: 'competitor_asins',
    index: 'idx_is_broken',
    sql: `ALTER TABLE competitor_asins ADD INDEX idx_is_broken (is_broken)`,
  },
  {
    table: 'competitor_asins',
    index: 'idx_last_check_time',
    sql: `ALTER TABLE competitor_asins ADD INDEX idx_last_check_time (last_check_time)`,
  },
  {
    table: 'competitor_asins',
    index: 'idx_feishu_notify_enabled',
    sql: `ALTER TABLE competitor_asins ADD INDEX idx_feishu_notify_enabled (feishu_notify_enabled)`,
  },
];

let schemaReady = false;
let ensurePromise = null;

async function queryRows(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function tableExists(tableName) {
  const rows = await queryRows(
    `SELECT COUNT(*) AS total
     FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ?`,
    [tableName],
  );
  return Number(rows[0]?.total || 0) > 0;
}

async function columnExists(tableName, columnName) {
  const rows = await queryRows(
    `SELECT COUNT(*) AS total
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND column_name = ?`,
    [tableName, columnName],
  );
  return Number(rows[0]?.total || 0) > 0;
}

async function indexExists(tableName, indexName) {
  const rows = await queryRows(
    `SELECT COUNT(*) AS total
     FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND index_name = ?`,
    [tableName, indexName],
  );
  return Number(rows[0]?.total || 0) > 0;
}

async function applySchemaChange(description, sql, ignoredCodes = []) {
  try {
    await pool.query(sql);
    logger.warn(`[CompetitorSchema] 已补齐 ${description}`);
    return description;
  } catch (error) {
    if (ignoredCodes.includes(error.code)) {
      logger.debug(`[CompetitorSchema] 并发补齐已存在，跳过 ${description}`);
      return null;
    }
    throw error;
  }
}

async function ensureTable(definition, appliedChanges) {
  if (await tableExists(definition.name)) {
    return;
  }

  const applied = await applySchemaChange(
    `表 ${definition.name}`,
    definition.sql,
    ['ER_TABLE_EXISTS_ERROR'],
  );
  if (applied) {
    appliedChanges.push(applied);
  }
}

async function ensureColumn(definition, appliedChanges) {
  if (await columnExists(definition.table, definition.column)) {
    return;
  }

  const applied = await applySchemaChange(
    `字段 ${definition.table}.${definition.column}`,
    definition.sql,
    ['ER_DUP_FIELDNAME'],
  );
  if (applied) {
    appliedChanges.push(applied);
  }
}

async function ensureIndex(definition, appliedChanges) {
  if (await indexExists(definition.table, definition.index)) {
    return;
  }

  const applied = await applySchemaChange(
    `索引 ${definition.table}.${definition.index}`,
    definition.sql,
    ['ER_DUP_KEYNAME'],
  );
  if (applied) {
    appliedChanges.push(applied);
  }
}

async function backfillVariantStatus(tableName, appliedChanges) {
  if (!(await columnExists(tableName, 'variant_status'))) {
    return;
  }

  if (!(await columnExists(tableName, 'is_broken'))) {
    return;
  }

  const [result] = await pool.query(
    `UPDATE ${tableName}
     SET variant_status = CASE
       WHEN COALESCE(is_broken, 0) = 1 THEN 'BROKEN'
       ELSE 'NORMAL'
     END
     WHERE variant_status IS NULL OR variant_status = ''`,
  );

  if (Number(result?.affectedRows || 0) > 0) {
    const description = `回填 ${tableName}.variant_status ${result.affectedRows} 行`;
    logger.info(`[CompetitorSchema] ${description}`);
    appliedChanges.push(description);
  }
}

async function runEnsure() {
  const appliedChanges = [];

  for (const definition of TABLE_DEFINITIONS) {
    await ensureTable(definition, appliedChanges);
  }

  for (const definition of COLUMN_DEFINITIONS) {
    await ensureColumn(definition, appliedChanges);
  }

  for (const definition of INDEX_DEFINITIONS) {
    await ensureIndex(definition, appliedChanges);
  }

  await backfillVariantStatus('competitor_variant_groups', appliedChanges);
  await backfillVariantStatus('competitor_asins', appliedChanges);

  return appliedChanges;
}

async function ensureCompetitorSchemaCompatibility(options = {}) {
  const { force = false } = options;
  if (schemaReady && !force) {
    return [];
  }

  if (ensurePromise) {
    return ensurePromise;
  }

  ensurePromise = runEnsure()
    .then((appliedChanges) => {
      schemaReady = true;
      return appliedChanges;
    })
    .catch((error) => {
      schemaReady = false;
      throw error;
    })
    .finally(() => {
      ensurePromise = null;
    });

  return ensurePromise;
}

module.exports = {
  ensureCompetitorSchemaCompatibility,
};
