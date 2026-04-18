// ─── Goose Token Tracker — i18n ────────────────────────────────────────────
// Add a new language by adding a key to TRANSLATIONS that mirrors the 'en' shape.

(function () {
  'use strict';

  const TRANSLATIONS = {
    // ── English ──────────────────────────────────────────────────────────────
    en: {
      locale: 'en-US',
      nav: {
        overview: 'Overview',
        vllm:     'vLLM',
        chats:    'Chats',
        cost:     'Cost',
        log:      'Log',
      },
      lifetime: {
        label:    'Goose Lifetime (as reported by Goose)',
        chats:    '{n} chats',
        messages: '{n} messages',
        since:    'since {date}',
      },
      card: {
        totalTokens:     'Total Tokens',
        requests:        'Requests',
        avgTps:          'Avg Tokens/sec',
        localCost:       'Local Cost',
        cloudEquivalent: 'Cloud Equivalent',
        youSaved:        'You Saved',
        generationSpeed: 'generation speed',
      },
      chart: {
        tokenUsage:       'Token Usage Over Time',
        byModel:          'Usage by Model',
        promptTokens:     'Prompt Tokens (Input)',
        completionTokens: 'Completion Tokens (Output)',
        inputTokens:      'Input Tokens',
        outputTokens:     'Output Tokens',
        kvCachePct:       'KV Cache %',
        requests:         'Requests',
        kvCache:          'KV Cache %',
        running:          'Running',
        waiting:          'Waiting',
      },
      vllm: {
        title:              'vLLM Engine Metrics',
        engineState:        'Engine State',
        kvCache:            'KV Cache Usage',
        prefixCacheHit:     'Prefix Cache Hit Rate',
        avgTtft:            'Avg Time to First Token',
        avgE2e:             'Avg E2E Latency',
        vllmTotals:         'vLLM Totals',
        promptTokenSources: 'Prompt Token Sources',
        processMemory:      'Process Memory',
        kvHistory:          'KV Cache & Queue (last 10 min)',
        awake:              'Awake',
        sleepingL1:         'Sleeping (L1)',
        sleeping:           'Sleeping',
        waiting:            'Waiting...',
        runningWaiting:     '{running} running / {waiting} waiting',
        interToken:         'inter-token: {v}',
        phases:             'prefill: {prefill} / decode: {decode}',
        tokens:             '{prompt} prompt / {gen} gen tokens',
        cpu:                'CPU: {cpu}s / vMem: {vMem} GB',
        cachedPct:          '{pct}% cached',
        cacheDetail:        '{hits} / {queries} tokens',
        cachedVsComputed:   'cached vs computed',
        unreachable:        'Unreachable',
      },
      chat: {
        title:          'Chat Analytics',
        viewTiles:      'Tiles',
        viewBar:        'Bar Chart',
        viewTable:      'Table',
        viewProjects:   'By Project',
        colName:        'Chat Name',
        colProject:     'Project',
        colRequests:    'Requests',
        colInputTokens: 'Input Tokens',
        colOutputTokens:'Output Tokens',
        colTotal:       'Total',
        colLocalCost:   'Local Cost',
        colCloudCost:   'Cloud Cost',
        colSavings:     'Savings',
        colDate:        'Date',
        colIn:          'In',
        colOut:         'Out',
        colLocal:       'Local',
        colCloud:       'Cloud',
        input:          'Input',
        output:         'Output',
        localCost:      'Local Cost',
        saved:          'Saved',
        reqs:           '{n} reqs',
        noChatsYet:     'No chats yet. Start using Goose through the tracker!',
        noChats:        'No chats',
        loading:        'Loading...',
        gooseOnlyNote:  "Token data from Goose\u2019s sessions database (this chat was not routed through the proxy). Per-request breakdown not available.",
        messages:       'messages',
        created:        'Created',
        ifOnCloud:      'If this chat ran on cloud',
        save:           'save {amount}',
        requestsTitle:  'Requests ({n})',
        andMore:        '... and {n} more',
        noProject:      '(No Project)',
        noProjects:     'No projects found',
        chats:          '{n} chat',
        chatsPlural:    '{n} chats',
        requestsMeta:   '{n} requests',
        detailTitle:    'Chat Details',
        totalTokens:    'Total Tokens',
        avgLatency:     'Avg Latency',
        avgTps:         'Avg Tok/s',
        // project table headers
        projColName:    'Chat Name',
        projColInput:   'Input',
        projColOutput:  'Output',
        projColTotal:   'Total',
        projColLocal:   'Local Cost',
        projColCloud:   'Cloud Cost',
        projColSaved:   'Saved',
        projColReqs:    'Reqs',
        projColDate:    'Date',
        projInput:      'Input',
        projOutput:     'Output',
        projLocal:      'Local',
        projCloud:      'Cloud',
        projSaved:      'Saved',
      },
      cost: {
        title:           'Cost Comparison: Local vs Cloud',
        compareAgainst:  'Compare against:',
        colLocalModel:   'Local Model',
        colInputTokens:  'Input Tokens',
        colOutputTokens: 'Output Tokens',
        colLocalCost:    'Local Cost',
        colBestSavings:  'Best Savings',
        noData:          'No data yet',
        total:           'TOTAL',
        saved:           'saved',
        extra:           'extra',
        inOut:           'in + out',
      },
      log: {
        title:        'Request Log',
        groupBy:      'Group by:',
        groupNone:    'None',
        groupTime:    'Time (30m)',
        groupSession: 'Session',
        colTime:      'Time',
        colModel:     'Model',
        colInTokens:  'In Tokens',
        colOutTokens: 'Out Tokens',
        colLatency:   'Latency',
        colTps:       'Tok/s',
        colLocalCost: 'Local Cost',
        colCloudCost: 'Cloud Cost',
        colType:      'Type',
        colIn:        'In',
        colOut:       'Out',
        colLocal:     'Local',
        colCloud:     'Cloud',
        showing:      'Showing {start}\u2013{end} of {total}',
        noRequests:   'No requests',
        noRequestsYet:'No requests yet. Start using Goose!',
        ungrouped:    'Ungrouped Requests',
        session:      'Session: {id}',
        reqs:         '{n} reqs',
        local:        'Local:',
        savedLabel:   'Saved:',
        clickLoad:    'Click to load details...',
        noFound:      'No requests found',
        noRequestsGroup: 'No requests yet',
      },
      status: {
        checking:   'Checking vLLM...',
        connected:  'vLLM Connected',
        proxyError: 'Proxy Error',
        uptimeHM:   'Uptime: {h}h {m}m',
        uptimeM:    'Uptime: {m}m',
        live:       'Live',
      },
      stats: {
        tokenBreakdown: '{in} in / {out} out',
        avgLatency:     '{ms}ms avg latency',
        pricingLabel:   '${inPrice}/M in, ${outPrice}/M out',
        vsModel:        'vs {model}',
        savingsPct:     '{pct}% savings vs cloud',
      },
      badge: {
        stream: 'stream',
        sync:   'sync',
        error:  'error',
      },
      settings: {
        title:              'Settings',
        vllmUrl:            'vLLM Server URL',
        vllmUrlHelp:        'The URL of your vLLM or OpenAI-compatible server',
        injectStream:       'Inject <code>stream_options.include_usage</code> on streaming requests',
        injectStreamHelp:   'When enabled, the proxy asks vLLM to append token usage in the final SSE chunk. Disable this if a model or server has trouble with <code>stream_options</code>.',
        gooseDb:            'Goose Sessions Database',
        autoDetect:         'Auto-Detect',
        gooseDbHelp:        "Path to Goose\u2019s sessions.db for chat names and lifetime stats",
        hwName:             'Hardware Name',
        purchasePrice:      'Purchase Price ($)',
        lifespan:           'Expected Lifespan (years)',
        gpuWatts:           'GPU Watts',
        electricityCost:    'Electricity $/kWh',
        calcTitle:          'Calculated Local Cost',
        applyPricing:       'Apply to Pricing',
        calcDepreciation:   'Hourly depreciation',
        calcElectricity:    'Hourly electricity',
        calcHourlyTotal:    'Total cost/hour of GPU time',
        calcOutputCost:     'Output cost/M tokens',
        calcInputCost:      'Input cost/M tokens',
        atTps:              'at {tps} tok/s',
        prefillFaster:      '(prefill ~10x faster)',
        calcBreakevenLabel: 'Breakeven vs',
        localInputPrice:    'Local Cost: Input $/M tokens',
        localOutputPrice:   'Local Cost: Output $/M tokens',
        pricingHelp:        'Set manually, or use the calculator above to derive from hardware costs',
        defaultCompare:     'Default Cloud Comparison Model',
        save:               'Save Settings',
        saving:             'Saving...',
        saved:              '\u2713 Settings saved!',
        saveFailed:         'Save failed',
        loadFailed:         'Failed to load settings',
        networkError:       'Network error saving settings',
        searching:          'Searching...',
        found1:             '\u2713 Found! ({n} location)',
        foundN:             '\u2713 Found! ({n} locations)',
        notFound:           'Not found. Searched {n} locations.',
        detectionFailed:    'Detection failed',
      },
      calc: {
        localExpensive: 'Local is more expensive!',
        tokens:         '{n} tokens',
        days:           '(~{n} days)',
        months:         '(~{n} months)',
        years:          '(~{n} years)',
      },
    },

    // ── Español ───────────────────────────────────────────────────────────────
    es: {
      locale: 'es-ES',
      nav: {
        overview: 'Resumen',
        vllm:     'vLLM',
        chats:    'Chats',
        cost:     'Costo',
        log:      'Registro',
      },
      lifetime: {
        label:    'Vida útil de Goose (reportado por Goose)',
        chats:    '{n} chats',
        messages: '{n} mensajes',
        since:    'desde {date}',
      },
      card: {
        totalTokens:     'Tokens Totales',
        requests:        'Solicitudes',
        avgTps:          'Tokens/seg promedio',
        localCost:       'Costo Local',
        cloudEquivalent: 'Equivalente en la Nube',
        youSaved:        'Ahorraste',
        generationSpeed: 'velocidad de generación',
      },
      chart: {
        tokenUsage:       'Uso de Tokens en el Tiempo',
        byModel:          'Uso por Modelo',
        promptTokens:     'Tokens de Prompt (Entrada)',
        completionTokens: 'Tokens de Respuesta (Salida)',
        inputTokens:      'Tokens de Entrada',
        outputTokens:     'Tokens de Salida',
        kvCachePct:       'KV Cache %',
        requests:         'Solicitudes',
        kvCache:          'KV Cache %',
        running:          'En Ejecución',
        waiting:          'En Espera',
      },
      vllm: {
        title:              'Métricas del Motor vLLM',
        engineState:        'Estado del Motor',
        kvCache:            'Uso del KV Cache',
        prefixCacheHit:     'Tasa de Aciertos del Caché de Prefijos',
        avgTtft:            'Tiempo Promedio al Primer Token',
        avgE2e:             'Latencia E2E Promedio',
        vllmTotals:         'Totales de vLLM',
        promptTokenSources: 'Fuentes de Tokens de Prompt',
        processMemory:      'Memoria del Proceso',
        kvHistory:          'KV Cache y Cola (últimos 10 min)',
        awake:              'Activo',
        sleepingL1:         'Durmiendo (L1)',
        sleeping:           'Durmiendo',
        waiting:            'Esperando...',
        runningWaiting:     '{running} en ejecución / {waiting} en espera',
        interToken:         'inter-token: {v}',
        phases:             'prefill: {prefill} / decode: {decode}',
        tokens:             '{prompt} prompt / {gen} gen tokens',
        cpu:                'CPU: {cpu}s / vMem: {vMem} GB',
        cachedPct:          '{pct}% en caché',
        cacheDetail:        '{hits} / {queries} tokens',
        cachedVsComputed:   'en caché vs calculado',
        unreachable:        'No disponible',
      },
      chat: {
        title:          'Análisis de Chats',
        viewTiles:      'Tarjetas',
        viewBar:        'Gráfico de Barras',
        viewTable:      'Tabla',
        viewProjects:   'Por Proyecto',
        colName:        'Nombre del Chat',
        colProject:     'Proyecto',
        colRequests:    'Solicitudes',
        colInputTokens: 'Tokens de Entrada',
        colOutputTokens:'Tokens de Salida',
        colTotal:       'Total',
        colLocalCost:   'Costo Local',
        colCloudCost:   'Costo en la Nube',
        colSavings:     'Ahorros',
        colDate:        'Fecha',
        colIn:          'Entr.',
        colOut:         'Sal.',
        colLocal:       'Local',
        colCloud:       'Nube',
        input:          'Entrada',
        output:         'Salida',
        localCost:      'Costo Local',
        saved:          'Ahorrado',
        reqs:           '{n} solicitudes',
        noChatsYet:     '¡Aún no hay chats. Empieza a usar Goose a través del rastreador!',
        noChats:        'Sin chats',
        loading:        'Cargando...',
        gooseOnlyNote:  'Datos de tokens de la base de datos de sesiones de Goose (este chat no pasó por el proxy). Desglose por solicitud no disponible.',
        messages:       'mensajes',
        created:        'Creado',
        ifOnCloud:      'Si este chat hubiera usado la nube',
        save:           'ahorro {amount}',
        requestsTitle:  'Solicitudes ({n})',
        andMore:        '... y {n} más',
        noProject:      '(Sin Proyecto)',
        noProjects:     'No se encontraron proyectos',
        chats:          '{n} chat',
        chatsPlural:    '{n} chats',
        requestsMeta:   '{n} solicitudes',
        detailTitle:    'Detalles del Chat',
        totalTokens:    'Tokens Totales',
        avgLatency:     'Latencia Promedio',
        avgTps:         'Tok/s Promedio',
        // project table headers
        projColName:    'Nombre del Chat',
        projColInput:   'Entrada',
        projColOutput:  'Salida',
        projColTotal:   'Total',
        projColLocal:   'Costo Local',
        projColCloud:   'Costo Nube',
        projColSaved:   'Ahorrado',
        projColReqs:    'Solic.',
        projColDate:    'Fecha',
        projInput:      'Entrada',
        projOutput:     'Salida',
        projLocal:      'Local',
        projCloud:      'Nube',
        projSaved:      'Ahorrado',
      },
      cost: {
        title:           'Comparación de Costos: Local vs. Nube',
        compareAgainst:  'Comparar con:',
        colLocalModel:   'Modelo Local',
        colInputTokens:  'Tokens de Entrada',
        colOutputTokens: 'Tokens de Salida',
        colLocalCost:    'Costo Local',
        colBestSavings:  'Mejores Ahorros',
        noData:          'Aún sin datos',
        total:           'TOTAL',
        saved:           'ahorrado',
        extra:           'extra',
        inOut:           'entr. + sal.',
      },
      log: {
        title:        'Registro de Solicitudes',
        groupBy:      'Agrupar por:',
        groupNone:    'Ninguno',
        groupTime:    'Tiempo (30m)',
        groupSession: 'Sesión',
        colTime:      'Hora',
        colModel:     'Modelo',
        colInTokens:  'Tokens Entrada',
        colOutTokens: 'Tokens Salida',
        colLatency:   'Latencia',
        colTps:       'Tok/s',
        colLocalCost: 'Costo Local',
        colCloudCost: 'Costo Nube',
        colType:      'Tipo',
        colIn:        'Entr.',
        colOut:       'Sal.',
        colLocal:     'Local',
        colCloud:     'Nube',
        showing:      'Mostrando {start}\u2013{end} de {total}',
        noRequests:   'Sin solicitudes',
        noRequestsYet:'¡Aún no hay solicitudes. Empieza a usar Goose!',
        ungrouped:    'Solicitudes sin Grupo',
        session:      'Sesión: {id}',
        reqs:         '{n} solicitudes',
        local:        'Local:',
        savedLabel:   'Ahorrado:',
        clickLoad:    'Haz clic para cargar detalles...',
        noFound:      'No se encontraron solicitudes',
        noRequestsGroup: 'Aún no hay solicitudes',
      },
      status: {
        checking:   'Verificando vLLM...',
        connected:  'vLLM Conectado',
        proxyError: 'Error del Proxy',
        uptimeHM:   'Activo: {h}h {m}m',
        uptimeM:    'Activo: {m}m',
        live:       'En Vivo',
      },
      stats: {
        tokenBreakdown: '{in} entrada / {out} salida',
        avgLatency:     '{ms}ms latencia prom.',
        pricingLabel:   '${inPrice}/M entr., ${outPrice}/M sal.',
        vsModel:        'vs {model}',
        savingsPct:     '{pct}% de ahorro vs nube',
      },
      badge: {
        stream: 'streaming',
        sync:   'síncrono',
        error:  'error',
      },
      settings: {
        title:              'Configuración',
        vllmUrl:            'URL del Servidor vLLM',
        vllmUrlHelp:        'La URL de tu servidor vLLM o compatible con OpenAI',
        injectStream:       'Inyectar <code>stream_options.include_usage</code> en solicitudes de streaming',
        injectStreamHelp:   'Cuando está habilitado, el proxy pide a vLLM que incluya el uso de tokens en el último chunk SSE. Desactívalo si un modelo o servidor tiene problemas con <code>stream_options</code>.',
        gooseDb:            'Base de Datos de Sesiones de Goose',
        autoDetect:         'Auto-Detectar',
        gooseDbHelp:        'Ruta al archivo sessions.db de Goose para nombres de chats y estadísticas',
        hwName:             'Nombre del Hardware',
        purchasePrice:      'Precio de Compra ($)',
        lifespan:           'Vida Útil Esperada (años)',
        gpuWatts:           'Vatios de GPU',
        electricityCost:    'Electricidad $/kWh',
        calcTitle:          'Costo Local Calculado',
        applyPricing:       'Aplicar a Precios',
        calcDepreciation:   'Depreciación por hora',
        calcElectricity:    'Electricidad por hora',
        calcHourlyTotal:    'Costo total/hora de GPU',
        calcOutputCost:     'Costo de salida/M tokens',
        calcInputCost:      'Costo de entrada/M tokens',
        atTps:              'a {tps} tok/s',
        prefillFaster:      '(prefill ~10x más rápido)',
        calcBreakevenLabel: 'Punto de equilibrio vs',
        localInputPrice:    'Costo Local: Entrada $/M tokens',
        localOutputPrice:   'Costo Local: Salida $/M tokens',
        pricingHelp:        'Configura manualmente o usa la calculadora de arriba para derivar de costos de hardware',
        defaultCompare:     'Modelo de Comparación Predeterminado',
        save:               'Guardar Configuración',
        saving:             'Guardando...',
        saved:              '\u2713 \u00a1Configuración guardada!',
        saveFailed:         'Error al guardar',
        loadFailed:         'Error al cargar la configuración',
        networkError:       'Error de red al guardar',
        searching:          'Buscando...',
        found1:             '\u2713 \u00a1Encontrado! ({n} ubicación)',
        foundN:             '\u2713 \u00a1Encontrado! ({n} ubicaciones)',
        notFound:           'No encontrado. Se buscaron {n} ubicaciones.',
        detectionFailed:    'Detección fallida',
      },
      calc: {
        localExpensive: '¡Lo local es más caro!',
        tokens:         '{n} tokens',
        days:           '(~{n} días)',
        months:         '(~{n} meses)',
        years:          '(~{n} años)',
      },
    },
  };

  // ─── Core ──────────────────────────────────────────────────────────────────

  let _lang = localStorage.getItem('gtt-lang') || 'en';
  if (!TRANSLATIONS[_lang]) _lang = 'en';

  /**
   * Translate a dotted key with optional {param} interpolation.
   * Examples:
   *   t('vllm.awake')                      → 'Awake'
   *   t('log.showing', {start:1,end:50,total:120}) → 'Showing 1–50 of 120'
   */
  function t(key, params) {
    const parts = key.split('.');
    let val = TRANSLATIONS[_lang];
    for (const p of parts) {
      val = val?.[p];
      if (val === undefined) break;
    }
    if (typeof val !== 'string') {
      // Fallback to English
      val = TRANSLATIONS.en;
      for (const p of parts) {
        val = val?.[p];
        if (val === undefined) break;
      }
    }
    if (typeof val !== 'string') return key; // key missing entirely
    if (!params) return val;
    return val.replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? params[k] : `{${k}}`));
  }

  /**
   * Walk the DOM and update all translation-attributed elements.
   *   data-i18n="key"             → el.textContent = t(key)
   *   data-i18n-html="key"        → el.innerHTML   = t(key)   (only use for trusted strings)
   *   data-i18n-placeholder="key" → el.placeholder  = t(key)
   *   data-i18n-title="key"       → el.title        = t(key)
   */
  function applyTranslations() {
    document.documentElement.lang = _lang;

    document.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-html]').forEach(el => {
      el.innerHTML = t(el.dataset.i18nHtml);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      el.title = t(el.dataset.i18nTitle);
    });

    // Keep the lang button label in sync
    const btn = document.getElementById('lang-btn');
    if (btn) btn.textContent = '\uD83C\uDF10 ' + _lang.toUpperCase();
  }

  /**
   * Switch language, persist to localStorage, and re-render.
   * Called by the language toggle button in the header.
   */
  window.setLanguage = function (lang) {
    if (!TRANSLATIONS[lang]) return;
    _lang = lang;
    localStorage.setItem('gtt-lang', lang);
    applyTranslations();
    // Re-render dynamic content if dashboard is already initialised
    if (typeof refreshAll === 'function') refreshAll();
  };

  /**
   * Returns the list of available language codes (for building a picker).
   */
  window.getAvailableLanguages = function () {
    return Object.keys(TRANSLATIONS);
  };

  // Expose the two key globals dashboard.js needs
  window.t                 = t;
  window.applyTranslations = applyTranslations;

  // Apply translations immediately (scripts are at end of <body>, DOM is ready)
  applyTranslations();
})();
