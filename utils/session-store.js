/**
 * Session store para express-session usando el pool MySQL existente.
 * Evita dependencias externas con vulnerabilidades (connect-mysql2 usa mysql2 desactualizado).
 *
 * Tabla: app_sessions (session_id, data, expires)
 * La tabla se crea automáticamente en server.js junto con las demás migraciones.
 */

const { Store } = require('express-session');

const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 horas — igual que cookie.maxAge

class MySQLSessionStore extends Store {
  constructor(db) {
    super();
    this.db = db; // pool de mysql2/promise
    // Limpiar sesiones expiradas cada 15 minutos
    this._cleanupInterval = setInterval(() => this._cleanup(), 15 * 60 * 1000);
    if (this._cleanupInterval.unref) this._cleanupInterval.unref();
  }

  async get(sid, callback) {
    try {
      const conn = await this.db.getConnection();
      try {
        const [[row]] = await conn.execute(
          'SELECT data FROM app_sessions WHERE session_id = ? AND expires > NOW()',
          [sid]
        );
        callback(null, row ? JSON.parse(row.data) : null);
      } finally {
        conn.release();
      }
    } catch (e) {
      callback(e);
    }
  }

  async set(sid, session, callback) {
    try {
      const expires = new Date(Date.now() + SESSION_TTL_MS);
      const data = JSON.stringify(session);
      const conn = await this.db.getConnection();
      try {
        await conn.execute(
          `INSERT INTO app_sessions (session_id, data, expires)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE data = VALUES(data), expires = VALUES(expires)`,
          [sid, data, expires]
        );
        callback(null);
      } finally {
        conn.release();
      }
    } catch (e) {
      callback(e);
    }
  }

  async destroy(sid, callback) {
    try {
      const conn = await this.db.getConnection();
      try {
        await conn.execute('DELETE FROM app_sessions WHERE session_id = ?', [sid]);
        callback(null);
      } finally {
        conn.release();
      }
    } catch (e) {
      callback(e);
    }
  }

  async touch(sid, session, callback) {
    try {
      const expires = new Date(Date.now() + SESSION_TTL_MS);
      const conn = await this.db.getConnection();
      try {
        await conn.execute(
          'UPDATE app_sessions SET expires = ? WHERE session_id = ?',
          [expires, sid]
        );
        callback(null);
      } finally {
        conn.release();
      }
    } catch (e) {
      callback(e);
    }
  }

  async _cleanup() {
    try {
      const conn = await this.db.getConnection();
      try {
        await conn.execute('DELETE FROM app_sessions WHERE expires <= NOW()');
      } finally {
        conn.release();
      }
    } catch (e) {
      // silencioso — no es crítico si falla la limpieza
    }
  }
}

module.exports = MySQLSessionStore;
