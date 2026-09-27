const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

test('父体标题查询不会等待同一并发队列中的子任务释放槽位', () => {
  const script = String.raw`
const Module = require('node:module');

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const cacheService = {
  async getAsync() {
    return null;
  },
  async setAsync() {},
  set() {},
  delete() {},
  get() {
    return null;
  },
  getKeys() {
    return [];
  },
};

const fakeApi = {
  async callSPAPI(method, requestPath) {
    const asin = requestPath.split('/').pop();
    await wait(20);
    return {
      items: [
        {
          asin,
          summaries: [
            {
              itemName: 'Title ' + asin,
              parentAsin: asin === 'PARENT' ? null : 'PARENT',
            },
          ],
          relationships: [],
        },
      ],
    };
  },
  getMarketplaceId() {
    return 'marketplace';
  },
};

const modelStub = {};
const stubs = [
  ['config/sp-api', fakeApi],
  ['services/legacySPAPIClient', { callLegacySPAPI: async () => null }],
  ['models/VariantGroup', modelStub],
  ['models/ASIN', modelStub],
  ['models/MonitorHistory', modelStub],
  ['models/SPAPIConfig', { findByKey: async () => null }],
  ['services/cacheService', cacheService],
  ['services/htmlScraperService', {}],
  ['services/riskControlService', { recordCheck() {} }],
  ['services/rateLimiter', { PRIORITY: { SCHEDULED: 1, MANUAL: 0 } }],
  ['services/spApiOperationIdentifier', { identifyOperation: () => 'catalog' }],
  ['services/batchVariantCheckService', { batchCheckASINsHybrid: async () => [] }],
  ['utils/logger', logger],
  [
    'utils/variantParser',
    {
      parseVariantRelationships(item) {
        const parentAsin = item.summaries[0].parentAsin;
        return {
          variantASINs: parentAsin ? ['CHILD'] : [],
          parentASIN: parentAsin,
          isChild: Boolean(parentAsin),
          isParent: !parentAsin,
          variationRelations: [],
        };
      },
    },
  ],
  [
    'utils/variantStatus',
    {
      buildEffectiveStatus: (value) => value,
      decorateVariantGroupStatus: (value) => value,
    },
  ],
  [
    'utils/spApiError',
    {
      buildASINNotFoundResult: () => ({}),
      isCatalogItemNotFoundError: () => false,
    },
  ],
  ['utils/variantTitle', { applyParentTitleGate: (value) => value, hasConcreteTitle: Boolean }],
];

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  const normalizedRequest = request.replaceAll('\\\\', '/');
  const match = stubs.find(([suffix]) => {
    const normalizedSuffix = suffix.replaceAll('\\\\', '/');
    const basename = normalizedSuffix.split('/').pop();
    return (
      normalizedRequest === normalizedSuffix ||
      normalizedRequest.endsWith('/' + normalizedSuffix) ||
      normalizedRequest === basename ||
      normalizedRequest.endsWith('/' + basename)
    );
  });
  return match ? match[1] : originalLoad.call(this, request, parent, isMain);
};

(async () => {
  const { checkASINVariants } = require('./src/services/variantCheckService');
  const results = await Promise.race([
    Promise.all(
      ['CHILD-1', 'CHILD-2', 'CHILD-3'].map((asin) =>
        checkASINVariants(asin, 'FR', true),
      ),
    ),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('parent lookup deadlocked')), 500),
    ),
  ]);
  if (results.length !== 3 || results.some((result) => !result.details.parentTitle)) {
    throw new Error('parent titles were not resolved for all child checks');
  }
})()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
`;

  assert.doesNotThrow(() => {
    execFileSync(process.execPath, ['-e', script], {
      cwd: path.join(__dirname, '..'),
      stdio: 'pipe',
      timeout: 2000,
    });
  });
});
