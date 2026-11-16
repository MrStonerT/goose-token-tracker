# Goose Token Tracker

A lightweight reverse-proxy that sits between [Goose](https://block.github.io/goose/) (or any OpenAI-compatible client) and a local [vLLM](https://github.com/vllm-project/vllm) server, tracking every token, calculating costs, and serving a live dashboard.

![Node.js](https://img.shields.io/badge/Node.js-18%2B-green) ![License](https://img.shields.io/badge/license-MIT-blue)

## Screenshots

<p align="center">
  <img src="docs/screenshots/GooseTokenTrackerBigScreenshot.png" alt="Goose Token Tracker — Full dashboard view" width="900">
  <br><em>Full dashboard: lifetime stats, section nav, summary cards, usage charts, vLLM engine metrics, and chat analytics</em>
</p>

<p align="center">
  <img src="docs/screenshots/dashboard-overview.png" alt="Dashboard Overview — Lifetime stats, summary cards, token usage charts, and vLLM metrics" width="800">
  <br><em>Dashboard overview with Goose lifetime stats, summary cards, usage charts, and live vLLM engine metrics</em>
</p>

<p align="center">
  <img src="docs/screenshots/vllm-metrics.png" alt="vLLM Engine Metrics and Chat Analytics by Project" width="800">
  <br><em>vLLM metrics detail and Chat Analytics grouped by project with per-chat breakdowns</em>
</p>

<p align="center">
  <img src="docs/screenshots/cost-comparison.png" alt="Cost Comparison — Local vs cloud models with in/out breakdown and request log" width="800">
  <br><em>Cost comparison with input/output breakdown, model selector, and paginated request log</em>
</p>

<p align="center">
  <img src="docs/screenshots/chat-details.png" alt="Chat Detail Modal — Per-chat stats and cloud cost comparison" width="800">
  <br><em>Chat detail modal with token counts, costs, and per-model cloud comparison</em>
</p>

<p align="center">
  <img src="docs/screenshots/settings.png" alt="Settings — vLLM URL, Goose DB, hardware cost calculator" width="400">
  <img src="docs/screenshots/settings-withcostcalculator.png" alt="Settings —  hardware cost calculator" width="400">
  <br><em>Settings with hardware cost calculator, breakeven analysis, and auto-detected Goose DB</em>
</p>

## The Problem

Running local LLMs is incredibly cost-effective — but you get **zero observability**. Goose tracks some session-level totals, but that's not enough for serious usage monitoring. Here's what's missing:

| Metric | Goose Sessions DB | Token Tracker Proxy |
|--------|:-:|:-:|
| Total tokens per session | Partial (session-level only) | Per-request |
| Input vs output breakdown | Session-level only | Per-request |
| Per-message token counts | All NULL | Exact from vLLM |
| Latency per request | No | Yes (ms) |
| Tokens/second speed | No | Yes |
| Streaming support | No tracking | Full SSE tap |
| Local cost calculation | No | Per-token pricing |
| Cloud cost comparison | No | 46 models |
| vLLM engine metrics | No | KV cache, TTFT, queue, memory |
| Chat name / session grouping | Yes (names only) | Yes (merged with Goose data) |
| Request-level detail | No | Full log with pagination |
| Data persistence | Partial | Full SQLite |
| Real-time dashboard | No | Live SSE updates |

**Goose's sessions.db has the chat names and lifetime totals. The proxy has the per-request detail. Together, you get the full picture.**

## What You Get

- **Real-time token counting** for every request (input + output), read directly from vLLM's response (not estimated)
- **Cost comparison** against 46 cloud models (GPT-6, Claude Opus 5.5, Gemini 4, Grok 4.7, DeepSeek V4, etc.)
- **Live vLLM engine metrics** (KV cache, prefix cache hit rate, TTFT, queue depth, memory)
- **Chat Analytics** — see token usage, cost, and savings per Goose chat session with actual chat names
- **Goose Lifetime Stats** — total tokens across all sessions, as reported by Goose
- **Configurable Settings** — change vLLM URL, Goose DB path, pricing, and hardware from the dashboard
- **A clean dark-mode dashboard** with charts, grouped request logs, and model selectors
- **SQLite storage** — your data stays local and survives restarts

## Architecture

```
Goose / Any Client          Token Tracker (port 4747)           vLLM (port 8000)
     |                            |                                  |
     |--- /v1/chat/completions -->|--- forwards request ----------->|
     |                            |    logs tokens, latency          |
     |<-- streamed response ------|<-- forwards response ------------|
     |                            |    computes costs, savings       |
     |                            |                                  |
     |    http://localhost:4747   |                                  |
     |--- Dashboard UI ---------->|    (serves static dashboard)     |
                                  |--- /metrics polling ------------>|
                                       (vLLM Prometheus metrics)
                                  |--- reads Goose sessions.db ----->|
                                       (chat names, lifetime stats)
```

**Key design decisions:**
- **Reverse proxy** (not forward proxy) — only LLM API traffic hits the proxy; extensions, tools, and other traffic go direct
- **Reads vLLM's actual `usage` field** — no token estimation, exact counts every time
- **Never mutates responses** — the proxy is invisible to Goose's parser
- **Injects `stream_options`** into streaming requests so vLLM reports usage in the final chunk

## Quick Start

### Prerequisites
- Node.js 18+
- A running vLLM server (or any OpenAI-compatible API)

### Install

```bash
git clone https://github.com/MrStonerT/goose-token-tracker.git
cd goose-token-tracker
npm install
```

### Configure

On first run, `config.json` is auto-created from `config.example.json`. Edit it with your vLLM server address, or use the Settings page in the dashboard:

```bash
cp config.example.json config.json  # optional — auto-created on first run
```

```json
{
  "proxyPort": 4747,
  "targetUrl": "http://YOUR_VLLM_IP:8000"
}
```

> **Note:** `config.json` is gitignored to keep your personal settings (IP addresses, paths) out of version control.

### Run

```bash
npm start
```

Then open **http://localhost:4747** for the dashboard.

### Point Your Client at the Proxy

Instead of pointing Goose (or any client) directly at your vLLM server, point it at `http://localhost:4747`. The tracker transparently proxies all `/v1/*` requests.

**For Goose:** Change your provider's host URL from `http://YOUR_VLLM_IP:8000` to `http://localhost:4747` in Goose settings. No special environment variables needed — just change the URL.

**For other clients** (Open WebUI, Continue, LM Studio, etc.): Set the API base URL to `http://localhost:4747/v1`.

### Connect to Goose (Optional)

To see chat names and lifetime stats, point the tracker at Goose's sessions database:

1. Open Settings (gear icon in the dashboard header)
2. Click **Auto-Detect** next to "Goose Sessions Database"
3. Save — the lifetime banner and chat analytics will populate immediately

Common paths:
- **Windows:** `%APPDATA%\Block\goose\data\sessions\sessions.db`
- **macOS:** `~/Library/Application Support/Block/goose/data/sessions/sessions.db`
- **Linux:** `~/.config/goose/data/sessions/sessions.db`

## Dashboard

The dashboard at `http://localhost:4747` provides:

### Goose Lifetime Banner
- Total tokens across all Goose sessions (matches Goose's own total)
- Input/output breakdown, chat count, message count, and "since" date

### Summary Cards
- Total tokens (input/output breakdown) tracked through the proxy
- Request count with average latency
- Tokens/second generation speed
- Local cost vs cloud equivalent
- Total savings

### Token Usage Chart
- Dual Y-axis: input tokens (left) and output tokens (right) over time
- Switchable time ranges: 1H, 24H, 7D, 30D, All

### Chat Analytics
- **Tiles view** — visual cards for each chat with token counts, cost, and savings
- **Bar chart** — compare token usage across chats
- **Table view** — sortable columns with all metrics
- **Detail modal** — click any chat for full per-request breakdown
- Merges proxy-tracked data with Goose's chat names and metadata

### vLLM Engine Metrics (live from `/metrics`)
- Engine state (awake/sleeping) and request queue
- KV cache usage with color-coded progress bar
- Prefix cache hit rate
- Time to first token, inter-token latency, E2E latency
- Prefill vs decode time breakdown
- Prompt token sources (cached vs computed)
- Process memory and CPU usage
- 10-minute history chart for KV cache and queue depth

### Cost Comparison
- Side-by-side cost table: your local cost vs any combination of cloud models
- Checkbox model selector with 16 pre-configured models
- Per-model and total savings calculations

### Request Log
- Flat list with pagination
- Group by **time** (30-minute windows) or **session**
- Click to expand groups and see individual requests

### Settings
- vLLM server URL
- Goose sessions database path with auto-detect
- Hardware name, GPU watts, electricity cost
- Local cost pricing (input/output per million tokens)
- Default cloud comparison model

## Configuration

### `config.json`

| Field | Description | Default |
|-------|-------------|---------|
| `proxyPort` | Port the tracker listens on | `4747` |
| `targetUrl` | Your vLLM server URL | `http://localhost:8000` |
| `dbPath` | SQLite database path | `./data/tracker.db` |
| `gooseSessionsDb` | Path to Goose's sessions.db (optional) | |
| `hardware.name` | Your GPU name (for dashboard display) | |
| `hardware.gpuWatts` | GPU power draw in watts | `125` |
| `hardware.electricityCostPerKwh` | Your electricity rate | `0.12` |
| `localModelPricing.default` | Flat per-token local cost | `$0.02/M in, $0.10/M out` |
| `cloudComparisonModels` | Cloud models for cost comparison | 46 models included |
| `defaultCompareModel` | Default model for savings calculation | `claude-sonnet-5.5` |
| `dashboardCompareModels` | Models shown by default in cost table | 5 models |

All settings can also be changed from the dashboard's Settings page.

### Cloud Models Included (46 models, November 2026 pricing)

Standard-tier list prices per million tokens (short-context tier where a provider charges more for long prompts). DeepSeek rates are off-peak; its weekday peak hours cost 2x. Gemini 4 Carbon/Argon are scheduled to double to $4.00 / $20.00 on 2026-12-01.

| Model | Input $/M | Output $/M |
|-------|-----------|------------|
| `gpt-6-astra` | $10.00 | $50.00 |
| `gpt-6.1-sol` | $2.00 | $10.00 |
| `gpt-6.1-terra` | $1.00 | $5.00 |
| `gpt-6-luna` | $0.10 | $0.50 |
| `gpt-5.6-sol` | $4.00 | $20.00 |
| `gpt-5.6-terra` | $2.00 | $12.00 |
| `gpt-5.6-luna` | $0.20 | $1.20 |
| `gpt-5.5` | $5.00 | $30.00 |
| `gpt-5.4` | $2.50 | $15.00 |
| `gpt-5.4-mini` | $0.75 | $4.50 |
| `gpt-5.3-codex` | $1.75 | $14.00 |
| `gpt-5.2` | $1.75 | $14.00 |
| `gpt-5` | $1.25 | $10.00 |
| `gpt-5-mini` | $0.25 | $2.00 |
| `gpt-4.1` | $2.00 | $8.00 |
| `gpt-4.1-mini` | $0.40 | $1.60 |
| `gpt-4o` | $2.50 | $10.00 |
| `gpt-4o-mini` | $0.15 | $0.60 |
| `o3` | $2.00 | $8.00 |
| `claude-fable-5.2` | $8.00 | $40.00 |
| `claude-opus-5.5` | $4.00 | $20.00 |
| `claude-opus-5` | $5.00 | $25.00 |
| `claude-opus-4.8` | $5.00 | $25.00 |
| `claude-opus-4.6` | $5.00 | $25.00 |
| `claude-sonnet-5.5` | $2.00 | $10.00 |
| `claude-sonnet-5` | $2.00 | $10.00 |
| `claude-sonnet-4.6` | $3.00 | $15.00 |
| `claude-haiku-5.5` | $0.10 | $0.50 |
| `claude-haiku-4.5` | $1.00 | $5.00 |
| `gemini-4-carbon` | $2.00 | $10.00 |
| `gemini-4-argon` | $2.00 | $10.00 |
| `gemini-4-hydrogen` | $1.50 | $7.50 |
| `gemini-3.8-flash` | $0.75 | $3.75 |
| `gemini-3.5-flash-lite` | $0.30 | $2.50 |
| `gemini-3.1-pro` | $2.00 | $12.00 |
| `gemini-3.1-flash-lite` | $0.25 | $1.50 |
| `gemini-3-flash` | $0.50 | $3.00 |
| `gemini-2.5-pro` | $1.25 | $10.00 |
| `gemini-2.5-flash` | $0.30 | $2.50 |
| `grok-4.7` | $2.00 | $6.00 |
| `grok-4.3` | $1.25 | $2.50 |
| `grok-build-0.1` | $1.00 | $2.00 |
| `deepseek-v4-pro` | $0.66 | $1.98 |
| `deepseek-flash` | $0.15 | $0.60 |
| `mistral-large-3` | $0.50 | $1.50 |
| `llama-4-maverick` | $0.15 | $0.60 |

## Windows Auto-Start

To start the tracker automatically on boot:

1. Place a shortcut to `start-background.vbs` in your Windows Startup folder:
   ```
   %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\
   ```
2. The tracker runs silently in the background with logs at `data/server.log`

Batch files included:
- `start.bat` — Run with visible console window
- `start-background.bat` — Run minimized
- `start-background.vbs` — Run fully silent (for auto-start)

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/stats?since=1h\|24h\|7d\|30d\|all` | Summary statistics |
| `GET /api/stats/models` | Per-model breakdown |
| `GET /api/stats/sessions` | Per-session stats |
| `GET /api/requests?limit=50&offset=0` | Paginated request log |
| `GET /api/requests/grouped?by=time\|session` | Grouped request log |
| `GET /api/cost-comparison` | Cost comparison with all cloud models |
| `GET /api/cloud-models` | Available cloud models and pricing |
| `GET /api/chats` | Chat analytics with Goose session names |
| `GET /api/chats/:sessionId` | Detailed per-chat stats |
| `GET /api/goose/lifetime` | Lifetime stats from Goose's sessions.db |
| `GET /api/goose/status` | Goose DB connection check |
| `GET /api/settings` | Current settings |
| `POST /api/settings` | Update settings |
| `POST /api/settings/detect-goose` | Auto-detect Goose installation |
| `GET /api/vllm-metrics` | Latest vLLM engine metrics |
| `GET /api/vllm-metrics/history` | vLLM metrics time series |
| `GET /api/trends/hourly` | Hourly token trends |
| `GET /api/trends/daily` | Daily token trends |
| `GET /api/health` | Health check (proxy + vLLM status) |
| `GET /api/live` | SSE stream for real-time updates |

## Tech Stack

- **Node.js + Express** — reverse proxy and API server
- **better-sqlite3** — local token/cost storage + reads Goose's sessions.db
- **Chart.js** — dashboard charts (CDN, no build step)
- **Vanilla JS/CSS** — zero frontend build step, zero frontend dependencies

## How Local Cost is Calculated

By default, local cost uses **flat per-token pricing** (configurable in settings):
- Input: $0.02 per million tokens
- Output: $0.10 per million tokens

This accounts for hardware amortization, not just electricity. Pure electricity cost is also computed (GPU watts x time x $/kWh) but it's vanishingly small for local inference (~$0.000004/request).

## How Goose Token Numbers Work

Goose's sessions.db stores two sets of token numbers:

- **`total_tokens`** — unique/new tokens per session (what you'd count if deduplicating)
- **`accumulated_total_tokens`** — running total including conversation context re-sent with every request

The **accumulated** number is what Goose shows in its UI (e.g., "773M tokens") and what the lifetime banner displays. This number grows fast because every message in a conversation includes the full prior context.

## Contributing

PRs welcome! Some ideas:
- [ ] CSV/JSON data export
- [ ] Token budget alerts
- [ ] Multi-server load balancing
- [ ] Grafana/Prometheus export endpoint
- [ ] Model A/B performance comparison
- [ ] Goose MCP extension for in-chat stats
- [ ] Docker container

## License

MIT
