// State
let currentSince = 'all';
let currentPage = 0;
let currentGroupBy = 'none';
let selectedCompareModels = [];
let allCloudModels = [];
const PAGE_SIZE = 50;
let usageChart = null;
let modelChart = null;
let vllmHistoryChart = null;

// --- Formatting helpers ---
function fmt(n, decimals = 0) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return Number(n).toFixed(decimals);
}

function fmtCost(n) {
  if (n === 0) return '$0.00';
  if (Math.abs(n) < 0.001) return '$' + Number(n).toFixed(6);
  if (Math.abs(n) < 0.01) return '$' + Number(n).toFixed(4);
  if (Math.abs(n) < 1) return '$' + Number(n).toFixed(3);
  return '$' + Number(n).toFixed(2);
}

function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts + 'Z');
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts + 'Z');
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts + 'Z');
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// --- API fetchers ---
async function fetchJson(url) {
  const res = await fetch(url);
  return res.json();
}

// --- Cloud model selector ---
async function initModelSelector() {
  const data = await fetchJson('/api/cloud-models');
  allCloudModels = data.models;
  selectedCompareModels = data.dashboardDefaults;

  renderModelCheckboxes();
}

function renderModelCheckboxes() {
  const container = document.getElementById('model-checkboxes');
  container.innerHTML = allCloudModels.map(m => {
    const checked = selectedCompareModels.includes(m.id);
    return `<label class="${checked ? 'checked' : ''}" data-model="${m.id}">
      <input type="checkbox" ${checked ? 'checked' : ''}>${m.id}
    </label>`;
  }).join('');

  container.addEventListener('click', (e) => {
    const label = e.target.closest('label[data-model]');
    if (!label) return;
    const model = label.dataset.model;
    const idx = selectedCompareModels.indexOf(model);
    if (idx >= 0) {
      selectedCompareModels.splice(idx, 1);
      label.classList.remove('checked');
      label.querySelector('input').checked = false;
    } else {
      selectedCompareModels.push(model);
      label.classList.add('checked');
      label.querySelector('input').checked = true;
    }
    updateCostComparison();
  });
}

// --- Summary cards ---
async function updateStats() {
  const stats = await fetchJson(`/api/stats?since=${currentSince}`);

  document.getElementById('total-tokens').textContent = fmt(stats.total_tokens);
  document.getElementById('token-breakdown').textContent =
    `${fmt(stats.total_prompt_tokens)} in / ${fmt(stats.total_completion_tokens)} out`;
  document.getElementById('total-requests').textContent = fmt(stats.total_requests);
  document.getElementById('avg-latency').textContent =
    `${Math.round(stats.avg_latency_ms)}ms avg latency`;
  document.getElementById('avg-tps').textContent =
    Number(stats.avg_tokens_per_second).toFixed(1);
  document.getElementById('local-cost').textContent = fmtCost(stats.total_local_cost);
  document.getElementById('cloud-cost').textContent = fmtCost(stats.total_cloud_cost);
  document.getElementById('savings').textContent = fmtCost(stats.savings);

  const pct = stats.total_cloud_cost > 0
    ? ((stats.savings / stats.total_cloud_cost) * 100).toFixed(1)
    : '0';
  document.getElementById('savings-pct').textContent = `${pct}% savings vs cloud`;
}

// --- Charts ---
const chartColors = {
  prompt: 'rgba(107, 99, 255, 0.8)',
  completion: 'rgba(34, 197, 94, 0.8)',
  promptBg: 'rgba(107, 99, 255, 0.15)',
  completionBg: 'rgba(34, 197, 94, 0.15)',
  doughnut: [
    '#6c63ff', '#22c55e', '#3b82f6', '#f97316', '#a855f7',
    '#eab308', '#ef4444', '#14b8a6', '#ec4899', '#64748b'
  ]
};

const chartDefaults = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#8b8fa3', font: { size: 11 } } }
  },
  scales: {
    x: { ticks: { color: '#8b8fa3', font: { size: 10 } }, grid: { color: '#2a2e3e' } },
    y: { ticks: { color: '#8b8fa3', font: { size: 10 } }, grid: { color: '#2a2e3e' } }
  }
};

