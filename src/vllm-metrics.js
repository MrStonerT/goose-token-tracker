const http = require('http');
const config = require('../config.json');

/**
 * Parse Prometheus text format into a simple object.
 * Only extracts gauge and counter values (not histograms buckets).
 */
function parsePrometheus(text) {
  const metrics = {};
  for (const line of text.split('\n')) {
    if (line.startsWith('#') || line.trim() === '') continue;

    // Skip histogram bucket lines
    if (line.includes('_bucket{')) continue;

    // Parse: metric_name{labels} value
    const match = line.match(/^([^\s{]+)(\{[^}]*\})?\s+([\d.eE+-]+)$/);
    if (!match) continue;

    const name = match[1];
    const labels = match[2] || '';
    const value = parseFloat(match[3]);

    if (!metrics[name]) metrics[name] = [];
    metrics[name].push({ labels, value });
  }
  return metrics;
}

/**
 * Extract the first value for a metric name, or default.
 */
function getVal(metrics, name, def = 0) {
  const entries = metrics[name];
  if (!entries || entries.length === 0) return def;
  return entries[0].value;
}

/**
 * Extract a labeled value.
 */
function getLabeledVal(metrics, name, labelMatch, def = 0) {
  const entries = metrics[name];
  if (!entries) return def;
  const entry = entries.find(e => e.labels.includes(labelMatch));
  return entry ? entry.value : def;
}

/**
 * Compute the sum from histogram _sum and _count for averages.
 */
function getHistogramAvg(metrics, baseName) {
  const sum = getVal(metrics, baseName + '_sum', 0);
  const count = getVal(metrics, baseName + '_count', 0);
  return count > 0 ? sum / count : 0;
}

/**
 * Fetch and parse vLLM metrics into a dashboard-friendly summary.
 */
function fetchMetrics() {
  return new Promise((resolve, reject) => {
    const targetUrl = new URL('/metrics', config.targetUrl);

    const req = http.request({
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      path: targetUrl.pathname,
      method: 'GET',
      timeout: 5000
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const raw = parsePrometheus(body);
          const summary = buildSummary(raw);
          resolve(summary);
        } catch (e) {
          reject(new Error('Failed to parse metrics: ' + e.message));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Metrics fetch timeout')); });
    req.end();
  });
}

/**
 * Build a dashboard-friendly summary from raw parsed metrics.
 */
function buildSummary(raw) {
  const totalPromptTokens = getVal(raw, 'vllm:prompt_tokens_total', 0);
  const totalGenTokens = getVal(raw, 'vllm:generation_tokens_total', 0);
  const cachedTokens = getVal(raw, 'vllm:prompt_tokens_cached_total', 0);

  const requestsStop = getLabeledVal(raw, 'vllm:request_success_total', 'finished_reason="stop"', 0);
  const requestsLength = getLabeledVal(raw, 'vllm:request_success_total', 'finished_reason="length"', 0);
  const requestsAbort = getLabeledVal(raw, 'vllm:request_success_total', 'finished_reason="abort"', 0);
  const requestsError = getLabeledVal(raw, 'vllm:request_success_total', 'finished_reason="error"', 0);

  const prefixQueries = getVal(raw, 'vllm:prefix_cache_queries_total', 0);
  const prefixHits = getVal(raw, 'vllm:prefix_cache_hits_total', 0);
  const cacheHitRate = prefixQueries > 0 ? (prefixHits / prefixQueries) * 100 : 0;

  const promptTokensComputed = getLabeledVal(raw, 'vllm:prompt_tokens_by_source_total', 'source="local_compute"', 0);
  const promptTokensCached = getLabeledVal(raw, 'vllm:prompt_tokens_by_source_total', 'source="local_cache_hit"', 0);

  // Engine state
  const isAwake = getLabeledVal(raw, 'vllm:engine_sleep_state', 'sleep_state="awake"', 0) === 1;
  const weightsOffloaded = getLabeledVal(raw, 'vllm:engine_sleep_state', 'sleep_state="weights_offloaded"', 0) === 1;

  // Extract model name from any metric labels
  let modelName = 'unknown';
  const anyMetric = raw['vllm:num_requests_running'];
  if (anyMetric && anyMetric[0]) {
    const m = anyMetric[0].labels.match(/model_name="([^"]+)"/);
    if (m) modelName = m[1];
  }

  return {
    model: modelName,
    engine: {
      awake: isAwake,
      weightsOffloaded,
      requestsRunning: getVal(raw, 'vllm:num_requests_running', 0),
      requestsWaiting: getVal(raw, 'vllm:num_requests_waiting', 0)
    },
    tokens: {
      totalPrompt: totalPromptTokens,
      totalGeneration: totalGenTokens,
      cached: cachedTokens,
      promptComputed: promptTokensComputed,
      promptCached: promptTokensCached
    },
    cache: {
      kvUsagePercent: getVal(raw, 'vllm:kv_cache_usage_perc', 0) * 100,
      prefixHitRate: cacheHitRate,
      prefixQueries: prefixQueries,
      prefixHits: prefixHits
    },
    requests: {
      completed: requestsStop,
      lengthLimited: requestsLength,
      aborted: requestsAbort,
      errored: requestsError,
      total: requestsStop + requestsLength + requestsAbort + requestsError
    },
    latency: {
      avgTimeToFirstToken: getHistogramAvg(raw, 'vllm:time_to_first_token_seconds'),
      avgInterTokenLatency: getHistogramAvg(raw, 'vllm:inter_token_latency_seconds'),
      avgE2eLatency: getHistogramAvg(raw, 'vllm:e2e_request_latency_seconds'),
      avgQueueTime: getHistogramAvg(raw, 'vllm:request_queue_time_seconds'),
      avgPrefillTime: getHistogramAvg(raw, 'vllm:request_prefill_time_seconds'),
      avgDecodeTime: getHistogramAvg(raw, 'vllm:request_decode_time_seconds')
    },
    preemptions: getVal(raw, 'vllm:num_preemptions_total', 0),
    process: {
      cpuSeconds: getVal(raw, 'process_cpu_seconds_total', 0),
      residentMemoryMB: Math.round(getVal(raw, 'process_resident_memory_bytes', 0) / (1024 * 1024)),
      virtualMemoryGB: (getVal(raw, 'process_virtual_memory_bytes', 0) / (1024 * 1024 * 1024)).toFixed(1)
    }
  };
}

// --- Metrics history for sparklines ---
const metricsHistory = [];
const MAX_HISTORY = 120; // 10 minutes at 5s intervals

let pollInterval = null;

function startPolling(intervalMs = 5000) {
  if (pollInterval) return;

  // Fetch immediately
  poll();

  pollInterval = setInterval(poll, intervalMs);
  console.log(`[vllm-metrics] Polling ${config.targetUrl}/metrics every ${intervalMs / 1000}s`);
}

async function poll() {
  try {
    const summary = await fetchMetrics();
    summary.timestamp = new Date().toISOString();
    metricsHistory.push(summary);
    if (metricsHistory.length > MAX_HISTORY) metricsHistory.shift();
  } catch (e) {
    // Silent — vLLM might be down
  }
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

function getLatest() {
  return metricsHistory.length > 0 ? metricsHistory[metricsHistory.length - 1] : null;
}

function getHistory() {
  return metricsHistory;
}

module.exports = {
  fetchMetrics,
  startPolling,
  stopPolling,
  getLatest,
  getHistory
};
