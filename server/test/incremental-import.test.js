process.env.LOG_LEVEL = 'ERROR';
process.env.IMPORT_PARSE_WORKER_ENABLED = 'true';

const assert = require('node:assert/strict');
const test = require('node:test');
const { Readable } = require('node:stream');
const ExcelJS = require('exceljs');
const redisConfig = require('../src/config/redis');
const cacheService = require('../src/services/cacheService');

const {
  parseIncrementalImportFile,
} = require('../src/services/importParserService');
const { parseImportPayload } = require('../src/services/importService');
const {
  planIncrementalImport,
  createIncrementalPreview,
  applyIncrementalImport,
} = require('../src/services/incrementalImportService');
const {
  createPreview: savePreview,
  getPreviewPage,
  getPreviewFile,
} = require('../src/services/incrementalImportPreviewStore');
const {
  normalizeImportTaskResult,
} = require('../src/services/taskResultService');

function inputRow(overrides = {}) {
  return {
    rowNumber: 2,
    groupId: '',
    groupName: '原组',
    country: 'US',
    site: '店铺 A',
    brand: '品牌 A',
    asin: 'B000000001',
    name: '商品一',
    asinType: '1',
    errors: [],
    ...overrides,
  };
}

function group(overrides = {}) {
  return {
    id: 'group-old',
    name: '原组',
    country: 'US',
    site: '店铺 A',
    brand: '品牌 A',
    ...overrides,
  };
}

function asin(overrides = {}) {
  return {
    id: 'asin-stable-id',
    asin: 'B000000001',
    name: '商品一',
    asin_type: '1',
    country: 'US',
    site: '店铺 A',
    brand: '品牌 A',
    variant_group_id: 'group-old',
    is_broken: 1,
    manual_broken: 1,
    feishu_notify_enabled: 0,
    ...overrides,
  };
}

function makePlan(rows, options = {}) {
  return planIncrementalImport(
    { rows, totalDataRows: rows.length },
    {
      groups: options.groups || [],
      asins: options.asins || [],
      mode: options.mode || 'standard',
    },
  );
}

function fakeDatabase({
  mode = 'standard',
  groups = [],
  asins = [],
  failMutationAt = 0,
} = {}) {
  const groupTable =
    mode === 'standard' ? 'variant_groups' : 'competitor_variant_groups';
  const asinTable = mode === 'standard' ? 'asins' : 'competitor_asins';
  let state = {
    groups: structuredClone(groups),
    asins: structuredClone(asins),
    receipts: [],
    history: [{ id: 'history-untouched', asin_id: 'asin-stable-id' }],
  };
  let mutationCount = 0;
  let commitCount = 0;
  const writes = [];

  async function query(sql, params = []) {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    if (normalized.startsWith('SELECT file_hash, digest, result_json')) {
      return state.receipts.filter((item) => item.preview_id === params[0]);
    }
    if (
      normalized.startsWith('SELECT') &&
      normalized.includes(`FROM ${groupTable}`)
    ) {
      if (normalized.includes('WHERE id IN')) {
        return structuredClone(
          state.groups.filter((item) => params.includes(item.id)),
        );
      }
      const width = mode === 'standard' ? 4 : 3;
      return structuredClone(
        state.groups.filter((item) => {
          for (let index = 0; index < params.length; index += width) {
            if (
              item.name === params[index] &&
              item.country === params[index + 1] &&
              (mode === 'competitor' || item.site === params[index + 2]) &&
              item.brand === params[index + width - 1]
            )
              return true;
          }
          return false;
        }),
      );
    }
    if (
      normalized.startsWith('SELECT') &&
      normalized.includes(`FROM ${asinTable}`)
    ) {
      return structuredClone(
        state.asins.filter((item) => {
          for (let index = 0; index < params.length; index += 2) {
            if (
              String(item.asin).toUpperCase() ===
                String(params[index]).toUpperCase() &&
              String(item.country).toUpperCase() ===
                String(params[index + 1]).toUpperCase()
            )
              return true;
          }
          return false;
        }),
      );
    }

    mutationCount += 1;
    writes.push({ sql: normalized, params: structuredClone(params) });
    if (mutationCount === failMutationAt)
      throw new Error('simulated write failure');
    if (normalized.startsWith('INSERT INTO import_confirmation_receipts')) {
      state.receipts.push({
        preview_id: params[0],
        file_hash: params[1],
        digest: params[2],
        result_json: params[3],
      });
      return { affectedRows: 1 };
    }
    const insert = normalized.match(/^INSERT INTO (\w+) \(([^)]+)\) VALUES/);
    if (insert) {
      const item = Object.fromEntries(
        insert[2]
          .split(',')
          .map((column, index) => [column.trim(), params[index]]),
      );
      if (insert[1] === groupTable) state.groups.push(item);
      else if (insert[1] === asinTable) {
        state.asins.push({
          is_broken: 0,
          manual_broken: 0,
          feishu_notify_enabled: 1,
          ...item,
        });
      } else throw new Error(`Unexpected insert: ${normalized}`);
      return { affectedRows: 1 };
    }
    const update = normalized.match(/^UPDATE (\w+) SET (.+) WHERE id = \?$/);
    if (update) {
      const collection = update[1] === groupTable ? state.groups : state.asins;
      const item = collection.find((entry) => entry.id === params.at(-1));
      assert.ok(item, `Missing update target for ${normalized}`);
      const fields = update[2]
        .split(', ')
        .filter((field) => field !== 'update_time = NOW()');
      fields.forEach((field, index) => {
        const match = field.match(/^(\w+) = \?$/);
        assert.ok(match, `Unexpected update assignment: ${field}`);
        item[match[1]] = params[index];
      });
      return { affectedRows: 1 };
    }
    if (
      normalized.startsWith(
        `UPDATE ${groupTable} SET update_time = NOW() WHERE id IN`,
      )
    ) {
      return { affectedRows: params.length };
    }
    throw new Error(`Unexpected SQL: ${normalized}`);
  }

  return {
    get state() {
      return state;
    },
    get commitCount() {
      return commitCount;
    },
    writes,
    query,
    async withTransaction(callback) {
      const before = structuredClone(state);
      try {
        const result = await callback({ query });
        commitCount += 1;
        return result;
      } catch (error) {
        state = before;
        throw error;
      }
    },
  };
}

