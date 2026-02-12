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
  }) {
    const sessionId = id || uuidv4();
    await query(
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
    return this.findById(sessionId);
  }

  static async findById(id) {
    const [session] = await query(`SELECT * FROM sessions WHERE id = ?`, [id]);
    return session;
  }

  static isExpired(session) {
    if (!session || !session.expires_at) {
      return false;
    }
    return new Date(session.expires_at) <= new Date();
  }

  static async findByUserId(userId) {
    return query(
      `SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC`,
      [userId],
    );
  }

  static async revoke(id, userId) {
    const [session] = await query(`SELECT * FROM sessions WHERE id = ?`, [id]);
    if (!session || (userId && session.user_id !== userId)) {
      return null;
    }
    await query(
      `UPDATE sessions SET status = 'REVOKED', last_active_at = NOW() WHERE id = ?`,
      [id],
    );
    return this.findById(id);
  }

  static async revokeAll(userId) {
    await query(
      `UPDATE sessions SET status = 'REVOKED', last_active_at = NOW() WHERE user_id = ?`,
      [userId],
    );
  }

  static async touch(id) {
    await query(`UPDATE sessions SET last_active_at = NOW() WHERE id = ?`, [
      id,
    ]);
  }

  static async markExpired(sessionId) {
    await query(
      `UPDATE sessions SET status = 'REVOKED', last_active_at = NOW() WHERE id = ?`,
      [sessionId],
    );
  }

  static async cleanExpiredSessions() {
    const result = await query(
      `DELETE FROM sessions WHERE expires_at IS NOT NULL AND expires_at <= NOW()`,
    );
    return result.affectedRows || 0;
  }
}

module.exports = Session;
