const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  auditSchemas,
  compareSchemas,
  getFreshSchemaAuditStatus,
  getSchemaAuditStatus,
  isOperationalTable,
  parseInitSchema,
} = require('../src/services/schemaAuditService');

const initPath = path.join(__dirname, '../database/init.sql');
const initSql = fs.readFileSync(initPath, 'utf8');
const competitorInitSql = fs.readFileSync(
  path.join(__dirname, '../database/competitor-init.sql'),
  'utf8',
);

function metadataQuery(schema) {
  return async (sql) => {
    if (sql.includes('information_schema.SCHEMATA')) {
      return [
        { database_name: schema.databaseName, collation: schema.collation },
      ];
    }
    if (sql.includes('information_schema.TABLES')) {
      return [...schema.tables.values()].map((table) => ({
        TABLE_NAME: table.name,
        ENGINE: table.engine,
        TABLE_COLLATION: table.collation,
      }));
    }
    if (sql.includes('information_schema.COLUMNS')) {
      return [...schema.tables.values()].flatMap((table) =>
        [...table.columns.values()].map((column) => ({
          TABLE_NAME: table.name,
          COLUMN_NAME: column.name,
          COLUMN_TYPE: column.type,
          IS_NULLABLE: column.nullable,
          COLUMN_DEFAULT: column.default,
          GENERATION_EXPRESSION: column.generationExpression,
          CHARACTER_SET_NAME: column.characterSet,
          COLLATION_NAME: column.collation,
          EXTRA: [
            column.autoIncrement ? 'auto_increment' : '',
            column.generated ? `${column.generationStorage} GENERATED` : '',
            column.onUpdate ? 'on update CURRENT_TIMESTAMP' : '',
          ]
            .filter(Boolean)
            .join(' '),
        })),
      );
    }
    if (sql.includes('information_schema.STATISTICS')) {
      return [...schema.tables.values()].flatMap((table) =>
        table.indexes.flatMap((index, indexNumber) =>
          index.parts.map((part, sequence) => ({
            TABLE_NAME: table.name,
            INDEX_NAME:
              index.kind === 'primary' ? 'PRIMARY' : `idx_${indexNumber}`,
            NON_UNIQUE: index.kind === 'index' ? 1 : 0,
            SEQ_IN_INDEX: sequence + 1,
            COLUMN_NAME: part.column,
            SUB_PART: part.prefixLength,
            COLLATION: part.order === 'DESC' ? 'D' : 'A',
            EXPRESSION: part.expression,
          })),
        ),
      );
    }
    if (sql.includes('information_schema.KEY_COLUMN_USAGE')) {
      return [...schema.tables.values()].flatMap((table) =>
        table.foreignKeys.flatMap((foreignKey, keyNumber) =>
          foreignKey.columns.map((columnName, sequence) => ({
            TABLE_NAME: table.name,
            CONSTRAINT_NAME: `fk_${keyNumber}`,
            COLUMN_NAME: columnName,
            ORDINAL_POSITION: sequence + 1,
            REFERENCED_TABLE_SCHEMA: foreignKey.referencedSchema,
            REFERENCED_TABLE_NAME: foreignKey.referencedTable,
            REFERENCED_COLUMN_NAME: foreignKey.referencedColumns[sequence],
            DELETE_RULE: foreignKey.deleteRule,
            UPDATE_RULE: foreignKey.updateRule,
          })),
        ),
      );
    }
    throw new Error(`unexpected metadata query: ${sql}`);
  };
}

test('init parser 与相同 metadata 比较无差异', () => {
  const expected = parseInitSchema(initSql);
  const actual = parseInitSchema(initSql);
  assert.deepEqual(compareSchemas(expected, actual), []);
});

