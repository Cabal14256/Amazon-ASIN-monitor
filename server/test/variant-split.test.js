const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');
const {
  classifySplitObservation,
  reduceGroupSplitState,
  toBeijingDateTime,
} = require('../src/utils/variantSplit');

const ORIGINAL_PARENT = 'B000000001';
const NEW_PARENT = 'B000000002';
const group = { id: 'group-1', country: 'US', feishu_notify_enabled: 1 };
const members = [
  { id: 'a', asin: 'B000000011', country: 'US', feishu_notify_enabled: 1 },
  { id: 'b', asin: 'B000000012', country: 'US', feishu_notify_enabled: 1 },
];
const time = (minute) =>
  `2026-09-30T01:${String(minute).padStart(2, '0')}:00.123Z`;

function raw(
  hasRelationships = true,
  parent = ORIGINAL_PARENT,
  overrides = {},
) {
  return {
    hasVariants: hasRelationships,
    details: {
      hasVariantRelationships: hasRelationships,
      parentAsin: hasRelationships ? parent : null,
      parentTitleStatus:
        hasRelationships && parent ? 'PRESENT' : 'NOT_APPLICABLE',
    },
    meta: { source: 'spapi', relationshipsObserved: true },
    ...overrides,
  };
}

function observation(asinId, result = raw(), minute = 0) {
  return { asinId, result, observedAt: time(minute) };
}

function reduce(
  previous,
  observations,
  currentMembers = members,
  currentGroup = group,
) {
  return reduceGroupSplitState(
    previous,
    currentGroup,
    currentMembers,
    observations,
  );
}

function normalState() {
  return reduce(
    null,
    members.map(({ id }) => observation(id)),
  );
}

test('首次全组正常建立基准，已有拆分首次出现不产生新增事件', () => {
  const normal = normalState();
  assert.equal(normal.status, 'NORMAL');
  assert.equal(normal.newEvent, null);
  assert.equal(normal.members.a.baselineParentAsin, ORIGINAL_PARENT);
  const broken = reduce(null, [observation('a', raw(false)), observation('b')]);
  assert.equal(broken.status, 'BROKEN');
  assert.equal(broken.newEvent, null);
  assert.equal(broken.members.a.baselineParentAsin, null);
});

test('只有完整已知正常组转拆分时产生事件，多个子项只形成一个事件', () => {
  const result = reduce(normalState(), [
    observation('a', raw(false), 1),
    observation('b', raw(false), 1),
  ]);
  assert.equal(result.status, 'BROKEN');
  assert.deepEqual(result.newEvent.details.triggerAsinIds, ['a', 'b']);
  assert.equal(result.newEvent.reason, 'RELATIONSHIP_LOST');
  assert.equal(result.newEvent.occurredAt, time(1));
  assert.equal(result.newEvent.notifyEnabled, true);
  assert.equal(result.newEvent.details.changes.length, 2);
  assert.equal(result.asins[0].baselineParentAsin, ORIGINAL_PARENT);
});

test('重复子项、缓存同时间、持续拆分和恢复后再拆分的事件行为', () => {
  const first = reduce(normalState(), [observation('a', raw(false), 1)]);
  const repeat = reduce(first, [
    observation('a', raw(false), 1),
    observation('a', raw(false), 2),
    observation('a', raw(false), 2),
  ]);
  assert.equal(repeat.newEvent, null);
  const recovered = reduce(repeat, [observation('a', raw(), 3)]);
  assert.equal(recovered.status, 'NORMAL');
  assert.equal(recovered.newEvent, null);
  assert.ok(reduce(recovered, [observation('a', raw(false), 4)]).newEvent);
});

test('批量归约不产生一个成员恢复、另一个拆分的瞬态正常事件', () => {
  const broken = reduce(normalState(), [observation('a', raw(false), 1)]);
  const next = reduce(broken, [
    observation('a', raw(), 2),
    observation('b', raw(false), 2),
  ]);
  assert.equal(next.status, 'BROKEN');
  assert.equal(next.newEvent, null);
});

