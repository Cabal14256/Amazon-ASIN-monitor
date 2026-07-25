process.env.LOG_LEVEL = 'ERROR';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildASINNotFoundResult,
  isCatalogItemNotFoundError,
} = require('../src/utils/spApiError');
const {
  persistDeferredASINResult,
} = require('../src/services/deferredASINPersistenceService');
const {
  getASINCheckOutcome,
  getASINClassificationKey,
  mergeDeferredResults,
  processDeferredASINs,
} = require('../src/services/deferredASINRetryService');
const {
  buildCompetitorFeishuCard,
} = require('../src/services/competitorFeishuService');
const { buildFeishuCard } = require('../src/services/feishuService');

test('识别 Catalog Items API 返回的 404 NOT_FOUND', () => {
  const error = new Error('Legacy SP-API调用失败: 404');
  error.statusCode = 404;
  error.responseData = JSON.stringify({
    errors: [
      {
        code: 'NOT_FOUND',
        message:
          'Requested item, B0GJCXCH6Q, not found in marketplace(s) ATVPDKIKX0DER.',
      },
    ],
  });

  assert.equal(isCatalogItemNotFoundError(error), true);
});

test('兼容客户端直接暴露的 NOT_FOUND 错误码和结构化响应', () => {
  assert.equal(
    isCatalogItemNotFoundError({
      statusCode: 404,
      code: 'NOT_FOUND',
    }),
    true,
  );
  assert.equal(
    isCatalogItemNotFoundError({
      response: {
        status: 404,
        data: {
          errors: [{ code: 'NOT_FOUND' }],
        },
      },
    }),
    true,
  );
});

test('不会把缺少 Amazon NOT_FOUND 业务码的 404 或其他状态误判为 ASIN 不存在', () => {
  assert.equal(
    isCatalogItemNotFoundError({
      statusCode: 404,
      errorCode: 'NOT_FOUND',
      responseData: JSON.stringify({ message: 'NOT_FOUND' }),
    }),
    false,
  );
  assert.equal(
    isCatalogItemNotFoundError({
      statusCode: 404,
      responseData: '<html>gateway not found</html>',
    }),
    false,
  );
  assert.equal(
    isCatalogItemNotFoundError({
      statusCode: 503,
      responseData: JSON.stringify({
        errors: [{ code: 'NOT_FOUND' }],
      }),
    }),
    false,
  );
});

test('ASIN 不存在结果可被现有状态更新流程直接识别为异常', () => {
  assert.deepEqual(
    buildASINNotFoundResult({
      asin: 'B0GJCXCH6Q',
      country: 'US',
      source: 'legacy_spapi',
    }),
    {
      hasVariants: false,
      variantCount: 0,
      errorType: 'NOT_FOUND',
      details: {
        asin: 'B0GJCXCH6Q',
        country: 'US',
        title: '',
        brand: null,
        parentAsin: null,
        variations: [],
        relationships: [],
        notFound: true,
      },
      meta: {
        source: 'legacy_spapi',
        apiVersion: '2022-04-01',
      },
    },
  );
});

test('监控通知将 NOT_FOUND 单独显示为 ASIN 不存在', () => {
  const card = buildFeishuCard({
    country: 'US',
    totalGroups: 1,
    brokenGroups: 1,
    brokenGroupNames: ['测试分组'],
    brokenASINs: [
      {
        asin: 'B0GJCXCH6Q',
        groupName: '测试分组',
        errorType: 'NOT_FOUND',
      },
    ],
    brokenByType: {
      SP_API_ERROR: 0,
      NOT_FOUND: 1,
      NO_VARIANTS: 0,
    },
  });

  assert.match(card.elements[0].text.content, /ASIN不存在：1 个/);
});

test('竞品监控通知将 NOT_FOUND 单独显示为 ASIN 不存在', () => {
  const card = buildCompetitorFeishuCard({
    country: 'US',
    totalGroups: 1,
    brokenGroups: 1,
    brokenGroupNames: ['竞品测试分组'],
    brokenASINs: [
      {
        asin: 'B0GJCXCH6Q',
        groupName: '竞品测试分组',
        errorType: 'NOT_FOUND',
      },
    ],
    brokenByType: {
      SP_API_ERROR: 0,
      NOT_FOUND: 1,
      NO_VARIANTS: 0,
    },
  });

  assert.match(card.elements[0].text.content, /ASIN不存在：1 个/);
});

