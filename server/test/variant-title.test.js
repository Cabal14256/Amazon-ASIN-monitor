const assert = require('node:assert/strict');
const test = require('node:test');

const {
  applyParentTitleGate,
  hasConcreteTitle,
} = require('../src/utils/variantTitle');
const { extractProductTitle } = require('../src/services/htmlScraperService');
const {
  buildVariantViewFromResult,
} = require('../src/services/variantCheckResultMapper');

test('父体标题必须是非空文本', () => {
  assert.equal(hasConcreteTitle(undefined), false);
  assert.equal(hasConcreteTitle(null), false);
  assert.equal(hasConcreteTitle(''), false);
  assert.equal(hasConcreteTitle('   '), false);
  assert.equal(hasConcreteTitle('父体商品标题'), true);
});

test('存在父ASIN时，父体标题为空会否决有变体判断', () => {
  assert.equal(applyParentTitleGate(true, 'B000000001', ''), false);
  assert.equal(applyParentTitleGate(true, 'B000000001', '  '), false);
  assert.equal(applyParentTitleGate(true, 'B000000001', '父体商品标题'), true);
});

test('没有父ASIN时保持原有关系判断', () => {
  assert.equal(applyParentTitleGate(true, null, ''), true);
  assert.equal(applyParentTitleGate(false, null, ''), false);
});

test('HTML兜底可以提取商品标题并去除空白', () => {
  assert.equal(
    extractProductTitle(
      '<span id="productTitle">  Parent <b>Product</b>&nbsp; </span>',
    ),
    'Parent Product',
  );
  assert.equal(extractProductTitle('<span id="other">Title</span>'), '');
});

test('变体结果展示层沿用父体标题门槛', () => {
  const base = {
    isBroken: true,
    details: {
      hasVariants: false,
      details: {
        asin: 'B000000002',
        parentAsin: 'B000000001',
        parentTitle: '',
        variations: [],
        relationships: [],
      },
    },
  };

  assert.equal(buildVariantViewFromResult(base).hasVariation, false);
  assert.equal(
    buildVariantViewFromResult({
      ...base,
      details: {
        ...base.details,
        hasVariants: true,
        details: {
          ...base.details.details,
          parentTitle: '父体商品标题',
        },
      },
    }).hasVariation,
    true,
  );
});
