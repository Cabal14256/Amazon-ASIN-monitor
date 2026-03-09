const { query } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class Session {
  static async create({
    id,
    userId,
    userAgent,
    ipAddress,
    expiresAt,
    rememberMe,
    queryExecutor,
  }) {
    const runQuery = queryExecutor || query;
    const sessionId = id || uuidv4();
    await runQuery(
      `INSERT INTO sessions (id, user_id, user_agent, ip_address, expires_at, remember_me) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        userId,
        userAgent || null,
        ipAddress || null,
        expiresAt || null,
        rememberMe ? 1 : 0,
      ],
    );
    return this.findById(sessionId, { queryExecutor: runQuery });
  }

  static async findById(id, options = {}) {
    const runQuery = options.queryExecutor || query;
    const [session] = await runQuery(`SELECT * FROM sessions WHERE id = ?`, [id]);
    return session;
  }

  static isExpired(session) {
    if (!session || !session.expires_at) {
      return false;
    }
    return new Date(session.expires_at) <= new Date();
  }

  static async findByUserId(userId, options = {}) {
    const runQuery = options.queryExecutor || query;
    return runQuery(
      `SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC`,
      [userId],
    );
  }

  static async revoke(id, userId, options = {}) {
    const runQuery = options.queryExecutor || query;
    const [session] = await runQuery(`SELECT * FROM sessions WHERE id = ?`, [id]);
    if (!session || (userId && session.user_id !== userId)) {
      return null;
    }
    await runQuery(
      `UPDATE sessions SET status = 'REVOKED', last_active_at = NOW() WHERE id = ?`,
      [id],
    );
    return this.findById(id, { queryExecutor: runQuery });
  }

  static async revokeAll(userId, options = {}) {
    const runQuery = options.queryExecutor || query;
    const conditions = [userId];
    let sql = `UPDATE sessions SET status = 'REVOKED', last_active_at = NOW() WHERE user_id = ?`;

    if (options.excludeSessionId) {
      sql += ` AND id <> ?`;
      conditions.push(options.excludeSessionId);
    }

    await runQuery(sql, conditions);
  }

  static async touch(id, options = {}) {
    const runQuery = options.queryExecutor || query;
    await runQuery(`UPDATE sessions SET last_active_at = NOW() WHERE id = ?`, [
      id,
    ]);
  }

  static async markExpired(sessionId, options = {}) {
    const runQuery = options.queryExecutor || query;
    await runQuery(
      `UPDATE sessions SET status = 'REVOKED', last_active_at = NOW() WHERE id = ?`,
      [sessionId],
    );
  }

  static async cleanExpiredSessions(options = {}) {
    const runQuery = options.queryExecutor || query;
    const result = await runQuery(
      `DELETE FROM sessions WHERE expires_at IS NOT NULL AND expires_at <= NOW()`,
    );
    return result.affectedRows || 0;
  }
}

module.exports = Session;
