const express = require('express');
const path = require('path');
const fs = require('fs');

// Auto-create config.json from example if it doesn't exist
const configPath = path.join(__dirname, 'config.json');
const examplePath = path.join(__dirname, 'config.example.json');
if (!fs.existsSync(configPath) && fs.existsSync(examplePath)) {
  fs.copyFileSync(examplePath, configPath);
  console.log('[setup] Created config.json from config.example.json — edit it with your settings.');
}

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

// Security
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

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
// Bind to localhost only — prevents LAN exposure
const server = app.listen(config.proxyPort, '127.0.0.1', () => {
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
