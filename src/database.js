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

  migratePriceColumns();
  migrateCacheColumns();

  return db;
}

// Each request stores the prices it was costed at, so a later price change or
// a new comparison model only affects new requests, never past ones.
const PRICE_COLUMNS = {
  cloud_model: 'TEXT',
  cloud_input_per_million: 'REAL',
  cloud_output_per_million: 'REAL',
  local_input_per_million: 'REAL',
  local_output_per_million: 'REAL'
};

// Prices that were in use before per-request prices were stored. Used only
// to work out which prices older rows were costed at.
const LEGACY_CLOUD_PRICES = {
  'gpt-4o': { inputPerMillion: 2.5, outputPerMillion: 10 },
  'gpt-5.2': { inputPerMillion: 1.75, outputPerMillion: 14 },
  'claude-sonnet-4.6': { inputPerMillion: 3, outputPerMillion: 15 }
};
const LEGACY_LOCAL_PRICES = [
  { inputPerMillion: 0.02, outputPerMillion: 0.10 }
];

function costAt(p, c, pricing) {
  return (p / 1_000_000) * pricing.inputPerMillion + (c / 1_000_000) * pricing.outputPerMillion;
}

function matches(stored, p, c, pricing) {
  const expected = costAt(p, c, pricing);
  return Math.abs(stored - expected) <= Math.max(1e-12, expected * 1e-6);
}

function migratePriceColumns() {
  const existing = new Set(db.prepare('PRAGMA table_info(requests)').all().map(c => c.name));
  const missing = Object.keys(PRICE_COLUMNS).filter(c => !existing.has(c));
  if (missing.length === 0) return;

  for (const col of missing) {
    db.exec(`ALTER TABLE requests ADD COLUMN ${col} ${PRICE_COLUMNS[col]}`);
  }

  // Backfill: find the prices each existing row was actually costed at by
  // matching its stored cost. Stored costs themselves are never changed.
  const config = require('../config.json');
  const cloudCandidates = Object.entries({ ...LEGACY_CLOUD_PRICES, ...(config.cloudComparisonModels || {}) });
  const localCandidates = [...Object.values(config.localModelPricing || {}), ...LEGACY_LOCAL_PRICES];

  const rows = db.prepare(`
    SELECT id, prompt_tokens p, completion_tokens c, estimated_local_cost l, estimated_cloud_cost cl
    FROM requests WHERE prompt_tokens > 0 AND completion_tokens > 0
  `).all();
  const update = db.prepare(`
    UPDATE requests SET cloud_model = ?, cloud_input_per_million = ?, cloud_output_per_million = ?,
      local_input_per_million = ?, local_output_per_million = ? WHERE id = ?
  `);

  let lastCloud = null, lastLocal = null, matched = 0;
  db.transaction(() => {
    for (const r of rows) {
      // Try the previous row's prices first; they almost always repeat
      const cloud = (lastCloud && matches(r.cl, r.p, r.c, lastCloud[1])) ? lastCloud
        : cloudCandidates.find(([, pr]) => matches(r.cl, r.p, r.c, pr));
      const local = (lastLocal && matches(r.l, r.p, r.c, lastLocal)) ? lastLocal
        : localCandidates.find(pr => matches(r.l, r.p, r.c, pr));
      if (cloud) lastCloud = cloud;
      if (local) lastLocal = local;
      if (cloud || local) matched++;
      update.run(
        cloud ? cloud[0] : null,
        cloud ? cloud[1].inputPerMillion : null, cloud ? cloud[1].outputPerMillion : null,
        local ? local.inputPerMillion : null, local ? local.outputPerMillion : null,
        r.id
      );
    }
  })();
  console.log(`[db] Added per-request price columns; matched prices for ${matched} of ${rows.length} past requests`);
}

const CACHE_COLUMNS = {
  cached_tokens: 'INTEGER NOT NULL DEFAULT 0',
  cloud_cached_input_per_million: 'REAL',
  estimated_cloud_cost_no_cache: 'REAL'
};

function parseUtc(ts) {
  return Date.parse(ts.replace(' ', 'T') + 'Z');
}

/**
 * Cloud costs used to price every prompt token at the full input rate,
 * ignoring the prompt caching every cloud provider applies to a resent
 * conversation. Re-price past requests with caching, using the same model
 * and prices each one was originally costed at. The original figure is kept
 * in estimated_cloud_cost_no_cache.
 */
