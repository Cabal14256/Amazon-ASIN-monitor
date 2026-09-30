const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');
const { reduceGroupSplitState } = require('../src/utils/variantSplit');

function loadService(stubs) {
  const filename = require.resolve('../src/services/variantCheckService');
  delete require.cache[filename];
  const original = Module._load;
  Module._load = function (name, ...args) {
    return Object.hasOwn(stubs, name)
      ? stubs[name]
      : original.call(this, name, ...args);
  };
  try {
    return require(filename);
  } finally {
    Module._load = original;
    delete require.cache[filename];
  }
}

test('主监控组检查、单 ASIN 检查持久化父体变化并传递原父/新父', async () => {
  const group = {
    id: 'g1',
    name: 'Group',
    country: 'US',
    feishu_notify_enabled: 1,
  };
  const children = [
    {
      id: 'a1',
      asin: 'B000000001',
      country: 'US',
      variantGroupId: 'g1',
      isBroken: 0,
      feishu_notify_enabled: 1,
    },
    {
      id: 'a2',
      asin: 'B000000002',
      country: 'US',
      variantGroupId: 'g1',
      isBroken: 0,
      feishu_notify_enabled: 1,
    },
  ];
  const trackerMembers = children.map((c) => ({
    ...c,
    feishu_notify_enabled: 1,
  }));
  let state = null;
  let events = 0;
  let parent = 'B000PARENT';
  let parentTitleMode = 'present';
  let timestamp = 0;
  const history = [];
  const snapshots = () => ({
    ...group,
    children: children.map((c) => ({ ...c })),
  });
  const tracker = {
    async observeGroup(id, observations) {
      assert.equal(id, 'g1');
      assert.equal(
        observations.length,
        observations[0].asinId === 'a1' && observations.length === 1 ? 1 : 2,
      );
      // Avoid wall-clock sleeps while exercising state transitions in real helpers.
      const stamp = new Date(
        Date.UTC(2026, 9, 1, 0, 0, ++timestamp),
      ).toISOString();
      state = reduceGroupSplitState(
        state,
        group,
        trackerMembers,
        observations.map((o) => ({ ...o, observedAt: stamp })),
      );
      if (state.newEvent) events++;
      return state;
    },
  };
  const splitService = require('../src/services/variantSplitService');
  const service = loadService({
    '../config/sp-api': {
      getMarketplaceId: () => 'market',
      callSPAPI: async (_method, path) => {
        const asin = path.split('/').pop();
        const isChild = asin === 'B000000001' || asin === 'B000000002';
        if (!isChild && parentTitleMode === 'timeout') {
          throw Object.assign(new Error('request timed out'), {
            code: 'ETIMEDOUT',
          });
        }
        if (!isChild && parentTitleMode === 'not-found') {
          throw Object.assign(new Error('not found'), {
            statusCode: 404,
            responseData: JSON.stringify({ errors: [{ code: 'NOT_FOUND' }] }),
          });
        }
        if (!isChild && parentTitleMode === 'malformed') return {};
        const invalidTitles = {
          'bad-object': {},
          'bad-array': [],
          'bad-number': 0,
          'bad-boolean': false,
        };
        return {
          asin:
            !isChild && parentTitleMode === 'wrong-asin' ? 'B000WRONG1' : asin,
          summaries: [
            {
              itemName:
                !isChild && Object.hasOwn(invalidTitles, parentTitleMode)
                  ? invalidTitles[parentTitleMode]
                  : !isChild && parentTitleMode === 'empty'
                  ? '  \n '
                  : 'Title',
            },
          ],
          relationships: [
            {
              relationships:
                asin === 'B000000001' || asin === 'B000000002'
                  ? [{ type: 'VARIATION', parentAsins: [parent] }]
                  : [
                      {
                        type: 'VARIATION',
                        childAsins: ['B000000001', 'B000000002'],
                      },
                    ],
            },
          ],
        };
      },
    },
    './legacySPAPIClient': {},
    '../models/VariantGroup': {
      findById: async () => snapshots(),
      updateVariantStatusAndCheckTime: async () => {},
      clearCache() {},
    },
    '../models/ASIN': {
      findById: async (id) => ({ ...children.find((c) => c.id === id) }),
      updateVariantStatusAndCheckTime: async (id, broken) => {
        children.find((c) => c.id === id).isBroken = broken ? 1 : 0;
      },
    },
    '../models/MonitorHistory': {
      create: async (entry) => history.push(entry),
    },
    '../models/SPAPIConfig': { findByKey: async () => null },
    './cacheService': {
      getAsync: async () => null,
      setAsync: async () => {},
      get() {},
      set() {},
      getKeys: () => [],
      delete() {},
    },
    './htmlScraperService': {},
    './riskControlService': { recordCheck() {} },
    './rateLimiter': { PRIORITY: { SCHEDULED: 1, MANUAL: 0 } },
    './spApiOperationIdentifier': { identifyOperation: () => 'catalog' },
    './batchVariantCheckService': { batchCheckASINsHybrid: async () => [] },
    './variantSplitService': {
      ...splitService,
      observeVariantGroupSplit: (id, observations) =>
        splitService.observeVariantGroupSplit(id, observations, tracker),
    },
    '../utils/logger': { debug() {}, info() {}, warn() {}, error() {} },
  });

  const baseline = await service.checkVariantGroup('g1', true, {
    group: snapshots(),
    skipGroupStatus: true,
  });
  assert.equal(baseline.isBroken, false);
  assert.equal(events, 0);
  const checkGroup = () =>
    service.checkVariantGroup('g1', true, {
      group: snapshots(),
      skipGroupStatus: true,
    });
  parentTitleMode = 'timeout';
  const unknown = await checkGroup();
  assert.ok(
    unknown.details.results.every(
      (item) => item.details.details.parentTitleStatus === 'UNKNOWN',
    ),
  );
  assert.equal(state.status, 'NORMAL');
  assert.equal(events, 0);
  parentTitleMode = 'empty';
  const empty = await checkGroup();
  assert.equal(empty.brokenByType.PARENT_TITLE_EMPTY, 2);
  assert.equal(empty.brokenByType.NO_VARIANTS, 0);
  assert.ok(
    empty.details.results.every(
      (item) =>
        item.details.details.parentTitleStatus === 'EMPTY' &&
        item.details.details.parentTitle === '',
    ),
  );
  assert.equal(events, 1);
  for (const mode of [
    'timeout',
    'not-found',
    'malformed',
    'wrong-asin',
    'bad-object',
    'bad-array',
    'bad-number',
    'bad-boolean',
  ]) {
    parentTitleMode = mode;
    const failed = await checkGroup();
    assert.ok(
      failed.details.results.every(
        (item) => item.details.details.parentTitleStatus === 'UNKNOWN',
      ),
      mode,
    );
    assert.equal(state.status, 'BROKEN', mode);
    assert.equal(events, 1, mode);
  }
  parentTitleMode = 'present';
  await checkGroup();
  assert.equal(state.status, 'NORMAL');
  parentTitleMode = 'empty';
  await checkGroup();
  assert.equal(events, 2);
  parentTitleMode = 'present';
  await checkGroup();
  parent = 'B000NEWPAR';
  const split = await service.checkVariantGroup('g1', true, {
    group: snapshots(),
    skipGroupStatus: true,
  });
  assert.equal(split.isBroken, true);
  assert.equal(split.brokenByType.PARENT_CHANGED, 2);
  assert.equal(events, 3);
  assert.ok(split.brokenASINs.every((c) => c.errorType === 'PARENT_CHANGED'));
  assert.equal(
    split.brokenASINs[0].splitDetection.baselineParentAsin,
    'B000PARENT',
  );
  assert.equal(
    split.brokenASINs[0].splitDetection.currentParentAsin,
    'B000NEWPAR',
  );
  await service.checkVariantGroup('g1', true, {
    group: snapshots(),
    skipGroupStatus: true,
  });
  assert.equal(events, 3);
  parent = 'B000PARENT';
  await service.checkVariantGroup('g1', true, {
    group: snapshots(),
    skipGroupStatus: true,
  });
  assert.equal(state.status, 'NORMAL');
  parent = 'B000NEWPAR';
  const single = await service.checkSingleASIN('a1', true);
  assert.equal(single.isBroken, true);
  assert.equal(single.details.errorType, 'PARENT_CHANGED');
  assert.equal(
    history[0].checkResult.splitDetection.baselineParentAsin,
    'B000PARENT',
  );
  assert.equal(events, 4);
});

