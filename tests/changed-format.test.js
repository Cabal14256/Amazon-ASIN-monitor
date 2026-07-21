const assert = require('node:assert/strict');
const test = require('node:test');

const {
  checkFormatting,
  isSupportedFile,
  listChangedFiles,
  parseChangedFiles,
  validateCommitSha,
} = require('../scripts/check-changed-format');

test('仅选择新增或修改且受 Prettier 支持的源文件', () => {
  const files = parseChangedFiles(
    [
      'src/index.ts',
      'docs/guide.md',
      'server/dist/generated.js',
      'backups/config.json',
      'assets/logo.png',
      '',
    ].join('\0'),
  );

  assert.deepEqual(files, ['src/index.ts', 'docs/guide.md']);
  assert.equal(isSupportedFile('server\\src\\index.js'), true);
  assert.equal(isSupportedFile('server/node_modules/pkg/index.js'), false);
});

test('git diff 使用三点范围、关闭重命名检测、空字符分隔和 AM 过滤', () => {
  const calls = [];
  const runner = (command, args, options) => {
    calls.push({ command, args, options });
    return {
      status: 0,
      stdout: 'src/index.ts\0deleted-but-not-returned.js\0',
      stderr: '',
    };
  };

  const files = listChangedFiles('a'.repeat(40), 'b'.repeat(40), runner);
  assert.deepEqual(files, ['src/index.ts', 'deleted-but-not-returned.js']);
  assert.deepEqual(calls[0].args, [
    'diff',
    '--no-renames',
    '--name-only',
    '--diff-filter=AM',
    '-z',
    `${'a'.repeat(40)}...${'b'.repeat(40)}`,
    '--',
  ]);
  assert.equal(calls[0].options.encoding, 'utf8');
});

test('无受支持文件时不调用 Prettier', () => {
  let called = false;
  const status = checkFormatting([], () => {
    called = true;
  });
  assert.equal(status, 0);
  assert.equal(called, false);
});

test('使用当前 Node 进程执行仓库锁定的 Prettier CLI', () => {
  const calls = [];
  const status = checkFormatting(['src/index.ts'], (command, args, options) => {
    calls.push({ command, args, options });
    return { status: 0 };
  });

  assert.equal(status, 0);
  assert.equal(calls[0].command, process.execPath);
  assert.match(calls[0].args[0], /prettier[\\/]bin-prettier\.js$/);
  assert.deepEqual(calls[0].args.slice(1), [
    '--check',
    '--ignore-unknown',
    '--',
    'src/index.ts',
  ]);
  assert.deepEqual(calls[0].options, { stdio: 'inherit' });
});

test('非法 SHA 会在执行 git 前失败', () => {
  assert.throws(() => validateCommitSha('main', 'BASE'), /commit SHA/);
  assert.throws(
    () => listChangedFiles('not-a-sha', 'b'.repeat(40), () => null),
    /commit SHA/,
  );
});