async function updateUsageChart() {
  const isShortRange = currentSince === '1h' || currentSince === '24h';
  const endpoint = isShortRange ? '/api/trends/hourly' : '/api/trends/daily';
  const data = await fetchJson(endpoint);

  const labels = data.map(d => isShortRange ? fmtTime(d.hour || d.day) : fmtDate(d.day || d.hour));
  const promptData = data.map(d => d.prompt_tokens);
  const completionData = data.map(d => d.completion_tokens);

  if (usageChart) usageChart.destroy();

  usageChart = new Chart(document.getElementById('usage-chart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Prompt Tokens (Input)',
          data: promptData,
          borderColor: chartColors.prompt,
          backgroundColor: chartColors.promptBg,
          fill: true,
          tension: 0.3,
          yAxisID: 'yInput'
        },
        {
          label: 'Completion Tokens (Output)',
          data: completionData,
          borderColor: chartColors.completion,
          backgroundColor: chartColors.completionBg,
          fill: true,
          tension: 0.3,
          yAxisID: 'yOutput'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#8b8fa3', font: { size: 11 } } }
      },
      scales: {
        x: { ticks: { color: '#8b8fa3', font: { size: 10 } }, grid: { color: '#2a2e3e' } },
        yInput: {
          type: 'linear',
          position: 'left',
          title: { display: true, text: 'Input Tokens', color: chartColors.prompt },
          ticks: { color: chartColors.prompt, font: { size: 10 } },
          grid: { color: '#2a2e3e' }
        },
        yOutput: {
          type: 'linear',
          position: 'right',
          title: { display: true, text: 'Output Tokens', color: chartColors.completion },
          ticks: { color: chartColors.completion, font: { size: 10 } },
          grid: { drawOnChartArea: false }
        }
      }
    }
  });
}

async function updateModelChart() {
  const data = await fetchJson(`/api/stats/models?since=${currentSince}`);

  if (modelChart) modelChart.destroy();

  if (data.length === 0) {
    modelChart = null;
    return;
  }

  modelChart = new Chart(document.getElementById('model-chart'), {
    type: 'doughnut',
    data: {
      labels: data.map(d => d.model),
      datasets: [{
        data: data.map(d => d.total_tokens),
        backgroundColor: chartColors.doughnut.slice(0, data.length)
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#8b8fa3', font: { size: 11 }, padding: 12 }
        }
      }
    }
  });
}

// --- Cost Comparison with dynamic model columns ---
async function updateCostComparison() {
  const data = await fetchJson('/api/cost-comparison');
  const thead = document.getElementById('cost-table-head');
  const tbody = document.getElementById('cost-table-body');
  const tfoot = document.getElementById('cost-table-foot');

  // Build dynamic header
  const modelHeaders = selectedCompareModels.map(m => `<th>${m}</th>`).join('');
  thead.innerHTML = `<tr>
    <th>Local Model</th>
    <th>Tokens</th>
    <th>Local Cost</th>
    ${modelHeaders}
    <th>Best Savings</th>
  </tr>`;

  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="' + (4 + selectedCompareModels.length) +
      '" style="text-align:center;color:var(--text-dim)">No data yet</td></tr>';
    tfoot.innerHTML = '';
    return;
  }

  // Totals accumulators
  let totalTokens = 0;
  let totalLocal = 0;
  const totalCloud = {};
  selectedCompareModels.forEach(m => totalCloud[m] = 0);

  tbody.innerHTML = data.map(row => {
    totalTokens += row.total_tokens;
    totalLocal += row.total_local_cost;

    const cloudCells = selectedCompareModels.map(m => {
      const cost = row.cloud_costs?.[m] || 0;
      totalCloud[m] = (totalCloud[m] || 0) + cost;
      return `<td>${fmtCost(cost)}</td>`;
    }).join('');

    // Best savings = max cloud cost - local cost
    const maxCloud = Math.max(...selectedCompareModels.map(m => row.cloud_costs?.[m] || 0));
    const bestSaving = maxCloud - row.total_local_cost;
    const cls = bestSaving >= 0 ? 'savings-positive' : 'savings-negative';

    return `<tr>
      <td>${row.model}</td>
      <td>${fmt(row.total_tokens)}</td>
      <td>${fmtCost(row.total_local_cost)}</td>
      ${cloudCells}
      <td class="${cls}">${fmtCost(Math.abs(bestSaving))} ${bestSaving >= 0 ? 'saved' : 'extra'}</td>
    </tr>`;
  }).join('');

  // Totals row
  const totalCloudCells = selectedCompareModels.map(m =>
    `<td>${fmtCost(totalCloud[m] || 0)}</td>`
  ).join('');
  const maxTotalCloud = Math.max(...selectedCompareModels.map(m => totalCloud[m] || 0));
  const totalSaving = maxTotalCloud - totalLocal;
  const totalCls = totalSaving >= 0 ? 'savings-positive' : 'savings-negative';

  tfoot.innerHTML = `<tr>
    <td>TOTAL</td>
    <td>${fmt(totalTokens)}</td>
    <td>${fmtCost(totalLocal)}</td>
    ${totalCloudCells}
    <td class="${totalCls}">${fmtCost(Math.abs(totalSaving))} ${totalSaving >= 0 ? 'saved' : 'extra'}</td>
  </tr>`;
}

