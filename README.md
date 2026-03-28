# Goose Token Tracker

A lightweight reverse-proxy that sits between [Goose](https://block.github.io/goose/) (or any OpenAI-compatible client) and a local [vLLM](https://github.com/vllm-project/vllm) server, tracking every token, calculating costs, and serving a live dashboard.

![Node.js](https://img.shields.io/badge/Node.js-18%2B-green) ![License](https://img.shields.io/badge/license-MIT-blue)

## Why?

Local LLM inference is practically free compared to cloud APIs, but you have **zero visibility** into usage. No token counts, no cost tracking, no performance metrics. This project fixes that.

**Goose Token Tracker gives you:**
- Real-time token counting for every request (input + output)
- Cost comparison against 16 cloud models (GPT-4.1, Claude Opus 4, Gemini 2.5 Pro, etc.)
- Live vLLM engine metrics (KV cache, prefix cache hit rate, TTFT, queue depth)
- A clean dark-mode dashboard with charts, grouped request logs, and model selectors
- SQLite storage — your data stays local

## Architecture

```
Goose / Any Client          Token Tracker (port 3000)           vLLM (port 8000)
     |                            |                                  |
     |--- /v1/chat/completions -->|--- forwards request ----------->|
     |                            |    logs tokens, latency          |
     |<-- streamed response ------|<-- forwards response ------------|
     |                            |    computes costs, savings       |
     |                            |                                  |
     |    http://localhost:3000   |                                  |
     |--- Dashboard UI ---------->|    (serves static dashboard)     |
                                  |--- /metrics polling ------------>|
                                       (vLLM Prometheus metrics)
```

## Quick Start

### Prerequisites
- Node.js 18+
- A running vLLM server (or any OpenAI-compatible API)

### Install

```bash
git clone https://github.com/YOUR_USERNAME/goose-token-tracker.git
cd goose-token-tracker
npm install
```

### Configure

Edit `config.json`:

```json
{
  "proxyPort": 3000,
  "targetUrl": "http://YOUR_VLLM_IP:8000"
}
```

### Run

```bash
npm start
```

Then open **http://localhost:3000** for the dashboard.

### Point your client at the proxy

Instead of pointing Goose (or any client) directly at your vLLM server, point it at `http://localhost:3000`. The tracker transparently proxies all `/v1/*` requests.

For **Goose**: Change your provider's host URL from `http://YOUR_VLLM_IP:8000` to `http://localhost:3000` in Goose settings.

For **other clients** (Open WebUI, Continue, etc.): Set the API base URL to `http://localhost:3000/v1`.

## Dashboard

The dashboard at `http://localhost:3000` shows:

### Summary Cards
- Total tokens (input/output breakdown)
- Request count with avg latency
- Tokens/second generation speed
- Local cost vs cloud equivalent
- Total savings

### Token Usage Chart
- Dual Y-axis: input tokens (left) and output tokens (right) over time
- Switchable time ranges: 1H, 24H, 7D, 30D, All

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

## Configuration

### `config.json`

| Field | Description | Default |
|-------|-------------|---------|
| `proxyPort` | Port the tracker listens on | `3000` |
| `targetUrl` | Your vLLM server URL | `http://192.168.0.8:8000` |
| `dbPath` | SQLite database path | `./data/tracker.db` |
| `hardware.name` | Your GPU name (for dashboard display) | |
| `hardware.gpuWatts` | GPU power draw in watts | `125` |
| `hardware.electricityCostPerKwh` | Your electricity rate | `0.12` |
| `localModelPricing.default` | Flat per-token local cost | `$0.02/M in, $0.10/M out` |
| `cloudComparisonModels` | Cloud models for cost comparison | 16 models included |
| `defaultCompareModel` | Default model for savings calculation | `gpt-4o` |
| `dashboardCompareModels` | Models shown by default in cost table | 5 models |

### Cloud Models Included

| Model | Input $/M | Output $/M |
|-------|-----------|------------|
| GPT-4.1 | $2.00 | $8.00 |
| GPT-4.1 Mini | $0.40 | $1.60 |
| GPT-4o | $2.50 | $10.00 |
| Claude Opus 4 | $15.00 | $75.00 |
| Claude Sonnet 4 | $3.00 | $15.00 |
| Gemini 2.5 Pro | $1.25 | $10.00 |
| DeepSeek V3 | $0.27 | $1.10 |
| DeepSeek R1 | $0.55 | $2.19 |
| ...and 8 more | | |

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
| `GET /api/vllm-metrics` | Latest vLLM engine metrics |
| `GET /api/vllm-metrics/history` | vLLM metrics time series |
| `GET /api/trends/hourly` | Hourly token trends |
| `GET /api/trends/daily` | Daily token trends |
| `GET /api/health` | Health check (proxy + vLLM status) |
| `GET /api/live` | SSE stream for real-time updates |

## Tech Stack

- **Node.js + Express** — reverse proxy and API server
- **better-sqlite3** — local token/cost storage
- **Chart.js** — dashboard charts
- **Vanilla JS/CSS** — zero frontend build step, zero dependencies

## How Local Cost is Calculated

By default, local cost uses **flat per-token pricing** (configurable in `config.json`):
- Input: $0.02 per million tokens
- Output: $0.10 per million tokens

This accounts for hardware amortization, not just electricity. Pure electricity cost is also computed and logged (GPU watts x time x $/kWh) but it's vanishingly small for local inference (~$0.000004/request).

## Contributing

PRs welcome! Some ideas:
- [ ] CSV/JSON data export
- [ ] Token budget alerts
- [ ] Multi-server load balancing
- [ ] Grafana/Prometheus export endpoint
- [ ] Model A/B performance comparison
- [ ] Goose MCP extension for in-chat stats

## License

MIT