test('延后重试得到 NOT_FOUND 时先持久化 ASIN、变体组和历史', async () => {
  const calls = [];
  const result = buildASINNotFoundResult({
    asin: 'B0GJCXCH6Q',
    country: 'US',
  });

  const persisted = await persistDeferredASINResult(
    {
      asin: 'B0GJCXCH6Q',
      country: 'US',
    },
    result,
    {
      asinModel: {
        async findByASIN() {
          calls.push('find-asin');
          return {
            id: 'asin-id',
            asin: 'B0GJCXCH6Q',
            name: '测试 ASIN',
            country: 'US',
            variant_group_id: 'group-id',
            feishu_notify_enabled: 0,
          };
        },
        async updateVariantStatusAndCheckTime(id, isBroken) {
          calls.push(`update-asin:${id}:${isBroken}`);
        },
      },
      variantGroupModel: {
        async updateVariantStatusAndCheckTime(id, isBroken) {
          calls.push(`update-group:${id}:${isBroken}`);
        },
        async findById(id) {
          calls.push(`find-group:${id}`);
          return {
            id,
            name: '测试分组',
            isBroken: 1,
            children: [{ autoIsBroken: 1 }],
          };
        },
      },
      monitorHistoryModel: {
        async create(entry) {
          calls.push(`history:${entry.asinId}:${entry.isBroken}`);
          assert.equal(entry.checkResult.errorType, 'NOT_FOUND');
          assert.equal(entry.checkResult.meta.trigger, 'deferred_retry');
        },
      },
    },
  );

  assert.equal(persisted.owner, 'primary');
  assert.equal(persisted.asin, 'B0GJCXCH6Q');
  assert.equal(persisted.variantGroupName, '测试分组');
  assert.equal(persisted.notifyEnabled, false);
  assert.deepEqual(calls, [
    'find-asin',
    'update-asin:asin-id:true',
    'find-group:group-id',
    'update-group:group-id:true',
    'find-group:group-id',
    'history:asin-id:1',
  ]);
});

test('竞品延后重试仅写入竞品模型并保留归属信息', async () => {
  const calls = [];
  const persisted = await persistDeferredASINResult(
    {
      asin: 'B0GJCXCH6Q',
      country: 'US',
      owner: 'competitor',
    },
    buildASINNotFoundResult({
      asin: 'B0GJCXCH6Q',
      country: 'US',
    }),
    {
      competitorAsinModel: {
        async findByASIN() {
          calls.push('find-competitor-asin');
          return {
            id: 'competitor-asin-id',
            asin: 'B0GJCXCH6Q',
            variantGroupId: 'competitor-group-id',
            feishu_notify_enabled: 1,
          };
        },
        async updateVariantStatusAndCheckTime() {
          calls.push('update-competitor-asin');
        },
      },
      competitorVariantGroupModel: {
        async updateVariantStatusAndCheckTime() {
          calls.push('update-competitor-group');
        },
        async findById() {
          calls.push('find-competitor-group');
          return {
            name: '竞品分组',
            feishu_notify_enabled: 1,
            isBroken: 1,
            children: [{ isBroken: 1 }],
          };
        },
      },
      competitorMonitorHistoryModel: {
        async create(entry) {
          calls.push(`competitor-history:${entry.asinId}`);
        },
      },
    },
  );

  assert.equal(persisted.owner, 'competitor');
  assert.equal(persisted.notifyEnabled, true);
  assert.deepEqual(calls, [
    'find-competitor-asin',
    'update-competitor-asin',
    'find-competitor-group',
    'update-competitor-group',
    'find-competitor-group',
    'competitor-history:competitor-asin-id',
  ]);
});

test('延后记录在 NOT_FOUND 持久化完成后才按 owner 清理', async () => {
  const calls = [];
  const result = buildASINNotFoundResult({
    asin: 'B0GJCXCH6Q',
    country: 'US',
  });

  const summary = await processDeferredASINs('US', 'competitor', {
    priority: 'scheduled',
    getDeferredASINs() {
      return [
        {
          asin: 'B0GJCXCH6Q',
          country: 'US',
          region: 'US',
          owner: 'competitor',
          retryCount: 0,
        },
        {
          asin: 'B0PRIMARY01',
          country: 'US',
          region: 'US',
          owner: 'primary',
          retryCount: 0,
        },
      ];
    },
    async checkASINVariants(asin, country, forceRefresh, priority, options) {
      calls.push(`check:${asin}:${options.owner}`);
      return result;
    },
    async persistDeferredASINResult(deferred) {
      calls.push(`persist:${deferred.asin}:${deferred.owner}`);
      return {
        owner: deferred.owner,
        asin: deferred.asin,
        country: deferred.country,
        checkTime: new Date(),
        errorType: 'NOT_FOUND',
      };
    },
    clearDeferredASINCheck(asin, country, region, owner) {
      calls.push(`clear:${asin}:${owner}`);
    },
  });

  assert.equal(summary.total, 1);
  assert.equal(summary.deferredResults.length, 1);
  assert.deepEqual(calls, [
    'check:B0GJCXCH6Q:competitor',
    'persist:B0GJCXCH6Q:competitor',
    'clear:B0GJCXCH6Q:competitor',
  ]);
});

