const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const mainDatabase = require('../src/config/database');
const { closeRedis } = require('../src/config/redis');
const {
  ASIN_INSERT_COLUMNS,
  ASIN_SCHEMA_CONTRACT_ERROR_CODE,
  assertAsinInsertSchemaCompatible,
  batchCreateASINs,
} = require('../src/services/asinBatchCreateService');

test.after(async () => {
  await closeRedis();
});

function column(name, overrides = {}) {
  return {
    COLUMN_NAME: name,
    IS_NULLABLE: 'YES',
    COLUMN_DEFAULT: null,
    EXTRA: '',
    ...overrides,
  };
}

function compatibleMainColumns(extra = []) {
  return [
    ...ASIN_INSERT_COLUMNS.asin.map((name) =>
      column(name, { IS_NULLABLE: 'NO' }),
    ),
    ...extra,
  ];
}

async function withMainDatabaseStubs(stubs, callback) {
  const original = {
    query: mainDatabase.query,
    withTransaction: mainDatabase.withTransaction,
  };
  Object.assign(mainDatabase, stubs);
  try {
    return await callback();
  } finally {
    Object.assign(mainDatabase, original);
  }
}

test('schema 契约接受兼容结构并忽略生成列', async () => {
  await withMainDatabaseStubs(
    {
      query: async () =>
        compatibleMainColumns([
          column('derived_key', {
            IS_NULLABLE: 'NO',
            EXTRA: 'VIRTUAL GENERATED',
          }),
        ]),
    },
    async () => {
      const result = await assertAsinInsertSchemaCompatible('asin');
      assert.equal(result.table, 'asins');
      assert.deepEqual(result.insertColumns, ASIN_INSERT_COLUMNS.asin);
    },
  );
});

test('schema 契约拒绝 INSERT 未提供的必填无默认字段', async () => {
  await withMainDatabaseStubs(
    {
      query: async () =>
        compatibleMainColumns([
          column('asin_note', { IS_NULLABLE: 'NO' }),
          column('parent_title', { IS_NULLABLE: 'NO' }),
        ]),
    },
    async () => {
      await assert.rejects(
        assertAsinInsertSchemaCompatible('asin'),
        (error) => {
          assert.equal(error.code, ASIN_SCHEMA_CONTRACT_ERROR_CODE);
          assert.equal(error.table, 'asins');
          assert.deepEqual(error.fields, ['asin_note', 'parent_title']);
          return true;
        },
      );
    },
  );
});

test('schema 契约拒绝目标表及 INSERT 列缺失', async () => {
  await withMainDatabaseStubs({ query: async () => [] }, async () => {
    await assert.rejects(assertAsinInsertSchemaCompatible('asin'), (error) => {
      assert.equal(error.code, ASIN_SCHEMA_CONTRACT_ERROR_CODE);
      assert.equal(error.details.tableMissing, true);
      assert.deepEqual(error.fields, ASIN_INSERT_COLUMNS.asin);
      return true;
    });
  });
});

test('schema 契约单独报告缺失的 INSERT 列', async () => {
  await withMainDatabaseStubs(
    {
      query: async () =>
        compatibleMainColumns().filter(
          (currentColumn) => currentColumn.COLUMN_NAME !== 'brand',
        ),
    },
    async () => {
      await assert.rejects(
        assertAsinInsertSchemaCompatible('asin'),
        (error) => {
          assert.equal(error.code, ASIN_SCHEMA_CONTRACT_ERROR_CODE);
          assert.equal(error.details.tableMissing, false);
          assert.deepEqual(error.fields, ['brand']);
          return true;
        },
      );
    },
  );
});

test('系统性 INSERT 错误立即中止且不逐行重试', async () => {
  let insertAttempts = 0;
  await withMainDatabaseStubs(
    {
      query: async () => compatibleMainColumns(),
      withTransaction: async (handler) =>
        handler({
          query: async (sql) => {
            if (sql.startsWith('SELECT id, country')) {
              return [{ id: 'group-1', country: 'US' }];
            }
            if (sql.startsWith('SELECT asin, country')) return [];
            if (sql.startsWith('INSERT INTO asins')) {
              insertAttempts += 1;
              const error = new Error('no default');
              error.code = 'ER_NO_DEFAULT_FOR_FIELD';
              throw error;
            }
            return [];
          },
        }),
    },
    async () => {
      await assert.rejects(
        batchCreateASINs({
          items: [
            {
              asin: 'B000000001',
              country: 'US',
              site: '12',
              brand: 'Brand',
              parentId: 'group-1',
            },
          ],
          clearCache: false,
        }),
        { code: 'ER_NO_DEFAULT_FOR_FIELD' },
      );
      assert.equal(insertAttempts, 1);
    },
  );
});

test('重复键分块失败时逐行降级并保留其他成功行', async () => {
  let insertAttempts = 0;
  await withMainDatabaseStubs(
    {
      query: async () => compatibleMainColumns(),
      withTransaction: async (handler) =>
        handler({
          query: async (sql, params) => {
            if (sql.startsWith('SELECT id, country')) {
              return [{ id: 'group-1', country: 'US' }];
            }
            if (sql.startsWith('SELECT asin, country')) return [];
            if (sql.startsWith('INSERT INTO asins')) {
              insertAttempts += 1;
              if (params.length > ASIN_INSERT_COLUMNS.asin.length) {
                const error = new Error('duplicate chunk');
                error.code = 'ER_DUP_ENTRY';
                throw error;
              }
              if (params[1] === 'B000000002') {
                const error = new Error('duplicate row');
                error.code = 'ER_DUP_ENTRY';
                throw error;
              }
            }
            return [];
          },
        }),
    },
    async () => {
      const result = await batchCreateASINs({
        items: ['B000000001', 'B000000002'].map((asin) => ({
          asin,
          country: 'US',
          site: '12',
          brand: 'Brand',
          parentId: 'group-1',
        })),
        clearCache: false,
      });
      assert.equal(insertAttempts, 3);
      assert.equal(result.successCount, 1);
      assert.equal(result.failedCount, 1);
    },
  );
});

test('文件导入在任何变体组查询或创建前执行 schema 契约', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../src/services/importService.js'),
    'utf8',
  );
  const functionStart = source.indexOf('async function importFromFile');
  const contractCheck = source.indexOf(
    'await assertAsinInsertSchemaCompatible(',
    functionStart,
  );
  const groupLookup = source.indexOf(
    'models.VariantGroupModel.findExactMatch',
    functionStart,
  );
  assert.ok(contractCheck > functionStart);
  assert.ok(contractCheck < groupLookup);
});
