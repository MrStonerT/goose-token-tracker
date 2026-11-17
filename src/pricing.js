const config = require('../config.json');

/**
 * Cloud cost model.
 *
 * Agents like Goose resend the whole conversation on every turn, and every
 * major cloud API bills a repeated prefix at a discounted "cached input" rate.
 * Pricing every prompt token at the full input rate overstates cloud cost
 * several times over, so we estimate how much of each prompt a cloud
 * provider would have served from cache.
 *
 * Per-model pricing fields (USD per 1M tokens, in config.cloudComparisonModels):
 *   inputPerMillion, outputPerMillion   - standard rates (required)
 *   cachedInputPerMillion               - cache-read rate (optional; default = input rate)
 *   cacheWritePerMillion                - rate for new input written to cache (optional,
 *                                         Anthropic charges 1.25x; default = input rate)
 *   longContext: { overTokens, ...same fields } - higher rate card used when the
 *                                         prompt is longer than overTokens (optional)
 */

const MIN_CACHEABLE_TOKENS = 1024; // providers don't cache prompts shorter than this
const MAX_ENTRIES_PER_STREAM = 10;

function cacheTtlMs() {
  return (config.promptCacheTtlMinutes || 5) * 60 * 1000;
}

function getModelPricing(id) {
  const p = (config.cloudComparisonModels || {})[id];
  return p ? { id, ...p } : null;
}

/** Pick the rate card for a prompt of this length. */
function rateCard(pricing, promptTokens) {
  const lc = pricing.longContext;
  if (lc && promptTokens > lc.overTokens) return { ...pricing, ...lc };
  return pricing;
}

/**
 * Effective per-1M rates for one request.
 */
function effectiveRates(pricing, promptTokens) {
  const card = rateCard(pricing, promptTokens);
  return {
    input: card.cacheWritePerMillion ?? card.inputPerMillion,
    cachedInput: card.cachedInputPerMillion ?? card.inputPerMillion,
    output: card.outputPerMillion
  };
}

/**
 * Cost of one request: uncached input + cached input + output.
 * Returns { input, output, total, rates }.
 */
function requestCost(pricing, promptTokens, completionTokens, cachedTokens = 0) {
  const rates = effectiveRates(pricing, promptTokens);
  const cached = Math.min(cachedTokens || 0, promptTokens);
  const input = ((promptTokens - cached) * rates.input + cached * rates.cachedInput) / 1_000_000;
  const output = (completionTokens * rates.output) / 1_000_000;
  return { input, output, total: input + output, rates };
}

/**
 * Sum costs for every comparison model over a set of requests, each priced
 * individually (so long-context tiers apply per request).
 * rows: [{ prompt_tokens, completion_tokens, cached_tokens }]
 * Returns { costs: {model: total}, parts: {model: {input, output}} }.
 */
function sumAllCloudCosts(rows) {
  const costs = {}, parts = {};
  for (const [id, pricing] of Object.entries(config.cloudComparisonModels || {})) {
    let input = 0, output = 0;
    for (const r of rows) {
      const c = requestCost(pricing, r.prompt_tokens, r.completion_tokens, r.cached_tokens);
      input += c.input;
      output += c.output;
    }
    costs[id] = input + output;
    parts[id] = { input, output };
  }
  return { costs, parts };
}

/**
 * Estimates how many prompt tokens a cloud provider would serve from its
 * prompt cache. Requests are grouped into streams (one per Goose session).
 * A request can reuse the longest earlier prompt (plus that request's reply,
 * which becomes part of the next prompt) in the same stream that started
 * within the cache TTL and is no longer than the current prompt. A cache hit
 * refreshes the entry's TTL, as it does at the providers.
 *
 * This is an estimate: it assumes the conversation grows by appending, which
 * is how agents work, but a rewritten history would make it optimistic.
 */
class CacheEstimator {
  constructor() {
    this.streams = new Map();
  }

  has(key) {
    return this.streams.has(key);
  }

  /**
   * startMs: when the request started. Returns estimated cached tokens and
   * records the request for the ones that follow.
   */
  observe(key, startMs, promptTokens, completionTokens) {
    const ttl = cacheTtlMs();
    let entries = (this.streams.get(key) || []).filter(e => startMs - e.t <= ttl && startMs >= e.t);

    let best = null, cached = 0;
    for (const e of entries) {
      const prefix = e.p + e.c <= promptTokens ? e.p + e.c : (e.p <= promptTokens ? e.p : 0);
      if (prefix > cached) { cached = prefix; best = e; }
    }
    if (cached < MIN_CACHEABLE_TOKENS) cached = 0;
    else best.t = startMs;

    entries.push({ t: startMs, p: promptTokens, c: completionTokens });
    if (entries.length > MAX_ENTRIES_PER_STREAM) entries = entries.slice(-MAX_ENTRIES_PER_STREAM);
    this.streams.set(key, entries);
    return cached;
  }
}

module.exports = {
  getModelPricing,
  effectiveRates,
  requestCost,
  sumAllCloudCosts,
  CacheEstimator
};