test('延后重试恢复正常时也会先持久化再清理队列', async () => {
  const calls = [];
  const summary = await processDeferredASINs('US', 'primary', {
    priority: 'scheduled',
    getDeferredASINs() {
      return [
        {
          asin: 'B0NORMAL001',
          country: 'US',
          region: 'US',
          owner: 'primary',
          retryCount: 0,
        },
      ];
    },
    async checkASINVariants() {
      calls.push('check');
      return {
        hasVariants: true,
        variantCount: 2,
      };
    },
    async persistDeferredASINResult(deferred) {
      calls.push('persist');
      return {
        owner: deferred.owner,
        asin: deferred.asin,
        country: deferred.country,
        checkTime: new Date(),
        autoIsBroken: false,
        isBroken: false,
        groupIsBroken: false,
        errorType: null,
      };
    },
    clearDeferredASINCheck() {
      calls.push('clear');
    },
  });

  assert.equal(summary.success, 1);
  assert.equal(summary.deferredResults.length, 1);
  assert.deepEqual(calls, ['check', 'persist', 'clear']);
});

test('NOT_FOUND 持久化失败时保留延后记录', async () => {
  const calls = [];
  const result = buildASINNotFoundResult({
    asin: 'B0GJCXCH6Q',
    country: 'US',
  });

  const summary = await processDeferredASINs('US', 'primary', {
    priority: 'scheduled',
    getDeferredASINs() {
      return [
        {
          asin: 'B0GJCXCH6Q',
          country: 'US',
          owner: 'primary',
          retryCount: 0,
        },
      ];
    },
    async checkASINVariants() {
      calls.push('check');
      return result;
    },
    async persistDeferredASINResult() {
      calls.push('persist');
      const error = new Error('history write failed');
      error.preserveDeferred = true;
      throw error;
    },
    clearDeferredASINCheck() {
      calls.push('clear');
    },
  });

  assert.equal(summary.failed, 1);
  assert.deepEqual(calls, ['check', 'persist']);
});

test('延后确认 NOT_FOUND 会在通知前替换原 SP-API 异常分类', () => {
  const countryResults = {
    US: {
      country: 'US',
      totalGroups: 1,
      brokenGroups: 1,
      brokenGroupNames: ['测试分组'],
      brokenGroupDetails: [
        {
          variantGroupId: 'group-id',
          groupName: '测试分组',
        },
      ],
      brokenASINs: [
        {
          asin: 'B0GJCXCH6Q',
          variantGroupId: 'group-id',
          groupName: '测试分组',
          errorType: 'SP_API_ERROR',
        },
      ],
      brokenByType: {
        SP_API_ERROR: 1,
        NOT_FOUND: 0,
        NO_VARIANTS: 0,
      },
      asinClassifications: {
        'group:group-id:asin:B0GJCXCH6Q': 'SP_API_ERROR',
      },
      checkedGroupKeys: ['group:group-id'],
    },
  };

  const merged = mergeDeferredResults(countryResults, [
    {
      asin: 'B0GJCXCH6Q',
      country: 'US',
      variantGroupId: 'group-id',
      variantGroupName: '测试分组',
      asinName: '测试 ASIN',
      notifyEnabled: true,
      checkTime: new Date(),
      autoIsBroken: true,
      isBroken: true,
      groupIsBroken: true,
      errorType: 'NOT_FOUND',
    },
  ]);

  assert.equal(merged.addedGroups, 0);
  assert.equal(countryResults.US.brokenByType.SP_API_ERROR, 0);
  assert.equal(countryResults.US.brokenByType.NOT_FOUND, 1);
  assert.equal(countryResults.US.brokenASINs[0].errorType, 'NOT_FOUND');
});