function migrateCacheColumns() {
  const existing = new Set(db.prepare('PRAGMA table_info(requests)').all().map(c => c.name));
  const missing = Object.keys(CACHE_COLUMNS).filter(c => !existing.has(c));
  if (missing.length === 0) return;
  for (const col of missing) {
    db.exec(`ALTER TABLE requests ADD COLUMN ${col} ${CACHE_COLUMNS[col]}`);
  }

  const pricing = require('./pricing');
  const estimator = new pricing.CacheEstimator();
  const rows = db.prepare(`
    SELECT id, timestamp, session_id, latency_ms, prompt_tokens p, completion_tokens c,
           estimated_cloud_cost cl, cloud_model
    FROM requests ORDER BY id ASC
  `).all();
  const update = db.prepare(`
    UPDATE requests SET cached_tokens = ?, estimated_cloud_cost_no_cache = ?, estimated_cloud_cost = ?,
      cloud_input_per_million = COALESCE(?, cloud_input_per_million),
      cloud_cached_input_per_million = ?,
      cloud_output_per_million = COALESCE(?, cloud_output_per_million)
    WHERE id = ?
  `);

  let before = 0, after = 0;
  db.transaction(() => {
    for (const r of rows) {
      const start = parseUtc(r.timestamp) - (r.latency_ms || 0);
      const cached = r.p > 0 ? estimator.observe(r.session_id || '', start, r.p, r.c) : 0;
      const model = r.cloud_model && pricing.getModelPricing(r.cloud_model);
      let cost = r.cl, rates = null;
      if (model) {
        const c = pricing.requestCost(model, r.p, r.c, cached);
        cost = c.total;
        rates = c.rates;
      }
      before += r.cl;
      after += cost;
      update.run(cached, r.cl, cost,
        rates ? rates.input : null, rates ? rates.cachedInput : null, rates ? rates.output : null, r.id);
    }
  })();
  console.log(`[db] Re-priced ${rows.length} past requests with prompt caching: ` +
    `cloud equivalent $${before.toFixed(2)} -> $${after.toFixed(2)}`);
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
      cloud_model, cloud_input_per_million, cloud_output_per_million,
      cached_tokens, cloud_cached_input_per_million, estimated_cloud_cost_no_cache,
      local_input_per_million, local_output_per_million,
      status_code, error
    ) VALUES (
      @session_id, @model, @request_path, @is_streaming,
      @prompt_tokens, @completion_tokens, @total_tokens,
      @latency_ms, @tokens_per_second,
      @estimated_local_cost, @estimated_cloud_cost,
      @cloud_model, @cloud_input_per_million, @cloud_output_per_million,
      @cached_tokens, @cloud_cached_input_per_million, @estimated_cloud_cost_no_cache,
      @local_input_per_million, @local_output_per_million,
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

/** Per-request token rows for pricing what-if comparisons. */
function getCostRows(since) {
  const intervals = { '1h': '-1 hour', '24h': '-24 hours', '7d': '-7 days', '30d': '-30 days' };
  const interval = intervals[since];
  const where = interval ? `WHERE timestamp >= datetime('now', '${interval}')` : '';
  return getDb().prepare(`
    SELECT model, session_id, prompt_tokens, completion_tokens, cached_tokens
    FROM requests ${where}
  `).all();
}

/** Most recent requests in a session, oldest first (to warm the cache estimator). */
function getRecentSessionRequests(sessionId, limit = 10) {
  if (sessionId) {
    return getDb().prepare(`
      SELECT timestamp, latency_ms, prompt_tokens, completion_tokens FROM requests
      WHERE session_id = ? ORDER BY id DESC LIMIT ?
    `).all(sessionId, limit).reverse();
  }
  return getDb().prepare(`
    SELECT timestamp, latency_ms, prompt_tokens, completion_tokens FROM requests
    WHERE session_id IS NULL ORDER BY id DESC LIMIT ?
  `).all(limit).reverse();
}

function getCloudModelsUsed(since) {
  const intervals = { '1h': '-1 hour', '24h': '-24 hours', '7d': '-7 days', '30d': '-30 days' };
  const interval = intervals[since];
  const where = interval ? `AND timestamp >= datetime('now', '${interval}')` : '';
  return getDb().prepare(`
    SELECT cloud_model, MIN(timestamp) as first_used, MAX(timestamp) as last_used, COUNT(*) as request_count
    FROM requests WHERE cloud_model IS NOT NULL ${where}
    GROUP BY cloud_model ORDER BY first_used ASC
  `).all();
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
      SUM(estimated_cloud_cost) - SUM(estimated_local_cost) as savings,
      SUM(completion_tokens * COALESCE(local_output_per_million, 0)) / 1000000.0 as local_output_cost
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
  getCloudModelsUsed,
  getCostRows,
  getRecentSessionRequests,
  parseUtc,
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
