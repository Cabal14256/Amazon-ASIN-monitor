process.env.LOG_LEVEL = 'ERROR';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildASINNotFoundResult,
  isCatalogItemNotFoundError,
} = require('../src/utils/spApiError');
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
      errorCode: 'NOT_FOUND',
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
