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

// --- Security: HTML escape helper ---
function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
  currentDefaultModel = data.defaultCompare || 'gpt-4o';

  renderModelCheckboxes();
}

function renderModelCheckboxes() {
  const container = document.getElementById('model-checkboxes');
  container.innerHTML = allCloudModels.map(m => {
    const checked = selectedCompareModels.includes(m.id);
    return `<label class="${checked ? 'checked' : ''}" data-model="${m.id}">${m.id}</label>`;
  }).join('');

  // Use mousedown instead of click to avoid label/checkbox double-fire
  container.addEventListener('click', (e) => {
    const label = e.target.closest('label[data-model]');
    if (!label) return;
    e.preventDefault();
    const model = label.dataset.model;
    const idx = selectedCompareModels.indexOf(model);
    if (idx >= 0) {
      selectedCompareModels.splice(idx, 1);
      label.classList.remove('checked');
    } else {
      selectedCompareModels.push(model);
      label.classList.add('checked');
    }
    updateCostComparison();
  });
}

// --- Summary cards ---
let currentDefaultModel = 'gpt-4o';

async function updateStats() {
  const stats = await fetchJson(`/api/stats?since=${currentSince}`);

  document.getElementById('total-tokens').textContent = fmt(stats.total_tokens);
  document.getElementById('token-breakdown').textContent =
    t('stats.tokenBreakdown', { in: fmt(stats.total_prompt_tokens), out: fmt(stats.total_completion_tokens) });
  document.getElementById('total-requests').textContent = fmt(stats.total_requests);
  document.getElementById('avg-latency').textContent =
    t('stats.avgLatency', { ms: Math.round(stats.avg_latency_ms) });
  document.getElementById('avg-tps').textContent =
    Number(stats.avg_tokens_per_second).toFixed(1);
  document.getElementById('local-cost').textContent = fmtCost(stats.total_local_cost);
  document.getElementById('cloud-cost').textContent = fmtCost(stats.total_cloud_cost);
  document.getElementById('savings').textContent = fmtCost(stats.savings);

  // Update pricing labels to reflect current config
  const inPrice = stats.local_input_per_million;
  const outPrice = stats.local_output_per_million;
  document.getElementById('local-pricing-label').textContent =
    t('stats.pricingLabel', { inPrice, outPrice });
  document.getElementById('cloud-model-label').textContent =
    t('stats.vsModel', { model: currentDefaultModel });

  const pct = stats.total_cloud_cost > 0
    ? ((stats.savings / stats.total_cloud_cost) * 100).toFixed(1)
    : '0';
  document.getElementById('savings-pct').textContent = t('stats.savingsPct', { pct });
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
  let endpoint;
  if (currentSince === '1h') endpoint = '/api/trends/hourly?hours=1';
  else if (currentSince === '24h') endpoint = '/api/trends/hourly?hours=24';
  else if (currentSince === '7d') endpoint = '/api/trends/daily?days=7';
  else if (currentSince === '30d') endpoint = '/api/trends/daily?days=30';
  else endpoint = '/api/trends/daily?days=3650';
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
          label: t('chart.promptTokens'),
          data: promptData,
          borderColor: chartColors.prompt,
          backgroundColor: chartColors.promptBg,
          fill: true,
          tension: 0.3,
          yAxisID: 'yInput'
        },
        {
          label: t('chart.completionTokens'),
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
          title: { display: true, text: t('chart.inputTokens'), color: chartColors.prompt },
          ticks: { color: chartColors.prompt, font: { size: 10 } },
          grid: { color: '#2a2e3e' }
        },
        yOutput: {
          type: 'linear',
          position: 'right',
          title: { display: true, text: t('chart.outputTokens'), color: chartColors.completion },
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
  const [data, modelsData] = await Promise.all([
    fetchJson('/api/cost-comparison'),
    allCloudModels.length > 0 ? Promise.resolve(null) : fetchJson('/api/cloud-models')
  ]);
  // Build a pricing lookup
  const pricingLookup = {};
  for (const m of allCloudModels) {
    pricingLookup[m.id] = m;
  }

  const thead = document.getElementById('cost-table-head');
  const tbody = document.getElementById('cost-table-body');
  const tfoot = document.getElementById('cost-table-foot');

  // Build dynamic header — each cloud model gets two sub-columns (in/out + total)
  const modelHeaders = selectedCompareModels.map(m => {
    const p = pricingLookup[m];
    const sub = p ? `<div class="cost-col-pricing">$${p.inputPerMillion} in / $${p.outputPerMillion} out</div>` : '';
    return `<th class="cost-model-col"><div>${m}</div>${sub}</th>`;
  }).join('');

  const colCount = 5 + selectedCompareModels.length;
  thead.innerHTML = `<tr>
    <th>${t('cost.colLocalModel')}</th>
    <th>${t('cost.colInputTokens')}</th>
    <th>${t('cost.colOutputTokens')}</th>
    <th>${t('cost.colLocalCost')}<div class="cost-col-pricing">${t('cost.inOut')}</div></th>
    ${modelHeaders}
    <th>${t('cost.colBestSavings')}</th>
  </tr>`;

  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="' + colCount +
      '" style="text-align:center;color:var(--text-dim)">' + t('cost.noData') + '</td></tr>';
    tfoot.innerHTML = '';
    return;
  }

  // Totals accumulators
  let totalPrompt = 0, totalCompletion = 0;
  let totalLocal = 0;
  const totalCloud = {};
  selectedCompareModels.forEach(m => totalCloud[m] = 0);

  tbody.innerHTML = data.map(row => {
    totalPrompt += row.total_prompt_tokens;
    totalCompletion += row.total_completion_tokens;
    totalLocal += row.total_local_cost;

    const cloudCells = selectedCompareModels.map(m => {
      const cost = row.cloud_costs?.[m] || 0;
      totalCloud[m] = (totalCloud[m] || 0) + cost;
      // Compute per-model in/out breakdown
      const p = pricingLookup[m];
      let inCost = 0, outCost = 0;
      if (p) {
        inCost = (row.total_prompt_tokens / 1_000_000) * p.inputPerMillion;
        outCost = (row.total_completion_tokens / 1_000_000) * p.outputPerMillion;
      }
      return `<td><span class="cost-total">${fmtCost(cost)}</span><span class="cost-breakdown">${fmtCost(inCost)} + ${fmtCost(outCost)}</span></td>`;
    }).join('');

    // Local in/out breakdown
    const localPricing = { inputPerMillion: 0.02, outputPerMillion: 0.10 }; // fallback
    const localInCost = (row.total_prompt_tokens / 1_000_000) * (localPricing.inputPerMillion);
    const localOutCost = (row.total_completion_tokens / 1_000_000) * (localPricing.outputPerMillion);

    // Best savings = max cloud cost - local cost
    const maxCloud = Math.max(...selectedCompareModels.map(m => row.cloud_costs?.[m] || 0));
    const bestSaving = maxCloud - row.total_local_cost;
    const cls = bestSaving >= 0 ? 'savings-positive' : 'savings-negative';

    return `<tr>
      <td>${esc(row.model)}</td>
      <td>${fmt(row.total_prompt_tokens)}</td>
      <td>${fmt(row.total_completion_tokens)}</td>
      <td><span class="cost-total">${fmtCost(row.total_local_cost)}</span><span class="cost-breakdown">${fmtCost(localInCost)} + ${fmtCost(localOutCost)}</span></td>
      ${cloudCells}
      <td class="${cls}">${fmtCost(Math.abs(bestSaving))} ${bestSaving >= 0 ? t('cost.saved') : t('cost.extra')}</td>
    </tr>`;
  }).join('');

  // Totals row
  const totalCloudCells = selectedCompareModels.map(m => {
    const p = pricingLookup[m];
    let inCost = 0, outCost = 0;
    if (p) {
      inCost = (totalPrompt / 1_000_000) * p.inputPerMillion;
      outCost = (totalCompletion / 1_000_000) * p.outputPerMillion;
    }
    return `<td><span class="cost-total">${fmtCost(totalCloud[m] || 0)}</span><span class="cost-breakdown">${fmtCost(inCost)} + ${fmtCost(outCost)}</span></td>`;
  }).join('');
  const maxTotalCloud = Math.max(...selectedCompareModels.map(m => totalCloud[m] || 0));
  const totalSaving = maxTotalCloud - totalLocal;
  const totalCls = totalSaving >= 0 ? 'savings-positive' : 'savings-negative';

  tfoot.innerHTML = `<tr>
    <td>${t('cost.total')}</td>
    <td>${fmt(totalPrompt)}</td>
    <td>${fmt(totalCompletion)}</td>
    <td>${fmtCost(totalLocal)}</td>
    ${totalCloudCells}
    <td class="${totalCls}">${fmtCost(Math.abs(totalSaving))} ${totalSaving >= 0 ? t('cost.saved') : t('cost.extra')}</td>
  </tr>`;
}