test('同轮未确认成员阻止旧拆分被过早解除，延后确认不会伪造新增事件', () => {
  const broken = reduce(normalState(), [observation('a', raw(false), 1)]);
  const waiting = reduce(broken, [
    observation('a', raw(), 2),
    { asinId: 'b', result: null, uncertain: true, observedAt: time(2) },
  ]);
  assert.equal(waiting.status, 'BROKEN');
  assert.equal(waiting.members.b.pending, true);
  const stale = reduce(waiting, [observation('b', raw(), 1)]);
  assert.equal(stale.status, 'BROKEN');
  const confirmed = reduce(waiting, [observation('b', raw(false), 3)]);
  assert.equal(confirmed.status, 'BROKEN');
  assert.equal(confirmed.newEvent, null);
  assert.equal(confirmed.members.b.pending, false);
  const recovered = reduce(confirmed, [observation('b', raw(), 4)]);
  assert.equal(recovered.status, 'NORMAL');
  assert.ok(reduce(recovered, [observation('a', raw(false), 5)]).newEvent);
});

test('UNKNOWN 不能作为正常基准；其他成员未知时的首次拆分不产生事件', () => {
  const partial = reduce(null, [observation('a')]);
  assert.equal(partial.status, 'UNKNOWN');
  const result = reduce(partial, [observation('a', raw(false), 1)]);
  assert.equal(result.status, 'BROKEN');
  assert.equal(result.newEvent, null);
  const empty = reduce(null, [], []);
  assert.equal(empty.status, 'UNKNOWN');
});

test('忽略 API 错误、延后重试、HTML、人工结果及未观测原始关系的数据', () => {
  for (const result of [
    raw(false, null, { errorType: 'SP_API_ERROR' }),
    raw(false, null, { error: 'network failure' }),
    raw(false, null, { isDeferred: true }),
    raw(false, null, { meta: { source: 'html', relationshipsObserved: true } }),
    raw(false, null, {
      meta: { source: 'manual', relationshipsObserved: true },
    }),
    raw(false, null, { statusSource: 'MANUAL' }),
    raw(false, null, { meta: { source: 'spapi' } }),
    {
      hasVariants: false,
      meta: { source: 'spapi', relationshipsObserved: true },
    },
  ]) {
    assert.equal(classifySplitObservation(result), null);
    const after = reduce(normalState(), [observation('a', result, 1)]);
    assert.equal(after.status, 'NORMAL');
    assert.equal(after.newEvent, null);
    assert.equal(after.members.a.observedAt, time(0));
  }
});

test('父体标题未知或旧缓存缺少标题状态时不建立正常状态，也不恢复已有异常', () => {
  const result = raw(true, ORIGINAL_PARENT, { hasVariants: false });
  result.details.parentTitle = '';
  for (const titleStatus of ['UNKNOWN', undefined, 'NOT_APPLICABLE']) {
    result.details.parentTitleStatus = titleStatus;
    assert.equal(classifySplitObservation(result), null);
    const initial = reduce(null, [observation('a', result)]);
    assert.equal(initial.status, 'UNKNOWN');
    assert.equal(initial.members.a.observedAt, null);
    assert.equal(initial.members.a.pending, true);
    const after = reduce(normalState(), [observation('a', result, 1)]);
    assert.equal(after.status, 'NORMAL');
    assert.equal(after.members.a.observedAt, time(0));
    assert.equal(after.members.a.parentTitleStatus, 'PRESENT');
    assert.equal(after.newEvent, null);
    const broken = reduce(normalState(), [observation('a', raw(false), 1)]);
    const unresolved = reduce(broken, [observation('a', result, 2)]);
    assert.equal(unresolved.status, 'BROKEN');
    assert.equal(unresolved.members.a.reason, 'RELATIONSHIP_LOST');
    assert.equal(unresolved.members.a.observedAt, time(1));
    assert.equal(unresolved.members.a.pending, true);
  }
});

function emptyTitle(parent = ORIGINAL_PARENT) {
  const result = raw(true, parent, { hasVariants: false });
  result.details.parentTitle = '';
  result.details.parentTitleStatus = 'EMPTY';
  return result;
}

