const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let db = null;

function initDatabase(dbPath) {
  const resolvedPath = path.resolve(dbPath);
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      session_id TEXT,
      model TEXT NOT NULL,
      request_path TEXT NOT NULL,
      is_streaming INTEGER NOT NULL DEFAULT 0,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      tokens_per_second REAL NOT NULL DEFAULT 0,
      estimated_local_cost REAL NOT NULL DEFAULT 0,
      estimated_cloud_cost REAL NOT NULL DEFAULT 0,
      status_code INTEGER,
      error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp);
    CREATE INDEX IF NOT EXISTS idx_requests_session ON requests(session_id);
    CREATE INDEX IF NOT EXISTS idx_requests_model ON requests(model);

    CREATE TABLE IF NOT EXISTS models (
      id TEXT PRIMARY KEY,
      display_name TEXT,
      provider TEXT DEFAULT 'local',
      is_local INTEGER NOT NULL DEFAULT 1,
      input_price_per_1k REAL NOT NULL DEFAULT 0,
      output_price_per_1k REAL NOT NULL DEFAULT 0,
      cloud_equivalent TEXT,
      first_seen TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  return db;
}

function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

// --- Prepared statement helpers ---

function insertRequest(data) {
  const stmt = getDb().prepare(`
    INSERT INTO requests (
      session_id, model, request_path, is_streaming,
      prompt_tokens, completion_tokens, total_tokens,
      latency_ms, tokens_per_second,
      estimated_local_cost, estimated_cloud_cost,
      status_code, error
    ) VALUES (
      @session_id, @model, @request_path, @is_streaming,
      @prompt_tokens, @completion_tokens, @total_tokens,
      @latency_ms, @tokens_per_second,
      @estimated_local_cost, @estimated_cloud_cost,
      @status_code, @error
    )
  `);
  return stmt.run(data);
}

function upsertModel(data) {
  const stmt = getDb().prepare(`
    INSERT INTO models (id, display_name, provider, is_local, input_price_per_1k, output_price_per_1k, cloud_equivalent)
    VALUES (@id, @display_name, @provider, @is_local, @input_price_per_1k, @output_price_per_1k, @cloud_equivalent)
    ON CONFLICT(id) DO NOTHING
  `);
  return stmt.run(data);
}

function getStats(since) {
  let whereClause = '';
  if (since && since !== 'all') {
    const intervals = {
      '1h': '-1 hour',
      '24h': '-24 hours',
      '7d': '-7 days',
      '30d': '-30 days'
    };
    const interval = intervals[since];
    if (interval) {
      whereClause = `WHERE timestamp >= datetime('now', '${interval}')`;
    }
  }

  return getDb().prepare(`
    SELECT
      COUNT(*) as total_requests,
      COALESCE(SUM(prompt_tokens), 0) as total_prompt_tokens,
      COALESCE(SUM(completion_tokens), 0) as total_completion_tokens,
      COALESCE(SUM(total_tokens), 0) as total_tokens,
      COALESCE(AVG(tokens_per_second), 0) as avg_tokens_per_second,
      COALESCE(AVG(latency_ms), 0) as avg_latency_ms,
      COALESCE(SUM(estimated_local_cost), 0) as total_local_cost,
      COALESCE(SUM(estimated_cloud_cost), 0) as total_cloud_cost
    FROM requests ${whereClause}
  `).get();
}

function getModelBreakdown(since) {
  let whereClause = '';
  if (since && since !== 'all') {
    const intervals = { '1h': '-1 hour', '24h': '-24 hours', '7d': '-7 days', '30d': '-30 days' };
    const interval = intervals[since];
    if (interval) {
      whereClause = `WHERE timestamp >= datetime('now', '${interval}')`;
    }
  }

  return getDb().prepare(`
    SELECT
      model,
      COUNT(*) as request_count,
      SUM(prompt_tokens) as total_prompt_tokens,
      SUM(completion_tokens) as total_completion_tokens,
      SUM(total_tokens) as total_tokens,
      AVG(tokens_per_second) as avg_tokens_per_second,
      AVG(latency_ms) as avg_latency_ms,
      SUM(estimated_local_cost) as total_local_cost,
      SUM(estimated_cloud_cost) as total_cloud_cost
    FROM requests ${whereClause}
    GROUP BY model
    ORDER BY total_tokens DESC
  `).all();
}

function getSessionStats() {
  return getDb().prepare(`
    SELECT
      session_id,
      COUNT(*) as request_count,
      SUM(prompt_tokens) as total_prompt_tokens,
      SUM(completion_tokens) as total_completion_tokens,
      SUM(total_tokens) as total_tokens,
      SUM(estimated_local_cost) as total_local_cost,
      SUM(estimated_cloud_cost) as total_cloud_cost,
      MIN(timestamp) as first_request,
      MAX(timestamp) as last_request
    FROM requests
    WHERE session_id IS NOT NULL
    GROUP BY session_id
    ORDER BY last_request DESC
    LIMIT 100
  `).all();
}

