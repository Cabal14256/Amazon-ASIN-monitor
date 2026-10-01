const { pool } = require('../config/database');
const logger = require('../utils/logger');
const {
  reduceGroupSplitState,
  toBeijingDateTime,
} = require('../utils/variantSplit');

function readMembers(value) {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new TypeError('Invalid persisted variant split state');
  }
  return parsed;
}

class VariantSplitState {
  static async observeGroup(groupId, observations) {
    let connection;
    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();
      // The no-op upsert acquires an exclusive key lock even for an existing
      // row. INSERT IGNORE would allow competing shared-to-exclusive upgrades.
      await connection.query(
        `INSERT INTO variant_group_split_state
         (group_id, country, members, status)
         VALUES (?, '', JSON_OBJECT(), 'UNKNOWN')
         ON DUPLICATE KEY UPDATE group_id = VALUES(group_id)`,
        [groupId],
      );
      const [[state]] = await connection.query(
        `SELECT country, members, status
         FROM variant_group_split_state WHERE group_id = ? FOR UPDATE`,
        [groupId],
      );
      const [[group]] = await connection.query(
        `SELECT id, country, feishu_notify_enabled
         FROM variant_groups WHERE id = ? FOR UPDATE`,
        [groupId],
      );
      if (!group) {
        await connection.query(
          'DELETE FROM variant_group_split_state WHERE group_id = ?',
          [groupId],
        );
        await connection.commit();
        return { status: 'UNKNOWN', newEvent: null, asins: [] };
      }
      const [currentMembers] = await connection.query(
        `SELECT id, asin, country, feishu_notify_enabled
         FROM asins WHERE variant_group_id = ? ORDER BY id FOR UPDATE`,
        [groupId],
      );
      const reduced = reduceGroupSplitState(
        state ? { ...state, members: readMembers(state.members) } : null,
        group,
        currentMembers,
        observations,
      );
      await connection.query(
        `UPDATE variant_group_split_state
         SET country = ?, members = ?, status = ?, updated_at = CURRENT_TIMESTAMP(3)
         WHERE group_id = ?`,
        [
          group.country,
          JSON.stringify(reduced.members),
          reduced.status,
          groupId,
        ],
      );
      const insertEvent = async (event) => {
        if (!event) return;
        const [inserted] = await connection.query(
          `INSERT INTO variant_group_split_events
           (variant_group_id, country, occurred_at, reason, details, notify_enabled)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            groupId,
            group.country,
            toBeijingDateTime(event.occurredAt),
            event.reason,
            JSON.stringify(event.details),
            event.notifyEnabled ? 1 : 0,
          ],
        );
        event.id = inserted.insertId;
      };
      await insertEvent(reduced.newEvent);
      await insertEvent(reduced.newParentEvent);
      await connection.commit();
      return {
        status: reduced.status,
        newEvent: reduced.newEvent,
        newParentEvent: reduced.newParentEvent,
        asins: reduced.asins,
      };
    } catch (error) {
      if (connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          logger.error('[拆分跟踪] 事务回滚失败', {
            message: rollbackError.message,
            code: rollbackError.code,
          });
        }
      }
      logger.error('[拆分跟踪] 记录失败', {
        message: error.message,
        code: error.code,
      });
      throw error;
    } finally {
      if (connection) connection.release();
    }
  }
}

module.exports = VariantSplitState;
