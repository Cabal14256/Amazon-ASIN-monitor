const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  parseInitSchema,
} = require('../server/src/services/schemaAuditService');

const projectRoot = path.join(__dirname, '..');
const initSQL = fs.readFileSync(
  path.join(projectRoot, 'server/database/init.sql'),
  'utf8',
);
const competitorInitSQL = fs.readFileSync(
  path.join(projectRoot, 'server/database/competitor-init.sql'),
  'utf8',
);
const backupMigrationSQL = fs.readFileSync(
  path.join(
    projectRoot,
    'server/database/migrations/legacy/019_add_backup_config_table.sql',
  ),
  'utf8',
);
const mainSchema = parseInitSchema(initSQL);
const competitorSchema = parseInitSchema(competitorInitSQL);

function indexSignature(index) {
  return `${index.kind}:${index.columns.join(',')}`;
}

function normalizeSQL(statement) {
  return statement.replace(/\s+/g, ' ').trim();
}

test('canonical init 固定 21+4 张表及统一排序规则', () => {
  assert.equal(mainSchema.tables.size, 21);
  assert.equal(competitorSchema.tables.size, 4);
  assert.equal(mainSchema.collation, 'utf8mb4_0900_ai_ci');
  assert.equal(competitorSchema.collation, 'utf8mb4_0900_ai_ci');

  for (const schema of [mainSchema, competitorSchema]) {
    for (const table of schema.tables.values()) {
      assert.equal(table.engine.toLowerCase(), 'innodb', table.name);
      assert.equal(table.collation, 'utf8mb4_0900_ai_ci', table.name);
    }
  }
});

test('主营 ASIN canonical 为 40 列且两个事故字段允许 NULL', () => {
  const asins = mainSchema.tables.get('asins');
  assert.equal(asins.columns.size, 40);

  for (const columnName of ['asin_note', 'parent_title']) {
    const column = asins.columns.get(columnName);
    assert.equal(column.type, 'text');
    assert.equal(column.nullable, 'YES');
    assert.equal(column.default, null);
  }
});

test('竞品 ASIN 使用复合唯一键且历史表不依赖当前实体', () => {
  const competitorAsins = competitorSchema.tables.get('competitor_asins');
  assert.ok(
    competitorAsins.indexes.map(indexSignature).includes('unique:asin,country'),
  );
  assert.ok(
    !competitorAsins.indexes.map(indexSignature).includes('unique:asin'),
  );
  assert.equal(mainSchema.tables.get('monitor_history').foreignKeys.length, 0);
  assert.equal(
    competitorSchema.tables.get('competitor_monitor_history').foreignKeys
      .length,
    0,
  );
});

test('canonical 索引包含生产有效签名且不含已知重复签名', () => {
  const asinsSignatures = mainSchema.tables
    .get('asins')
    .indexes.map(indexSignature);
  assert.ok(asinsSignatures.includes('index:country,parent_asin'));
  assert.equal(
    asinsSignatures.filter((item) => item === 'index:asin').length,
    1,
  );
  assert.equal(
    asinsSignatures.filter((item) => item === 'index:variant_group_id').length,
    1,
  );

  const historySignatures = mainSchema.tables
    .get('monitor_history')
    .indexes.map(indexSignature);
  for (const expected of [
    'index:month_ts,country,asin_id,asin_code,is_broken',
    'index:check_type,hour_ts,country,asin_id,asin_code,is_broken',
    'index:check_type,day_ts,country,asin_id,asin_code,is_broken',
    'index:check_type,check_time,country,asin_id,asin_code,is_broken',
    'index:country,check_time,check_type,asin_id,asin_code',
    'index:variant_group_id,check_time,asin_id,asin_code,is_broken',
  ]) {
    assert.ok(historySignatures.includes(expected), expected);
  }

  const variantAggSignatures = mainSchema.tables
    .get('monitor_history_agg_variant_group')
    .indexes.map(indexSignature);
  assert.equal(
    variantAggSignatures.filter((item) => item === 'index:time_slot').length,
    1,
  );
  assert.equal(
    variantAggSignatures.filter((item) => item === 'index:country,time_slot')
      .length,
    1,
  );
  assert.ok(
    mainSchema.tables
      .get('users')
      .indexes.map(indexSignature)
      .includes('index:status'),
  );
});

test('init.sql 包含与 legacy 019 一致的 backup_config 结构和种子', () => {
  const createTablePattern =
    /CREATE TABLE IF NOT EXISTS `backup_config` \([\s\S]*?\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4(?: COLLATE=utf8mb4_0900_ai_ci)? COMMENT='自动备份配置表';/g;
  const seedPattern =
    /INSERT INTO `backup_config` \(`enabled`, `schedule_type`, `backup_time`\)[\s\S]*?WHERE NOT EXISTS \(SELECT 1 FROM `backup_config` LIMIT 1\);/g;
  const initTable = (initSQL.match(createTablePattern) || [])[0];
  const legacyTable = (backupMigrationSQL.match(createTablePattern) || [])[0];
  const initSeed = (initSQL.match(seedPattern) || [])[0];
  const legacySeed = (backupMigrationSQL.match(seedPattern) || [])[0];

  assert.ok(initTable);
  assert.ok(legacyTable);
  assert.equal(
    normalizeSQL(initTable).replace(' COLLATE=utf8mb4_0900_ai_ci', ''),
    normalizeSQL(legacyTable),
  );
  assert.equal(normalizeSQL(initSeed), normalizeSQL(legacySeed));
});