// --- Request Log (flat) ---
async function updateRequestLog() {
  if (currentGroupBy !== 'none') return;

  const data = await fetchJson(`/api/requests?limit=${PAGE_SIZE}&offset=${currentPage * PAGE_SIZE}`);
  const tbody = document.getElementById('request-table-body');

  if (data.requests.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--text-dim)">${t('log.noRequestsYet')}</td></tr>`;
    document.getElementById('page-info').textContent = t('log.noRequests');
    return;
  }

  tbody.innerHTML = data.requests.map(r => {
    const typeBadge = r.is_streaming
      ? `<span class="badge badge-stream">${t('badge.stream')}</span>`
      : `<span class="badge badge-sync">${t('badge.sync')}</span>`;
    const errorBadge = r.error
      ? ` <span class="badge badge-error">${t('badge.error')}</span>`
      : '';
    return `<tr>
      <td>${fmtTime(r.timestamp)}</td>
      <td>${esc(r.model)}</td>
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
  document.getElementById('page-info').textContent =
    t('log.showing', { start, end, total: data.total });
  document.getElementById('prev-btn').disabled = currentPage === 0;
  document.getElementById('next-btn').disabled = end >= data.total;
}

// --- Grouped Request Log ---
async function updateGroupedRequests() {
  if (currentGroupBy === 'none') return;

  const groups = await fetchJson(`/api/requests/grouped?by=${currentGroupBy}`);
  const container = document.getElementById('grouped-list');

  if (groups.length === 0) {
    container.innerHTML = `<p style="text-align:center;color:var(--text-dim);padding:20px">${t('log.noRequestsGroup')}</p>`;
    return;
  }

  container.innerHTML = groups.map((g, i) => {
    const title = currentGroupBy === 'session'
      ? (g.group_id === 'no-session'
          ? t('log.ungrouped')
          : t('log.session', { id: esc(g.group_id).substring(0, 20) }) + '...')
      : `${fmtDateTime(g.first_request)} — ${fmtTime(g.last_request)}`;

    const savings = g.total_cloud_cost - g.total_local_cost;
    const savingsClass = savings >= 0 ? 'savings-positive' : 'savings-negative';

    return `<div class="group-card">
      <div class="group-header" onclick="toggleGroup(${i})">
        <span class="group-title">${title}</span>
        <div class="group-meta">
          <span>${t('log.reqs', { n: g.request_count })}</span>
          <span class="highlight">${fmt(g.total_tokens)} tokens</span>
          <span>${Number(g.avg_tokens_per_second).toFixed(1)} tok/s</span>
          <span>${t('log.local')} ${fmtCost(g.total_local_cost)}</span>
          <span class="${savingsClass}">${t('log.savedLabel')} ${fmtCost(Math.abs(savings))}</span>
          <span>${esc(g.models)}</span>
        </div>
      </div>
      <div class="group-body" id="group-body-${i}" data-group-id="${esc(g.group_id)}">
        <p style="color:var(--text-dim);padding:8px 0;font-size:12px">${t('log.clickLoad')}</p>
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
    body.innerHTML = `<p style="color:var(--text-dim);padding:8px">${t('log.noFound')}</p>`;
    return;
  }

  body.innerHTML = `<table>
    <thead><tr>
      <th>${t('log.colTime')}</th><th>${t('log.colModel')}</th>
      <th>${t('log.colIn')}</th><th>${t('log.colOut')}</th>
      <th>${t('log.colLatency')}</th><th>${t('log.colTps')}</th>
      <th>${t('log.colLocal')}</th><th>${t('log.colCloud')}</th>
      <th>${t('log.colType')}</th>
    </tr></thead>
    <tbody>${requests.map(r => {
      const badge = r.is_streaming
        ? `<span class="badge badge-stream">${t('badge.stream')}</span>`
        : `<span class="badge badge-sync">${t('badge.sync')}</span>`;
      return `<tr>
        <td>${fmtTime(r.timestamp)}</td>
        <td>${esc(r.model)}</td>
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
      el.innerHTML = `<span class="status-dot connected"></span> ${t('status.connected')}`;
    } else {
      el.innerHTML = `<span class="status-dot error"></span> vLLM ${health.vllm_status}`;
    }

    const mins = Math.floor(health.uptime_seconds / 60);
    const hrs = Math.floor(mins / 60);
    uptime.textContent = hrs > 0
      ? t('status.uptimeHM', { h: hrs, m: mins % 60 })
      : t('status.uptimeM', { m: mins });

    if (health.hardware) {
      hwInfo.textContent = `${health.hardware.name} (${health.hardware.gpuWatts}W)`;
    }
  } catch (e) {
    document.getElementById('vllm-status').innerHTML =
      `<span class="status-dot error"></span> ${t('status.proxyError')}`;
  }
}