test('审计比较列、索引、外键并忽略运维备份表', () => {
  const expected = parseInitSchema(initSql);
  const actual = parseInitSchema(initSql);
  actual.tables.get('asins').columns.get('asin_note').nullable = 'NO';
  actual.tables.get('asins').columns.get('asin').collation = 'utf8mb4_bin';
  actual.tables
    .get('monitor_history')
    .columns.get('hour_ts').generationExpression = 'date(check_time)';
  actual.tables
    .get('monitor_history')
    .columns.get('day_ts').generationStorage = 'VIRTUAL';
  actual.tables.get('asins').indexes[1].parts[0].prefixLength = 5;
  actual.tables.get('asins').foreignKeys[0].referencedSchema = 'other_schema';
  actual.tables.set('op_schema_job', {
    name: 'op_schema_job',
    columns: new Map(),
    indexes: [],
    foreignKeys: [],
  });
  actual.tables.set('asins_bak_20260829', {
    name: 'asins_bak_20260829',
    columns: new Map(),
    indexes: [],
    foreignKeys: [],
  });
  actual.tables.set('unexpected_business_table', {
    name: 'unexpected_business_table',
    columns: new Map(),
    indexes: [],
    foreignKeys: [],
  });

  const differences = compareSchemas(expected, actual);
  assert.ok(
    differences.some(
      (item) => item.kind === 'column_nullable' && item.name === 'asin_note',
    ),
  );
  assert.ok(
    differences.some(
      (item) => item.kind === 'column_collation' && item.name === 'asin',
    ),
  );
  assert.ok(
    differences.some(
      (item) =>
        item.kind === 'column_generationExpression' && item.name === 'hour_ts',
    ),
  );
  assert.ok(
    differences.some(
      (item) =>
        item.kind === 'column_generationStorage' && item.name === 'day_ts',
    ),
  );
  assert.ok(differences.some((item) => item.kind === 'index_signature'));
  assert.ok(differences.some((item) => item.kind === 'foreign_key_signature'));
  assert.ok(
    differences.some(
      (item) =>
        item.kind === 'extra_table' &&
        item.table === 'unexpected_business_table',
    ),
  );
  assert.ok(!differences.some((item) => item.table === 'op_schema_job'));
  assert.ok(!differences.some((item) => item.table === 'asins_bak_20260829'));
  assert.equal(isOperationalTable('op_job'), true);
  assert.equal(isOperationalTable('asins_bak_1'), true);
});

test('审计缓存 clean、degraded、error 三种启动/健康状态', async () => {
  const cleanSchema = parseInitSchema(initSql);
  const clean = await auditSchemas({
    target: 'main',
    queryOverrides: { main: metadataQuery(cleanSchema) },
  });
  assert.equal(clean.status, 'ok');
  assert.equal(getSchemaAuditStatus().main.status, 'ok');

  const driftedSchema = parseInitSchema(initSql);
  driftedSchema.tables.get('asins').columns.get('asin_note').nullable = 'NO';
  const degraded = await auditSchemas({
    target: 'main',
    queryOverrides: { main: metadataQuery(driftedSchema) },
  });
  assert.equal(degraded.status, 'degraded');
  assert.ok(degraded.main.differenceCount > 0);

  const connectionError = new Error('contains-sensitive-hostname');
  connectionError.code = 'ECONNREFUSED';
  const failed = await auditSchemas({
    target: 'main',
    queryOverrides: {
      main: async () => {
        throw connectionError;
      },
    },
  });
  assert.equal(failed.status, 'error');
  assert.equal(failed.main.error, 'ECONNREFUSED');
  assert.doesNotMatch(JSON.stringify(failed), /sensitive-hostname/);

  const competitorSchema = parseInitSchema(competitorInitSql);
  const refreshed = await getFreshSchemaAuditStatus({
    maxAgeMs: 0,
    queryOverrides: {
      main: metadataQuery(cleanSchema),
      competitor: metadataQuery(competitorSchema),
    },
  });
  assert.equal(refreshed.status, 'ok');
});

test('API/worker 启动和竞品查询层不包含自动 DDL，健康接口暴露缓存审计', () => {
  const sourceRoot = path.join(__dirname, '../src');
  const readSource = (relativePath) =>
    fs.readFileSync(path.join(sourceRoot, relativePath), 'utf8');
  const startupAndQuerySources = [
    readSource('config/competitor-database.js'),
    readSource('index.js'),
    readSource('worker-index.js'),
  ].join('\n');
  assert.doesNotMatch(
    startupAndQuerySources,
    /\b(?:CREATE|ALTER|DROP)\s+(?:DATABASE|TABLE)\b/i,
  );
  assert.doesNotMatch(
    startupAndQuerySources,
    /ensureCompetitorSchemaCompatibility|competitorSchemaService/,
  );
  assert.match(startupAndQuerySources, /runStartupSchemaAudit/);

  const healthSource = readSource('controllers/healthController.js');
  assert.match(
    healthSource,
    /health\.schema = await getFreshSchemaAuditStatus\(\)/,
  );
  assert.match(healthSource, /health\.schema\.status !== 'ok'/);
});