test('确认父标题由非空转空计入新增拆分，同组多个成员只产生一个事件', () => {
  const initial = normalState();
  assert.equal(initial.members.a.parentTitleStatus, 'PRESENT');
  const broken = reduce(initial, [
    observation('a', emptyTitle(), 1),
    observation('b', emptyTitle(), 1),
  ]);
  assert.equal(broken.status, 'BROKEN');
  assert.equal(broken.newEvent.reason, 'PARENT_TITLE_EMPTY');
  assert.deepEqual(broken.newEvent.details.triggerAsinIds, ['a', 'b']);
  assert.equal(broken.newEvent.details.changes.length, 2);
  assert.equal(broken.members.a.parentTitleStatus, 'EMPTY');
  assert.equal(broken.members.a.baselineParentAsin, ORIGINAL_PARENT);
  const repeated = reduce(broken, [observation('a', emptyTitle(), 2)]);
  assert.equal(repeated.newEvent, null);
  const recovered = reduce(repeated, [
    observation('a', raw(), 3),
    observation('b', raw(), 3),
  ]);
  assert.equal(recovered.status, 'NORMAL');
  assert.equal(recovered.members.a.parentTitleStatus, 'PRESENT');
  assert.ok(reduce(recovered, [observation('a', emptyTitle(), 4)]).newEvent);
});

test('首次空标题和旧状态首次确认空标题只登记存量；关系丢失仍可触发', () => {
  const initial = reduce(null, [
    observation('a', emptyTitle()),
    observation('b'),
  ]);
  assert.equal(initial.status, 'BROKEN');
  assert.equal(initial.newEvent, null);
  const legacy = normalState();
  delete legacy.members.a.parentTitleStatus;
  delete legacy.members.b.parentTitleStatus;
  const seeded = reduce(legacy, [observation('a', emptyTitle(), 1)]);
  assert.equal(seeded.status, 'BROKEN');
  assert.equal(seeded.members.a.parentTitleStatus, 'EMPTY');
  assert.equal(seeded.newEvent, null);
  assert.equal(
    reduce(seeded, [observation('a', emptyTitle(), 2)]).newEvent,
    null,
  );
  const mixed = reduce(legacy, [
    observation('a', emptyTitle(), 1),
    observation('b', raw(false), 1),
  ]);
  assert.equal(mixed.newEvent.reason, 'RELATIONSHIP_LOST');
  assert.deepEqual(mixed.newEvent.details.triggerAsinIds, ['b']);
  const changed = reduce(legacy, [observation('a', emptyTitle(NEW_PARENT), 1)]);
  assert.equal(changed.newEvent.reason, 'PARENT_CHANGED');
});

test('空标题后查询失败不恢复，另一成员未知标题也阻止组短暂恢复', () => {
  const broken = reduce(normalState(), [observation('a', emptyTitle(), 1)]);
  for (const result of [
    raw(true, ORIGINAL_PARENT, { errorType: 'SP_API_ERROR' }),
    raw(true, ORIGINAL_PARENT, { error: 'timeout' }),
  ]) {
    const failed = reduce(broken, [observation('a', result, 2)]);
    assert.equal(failed.status, 'BROKEN');
    assert.equal(failed.members.a.reason, 'PARENT_TITLE_EMPTY');
    assert.equal(failed.members.a.parentTitleStatus, 'EMPTY');
    assert.equal(failed.members.a.observedAt, time(1));
  }
  const unknown = raw();
  unknown.details.parentTitleStatus = 'UNKNOWN';
  const waiting = reduce(broken, [
    observation('a', raw(), 2),
    observation('b', unknown, 2),
  ]);
  assert.equal(waiting.status, 'BROKEN');
  assert.equal(waiting.members.b.pending, true);
  assert.equal(
    reduce(waiting, [observation('b', emptyTitle(), 3)]).newEvent,
    null,
  );
  const confirmed = reduce(waiting, [observation('b', raw(), 3)]);
  assert.equal(confirmed.status, 'NORMAL');
  assert.equal(confirmed.members.b.pending, false);
});

test('原父恢复但标题为空时保持异常，父体变更与关系丢失优先于标题未知', () => {
  const changed = reduce(normalState(), [
    observation('a', raw(true, NEW_PARENT), 1),
  ]);
  const emptyOriginal = reduce(changed, [observation('a', emptyTitle(), 2)]);
  assert.equal(emptyOriginal.status, 'BROKEN');
  assert.equal(emptyOriginal.members.a.reason, 'PARENT_TITLE_EMPTY');
  assert.equal(emptyOriginal.newEvent, null);
  assert.equal(
    reduce(emptyOriginal, [observation('a', raw(), 3)]).status,
    'NORMAL',
  );
  for (const [result, reason] of [
    [raw(true, NEW_PARENT), 'PARENT_CHANGED'],
    [raw(false), 'RELATIONSHIP_LOST'],
  ]) {
    result.details.parentTitleStatus = 'UNKNOWN';
    const classified = reduce(normalState(), [observation('a', result, 1)]);
    assert.equal(classified.status, 'BROKEN');
    assert.equal(classified.newEvent.reason, reason);
  }
});

