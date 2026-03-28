const express = require('express');
const database = require('../database');
const tracker = require('../tracker');
const vllmMetrics = require('../vllm-metrics');
const config = require('../../config.json');
const http = require('http');

const router = express.Router();

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