// --- Request Log (flat) ---
async function updateRequestLog() {
  if (currentGroupBy !== 'none') return;

  const data = await fetchJson(`/api/requests?limit=${PAGE_SIZE}&offset=${currentPage * PAGE_SIZE}`);
  const tbody = document.getElementById('request-table-body');

  if (data.requests.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-dim)">No requests yet. Start using Goose!</td></tr>';
    document.getElementById('page-info').textContent = 'No requests';
    return;
  }

  tbody.innerHTML = data.requests.map(r => {
    const typeBadge = r.is_streaming
      ? '<span class="badge badge-stream">stream</span>'
      : '<span class="badge badge-sync">sync</span>';
    const errorBadge = r.error
      ? ' <span class="badge badge-error">error</span>'
      : '';
    return `<tr>
      <td>${fmtTime(r.timestamp)}</td>
      <td>${r.model}</td>
      <td>${fmt(r.prompt_tokens)}</td>
      <td>${fmt(r.completion_tokens)}</td>
      <td>${r.latency_ms}ms</td>
      <td>${Number(r.tokens_per_second).toFixed(1)}</td>
      <td>${fmtCost(r.estimated_local_cost)}</td>
      <td>${fmtCost(r.estimated_cloud_cost)}</td>
      <td>${typeBadge}${errorBadge}</td>
    </tr>`;
  }).join('');

  const start = currentPage * PAGE_SIZE + 1;
  const end = Math.min(start + data.requests.length - 1, data.total);
  document.getElementById('page-info').textContent = `Showing ${start}-${end} of ${data.total}`;
  document.getElementById('prev-btn').disabled = currentPage === 0;
  document.getElementById('next-btn').disabled = end >= data.total;
}

// --- Grouped Request Log ---
async function updateGroupedRequests() {
  if (currentGroupBy === 'none') return;

  const groups = await fetchJson(`/api/requests/grouped?by=${currentGroupBy}`);
  const container = document.getElementById('grouped-list');

  if (groups.length === 0) {
    container.innerHTML = '<p style="text-align:center;color:var(--text-dim);padding:20px">No requests yet</p>';
    return;
  }

  container.innerHTML = groups.map((g, i) => {
    const title = currentGroupBy === 'session'
      ? (g.group_id === 'no-session' ? 'Ungrouped Requests' : `Session: ${g.group_id.substring(0, 20)}...`)
      : `${fmtDateTime(g.first_request)} — ${fmtTime(g.last_request)}`;

    const savings = g.total_cloud_cost - g.total_local_cost;
    const savingsClass = savings >= 0 ? 'savings-positive' : 'savings-negative';

    return `<div class="group-card">
      <div class="group-header" onclick="toggleGroup(${i})">
        <span class="group-title">${title}</span>
        <div class="group-meta">
          <span>${g.request_count} reqs</span>
          <span class="highlight">${fmt(g.total_tokens)} tokens</span>
          <span>${Number(g.avg_tokens_per_second).toFixed(1)} tok/s</span>
          <span>Local: ${fmtCost(g.total_local_cost)}</span>
          <span class="${savingsClass}">Saved: ${fmtCost(Math.abs(savings))}</span>
          <span>${g.models}</span>
        </div>
      </div>
      <div class="group-body" id="group-body-${i}" data-group-id="${g.group_id}">
        <p style="color:var(--text-dim);padding:8px 0;font-size:12px">Click to load details...</p>
      </div>
    </div>`;
  }).join('');
}

window.toggleGroup = async function(index) {
  const body = document.getElementById(`group-body-${index}`);
  if (body.classList.contains('open')) {
    body.classList.remove('open');
    return;
  }

  body.classList.add('open');

  // Load details if not already loaded
  if (body.querySelector('table')) return;

  const groupId = body.dataset.groupId;
  const requests = await fetchJson(`/api/requests/group/${encodeURIComponent(groupId)}?by=${currentGroupBy}`);

  if (requests.length === 0) {
    body.innerHTML = '<p style="color:var(--text-dim);padding:8px">No requests found</p>';
    return;
  }

  body.innerHTML = `<table>
    <thead><tr>
      <th>Time</th><th>Model</th><th>In</th><th>Out</th>
      <th>Latency</th><th>Tok/s</th><th>Local</th><th>Cloud</th><th>Type</th>
    </tr></thead>
    <tbody>${requests.map(r => {
      const badge = r.is_streaming
        ? '<span class="badge badge-stream">stream</span>'
        : '<span class="badge badge-sync">sync</span>';
      return `<tr>
        <td>${fmtTime(r.timestamp)}</td>
        <td>${r.model}</td>
        <td>${fmt(r.prompt_tokens)}</td>
        <td>${fmt(r.completion_tokens)}</td>
        <td>${r.latency_ms}ms</td>
        <td>${Number(r.tokens_per_second).toFixed(1)}</td>
        <td>${fmtCost(r.estimated_local_cost)}</td>
        <td>${fmtCost(r.estimated_cloud_cost)}</td>
        <td>${badge}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
};

// --- Health check ---
async function updateHealth() {
  try {
    const health = await fetchJson('/api/health');
    const el = document.getElementById('vllm-status');
    const uptime = document.getElementById('uptime');
    const hwInfo = document.getElementById('hw-info');

    if (health.vllm_status === 'connected') {
      el.innerHTML = '<span class="status-dot connected"></span> vLLM Connected';
    } else {
      el.innerHTML = `<span class="status-dot error"></span> vLLM ${health.vllm_status}`;
    }

    const mins = Math.floor(health.uptime_seconds / 60);
    const hrs = Math.floor(mins / 60);
    uptime.textContent = hrs > 0 ? `Uptime: ${hrs}h ${mins % 60}m` : `Uptime: ${mins}m`;

    if (health.hardware) {
      hwInfo.textContent = `${health.hardware.name} (${health.hardware.gpuWatts}W)`;
    }
  } catch (e) {
    document.getElementById('vllm-status').innerHTML =
      '<span class="status-dot error"></span> Proxy Error';
  }
}

