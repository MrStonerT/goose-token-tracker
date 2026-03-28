const express = require('express');
const fs = require('fs');
const path = require('path');
const database = require('../database');
const tracker = require('../tracker');
const vllmMetrics = require('../vllm-metrics');
const gooseSessions = require('../goose-sessions');
const config = require('../../config.json');
const http = require('http');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'config.json');

const router = express.Router();

// JSON body parsing for settings POST
router.use(express.json());

// GET /api/stats?since=1h|24h|7d|30d|all
router.get('/stats', (req, res) => {
  const since = req.query.since || 'all';
  const stats = database.getStats(since);
  res.json({
    ...stats,
    savings: stats.total_cloud_cost - stats.total_local_cost,
    period: since
  });
});

// GET /api/stats/models?since=1h|24h|7d|30d|all
router.get('/stats/models', (req, res) => {
  const since = req.query.since || 'all';
  res.json(database.getModelBreakdown(since));
});

// GET /api/stats/sessions
router.get('/stats/sessions', (req, res) => {
  res.json(database.getSessionStats());
});

// GET /api/requests?limit=50&offset=0
router.get('/requests', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 500);
  const offset = parseInt(req.query.offset) || 0;
  const requests = database.getRecentRequests(limit, offset);
  const total = database.getTotalRequestCount();
  res.json({ requests, total, limit, offset });
});

// GET /api/requests/grouped?by=time|session
router.get('/requests/grouped', (req, res) => {
  const groupBy = req.query.by || 'time';
  res.json(database.getGroupedRequests(groupBy));
});

// GET /api/requests/group/:groupId?by=time|session
router.get('/requests/group/:groupId', (req, res) => {
  const groupBy = req.query.by || 'time';
  res.json(database.getRequestsInGroup(req.params.groupId, groupBy));
});

// GET /api/trends/hourly
router.get('/trends/hourly', (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  res.json(database.getHourlyTrend(hours));
});

// GET /api/trends/daily
router.get('/trends/daily', (req, res) => {
  const days = parseInt(req.query.days) || 30;
  res.json(database.getDailyTrend(days));
});

// GET /api/cost-comparison?models=gpt-4o,claude-sonnet-4
router.get('/cost-comparison', (req, res) => {
  const breakdown = database.getCostComparison();
  const allCloudCosts = {};

  // Compute all cloud costs for the full model list
  const enriched = breakdown.map(row => {
    const cloudCosts = tracker.computeAllCloudCosts(row.total_prompt_tokens, row.total_completion_tokens);
    return { ...row, cloud_costs: cloudCosts };
  });

  res.json(enriched);
});

// GET /api/cloud-models — list all available cloud models for the selector
router.get('/cloud-models', (req, res) => {
  res.json({
    models: tracker.getCloudModelList(),
    defaultCompare: config.defaultCompareModel || 'gpt-4o',
    dashboardDefaults: tracker.getDashboardCompareModels()
  });
});

// GET /api/health
router.get('/health', (req, res) => {
  const targetUrl = new URL('/v1/models', config.targetUrl);

  const checkReq = http.request({
    hostname: targetUrl.hostname,
    port: targetUrl.port,
    path: targetUrl.pathname,
    method: 'GET',
    timeout: 3000
  }, (checkRes) => {
    let body = '';
    checkRes.on('data', chunk => body += chunk);
    checkRes.on('end', () => {
      res.json({
        status: 'ok',
        proxy_port: config.proxyPort,
        target_url: config.targetUrl,
        vllm_status: checkRes.statusCode === 200 ? 'connected' : 'error',
        vllm_status_code: checkRes.statusCode,
        total_requests: database.getTotalRequestCount(),
        uptime_seconds: Math.floor(process.uptime()),
        hardware: config.hardware
      });
    });
  });

  checkReq.on('error', (err) => {
    res.json({
      status: 'ok',
      proxy_port: config.proxyPort,
      target_url: config.targetUrl,
      vllm_status: 'unreachable',
      vllm_error: err.message,
      total_requests: database.getTotalRequestCount(),
      uptime_seconds: Math.floor(process.uptime()),
      hardware: config.hardware
    });
  });

  checkReq.on('timeout', () => {
    checkReq.destroy();
    res.json({
      status: 'ok',
      proxy_port: config.proxyPort,
      target_url: config.targetUrl,
      vllm_status: 'timeout',
      total_requests: database.getTotalRequestCount(),
      uptime_seconds: Math.floor(process.uptime()),
      hardware: config.hardware
    });
  });

  checkReq.end();
});