// --- Pagination ---
window.changePage = function(delta) {
  currentPage = Math.max(0, currentPage + delta);
  updateRequestLog();
};

// --- Section nav scroll highlight ---
(function() {
  const sections = ['summary-cards', 'vllm-section', 'chat-section', 'cost-section', 'log-section'];
  function updateActiveNavLink() {
    let current = sections[0];
    for (const id of sections) {
      const el = document.getElementById(id);
      if (el && el.getBoundingClientRect().top <= 80) current = id;
    }
    document.querySelectorAll('.section-nav-link').forEach(a => {
      a.classList.toggle('active', a.dataset.section === current);
    });
  }
  window.addEventListener('scroll', updateActiveNavLink, { passive: true });

  // Smooth scroll on nav click
  document.getElementById('section-nav').addEventListener('click', (e) => {
    const link = e.target.closest('.section-nav-link');
    if (!link) return;
    e.preventDefault();
    const target = document.getElementById(link.dataset.section);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
})();

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
      document.getElementById('vllm-engine-state').textContent = t('vllm.waiting');
      return;
    }

    // Model name
    document.getElementById('vllm-model-name').textContent = data.model;

    // Engine state
    const stateEl = document.getElementById('vllm-engine-state');
    if (data.engine.awake) {
      stateEl.textContent = t('vllm.awake');
      stateEl.style.color = 'var(--green)';
    } else if (data.engine.weightsOffloaded) {
      stateEl.textContent = t('vllm.sleepingL1');
      stateEl.style.color = 'var(--yellow)';
    } else {
      stateEl.textContent = t('vllm.sleeping');
      stateEl.style.color = 'var(--text-dim)';
    }
    document.getElementById('vllm-queue').textContent =
      t('vllm.runningWaiting', { running: data.engine.requestsRunning, waiting: data.engine.requestsWaiting });

    // KV Cache
    const kvPct = data.cache.kvUsagePercent;
    document.getElementById('vllm-kv-cache').textContent = kvPct.toFixed(1) + '%';
    const kvBar = document.getElementById('vllm-kv-bar');
    kvBar.style.width = kvPct + '%';
    kvBar.className = 'vllm-bar-fill' + (kvPct > 90 ? ' critical' : kvPct > 70 ? ' warn' : '');

    // Prefix cache hit rate
    document.getElementById('vllm-cache-hit').textContent = data.cache.prefixHitRate.toFixed(1) + '%';
    document.getElementById('vllm-cache-detail').textContent =
      t('vllm.cacheDetail', { hits: fmt(data.cache.prefixHits), queries: fmt(data.cache.prefixQueries) });

    // Latency
    document.getElementById('vllm-ttft').textContent = fmtMs(data.latency.avgTimeToFirstToken);
    document.getElementById('vllm-itl').textContent =
      t('vllm.interToken', { v: fmtMs(data.latency.avgInterTokenLatency) });
    document.getElementById('vllm-e2e').textContent = fmtMs(data.latency.avgE2eLatency);
    document.getElementById('vllm-phases').textContent =
      t('vllm.phases', { prefill: fmtMs(data.latency.avgPrefillTime), decode: fmtMs(data.latency.avgDecodeTime) });

    // Totals
    document.getElementById('vllm-total-reqs').textContent = fmt(data.requests.total);
    document.getElementById('vllm-total-tokens').textContent =
      t('vllm.tokens', { prompt: fmt(data.tokens.totalPrompt), gen: fmt(data.tokens.totalGeneration) });

    // Prompt token sources
    const totalPromptSrc = data.tokens.promptCached + data.tokens.promptComputed;
    const cachedPct = totalPromptSrc > 0 ? (data.tokens.promptCached / totalPromptSrc * 100) : 0;
    document.getElementById('vllm-prompt-cached').textContent =
      t('vllm.cachedPct', { pct: cachedPct.toFixed(0) });
    document.getElementById('vllm-prompt-breakdown').textContent =
      t('vllm.cacheDetail', { hits: fmt(data.tokens.promptCached), queries: fmt(data.tokens.promptComputed) })
      + ' \u2014 ' + t('vllm.cachedVsComputed');

    // Process
    document.getElementById('vllm-memory').textContent = data.process.residentMemoryMB + ' MB';
    document.getElementById('vllm-cpu').textContent =
      t('vllm.cpu', { cpu: data.process.cpuSeconds.toFixed(0), vMem: data.process.virtualMemoryGB });

  } catch (e) {
    document.getElementById('vllm-engine-state').textContent = t('vllm.unreachable');
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
            label: t('chart.kvCache'),
            data: kvData,
            borderColor: '#6c63ff',
            backgroundColor: 'rgba(107, 99, 255, 0.1)',
            fill: true,
            tension: 0.3,
            yAxisID: 'y'
          },
          {
            label: t('chart.running'),
            data: runningData,
            borderColor: '#22c55e',
            backgroundColor: 'rgba(34, 197, 94, 0.1)',
            fill: false,
            tension: 0.3,
            yAxisID: 'y1'
          },
          {
            label: t('chart.waiting'),
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
            title: { display: true, text: t('chart.kvCachePct'), color: '#8b8fa3' },
            ticks: { color: '#8b8fa3', font: { size: 10 } },
            grid: { color: '#2a2e3e' }
          },
          y1: {
            type: 'linear', position: 'right',
            min: 0,
            title: { display: true, text: t('chart.requests'), color: '#8b8fa3' },
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
  document.getElementById('chat-projects-view').style.display = view === 'projects' ? 'block' : 'none';

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
  else if (currentChatView === 'bar') renderChatBarChart(allChats);
  else if (currentChatView === 'table') renderChatTable(allChats);
  else if (currentChatView === 'projects') renderProjectView(allChats);
}