test('延后复查应用相同父体检测，竞品不写主营拆分状态', async () => {
  const {
    persistDeferredASINResult,
  } = require('../src/services/deferredASINPersistenceService');
  let stateCalls = 0;
  const histories = [];
  const record = {
    id: 'a1',
    asin: 'B000000001',
    country: 'US',
    variantGroupId: 'g1',
  };
  let broken = false;
  const asinModel = {
    findByASIN: async () => record,
    findById: async () => ({ ...record, isBroken: broken ? 1 : 0 }),
    updateVariantStatusAndCheckTime: async (_id, value) => {
      broken = value;
    },
  };
  const groupModel = {
    findById: async () => ({
      id: 'g1',
      name: 'Group',
      isBroken: broken ? 1 : 0,
      children: [{ autoIsBroken: broken ? 1 : 0 }],
    }),
    updateVariantStatusAndCheckTime: async () => {},
  };
  const historyModel = { create: async (value) => histories.push(value) };
  const dependencies = {
    asinModel,
    variantGroupModel: groupModel,
    monitorHistoryModel: historyModel,
    competitorAsinModel: asinModel,
    competitorVariantGroupModel: groupModel,
    competitorMonitorHistoryModel: historyModel,
    splitStateModel: {
      observeGroup: async () => {
        stateCalls++;
        return {
          asins: [
            {
              asinId: 'a1',
              status: 'BROKEN',
              reason: 'PARENT_CHANGED',
              baselineParentAsin: 'B000PARENT',
              currentParentAsin: 'B000NEWPAR',
            },
          ],
        };
      },
    },
  };
  const raw = {
    hasVariants: true,
    variantCount: 1,
    details: {
      parentAsin: 'B000NEWPAR',
      hasVariantRelationships: true,
      parentTitleStatus: 'PRESENT',
    },
    meta: {
      source: 'spapi',
      relationshipsObserved: true,
      observedAt: '2026-10-01T00:00:00Z',
    },
  };
  const primary = await persistDeferredASINResult(
    { asin: record.asin, country: 'US' },
    raw,
    dependencies,
  );
  assert.equal(primary.errorType, 'PARENT_CHANGED');
  assert.equal(primary.isBroken, true);
  assert.equal(
    histories[0].checkResult.splitDetection.currentParentAsin,
    'B000NEWPAR',
  );
  await persistDeferredASINResult(
    { asin: record.asin, country: 'US', owner: 'competitor' },
    raw,
    dependencies,
  );
  assert.equal(stateCalls, 1);
  assert.equal(histories[1].checkResult.splitDetection, undefined);
});

