const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const projectRoot = path.join(__dirname, '..');

function loadTypeScriptModule(filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filename,
  }).outputText;
  const loadedModule = { exports: {} };
  const executeModule = new Function('module', 'exports', 'require', output);
  executeModule(loadedModule, loadedModule.exports, require);
  return loadedModule.exports;
}

const { buildApiURL, normalizeApiPath, resolveApiBaseURL, resolveApiRequest } =
  loadTypeScriptModule(path.join(projectRoot, 'src/utils/apiUrl.ts'));

const baseURLCases = [
  [undefined, ''],
  ['', ''],
  ['/api', ''],
  ['/api/', ''],
  ['/api/v1', ''],
  ['/api/v1/', ''],
  ['/api/api', ''],
  ['/api/v1/v1', ''],
  ['https://example.test', 'https://example.test'],
  ['https://example.test/', 'https://example.test'],
  ['https://example.test/api', 'https://example.test'],
  ['https://example.test/api/', 'https://example.test'],
  ['https://example.test/api/v1', 'https://example.test'],
  ['https://example.test/api/v1/', 'https://example.test'],
  ['https://example.test/gateway/api', 'https://example.test/gateway'],
  ['https://api', 'https://api'],
];

const endpointCases = [
  ['/api/v1/health', '/api/v1/health'],
  ['/v1/export/asin', '/api/v1/export/asin'],
  ['/api/v1/export/asin', '/api/v1/export/asin'],
  ['v1/export/asin', '/api/v1/export/asin'],
  ['/api/v1/tasks/task-1/download', '/api/v1/tasks/task-1/download'],
  ['/api/api/v1/health', '/api/v1/health'],
  ['/api/v1/v1/health', '/api/v1/health'],
];

test('普通请求、导出和任务下载共用同一 URL 规范', () => {
  for (const [baseURL, expectedBaseURL] of baseURLCases) {
    assert.equal(resolveApiBaseURL(baseURL), expectedBaseURL);

    for (const [endpoint, expectedPath] of endpointCases) {
      const expectedURL = `${expectedBaseURL}${expectedPath}`;
      assert.equal(
        buildApiURL(baseURL, endpoint),
        expectedURL,
        `${String(baseURL)} + ${endpoint}`,
      );

      const requestConfig = resolveApiRequest(baseURL, endpoint);
      assert.equal(
        `${requestConfig.baseURL}${requestConfig.url}`,
        expectedURL,
        `request config: ${String(baseURL)} + ${endpoint}`,
      );
    }
  }
});

test('查询参数和尾斜杠保持有效，跨源绝对地址被拒绝', () => {
  assert.equal(
    normalizeApiPath('/v1/export/asin?useProgress=true#download'),
    '/api/v1/export/asin?useProgress=true#download',
  );
  assert.equal(normalizeApiPath('/api/v1/'), '/api/v1/');
  assert.throws(
    () =>
      buildApiURL(
        'https://example.test/api',
        'https://cdn.example.test/export/file.xlsx',
      ),
    /必须使用相对地址/,
  );
  assert.throws(
    () =>
      buildApiURL(
        'https://example.test/api',
        '//cdn.example.test/export/file.xlsx',
      ),
    /必须使用相对地址/,
  );
});

function extractLocationBlock(source, locationHeader) {
  const headerIndex = source.indexOf(locationHeader);
  assert.notEqual(headerIndex, -1, `未找到 ${locationHeader}`);
  const openingBraceIndex = source.indexOf('{', headerIndex);
  let depth = 0;
  for (let index = openingBraceIndex; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(openingBraceIndex + 1, index);
  }
  throw new Error(`${locationHeader} 配置块未闭合`);
}

test('Nginx API 代理保留原始请求路径', () => {
  const nginxExample = fs.readFileSync(
    path.join(projectRoot, 'nginx.conf.example'),
    'utf8',
  );
  const apiLocation = extractLocationBlock(nginxExample, 'location /api');
  const proxyPassMatch = apiLocation.match(/^\s*proxy_pass\s+([^;]+);/m);
  assert.ok(proxyPassMatch, 'API location 缺少 proxy_pass');
  const proxyTarget = proxyPassMatch[1].trim();
  assert.equal(proxyTarget, new URL(proxyTarget).origin);
});