function transactionFile(mode, entries) {
  const headers =
    mode === 'standard'
      ? [
          '变体组名称',
          '变体组ID',
          '国家',
          '站点',
          '品牌',
          'ASIN',
          'ASIN名称',
          'ASIN类型',
        ]
      : [
          '变体组名称',
          '变体组ID',
          '国家',
          '品牌',
          'ASIN',
          'ASIN名称',
          'ASIN类型',
        ];
  const rows = entries.map((entry) =>
    mode === 'standard'
      ? [
          entry.groupName ?? '原组',
          entry.groupId ?? '',
          entry.country ?? 'US',
          entry.site ?? '店铺 A',
          entry.brand ?? '品牌 A',
          entry.asin ?? 'B000000001',
          entry.name ?? '商品一',
          entry.asinType ?? '1',
        ]
      : [
          entry.groupName ?? '原组',
          entry.groupId ?? '',
          entry.country ?? 'US',
          entry.brand ?? '品牌 A',
          entry.asin ?? 'B000000001',
          entry.name ?? '商品一',
          entry.asinType ?? '1',
        ],
  );
  return csvFile(headers, rows);
}

function fakeRedis() {
  const values = new Map();
  const expirations = new Map();
  const client = {
    values,
    expirations,
    async ping() {
      return 'PONG';
    },
    async set(key, value, expiryKeyword, seconds) {
      values.set(key, value);
      if (expiryKeyword === 'EX') expirations.set(key, seconds);
      return 'OK';
    },
    async get(key) {
      return values.get(key) ?? null;
    },
    async getBuffer(key) {
      return values.get(key) ?? null;
    },
    async rpush(key, ...items) {
      values.set(key, [...(values.get(key) || []), ...items]);
      return values.get(key).length;
    },
    async expire(key, seconds) {
      expirations.set(key, seconds);
      return 1;
    },
    async lrange(key, first, last) {
      return (values.get(key) || []).slice(first, last + 1);
    },
    pipeline() {
      const commands = [];
      const pipeline = {
        set(...args) {
          commands.push(() => client.set(...args));
          return pipeline;
        },
        rpush(...args) {
          commands.push(() => client.rpush(...args));
          return pipeline;
        },
        expire(...args) {
          commands.push(() => client.expire(...args));
          return pipeline;
        },
        async exec() {
          const results = [];
          for (const command of commands) {
            try {
              results.push([null, await command()]);
            } catch (error) {
              results.push([error, null]);
            }
          }
          return results;
        },
      };
      return pipeline;
    },
  };
  return client;
}

function loadModuleWithMocks(targetModule, mockModules) {
  const controllerPath = require.resolve(targetModule);
  const modules = Object.entries(mockModules).map(([modulePath, exports]) => ({
    filename: require.resolve(modulePath),
    exports,
  }));
  const saved = modules.map(({ filename }) => require.cache[filename]);
  const savedController = require.cache[controllerPath];
  try {
    modules.forEach(({ filename, exports }) => {
      require.cache[filename] = {
        id: filename,
        filename,
        loaded: true,
        exports,
      };
    });
    delete require.cache[controllerPath];
    return require(controllerPath);
  } finally {
    modules.forEach(({ filename }, index) => {
      if (saved[index]) require.cache[filename] = saved[index];
      else delete require.cache[filename];
    });
    if (savedController) require.cache[controllerPath] = savedController;
    else delete require.cache[controllerPath];
  }
}

function loadControllerWithMocks(mockModules) {
  return loadModuleWithMocks(
    '../src/controllers/incrementalImportController',
    mockModules,
  );
}