test('同名分组按 ID 合并且不会扣减其他 ASIN 的 SP-API 错误', () => {
  const countryResults = {
    US: {
      country: 'US',
      totalGroups: 1,
      brokenGroups: 1,
      brokenGroupNames: ['同名分组'],
      brokenGroupDetails: [
        {
          variantGroupId: 'group-a',
          groupName: '同名分组',
        },
      ],
      brokenASINs: [
        {
          asin: 'B0OTHER001',
          variantGroupId: 'group-a',
          groupName: '同名分组',
          errorType: 'SP_API_ERROR',
        },
      ],
      brokenByType: {
        SP_API_ERROR: 1,
        NOT_FOUND: 0,
        NO_VARIANTS: 0,
      },
      asinClassifications: {
        'group:group-a:asin:B0OTHER001': 'SP_API_ERROR',
      },
      checkedGroupKeys: ['group:group-a'],
    },
  };

  const merged = mergeDeferredResults(countryResults, [
    {
      asin: 'B0GJCXCH6Q',
      asinId: 'asin-b',
      country: 'US',
      variantGroupId: 'group-b',
      variantGroupName: '同名分组',
      notifyEnabled: true,
      checkTime: new Date(),
      autoIsBroken: true,
      isBroken: true,
      groupIsBroken: true,
      errorType: 'NOT_FOUND',
    },
  ]);

  assert.equal(merged.addedGroups, 1);
  assert.equal(countryResults.US.totalGroups, 2);
  assert.equal(countryResults.US.brokenGroups, 2);
  assert.equal(countryResults.US.brokenByType.SP_API_ERROR, 1);
  assert.equal(countryResults.US.brokenByType.NOT_FOUND, 1);
  assert.equal(
    countryResults.US.brokenGroupDetails[1].variantGroupId,
    'group-b',
  );
});

test('关闭通知的 ASIN 仍会把旧 SP-API 分类替换为 NOT_FOUND', () => {
  const classificationKey = getASINClassificationKey({
    asin: 'B0GJCXCH6Q',
    asinId: 'asin-id',
    variantGroupId: 'group-id',
  });
  const countryResults = {
    US: {
      country: 'US',
      totalGroups: 1,
      brokenGroups: 1,
      brokenGroupNames: ['测试分组'],
      brokenGroupDetails: [
        { variantGroupId: 'group-id', groupName: '测试分组' },
      ],
      brokenASINs: [],
      brokenByType: {
        SP_API_ERROR: 1,
        NOT_FOUND: 0,
        NO_VARIANTS: 0,
      },
      asinClassifications: {
        [classificationKey]: 'SP_API_ERROR',
      },
      checkedGroupKeys: ['group:group-id'],
    },
  };

  mergeDeferredResults(countryResults, [
    {
      asin: 'B0GJCXCH6Q',
      asinId: 'asin-id',
      country: 'US',
      variantGroupId: 'group-id',
      variantGroupName: '测试分组',
      notifyEnabled: false,
      checkTime: new Date(),
      autoIsBroken: true,
      isBroken: true,
      groupIsBroken: true,
      errorType: 'NOT_FOUND',
    },
  ]);

  assert.equal(countryResults.US.brokenByType.SP_API_ERROR, 0);
  assert.equal(countryResults.US.brokenByType.NOT_FOUND, 1);
  assert.equal(
    countryResults.US.asinClassifications[classificationKey],
    'NOT_FOUND',
  );
  assert.deepEqual(countryResults.US.brokenASINs, []);
});

test('延后重试恢复正常时会清除 ASIN 和变体组异常并记录历史', async () => {
  const calls = [];
  const persisted = await persistDeferredASINResult(
    {
      asin: 'B0NORMAL001',
      country: 'US',
    },
    {
      hasVariants: true,
      variantCount: 2,
    },
    {
      asinModel: {
        async findByASIN() {
          return {
            id: 'asin-id',
            asin: 'B0NORMAL001',
            variant_group_id: 'group-id',
          };
        },
        async updateVariantStatusAndCheckTime(id, isBroken) {
          calls.push(`update-asin:${id}:${isBroken}`);
        },
        async findById() {
          return {
            id: 'asin-id',
            asin: 'B0NORMAL001',
            isBroken: 0,
            feishuNotifyEnabled: 1,
          };
        },
      },
      variantGroupModel: {
        async findById() {
          calls.push('find-group');
          return {
            id: 'group-id',
            name: '测试分组',
            isBroken: 0,
            children: [{ autoIsBroken: 0 }],
            feishuNotifyEnabled: 1,
          };
        },
        async updateVariantStatusAndCheckTime(id, isBroken) {
          calls.push(`update-group:${id}:${isBroken}`);
        },
      },
      monitorHistoryModel: {
        async create(entry) {
          calls.push(`history:${entry.isBroken}`);
          assert.equal(entry.checkResult.isBroken, false);
          assert.equal(entry.checkResult.errorType, undefined);
        },
      },
    },
  );

  assert.equal(persisted.autoIsBroken, false);
  assert.equal(persisted.isBroken, false);
  assert.equal(persisted.groupIsBroken, false);
  assert.equal(persisted.errorType, null);
  assert.deepEqual(calls, [
    'update-asin:asin-id:false',
    'find-group',
    'update-group:group-id:false',
    'find-group',
    'history:0',
  ]);
});