test('父体迁移触发拆分且固定原父体，直到恢复原父体才恢复正常', () => {
  const changed = reduce(normalState(), [
    observation('a', raw(true, NEW_PARENT), 1),
  ]);
  assert.equal(changed.newEvent.reason, 'PARENT_CHANGED');
  assert.deepEqual(changed.newEvent.details.changes, [
    {
      asinId: 'a',
      reason: 'PARENT_CHANGED',
      baselineParentAsin: ORIGINAL_PARENT,
      currentParentAsin: NEW_PARENT,
    },
  ]);
  const stillChanged = reduce(changed, [
    observation('a', raw(true, NEW_PARENT), 2),
  ]);
  assert.equal(stillChanged.status, 'BROKEN');
  assert.equal(stillChanged.newEvent, null);
  assert.equal(stillChanged.members.a.baselineParentAsin, ORIGINAL_PARENT);
  const missingParent = reduce(stillChanged, [
    observation('a', raw(true, null), 3),
  ]);
  assert.equal(missingParent.status, 'BROKEN');
  const restored = reduce(missingParent, [
    observation('a', raw(true, ORIGINAL_PARENT), 4),
  ]);
  assert.equal(restored.status, 'NORMAL');
});

test('父体字符串规范化且拒绝无效父体；无父体的父 ASIN 可先建立正常状态', () => {
  const result = classifySplitObservation(raw(true, ' b000000001 '));
  assert.equal(result.baselineParentAsin, ORIGINAL_PARENT);
  assert.equal(classifySplitObservation(raw(true, 'invalid')), null);
  const initial = reduce(null, [
    observation('a', raw(true, null)),
    observation('b'),
  ]);
  assert.equal(initial.status, 'NORMAL');
  assert.equal(initial.members.a.baselineParentAsin, null);
  const established = reduce(initial, [observation('a', raw(), 1)]);
  assert.equal(established.members.a.baselineParentAsin, ORIGINAL_PARENT);
  assert.equal(established.newEvent, null);
});

test('首次已拆分的成员恢复时建立原父体基准，下次拆分才计新增', () => {
  const initial = reduce(null, [
    observation('a', raw(false)),
    observation('b'),
  ]);
  const restored = reduce(initial, [observation('a', raw(), 1)]);
  assert.equal(restored.status, 'NORMAL');
  assert.equal(restored.members.a.baselineParentAsin, ORIGINAL_PARENT);
  assert.ok(reduce(restored, [observation('a', raw(false), 2)]).newEvent);
});

test('旧观测和相同时间观测不能覆盖新状态，同批只采用最新观测', () => {
  const broken = reduce(normalState(), [observation('a', raw(false), 3)]);
  for (const minute of [1, 3]) {
    const stale = reduce(broken, [observation('a', raw(), minute)]);
    assert.equal(stale.status, 'BROKEN');
    assert.equal(stale.members.a.observedAt, time(3));
  }
  const latest = reduce(normalState(), [
    observation('a', raw(false), 3),
    observation('a', raw(), 4),
    observation('a', raw(false), 2),
  ]);
  assert.equal(latest.status, 'NORMAL');
  assert.equal(latest.newEvent, null);
});

test('无效时间不接受，无时区字符串不按服务器本地时区解读', () => {
  for (const observedAt of [null, 'invalid', '2026-09-30 01:00:00']) {
    const next = reduce(normalState(), [
      { asinId: 'a', result: raw(false), observedAt },
    ]);
    assert.equal(next.status, 'NORMAL');
  }
  const result = raw(false);
  result.meta.observedAt = time(2);
  assert.ok(reduce(normalState(), [{ asinId: 'a', result }]).newEvent);
});

test('新增成员保持 UNKNOWN，成员变化当轮不误触发拆分', () => {
  const extra = {
    id: 'c',
    asin: 'B000000013',
    country: 'US',
    feishu_notify_enabled: 1,
  };
  const changedMembers = [...members, extra];
  const next = reduce(normalState(), [], changedMembers);
  assert.equal(next.status, 'UNKNOWN');
  assert.equal(next.members.a.baselineParentAsin, ORIGINAL_PARENT);
  assert.equal(next.members.c.status, 'UNKNOWN');
  const broken = reduce(
    normalState(),
    [observation('a', raw(false), 1)],
    changedMembers,
  );
  assert.equal(broken.status, 'BROKEN');
  assert.equal(broken.newEvent, null);
});