function mockResponse() {
  return {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function csvFile(headers, rows) {
  const quote = (value) => {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const content = [headers, ...rows]
    .map((row) => row.map(quote).join(','))
    .join('\r\n');
  return {
    originalname: 'import.csv',
    buffer: Buffer.from(`\uFEFF${content}`, 'utf8'),
  };
}

async function xlsxFile(headers, rows) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('导出');
  worksheet.addRow(headers);
  rows.forEach((row, index) => {
    worksheet.getRow(index + 2).values = row;
  });
  return {
    originalname: 'export.xlsx',
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
  };
}

test('主营旧 CSV 模板按表头解析 ASIN、国家和可选字段', async () => {
  const parsed = await parseIncrementalImportFile(
    csvFile(
      ['变体组名称', '国家', '站点', '品牌', 'ASIN', 'ASIN名称', 'ASIN类型'],
      [['夏季款', 'us', '店铺 A', '品牌 A', 'b000000001', '商品一', '1']],
    ),
    { mode: 'standard' },
  );

  assert.equal(parsed.totalDataRows, 1);
  assert.equal(parsed.rows.length, 1);
  assert.deepEqual(parsed.rows[0].errors, []);
  assert.equal(parsed.rows[0].rowNumber, 2);
  assert.equal(parsed.rows[0].groupName, '夏季款');
  assert.equal(parsed.rows[0].country, 'US');
  assert.equal(parsed.rows[0].site, '店铺 A');
  assert.equal(parsed.rows[0].brand, '品牌 A');
  assert.equal(parsed.rows[0].asin, 'B000000001');
  assert.equal(parsed.rows[0].name, '商品一');
  assert.equal(parsed.rows[0].asinType, '1');
  assert.ok(!parsed.rows[0].groupId);
});

test('主营导出 XLSX 的状态列不干扰解析，空组行仍保留', async () => {
  const parsed = await parseIncrementalImportFile(
    await xlsxFile(
      [
        'ASIN类型',
        '站点',
        'ASIN',
        '变体组ID',
        '品牌',
        'ASIN状态',
        '国家',
        '变体组名称',
        'ASIN名称',
        '创建时间',
      ],
      [
        [
          '2',
          '店铺 B',
          'B000000002',
          'group-1',
          '品牌 B',
          '正常',
          'UK',
          '冬季款',
          '商品二',
          '2026-01-01',
        ],
        [
          '',
          '店铺 C',
          '',
          'group-2',
          '品牌 C',
          '异常',
          'DE',
          '空组',
          '',
          '2026-01-01',
        ],
      ],
    ),
    { mode: 'standard' },
  );

  assert.equal(parsed.totalDataRows, 2);
  assert.equal(parsed.rows.length, 2);
  assert.deepEqual(
    parsed.rows.map((row) => row.rowNumber),
    [2, 3],
  );
  assert.deepEqual(
    parsed.rows.map((row) => row.errors),
    [[], []],
  );
  assert.equal(parsed.rows[0].groupId, 'group-1');
  assert.equal(parsed.rows[0].groupName, '冬季款');
  assert.equal(parsed.rows[0].asin, 'B000000002');
  assert.equal(parsed.rows[0].asinType, '2');
  assert.equal(parsed.rows[1].groupId, 'group-2');
  assert.equal(parsed.rows[1].asin, '');
});

test('竞品旧 CSV 与导出 XLSX 均不要求站点，导出空组可解析', async () => {
  const legacy = await parseIncrementalImportFile(
    csvFile(
      ['品牌', 'ASIN', '变体组名称', '国家', 'ASIN名称'],
      [['品牌 C', 'B000000003', '竞品组', 'fr', '竞品商品']],
    ),
    { mode: 'competitor' },
  );
  assert.equal(legacy.rows[0].country, 'FR');
  assert.equal(legacy.rows[0].asin, 'B000000003');
  assert.equal(legacy.rows[0].groupName, '竞品组');
  assert.deepEqual(legacy.rows[0].errors, []);

  const exported = await parseIncrementalImportFile(
    await xlsxFile(
      [
        'ASIN',
        '变体组ID',
        '国家',
        '品牌',
        '变体状态',
        '变体组名称',
        'ASIN名称',
      ],
      [
        [
          'B000000004',
          'competitor-1',
          'IT',
          '品牌 D',
          '正常',
          '竞品组二',
          '商品四',
        ],
        ['', 'competitor-2', 'ES', '品牌 E', '正常', '竞品空组', ''],
      ],
    ),
    { mode: 'competitor' },
  );
  assert.deepEqual(
    exported.rows.map((row) => row.errors),
    [[], []],
  );
  assert.equal(exported.rows[0].groupId, 'competitor-1');
  assert.equal(exported.rows[1].groupId, 'competitor-2');
  assert.equal(exported.rows[1].asin, '');
});

test(
  '真实解析 Worker 可处理两类 XLSX 增量预览载荷',
  { timeout: 15000 },
  async () => {
    for (const mode of ['standard', 'competitor']) {
      const headers =
        mode === 'standard'
          ? ['变体组ID', 'ASIN', '国家', '品牌', '站点', '变体组名称']
          : ['变体组ID', 'ASIN', '国家', '品牌', '变体组名称'];
      const row =
        mode === 'standard'
          ? ['group-worker', 'B000000071', 'US', '品牌 A', '店铺 A', 'Worker组']
          : ['group-worker', 'B000000071', 'US', '品牌 A', 'Worker组'];
      const parsed = await parseImportPayload(await xlsxFile(headers, [row]), {
        mode,
        kind: 'incremental',
      });
      assert.equal(parsed.rows.length, 1);
      assert.equal(parsed.rows[0].rowNumber, 2);
      assert.equal(parsed.rows[0].groupId, 'group-worker');
      assert.equal(parsed.rows[0].asin, 'B000000071');
      assert.deepEqual(parsed.rows[0].errors, []);
    }
  },
);

test('竞品 CSV 预览上传接受通用二进制与 Excel MIME', async () => {
  const noOp = (_req, _res, next) => next?.();
  const router = loadModuleWithMocks('../src/routes/competitorAsinRoutes', {
    '../src/controllers/competitorAsinController': new Proxy(
      {},
      {
        get: () => noOp,
      },
    ),
    '../src/controllers/incrementalImportController': {
      handlersForMode: () => ({
        preview: noOp,
        readPreview: noOp,
        confirm: noOp,
      }),
    },
    '../src/middleware/auth': {
      authenticateToken: noOp,
      checkPermission: () => noOp,
    },
  });
  const route = router.stack.find(
    (layer) =>
      layer.route?.path === '/competitor/variant-groups/import-excel/preview',
  );
  assert.ok(route);
  const uploadMiddleware = route.route.stack[1].handle;

  for (const mimetype of [
    'application/octet-stream',
    'application/vnd.ms-excel',
  ]) {
    const boundary = `----asin-preview-${mimetype.replaceAll('/', '-')}`;
    const csv = '变体组名称,国家,品牌,ASIN\n竞品组,US,品牌 A,B000000081';
    const body = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="import.csv"\r\nContent-Type: ${mimetype}\r\n\r\n${csv}\r\n--${boundary}--\r\n`,
    );
    const req = Readable.from([body]);
    req.method = 'POST';
    req.headers = {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': String(body.length),
    };
    const res = mockResponse();
    const outcome = await new Promise((resolve) => {
      res.json = (payload) => {
        res.body = payload;
        resolve('response');
        return res;
      };
      uploadMiddleware(req, res, () => resolve('next'));
    });
    assert.equal(
      outcome,
      'next',
      `${mimetype}: ${res.body?.errorMessage || ''}`,
    );
    assert.equal(req.file.mimetype, mimetype);
    const parsed = await parseIncrementalImportFile(req.file, {
      mode: 'competitor',
    });
    assert.equal(parsed.rows[0].asin, 'B000000081');
    assert.deepEqual(parsed.rows[0].errors, []);
  }
});

test('无效行保留原始行号，其他行仍可进入预览', async () => {
  const parsed = await parseIncrementalImportFile(
    csvFile(
      ['变体组名称', '国家', '站点', '品牌', 'ASIN', 'ASIN类型'],
      [
        ['一组', 'US', '店铺 A', '品牌 A', 'B000000005', '1'],
        ['二组', 'XX', '店铺 B', '品牌 B', 'B000000006', '1'],
        ['三组', 'DE', '店铺 C', '品牌 C', 'B000000007', '9'],
      ],
    ),
    { mode: 'standard' },
  );

  assert.deepEqual(
    parsed.rows.map((row) => row.rowNumber),
    [2, 3, 4],
  );
  assert.deepEqual(
    parsed.rows.map((row) => row.errors.length > 0),
    [false, true, true],
  );
  assert.match(parsed.rows[1].errors.join(' '), /国家/);
  assert.match(parsed.rows[2].errors.join(' '), /类型/);
});

for (const mode of ['standard', 'competitor']) {
  test(`${mode} 相同文件再次上传应全部未变化且无写入操作`, () => {
    const planned = makePlan(
      [inputRow(mode === 'competitor' ? { site: '' } : {})],
      {
        mode,
        groups: [group(mode === 'competitor' ? { site: undefined } : {})],
        asins: [asin(mode === 'competitor' ? { site: undefined } : {})],
      },
    );

    assert.equal(planned.rows[0].action, 'unchanged');
    assert.equal(planned.summary.unchangedCount, 1);
    assert.equal(planned.summary.createdCount, 0);
    assert.equal(planned.summary.updatedCount, 0);
    assert.equal(planned.summary.processedCount, 1);
    assert.equal(planned.summary.missingCount, 0);
    assert.equal(planned.summary.verificationPassed, true);
    for (const operation of Object.values(planned.operations)) {
      assert.deepEqual(operation, []);
    }
  });

  test(`${mode} 组 ID 行留空时保留现有 ASIN 的空站点和品牌`, () => {
    for (const blank of [null, '']) {
      const planned = makePlan(
        [inputRow({ groupId: 'group-old', site: '', brand: '' })],
        {
          mode,
          groups: [group()],
          asins: [asin({ site: blank, brand: blank })],
        },
      );

      assert.equal(planned.rows[0].action, 'unchanged');
      assert.equal(planned.summary.updatedCount, 0);
      assert.equal(planned.operations.asinUpdates.length, 0);
      assert.equal(planned.rows[0].target.asin.brand, blank);
      if (mode === 'standard') {
        assert.equal(planned.rows[0].target.asin.site, blank);
      }
    }
  });

  test(`${mode} 新 ASIN 的空站点和品牌仍沿用已有组属性`, () => {
    const planned = makePlan(
      [
        inputRow({
          groupId: 'group-old',
          asin: 'B000000002',
          site: '',
          brand: '',
        }),
      ],
      { mode, groups: [group()], asins: [asin()] },
    );

    assert.equal(planned.rows[0].action, 'create');
    assert.equal(planned.operations.asinCreates[0].brand, '品牌 A');
    if (mode === 'standard') {
      assert.equal(planned.operations.asinCreates[0].site, '店铺 A');
    }
  });

  test(`${mode} 同 ASIN 新国家新增，已有国家记录保留`, () => {
    const planned = makePlan(
      [inputRow({ country: 'UK', groupName: '英国组' })],
      {
        mode,
        groups: [group(mode === 'competitor' ? { site: undefined } : {})],
        asins: [asin(mode === 'competitor' ? { site: undefined } : {})],
      },
    );

    assert.equal(planned.rows[0].action, 'create');
    assert.equal(planned.summary.createdCount, 1);
    assert.equal(planned.operations.asinCreates.length, 1);
    assert.equal(planned.operations.asinCreates[0].country, 'UK');
    assert.equal(planned.operations.asinUpdates.length, 0);
  });

  test(`${mode} 同国家跨组移动保留 ASIN ID 并计入更新`, () => {
    const destination = group({ id: 'group-target', name: '目标组' });
    const planned = makePlan(
      [inputRow({ groupId: 'group-target', groupName: '目标组' })],
      {
        mode,
        groups: [group(), destination],
        asins: [asin()],
      },
    );

    assert.equal(planned.rows[0].action, 'move');
    assert.equal(planned.rows[0].current.group.id, 'group-old');
    assert.equal(planned.rows[0].target.group.id, 'group-target');
    assert.equal(planned.summary.movedCount, 1);
    assert.equal(planned.summary.updatedCount, 1);
    assert.equal(planned.operations.asinCreates.length, 0);
    assert.equal(planned.operations.asinUpdates.length, 1);
    assert.equal(planned.operations.asinUpdates[0].id, 'asin-stable-id');
  });

  test(`${mode} 组 ID 可仅凭空组行更新元数据，不改文件外成员`, () => {
    const planned = makePlan(
      [
        inputRow({
          groupId: 'group-old',
          groupName: '组新名',
          brand: '新品牌',
          site: mode === 'competitor' ? '' : '店铺 B',
          asin: '',
          name: '',
          asinType: '',
        }),
      ],
      {
        mode,
        groups: [group()],
        asins: [asin(), asin({ id: 'file-outside-asin', asin: 'B000000009' })],
      },
    );

    assert.equal(planned.rows[0].action, 'group-update');
    assert.equal(planned.summary.updatedGroupCount, 1);
    assert.equal(planned.summary.groupOnlyCount, 1);
    assert.equal(planned.operations.groupUpdates.length, 1);
    assert.equal(planned.operations.groupUpdates[0].id, 'group-old');
    assert.equal(planned.operations.asinUpdates.length, 0);
  });
}

test('不存在或跨国的变体组 ID 分别跳过并保留行号', () => {
  const planned = makePlan(
    [
      inputRow({ rowNumber: 4, groupId: 'missing', asin: 'B000000004' }),
      inputRow({
        rowNumber: 9,
        groupId: 'group-old',
        country: 'DE',
        asin: 'B000000009',
      }),
    ],
    { groups: [group()] },
  );

  assert.deepEqual(
    planned.rows.map((row) => row.action),
    ['skipped', 'skipped'],
  );
  assert.deepEqual(
    planned.rows.map((row) => row.rowNumber),
    [4, 9],
  );
  assert.equal(planned.summary.failedCount, 2);
  assert.equal(planned.operations.asinCreates.length, 0);
});

test('无组 ID 且数据库存在多个完全匹配组时报歧义', () => {
  const planned = makePlan([inputRow()], {
    groups: [group(), group({ id: 'group-duplicate' })],
  });

  assert.equal(planned.rows[0].action, 'skipped');
  assert.match(planned.rows[0].errors.join(' '), /多个|歧义|重复/);
  assert.equal(planned.operations.asinCreates.length, 0);
});

test('数据库重复组可由显式组 ID 消歧，未指定 ID 仍报歧义', () => {
  const groups = [group(), group({ id: 'group-duplicate' })];
  const explicit = makePlan([inputRow({ groupId: 'group-old' })], { groups });
  const implicit = makePlan([inputRow()], { groups });

  assert.equal(explicit.rows[0].action, 'create');
  assert.equal(explicit.operations.asinCreates.length, 1);
  assert.equal(implicit.rows[0].action, 'skipped');
  assert.equal(implicit.operations.asinCreates.length, 0);
});

test('同一 ASIN 与国家指向不同组时，两行都跳过', () => {
  const planned = makePlan(
    [
      inputRow({ rowNumber: 2, groupId: 'group-old' }),
      inputRow({ rowNumber: 5, groupId: 'group-target', groupName: '目标组' }),
    ],
    {
      groups: [group(), group({ id: 'group-target', name: '目标组' })],
      asins: [asin()],
    },
  );

  assert.deepEqual(
    planned.rows.map((row) => row.action),
    ['skipped', 'skipped'],
  );
  assert.deepEqual(
    planned.rows.map((row) => row.rowNumber),
    [2, 5],
  );
  assert.equal(planned.summary.failedCount, 2);
  assert.equal(planned.operations.asinUpdates.length, 0);
});

test('同一 ASIN 的另一组 ID 不存在时，有效组行也必须跳过', () => {
  const planned = makePlan(
    [
      inputRow({ rowNumber: 2, groupId: 'group-old' }),
      inputRow({ rowNumber: 7, groupId: 'missing' }),
    ],
    { groups: [group()] },
  );

  assert.deepEqual(
    planned.rows.map((row) => row.action),
    ['skipped', 'skipped'],
  );
  assert.equal(planned.operations.asinCreates.length, 0);
  assert.equal(planned.summary.failedCount, 2);
});

test('同一组 ID 的目标属性互相矛盾时，所有相关行均跳过', () => {
  const planned = makePlan(
    [
      inputRow({ rowNumber: 2, groupId: 'group-old' }),
      inputRow({
        rowNumber: 3,
        groupId: 'group-old',
        brand: '另一品牌',
        asin: 'B000000002',
      }),
    ],
    { groups: [group()], asins: [asin()] },
  );

  assert.deepEqual(
    planned.rows.map((row) => row.action),
    ['skipped', 'skipped'],
  );
  assert.equal(planned.operations.groupUpdates.length, 0);
  assert.equal(planned.operations.asinCreates.length, 0);
  assert.equal(planned.operations.asinUpdates.length, 0);
});

test('按组 ID 更名不能占用另一个现有组的自然键', () => {
  const planned = makePlan(
    [inputRow({ groupId: 'group-old', groupName: '已有组' })],
    { groups: [group(), group({ id: 'group-other', name: '已有组' })] },
  );

  assert.equal(planned.rows[0].action, 'skipped');
  assert.match(planned.rows[0].errors.join(' '), /冲突/);
  assert.equal(planned.operations.groupUpdates.length, 0);
});

test('两个组 ID 指向同一新自然键时两者均跳过', () => {
  const planned = makePlan(
    [
      inputRow({
        rowNumber: 2,
        groupId: 'group-old',
        groupName: '共同名称',
        asin: 'B000000001',
      }),
      inputRow({
        rowNumber: 3,
        groupId: 'group-other',
        groupName: '共同名称',
        asin: 'B000000002',
      }),
    ],
    { groups: [group(), group({ id: 'group-other', name: '另一个组' })] },
  );

  assert.deepEqual(
    planned.rows.map((row) => row.action),
    ['skipped', 'skipped'],
  );
  assert.equal(planned.operations.groupUpdates.length, 0);
  assert.equal(planned.operations.asinCreates.length, 0);
});

test('无组 ID 行可匹配文件中按组 ID 更名的目标组，且只更新一个组', () => {
  const planned = makePlan(
    [
      inputRow({ rowNumber: 2, groupName: '组新名', asin: 'B000000002' }),
      inputRow({
        rowNumber: 3,
        groupId: 'group-old',
        groupName: '组新名',
        asin: 'B000000003',
      }),
    ],
    { groups: [group()] },
  );

  assert.deepEqual(
    planned.rows.map((row) => row.action),
    ['create', 'create'],
  );
  assert.deepEqual(
    planned.rows.map((row) => row.target.group.id),
    ['group-old', 'group-old'],
  );
  assert.equal(planned.operations.groupCreates.length, 0);
  assert.equal(planned.operations.groupUpdates.length, 1);
  assert.equal(planned.operations.groupUpdates[0].id, 'group-old');
});

test('解析错误行跳过，独立有效行仍正常新增，计数覆盖所有行', () => {
  const planned = makePlan(
    [
      inputRow({ rowNumber: 2, country: 'XX', errors: ['国家代码无效'] }),
      inputRow({ rowNumber: 6, asin: 'B000000006' }),
    ],
    { groups: [group()] },
  );

  assert.deepEqual(
    planned.rows.map((row) => row.action),
    ['skipped', 'create'],
  );
  assert.deepEqual(
    planned.rows.map((row) => row.rowNumber),
    [2, 6],
  );
  assert.equal(planned.summary.failedCount, 1);
  assert.equal(planned.summary.createdCount, 1);
  assert.equal(planned.summary.processedCount, 2);
  assert.equal(planned.summary.missingCount, 0);
  assert.equal(planned.summary.verificationPassed, true);
});

for (const mode of ['standard', 'competitor']) {
  test(`${mode} 确认后重试命中事务回执，不重复写入`, async () => {
    const db = fakeDatabase({ mode, groups: [group()] });
    const file = transactionFile(mode, [{ asin: 'B000000008' }]);
    const preview = await createIncrementalPreview(file, { mode, db });
    assert.equal(preview.summary.createdCount, 1);

    const first = await applyIncrementalImport(file, {
      mode,
      db,
      previewId: `retry-${mode}`,
      expectedDigest: preview.digest,
    });
    const writesAfterFirst = db.writes.length;
    const retry = await applyIncrementalImport(file, {
      mode,
      db,
      previewId: `retry-${mode}`,
      expectedDigest: preview.digest,
    });

    assert.deepEqual(retry, first);
    assert.equal(first.createdCount, 1);
    assert.equal(first.processedCount, 1);
    assert.equal(first.missingCount, 0);
    assert.equal(db.state.asins.length, 1);
    assert.equal(db.state.receipts.length, 1);
    assert.equal(db.writes.length, writesAfterFirst);
  });
}

for (const mode of ['standard', 'competitor']) {
  test(`${mode} 只在业务写入提交后清理对应组缓存`, async () => {
    const db = fakeDatabase({ mode, groups: [group()] });
    const file = transactionFile(mode, [{ asin: 'B000000008' }]);
    const preview = await createIncrementalPreview(file, { mode, db });
    const calls = [];
    const original = cacheService.deleteByPrefixAsync;
    cacheService.deleteByPrefixAsync = async (prefix) => {
      calls.push({ prefix, commitCount: db.commitCount });
    };
    try {
      await applyIncrementalImport(file, {
        mode,
        db,
        previewId: `cache-create-${mode}`,
        expectedDigest: preview.digest,
      });
      assert.deepEqual(calls, [
        {
          prefix:
            mode === 'standard' ? 'variantGroups:' : 'competitorVariantGroups:',
          commitCount: 1,
        },
      ]);

      await applyIncrementalImport(file, {
        mode,
        db,
        previewId: `cache-create-${mode}`,
        expectedDigest: preview.digest,
      });
      assert.equal(calls.length, 1, 'Receipt retry must not evict again');

      const unchanged = await createIncrementalPreview(file, { mode, db });
      assert.equal(unchanged.summary.unchangedCount, 1);
      await applyIncrementalImport(file, {
        mode,
        db,
        previewId: `cache-unchanged-${mode}`,
        expectedDigest: unchanged.digest,
      });
      assert.equal(calls.length, 1, 'Unchanged import must not evict');

      const staleFile = transactionFile(mode, [
        { asin: 'B000000008', name: '新名称' },
      ]);
      const stale = await createIncrementalPreview(staleFile, { mode, db });
      db.state.asins[0].name = '外部先改';
      await assert.rejects(
        applyIncrementalImport(staleFile, {
          mode,
          db,
          previewId: `cache-stale-${mode}`,
          expectedDigest: stale.digest,
        }),
        (error) => error.code === 'PREVIEW_STALE',
      );
      assert.equal(calls.length, 1, 'Stale import must not evict');
    } finally {
      cacheService.deleteByPrefixAsync = original;
    }
  });
}

for (const mode of ['standard', 'competitor']) {
  test(`${mode} 写入中途取消回滚全部记录且同一预览可重试`, async () => {
    const db = fakeDatabase({ mode, groups: [group()] });
    const file = transactionFile(
      mode,
      Array.from({ length: 30 }, (_, index) => ({
        asin: `B${String(index + 100).padStart(9, '0')}`,
      })),
    );
    const preview = await createIncrementalPreview(file, { mode, db });
    assert.equal(preview.summary.createdCount, 30);
    const cacheCalls = [];
    const original = cacheService.deleteByPrefixAsync;
    cacheService.deleteByPrefixAsync = async (prefix) => {
      cacheCalls.push(prefix);
    };
    const options = {
      mode,
      db,
      previewId: `cancel-mid-write-${mode}`,
      expectedDigest: preview.digest,
    };
    const asinTable = mode === 'standard' ? 'asins' : 'competitor_asins';
    try {
      await assert.rejects(
        applyIncrementalImport(file, {
          ...options,
          checkCancelled: async () => {
            if (
              db.writes.some(({ sql }) =>
                sql.startsWith(`INSERT INTO ${asinTable} `),
              )
            ) {
              const error = new Error('导入任务已取消');
              error.code = 'IMPORT_CANCELLED';
              throw error;
            }
          },
        }),
        (error) => error.code === 'IMPORT_CANCELLED',
      );
      assert.equal(db.commitCount, 0);
      assert.equal(db.state.asins.length, 0);
      assert.equal(db.state.receipts.length, 0);
      assert.deepEqual(cacheCalls, []);
      const attemptedAsinWrites = db.writes.filter(({ sql }) =>
        sql.startsWith(`INSERT INTO ${asinTable} `),
      ).length;
      assert.ok(attemptedAsinWrites > 0 && attemptedAsinWrites < 30);
      assert.ok(
        db.writes.every(
          ({ sql }) =>
            !sql.startsWith('INSERT INTO import_confirmation_receipts'),
        ),
      );

      const retried = await applyIncrementalImport(file, options);
      assert.equal(retried.createdCount, 30);
      assert.equal(db.commitCount, 1);
      assert.equal(db.state.asins.length, 30);
      assert.equal(db.state.receipts.length, 1);
      assert.deepEqual(cacheCalls, [
        mode === 'standard' ? 'variantGroups:' : 'competitorVariantGroups:',
      ]);

      const receiptRetry = await applyIncrementalImport(file, {
        ...options,
        checkCancelled: async () => {
          throw new Error('Receipt retries must not run cancellation checks');
        },
      });
      assert.deepEqual(receiptRetry, retried);
      assert.equal(db.state.asins.length, 30);
      assert.equal(db.state.receipts.length, 1);
      assert.equal(cacheCalls.length, 1);
    } finally {
      cacheService.deleteByPrefixAsync = original;
    }
  });
}

for (const mode of ['standard', 'competitor']) {
  test(`${mode} 已有小写 ASIN 与旧类型 MAIN_LINK 重传判未变化，不写业务数据`, async () => {
    const db = fakeDatabase({
      mode,
      groups: [group()],
      asins: [asin({ asin: 'b000000001', asin_type: 'MAIN_LINK' })],
    });
    const file = transactionFile(mode, [{ asin: 'B000000001', asinType: '1' }]);
    const preview = await createIncrementalPreview(file, { mode, db });

    assert.equal(preview.summary.unchangedCount, 1);
    assert.equal(preview.summary.updatedCount, 0);
    assert.equal(preview.rows[0].action, 'unchanged');
    const result = await applyIncrementalImport(file, {
      mode,
      db,
      previewId: `legacy-${mode}`,
      expectedDigest: preview.digest,
    });
    assert.equal(result.unchangedCount, 1);
    assert.equal(result.processedCount, 1);
    assert.equal(db.state.asins.length, 1);
    assert.equal(db.state.asins[0].asin, 'b000000001');
    assert.equal(db.state.asins[0].asin_type, 'MAIN_LINK');
    assert.ok(
      db.writes.every(({ sql }) =>
        sql.startsWith('INSERT INTO import_confirmation_receipts'),
      ),
    );

    const taskResult = normalizeImportTaskResult(result);
    assert.equal(taskResult.successCount, 1);
    assert.equal(taskResult.processedCount, 1);
    assert.equal(taskResult.unchangedCount, 1);
    assert.equal(taskResult.missingCount, 0);
    assert.equal(taskResult.verificationPassed, true);
  });
}

test('预览后相关 ASIN 被并发修改，确认返回过期且无写入', async () => {
  const db = fakeDatabase({ groups: [group()], asins: [asin()] });
  const file = transactionFile('standard', [{ name: '新商品名' }]);
  const preview = await createIncrementalPreview(file, { db });
  assert.equal(preview.summary.updatedCount, 1);
  db.state.asins[0].name = '别人先修改的名称';

  await assert.rejects(
    applyIncrementalImport(file, {
      db,
      previewId: 'stale-business-data',
      expectedDigest: preview.digest,
    }),
    (error) => error.code === 'PREVIEW_STALE' && error.statusCode === 409,
  );
  assert.deepEqual(db.writes, []);
  assert.equal(db.state.asins[0].name, '别人先修改的名称');
  assert.equal(db.state.receipts.length, 0);
});

test('确认时文件内容变化也判预览过期', async () => {
  const db = fakeDatabase({ groups: [group()] });
  const original = transactionFile('standard', [{ asin: 'B000000010' }]);
  const changed = transactionFile('standard', [{ asin: 'B000000011' }]);
  const preview = await createIncrementalPreview(original, { db });

  await assert.rejects(
    applyIncrementalImport(changed, {
      db,
      previewId: 'stale-file',
      expectedDigest: preview.digest,
    }),
    (error) => error.code === 'PREVIEW_STALE',
  );
  assert.equal(db.state.asins.length, 0);
  assert.equal(db.state.receipts.length, 0);
});

test('确认写入中途失败时回滚所有 ASIN 与回执', async () => {
  const db = fakeDatabase({ groups: [group()], failMutationAt: 2 });
  const file = transactionFile('standard', [
    { asin: 'B000000012' },
    { asin: 'B000000013' },
  ]);
  const preview = await createIncrementalPreview(file, { db });

  await assert.rejects(
    applyIncrementalImport(file, {
      db,
      previewId: 'rollback-write',
      expectedDigest: preview.digest,
    }),
    /simulated write failure/,
  );
  assert.equal(db.state.asins.length, 0);
  assert.equal(db.state.receipts.length, 0);
});

test('组 ID 更名与成员更新保留 ASIN ID、监控字段、文件外成员及历史', async () => {
  const untouched = asin({
    id: 'outside-file-id',
    asin: 'B000000099',
    name: '未上传成员',
  });
  const db = fakeDatabase({ groups: [group()], asins: [asin(), untouched] });
  const file = transactionFile('standard', [
    {
      groupId: 'group-old',
      groupName: '更新后的组',
      site: '店铺 B',
      brand: '新品牌',
      name: '更新后的商品',
    },
  ]);
  const beforeHistory = structuredClone(db.state.history);
  const beforeOutside = structuredClone(db.state.asins[1]);
  const preview = await createIncrementalPreview(file, { db });
  assert.equal(preview.summary.updatedGroupCount, 1);
  assert.equal(preview.summary.updatedCount, 1);

  await applyIncrementalImport(file, {
    db,
    previewId: 'partial-group-update',
    expectedDigest: preview.digest,
  });
  assert.equal(db.state.groups[0].name, '更新后的组');
  assert.equal(db.state.groups[0].site, '店铺 B');
  assert.equal(db.state.groups[0].brand, '新品牌');
  assert.equal(db.state.asins[0].id, 'asin-stable-id');
  assert.equal(db.state.asins[0].name, '更新后的商品');
  assert.equal(db.state.asins[0].is_broken, 1);
  assert.equal(db.state.asins[0].manual_broken, 1);
  assert.equal(db.state.asins[0].feishu_notify_enabled, 0);
  assert.deepEqual(db.state.asins[1], beforeOutside);
  assert.deepEqual(db.state.history, beforeHistory);
  assert.ok(
    db.writes.every(
      ({ sql }) => !/manual_broken|is_broken|feishu_notify_enabled/i.test(sql),
    ),
  );
});

test('Redis 预览分页、分类、用户和域隔离、文件读取及过期', async () => {
  const client = fakeRedis();
  const originalGetRedisClient = redisConfig.getRedisClient;
  redisConfig.getRedisClient = () => client;
  try {
    const rawFile = Buffer.from('original-upload-bytes');
    const rows = Array.from({ length: 120 }, (_, index) => ({
      rowNumber: index + 2,
      action: index % 2 === 0 ? 'create' : 'unchanged',
      asin: `B${String(index).padStart(9, '0')}`,
      country: 'US',
      current: null,
      target: { asin: `B${String(index).padStart(9, '0')}` },
      changes: [],
      errors: [],
    }));
    const initial = await savePreview({
      file: { originalname: 'upload.csv', buffer: rawFile },
      userId: 7,
      mode: 'standard',
      preview: {
        rows,
        digest: 'preview-digest',
        fileHash: 'file-hash',
        summary: { total: 120 },
      },
    });

    assert.equal(initial.rows.length, 50);
    assert.equal(initial.pagination.total, 120);
    assert.equal(initial.categoryCounts.create, 60);
    assert.equal(initial.categoryCounts.unchanged, 60);
    assert.equal(initial.rows[0].row, 2);
    const previewId = initial.previewId;
    const second = await getPreviewPage({
      previewId,
      userId: 7,
      mode: 'standard',
      page: 2,
    });
    assert.equal(second.rows.length, 50);
    assert.equal(second.rows[0].row, 52);
    const last = await getPreviewPage({
      previewId,
      userId: 7,
      mode: 'standard',
      page: 3,
    });
    assert.equal(last.rows.length, 20);
    const filtered = await getPreviewPage({
      previewId,
      userId: 7,
      mode: 'standard',
      kind: 'create',
      pageSize: 200,
    });
    assert.equal(filtered.pagination.pageSize, 100);
    assert.equal(filtered.pagination.total, 60);
    assert.equal(filtered.rows.length, 60);
    assert.ok(filtered.rows.every((row) => row.action === 'create'));

    await assert.rejects(
      getPreviewPage({ previewId, userId: 8, mode: 'standard' }),
      (error) => error.statusCode === 404,
    );
    await assert.rejects(
      getPreviewPage({ previewId, userId: 7, mode: 'competitor' }),
      (error) => error.statusCode === 404,
    );
    await assert.rejects(
      getPreviewPage({ previewId, userId: 7, mode: 'standard', kind: 'bogus' }),
      (error) => error.statusCode === 400,
    );
    const saved = await getPreviewFile({
      previewId,
      userId: 7,
      mode: 'standard',
    });
    assert.equal(saved.file.originalname, 'upload.csv');
    assert.deepEqual(saved.file.buffer, rawFile);
    assert.ok(
      [...client.expirations.values()].every((seconds) => seconds === 1800),
    );

    const keyPrefix = `asin:incremental-preview:${previewId}:`;
    client.values.delete(`${keyPrefix}file`);
    await assert.rejects(
      getPreviewFile({ previewId, userId: 7, mode: 'standard' }),
      (error) => error.statusCode === 410,
    );
    client.values.delete(`${keyPrefix}meta`);
    await assert.rejects(
      getPreviewPage({ previewId, userId: 7, mode: 'standard' }),
      (error) => error.statusCode === 410,
    );
  } finally {
    redisConfig.getRedisClient = originalGetRedisClient;
  }
});

test('预览过期后重复确认仍返回本人的原任务，其他用户和域不可读取', async () => {
  let existingTask = {
    taskId: 'expired-preview',
    userId: 7,
    taskSubType: 'asin',
    status: 'completed',
  };
  let existingJob = null;
  let previewReads = 0;
  const controller = loadControllerWithMocks({
    '../src/services/taskRegistryService': {
      readTask: async () => existingTask,
    },
    '../src/services/importTaskQueue': {
      getJob: async () => existingJob,
    },
    '../src/services/incrementalImportPreviewStore': {
      getPreviewFile: async () => {
        previewReads += 1;
        const error = new Error('预览已过期');
        error.statusCode = 410;
        throw error;
      },
    },
  });
  const req = (userId) => ({
    user: { userId },
    body: { previewId: 'expired-preview' },
  });

  const own = mockResponse();
  await controller.handlersForMode('standard').confirm(req(7), own);
  assert.equal(own.statusCode, 200);
  assert.deepEqual(own.body.data, {
    taskId: 'expired-preview',
    status: 'completed',
  });
  assert.equal(previewReads, 0);

  const otherUser = mockResponse();
  await controller.handlersForMode('standard').confirm(req(8), otherUser);
  assert.equal(otherUser.statusCode, 404);
  const otherDomain = mockResponse();
  await controller.handlersForMode('competitor').confirm(req(7), otherDomain);
  assert.equal(otherDomain.statusCode, 404);
  assert.equal(previewReads, 0);

  existingTask = null;
  existingJob = {
    data: { userId: 7, taskSubType: 'asin' },
    getState: async () => 'completed',
  };
  const bullOnly = mockResponse();
  await controller.handlersForMode('standard').confirm(req(7), bullOnly);
  assert.equal(bullOnly.statusCode, 200);
  assert.deepEqual(bullOnly.body.data, {
    taskId: 'expired-preview',
    status: 'completed',
  });
  assert.equal(previewReads, 0);
});