function retrySplitFixture() {
  const group = { id: 'retry-group', country: 'US', feishu_notify_enabled: 1 };
  const members = ['a', 'b'].map((id, index) => ({
    id,
    asin: `B00000000${index + 1}`,
    country: 'US',
    variant_group_id: group.id,
    feishu_notify_enabled: 1,
    isBroken: 0,
  }));
  const now = Date.now();
  const raw = (parent = 'B000PARENT', offset = 0) => ({
    hasVariants: true,
    variantCount: 1,
    details: {
      parentAsin: parent,
      hasVariantRelationships: true,
      parentTitleStatus: 'PRESENT',
    },
    meta: {
      source: 'spapi',
      relationshipsObserved: true,
      observedAt: new Date(now + offset).toISOString(),
    },
  });
  let state = reduceGroupSplitState(
    null,
    group,
    members,
    members.map(({ id }) => ({ asinId: id, result: raw('B000PARENT', -3000) })),
  );
  const events = [];
  const observations = [];
  const cleared = [];
  const history = [];
  const calls = [];
  const model = {
    async observeGroup(id, batch) {
      assert.equal(id, group.id);
      observations.push(batch);
      calls.push('observe');
      state = reduceGroupSplitState(state, group, members, batch);
      if (state.newEvent) events.push(state.newEvent);
      return state;
    },
  };
  const asinModel = {
    findByASIN: async (asin) => members.find((m) => m.asin === asin),
    findById: async (id) => members.find((m) => m.id === id),
    async updateVariantStatusAndCheckTime(id, broken) {
      calls.push(`persist:${id}`);
      members.find((m) => m.id === id).isBroken = broken ? 1 : 0;
    },
  };
  const groupModel = {
    async findById() {
      return {
        ...group,
        children: members.map((m) => ({ ...m, autoIsBroken: m.isBroken })),
        isBroken: members.some((m) => m.isBroken) ? 1 : 0,
      };
    },
    async updateVariantStatusAndCheckTime() {},
  };
  const dependencies = {
    priority: 1,
    asinModel,
    variantGroupModel: groupModel,
    monitorHistoryModel: {
      async create(entry) {
        history.push(entry);
      },
    },
    splitStateModel: model,
    getDeferredASINs: () =>
      members.map((m) => ({
        asin: m.asin,
        country: m.country,
        retryCount: 0,
      })),
    clearDeferredASINCheck(asin) {
      calls.push(`clear:${asin}`);
      cleared.push(asin);
    },
  };
  return {
    group,
    members,
    raw,
    dependencies,
    observations,
    events,
    cleared,
    history,
    calls,
    get state() {
      return state;
    },
    setState(next) {
      state = next;
    },
  };
}