function getRecentRequests(limit = 50, offset = 0) {
  return getDb().prepare(`
    SELECT * FROM requests
    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
}

function getHourlyTrend(hours = 24) {
  return getDb().prepare(`
    SELECT
      strftime('%Y-%m-%d %H:00:00', timestamp) as hour,
      COUNT(*) as request_count,
      SUM(prompt_tokens) as prompt_tokens,
      SUM(completion_tokens) as completion_tokens,
      SUM(total_tokens) as total_tokens,
      SUM(estimated_local_cost) as local_cost,
      SUM(estimated_cloud_cost) as cloud_cost
    FROM requests
    WHERE timestamp >= datetime('now', '-${hours} hours')
    GROUP BY hour
    ORDER BY hour ASC
  `).all();
}

function getDailyTrend(days = 30) {
  return getDb().prepare(`
    SELECT
      strftime('%Y-%m-%d', timestamp) as day,
      COUNT(*) as request_count,
      SUM(prompt_tokens) as prompt_tokens,
      SUM(completion_tokens) as completion_tokens,
      SUM(total_tokens) as total_tokens,
      SUM(estimated_local_cost) as local_cost,
      SUM(estimated_cloud_cost) as cloud_cost
    FROM requests
    WHERE timestamp >= datetime('now', '-${days} days')
    GROUP BY day
    ORDER BY day ASC
  `).all();
}

function getCostComparison() {
  return getDb().prepare(`
    SELECT
      model,
      SUM(prompt_tokens) as total_prompt_tokens,
      SUM(completion_tokens) as total_completion_tokens,
      SUM(total_tokens) as total_tokens,
      SUM(estimated_local_cost) as total_local_cost,
      SUM(estimated_cloud_cost) as total_cloud_cost,
      SUM(estimated_cloud_cost) - SUM(estimated_local_cost) as savings
    FROM requests
    GROUP BY model
    ORDER BY savings DESC
  `).all();
}

function getGroupedRequests(groupBy = 'time') {
  if (groupBy === 'session') {
    return getDb().prepare(`
      SELECT
        COALESCE(session_id, 'no-session') as group_id,
        'session' as group_type,
        COUNT(*) as request_count,
        GROUP_CONCAT(DISTINCT model) as models,
        SUM(prompt_tokens) as total_prompt_tokens,
        SUM(completion_tokens) as total_completion_tokens,
        SUM(total_tokens) as total_tokens,
        AVG(tokens_per_second) as avg_tokens_per_second,
        SUM(estimated_local_cost) as total_local_cost,
        SUM(estimated_cloud_cost) as total_cloud_cost,
        MIN(timestamp) as first_request,
        MAX(timestamp) as last_request
      FROM requests
      GROUP BY session_id
      ORDER BY last_request DESC
      LIMIT 50
    `).all();
  }

  // Group by 30-minute time windows
  return getDb().prepare(`
    SELECT
      strftime('%Y-%m-%d %H:', timestamp) ||
        CASE WHEN CAST(strftime('%M', timestamp) AS INTEGER) < 30 THEN '00' ELSE '30' END
        as group_id,
      'time' as group_type,
      COUNT(*) as request_count,
      GROUP_CONCAT(DISTINCT model) as models,
      SUM(prompt_tokens) as total_prompt_tokens,
      SUM(completion_tokens) as total_completion_tokens,
      SUM(total_tokens) as total_tokens,
      AVG(tokens_per_second) as avg_tokens_per_second,
      SUM(estimated_local_cost) as total_local_cost,
      SUM(estimated_cloud_cost) as total_cloud_cost,
      MIN(timestamp) as first_request,
      MAX(timestamp) as last_request
    FROM requests
    GROUP BY group_id
    ORDER BY group_id DESC
    LIMIT 50
  `).all();
}

function getRequestsInGroup(groupId, groupBy) {
  if (groupBy === 'session') {
    const sessionId = groupId === 'no-session' ? null : groupId;
    if (sessionId === null) {
      return getDb().prepare(`
        SELECT * FROM requests WHERE session_id IS NULL ORDER BY timestamp DESC LIMIT 200
      `).all();
    }
    return getDb().prepare(`
      SELECT * FROM requests WHERE session_id = ? ORDER BY timestamp DESC LIMIT 200
    `).all(sessionId);
  }

  // Time group: groupId is like "2026-03-27 14:00"
  return getDb().prepare(`
    SELECT * FROM requests
    WHERE strftime('%Y-%m-%d %H:', timestamp) ||
      CASE WHEN CAST(strftime('%M', timestamp) AS INTEGER) < 30 THEN '00' ELSE '30' END = ?
    ORDER BY timestamp ASC
    LIMIT 200
  `).all(groupId);
}

function getTotalRequestCount() {
  return getDb().prepare('SELECT COUNT(*) as count FROM requests').get().count;
}

module.exports = {
  initDatabase,
  getDb,
  insertRequest,
  upsertModel,
  getStats,
  getModelBreakdown,
  getSessionStats,
  getRecentRequests,
  getHourlyTrend,
  getDailyTrend,
  getCostComparison,
  getGroupedRequests,
  getRequestsInGroup,
  getTotalRequestCount
};