// --- Pagination ---
window.changePage = function(delta) {
  currentPage = Math.max(0, currentPage + delta);
  updateRequestLog();
};

// --- Time filter ---
document.getElementById('time-filter').addEventListener('click', (e) => {
  if (e.target.tagName !== 'BUTTON') return;
  const since = e.target.dataset.since;
  if (!since) return;

  document.querySelectorAll('.time-filter button').forEach(b => b.classList.remove('active'));
  e.target.classList.add('active');
  currentSince = since;
  currentPage = 0;
  refreshAll();
});

// --- Group by controls ---
document.querySelector('.log-controls').addEventListener('click', (e) => {
  const btn = e.target.closest('.group-btn');
  if (!btn) return;
  const group = btn.dataset.group;

  document.querySelectorAll('.group-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentGroupBy = group;

  document.getElementById('flat-requests').style.display = group === 'none' ? 'block' : 'none';
  document.getElementById('grouped-requests').style.display = group === 'none' ? 'none' : 'block';

  if (group === 'none') {
    updateRequestLog();
  } else {
    updateGroupedRequests();
  }
});

// --- SSE live updates ---
function connectLive() {
  const es = new EventSource('/api/live');
  es.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'request') {
        refreshAll();
      }
    } catch (e) { /* ignore */ }
  };
  es.onerror = () => {
    es.close();
    setTimeout(connectLive, 5000);
  };
}

// --- vLLM Metrics ---
function fmtMs(seconds) {
  if (seconds === 0 || isNaN(seconds)) return '—';
  if (seconds < 0.001) return (seconds * 1_000_000).toFixed(0) + 'us';
  if (seconds < 1) return (seconds * 1000).toFixed(1) + 'ms';
  return seconds.toFixed(2) + 's';
}

async function updateVllmMetrics() {
  try {
    const data = await fetchJson('/api/vllm-metrics');
    if (data.error) {
      document.getElementById('vllm-engine-state').textContent = 'Waiting...';
      return;
    }

    // Model name
    document.getElementById('vllm-model-name').textContent = data.model;

    // Engine state
    const stateEl = document.getElementById('vllm-engine-state');
    if (data.engine.awake) {
      stateEl.textContent = 'Awake';
      stateEl.style.color = 'var(--green)';
    } else if (data.engine.weightsOffloaded) {
      stateEl.textContent = 'Sleeping (L1)';
      stateEl.style.color = 'var(--yellow)';
    } else {
      stateEl.textContent = 'Sleeping';
      stateEl.style.color = 'var(--text-dim)';
    }
    document.getElementById('vllm-queue').textContent =
      `${data.engine.requestsRunning} running / ${data.engine.requestsWaiting} waiting`;

    // KV Cache
    const kvPct = data.cache.kvUsagePercent;
    document.getElementById('vllm-kv-cache').textContent = kvPct.toFixed(1) + '%';
    const kvBar = document.getElementById('vllm-kv-bar');
    kvBar.style.width = kvPct + '%';
    kvBar.className = 'vllm-bar-fill' + (kvPct > 90 ? ' critical' : kvPct > 70 ? ' warn' : '');

    // Prefix cache hit rate
    document.getElementById('vllm-cache-hit').textContent = data.cache.prefixHitRate.toFixed(1) + '%';
    document.getElementById('vllm-cache-detail').textContent =
      `${fmt(data.cache.prefixHits)} / ${fmt(data.cache.prefixQueries)} tokens`;

    // Latency
    document.getElementById('vllm-ttft').textContent = fmtMs(data.latency.avgTimeToFirstToken);
    document.getElementById('vllm-itl').textContent =
      `inter-token: ${fmtMs(data.latency.avgInterTokenLatency)}`;
    document.getElementById('vllm-e2e').textContent = fmtMs(data.latency.avgE2eLatency);
    document.getElementById('vllm-phases').textContent =
      `prefill: ${fmtMs(data.latency.avgPrefillTime)} / decode: ${fmtMs(data.latency.avgDecodeTime)}`;

    // Totals
    document.getElementById('vllm-total-reqs').textContent = fmt(data.requests.total);
    document.getElementById('vllm-total-tokens').textContent =
      `${fmt(data.tokens.totalPrompt)} prompt / ${fmt(data.tokens.totalGeneration)} gen`;

    // Prompt token sources
    const totalPromptSrc = data.tokens.promptCached + data.tokens.promptComputed;
    const cachedPct = totalPromptSrc > 0 ? (data.tokens.promptCached / totalPromptSrc * 100) : 0;
    document.getElementById('vllm-prompt-cached').textContent = cachedPct.toFixed(0) + '% cached';
    document.getElementById('vllm-prompt-breakdown').textContent =
      `${fmt(data.tokens.promptCached)} cached / ${fmt(data.tokens.promptComputed)} computed`;

    // Process
    document.getElementById('vllm-memory').textContent = data.process.residentMemoryMB + ' MB';
    document.getElementById('vllm-cpu').textContent =
      `CPU: ${data.process.cpuSeconds.toFixed(0)}s / vMem: ${data.process.virtualMemoryGB} GB`;

  } catch (e) {
    document.getElementById('vllm-engine-state').textContent = 'Unreachable';
    document.getElementById('vllm-engine-state').style.color = 'var(--red)';
  }
}