test('延后重试恢复正常会替换旧分类并移除已恢复分组', () => {
  const classificationKey = getASINClassificationKey({
    asin: 'B0NORMAL001',
    asinId: 'asin-id',
    variantGroupId: 'group-id',
  });
  const countryResults = {
    US: {
      country: 'US',
      totalGroups: 1,
      brokenGroups: 1,
      brokenGroupNames: ['测试分组'],
      brokenGroupDetails: [
        { variantGroupId: 'group-id', groupName: '测试分组' },
      ],
      brokenASINs: [
        {
          asin: 'B0NORMAL001',
          asinId: 'asin-id',
          variantGroupId: 'group-id',
          groupName: '测试分组',
          errorType: 'SP_API_ERROR',
        },
      ],
      brokenByType: {
        SP_API_ERROR: 1,
        NOT_FOUND: 0,
        NO_VARIANTS: 0,
      },
      asinClassifications: {
        [classificationKey]: 'SP_API_ERROR',
      },
      checkedGroupKeys: ['group:group-id'],
    },
  };

  const merged = mergeDeferredResults(countryResults, [
    {
      asin: 'B0NORMAL001',
      asinId: 'asin-id',
      country: 'US',
      variantGroupId: 'group-id',
      variantGroupName: '测试分组',
      notifyEnabled: true,
      checkTime: new Date(),
      autoIsBroken: false,
      isBroken: false,
      groupIsBroken: false,
      errorType: null,
    },
  ]);

  assert.equal(merged.brokenDelta, -1);
  assert.equal(countryResults.US.brokenGroups, 0);
  assert.equal(countryResults.US.brokenByType.SP_API_ERROR, 0);
  assert.deepEqual(countryResults.US.brokenASINs, []);
  assert.deepEqual(countryResults.US.brokenGroupDetails, []);
});

test('延后结果为无父变体时按 NO_VARIANTS 持久化', async () => {
  const historyEntries = [];
  const persisted = await persistDeferredASINResult(
    {
      asin: 'B0NOVARIANT',
      country: 'US',
      owner: 'competitor',
    },
    {
      hasVariants: false,
      variantCount: 0,
    },
    {
      competitorAsinModel: {
        async findByASIN() {
          return {
            id: 'asin-id',
            asin: 'B0NOVARIANT',
            variant_group_id: null,
          };
        },
        async updateVariantStatusAndCheckTime() {},
      },
      competitorVariantGroupModel: {},
      competitorMonitorHistoryModel: {
        async create(entry) {
          historyEntries.push(entry);
        },
      },
    },
  );

  assert.equal(persisted.errorType, 'NO_VARIANTS');
  assert.equal(persisted.isBroken, true);
  assert.equal(historyEntries[0].checkResult.errorType, 'NO_VARIANTS');
});

test('延后检查沿用旧异常状态时不会伪造 NO_VARIANTS', () => {
  const outcome = getASINCheckOutcome(
    {
      brokenASINs: [{ asin: 'B0STALE001' }],
      details: {
        results: [
          {
            asin: 'B0STALE001',
            isBroken: false,
            isDeferred: true,
          },
        ],
      },
    },
    {
      asin: 'B0STALE001',
      isBroken: 1,
      statusSource: 'AUTO',
    },
  );

  assert.equal(outcome.isDeferred, true);
  assert.equal(outcome.errorType, null);
  assert.equal(outcome.classificationErrorType, null);
});

test('主监控与竞品通知按分组 ID 区分同名分组', () => {
  const data = {
    country: 'US',
    totalGroups: 2,
    brokenGroups: 2,
    brokenGroupNames: ['同名分组', '同名分组'],
    brokenGroupDetails: [
      { variantGroupId: 'group-a', groupName: '同名分组' },
      { variantGroupId: 'group-b', groupName: '同名分组' },
    ],
    brokenASINs: [
      {
        asin: 'B0GROUPA01',
        variantGroupId: 'group-a',
        groupName: '同名分组',
      },
      {
        asin: 'B0GROUPB01',
        variantGroupId: 'group-b',
        groupName: '同名分组',
      },
    ],
  };

  for (const card of [buildFeishuCard(data), buildCompetitorFeishuCard(data)]) {
    const content = card.elements[0].text.content;
    assert.equal((content.match(/⚠️ 同名分组/g) || []).length, 2);
    assert.match(content, /B0GROUPA01/);
    assert.match(content, /B0GROUPB01/);
  }
});
