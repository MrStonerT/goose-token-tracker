const express = require('express');
const path = require('path');
const { initDatabase } = require('./src/database');
const { createProxyHandler } = require('./src/proxy');
const dashboardApi = require('./src/dashboard/api');
const vllmMetrics = require('./src/vllm-metrics');
const config = require('./config.json');

// Initialize SQLite database
console.log('[db] Initializing database...');
initDatabase(config.dbPath);
console.log('[db] Database ready at', path.resolve(config.dbPath));

// Start polling vLLM metrics
vllmMetrics.startPolling(5000);

const app = express();

// Dashboard static files
app.use(express.static(path.join(__dirname, 'src', 'dashboard')));

// Dashboard API
app.use('/api', dashboardApi);

// Reverse proxy: forward all /v1/* requests to vLLM
const proxyHandler = createProxyHandler();
app.all('/v1/*', proxyHandler);

// Catch-all: serve dashboard for any non-API, non-v1 route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'dashboard', 'index.html'));
});

// Start server
const server = app.listen(config.proxyPort, () => {
  console.log('');
  console.log('='.repeat(60));
  console.log('  Goose Token Tracker v2.0');
  console.log('='.repeat(60));
  console.log(`  Proxy:      http://localhost:${config.proxyPort}/v1/*`);
  console.log(`  Forwarding: ${config.targetUrl}`);
  console.log(`  Dashboard:  http://localhost:${config.proxyPort}/`);
  console.log(`  API:        http://localhost:${config.proxyPort}/api/stats`);
  console.log(`  Health:     http://localhost:${config.proxyPort}/api/health`);
  console.log(`  vLLM Stats: http://localhost:${config.proxyPort}/api/vllm-metrics`);
  console.log('='.repeat(60));
  console.log('');
  console.log('  Point your client at this proxy:');
  console.log(`    API Base URL: http://localhost:${config.proxyPort}/v1`);
  console.log(`    (instead of ${config.targetUrl})`);
  console.log('');
  console.log('='.repeat(60));
  console.log('');
});

// Graceful shutdown
function shutdown() {
  console.log('\n[server] Shutting down...');
  vllmMetrics.stopPolling();
  server.close(() => {
    console.log('[server] Stopped.');
    process.exit(0);
  });
  // Force exit after 5s
  setTimeout(() => process.exit(0), 5000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