test('删除或移走的成员不计入，其他成员保留基准，变化当轮不生成事件', () => {
  const next = reduce(
    normalState(),
    [observation('b', raw(false), 1)],
    [members[0]],
  );
  assert.equal(next.status, 'NORMAL');
  assert.equal(Object.hasOwn(next.members, 'b'), false);
  assert.equal(next.newEvent, null);
  const broken = reduce(
    normalState(),
    [observation('a', raw(false), 1)],
    [members[0]],
  );
  assert.equal(broken.status, 'BROKEN');
  assert.equal(broken.newEvent, null);
});

test('相同成员 ID 更换 ASIN/国家后不能沿用旧基准，组国家变更也抑制事件', () => {
  const changedMembers = [{ ...members[0], asin: 'B000000099' }, members[1]];
  const changed = reduce(
    normalState(),
    [observation('a', raw(true, NEW_PARENT), 1)],
    changedMembers,
  );
  assert.equal(changed.members.a.baselineParentAsin, NEW_PARENT);
  assert.equal(changed.newEvent, null);
  const movedCountry = reduce(
    normalState(),
    [observation('a', raw(false), 1)],
    members,
    { ...group, country: 'UK' },
  );
  assert.equal(movedCountry.newEvent, null);
});

test('通知开关只决定事件资格，不排除成员或改变正常拆分状态', () => {
  const mutedMembers = [
    { ...members[0], feishu_notify_enabled: 0 },
    members[1],
  ];
  const muted = reduce(
    normalState(),
    [observation('a', raw(false), 1)],
    mutedMembers,
  );
  assert.equal(muted.status, 'BROKEN');
  assert.equal(muted.newEvent.notifyEnabled, false);
  assert.deepEqual(muted.newEvent.details.triggerAsinIds, ['a']);
  const mutedGroup = reduce(
    normalState(),
    [observation('a', raw(false), 1)],
    members,
    { ...group, feishu_notify_enabled: 0 },
  );
  assert.equal(mutedGroup.newEvent.notifyEnabled, false);
  const enabledBroken = reduce(
    normalState(),
    [observation('b', raw(false), 1)],
    mutedMembers,
  );
  assert.equal(enabledBroken.newEvent.notifyEnabled, true);
});

test('北京时间转换保留毫秒且午夜不出现 24 点', () => {
  assert.equal(
    toBeijingDateTime('2026-09-30T16:00:00.123Z'),
    '2026-10-01 00:00:00.123',
  );
  assert.equal(
    toBeijingDateTime('2026-10-01T00:00:00.123+08:00'),
    '2026-10-01 00:00:00.123',
  );
  assert.throws(() => toBeijingDateTime('invalid'), TypeError);
});