async function updateVllmHistoryChart() {
  try {
    const history = await fetchJson('/api/vllm-metrics/history');
    if (history.length < 2) return;

    const labels = history.map(h => {
      const d = new Date(h.timestamp);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    });

    const kvData = history.map(h => h.cache?.kvUsagePercent || 0);
    const runningData = history.map(h => h.engine?.requestsRunning || 0);
    const waitingData = history.map(h => h.engine?.requestsWaiting || 0);

    if (vllmHistoryChart) vllmHistoryChart.destroy();

    vllmHistoryChart = new Chart(document.getElementById('vllm-history-chart'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'KV Cache %',
            data: kvData,
            borderColor: '#6c63ff',
            backgroundColor: 'rgba(107, 99, 255, 0.1)',
            fill: true,
            tension: 0.3,
            yAxisID: 'y'
          },
          {
            label: 'Running',
            data: runningData,
            borderColor: '#22c55e',
            backgroundColor: 'rgba(34, 197, 94, 0.1)',
            fill: false,
            tension: 0.3,
            yAxisID: 'y1'
          },
          {
            label: 'Waiting',
            data: waitingData,
            borderColor: '#f97316',
            backgroundColor: 'rgba(249, 115, 22, 0.1)',
            fill: false,
            tension: 0.3,
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: '#8b8fa3', font: { size: 11 } } }
        },
        scales: {
          x: { ticks: { color: '#8b8fa3', font: { size: 10 }, maxTicksLimit: 10 }, grid: { color: '#2a2e3e' } },
          y: {
            type: 'linear', position: 'left',
            min: 0, max: 100,
            title: { display: true, text: 'KV Cache %', color: '#8b8fa3' },
            ticks: { color: '#8b8fa3', font: { size: 10 } },
            grid: { color: '#2a2e3e' }
          },
          y1: {
            type: 'linear', position: 'right',
            min: 0,
            title: { display: true, text: 'Requests', color: '#8b8fa3' },
            ticks: { color: '#8b8fa3', font: { size: 10 }, stepSize: 1 },
            grid: { drawOnChartArea: false }
          }
        }
      }
    });
  } catch (e) { /* vLLM may be unreachable */ }
}

// --- Chat Analytics ---
let chatBarChart = null;
let currentChatView = 'tiles';
let chatData = null;

