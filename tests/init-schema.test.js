const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.join(__dirname, '..');
const initSQL = fs.readFileSync(
  path.join(projectRoot, 'server/database/init.sql'),
  'utf8',
);
const backupMigrationSQL = fs.readFileSync(
  path.join(
    projectRoot,
    'server/database/migrations/019_add_backup_config_table.sql',
  ),
  'utf8',
);

const createTablePattern =
  /CREATE TABLE IF NOT EXISTS `backup_config` \([\s\S]*?\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='自动备份配置表';/g;
const seedPattern =
  /INSERT INTO `backup_config` \(`enabled`, `schedule_type`, `backup_time`\)[\s\S]*?WHERE NOT EXISTS \(SELECT 1 FROM `backup_config` LIMIT 1\);/g;

function normalizeSQL(statement) {
  return statement.replace(/\s+/g, ' ').trim();
}

test('init.sql 包含与 019 一致的 backup_config 表结构', () => {
  const initStatements = initSQL.match(createTablePattern) || [];
  const migrationStatements =
    backupMigrationSQL.match(createTablePattern) || [];

  assert.equal(
    initStatements.length,
    1,
    'init.sql 应且只应创建一次 backup_config',
  );
  assert.equal(
    migrationStatements.length,
    1,
    '019 应且只应创建一次 backup_config',
  );
  assert.equal(
    normalizeSQL(initStatements[0]),
    normalizeSQL(migrationStatements[0]),
  );
});

test('init.sql 包含与 019 一致且幂等的默认备份配置', () => {
  const initStatements = initSQL.match(seedPattern) || [];
  const migrationStatements = backupMigrationSQL.match(seedPattern) || [];

  assert.equal(initStatements.length, 1, 'init.sql 应且只应写入一次默认配置');
  assert.equal(migrationStatements.length, 1, '019 应且只应写入一次默认配置');
  assert.equal(
    normalizeSQL(initStatements[0]),
    normalizeSQL(migrationStatements[0]),
  );
  assert.match(initStatements[0], /SELECT 0, 'daily', '02:00'/);
  assert.match(initStatements[0], /WHERE NOT EXISTS/);
});
