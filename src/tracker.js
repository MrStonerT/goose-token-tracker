const database = require('./database');
const config = require('../config.json');

/**
 * Extract usage from a non-streaming vLLM response.
 * vLLM returns { usage: { prompt_tokens, completion_tokens, total_tokens } }
 */
function extractUsageFromResponse(responseJson) {
  if (responseJson && responseJson.usage) {
    return {
      prompt_tokens: responseJson.usage.prompt_tokens || 0,
      completion_tokens: responseJson.usage.completion_tokens || 0,
      total_tokens: responseJson.usage.total_tokens || 0
    };
  }

  // Fallback: estimate from response content
  console.warn('[tracker] No usage field in response — falling back to estimation');
  let outputText = '';
  if (responseJson?.choices?.[0]) {
    outputText = responseJson.choices[0].message?.content ||
                 responseJson.choices[0].text || '';
  }
  return {
    prompt_tokens: 0,
    completion_tokens: Math.ceil((outputText.length || 0) / 4),
    total_tokens: Math.ceil((outputText.length || 0) / 4)
  };
}

/**
 * Extract usage from accumulated SSE stream chunks.
 * vLLM sends usage in the final chunk when stream_options.include_usage is true.
 */
function extractUsageFromStreamChunks(chunks) {
  for (let i = chunks.length - 1; i >= 0; i--) {
    const chunk = chunks[i];
    if (chunk.usage) {
      return {
        prompt_tokens: chunk.usage.prompt_tokens || 0,
        completion_tokens: chunk.usage.completion_tokens || 0,
        total_tokens: chunk.usage.total_tokens || 0
      };
    }
  }

  // Fallback: estimate from accumulated content deltas
  console.warn('[tracker] No usage in stream chunks — falling back to estimation');
  let totalContent = '';
  for (const chunk of chunks) {
    if (chunk.choices?.[0]?.delta?.content) {
      totalContent += chunk.choices[0].delta.content;
    }
  }
  return {
    prompt_tokens: 0,
    completion_tokens: Math.ceil(totalContent.length / 4),
    total_tokens: Math.ceil(totalContent.length / 4)
  };
}

/**
 * Compute local cost using flat per-token pricing.
 * Default: $0.02 per million input tokens, $0.10 per million output tokens.
 * This accounts for hardware amortization, not just electricity.
 */
function computeLocalCost(promptTokens, completionTokens) {
  const pricing = config.localModelPricing?.default || { inputPerMillion: 0.02, outputPerMillion: 0.10 };
  const inputCost = (promptTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (completionTokens / 1_000_000) * pricing.outputPerMillion;
  return inputCost + outputCost;
}

/**
 * Compute electricity cost as supplementary data.
 */
function computeElectricityCost(latencyMs) {
  const hw = config.hardware || { gpuWatts: 125, electricityCostPerKwh: 0.12 };
  const hours = latencyMs / (1000 * 3600);
  const kwh = (hw.gpuWatts / 1000) * hours;
  return kwh * hw.electricityCostPerKwh;
}

/**
 * Compute cloud cost for the default comparison model.
 */
function computeCloudCost(promptTokens, completionTokens) {
  const models = config.cloudComparisonModels;
  const defaultModel = config.defaultCompareModel || 'gpt-4o';
  const compareModel = models[defaultModel] || models[Object.keys(models)[0]];
  if (!compareModel) return 0;

  const inputCost = (promptTokens / 1_000_000) * compareModel.inputPerMillion;
  const outputCost = (completionTokens / 1_000_000) * compareModel.outputPerMillion;
  return inputCost + outputCost;
}

/**
 * Compute cloud costs for ALL comparison models (for dashboard table).
 */
function computeAllCloudCosts(promptTokens, completionTokens) {
  const results = {};
  for (const [name, pricing] of Object.entries(config.cloudComparisonModels)) {
    const inputCost = (promptTokens / 1_000_000) * pricing.inputPerMillion;
    const outputCost = (completionTokens / 1_000_000) * pricing.outputPerMillion;
    results[name] = inputCost + outputCost;
  }
  return results;
}

/**
 * Compute tokens per second.
 */
function computeTokensPerSecond(completionTokens, latencyMs) {
  if (latencyMs <= 0) return 0;
  return completionTokens / (latencyMs / 1000);
}

/**
 * Record a completed request to the database.
 */
function record({ sessionId, model, requestPath, isStreaming, usage, latencyMs, statusCode, error }) {
  const tokensPerSecond = computeTokensPerSecond(usage.completion_tokens, latencyMs);
  const localCost = computeLocalCost(usage.prompt_tokens, usage.completion_tokens);
  const cloudCost = computeCloudCost(usage.prompt_tokens, usage.completion_tokens);
  const electricityCost = computeElectricityCost(latencyMs);

  database.insertRequest({
    session_id: sessionId || null,
    model: model || 'unknown',
    request_path: requestPath,
    is_streaming: isStreaming ? 1 : 0,
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    total_tokens: usage.total_tokens,
    latency_ms: Math.round(latencyMs),
    tokens_per_second: Math.round(tokensPerSecond * 100) / 100,
    estimated_local_cost: localCost,
    estimated_cloud_cost: cloudCost,
    status_code: statusCode || null,
    error: error || null
  });

  // Auto-register model if new
  const localPricing = config.localModelPricing?.default || {};
  database.upsertModel({
    id: model || 'unknown',
    display_name: model || 'unknown',
    provider: 'local',
    is_local: 1,
    input_price_per_1k: (localPricing.inputPerMillion || 0.02) / 1000,
    output_price_per_1k: (localPricing.outputPerMillion || 0.10) / 1000,
    cloud_equivalent: config.defaultCompareModel || 'gpt-4o'
  });

  const savings = cloudCost - localCost;
  console.log(
    `[tracker] ${model} | in:${usage.prompt_tokens} out:${usage.completion_tokens} | ` +
    `${tokensPerSecond.toFixed(1)} tok/s | ${latencyMs.toFixed(0)}ms | ` +
    `local:$${localCost.toFixed(6)} cloud:$${cloudCost.toFixed(4)} saved:$${savings.toFixed(4)} ` +
    `electricity:$${electricityCost.toFixed(8)}`
  );
}

// SSE event emitter for live dashboard updates
const liveListeners = new Set();

function addLiveListener(res) {
  liveListeners.add(res);
  res.on('close', () => liveListeners.delete(res));
}

function notifyLiveListeners(data) {
  const event = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of liveListeners) {
    res.write(event);
  }
}

/**
 * Get the list of all available cloud models for the dashboard model selector.
 */
function getCloudModelList() {
  return Object.entries(config.cloudComparisonModels).map(([id, pricing]) => ({
    id,
    inputPerMillion: pricing.inputPerMillion,
    outputPerMillion: pricing.outputPerMillion
  }));
}

/**
 * Get the default models shown in the dashboard comparison table.
 */
function getDashboardCompareModels() {
  return config.dashboardCompareModels || ['gpt-4o', 'claude-sonnet-4', 'claude-opus-4'];
}

module.exports = {
  extractUsageFromResponse,
  extractUsageFromStreamChunks,
  computeLocalCost,
  computeElectricityCost,
  computeCloudCost,
  computeAllCloudCosts,
  computeTokensPerSecond,
  record,
  addLiveListener,
  notifyLiveListeners,
  getCloudModelList,
  getDashboardCompareModels
};
