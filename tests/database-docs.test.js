const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.join(__dirname, '..');
const migrationDirectory = path.join(projectRoot, 'server/database/migrations');
const migrationGuide = fs.readFileSync(
  path.join(projectRoot, 'server/database/MIGRATION.md'),
  'utf8',
);
const databaseReadme = fs.readFileSync(
  path.join(projectRoot, 'server/database/README.md'),
  'utf8',
);
const quotaGuide = fs.readFileSync(
  path.join(projectRoot, 'server/scripts/QUOTA-GUIDE.md'),
  'utf8',
);
const serverPackage = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'server/package.json'), 'utf8'),
);

test('迁移指南恰好收录目录中的每个 SQL 文件一次', () => {
  const actualFiles = fs
    .readdirSync(migrationDirectory)
    .filter((filename) => filename.endsWith('.sql'))
    .sort();
  const documentedFiles = Array.from(
    migrationGuide.matchAll(/`(\d{3}_[^`]+\.sql)`/g),
    (match) => match[1],
  ).sort();

  assert.deepEqual(documentedFiles, actualFiles);
  assert.equal(new Set(documentedFiles).size, documentedFiles.length);
});

test('数据库 README 区分全新初始化与已有数据库升级', () => {
  assert.match(databaseReadme, /MySQL 8\.0\+/);
  assert.match(databaseReadme, /amazon_asin_monitor/);
  assert.match(databaseReadme, /amazon_competitor_monitor/);
  assert.match(databaseReadme, /CREATE TABLE IF NOT EXISTS/);
  assert.match(databaseReadme, /不要对已有数据库重新执行初始化脚本/);
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
