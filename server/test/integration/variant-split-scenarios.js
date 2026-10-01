const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  normalizeEmergencyConfig,
} = require('../../src/utils/feishuEmergencyConfig');

// Only called after redis-mysql.integration.test.js validates its CI databases.
module.exports = async function testVariantSplit({
  context,
  mysqlConnection,
  mainDatabase,
  FeishuConfig,
  VariantSplitState,
}) {
  const db = `\`${mainDatabase}\``;
  const query = async (sql, values = []) =>
    (await mysqlConnection.query(sql, values))[0];
  const startTime = '2026-09-30 08:00:00';
  const endTime = '2026-09-30 08:30:00';
  const originalParent = 'B000000001';
  const changedParent = 'B000000002';
  const timestamp = (minute) =>
    new Date(Date.UTC(2026, 8, 30) + minute * 60000).toISOString();
  const raw = (
    relationships = true,
    parent = originalParent,
    overrides = {},
  ) => ({
    hasVariants: relationships,
    details: {
      hasVariantRelationships: relationships,
      parentAsin: relationships ? parent : null,
      parentTitle: relationships && parent ? 'Title' : null,
      parentTitleStatus: relationships && parent ? 'PRESENT' : 'NOT_APPLICABLE',
    },
    meta: { source: 'spapi', relationshipsObserved: true },
    ...overrides,
  });
  const titleResult = (status, overrides = {}) =>
    raw(true, originalParent, {
      hasVariants: status === 'PRESENT',
      details: {
        hasVariantRelationships: true,
        parentAsin: originalParent,
        parentTitle: status === 'PRESENT' ? 'Title' : '',
        parentTitleStatus: status,
      },
      ...overrides,
    });
  let nextAsin = 100;
  async function group(
    id,
    country = 'US',
    count = 2,
    groupEnabled = 1,
    memberEnabled = 1,
  ) {
    await query(
      `INSERT INTO ${db}.variant_groups (id, name, country, site, brand, feishu_notify_enabled) VALUES (?, ?, ?, 'ci', 'ci', ?)`,
      [id, id, country, groupEnabled],
    );
    const members = Array.from({ length: count }, (_, index) => ({
      id: `${id}-${index}`,
      asin: `B${String(nextAsin++).padStart(9, '0')}`,
    }));
    await query(
      `INSERT INTO ${db}.asins (id, asin, country, variant_group_id, site, brand, feishu_notify_enabled) VALUES ?`,
      [
        members.map((member) => [
          member.id,
          member.asin,
          country,
          id,
          'ci',
          'ci',
          memberEnabled,
        ]),
      ],
    );
    return { id, members };
  }
  const observe = (fixture, minute, result = raw()) =>
    VariantSplitState.observeGroup(
      fixture.id,
      fixture.members.map(({ id }) => ({
        asinId: id,
        result,
        observedAt: timestamp(minute),
      })),
    );
  const assessment = (region, start = startTime, end = endTime) =>
    FeishuConfig.getEmergencyGroups(region, start, end);
  const eventCount = async (id) =>
    Number(
      (
        await query(
          `SELECT COUNT(*) AS count FROM ${db}.variant_group_split_events WHERE variant_group_id = ?`,
          [id],
        )
      )[0].count,
    );

  await context.test(
    '真实关系基准：22 个异常 ASIN 只计 11 个新增组，迁移幂等保留事件和原父体',
    async () => {
      const fixtures = [];
      for (let index = 0; index < 11; index += 1) {
        const fixture = await group(`split-us-${index}`);
        fixtures.push(fixture);
        assert.equal((await observe(fixture, -1)).newEvent, null);
        const result = await observe(fixture, 1, raw(false));
        assert.equal(result.status, 'BROKEN');
        assert.equal(result.newEvent.details.triggerAsinIds.length, 2);
        assert.equal(result.newEvent.reason, 'RELATIONSHIP_LOST');
        for (const change of result.newEvent.details.changes) {
          assert.equal(change.baselineParentAsin, originalParent);
          assert.equal(change.currentParentAsin, null);
        }
      }
      assert.equal((await assessment('US')).count, 11);
      const beforeStates = await query(
        `SELECT * FROM ${db}.variant_group_split_state ORDER BY group_id`,
      );
      const beforeEvents = await query(
        `SELECT * FROM ${db}.variant_group_split_events ORDER BY id`,
      );
      assert.equal(beforeEvents.length, 11);
      const migration = fs
        .readFileSync(
          path.join(
            __dirname,
            '../../database/migrations/033_add_variant_split_tracking.sql',
          ),
          'utf8',
        )
        .replaceAll('amazon_asin_monitor', mainDatabase);
      await mysqlConnection.query(migration);
      await mysqlConnection.query(migration);
      assert.deepEqual(
        await query(
          `SELECT * FROM ${db}.variant_group_split_state ORDER BY group_id`,
        ),
        beforeStates,
      );
      assert.deepEqual(
        await query(
          `SELECT * FROM ${db}.variant_group_split_events ORDER BY id`,
        ),
        beforeEvents,
      );

      for (const fixture of fixtures) {
        assert.equal((await observe(fixture, 2, raw(false))).newEvent, null);
        assert.equal((await observe(fixture, 3)).status, 'NORMAL');
        assert.ok((await observe(fixture, 4, raw(false))).newEvent);
        assert.equal(await eventCount(fixture.id), 2);
      }
      const existing = await group('split-existing');
      assert.equal((await observe(existing, 1, raw(false))).newEvent, null);
      assert.equal((await observe(existing, 2, raw(false))).newEvent, null);
      assert.equal(
        (await assessment('US')).count,
        11,
        'Recovery and recurrence still count each group once in the window',
      );
    },
  );

  await context.test(
    '真实父体审计独立于健康状态，正常迁移及旧版变化事件均不计入电话加急',
    async () => {
      const fixture = await group('parent-history');
      await observe(fixture, 0);
      const changed = await observe(fixture, 5, raw(true, changedParent));
      assert.equal(changed.status, 'NORMAL');
      assert.equal(changed.newEvent, null);
      assert.equal(changed.newParentEvent.reason, 'PARENT_CHANGED');
      assert.equal(changed.newParentEvent.notifyEnabled, false);
      assert.equal(changed.newParentEvent.details.triggerAsinIds.length, 2);
      for (const member of changed.asins) {
        assert.equal(member.reason, null);
        assert.deepEqual(member.parentHistory, {
          status: 'CHANGED',
          baselineParentAsin: originalParent,
          currentParentAsin: changedParent,
          previousParentAsin: originalParent,
          changedAt: timestamp(5),
          observedAt: timestamp(5),
        });
      }
      const repeated = await observe(fixture, 6, raw(true, changedParent));
      assert.equal(repeated.status, 'NORMAL');
      assert.equal(repeated.newParentEvent, null);
      assert.equal(repeated.newEvent, null);
      assert.equal(await eventCount(fixture.id), 1);
      const returned = await observe(fixture, 7);
      assert.equal(returned.status, 'NORMAL');
      assert.equal(returned.newEvent, null);
      assert.equal(returned.newParentEvent.reason, 'PARENT_CHANGED');
      assert.equal(returned.asins[0].parentHistory.status, 'CHANGED');
      assert.equal(
        returned.asins[0].parentHistory.baselineParentAsin,
        originalParent,
      );
      assert.equal(
        returned.asins[0].parentHistory.previousParentAsin,
        changedParent,
      );

      // Recreate a pre-upgrade parent-change state and enabled audit event.
      const legacy = await group('parent-history-legacy');
      await observe(legacy, 0);
      const [state] = await query(
        `SELECT members FROM ${db}.variant_group_split_state WHERE group_id = ?`,
        [legacy.id],
      );
      const members =
        typeof state.members === 'string'
          ? JSON.parse(state.members)
          : state.members;
      for (const member of Object.values(members)) {
        delete member.parentHistory;
        member.status = 'BROKEN';
        member.reason = 'PARENT_CHANGED';
        member.currentParentAsin = changedParent;
        member.observedAt = timestamp(1);
      }
      await query(
        `UPDATE ${db}.variant_group_split_state SET members = ?, status = 'BROKEN' WHERE group_id = ?`,
        [JSON.stringify(members), legacy.id],
      );
      await query(
        `INSERT INTO ${db}.variant_group_split_events
         (variant_group_id, country, occurred_at, reason, details, notify_enabled)
         VALUES (?, 'US', '2026-09-30 08:01:00', 'PARENT_CHANGED', ?, 1)`,
        [
          legacy.id,
          JSON.stringify({
            triggerAsinIds: legacy.members.map(({ id }) => id),
            changes: legacy.members.map(({ id }) => ({
              asinId: id,
              reason: 'PARENT_CHANGED',
              baselineParentAsin: originalParent,
              currentParentAsin: changedParent,
            })),
          }),
        ],
      );
      const upgraded = await observe(legacy, 10, raw(true, changedParent));
      assert.equal(upgraded.status, 'NORMAL');
      assert.equal(upgraded.newEvent, null);
      assert.equal(upgraded.newParentEvent, null);
      assert.equal(upgraded.asins[0].parentHistory.status, 'CHANGED');
      assert.equal(
        upgraded.asins[0].parentHistory.baselineParentAsin,
        originalParent,
      );
      assert.equal(await eventCount(legacy.id), 1);
      assert.equal((await assessment('US')).count, 11);

      // Both dimensions can change in the same observation and persist separately.
      const unhealthy = await observe(
        fixture,
        180,
        raw(true, changedParent, {
          hasVariants: false,
          details: {
            hasVariantRelationships: true,
            parentAsin: changedParent,
            parentTitle: '',
            parentTitleStatus: 'EMPTY',
          },
        }),
      );
      assert.equal(unhealthy.status, 'BROKEN');
      assert.equal(unhealthy.newEvent.reason, 'PARENT_TITLE_EMPTY');
      assert.equal(unhealthy.newParentEvent.reason, 'PARENT_CHANGED');
      assert.notEqual(unhealthy.newEvent.id, unhealthy.newParentEvent.id);
      assert.equal(await eventCount(fixture.id), 4);
      const recovered = await observe(fixture, 181, raw(true, changedParent));
      assert.equal(recovered.status, 'NORMAL');
      assert.equal(recovered.newEvent, null);
      assert.equal(recovered.newParentEvent, null);
      assert.equal(recovered.asins[0].parentHistory.status, 'CHANGED');
      assert.equal(
        (await assessment('US', '2026-09-30 11:00:00', '2026-09-30 11:30:00'))
          .count,
        1,
      );
    },
  );

  await context.test(
    '真实事务排除标题查询失败/API/人工异常、过期观测和成员变化，并发拆分只写一个事件',
    async () => {
      const fixture = await group('split-noise', 'UK');
      await observe(fixture, 0);
      for (const [index, result] of [
        titleResult('UNKNOWN'),
        raw(false, null, { errorType: 'SP_API_ERROR' }),
        raw(false, null, { statusSource: 'MANUAL' }),
        raw(false, null, {
          meta: { source: 'html', relationshipsObserved: true },
        }),
      ].entries()) {
        const next = await observe(fixture, index + 1, result);
        assert.equal(next.status, 'NORMAL');
        assert.equal(next.newEvent, null);
      }
      const claims = await Promise.all(
        Array.from({ length: 8 }, () => observe(fixture, 40, raw(false))),
      );
      assert.equal(claims.filter((result) => result.newEvent).length, 1);
      assert.equal(await eventCount(fixture.id), 1);
      assert.equal((await observe(fixture, 39)).status, 'BROKEN');
      assert.equal((await observe(fixture, 40)).status, 'BROKEN');
      assert.equal(await eventCount(fixture.id), 1);

      const source = await group('split-members', 'DE', 3);
      const destination = await group('split-destination', 'DE', 1);
      await observe(source, 0);
      await observe(destination, 0);
      await query(`DELETE FROM ${db}.asins WHERE id = ?`, [
        source.members[0].id,
      ]);
      assert.equal((await observe(source, 1, raw(false))).newEvent, null);
      await observe(source, 2);
      const moved = source.members[2];
      await query(`UPDATE ${db}.asins SET variant_group_id = ? WHERE id = ?`, [
        destination.id,
        moved.id,
      ]);
      assert.equal((await observe(source, 3, raw(false))).newEvent, null);
      assert.equal(
        (
          await VariantSplitState.observeGroup(destination.id, [
            { asinId: moved.id, result: raw(false), observedAt: timestamp(3) },
          ])
        ).newEvent,
        null,
      );
      assert.equal(await eventCount(source.id), 0);
      assert.equal(await eventCount(destination.id), 0);
    },
  );

  await context.test(
    '真实组事件窗口遵守区域、闭区间及事件发生时和当前的通知开关',
    async () => {
      for (const [id, country, minute, groupEnabled, memberEnabled, after] of [
        ['start', 'UK', 0, 1, 1],
        ['end', 'DE', 30, 1, 1],
        ['before', 'FR', -1 / 60000, 1, 1],
        ['after', 'ES', 30 + 1 / 60000, 1, 1],
        ['default', 'FR', 15, null, null],
        ['group-muted', 'IT', 15, 0, 1],
        ['member-muted', 'UK', 15, 1, 0],
        ['was-muted', 'DE', 15, 0, 1, 'enable'],
        ['now-muted', 'UK', 15, 1, 1, 'mute'],
        ['member-now-muted', 'ES', 15, 1, 1, 'mute-member'],
        ['deleted', 'ES', 15, 1, 1, 'delete'],
        ['moved', 'IT', 15, 1, 1, 'move'],
      ]) {
        const fixture = await group(
          `filter-${id}`,
          country,
          1,
          groupEnabled,
          memberEnabled,
        );
        await observe(fixture, -2);
        await observe(fixture, minute, raw(false));
        if (after === 'enable' || after === 'mute') {
          await query(
            `UPDATE ${db}.variant_groups SET feishu_notify_enabled = ? WHERE id = ?`,
            [after === 'enable' ? 1 : 0, fixture.id],
          );
        } else if (after === 'mute-member') {
          await query(
            `UPDATE ${db}.asins SET feishu_notify_enabled = 0 WHERE id = ?`,
            [fixture.members[0].id],
          );
        } else if (after === 'delete') {
          await query(`DELETE FROM ${db}.asins WHERE id = ?`, [
            fixture.members[0].id,
          ]);
        } else if (after === 'move') {
          const target = await group('filter-move-target', country, 1);
          await query(
            `UPDATE ${db}.asins SET variant_group_id = ? WHERE id = ?`,
            [target.id, fixture.members[0].id],
          );
        }
      }
      assert.equal((await assessment('EU')).count, 3);
      assert.equal((await assessment('EU', startTime, startTime)).count, 1);
      assert.equal((await assessment('EU', endTime, endTime)).count, 1);
      assert.equal(
        (
          await assessment(
            'EU',
            '2026-09-30 08:00:00.001',
            '2026-09-30 08:29:59.999',
          )
        ).count,
        1,
      );
      assert.equal((await assessment('US')).count, 11);
    },
  );

  await context.test(
    '真实并发电话抢占仅一次；每日窗口已消费事件不重拨，水位之后的新事件保留',
    async () => {
      const dailyEnd = '2026-09-30 09:00:00';
      const rule = normalizeEmergencyConfig({
        enabled: true,
        timeMode: 'daily',
        startTime: '08:00',
        endTime: '09:00',
        threshold: 10,
        userIds: ['ou_ci_contact'],
      });
      const euRule = normalizeEmergencyConfig({ ...rule, threshold: 0 });
      await query(
        `UPDATE ${db}.feishu_config SET emergency_config = ?, last_emergency_at = NULL, enabled = 1 WHERE country = 'US'`,
        [JSON.stringify(rule)],
      );
      await query(
        `UPDATE ${db}.feishu_config SET emergency_config = ?, last_emergency_at = NULL, enabled = 1 WHERE country = 'EU'`,
        [JSON.stringify(euRule)],
      );
      const snapshot = await assessment('US', startTime, dailyEnd);
      assert.equal(snapshot.count, 11);
      assert.match(snapshot.maxEventId, /^[1-9]\d*$/);
      const options = {
        rule,
        startTime,
        endTime: dailyEnd,
        maxEventId: snapshot.maxEventId,
      };
      const late = await group('split-late-0');
      await observe(late, 10);
      await observe(late, 20, raw(false));
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          FeishuConfig.claimEmergency('US', 60, options),
        ),
      );
      assert.equal(results.filter(Boolean).length, 1);
      const pending = await assessment('US', startTime, dailyEnd);
      assert.equal(
        pending.count,
        1,
        'Events inserted after assessment must not be consumed by its claim',
      );
      assert.ok(BigInt(pending.maxEventId) > BigInt(snapshot.maxEventId));
      assert.equal(
        (
          await query(
            `SELECT phone_attempted_at FROM ${db}.variant_group_split_events WHERE variant_group_id = ?`,
            [late.id],
          )
        )[0].phone_attempted_at,
        null,
      );
      const [{ age }] = await query(
        `SELECT ABS(TIMESTAMPDIFF(SECOND, last_emergency_at, UTC_TIMESTAMP())) AS age FROM ${db}.feishu_config WHERE country = 'US'`,
      );
      assert.ok(Number(age) < 10, 'Cooldown must use UTC');

      const euSnapshot = await assessment('EU', startTime, dailyEnd);
      const euOptions = {
        ...options,
        rule: euRule,
        maxEventId: euSnapshot.maxEventId,
      };
      await query(
        `UPDATE ${db}.feishu_config SET enabled = 0 WHERE country = 'EU'`,
      );
      assert.equal(
        await FeishuConfig.claimEmergency('EU', 60, euOptions),
        false,
      );
      await query(
        `UPDATE ${db}.feishu_config SET enabled = 1, emergency_config = ? WHERE country = 'EU'`,
        [JSON.stringify({ ...euRule, enabled: false })],
      );
      assert.equal(
        await FeishuConfig.claimEmergency('EU', 60, euOptions),
        false,
      );
      await query(
        `UPDATE ${db}.feishu_config SET emergency_config = ? WHERE country = 'EU'`,
        [JSON.stringify(euRule)],
      );
      assert.equal(
        await FeishuConfig.claimEmergency('EU', 60, { ...euOptions, rule }),
        false,
        'A rule changed since assessment cannot claim',
      );
      const euClaims = await Promise.all(
        Array.from({ length: 8 }, () =>
          FeishuConfig.claimEmergency('EU', 60, euOptions),
        ),
      );
      assert.equal(
        euClaims.filter(Boolean).length,
        1,
        'Regions claim independently',
      );
      assert.deepEqual(await assessment('EU', startTime, dailyEnd), {
        count: 0,
        maxEventId: null,
      });

      await query(
        `UPDATE ${db}.feishu_config SET last_emergency_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 61 MINUTE)`,
      );
      assert.equal(
        await FeishuConfig.claimEmergency('EU', 60, euOptions),
        false,
        'Consumed daily events cannot call again after cooldown',
      );
      assert.equal(
        await FeishuConfig.claimEmergency('US', 60, {
          ...options,
          maxEventId: pending.maxEventId,
        }),
        false,
        'Old consumed groups do not combine with one new group',
      );
      for (let index = 1; index <= 10; index += 1) {
        const fixture = await group(`split-late-${index}`);
        await observe(fixture, 10);
        await observe(fixture, 20, raw(false));
        if (index === 9) {
          const atThreshold = await assessment('US', startTime, dailyEnd);
          assert.equal(atThreshold.count, 10);
          assert.equal(
            await FeishuConfig.claimEmergency('US', 60, {
              ...options,
              maxEventId: atThreshold.maxEventId,
            }),
            false,
          );
        }
      }
      const fresh = await assessment('US', startTime, dailyEnd);
      assert.equal(fresh.count, 11);
      const freshOptions = { ...options, maxEventId: fresh.maxEventId };
      await query(
        `UPDATE ${db}.feishu_config SET last_emergency_at = UTC_TIMESTAMP() WHERE country = 'US'`,
      );
      assert.equal(
        await FeishuConfig.claimEmergency('US', 60, freshOptions),
        false,
      );
      await query(
        `UPDATE ${db}.feishu_config SET last_emergency_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 61 MINUTE) WHERE country = 'US'`,
      );
      assert.equal(
        await FeishuConfig.claimEmergency('US', 60, freshOptions),
        true,
      );
      assert.deepEqual(await assessment('US', startTime, dailyEnd), {
        count: 0,
        maxEventId: null,
      });
      const parentEvents = await query(
        `SELECT notify_enabled, phone_attempted_at FROM ${db}.variant_group_split_events
         WHERE reason = 'PARENT_CHANGED' AND occurred_at >= ? AND occurred_at <= ?`,
        [startTime, dailyEnd],
      );
      assert.ok(parentEvents.length >= 3);
      assert.ok(
        parentEvents.some((event) => Number(event.notify_enabled) === 1),
      );
      assert.ok(
        parentEvents.every((event) => event.phone_attempted_at === null),
        'Parent-history events, including pre-upgrade enabled ones, must never be consumed',
      );
    },
  );

  await context.test(
    '真实空父标题仅正常转异常产生一个组事件，未知查询不恢复且窗口内反复异常按组去重',
    async () => {
      const fixture = await group('split-empty-title');
      assert.equal((await observe(fixture, 119)).status, 'NORMAL');
      const first = await observe(fixture, 120, titleResult('EMPTY'));
      assert.equal(first.status, 'BROKEN');
      assert.equal(first.newEvent.reason, 'PARENT_TITLE_EMPTY');
      assert.equal(first.newEvent.details.triggerAsinIds.length, 2);
      assert.equal(first.newEvent.details.changes.length, 2);
      for (const change of first.newEvent.details.changes) {
        assert.equal(change.reason, 'PARENT_TITLE_EMPTY');
        assert.equal(change.baselineParentAsin, originalParent);
        assert.equal(change.currentParentAsin, originalParent);
      }
      assert.equal(await eventCount(fixture.id), 1);
      assert.equal(
        (await observe(fixture, 121, titleResult('EMPTY'))).newEvent,
        null,
      );
      const legacyResult = titleResult('UNKNOWN');
      delete legacyResult.details.parentTitleStatus;
      for (const [index, result] of [
        titleResult('UNKNOWN'),
        titleResult('UNKNOWN', { errorType: 'NOT_FOUND' }),
        titleResult('UNKNOWN', { errorType: 'SP_API_ERROR' }),
        titleResult('UNKNOWN', { error: 'parent title lookup timed out' }),
        legacyResult,
      ].entries()) {
        const uncertain = await observe(fixture, 122 + index, result);
        assert.equal(uncertain.status, 'BROKEN');
        assert.equal(uncertain.newEvent, null);
      }
      const partiallyRecovered = await VariantSplitState.observeGroup(
        fixture.id,
        [
          {
            asinId: fixture.members[0].id,
            result: titleResult('PRESENT'),
            observedAt: timestamp(130),
          },
        ],
      );
      assert.equal(partiallyRecovered.status, 'BROKEN');
      assert.equal(partiallyRecovered.newEvent, null);
      assert.equal((await observe(fixture, 131)).status, 'NORMAL');
      const repeated = await observe(fixture, 132, titleResult('EMPTY'));
      assert.equal(repeated.newEvent.reason, 'PARENT_TITLE_EMPTY');
      assert.equal(await eventCount(fixture.id), 2);
      assert.equal(
        (await assessment('US', '2026-09-30 10:00:00', '2026-09-30 10:30:00'))
          .count,
        1,
        'Multiple members and repeated empty-title events count as one group',
      );
    },
  );

  await context.test(
    '首次空父标题和升级前未记录标题状态的存量异常只建立基线',
    async () => {
      const existing = await group('split-initial-empty-title');
      const initial = await observe(existing, 120, titleResult('EMPTY'));
      assert.equal(initial.status, 'BROKEN');
      assert.equal(initial.newEvent, null);
      assert.equal(
        (await observe(existing, 121, titleResult('EMPTY'))).newEvent,
        null,
      );
      assert.equal(await eventCount(existing.id), 0);

      const legacy = await group('split-legacy-title-state');
      await observe(legacy, 119);
      const [state] = await query(
        `SELECT members FROM ${db}.variant_group_split_state WHERE group_id = ?`,
        [legacy.id],
      );
      const members =
        typeof state.members === 'string'
          ? JSON.parse(state.members)
          : state.members;
      for (const member of Object.values(members)) {
        delete member.parentTitleStatus;
      }
      await query(
        `UPDATE ${db}.variant_group_split_state SET members = ? WHERE group_id = ?`,
        [JSON.stringify(members), legacy.id],
      );
      const upgraded = await observe(legacy, 120, titleResult('EMPTY'));
      assert.equal(upgraded.status, 'BROKEN');
      assert.equal(upgraded.newEvent, null);
      assert.equal(
        (await observe(legacy, 121, titleResult('EMPTY'))).newEvent,
        null,
      );
      assert.equal(await eventCount(legacy.id), 0);
    },
  );
};
