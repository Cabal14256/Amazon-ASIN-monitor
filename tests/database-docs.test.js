const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.join(__dirname, '..');
const migrationDirectory = path.join(projectRoot, 'server/database/migrations');
const activeMigrationDirectory = path.join(migrationDirectory, 'active');
const legacyMigrationDirectory = path.join(migrationDirectory, 'legacy');
const migrationGuide = fs.readFileSync(
  path.join(projectRoot, 'server/database/MIGRATION.md'),
  'utf8',
);
const databaseReadme = fs.readFileSync(
  path.join(projectRoot, 'server/database/README.md'),
  'utf8',
);
const legacyManifest = fs.readFileSync(
  path.join(legacyMigrationDirectory, 'MANIFEST.md'),
  'utf8',
);
const quotaGuide = fs.readFileSync(
  path.join(projectRoot, 'server/scripts/QUOTA-GUIDE.md'),
  'utf8',
);
const serverPackage = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'server/package.json'), 'utf8'),
);

test('迁移指南恰好收录 active 中的每个 SQL 文件一次', () => {
  const actualFiles = fs
    .readdirSync(activeMigrationDirectory)
    .filter((filename) => filename.endsWith('.sql'))
    .sort();
  const documentedFiles = Array.from(
    migrationGuide.matchAll(/`(\d{8}_\d{3}_[^`]+\.sql)`/g),
    (match) => match[1],
  ).sort();

  assert.deepEqual(documentedFiles, actualFiles);
  assert.equal(new Set(documentedFiles).size, documentedFiles.length);
});

test('legacy manifest 收录全部 SQL 且 SHA-256 与归档内容一致', () => {
  const actualFiles = fs
    .readdirSync(legacyMigrationDirectory)
    .filter((filename) => filename.endsWith('.sql'))
    .sort();
  const entries = Array.from(
    legacyManifest.matchAll(/\| `([^`]+\.sql)` \|[^|]+\| `([a-f0-9]{64})` \|/g),
    (match) => ({ filename: match[1], checksum: match[2] }),
  );

  assert.deepEqual(entries.map((entry) => entry.filename).sort(), actualFiles);
  for (const entry of entries) {
    const content = fs.readFileSync(
      path.join(legacyMigrationDirectory, entry.filename),
    );
    const checksum = crypto.createHash('sha256').update(content).digest('hex');
    assert.equal(checksum, entry.checksum, entry.filename);
  }
});

test('数据库 README 区分全新初始化与已有数据库升级', () => {
  assert.match(databaseReadme, /MySQL 8\.0\+/);
  assert.match(databaseReadme, /amazon_asin_monitor/);
  assert.match(databaseReadme, /amazon_competitor_monitor/);
  assert.match(databaseReadme, /CREATE TABLE IF NOT EXISTS/);
  assert.match(databaseReadme, /不要对已有数据库重新执行初始化脚本/);
  assert.match(databaseReadme, /db:schema:audit/);
  assert.match(migrationGuide, /LOCK=NONE/);
  assert.match(migrationGuide, /生产维护窗口/);
});

test('配额指南中的 npm 命令与 server package 保持一致', () => {
  assert.equal(
    serverPackage.scripts['analyze-quota'],
    'node scripts/analyze-quota-usage.js',
  );
  assert.equal(
    serverPackage.scripts['monitor-quota'],
    'node scripts/monitor-quota-realtime.js',
  );
  assert.match(quotaGuide, /npm --prefix server run analyze-quota/);
  assert.match(quotaGuide, /npm --prefix server run monitor-quota/);
  assert.match(quotaGuide, /monitor-quota -- --once/);
  assert.doesNotMatch(quotaGuide, /当前预计使用|配额非常充足|700 个以下/);
});