function renderChatTiles(chats) {
  const container = document.getElementById('chat-tiles-view');
  if (chats.length === 0) {
    container.innerHTML = `<p style="text-align:center;color:var(--text-dim);padding:40px;grid-column:1/-1">${t('chat.noChatsYet')}</p>`;
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

    return `<div class="chat-tile${untrackedCls}" onclick="openChatDetail('${esc(c.session_id)}')">
      <div class="chat-tile-name" title="${esc(c.name)}">${esc(c.name)}</div>
      ${project ? `<div class="chat-tile-project" title="${esc(c.working_dir)}">${project}</div>` : '<div class="chat-tile-project">—</div>'}
      <div class="chat-tile-stats">
        <div class="chat-tile-stat">
          <span class="chat-tile-stat-label">${t('chat.input')}</span>
          <span class="chat-tile-stat-value purple">${fmt(c.total_prompt_tokens)}</span>
        </div>
        <div class="chat-tile-stat">
          <span class="chat-tile-stat-label">${t('chat.output')}</span>
          <span class="chat-tile-stat-value blue">${fmt(c.total_completion_tokens)}</span>
        </div>
        <div class="chat-tile-stat">
          <span class="chat-tile-stat-label">${t('chat.localCost')}</span>
          <span class="chat-tile-stat-value">${fmtCost(c.total_local_cost)}</span>
        </div>
        <div class="chat-tile-stat">
          <span class="chat-tile-stat-label">${t('chat.saved')}</span>
          <span class="chat-tile-stat-value green">${fmtCost(Math.abs(savings))}</span>
        </div>
      </div>
      <div class="chat-tile-bar" style="width:${barWidth}%">
        <div class="chat-tile-bar-in" style="width:${inPct}%"></div>
        <div class="chat-tile-bar-out" style="width:${outPct}%"></div>
      </div>
      <div class="chat-tile-date">${t('chat.reqs', { n: c.request_count })} &middot; ${fmtDateTime(c.created_at)}</div>
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
          label: t('chart.inputTokens'),
          data: sorted.map(c => c.total_prompt_tokens),
          backgroundColor: 'rgba(107, 99, 255, 0.7)',
          borderRadius: 4
        },
        {
          label: t('chart.outputTokens'),
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
              return `${t('log.local')} ${fmtCost(chat.total_local_cost)} | ${t('log.savedLabel')} ${fmtCost(chat.savings)}`;
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

function renderProjectView(chats) {
  const container = document.getElementById('chat-projects-view');

  // Group chats by project (working_dir)
  const projects = {};
  for (const c of chats) {
    const proj = projectName(c.working_dir) || t('chat.noProject');
    if (!projects[proj]) {
      projects[proj] = {
        name: proj,
        working_dir: c.working_dir || '',
        chats: [],
        total_prompt_tokens: 0,
        total_completion_tokens: 0,
        total_tokens: 0,
        total_local_cost: 0,
        total_cloud_cost: 0,
        savings: 0,
        request_count: 0
      };
    }
    const p = projects[proj];
    p.chats.push(c);
    p.total_prompt_tokens += c.total_prompt_tokens || 0;
    p.total_completion_tokens += c.total_completion_tokens || 0;
    p.total_tokens += c.total_tokens || 0;
    p.total_local_cost += c.total_local_cost || 0;
    p.total_cloud_cost += c.total_cloud_cost || 0;
    p.savings += c.savings || 0;
    p.request_count += c.request_count || 0;
  }

  const sorted = Object.values(projects).sort((a, b) => b.total_tokens - a.total_tokens);
  const maxTokens = Math.max(...sorted.map(p => p.total_tokens || 1));

  if (sorted.length === 0) {
    container.innerHTML = `<p style="text-align:center;color:var(--text-dim);padding:40px;grid-column:1/-1">${t('chat.noProjects')}</p>`;
    return;
  }

  // Use full-width card layout (not grid) for expandable projects
  container.style.display = 'block';

  container.innerHTML = sorted.map((p, idx) => {
    const barWidth = p.total_tokens > 0 ? (p.total_tokens / maxTokens * 100) : 0;
    const inPct = p.total_tokens > 0 ? (p.total_prompt_tokens / p.total_tokens * 100) : 50;
    const outPct = p.total_tokens > 0 ? (p.total_completion_tokens / p.total_tokens * 100) : 50;

    // Sort chats by total tokens descending
    const sortedChats = [...p.chats].sort((a, b) => (b.total_tokens || 0) - (a.total_tokens || 0));

    // Build the expanded chat table (hidden by default)
    const chatRows = sortedChats.map(c => {
      const cSavings = c.savings || 0;
      return `<tr class="project-detail-row" onclick="event.stopPropagation(); openChatDetail('${esc(c.session_id)}')">
        <td><strong>${esc(c.name)}</strong></td>
        <td>${fmt(c.total_prompt_tokens)}</td>
        <td>${fmt(c.total_completion_tokens)}</td>
        <td>${fmt(c.total_tokens)}</td>
        <td>${fmtCost(c.total_local_cost)}</td>
        <td>${fmtCost(c.total_cloud_cost)}</td>
        <td class="savings-positive">${fmtCost(Math.abs(cSavings))}</td>
        <td>${c.request_count}</td>
        <td style="font-size:11px">${fmtDateTime(c.created_at)}</td>
      </tr>`;
    }).join('');

    const chatCountStr = p.chats.length === 1
      ? t('chat.chats', { n: 1 })
      : t('chat.chatsPlural', { n: p.chats.length });

    return `<div class="project-card" onclick="toggleProject(${idx})">
      <div class="project-card-header">
        <div class="project-card-title">
          <span class="project-expand-icon" id="project-icon-${idx}">&#9654;</span>
          <span class="chat-tile-name" title="${esc(p.working_dir)}">${esc(p.name)}</span>
          <span class="project-card-meta">${chatCountStr} &middot; ${t('chat.requestsMeta', { n: p.request_count })}</span>
        </div>
        <div class="project-card-stats">
          <span class="project-stat"><span class="project-stat-label">${t('chat.projInput')}</span> <span class="purple">${fmt(p.total_prompt_tokens)}</span></span>
          <span class="project-stat"><span class="project-stat-label">${t('chat.projOutput')}</span> <span class="blue">${fmt(p.total_completion_tokens)}</span></span>
          <span class="project-stat"><span class="project-stat-label">${t('chat.projLocal')}</span> ${fmtCost(p.total_local_cost)}</span>
          <span class="project-stat"><span class="project-stat-label">${t('chat.projCloud')}</span> <span class="orange">${fmtCost(p.total_cloud_cost)}</span></span>
          <span class="project-stat"><span class="project-stat-label">${t('chat.projSaved')}</span> <span class="green">${fmtCost(Math.abs(p.savings))}</span></span>
        </div>
      </div>
      <div class="chat-tile-bar" style="width:${barWidth}%;margin:8px 0 0">
        <div class="chat-tile-bar-in" style="width:${inPct}%"></div>
        <div class="chat-tile-bar-out" style="width:${outPct}%"></div>
      </div>
      <div class="project-detail" id="project-detail-${idx}" style="display:none" onclick="event.stopPropagation()">
        <div class="table-scroll">
          <table style="font-size:12px">
            <thead><tr>
              <th>${t('chat.projColName')}</th>
              <th>${t('chat.projColInput')}</th>
              <th>${t('chat.projColOutput')}</th>
              <th>${t('chat.projColTotal')}</th>
              <th>${t('chat.projColLocal')}</th>
              <th>${t('chat.projColCloud')}</th>
              <th>${t('chat.projColSaved')}</th>
              <th>${t('chat.projColReqs')}</th>
              <th>${t('chat.projColDate')}</th>
            </tr></thead>
            <tbody>${chatRows}</tbody>
          </table>
        </div>
      </div>
    </div>`;
  }).join('');
}

window.toggleProject = function(idx) {
  const detail = document.getElementById(`project-detail-${idx}`);
  const icon = document.getElementById(`project-icon-${idx}`);
  if (!detail) return;

  const isOpen = detail.style.display !== 'none';
  detail.style.display = isOpen ? 'none' : 'block';
  icon.innerHTML = isOpen ? '&#9654;' : '&#9660;';
};

function renderChatTable(chats) {
  const tbody = document.getElementById('chat-table-body');
  if (chats.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;color:var(--text-dim)">${t('chat.noChats')}</td></tr>`;
    return;
  }

  tbody.innerHTML = chats.map(c => {
    const savings = c.savings || 0;
    const cls = savings >= 0 ? 'savings-positive' : '';
    const project = projectName(c.working_dir);
    return `<tr style="cursor:pointer" onclick="openChatDetail('${esc(c.session_id)}')">
      <td><strong>${esc(c.name)}</strong></td>
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
  body.innerHTML = `<p style="color:var(--text-dim);padding:20px;text-align:center">${t('chat.loading')}</p>`;

  const data = await fetchJson(`/api/chats/${encodeURIComponent(sessionId)}`);

  nameEl.textContent = data.name || sessionId;

  const defaultCloud = data.cloud_costs[selectedCompareModels[0]] || data.cloud_costs['gpt-4o'] || 0;
  const savings = defaultCloud - data.local_cost;
  const project = projectName(data.working_dir);

  const gooseOnlyNote = data.goose_only
    ? `<div style="background:var(--accent-dim);border:1px solid var(--accent);border-radius:6px;padding:8px 12px;margin-bottom:12px;font-size:12px;color:var(--text)">
        ${t('chat.gooseOnlyNote')}
      </div>`
    : '';

  let html = `
    <div style="font-size:12px;color:var(--text-dim);margin-bottom:16px">
      ${project ? `<span style="color:var(--accent)">${project}</span> &middot; ` : ''}
      ${data.provider || ''} &middot; ${data.goose_mode || ''} mode &middot;
      ${data.message_count} ${t('chat.messages')} &middot; ${t('chat.created')} ${fmtDateTime(data.created_at)}
    </div>
    ${gooseOnlyNote}
    <div class="chat-detail-grid">
      <div class="chat-detail-card">
        <div class="chat-detail-label">${t('chat.colRequests')}</div>
        <div class="chat-detail-value">${data.request_count}</div>
      </div>
      <div class="chat-detail-card">
        <div class="chat-detail-label">${t('chat.colInputTokens')}</div>
        <div class="chat-detail-value">${fmt(data.total_prompt_tokens)}</div>
      </div>
      <div class="chat-detail-card">
        <div class="chat-detail-label">${t('chat.colOutputTokens')}</div>
        <div class="chat-detail-value">${fmt(data.total_completion_tokens)}</div>
      </div>
      <div class="chat-detail-card">
        <div class="chat-detail-label">${t('chat.totalTokens')}</div>
        <div class="chat-detail-value">${fmt(data.total_tokens)}</div>
      </div>
      <div class="chat-detail-card">
        <div class="chat-detail-label">${t('chat.avgLatency')}</div>
        <div class="chat-detail-value">${data.avg_latency_ms}ms</div>
      </div>
      <div class="chat-detail-card">
        <div class="chat-detail-label">${t('chat.avgTps')}</div>
        <div class="chat-detail-value">${data.avg_tokens_per_second}</div>
      </div>
      <div class="chat-detail-card">
        <div class="chat-detail-label">${t('chat.colLocalCost')}</div>
        <div class="chat-detail-value">${fmtCost(data.local_cost)}</div>
      </div>
      <div class="chat-detail-card">
        <div class="chat-detail-label">${t('chat.saved')}</div>
        <div class="chat-detail-value green">${fmtCost(Math.abs(savings))}</div>
      </div>
    </div>`;

  // Cloud cost comparison for this chat
  if (Object.keys(data.cloud_costs).length > 0) {
    html += `<h4 style="color:var(--text-dim);font-size:12px;text-transform:uppercase;letter-spacing:0.5px;margin:16px 0 8px">${t('chat.ifOnCloud')}</h4>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px">`;
    for (const model of selectedCompareModels) {
      const cost = data.cloud_costs[model];
      if (cost === undefined) continue;
      const save = cost - data.local_cost;
      html += `<div style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:8px 12px;font-size:12px">
        <div style="color:var(--text-dim)">${model}</div>
        <div style="color:var(--text-bright);font-weight:600">${fmtCost(cost)}</div>
        <div style="color:var(--green);font-size:11px">${t('chat.save', { amount: fmtCost(save) })}</div>
      </div>`;
    }
    html += '</div>';
  }

  // Request list for this chat
  if (data.requests && data.requests.length > 0) {
    html += `<h4 style="color:var(--text-dim);font-size:12px;text-transform:uppercase;letter-spacing:0.5px;margin:16px 0 8px">${t('chat.requestsTitle', { n: data.requests.length })}</h4>
    <div class="table-scroll"><table style="font-size:12px">
      <thead><tr>
        <th>${t('log.colTime')}</th>
        <th>${t('chat.colIn')}</th>
        <th>${t('chat.colOut')}</th>
        <th>${t('log.colLatency')}</th>
        <th>${t('log.colTps')}</th>
        <th>${t('chat.colLocal')}</th>
        <th>${t('chat.colCloud')}</th>
      </tr></thead>
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
      html += `<tr><td colspan="7" style="text-align:center;color:var(--text-dim)">${t('chat.andMore', { n: data.requests.length - 50 })}</td></tr>`;
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

    // Show accumulated tokens (what Goose reports) as headline
    const accTotal = data.accumulated_total_tokens || data.total_tokens;
    const accIn = data.accumulated_input_tokens || data.input_tokens;
    const accOut = data.accumulated_output_tokens || data.output_tokens;
    document.getElementById('lifetime-tokens').textContent = fmt(accTotal) + ' tokens';
    document.getElementById('lifetime-breakdown').textContent =
      t('stats.tokenBreakdown', { in: fmt(accIn), out: fmt(accOut) });
    document.getElementById('lifetime-sessions').textContent =
      t('lifetime.chats', { n: data.total_sessions || 0 });
    document.getElementById('lifetime-messages').textContent =
      t('lifetime.messages', { n: (data.total_messages || 0).toLocaleString() });

    if (data.first_session) {
      const d = new Date(data.first_session);
      const dateStr = d.toLocaleDateString(t('locale'), { month: 'short', day: 'numeric', year: 'numeric' });
      document.getElementById('lifetime-since').textContent = t('lifetime.since', { date: dateStr });
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
    document.getElementById('setting-injectStreamOptions').checked = s.injectStreamOptionsForUsage !== false;
    document.getElementById('setting-gooseSessionsDb').value = s.gooseSessionsDb || '';
    document.getElementById('setting-hwName').value = s.hardware?.name || '';
    document.getElementById('setting-purchasePrice').value = s.hardware?.purchasePrice || '';
    document.getElementById('setting-lifespanYears').value = s.hardware?.lifespanYears || '';
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
        opt.textContent = m.id;
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

    // Run the hardware cost calculator
    updateHwCalculator();

    document.getElementById('settings-status').textContent = '';
  } catch (e) {
    document.getElementById('settings-status').textContent = t('settings.loadFailed');
  }
}

// --- Hardware Cost Calculator ---
function updateHwCalculator() {
  const price = parseFloat(document.getElementById('setting-purchasePrice').value);
  const years = parseFloat(document.getElementById('setting-lifespanYears').value);
  const watts = parseFloat(document.getElementById('setting-gpuWatts').value);
  const elecCost = parseFloat(document.getElementById('setting-electricityCost').value);
  const calcDiv = document.getElementById('hw-cost-calculator');

  if (!price || !years || !watts || !elecCost) {
    calcDiv.style.display = 'none';
    return;
  }

  calcDiv.style.display = 'block';

  // Hourly costs
  const hourlyDepreciation = price / (years * 8760); // 8760 hours/year
  const hourlyElectricity = (watts / 1000) * elecCost;
  const hourlyTotal = hourlyDepreciation + hourlyElectricity;

  // Use tracked avg tok/s, fallback to 40
  const avgTps = parseFloat(document.getElementById('avg-tps')?.textContent) || 40;

  // Update the "at X tok/s" label
  const tpsLabel = document.getElementById('calc-tps-label');
  if (tpsLabel) tpsLabel.textContent = ' ' + t('settings.atTps', { tps: avgTps.toFixed(0) });

  // Output: at avgTps tok/s, 1M tokens takes (1_000_000 / avgTps) seconds = X hours
  const hoursPerMillionOutput = (1_000_000 / avgTps) / 3600;
  const outputCostPerMillion = hoursPerMillionOutput * hourlyTotal;

  // Input: prefill is roughly 10x faster than decode
  const prefillMultiplier = 10;
  const hoursPerMillionInput = (1_000_000 / (avgTps * prefillMultiplier)) / 3600;
  const inputCostPerMillion = hoursPerMillionInput * hourlyTotal;

  document.getElementById('calc-depreciation').textContent = '$' + hourlyDepreciation.toFixed(4) + '/hr';
  document.getElementById('calc-electricity').textContent = '$' + hourlyElectricity.toFixed(4) + '/hr';
  document.getElementById('calc-hourly-total').textContent = '$' + hourlyTotal.toFixed(4) + '/hr';
  document.getElementById('calc-output-cost').textContent = '$' + outputCostPerMillion.toFixed(3) + '/M';
  document.getElementById('calc-input-cost').textContent = '$' + inputCostPerMillion.toFixed(4) + '/M';

  // Breakeven analysis vs default cloud model
  const compareModelId = document.getElementById('setting-defaultCompare').value || currentDefaultModel;
  const compareModel = allCloudModels.find(m => m.id === compareModelId);
  document.getElementById('calc-compare-model').textContent = compareModelId;

  if (compareModel) {
    // Assume 90% input / 10% output token ratio (typical for LLM conversations)
    const inputRatio = 0.9, outputRatio = 0.1;
    const localCostPerMToken = (inputCostPerMillion * inputRatio) + (outputCostPerMillion * outputRatio);
    const cloudCostPerMToken = (compareModel.inputPerMillion * inputRatio) + (compareModel.outputPerMillion * outputRatio);
    const savingsPerMToken = cloudCostPerMToken - localCostPerMToken;

    if (savingsPerMToken > 0) {
      // How many tokens to break even on the hardware purchase price
      const breakevenMTokens = price / savingsPerMToken;
      const breakevenTokens = breakevenMTokens * 1_000_000;

      // Estimate time to breakeven based on actual usage
      let breakevenTime = '';
      const tokPerDay = 1_000_000; // conservative estimate: 1M tokens/day
      const daysToBreakeven = breakevenTokens / tokPerDay;
      if (daysToBreakeven < 30) breakevenTime = ' ' + t('calc.days', { n: Math.ceil(daysToBreakeven) });
      else if (daysToBreakeven < 365) breakevenTime = ' ' + t('calc.months', { n: (daysToBreakeven / 30).toFixed(1) });
      else breakevenTime = ' ' + t('calc.years', { n: (daysToBreakeven / 365).toFixed(1) });

      document.getElementById('calc-breakeven').textContent =
        t('calc.tokens', { n: fmt(breakevenTokens) }) + breakevenTime;
      document.getElementById('calc-breakeven').style.color = 'var(--green)';
    } else {
      document.getElementById('calc-breakeven').textContent = t('calc.localExpensive');
      document.getElementById('calc-breakeven').style.color = 'var(--red)';
    }
  }
}

// Auto-recalculate when hardware fields change
['setting-purchasePrice', 'setting-lifespanYears', 'setting-gpuWatts', 'setting-electricityCost', 'setting-defaultCompare'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', updateHwCalculator);
  document.getElementById(id)?.addEventListener('change', updateHwCalculator);
});

// Apply calculated pricing to the local cost fields
window.applyCalculatedPricing = function() {
  const price = parseFloat(document.getElementById('setting-purchasePrice').value);
  const years = parseFloat(document.getElementById('setting-lifespanYears').value);
  const watts = parseFloat(document.getElementById('setting-gpuWatts').value);
  const elecCost = parseFloat(document.getElementById('setting-electricityCost').value);
  if (!price || !years || !watts || !elecCost) return;

  const hourlyTotal = (price / (years * 8760)) + ((watts / 1000) * elecCost);
  const avgTps = parseFloat(document.getElementById('avg-tps')?.textContent) || 40;

  const outputCostPerMillion = ((1_000_000 / avgTps) / 3600) * hourlyTotal;
  const inputCostPerMillion = ((1_000_000 / (avgTps * 10)) / 3600) * hourlyTotal;

  document.getElementById('setting-localInput').value = inputCostPerMillion.toFixed(4);
  document.getElementById('setting-localOutput').value = outputCostPerMillion.toFixed(3);
};

window.saveSettings = async function() {
  const status = document.getElementById('settings-status');
  status.textContent = t('settings.saving');
  status.style.color = '#aaa';

  const payload = {
    targetUrl: document.getElementById('setting-targetUrl').value.trim(),
    injectStreamOptionsForUsage: document.getElementById('setting-injectStreamOptions').checked,
    gooseSessionsDb: document.getElementById('setting-gooseSessionsDb').value.trim(),
    hardware: {
      name: document.getElementById('setting-hwName').value.trim(),
      purchasePrice: parseFloat(document.getElementById('setting-purchasePrice').value) || 0,
      lifespanYears: parseFloat(document.getElementById('setting-lifespanYears').value) || 0,
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
      status.textContent = t('settings.saved');
      status.style.color = '#4ade80';
      // Update the default model shown in summary cards
      currentDefaultModel = payload.defaultCompareModel || currentDefaultModel;
      // Refresh everything — the server now uses new settings
      setTimeout(async () => {
        await initModelSelector(); // re-fetch cloud models + defaults
        await refreshAll();
        updateLifetimeStats();
      }, 500);
    } else {
      status.textContent = data.error || t('settings.saveFailed');
      status.style.color = '#f87171';
    }
  } catch (e) {
    status.textContent = t('settings.networkError');
    status.style.color = '#f87171';
  }
};

window.detectGoose = async function() {
  const statusEl = document.getElementById('goose-db-status');
  statusEl.textContent = t('settings.searching');

  try {
    const res = await fetch('/api/settings/detect-goose', { method: 'POST' });
    const data = await res.json();

    if (data.suggested) {
      document.getElementById('setting-gooseSessionsDb').value = data.suggested;
      const n = data.found.length;
      statusEl.textContent = n === 1
        ? t('settings.found1', { n })
        : t('settings.foundN', { n });
      statusEl.style.color = '#4ade80';
    } else {
      statusEl.textContent = t('settings.notFound', { n: data.searched.length });
      statusEl.style.color = '#f87171';
    }
  } catch (e) {
    statusEl.textContent = t('settings.detectionFailed');
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
  // Re-apply static translations (in case dynamic render overwrote any data-i18n elements)
  applyTranslations();
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