test('同组延后结果一次归约，成员恢复与另一个拆分不制造新增组事件', async () => {
  const {
    processDeferredASINs,
  } = require('../src/services/deferredASINRetryService');
  const f = retrySplitFixture();
  f.setState(
    reduceGroupSplitState(f.state, f.group, f.members, [
      { asinId: 'a', result: f.raw('B000NEWPAR', -2000) },
    ]),
  );
  f.dependencies.checkASINVariants = async (asin) => {
    f.calls.push(`check:${asin}`);
    return f.raw(asin === f.members[0].asin ? 'B000PARENT' : 'B000NEWPAR', 10);
  };
  const result = await processDeferredASINs('US', 'primary', f.dependencies);
  assert.equal(result.success, 2);
  assert.equal(f.observations.length, 1);
  assert.equal(f.observations[0].length, 2);
  assert.equal(f.events.length, 0);
  assert.equal(f.state.status, 'BROKEN');
  assert.equal(f.history[1].checkResult.errorType, 'PARENT_CHANGED');
  assert.equal(f.cleared.length, 2);
  assert.deepEqual(f.calls.slice(0, 3), [
    `check:${f.members[0].asin}`,
    `check:${f.members[1].asin}`,
    'observe',
  ]);
});

test('主轮保留的待确认组在延后确认拆分时不会重复生成事件', async () => {
  const {
    processDeferredASINs,
  } = require('../src/services/deferredASINRetryService');
  const f = retrySplitFixture();
  const broken = reduceGroupSplitState(f.state, f.group, f.members, [
    { asinId: 'a', result: f.raw('B000NEWPAR', -2000) },
  ]);
  f.setState(
    reduceGroupSplitState(broken, f.group, f.members, [
      { asinId: 'a', result: f.raw('B000PARENT', -1000) },
      {
        asinId: 'b',
        uncertain: true,
        observedAt: new Date(Date.now() - 500).toISOString(),
      },
    ]),
  );
  assert.equal(f.state.status, 'BROKEN');
  f.dependencies.getDeferredASINs = () => [
    { asin: f.members[1].asin, country: 'US', retryCount: 0 },
  ];
  f.dependencies.checkASINVariants = async () => f.raw('B000NEWPAR', 10);
  await processDeferredASINs('US', 'primary', f.dependencies);
  assert.equal(f.events.length, 0);
  assert.equal(f.state.status, 'BROKEN');
  assert.equal(f.state.members.b.pending, false);
});

test('延后一个成员失败时保持待确认状态，正常成员不会使旧异常组重新就绪', async () => {
  const {
    processDeferredASINs,
  } = require('../src/services/deferredASINRetryService');
  const f = retrySplitFixture();
  f.setState(
    reduceGroupSplitState(f.state, f.group, f.members, [
      { asinId: 'a', result: f.raw('B000NEWPAR', -2000) },
    ]),
  );
  f.dependencies.checkASINVariants = async (asin) => {
    if (asin === f.members[1].asin) throw new Error('temporary upstream error');
    return f.raw('B000PARENT', 10);
  };
  const result = await processDeferredASINs('US', 'primary', f.dependencies);
  assert.equal(result.success, 1);
  assert.equal(result.failed, 1);
  assert.equal(f.observations.length, 1);
  assert.equal(f.state.status, 'BROKEN');
  assert.equal(f.state.members.b.pending, true);
  assert.equal(f.events.length, 0);
});

test('延后新增拆分按整组生成一次，持久化失败的成员仍保留队列', async () => {
  const {
    processDeferredASINs,
  } = require('../src/services/deferredASINRetryService');
  const f = retrySplitFixture();
  f.dependencies.checkASINVariants = async () => f.raw('B000NEWPAR', 10);
  f.dependencies.monitorHistoryModel.create = async (entry) => {
    if (entry.asinId === 'b') throw new Error('history unavailable');
    f.history.push(entry);
  };
  const result = await processDeferredASINs('US', 'primary', f.dependencies);
  assert.equal(result.success, 1);
  assert.equal(result.failed, 1);
  assert.equal(f.observations.length, 1);
  assert.equal(f.events.length, 1);
  assert.deepEqual(f.events[0].details.triggerAsinIds, ['a', 'b']);
  assert.deepEqual(f.cleared, [f.members[0].asin]);
});