window.setChatView = function(view) {
  currentChatView = view;
  document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.view-btn[data-view="${view}"]`).classList.add('active');

  document.getElementById('chat-tiles-view').style.display = view === 'tiles' ? 'grid' : 'none';
  document.getElementById('chat-bar-view').style.display = view === 'bar' ? 'block' : 'none';
  document.getElementById('chat-table-view').style.display = view === 'table' ? 'block' : 'none';

  if (chatData) renderChatView(chatData);
};

async function updateChatAnalytics() {
  chatData = await fetchJson('/api/chats');
  renderChatView(chatData);
}

function projectName(dir) {
  if (!dir) return '';
  const parts = dir.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || '';
}

function renderChatView(data) {
  const allChats = [...data.tracked, ...data.untracked];
  if (currentChatView === 'tiles') renderChatTiles(allChats);
  else if (currentChatView === 'bar') renderChatBarChart(data.tracked);
  else if (currentChatView === 'table') renderChatTable(allChats);
}

function renderChatTiles(chats) {
  const container = document.getElementById('chat-tiles-view');
  if (chats.length === 0) {
    container.innerHTML = '<p style="text-align:center;color:var(--text-dim);padding:40px;grid-column:1/-1">No chats yet. Start using Goose through the tracker!</p>';
    return;
  }

  // Find max tokens for relative bar sizing
  const maxTokens = Math.max(...chats.map(c => c.total_tokens || 1));

  container.innerHTML = chats.map(c => {
    const total = c.total_tokens || 0;
    const inPct = total > 0 ? (c.total_prompt_tokens / total * 100) : 50;
    const outPct = total > 0 ? (c.total_completion_tokens / total * 100) : 50;
    const barWidth = total > 0 ? (total / maxTokens * 100) : 0;
    const savings = c.savings || 0;
    const untrackedCls = c.goose_only ? ' untracked' : '';
    const project = projectName(c.working_dir);

    return `<div class="chat-tile${untrackedCls}" onclick="openChatDetail('${c.session_id}')">
      <div class="chat-tile-name" title="${c.name}">${c.name}</div>
      ${project ? `<div class="chat-tile-project" title="${c.working_dir}">${project}</div>` : '<div class="chat-tile-project">—</div>'}
      <div class="chat-tile-stats">
        <div class="chat-tile-stat">
          <span class="chat-tile-stat-label">Input</span>
          <span class="chat-tile-stat-value purple">${fmt(c.total_prompt_tokens)}</span>
        </div>
        <div class="chat-tile-stat">
          <span class="chat-tile-stat-label">Output</span>
          <span class="chat-tile-stat-value blue">${fmt(c.total_completion_tokens)}</span>
        </div>
        <div class="chat-tile-stat">
          <span class="chat-tile-stat-label">Local Cost</span>
          <span class="chat-tile-stat-value">${fmtCost(c.total_local_cost)}</span>
        </div>
        <div class="chat-tile-stat">
          <span class="chat-tile-stat-label">Saved</span>
          <span class="chat-tile-stat-value green">${fmtCost(Math.abs(savings))}</span>
        </div>
      </div>
      <div class="chat-tile-bar" style="width:${barWidth}%">
        <div class="chat-tile-bar-in" style="width:${inPct}%"></div>
        <div class="chat-tile-bar-out" style="width:${outPct}%"></div>
      </div>
      <div class="chat-tile-date">${c.request_count} reqs &middot; ${fmtDateTime(c.created_at)}</div>
    </div>`;
  }).join('');
}

function renderChatBarChart(chats) {
  if (chatBarChart) chatBarChart.destroy();
  if (chats.length === 0) return;

  // Show top 20 by total tokens
  const sorted = [...chats].sort((a, b) => b.total_tokens - a.total_tokens).slice(0, 20);

  chatBarChart = new Chart(document.getElementById('chat-bar-chart'), {
    type: 'bar',
    data: {
      labels: sorted.map(c => c.name.length > 25 ? c.name.substring(0, 25) + '...' : c.name),
      datasets: [
        {
          label: 'Input Tokens',
          data: sorted.map(c => c.total_prompt_tokens),
          backgroundColor: 'rgba(107, 99, 255, 0.7)',
          borderRadius: 4
        },
        {
          label: 'Output Tokens',
          data: sorted.map(c => c.total_completion_tokens),
          backgroundColor: 'rgba(34, 197, 94, 0.7)',
          borderRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: {
        legend: { labels: { color: '#8b8fa3', font: { size: 11 } } },
        tooltip: {
          callbacks: {
            afterBody: function(items) {
              const idx = items[0].dataIndex;
              const chat = sorted[idx];
              return `Local: ${fmtCost(chat.total_local_cost)} | Saved: ${fmtCost(chat.savings)}`;
            }
          }
        }
      },
      scales: {
        x: {
          stacked: true,
          ticks: { color: '#8b8fa3', font: { size: 10 } },
          grid: { color: '#2a2e3e' }
        },
        y: {
          stacked: true,
          ticks: { color: '#8b8fa3', font: { size: 11 } },
          grid: { color: '#2a2e3e' }
        }
      }
    }
  });
}

function renderChatTable(chats) {
  const tbody = document.getElementById('chat-table-body');
  if (chats.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--text-dim)">No chats</td></tr>';
    return;
  }

  tbody.innerHTML = chats.map(c => {
    const savings = c.savings || 0;
    const cls = savings >= 0 ? 'savings-positive' : '';
    const project = projectName(c.working_dir);
    return `<tr style="cursor:pointer" onclick="openChatDetail('${c.session_id}')">
      <td><strong>${c.name}</strong></td>
      <td style="color:var(--accent);font-size:12px">${project}</td>
      <td>${c.request_count}</td>
      <td>${fmt(c.total_prompt_tokens)}</td>
      <td>${fmt(c.total_completion_tokens)}</td>
      <td>${fmt(c.total_tokens)}</td>
      <td>${fmtCost(c.total_local_cost)}</td>
      <td>${fmtCost(c.total_cloud_cost)}</td>
      <td class="${cls}">${fmtCost(Math.abs(savings))}</td>
      <td style="font-size:12px">${fmtDateTime(c.created_at)}</td>
    </tr>`;
  }).join('');
}

// Chat Detail Modal
window.openChatDetail = async function(sessionId) {
  const modal = document.getElementById('chat-detail-modal');
  const body = document.getElementById('chat-detail-body');
  const nameEl = document.getElementById('chat-detail-name');

  modal.style.display = 'flex';
  body.innerHTML = '<p style="color:var(--text-dim);padding:20px;text-align:center">Loading...</p>';

  const data = await fetchJson(`/api/chats/${encodeURIComponent(sessionId)}`);

  nameEl.textContent = data.name || sessionId;

  const defaultCloud = data.cloud_costs[selectedCompareModels[0]] || data.cloud_costs['gpt-4o'] || 0;
  const savings = defaultCloud - data.local_cost;
  const project = projectName(data.working_dir);

  let html = `
    <div style="font-size:12px;color:var(--text-dim);margin-bottom:16px">
      ${project ? `<span style="color:var(--accent)">${project}</span> &middot; ` : ''}
      ${data.provider || ''} &middot; ${data.goose_mode || ''} mode &middot;
      ${data.message_count} messages &middot; Created ${fmtDateTime(data.created_at)}
    </div>
    <div class="chat-detail-grid">
      <div class="chat-detail-card">
        <div class="chat-detail-label">Requests</div>
        <div class="chat-detail-value">${data.request_count}</div>
      </div>
      <div class="chat-detail-card">
        <div class="chat-detail-label">Input Tokens</div>
        <div class="chat-detail-value">${fmt(data.total_prompt_tokens)}</div>
      </div>
      <div class="chat-detail-card">
        <div class="chat-detail-label">Output Tokens</div>
        <div class="chat-detail-value">${fmt(data.total_completion_tokens)}</div>
      </div>
      <div class="chat-detail-card">
        <div class="chat-detail-label">Total Tokens</div>
        <div class="chat-detail-value">${fmt(data.total_tokens)}</div>
      </div>
      <div class="chat-detail-card">
        <div class="chat-detail-label">Avg Latency</div>
        <div class="chat-detail-value">${data.avg_latency_ms}ms</div>
      </div>
      <div class="chat-detail-card">
        <div class="chat-detail-label">Avg Tok/s</div>
        <div class="chat-detail-value">${data.avg_tokens_per_second}</div>
      </div>
      <div class="chat-detail-card">
        <div class="chat-detail-label">Local Cost</div>
        <div class="chat-detail-value">${fmtCost(data.local_cost)}</div>
      </div>
      <div class="chat-detail-card">
        <div class="chat-detail-label">Saved</div>
        <div class="chat-detail-value green">${fmtCost(Math.abs(savings))}</div>
      </div>
    </div>`;

  // Cloud cost comparison for this chat
  if (Object.keys(data.cloud_costs).length > 0) {
    html += `<h4 style="color:var(--text-dim);font-size:12px;text-transform:uppercase;letter-spacing:0.5px;margin:16px 0 8px">If this chat ran on cloud</h4>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px">`;
    for (const model of selectedCompareModels) {
      const cost = data.cloud_costs[model];
      if (cost === undefined) continue;
      const save = cost - data.local_cost;
      html += `<div style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:8px 12px;font-size:12px">
        <div style="color:var(--text-dim)">${model}</div>
        <div style="color:var(--text-bright);font-weight:600">${fmtCost(cost)}</div>
        <div style="color:var(--green);font-size:11px">save ${fmtCost(save)}</div>
      </div>`;
    }
    html += '</div>';
  }

  // Request list for this chat
  if (data.requests && data.requests.length > 0) {
    html += `<h4 style="color:var(--text-dim);font-size:12px;text-transform:uppercase;letter-spacing:0.5px;margin:16px 0 8px">Requests (${data.requests.length})</h4>
    <div class="table-scroll"><table style="font-size:12px">
      <thead><tr><th>Time</th><th>In</th><th>Out</th><th>Latency</th><th>Tok/s</th><th>Local</th><th>Cloud</th></tr></thead>
      <tbody>`;
    for (const r of data.requests.slice(0, 50)) {
      html += `<tr>
        <td>${fmtTime(r.timestamp)}</td>
        <td>${fmt(r.prompt_tokens)}</td>
        <td>${fmt(r.completion_tokens)}</td>
        <td>${r.latency_ms}ms</td>
        <td>${Number(r.tokens_per_second).toFixed(1)}</td>
        <td>${fmtCost(r.estimated_local_cost)}</td>
        <td>${fmtCost(r.estimated_cloud_cost)}</td>
      </tr>`;
    }
    if (data.requests.length > 50) {
      html += `<tr><td colspan="7" style="text-align:center;color:var(--text-dim)">... and ${data.requests.length - 50} more</td></tr>`;
    }
    html += '</tbody></table></div>';
  }

  body.innerHTML = html;
};

