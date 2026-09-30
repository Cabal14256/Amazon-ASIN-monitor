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
    },
    meta: { source: 'spapi', relationshipsObserved: true },
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
        const result = await observe(
          fixture,
          1,
          index % 2 ? raw(false) : raw(true, changedParent),
        );
        assert.equal(result.status, 'BROKEN');
        assert.equal(result.newEvent.details.triggerAsinIds.length, 2);
        assert.equal(
          result.newEvent.reason,
          index % 2 ? 'RELATIONSHIP_LOST' : 'PARENT_CHANGED',
        );
        for (const change of result.newEvent.details.changes) {
          assert.equal(change.baselineParentAsin, originalParent);
          assert.equal(
            change.currentParentAsin,
            index % 2 ? null : changedParent,
          );
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
    '真实事务排除标题/API/人工异常、过期观测和成员变化，并发拆分只写一个事件',
    async () => {
      const fixture = await group('split-noise', 'UK');
      await observe(fixture, 0);
      for (const [index, result] of [
        raw(true, originalParent, { hasVariants: false }),
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
    },
  );
};
