const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

function runAuthScenario(scenario, maxRetries = 1) {
  const script = String.raw`
const EventEmitter = require('node:events');
const Module = require('node:module');
const assert = require('node:assert/strict');
const scenario = process.env.AUTH_TEST_SCENARIO;
const maxRetries = Number(process.env.AUTH_TEST_MAX_RETRIES);

process.env.SP_API_US_LWA_CLIENT_ID = 'client-id';
process.env.SP_API_US_LWA_CLIENT_SECRET = 'client-secret';
process.env.SP_API_US_REFRESH_TOKEN = 'refresh-token';
process.env.SP_API_USE_AWS_SIGNATURE = 'false';

let requestCount = 0;
const usedTokens = [];
let reloadCount = 0;
const https = {
  Agent: class Agent {},
  request(options, callback) {
    const request = new EventEmitter();
    request.write = () => {};
    request.end = () => {
      process.nextTick(() => {
        requestCount += 1;
        const isTokenRequest = options.hostname === 'api.amazon.com';
        const response = new EventEmitter();
        response.headers = {};
        if (isTokenRequest) {
          response.statusCode = 200;
          callback(response);
          response.emit('data', JSON.stringify({
            access_token: 'token-' + requestCount,
            expires_in: 3600,
          }));
        } else if (requestCount === 2 || scenario === 'persistent') {
          usedTokens.push(options.headers['x-amz-access-token']);
          response.statusCode = 403;
          callback(response);
          response.emit('data', JSON.stringify({
            errors: [{
              code: scenario === 'permission' ? 'AccessDenied' : 'Unauthorized',
              details: scenario === 'permission' ? 'Insufficient permissions.' : 'The LWA secret token you provided has expired.',
            }],
          }));
        } else {
          usedTokens.push(options.headers['x-amz-access-token']);
          response.statusCode = 200;
          callback(response);
          response.emit('data', JSON.stringify({ items: [] }));
        }
        response.emit('end');
      });
    };
    return request;
  },
};

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const spApiConfig = { findAll: async () => { reloadCount += 1; return []; }, findByKey: async () => null };
const responseAnalyzer = { analyzeResponse() {}, analyzeError() {} };
const rateLimiter = { PRIORITY: { SCHEDULED: 1 }, acquire: async () => {} };
const spApiScheduler = { schedule: (task) => task() };
const httpRequestTimeout = { attachHttpRequestTimeout: () => () => {}, getHttpRequestTimeoutMs: () => 1000 };
const stubs = new Map([
  ['https', https],
  ['models/SPAPIConfig', spApiConfig],
  ['utils/logger', logger],
  ['services/spApiResponseAnalyzer', responseAnalyzer],
  ['services/rateLimiter', rateLimiter],
  ['services/spApiScheduler', spApiScheduler],
  ['utils/httpRequestTimeout', httpRequestTimeout],
]);
const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  const normalized = request.replaceAll('\\\\', '/');
  for (const [suffix, value] of stubs) {
    const basename = suffix.split('/').pop();
    if (
      normalized === suffix ||
      normalized.endsWith('/' + suffix) ||
      normalized === basename ||
      normalized.endsWith('/' + basename)
    ) {
      return value;
    }
  }
  return originalLoad.call(this, request, parent, isMain);
};

(async () => {
  const { callSPAPI, isExpiredAccessTokenError } = require('./src/config/sp-api');
  assert.equal(isExpiredAccessTokenError({ statusCode: 401, message: 'invalid token' }), true);
  assert.equal(isExpiredAccessTokenError({ statusCode: 500, message: 'invalid token' }), false);
  const call = () => callSPAPI(
    'GET',
    '/catalog/2022-04-01/items/B000000001',
    'US',
    {},
    null,
    { maxRetries, operation: 'getCatalogItem' },
  );
  if (scenario === 'success') {
    const response = await call();
    assert.ok(Array.isArray(response.items));
    assert.equal(requestCount, 4);
    assert.deepEqual(usedTokens, ['token-1', 'token-3']);
    assert.equal(reloadCount, 2);
  } else {
    await assert.rejects(call, { statusCode: 403 });
    const shouldRecover = scenario === 'persistent' && maxRetries > 0;
    assert.equal(requestCount, shouldRecover ? 4 : 2);
    assert.equal(reloadCount, shouldRecover ? 2 : 1);
  }
})()
  .then(() => process.exit(0))
  .catch((error) => {
    process.stderr.write(error.stack || error.message);
    process.exit(1);
  });
`;

  assert.doesNotThrow(() => {
    execFileSync(process.execPath, ['-e', script], {
      cwd: require('node:path').join(__dirname, '..'),
      env: {
        ...process.env,
        AUTH_TEST_SCENARIO: scenario,
        AUTH_TEST_MAX_RETRIES: String(maxRetries),
      },
      stdio: 'pipe',
      timeout: 5000,
    });
  });
}

test('SP-API拒绝过期访问令牌时会清缓存并重取令牌', () => {
  runAuthScenario('success');
});

test('SP-API持续拒绝令牌时最多恢复一次', () => {
  runAuthScenario('persistent', 5);
});

test('SP-API权限不足时不会刷新令牌或重试', () => {
  runAuthScenario('permission', 5);
});

test('SP-API禁用重试时不会刷新令牌', () => {
  runAuthScenario('persistent', 0);
});