function loadModel(pool, logs = []) {
  const filename = require.resolve('../src/models/VariantSplitState');
  const cached = require.cache[filename];
  const originalLoad = Module._load;
  delete require.cache[filename];
  Module._load = function load(request, parent, isMain) {
    if (parent?.filename === filename && request === '../config/database')
      return { pool };
    if (parent?.filename === filename && request === '../utils/logger') {
      return { error: (...args) => logs.push(args) };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(filename);
  } finally {
    Module._load = originalLoad;
    if (cached) require.cache[filename] = cached;
    else delete require.cache[filename];
  }
}

// A transactional store with a real async mutex exercises concurrent first
// initialization, row locking, and state/event atomicity without a live DB.
function transactionalStore() {
  const db = {
    state: null,
    events: [],
    group,
    members,
    calls: [],
    releases: 0,
    rollbacks: 0,
    failInsert: false,
  };
  let tail = Promise.resolve();
  const pool = {
    async getConnection() {
      let unlock;
      let local;
      return {
        async beginTransaction() {},
        async query(sql, values) {
          db.calls.push({ sql, values });
          if (sql.includes('INSERT INTO variant_group_split_state')) {
            assert.match(sql, /ON DUPLICATE KEY UPDATE/);
            const before = tail;
            tail = new Promise((resolve) => {
              unlock = resolve;
            });
            await before;
            local = structuredClone({ state: db.state, events: db.events });
            local.state ||= { country: '', members: '{}', status: 'UNKNOWN' };
            return [{ affectedRows: 1 }];
          }
          if (sql.includes('DELETE FROM variant_group_split_state')) {
            local.state = null;
            return [{ affectedRows: 1 }];
          }
          if (sql.includes('FROM variant_group_split_state')) {
            assert.match(sql, /FOR UPDATE/);
            return [[local.state]];
          }
          if (sql.includes('FROM variant_groups')) {
            assert.match(sql, /FOR UPDATE/);
            return [db.group ? [db.group] : []];
          }
          if (sql.includes('FROM asins')) {
            assert.match(sql, /FOR UPDATE/);
            return [db.members];
          }
          if (sql.includes('UPDATE variant_group_split_state')) {
            local.state = {
              country: values[0],
              members: values[1],
              status: values[2],
            };
            return [{ affectedRows: 1 }];
          }
          if (sql.includes('INSERT INTO variant_group_split_events')) {
            if (db.failInsert)
              throw Object.assign(new Error('event insert failed'), {
                code: 'TEST_FAILURE',
                secret: 'never-log',
              });
            local.events.push(values);
            return [{ insertId: local.events.length }];
          }
          throw new Error('Unexpected test query');
        },
        async commit() {
          db.state = local.state;
          db.events = local.events;
          unlock();
          unlock = null;
        },
        async rollback() {
          db.rollbacks += 1;
          if (unlock) unlock();
          unlock = null;
        },
        release() {
          db.releases += 1;
        },
      };
    },
  };
  return { db, pool };
}

test('并发初始化及同组同时转拆分只写一条事件并释放事务连接', async () => {
  const { db, pool } = transactionalStore();
  const Model = loadModel(pool);
  await Promise.all(
    Array.from({ length: 3 }, () =>
      Model.observeGroup(
        group.id,
        members.map(({ id }) => observation(id)),
      ),
    ),
  );
  assert.equal(db.events.length, 0);
  const results = await Promise.all(
    Array.from({ length: 3 }, () =>
      Model.observeGroup(group.id, [observation('a', raw(false), 1)]),
    ),
  );
  assert.equal(db.events.length, 1);
  assert.equal(results.filter((result) => result.newEvent).length, 1);
  assert.equal(results.find((result) => result.newEvent).newEvent.id, 1);
  assert.equal(db.events[0][2], '2026-09-30 09:01:00.123');
  assert.equal(db.releases, 6);
  assert.equal(db.rollbacks, 0);
});

test('事件写入失败时回滚状态，重试仍能生成事件且日志不含错误完整对象', async () => {
  const { db, pool } = transactionalStore();
  const logs = [];
  const Model = loadModel(pool, logs);
  await Model.observeGroup(
    group.id,
    members.map(({ id }) => observation(id)),
  );
  db.failInsert = true;
  await assert.rejects(
    Model.observeGroup(group.id, [observation('a', raw(false), 1)]),
    /event insert failed/,
  );
  assert.equal(db.state.status, 'NORMAL');
  assert.equal(db.events.length, 0);
  assert.equal(db.rollbacks, 1);
  assert.deepEqual(logs[0][1], {
    message: 'event insert failed',
    code: 'TEST_FAILURE',
  });
  db.failInsert = false;
  assert.ok(
    (await Model.observeGroup(group.id, [observation('a', raw(false), 1)]))
      .newEvent,
  );
});

test('事务内按当前成员过滤移走成员，已删除组不留下状态或事件', async () => {
  const { db, pool } = transactionalStore();
  const Model = loadModel(pool);
  await Model.observeGroup(
    group.id,
    members.map(({ id }) => observation(id)),
  );
  db.members = [members[0]];
  const result = await Model.observeGroup(group.id, [
    observation('b', raw(false), 1),
  ]);
  assert.equal(result.status, 'NORMAL');
  assert.deepEqual(
    result.asins.map(({ asinId }) => asinId),
    ['a'],
  );
  db.group = null;
  assert.deepEqual(await Model.observeGroup(group.id, []), {
    status: 'UNKNOWN',
    newEvent: null,
    asins: [],
  });
  assert.equal(db.state, null);
  assert.equal(db.events.length, 0);
});