// GET /api/config (read-only)
router.get('/config', (req, res) => {
  res.json({
    proxyPort: config.proxyPort,
    targetUrl: config.targetUrl,
    cloudComparisonModels: config.cloudComparisonModels,
    localModelPricing: config.localModelPricing,
    hardware: config.hardware,
    defaultCompareModel: config.defaultCompareModel,
    dashboardCompareModels: config.dashboardCompareModels
  });
});

// GET /api/goose/lifetime — lifetime stats from Goose's sessions.db
router.get('/goose/lifetime', (req, res) => {
  const stats = gooseSessions.getLifetimeStats();
  if (!stats) {
    return res.json({
      connected: false,
      error: 'Goose sessions database not found. Configure the path in Settings.'
    });
  }
  res.json({ connected: true, ...stats });
});

// GET /api/goose/status — check if Goose DB is connected
router.get('/goose/status', (req, res) => {
  res.json({
    connected: gooseSessions.isConnected(),
    path: config.gooseSessionsDb || null
  });
});

// GET /api/settings — get current editable settings
router.get('/settings', (req, res) => {
  res.json({
    proxyPort: config.proxyPort,
    targetUrl: config.targetUrl,
    gooseSessionsDb: config.gooseSessionsDb || '',
    hardware: config.hardware || {},
    localModelPricing: config.localModelPricing || {},
    defaultCompareModel: config.defaultCompareModel || 'gpt-4o'
  });
});

// POST /api/settings — update settings and write to config.json
router.post('/settings', (req, res) => {
  const updates = req.body;

  // Only allow specific fields to be updated
  const allowed = ['targetUrl', 'gooseSessionsDb', 'hardware', 'localModelPricing', 'defaultCompareModel'];
  let changed = false;

  for (const key of allowed) {
    if (updates[key] !== undefined) {
      config[key] = updates[key];
      changed = true;
    }
  }

  if (!changed) {
    return res.status(400).json({ error: 'No valid settings provided' });
  }

  // Write updated config to disk
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');

    // If Goose DB path changed, reset the connection
    if (updates.gooseSessionsDb !== undefined) {
      gooseSessions.resetConnection();
    }

    res.json({ ok: true, message: 'Settings saved. Some changes may require a restart.' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to save config: ' + e.message });
  }
});

// POST /api/settings/detect-goose — auto-detect Goose installation
router.post('/settings/detect-goose', (req, res) => {
  const os = require('os');
  const homedir = os.homedir();

  // Common Goose sessions.db locations
  const candidates = [
    path.join(homedir, 'AppData', 'Roaming', 'Block', 'goose', 'data', 'sessions', 'sessions.db'),
    path.join(homedir, 'AppData', 'Local', 'Block', 'goose', 'data', 'sessions', 'sessions.db'),
    path.join(homedir, '.config', 'goose', 'data', 'sessions', 'sessions.db'),
    path.join(homedir, '.local', 'share', 'goose', 'data', 'sessions', 'sessions.db'),
    path.join(homedir, 'Library', 'Application Support', 'Block', 'goose', 'data', 'sessions', 'sessions.db'),
  ];

  const found = [];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        const stat = fs.statSync(candidate);
        found.push({ path: candidate, size: stat.size, modified: stat.mtime });
      }
    } catch (e) {}
  }

  res.json({
    found,
    suggested: found.length > 0 ? found[0].path : null,
    searched: candidates
  });
});