window.closeChatDetail = function() {
  document.getElementById('chat-detail-modal').style.display = 'none';
};

// Close modal on backdrop click
document.getElementById('chat-detail-modal')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeChatDetail();
});

// --- Goose Lifetime Stats ---
async function updateLifetimeStats() {
  try {
    const res = await fetch('/api/goose/lifetime');
    const data = await res.json();
    const banner = document.getElementById('lifetime-banner');
    if (!data.connected) {
      banner.style.display = 'none';
      return;
    }
    banner.style.display = 'flex';

    const fmt = (n) => {
      if (!n) return '0';
      if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
      if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
      return n.toLocaleString();
    };

    document.getElementById('lifetime-tokens').textContent = fmt(data.total_tokens) + ' tokens';
    document.getElementById('lifetime-breakdown').textContent =
      `${fmt(data.input_tokens)} in / ${fmt(data.output_tokens)} out`;
    document.getElementById('lifetime-sessions').textContent =
      `${data.total_sessions || 0} chats`;
    document.getElementById('lifetime-messages').textContent =
      `${(data.total_messages || 0).toLocaleString()} messages`;

    if (data.first_session) {
      const d = new Date(data.first_session);
      document.getElementById('lifetime-since').textContent =
        `since ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }
  } catch (e) {
    console.warn('Lifetime stats error:', e);
  }
}

// --- Settings Modal ---
window.openSettings = async function() {
  document.getElementById('settings-modal').style.display = 'flex';
  await loadSettings();
};

window.closeSettings = function() {
  document.getElementById('settings-modal').style.display = 'none';
};

// Close settings modal on backdrop click
document.getElementById('settings-modal')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeSettings();
});

async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const s = await res.json();

    document.getElementById('setting-targetUrl').value = s.targetUrl || '';
    document.getElementById('setting-gooseSessionsDb').value = s.gooseSessionsDb || '';
    document.getElementById('setting-hwName').value = s.hardware?.name || '';
    document.getElementById('setting-gpuWatts').value = s.hardware?.gpuWatts || '';
    document.getElementById('setting-electricityCost').value = s.hardware?.electricityCostPerKwh || '';
    document.getElementById('setting-localInput').value = s.localModelPricing?.default?.inputPerMillion || '';
    document.getElementById('setting-localOutput').value = s.localModelPricing?.default?.outputPerMillion || '';

    // Populate default compare model dropdown
    const select = document.getElementById('setting-defaultCompare');
    select.innerHTML = '';
    if (allCloudModels.length > 0) {
      for (const m of allCloudModels) {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name;
        if (m.id === s.defaultCompareModel) opt.selected = true;
        select.appendChild(opt);
      }
    } else {
      const opt = document.createElement('option');
      opt.value = s.defaultCompareModel;
      opt.textContent = s.defaultCompareModel;
      opt.selected = true;
      select.appendChild(opt);
    }

    document.getElementById('settings-status').textContent = '';
  } catch (e) {
    document.getElementById('settings-status').textContent = 'Failed to load settings';
  }
}

window.saveSettings = async function() {
  const status = document.getElementById('settings-status');
  status.textContent = 'Saving...';
  status.style.color = '#aaa';

  const payload = {
    targetUrl: document.getElementById('setting-targetUrl').value.trim(),
    gooseSessionsDb: document.getElementById('setting-gooseSessionsDb').value.trim(),
    hardware: {
      name: document.getElementById('setting-hwName').value.trim(),
      gpuWatts: parseFloat(document.getElementById('setting-gpuWatts').value) || 125,
      electricityCostPerKwh: parseFloat(document.getElementById('setting-electricityCost').value) || 0.12
    },
    localModelPricing: {
      default: {
        inputPerMillion: parseFloat(document.getElementById('setting-localInput').value) || 0.02,
        outputPerMillion: parseFloat(document.getElementById('setting-localOutput').value) || 0.10
      }
    },
    defaultCompareModel: document.getElementById('setting-defaultCompare').value
  };

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.ok) {
      status.textContent = '✓ Settings saved!';
      status.style.color = '#4ade80';
      // Refresh lifetime stats in case Goose DB path changed
      setTimeout(() => updateLifetimeStats(), 500);
    } else {
      status.textContent = data.error || 'Save failed';
      status.style.color = '#f87171';
    }
  } catch (e) {
    status.textContent = 'Network error saving settings';
    status.style.color = '#f87171';
  }
};

window.detectGoose = async function() {
  const statusEl = document.getElementById('goose-db-status');
  statusEl.textContent = 'Searching...';

  try {
    const res = await fetch('/api/settings/detect-goose', { method: 'POST' });
    const data = await res.json();

    if (data.suggested) {
      document.getElementById('setting-gooseSessionsDb').value = data.suggested;
      statusEl.textContent = `✓ Found! (${data.found.length} location${data.found.length > 1 ? 's' : ''})`;
      statusEl.style.color = '#4ade80';
    } else {
      statusEl.textContent = `Not found. Searched ${data.searched.length} locations.`;
      statusEl.style.color = '#f87171';
    }
  } catch (e) {
    statusEl.textContent = 'Detection failed';
    statusEl.style.color = '#f87171';
  }
};

// --- Main refresh ---
async function refreshAll() {
  await Promise.all([
    updateStats(),
    updateUsageChart(),
    updateModelChart(),
    updateChatAnalytics(),
    updateCostComparison(),
    updateVllmMetrics(),
    updateVllmHistoryChart(),
    currentGroupBy === 'none' ? updateRequestLog() : updateGroupedRequests(),
    updateHealth()
  ]);
}

// --- Init ---
async function init() {
  await initModelSelector();
  await refreshAll();
  updateLifetimeStats(); // fetch once on load (not every refresh)
  connectLive();
}

init();

// Poll every 10s as fallback
setInterval(refreshAll, 10000);

// Refresh lifetime stats every 60s (not as frequently as main stats)
setInterval(updateLifetimeStats, 60000);
