const http = require('http');
const tracker = require('./tracker');
const config = require('../config.json');

const TARGET = config.targetUrl; // e.g. http://192.168.0.8:8000

// Paths we track tokens for
const TRACKED_PATHS = ['/v1/chat/completions', '/v1/completions'];

/**
 * Create the reverse proxy request handler.
 * This is mounted on /v1/* in the Express app.
 *
 * Design:
 * - Every request is forwarded to the vLLM server unchanged (except stream_options injection)
 * - Responses are forwarded to the client unmodified
 * - Token usage is extracted from the response for tracking (side effect only)
 */
function createProxyHandler() {
  return function proxyHandler(req, res) {
    const startTime = Date.now();
    const requestPath = req.url; // e.g. /v1/chat/completions or /v1/models
    const shouldTrack = TRACKED_PATHS.some(p => requestPath.startsWith(p));

    // Collect request body (limit to 10MB to prevent memory exhaustion)
    const MAX_BODY_SIZE = 10 * 1024 * 1024;
    const bodyChunks = [];
    let bodySize = 0;
    let bodySizeLimitExceeded = false;
    req.on('data', chunk => {
      bodySize += chunk.length;
      if (bodySize > MAX_BODY_SIZE) {
        bodySizeLimitExceeded = true;
        req.destroy();
        return;
      }
      bodyChunks.push(chunk);
    });
    req.on('end', () => {
      if (bodySizeLimitExceeded) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request body too large' }));
        return;
      }
      let bodyBuffer = Buffer.concat(bodyChunks);
      let requestData = null;
      let isStreaming = false;
      let model = 'unknown';
      let sessionId = req.headers[config.sessionIdHeader] || null;

      // Parse JSON body if this is a tracked endpoint
      if (shouldTrack && bodyBuffer.length > 0) {
        try {
          requestData = JSON.parse(bodyBuffer.toString());
          model = requestData.model || 'unknown';
          isStreaming = requestData.stream === true;

          // Inject stream_options so vLLM reports usage in final SSE chunk
          if (isStreaming && !requestData.stream_options) {
            requestData.stream_options = { include_usage: true };
            bodyBuffer = Buffer.from(JSON.stringify(requestData));
          }
        } catch (e) {
          // Non-JSON body, just forward as-is
        }
      }

      // Build target URL
      const targetUrl = new URL(requestPath, TARGET);

      const proxyOpts = {
        hostname: targetUrl.hostname,
        port: targetUrl.port,
        path: targetUrl.pathname + targetUrl.search,
        method: req.method,
        headers: {
          ...req.headers,
          host: targetUrl.host,
          'content-length': bodyBuffer.length
        }
      };

      // Remove proxy-related headers
      delete proxyOpts.headers['x-forwarded-for'];

      const proxyReq = http.request(proxyOpts, (proxyRes) => {
        if (!shouldTrack) {
          // Non-tracked endpoint (e.g. /v1/models) — pure passthrough
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res);
          return;
        }

        if (isStreaming) {
          handleStreamingResponse(req, res, proxyRes, { startTime, model, sessionId, requestPath });
        } else {
          handleNonStreamingResponse(req, res, proxyRes, { startTime, model, sessionId, requestPath });
        }
      });

      proxyReq.on('error', (err) => {
        console.error(`[proxy] Error connecting to ${TARGET}:`, err.message);
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
        }
        res.end(JSON.stringify({
          error: {
            message: `Failed to connect to LLM server: ${err.code || 'connection error'}`,
            type: 'proxy_error',
            code: err.code
          }
        }));

        if (shouldTrack) {
          tracker.record({
            sessionId, model, requestPath, isStreaming,
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            latencyMs: Date.now() - startTime,
            statusCode: 502,
            error: err.message
          });
        }
      });

      proxyReq.write(bodyBuffer);
      proxyReq.end();
    });
  };
}

/**
 * Handle non-streaming response:
 * Buffer entire response, extract usage, forward unmodified to client.
 */
function handleNonStreamingResponse(req, res, proxyRes, ctx) {
  const chunks = [];
  proxyRes.on('data', chunk => chunks.push(chunk));
  proxyRes.on('end', () => {
    const responseBuffer = Buffer.concat(chunks);
    const latencyMs = Date.now() - ctx.startTime;

    // Forward response unmodified to client
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    res.end(responseBuffer);

    // Extract usage for tracking (async from client's perspective)
    try {
      const responseJson = JSON.parse(responseBuffer.toString());
      const usage = tracker.extractUsageFromResponse(responseJson);

      tracker.record({
        sessionId: ctx.sessionId,
        model: ctx.model,
        requestPath: ctx.requestPath,
        isStreaming: false,
        usage,
        latencyMs,
        statusCode: proxyRes.statusCode
      });

      tracker.notifyLiveListeners({
        type: 'request',
        model: ctx.model,
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        latency_ms: Math.round(latencyMs),
        tokens_per_second: tracker.computeTokensPerSecond(usage.completion_tokens, latencyMs)
      });
    } catch (e) {
      // Non-JSON response or parse error — log but don't fail
      console.warn('[proxy] Could not parse response for tracking:', e.message);
    }
  });
}

/**
 * Handle streaming (SSE) response:
 * Pipe response to client in real-time, tap stream to capture usage from final chunk.
 */
function handleStreamingResponse(req, res, proxyRes, ctx) {
  // Forward headers immediately so client starts receiving SSE
  res.writeHead(proxyRes.statusCode, proxyRes.headers);

  const parsedChunks = [];
  let buffer = '';

  proxyRes.on('data', (chunk) => {
    // Forward to client immediately (no buffering delay)
    res.write(chunk);

    // Also parse SSE events for tracking
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    // Keep the last potentially incomplete line in the buffer
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          parsedChunks.push(JSON.parse(data));
        } catch (e) {
          // Skip unparseable chunks
        }
      }
    }
  });

  proxyRes.on('end', () => {
    res.end();

    const latencyMs = Date.now() - ctx.startTime;

    // Process any remaining buffer
    if (buffer.trim()) {
      const lines = buffer.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ') && line.slice(6).trim() !== '[DONE]') {
          try {
            parsedChunks.push(JSON.parse(line.slice(6).trim()));
          } catch (e) { /* skip */ }
        }
      }
    }

    // Extract usage from accumulated chunks
    const usage = tracker.extractUsageFromStreamChunks(parsedChunks);

    tracker.record({
      sessionId: ctx.sessionId,
      model: ctx.model,
      requestPath: ctx.requestPath,
      isStreaming: true,
      usage,
      latencyMs,
      statusCode: proxyRes.statusCode
    });

    tracker.notifyLiveListeners({
      type: 'request',
      model: ctx.model,
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      latency_ms: Math.round(latencyMs),
      tokens_per_second: tracker.computeTokensPerSecond(usage.completion_tokens, latencyMs)
    });
  });

  proxyRes.on('error', (err) => {
    console.error('[proxy] Streaming error:', err.message);
    res.end();
  });
}

module.exports = { createProxyHandler };