// GET /api/chats — full chat analytics with Goose session names
router.get('/chats', (req, res) => {
  // Get tracked sessions from our DB
  const trackedSessions = database.getSessionStats();

  // Get all session IDs we've tracked
  const sessionIds = trackedSessions
    .map(s => s.session_id)
    .filter(id => id && id !== 'null');

  // Lookup chat names from Goose's sessions.db
  const gooseInfo = gooseSessions.getSessionNames(sessionIds);

  // Also get Goose sessions we haven't tracked yet (for complete picture)
  const allGooseSessions = gooseSessions.getAllSessions();

  // Merge tracked data with Goose metadata
  const chats = trackedSessions
    .filter(s => s.session_id && s.session_id !== 'null')
    .map(s => {
      const goose = gooseInfo[s.session_id] || {};
      const allCloudCosts = tracker.computeAllCloudCosts(
        s.total_prompt_tokens, s.total_completion_tokens
      );
      return {
        session_id: s.session_id,
        name: goose.name || s.session_id,
        working_dir: goose.working_dir || null,
        provider: goose.provider_name || null,
        goose_mode: goose.goose_mode || null,
        created_at: goose.created_at || s.first_request,
        request_count: s.request_count,
        total_prompt_tokens: s.total_prompt_tokens,
        total_completion_tokens: s.total_completion_tokens,
        total_tokens: s.total_tokens,
        total_local_cost: s.total_local_cost,
        total_cloud_cost: s.total_cloud_cost,
        cloud_costs: allCloudCosts,
        savings: s.total_cloud_cost - s.total_local_cost,
        first_request: s.first_request,
        last_request: s.last_request
      };
    });

  // Include recent Goose sessions we haven't tracked (no proxy data yet)
  const trackedIds = new Set(sessionIds);
  const untrackedGoose = allGooseSessions
    .filter(g => !trackedIds.has(g.id) && g.session_type === 'user')
    .slice(0, 20)
    .map(g => ({
      session_id: g.id,
      name: g.name || g.id,
      working_dir: g.working_dir || null,
      provider: g.provider_name || null,
      goose_mode: g.goose_mode || null,
      created_at: g.created_at,
      request_count: 0,
      total_prompt_tokens: g.input_tokens || 0,
      total_completion_tokens: g.output_tokens || 0,
      total_tokens: g.total_tokens || 0,
      total_local_cost: 0,
      total_cloud_cost: 0,
      cloud_costs: {},
      savings: 0,
      first_request: g.created_at,
      last_request: g.updated_at,
      goose_only: true // flag: data from Goose, not from proxy tracking
    }));

  res.json({
    tracked: chats,
    untracked: untrackedGoose,
    total_chats: chats.length + untrackedGoose.length
  });
});

// GET /api/chats/:sessionId — detailed stats for one chat
router.get('/chats/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;

  // Get Goose metadata
  const goose = gooseSessions.getSession(sessionId);
  const messageCount = gooseSessions.getMessageCount(sessionId);

  // Get our tracked requests for this session
  const requests = database.getDb().prepare(`
    SELECT * FROM requests WHERE session_id = ? ORDER BY timestamp ASC
  `).all(sessionId);

  // Compute totals
  let totalPrompt = 0, totalCompletion = 0, totalLatency = 0, totalTps = 0;
  for (const r of requests) {
    totalPrompt += r.prompt_tokens;
    totalCompletion += r.completion_tokens;
    totalLatency += r.latency_ms;
    totalTps += r.tokens_per_second;
  }

  const avgLatency = requests.length > 0 ? totalLatency / requests.length : 0;
  const avgTps = requests.length > 0 ? totalTps / requests.length : 0;
  const localCost = tracker.computeLocalCost(totalPrompt, totalCompletion);
  const allCloudCosts = tracker.computeAllCloudCosts(totalPrompt, totalCompletion);

  res.json({
    session_id: sessionId,
    name: goose?.name || sessionId,
    description: goose?.description || null,
    working_dir: goose?.working_dir || null,
    provider: goose?.provider_name || null,
    goose_mode: goose?.goose_mode || null,
    created_at: goose?.created_at || null,
    message_count: messageCount,
    request_count: requests.length,
    total_prompt_tokens: totalPrompt,
    total_completion_tokens: totalCompletion,
    total_tokens: totalPrompt + totalCompletion,
    avg_latency_ms: Math.round(avgLatency),
    avg_tokens_per_second: Math.round(avgTps * 100) / 100,
    local_cost: localCost,
    cloud_costs: allCloudCosts,
    savings: (allCloudCosts[config.defaultCompareModel] || 0) - localCost,
    requests
  });
});

// GET /api/vllm-metrics — latest vLLM metrics snapshot
router.get('/vllm-metrics', (req, res) => {
  const latest = vllmMetrics.getLatest();
  if (!latest) {
    return res.json({ error: 'No metrics available yet', status: 'pending' });
  }
  res.json(latest);
});

// GET /api/vllm-metrics/history — time series for sparklines/charts
router.get('/vllm-metrics/history', (req, res) => {
  res.json(vllmMetrics.getHistory());
});

// GET /api/live — SSE endpoint for real-time updates
router.get('/live', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.write('data: {"type":"connected"}\n\n');
  tracker.addLiveListener(res);
});

module.exports = router;
