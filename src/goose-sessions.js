const Database = require('better-sqlite3');
const config = require('../config.json');
const path = require('path');

let gooseDb = null;

/**
 * Open the Goose sessions database (read-only).
 * Returns null if the database doesn't exist or can't be opened.
 */
function getGooseDb() {
  if (gooseDb) return gooseDb;

  const dbPath = config.gooseSessionsDb;
  if (!dbPath) return null;

  try {
    // Resolve ~ or relative paths
    const resolved = path.resolve(dbPath);
    gooseDb = new Database(resolved, { readonly: true, fileMustExist: true });
    console.log('[goose-sessions] Connected to Goose sessions DB:', resolved);
    return gooseDb;
  } catch (e) {
    console.warn('[goose-sessions] Could not open Goose sessions DB:', e.message);
    return null;
  }
}

/**
 * Get all Goose sessions with their chat names.
 */
function getAllSessions() {
  const db = getGooseDb();
  if (!db) return [];

  try {
    return db.prepare(`
      SELECT
        id,
        name,
        description,
        session_type,
        working_dir,
        created_at,
        updated_at,
        total_tokens,
        input_tokens,
        output_tokens,
        accumulated_total_tokens,
        accumulated_input_tokens,
        accumulated_output_tokens,
        provider_name,
        goose_mode
      FROM sessions
      ORDER BY created_at DESC
    `).all();
  } catch (e) {
    console.warn('[goose-sessions] Error querying sessions:', e.message);
    return [];
  }
}

/**
 * Get a single session by ID (e.g. "20260328_1").
 */
function getSession(sessionId) {
  const db = getGooseDb();
  if (!db) return null;

  try {
    return db.prepare(`
      SELECT
        id, name, description, session_type, working_dir,
        created_at, updated_at,
        total_tokens, input_tokens, output_tokens,
        accumulated_total_tokens, accumulated_input_tokens, accumulated_output_tokens,
        provider_name, goose_mode
      FROM sessions
      WHERE id = ?
    `).get(sessionId);
  } catch (e) {
    return null;
  }
}

/**
 * Get message count for a session.
 */
function getMessageCount(sessionId) {
  const db = getGooseDb();
  if (!db) return 0;

  try {
    const row = db.prepare('SELECT COUNT(*) as count FROM messages WHERE session_id = ?').get(sessionId);
    return row ? row.count : 0;
  } catch (e) {
    return 0;
  }
}

/**
 * Batch lookup: get chat names for a list of session IDs.
 * Returns a map of { sessionId: { name, working_dir, created_at, ... } }
 */
function getSessionNames(sessionIds) {
  const db = getGooseDb();
  if (!db || sessionIds.length === 0) return {};

  try {
    const placeholders = sessionIds.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT id, name, working_dir, created_at, provider_name, goose_mode
      FROM sessions
      WHERE id IN (${placeholders})
    `).all(...sessionIds);

    const map = {};
    for (const r of rows) {
      map[r.id] = r;
    }
    return map;
  } catch (e) {
    return {};
  }
}

/**
 * Get lifetime stats from Goose's sessions.db.
 */
function getLifetimeStats() {
  const db = getGooseDb();
  if (!db) return null;

  try {
    const totals = db.prepare(`
      SELECT
        COUNT(*) as total_sessions,
        SUM(CASE WHEN total_tokens IS NOT NULL THEN 1 ELSE 0 END) as sessions_with_data,
        SUM(total_tokens) as total_tokens,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens,
        SUM(accumulated_total_tokens) as accumulated_total_tokens,
        SUM(accumulated_input_tokens) as accumulated_input_tokens,
        SUM(accumulated_output_tokens) as accumulated_output_tokens,
        MIN(created_at) as first_session,
        MAX(created_at) as last_session
      FROM sessions
    `).get();

    const byProvider = db.prepare(`
      SELECT
        provider_name,
        COUNT(*) as sessions,
        SUM(total_tokens) as total_tokens,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens
      FROM sessions
      WHERE total_tokens IS NOT NULL
      GROUP BY provider_name
      ORDER BY total_tokens DESC
    `).all();

    const byMonth = db.prepare(`
      SELECT
        strftime('%Y-%m', created_at) as month,
        COUNT(*) as sessions,
        SUM(total_tokens) as total_tokens,
        SUM(output_tokens) as output_tokens
      FROM sessions
      WHERE total_tokens IS NOT NULL
      GROUP BY month
      ORDER BY month
    `).all();

    const totalMessages = db.prepare('SELECT COUNT(*) as n FROM messages').get();

    return {
      ...totals,
      total_messages: totalMessages.n,
      by_provider: byProvider,
      by_month: byMonth
    };
  } catch (e) {
    console.warn('[goose-sessions] Error getting lifetime stats:', e.message);
    return null;
  }
}

/**
 * Check if the Goose sessions DB is accessible.
 */
function isConnected() {
  return getGooseDb() !== null;
}

/**
 * Reset the DB connection (e.g. after config change).
 */
function resetConnection() {
  if (gooseDb) {
    try { gooseDb.close(); } catch (e) {}
    gooseDb = null;
  }
}

module.exports = {
  getAllSessions,
  getSession,
  getMessageCount,
  getSessionNames,
  getLifetimeStats,
  isConnected,
  resetConnection
};
