const axios = require('axios');
const crypto = require('crypto');
const config = require('../config/config');

// Global cache for OKX contract specifications
// Structure: Map<symbol, {ctVal, minSz, lotSz, ctMult, ctValCcy}>
let contractSpecsCache = new Map();
let contractSpecsLastFetch = null;
const SPECS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Exchange Service
 * Handles order execution via OKX Demo Trading API (primary) or Bybit Demo Trading API
 * Uses OKX demo account for risk-free demo trading with derivatives (perpetual swaps)
 * Supports leverage, shorting, and cross-margin trading
 * Uses ScraperAPI/ScrapeOps proxy to bypass geo-blocking if configured
 */

// OKX API endpoints (demo trading uses same endpoint with demo account API keys)
const OKX_BASE_URL = 'https://www.okx.com';

// Bybit API endpoints (kept for backward compatibility)
const BYBIT_TESTNET_URL = 'https://api-demo.bybit.com';
const BYBIT_MAINNET_URL = 'https://api.bybit.com';

// Map coin symbols to OKX trading pairs (Derivatives/Perpetual Swaps format: BTC-USDT-SWAP)
// Using perpetual swaps (SWAP) for derivatives trading with leverage and shorting support
const OKX_SYMBOL_MAP = {
  'BTC': 'BTC-USDT-SWAP', 'ETH': 'ETH-USDT-SWAP', 'BNB': 'BNB-USDT-SWAP', 'SOL': 'SOL-USDT-SWAP',
  'XRP': 'XRP-USDT-SWAP', 'DOGE': 'DOGE-USDT-SWAP', 'ADA': 'ADA-USDT-SWAP', 'AVAX': 'AVAX-USDT-SWAP',
  'LINK': 'LINK-USDT-SWAP', 'DOT': 'DOT-USDT-SWAP', 'MATIC': 'MATIC-USDT-SWAP', 'LTC': 'LTC-USDT-SWAP',
  'UNI': 'UNI-USDT-SWAP', 'ATOM': 'ATOM-USDT-SWAP', 'XLM': 'XLM-USDT-SWAP', 'ETC': 'ETC-USDT-SWAP',
  'XMR': 'XMR-USDT-SWAP', 'ALGO': 'ALGO-USDT-SWAP', 'FIL': 'FIL-USDT-SWAP', 'ICP': 'ICP-USDT-SWAP',
  'VET': 'VET-USDT-SWAP', 'EOS': 'EOS-USDT-SWAP', 'XTZ': 'XTZ-USDT-SWAP', 'AAVE': 'AAVE-USDT-SWAP',
  'MKR': 'MKR-USDT-SWAP', 'GRT': 'GRT-USDT-SWAP', 'THETA': 'THETA-USDT-SWAP', 'RUNE': 'RUNE-USDT-SWAP',
  'NEO': 'NEO-USDT-SWAP', 'FTM': 'FTM-USDT-SWAP', 'TRX': 'TRX-USDT-SWAP', 'SUI': 'SUI-USDT-SWAP',
  'ARB': 'ARB-USDT-SWAP', 'OP': 'OP-USDT-SWAP', 'TON': 'TON-USDT-SWAP', 'SHIB': 'SHIB-USDT-SWAP',
  'HBAR': 'HBAR-USDT-SWAP', 'APT': 'APT-USDT-SWAP'
};

// Map coin symbols to Bybit trading pairs (Spot trading uses same format) - kept for backward compatibility
const BYBIT_SYMBOL_MAP = {
  'BTC': 'BTCUSDT', 'ETH': 'ETHUSDT', 'BNB': 'BNBUSDT', 'SOL': 'SOLUSDT',
  'XRP': 'XRPUSDT', 'DOGE': 'DOGEUSDT', 'ADA': 'ADAUSDT', 'AVAX': 'AVAXUSDT',
  'LINK': 'LINKUSDT', 'DOT': 'DOTUSDT', 'MATIC': 'MATICUSDT', 'LTC': 'LTCUSDT',
  'UNI': 'UNIUSDT', 'ATOM': 'ATOMUSDT', 'XLM': 'XLMUSDT', 'ETC': 'ETCUSDT',
  'XMR': 'XMRUSDT', 'ALGO': 'ALGOUSDT', 'FIL': 'FILUSDT', 'ICP': 'ICPUSDT',
  'VET': 'VETUSDT', 'EOS': 'EOSUSDT', 'XTZ': 'XTZUSDT', 'AAVE': 'AAVEUSDT',
  'MKR': 'MKRUSDT', 'GRT': 'GRTUSDT', 'THETA': 'THETAUSDT', 'RUNE': 'RUNEUSDT',
  'NEO': 'NEOUSDT', 'FTM': 'FTMUSDT', 'TRX': 'TRXUSDT', 'SUI': 'SUIUSDT',
  'ARB': 'ARBUSDT', 'OP': 'OPUSDT', 'TON': 'TONUSDT', 'SHIB': 'SHIBUSDT',
  'HBAR': 'HBARUSDT', 'APT': 'APTUSDT'
};

// Legacy maps (kept for backward compatibility but not used)
const BINANCE_SYMBOL_MAP = BYBIT_SYMBOL_MAP;
const MEXC_SYMBOL_MAP = BYBIT_SYMBOL_MAP;

/**
 * Get preferred exchange for trading
 * Only OKX is supported now (Bybit removed)
 */
function getPreferredExchange() {
  const okxApiKey = process.env.OKX_API_KEY || '';
  const okxApiSecret = process.env.OKX_API_SECRET || '';
  const okxPassphrase = process.env.OKX_PASSPHRASE || '';

  // OKX requires API key, secret, and passphrase
  if (okxApiKey && okxApiSecret && okxPassphrase) {
    return {
      exchange: 'OKX',
      apiKey: okxApiKey,
      apiSecret: okxApiSecret,
      passphrase: okxPassphrase,
      testnet: true, // OKX demo uses demo account API keys
      baseUrl: OKX_BASE_URL
    };
  }

  return { exchange: 'DISABLED', apiKey: null, apiSecret: null, passphrase: null, testnet: false, baseUrl: null };
}

/**
 * Check if exchange trading is enabled (OKX Demo Trading only)
 */
function isExchangeTradingEnabled() {
  const okxApiKey = process.env.OKX_API_KEY || '';
  const okxApiSecret = process.env.OKX_API_SECRET || '';
  const okxPassphrase = process.env.OKX_PASSPHRASE || '';
  const hasOkxKeys = okxApiKey.length > 0 && okxApiSecret.length > 0 && okxPassphrase.length > 0;

  const preferredExchange = getPreferredExchange();

  // Log exchange status on first call (startup)
  if (!isExchangeTradingEnabled._logged) {
    isExchangeTradingEnabled._logged = true;
    console.log('\n' + '='.repeat(60));
    if (hasOkxKeys) {
      console.log('🟢 OKX DEMO TRADING CONFIGURATION');
      console.log('='.repeat(60));
      console.log(`✅ Status: ENABLED`);
      console.log(`✅ Mode: OKX_DEMO (Demo Account)`);
      console.log(`✅ API Endpoint: ${preferredExchange.baseUrl}`);
      console.log(`✅ API Key: ${okxApiKey.substring(0, 10)}...${okxApiKey.substring(okxApiKey.length - 4)}`);
      console.log(`✅ All orders will execute via OKX Demo API`);
      console.log(`💡 Get demo account: https://www.okx.com → Demo Trading → Create Demo Account`);
    } else {
      console.log('❌ EXCHANGE TRADING CONFIGURATION');
      console.log('='.repeat(60));
      console.log(`❌ Status: DISABLED`);
      console.log(`❌ Reason: OKX API keys not configured`);
      console.log(`💡 To enable OKX Demo: Set OKX_API_KEY, OKX_API_SECRET, and OKX_PASSPHRASE`);
      console.log(`💡 OKX Demo: https://www.okx.com → Demo Trading → Create Demo Account`);
    }
    console.log('='.repeat(60) + '\n');
  }

  return {
    enabled: hasOkxKeys,
    mode: hasOkxKeys ? 'OKX_DEMO' : 'DISABLED',
    realTrading: hasOkxKeys,
    preferredExchange: preferredExchange.exchange,
    hasOkxKeys: hasOkxKeys,
    testnet: true,
    baseUrl: preferredExchange.baseUrl
  };
}

/**
 * Generate OKX API signature
 * OKX uses: Base64(HMAC-SHA256(secret, timestamp + method + requestPath + body))
 */
function generateOkxSignature(timestamp, method, requestPath, body, apiSecret) {
  const message = timestamp + method.toUpperCase() + requestPath + (body || '');
  const signature = crypto
    .createHmac('sha256', apiSecret)
    .update(message)
    .digest('base64');
  return signature;
}

/**
 * Generate Bybit API signature
 * Bybit uses HMAC SHA256 signature like Binance
 */
function generateBybitSignature(params, apiSecret) {
  // Sort parameters and create query string
  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&');

  return crypto
    .createHmac('sha256', apiSecret)
    .update(sortedParams)
    .digest('hex');
}

/**
 * Generate Binance API signature (legacy, kept for compatibility)
 */
function generateSignature(queryString, apiSecret) {
  return crypto
    .createHmac('sha256', apiSecret)
    .update(queryString)
    .digest('hex');
}

/**
 * Helper function to execute Bybit API request with automatic proxy fallback
 * Tries: ScrapeOps → ScraperAPI → Direct (in sequence on timeout/error)
 * @param {Object} options - Request configuration
 * @param {string} options.apiKey - Bybit API key
 * @param {string} options.apiSecret - Bybit API secret
 * @param {string} options.baseUrl - Bybit API base URL
 * @param {string} options.endpoint - API endpoint (e.g., '/v5/order/create')
 * @param {string} options.method - HTTP method ('GET' or 'POST')
 * @param {Object} options.requestParams - Request parameters (before signature)
 * @param {Object} options.body - Request body (for POST, after signature)
 * @returns {Promise<Object>} Axios response
 */
async function executeBybitRequestWithFallback(options) {
  const { apiKey, apiSecret, baseUrl, endpoint, method = 'GET', requestParams, body } = options;

  const scrapeOpsKey = config.SCRAPEOPS_API_KEY || '';
  const scraperApiKey = config.SCRAPER_API_KEY || '';
  const proxyPriority = config.PROXY_PRIORITY || 'scrapeops';

  // Determine proxy order based on priority
  const proxies = [];
  if (scrapeOpsKey && (proxyPriority === 'scrapeops' || !scraperApiKey)) {
    proxies.push({ name: 'ScrapeOps', key: scrapeOpsKey, url: 'https://proxy.scrapeops.io/v1/' });
  }
  if (scraperApiKey) {
    proxies.push({ name: 'ScraperAPI', key: scraperApiKey, url: 'http://api.scraperapi.com' });
  }
  // Always add direct as last resort (even though it's geo-blocked, worth trying)
  proxies.push({ name: 'Direct', key: null, url: baseUrl });

  // Use timestamp and recvWindow from requestParams if available, otherwise generate new ones
  const timestamp = requestParams?.timestamp ? parseInt(requestParams.timestamp) : Date.now();
  const recvWindow = requestParams?.recvWindow ? parseInt(requestParams.recvWindow) : 5000;
  const signature = generateBybitSignature(requestParams || {}, apiSecret);

  // Try each proxy in sequence
  for (let i = 0; i < proxies.length; i++) {
    const proxy = proxies[i];
    const isLastAttempt = i === proxies.length - 1;

    try {
      let targetUrl, requestConfig;

      if (proxy.name === 'ScrapeOps') {
        // ScrapeOps Proxy API format: https://proxy.scrapeops.io/v1/?api_key=xxx&url=xxx
        const fullUrl = method === 'GET'
          ? `${baseUrl}${endpoint}?${new URLSearchParams({ ...requestParams, signature }).toString()}`
          : `${baseUrl}${endpoint}`;

        const customHeaders = {
          'X-BAPI-API-KEY': apiKey,
          'X-BAPI-TIMESTAMP': timestamp.toString(),
          'X-BAPI-RECV-WINDOW': recvWindow.toString(),
          'X-BAPI-SIGN': signature
        };

        if (method === 'POST') {
          customHeaders['Content-Type'] = 'application/json';
        }

        targetUrl = proxy.url;

        // ScrapeOps Proxy API format:
        // GET: https://proxy.scrapeops.io/v1/?api_key=xxx&url=ENCODED_URL
        // POST: Same, but body goes in request body
        // Headers: Pass as 'headers' query param (JSON string) OR in request headers
        const requestBody = method === 'POST' ? (body || { ...requestParams, signature }) : undefined;

        // Build query params for ScrapeOps
        const scrapeOpsParams = {
          api_key: proxy.key,
          url: fullUrl,
          keep_headers: 'true' // CRITICAL: Tell ScrapeOps to forward custom headers
        };

        // Pass headers as query param (ScrapeOps format)
        // ScrapeOps will forward these headers to the target URL
        scrapeOpsParams.headers = JSON.stringify(customHeaders);

        requestConfig = {
          params: scrapeOpsParams,
          headers: {}, // ScrapeOps doesn't need custom headers in request headers
          timeout: 20000, // 20s timeout (if it doesn't work in 20s, try next proxy)
          validateStatus: (status) => status < 600 // Allow 5xx to be handled
        };

        // For POST requests, body goes in request body
        if (method === 'POST' && requestBody) {
          requestConfig.data = JSON.stringify(requestBody);
          requestConfig.headers['Content-Type'] = 'application/json';
        }

        console.log(`🔄 [BYBIT API] Attempt ${i + 1}/${proxies.length}: Trying ScrapeOps proxy...`);
        console.log(`   📤 ScrapeOps URL: ${targetUrl}`);
        console.log(`   📤 Target URL: ${fullUrl}`);
        console.log(`   📤 Method: ${method}`);
        console.log(`   📤 API Key: ${proxy.key ? proxy.key.substring(0, 8) + '...' : 'MISSING'}`);
        console.log(`   📤 Keep Headers: true (CRITICAL for Bybit auth)`);
        console.log(`   📤 Headers: ${JSON.stringify(customHeaders).substring(0, 150)}...`);
        if (requestBody) {
          console.log(`   📤 Body: ${JSON.stringify(requestBody).substring(0, 150)}...`);
        }
        console.log(`   📤 Full ScrapeOps params: ${JSON.stringify(scrapeOpsParams).substring(0, 200)}...`);
      } else if (proxy.name === 'ScraperAPI') {
        // ScraperAPI format
        const fullUrl = method === 'GET'
          ? `${baseUrl}${endpoint}?${new URLSearchParams({ ...requestParams, signature }).toString()}`
          : `${baseUrl}${endpoint}`;

        const customHeaders = {
          'X-BAPI-API-KEY': apiKey,
          'X-BAPI-TIMESTAMP': timestamp.toString(),
          'X-BAPI-RECV-WINDOW': recvWindow.toString(),
          'X-BAPI-SIGN': signature
        };

        if (method === 'POST') {
          customHeaders['Content-Type'] = 'application/json';
        }

        targetUrl = proxy.url;
        requestConfig = {
          params: {
            api_key: proxy.key,
            url: fullUrl,
            method: method,
            headers: JSON.stringify(customHeaders),
            body: method === 'POST' ? JSON.stringify(body || { ...requestParams, signature }) : undefined
          },
          data: method === 'POST' ? JSON.stringify(body || { ...requestParams, signature }) : undefined,
          headers: {},
          timeout: 20000, // 20s timeout (same as ScrapeOps)
          validateStatus: (status) => status < 500
        };

        console.log(`🔄 [BYBIT API] Attempt ${i + 1}/${proxies.length}: Trying ScraperAPI proxy (fallback)...`);
        console.log(`   📤 ScraperAPI URL: ${targetUrl}`);
        console.log(`   📤 Target URL: ${fullUrl}`);
        console.log(`   📤 Method: ${method}`);
        console.log(`   📤 API Key: ${proxy.key ? proxy.key.substring(0, 8) + '...' : 'MISSING'}`);
      } else {
        // Direct connection (last resort)
        targetUrl = `${baseUrl}${endpoint}`;
        requestConfig = {
          params: method === 'GET' ? { ...requestParams, signature } : undefined,
          data: method === 'POST' ? (body || { ...requestParams, signature }) : undefined,
          headers: {
            'X-BAPI-API-KEY': apiKey,
            'X-BAPI-TIMESTAMP': timestamp.toString(),
            'X-BAPI-RECV-WINDOW': recvWindow.toString(),
            'X-BAPI-SIGN': signature,
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Accept': 'application/json',
            'Accept-Language': 'en-US,en;q=0.9'
          },
          timeout: 10000, // 10s for direct
          validateStatus: (status) => status < 500
        };

        if (method === 'POST') {
          requestConfig.headers['Content-Type'] = 'application/json';
        }

        console.log(`🔄 [BYBIT API] Attempt ${i + 1}/${proxies.length}: Trying direct connection (last resort)...`);
      }

      // Execute request with timing
      let response;
      const startTime = Date.now();
      requestConfig.metadata = { startTime };

      try {
        if (method === 'GET') {
          response = await axios.get(targetUrl, requestConfig);
        } else {
          // For POST requests
          response = await axios.post(targetUrl, requestConfig.data || requestConfig.params, requestConfig);
        }

        const duration = Date.now() - startTime;
        console.log(`   ⏱️ Request completed in ${duration}ms`);

        // Log response details for debugging
        console.log(`   📥 Response status: ${response.status}`);
        console.log(`   📥 Response data: ${JSON.stringify(response.data).substring(0, 200)}...`);

        // Check if response is valid (not HTML/Cloudflare block)
        if (response.data && typeof response.data === 'string' && response.data.includes('<!DOCTYPE')) {
          throw new Error('GEO_BLOCKED');
        }

        // Success! Return response
        console.log(`✅ [BYBIT API] Success via ${proxy.name} proxy`);
        return response;
      } catch (requestError) {
        // Log request error details
        console.log(`   ❌ Request error: ${requestError.message}`);
        if (requestError.response) {
          console.log(`   ❌ Response status: ${requestError.response.status}`);
          console.log(`   ❌ Response data: ${JSON.stringify(requestError.response.data).substring(0, 200)}...`);
        }
        throw requestError;
      }

    } catch (error) {
      // Enhanced timeout detection
      const isTimeout = error.code === 'ECONNABORTED' ||
        error.message?.toLowerCase().includes('timeout') ||
        error.message?.toLowerCase().includes('exceeded') ||
        (error.config && Date.now() - error.config.metadata?.startTime > (error.config.timeout || 0));

      const isGeoBlocked = error.message === 'GEO_BLOCKED' ||
        (error.response?.data && typeof error.response.data === 'string' && error.response.data.includes('<!DOCTYPE'));

      // Log the error details
      console.log(`   ⚠️ ${proxy.name} error: ${error.message || 'Unknown error'}`);
      console.log(`   ⚠️ Error code: ${error.code || 'N/A'}`);
      if (error.response) {
        console.log(`   ⚠️ Response status: ${error.response.status}`);
      }

      if (isLastAttempt) {
        // Last attempt failed, throw the error
        console.log(`\n❌ [BYBIT API] All ${proxies.length} attempts failed. Last error from ${proxy.name}:`);
        if (isTimeout) {
          console.log(`   ⏱️ Timeout after ${error.config?.timeout || 'unknown'}ms`);
          console.log(`   💡 ScrapeOps free tier may be too slow or rate-limited`);
          console.log(`   💡 Consider: 1) Upgrading ScrapeOps plan, 2) Using ScraperAPI, 3) Deploying to a different region`);
        } else if (isGeoBlocked) {
          console.log(`   🚫 Geo-blocked (CloudFront/CDN blocking)`);
        } else {
          console.log(`   ❌ ${error.message}`);
        }
        throw error;
      } else {
        // Try next proxy
        const nextProxy = proxies[i + 1];
        console.log(`\n⚠️ [BYBIT API] ${proxy.name} failed: ${isTimeout ? '⏱️ Timeout' : isGeoBlocked ? '🚫 Geo-blocked' : '❌ ' + error.message}`);
        console.log(`   ↪️ Automatically falling back to ${nextProxy?.name || 'next'} proxy...`);
        console.log(`   ⏳ Waiting 1 second before retry...`);
        // Wait 1 second before trying next proxy
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
}

/**
 * Helper function to execute OKX API request with automatic fallback
 * Tries: Direct → ScrapeOps → ScraperAPI (in sequence on timeout/error)
 * @param {Object} options - Request configuration
 * @returns {Promise<Object>} Axios response
 */
async function executeOkxRequestWithFallback(options) {
  const { apiKey, apiSecret, passphrase, baseUrl, requestPath, method = 'GET', body } = options;

  const scrapeOpsKey = config.SCRAPEOPS_API_KEY || '';
  const scraperApiKey = config.SCRAPER_API_KEY || '';

  // Determine proxy order: Direct first, then ScrapeOps, then ScraperAPI
  const proxies = [
    { name: 'Direct', key: null, url: baseUrl }
  ];

  if (scrapeOpsKey) {
    proxies.push({ name: 'ScrapeOps', key: scrapeOpsKey, url: 'https://proxy.scrapeops.io/v1/' });
  }
  if (scraperApiKey) {
    proxies.push({ name: 'ScraperAPI', key: scraperApiKey, url: 'http://api.scraperapi.com' });
  }

  // Try each proxy in sequence
  for (let i = 0; i < proxies.length; i++) {
    const proxy = proxies[i];
    const isLastAttempt = i === proxies.length - 1;

    try {
      const timestamp = new Date().toISOString();
      const bodyString = body ? JSON.stringify(body) : '';
      const signature = generateOkxSignature(timestamp, method, requestPath, bodyString, apiSecret);

      let targetUrl, requestConfig;

      if (proxy.name === 'Direct') {
        // Direct connection (first attempt)
        targetUrl = `${baseUrl}${requestPath}`;
        requestConfig = {
          method: method,
          headers: {
            'OK-ACCESS-KEY': apiKey,
            'OK-ACCESS-SIGN': signature,
            'OK-ACCESS-TIMESTAMP': timestamp,
            'OK-ACCESS-PASSPHRASE': passphrase,
            'x-simulated-trading': '1', // Required for demo/simulated accounts
            'Content-Type': 'application/json'
          },
          data: body ? JSON.stringify(body) : undefined,
          timeout: 10000, // 10s for direct
          validateStatus: (status) => status >= 200 && status < 300 // Only accept 2xx as success
        };

        console.log(`🔄 [OKX API] Attempt ${i + 1}/${proxies.length}: Trying direct connection...`);
      } else if (proxy.name === 'ScrapeOps') {
        // ScrapeOps proxy - Note: ScrapeOps may not properly forward custom headers for authenticated APIs
        // This is a limitation of free proxy services
        const fullUrl = `${baseUrl}${requestPath}`;
        const scrapeOpsParams = {
          api_key: proxy.key,
          url: fullUrl,
          render: 'false', // Don't render JavaScript
          keep_headers: 'true' // Try to keep headers
        };

        // ScrapeOps requires headers to be passed as a JSON string in the params
        const customHeaders = {
          'OK-ACCESS-KEY': apiKey,
          'OK-ACCESS-SIGN': signature,
          'OK-ACCESS-TIMESTAMP': timestamp,
          'OK-ACCESS-PASSPHRASE': passphrase,
          'x-simulated-trading': '1', // Required for demo/simulated accounts
          'Content-Type': 'application/json'
        };

        // ScrapeOps expects headers as a JSON string
        scrapeOpsParams.headers = JSON.stringify(customHeaders);

        // For POST requests, include body in params (ScrapeOps needs it in params, not data)
        if (method === 'POST' && body) {
          scrapeOpsParams.body = JSON.stringify(body);
          scrapeOpsParams.method = 'POST';
        }

        targetUrl = proxy.url;
        requestConfig = {
          params: scrapeOpsParams,
          method: 'GET', // ScrapeOps proxy uses GET with params
          timeout: 20000,
          validateStatus: (status) => status < 500
        };

        console.log(`⚠️ [OKX API] ScrapeOps may not forward authentication headers correctly - this is a known limitation`);

        console.log(`🔄 [OKX API] Attempt ${i + 1}/${proxies.length}: Trying ScrapeOps proxy (fallback)...`);
      } else {
        // ScraperAPI proxy
        const fullUrl = `${baseUrl}${requestPath}`;
        targetUrl = proxy.url;
        requestConfig = {
          params: {
            api_key: proxy.key,
            url: fullUrl,
            method: method,
            headers: JSON.stringify({
              'OK-ACCESS-KEY': apiKey,
              'OK-ACCESS-SIGN': signature,
              'OK-ACCESS-TIMESTAMP': timestamp,
              'OK-ACCESS-PASSPHRASE': passphrase,
              'x-simulated-trading': '1', // Required for demo/simulated accounts
              'Content-Type': 'application/json'
            }),
            body: body ? JSON.stringify(body) : undefined
          },
          data: body ? JSON.stringify(body) : undefined,
          headers: {},
          timeout: 20000,
          validateStatus: (status) => status < 500
        };

        console.log(`🔄 [OKX API] Attempt ${i + 1}/${proxies.length}: Trying ScraperAPI proxy (fallback)...`);
      }

      // Execute request
      const startTime = Date.now();
      let response;

      if (method === 'GET') {
        response = await axios.get(targetUrl, requestConfig);
      } else {
        // For POST requests, ensure Content-Type is set correctly
        if (!requestConfig.headers) {
          requestConfig.headers = {};
        }
        if (!requestConfig.headers['Content-Type'] && method === 'POST') {
          requestConfig.headers['Content-Type'] = 'application/json';
        }

        // For proxies, send body in data field, not params
        if (proxy.name !== 'Direct') {
          // ScrapeOps uses GET with params, so we need to handle it differently
          if (proxy.name === 'ScrapeOps') {
            // ScrapeOps proxy - use GET with all params (including body)
            response = await axios.get(targetUrl, requestConfig);
          } else {
            // Other proxies (ScraperAPI) need body in data field
            response = await axios.post(targetUrl, requestConfig.data || JSON.stringify(body), {
              ...requestConfig,
              headers: {
                ...requestConfig.headers,
                'Content-Type': 'application/json'
              }
            });
          }
        } else {
          response = await axios.post(targetUrl, requestConfig.data || requestConfig.params, requestConfig);
        }
      }

      const duration = Date.now() - startTime;
      console.log(`   ⏱️ Request completed in ${duration}ms`);
      console.log(`   📥 Response status: ${response.status}`);
      console.log(`   📥 Response data: ${JSON.stringify(response.data).substring(0, 200)}...`);

      // Check if response is valid (not HTML/Cloudflare block)
      if (response.data && typeof response.data === 'string' && response.data.includes('<!DOCTYPE')) {
        throw new Error('GEO_BLOCKED');
      }

      // Check for OKX API errors (401, or code !== '0')
      if (response.status === 401) {
        const errorMsg = response.data?.msg || response.data?.message || 'Unauthorized';
        throw new Error(`OKX Authentication Error: ${errorMsg}`);
      }

      // Check OKX response code (OKX uses 'code' field, '0' means success)
      // Note: We return the response even if code !== '0' because:
      // 1. Business logic errors (like 51088) should be handled by the caller
      // 2. Only network/auth errors should trigger proxy fallback
      // 3. The caller can check response.data.code and handle accordingly
      if (response.data && response.data.code !== undefined && response.data.code !== '0') {
        const errorMsg = response.data.msg || response.data.message || 'Unknown error';
        const errorCode = response.data.code;
        const sCode = response.data?.data?.[0]?.sCode;
        const sMsg = response.data?.data?.[0]?.sMsg;

        // Only throw for authentication/authorization errors that won't benefit from proxy retry
        // Business logic errors (like 51088) should be returned to caller for handling
        const isAuthError = response.status === 401 || errorCode === '50103' ||
          errorMsg.includes('APIKey') || errorMsg.includes('authentication') ||
          errorMsg.includes('Unauthorized') || errorMsg.includes('Forbidden') ||
          errorMsg.includes('OK-ACCESS-KEY');

        if (isAuthError) {
          // Handle specific error 51000 (parameter error)
          if (errorCode === '1' && sCode === '51000') {
            console.log(`\n❌ [OKX API] Parameter error detected (Code: ${sCode})`);
            console.log(`   Error: ${sMsg || errorMsg}`);
            console.log(`   💡 This error means a required parameter is missing or incorrect.`);
            console.log(`   💡 Common causes:`);
            console.log(`      1. Missing 'posSide' parameter for derivatives orders`);
            console.log(`      2. Invalid 'tdMode' or 'posSide' combination`);
            console.log(`      3. Missing or incorrect 'instId' (symbol format)`);
            console.log(`   💡 The bot automatically adds 'posSide' parameter - if error persists, check OKX API documentation\n`);
          } else if (errorCode === '1' && sCode === '51010') {
            console.log(`\n❌ [OKX API] Account mode error detected (Code: ${sCode})`);
            console.log(`   Error: ${sMsg || errorMsg}`);
            console.log(`   💡 This error means your OKX account is not in the correct trading mode for derivatives.`);
            console.log(`   💡 SOLUTION: Switch your account to "Spot and Futures" mode:`);
            console.log(`      1. Go to https://www.okx.com and log in to your DEMO account`);
            console.log(`      2. Navigate to: Trade → Futures → Settings`);
            console.log(`      3. Find "Trading Mode" option`);
            console.log(`      4. Select "Spot and Futures mode" (NOT just "Spot mode")`);
            console.log(`      5. Click "Switch" to confirm`);
            console.log(`      6. This MUST be done through the website/app interface first (cannot be done via API)`);
            console.log(`   💡 Additional checks:`);
            console.log(`      - Ensure your API key has 'Futures Trading' permissions enabled`);
            console.log(`      - Verify you're using API keys from your DEMO account (not live account)`);
            console.log(`      - The 'x-simulated-trading: 1' header is automatically added\n`);
          }

          // Only throw auth errors - these won't be fixed by proxy retry
          throw new Error(`OKX API Error (${errorCode}): ${errorMsg}`);
        }

        // Handle specific business logic errors with helpful messages
        if (errorCode === '50002' || sCode === '50002') {
          console.log(`\n⚠️ [OKX API] Business logic error detected (Code: 50002)`);
          console.log(`   Error: ${sMsg || errorMsg}`);
          console.log(`   💡 This error typically indicates:`);
          console.log(`      1. Invalid order parameters (price, size, or type)`);
          console.log(`      2. Order size below minimum requirement`);
          console.log(`      3. Price precision issue (too many decimal places)`);
          console.log(`      4. Invalid order type or combination of parameters`);
          console.log(`   💡 The bot will attempt to handle this gracefully\n`);
        }

        // For business logic errors (like 51088, 50002), return the response so caller can handle it
        // Don't try proxy fallback for these - they're valid API responses
        console.log(`⚠️ [OKX API] Business logic error (code: ${errorCode}, sCode: ${sCode}) - returning response to caller (no proxy fallback)`);
        return response;
      }

      // Success! Return response
      console.log(`✅ [OKX API] Success via ${proxy.name}`);
      return response;

    } catch (error) {
      // Handle 401 errors from axios (when validateStatus rejects)
      if (error.response && error.response.status === 401) {
        const okxError = error.response.data?.msg || error.response.data?.message || 'Unauthorized';
        const okxCode = error.response.data?.code || '401';

        // Provide helpful guidance for common errors
        if (okxError.includes('APIKey does not match current environment') || okxError.includes('environment')) {
          console.log(`\n💡 [OKX API] Authentication Error: ${okxError}`);
          console.log(`   💡 This error means your API key doesn't match the trading environment (demo vs real)`);
          console.log(`   💡 Possible causes:`);
          console.log(`      1. API key was created for real account but you're using demo (or vice versa)`);
          console.log(`      2. API key, secret, or passphrase is incorrect`);
          console.log(`      3. Passphrase doesn't match the one set when creating the API key`);
          console.log(`   💡 Solution:`);
          console.log(`      - Make sure you're using a DEMO/SIMULATED account API key`);
          console.log(`      - Verify your OKX API credentials in environment variables:`);
          console.log(`        * OKX_API_KEY`);
          console.log(`        * OKX_API_SECRET`);
          console.log(`        * OKX_PASSPHRASE`);
          console.log(`      - The bot automatically adds 'x-simulated-trading: 1' header for demo accounts`);
          console.log(`   💡 Check: https://www.okx.com → Account → API → Manage API Keys\n`);
        }

        throw new Error(`OKX Authentication Error (${okxCode}): ${okxError}`);
      }

      // Handle OKX error codes in error response
      if (error.response && error.response.data && error.response.data.code !== undefined && error.response.data.code !== '0') {
        const errorMsg = error.response.data.msg || error.response.data.message || 'Unknown error';
        const errorCode = error.response.data.code;
        const sCode = error.response.data?.data?.[0]?.sCode;
        const sMsg = error.response.data?.data?.[0]?.sMsg;

        // Check if this is an authentication error (should throw) or business logic error (should return)
        const isAuthError = errorCode === '50103' ||
          errorMsg.includes('APIKey') || errorMsg.includes('authentication') ||
          errorMsg.includes('Unauthorized') || errorMsg.includes('Forbidden') ||
          errorMsg.includes('OK-ACCESS-KEY');

        // Handle specific error 51000 (parameter error)
        if (errorCode === '1' && sCode === '51000') {
          console.log(`\n❌ [OKX API] Parameter error detected (Code: ${sCode})`);
          console.log(`   Error: ${sMsg || errorMsg}`);
          console.log(`   💡 This error means a required parameter is missing or incorrect.`);
          console.log(`   💡 Common causes:`);
          console.log(`      1. Missing 'posSide' parameter for derivatives orders`);
          console.log(`      2. Invalid 'tdMode' or 'posSide' combination`);
          console.log(`      3. Missing or incorrect 'instId' (symbol format)`);
          console.log(`   💡 The bot automatically adds 'posSide' parameter - if error persists, check OKX API documentation\n`);
        } else if (errorCode === '1' && sCode === '51010') {
          console.log(`\n❌ [OKX API] Account mode error detected (Code: ${sCode})`);
          console.log(`   Error: ${sMsg || errorMsg}`);
          console.log(`   💡 This error means your OKX account is not in the correct trading mode for derivatives.`);
          console.log(`   💡 SOLUTION: Switch your account to "Spot and Futures" mode:`);
          console.log(`      1. Go to https://www.okx.com and log in to your DEMO account`);
          console.log(`      2. Navigate to: Trade → Futures → Settings`);
          console.log(`      3. Find "Trading Mode" option`);
          console.log(`      4. Select "Spot and Futures mode" (NOT just "Spot mode")`);
          console.log(`      5. Click "Switch" to confirm`);
          console.log(`      6. This MUST be done through the website/app interface first (cannot be done via API)`);
          console.log(`   💡 Additional checks:`);
          console.log(`      - Ensure your API key has 'Futures Trading' permissions enabled`);
          console.log(`      - Verify you're using API keys from your DEMO account (not live account)`);
          console.log(`      - The 'x-simulated-trading: 1' header is automatically added\n`);
        }

        // Only throw auth errors - return business logic errors (like 51088) as response
        if (isAuthError) {
          throw new Error(`OKX API Error (${errorCode}): ${errorMsg}`);
        } else {
          // Handle specific business logic errors with helpful messages
          if (errorCode === '50002' || sCode === '50002') {
            console.log(`\n⚠️ [OKX API] Business logic error detected (Code: 50002)`);
            console.log(`   Error: ${sMsg || errorMsg}`);
            console.log(`   💡 This error typically indicates:`);
            console.log(`      1. Invalid order parameters (price, size, or type)`);
            console.log(`      2. Order size below minimum requirement`);
            console.log(`      3. Price precision issue (too many decimal places)`);
            console.log(`      4. Invalid order type or combination of parameters`);
            console.log(`   💡 The bot will attempt to handle this gracefully\n`);
          }

          // For business logic errors, return the error response so caller can handle it
          console.log(`⚠️ [OKX API] Business logic error in catch (code: ${errorCode}, sCode: ${sCode}) - returning response`);
          return error.response;
        }
      }
      const isTimeout = error.code === 'ECONNABORTED' ||
        error.message?.toLowerCase().includes('timeout') ||
        error.message?.toLowerCase().includes('exceeded');

      const isGeoBlocked = error.message === 'GEO_BLOCKED' ||
        (error.response?.data && typeof error.response.data === 'string' && error.response.data.includes('<!DOCTYPE'));

      console.log(`   ⚠️ ${proxy.name} error: ${error.message || 'Unknown error'}`);
      console.log(`   ⚠️ Error code: ${error.code || 'N/A'}`);

      if (isLastAttempt) {
        console.log(`\n❌ [OKX API] All ${proxies.length} attempts failed. Last error from ${proxy.name}:`);
        if (isTimeout) {
          console.log(`   ⏱️ Timeout after ${error.config?.timeout || 'unknown'}ms`);
        } else if (isGeoBlocked) {
          console.log(`   🚫 Geo-blocked (CloudFront/CDN blocking)`);
        } else {
          console.log(`   ❌ ${error.message}`);
        }
        throw error;
      } else {
        const nextProxy = proxies[i + 1];
        console.log(`\n⚠️ [OKX API] ${proxy.name} failed: ${isTimeout ? '⏱️ Timeout' : isGeoBlocked ? '🚫 Geo-blocked' : '❌ ' + error.message}`);
        console.log(`   ↪️ Automatically falling back to ${nextProxy?.name || 'next'} proxy...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
}

/**
 * Execute a market order on OKX (Derivatives/Perpetual Swaps)
 * @param {string} symbol - Trading pair symbol (e.g., 'BTC-USDT-SWAP')
 * @param {string} side - 'buy' or 'sell' (OKX uses lowercase)
 * @param {number} quantity - Amount to trade (contract size)
 * @param {string} apiKey - OKX API key
 * @param {string} apiSecret - OKX API secret
 * @param {string} passphrase - OKX passphrase
 * @param {string} baseUrl - OKX API base URL
 * @param {number} leverage - Leverage multiplier (default: 1, max: 125 for most pairs)
 * @returns {Promise<Object>} Order result
 */
/**
 * Execute OKX limit order (for DCA limit orders)
 * @param {string} symbol - OKX symbol (e.g., 'BTC-USDT-SWAP')
 * @param {string} side - 'buy' or 'sell'
 * @param {number} quantity - Order quantity
 * @param {number} price - Limit price
 * @param {string} apiKey - OKX API key
 * @param {string} apiSecret - OKX API secret
 * @param {string} passphrase - OKX passphrase
 * @param {string} baseUrl - OKX API base URL
 * @param {number} leverage - Leverage (default: 1)
 * @returns {Promise<Object>} Order result
 */
async function executeOkxLimitOrder(symbol, side, quantity, price, apiKey, apiSecret, passphrase, baseUrl, leverage = 1) {
  try {
    const requestPath = '/api/v5/trade/order';
    const tdMode = 'isolated'; // Isolated margin for derivatives

    // Apply same lot size rounding as market orders
    const lotSizeMap = {
      'BTC-USDT-SWAP': 0.01,   // 0.01 contracts = 0.0001 BTC
      'ETH-USDT-SWAP': 0.01,   // 0.01 contracts = 0.001 ETH
      'SOL-USDT-SWAP': 0.1,    // 0.1 contracts = 0.1 SOL
      'XRP-USDT-SWAP': 1,      // 1 contract = 10 XRP
      'DOGE-USDT-SWAP': 10,    // 10 contracts = 1000 DOGE
      'ADA-USDT-SWAP': 0.1,    // 0.1 contracts = 1 ADA
      'MATIC-USDT-SWAP': 1,    // 1 contract = 10 MATIC
      'DOT-USDT-SWAP': 0.1,    // 0.1 contracts = 0.1 DOT
      'AVAX-USDT-SWAP': 0.1,   // 0.1 contracts = 0.1 AVAX
      'LINK-USDT-SWAP': 0.1,   // 0.1 contracts = 0.1 LINK
    };

    const lotSize = lotSizeMap[symbol] || 1;

    // Round quantity to nearest lot size multiple
    let roundedQuantity = Math.round(quantity / lotSize) * lotSize;

    // Ensure minimum 1 lot
    if (roundedQuantity < lotSize) {
      roundedQuantity = lotSize;
    }

    // Round to avoid floating point precision issues
    roundedQuantity = parseFloat(roundedQuantity.toFixed(8));

    if (roundedQuantity !== quantity) {
      console.log(`⚠️ [OKX API] DCA quantity adjusted from ${quantity} to ${roundedQuantity} (lot size: ${lotSize})`);
    }

    if (roundedQuantity <= 0) {
      throw new Error('Invalid quantity: must be greater than 0');
    }

    const posSide = side.toLowerCase() === 'buy' ? 'long' : 'short';

    const body = {
      instId: symbol,
      tdMode: tdMode,
      side: side.toLowerCase(),
      posSide: posSide,
      ordType: 'limit', // Limit order
      sz: roundedQuantity.toString(),
      px: price.toFixed(8), // Limit price with precision
      lever: leverage.toString()
    };

    console.log(`📊 [OKX API] Placing limit order: ${side} ${roundedQuantity} ${symbol} at $${price.toFixed(2)} (Leverage: ${leverage}x)`);

    const response = await executeOkxRequestWithFallback({
      apiKey,
      apiSecret,
      passphrase,
      baseUrl,
      requestPath,
      method: 'POST',
      body
    });

    if (response.data && response.data.code === '0' && response.data.data && response.data.data.length > 0) {
      const order = response.data.data[0];
      console.log(`✅ [OKX API] Limit order placed successfully! Order ID: ${order.ordId}`);

      return {
        success: true,
        orderId: order.ordId,
        symbol: order.instId,
        side: order.side,
        quantity: roundedQuantity,
        price: price,
        status: order.state,
        mode: 'OKX'
      };
    } else {
      const errorMsg = response.data?.msg || 'Unknown error';
      console.log(`❌ [OKX API] Limit order failed: ${errorMsg}`);
      return {
        success: false,
        error: errorMsg,
        code: response.data?.code
      };
    }
  } catch (error) {
    console.log(`❌ [OKX API] Error placing limit order: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

async function executeOkxMarketOrder(symbol, side, quantity, apiKey, apiSecret, passphrase, baseUrl, leverage = 1, reduceOnly = false) {
  try {
    const requestPath = '/api/v5/trade/order';
    const tdMode = 'isolated'; // Isolated margin for derivatives

    // OKX Contract Sizes (FALLBACK ONLY - prefer API specs)
    // These are used only if API fetch fails
    // ctVal = Contract Value (coins per contract)
    const CONTRACT_SIZES = {
      'BTC-USDT-SWAP': 0.01,    // 1 contract = 0.01 BTC
      'ETH-USDT-SWAP': 0.1,     // 1 contract = 0.1 ETH
      'SOL-USDT-SWAP': 1,       // 1 contract = 1 SOL
      'XRP-USDT-SWAP': 10,      // 1 contract = 10 XRP
      'DOGE-USDT-SWAP': 100,    // 1 contract = 100 DOGE
      'ADA-USDT-SWAP': 10,      // 1 contract = 10 ADA
      'MATIC-USDT-SWAP': 10,    // 1 contract = 10 MATIC
      'DOT-USDT-SWAP': 1,       // 1 contract = 1 DOT
      'AVAX-USDT-SWAP': 1,      // 1 contract = 1 AVAX
      'LINK-USDT-SWAP': 1,      // 1 contract = 1 LINK
    };

    const contractSize = CONTRACT_SIZES[symbol] || 1; // Fallback only

    // Try to get real contract specs from API
    let ctVal = contractSize; // Default to fallback
    let minSz = 1; // Default minimum
    let lotSz = 1; // Default lot size

    try {
      const specs = await getContractSpecs(symbol, baseUrl);
      if (specs) {
        ctVal = specs.ctVal;
        minSz = specs.minSz;
        lotSz = specs.lotSz;
        console.log(`📋 [OKX API] Using real specs for ${symbol}: ctVal=${ctVal}, minSz=${minSz}, lotSz=${lotSz}`);
      } else {
        console.log(`⚠️ [OKX API] Using fallback specs for ${symbol}: ctVal=${ctVal}`);
      }
    } catch (error) {
      console.log(`⚠️ [OKX API] Failed to get specs, using fallback: ${error.message}`);
    }

    // Convert coin quantity to contracts using real ctVal
    const contractQuantity = quantity / ctVal;
    console.log(`🔄 [OKX API] Converting: ${quantity} coins / ${ctVal} ctVal = ${contractQuantity.toFixed(4)} contracts`);

    // Lot size map (for rounding)
    const lotSizeMap = {
      'BTC-USDT-SWAP': lotSz,
      'ETH-USDT-SWAP': lotSz,
      'SOL-USDT-SWAP': lotSz,
      'XRP-USDT-SWAP': lotSz,
      'DOGE-USDT-SWAP': lotSz,
      'ADA-USDT-SWAP': lotSz,
      'MATIC-USDT-SWAP': lotSz,
      'DOT-USDT-SWAP': lotSz,
      'AVAX-USDT-SWAP': lotSz,
      'LINK-USDT-SWAP': lotSz,
    };

    const effectiveLotSize = lotSizeMap[symbol] || lotSz;

    // Round to lot size (OKX requires orders to be multiples of lot size)
    let roundedContracts = Math.round(contractQuantity / effectiveLotSize) * effectiveLotSize;

    // If rounding resulted in 0 but we have a valid quantity, keep the fractional amount
    // This allows very small orders (< 1 lot) to go through as fractional contracts
    if (roundedContracts === 0 && contractQuantity > 0) {
      // For very small orders, use the original quantity (fractional)
      roundedContracts = contractQuantity;
    }

    // Enforce minimum order size from API
    if (roundedContracts < minSz && contractQuantity > 0) {
      console.log(`⚠️ [OKX API] Order below minimum ${minSz} contracts, using minimum`);
      roundedContracts = minSz;
    }

    // Round to avoid floating point issues
    roundedContracts = parseFloat(roundedContracts.toFixed(8));

    // Define roundedQuantity (in coins) for logging and return values
    const roundedQuantity = roundedContracts * ctVal;

    console.log(`📏 [OKX API] Sizing: ${quantity} ${symbol} → ${contractQuantity.toFixed(4)} Contracts (ctVal: ${ctVal}) → Rounded: ${roundedContracts} (minSz: ${minSz})`);

    if (roundedContracts <= 0) {
      throw new Error(`Calculated contract size is 0. Quantity ${quantity} too small for ${symbol} (Min: ${ctVal * minSz})`);
    }

    // Pre-order validation: Check max order size and available balance
    // SKIP VALIDATION IF REDUCE ONLY (Closing position)
    if (!reduceOnly) {
      try {
        const maxSize = await getOkxMaxSize(symbol, tdMode, apiKey, apiSecret, passphrase, baseUrl, leverage.toString());
        const maxAvailSize = await getOkxMaxAvailSize(symbol, tdMode, apiKey, apiSecret, passphrase, baseUrl);

        if (maxSize) {
          const maxBuy = parseFloat(maxSize.maxBuy || 0);
          const maxSell = parseFloat(maxSize.maxSell || 0);
          const maxAllowed = side.toLowerCase() === 'buy' ? maxBuy : maxSell;

          if (maxAllowed > 0 && roundedContracts > maxAllowed) {
            console.log(`⚠️ [OKX API] Order size ${roundedContracts} exceeds maximum allowed ${maxAllowed}`);
            throw new Error(`Order size exceeds maximum allowed (max: ${maxAllowed} contracts). Reduce position size.`);
          }
        }

        if (maxAvailSize) {
          const availBuy = parseFloat(maxAvailSize.availBuy || 0);
          const availSell = parseFloat(maxAvailSize.availSell || 0);
          const availAllowed = side.toLowerCase() === 'buy' ? availBuy : availSell;

          if (availAllowed > 0 && roundedContracts > availAllowed) {
            console.log(`⚠️ [OKX API] Order size ${roundedContracts} exceeds available balance ${availAllowed}`);
            throw new Error(`Insufficient available balance (available: ${availAllowed} contracts). Check account balance.`);
          }
        }
      } catch (validationError) {
        // If validation fails with a critical error (insufficient balance, exceeds max), throw it
        if (validationError.message.includes('exceeds maximum') || validationError.message.includes('Insufficient')) {
          throw validationError;
        }
        // For other validation errors, log but continue (order might still work)
        console.log(`⚠️ [OKX API] Pre-order validation warning: ${validationError.message}`);
      }
    } else {
      console.log(`ℹ️ [OKX API] Skipping size validation for ReduceOnly order`);
    }

    // Set leverage to requested value BEFORE placing order (fix error 50016)
    // Determine position side based on order side
    const posSide = side.toLowerCase() === 'buy' ? 'long' : 'short';

    try {
      const setLeverageResult = await setOkxLeverage(symbol, leverage, tdMode, posSide, apiKey, apiSecret, passphrase, baseUrl);
      if (setLeverageResult.success) {
        console.log(`✅ [OKX API] Leverage confirmed at ${leverage}x`);
      } else if (setLeverageResult.warning) {
        console.log(`ℹ️ [OKX API] Leverage warning: ${setLeverageResult.warning}`);
      }
    } catch (leverageSetError) {
      // Non-critical error, log and continue
      console.log(`⚠️ [OKX API] Could not set leverage (continuing anyway): ${leverageSetError.message}`);
    }

    // Verify leverage (optional check)
    try {
      const leverageInfo = await getOkxLeverageInfo(symbol, tdMode, apiKey, apiSecret, passphrase, baseUrl);
      if (leverageInfo) {
        const currentLeverage = parseFloat(leverageInfo.lever || 1);
        if (currentLeverage !== leverage) {
          console.log(`ℹ️ [OKX API] Current leverage: ${currentLeverage}x, requested: ${leverage}x`);
        }
      }
    } catch (leverageError) {
      // Leverage check is optional, continue if it fails
      console.log(`⚠️ [OKX API] Could not verify leverage: ${leverageError.message}`);
    }

    // Get trading fees for cost estimation
    let estimatedFee = 0;
    let feeInfo = null;
    try {
      feeInfo = await getOkxTradeFee('SWAP', apiKey, apiSecret, passphrase, baseUrl, symbol);
      if (feeInfo) {
        // For market orders, we're takers; estimate fee based on order value
        // Note: We don't know the exact price yet, so we'll estimate after execution
        const takerFeeRate = parseFloat(feeInfo.takerU || feeInfo.taker || 0);
        console.log(`💰 [OKX API] Trading fees - Taker: ${(Math.abs(takerFeeRate) * 100).toFixed(4)}%, Maker: ${(Math.abs(parseFloat(feeInfo.makerU || feeInfo.maker || 0)) * 100).toFixed(4)}%`);
      }
    } catch (feeError) {
      // Fee check is optional, continue if it fails
      console.log(`⚠️ [OKX API] Could not get trading fees: ${feeError.message}`);
    }

    // Risk validation: Check position risk before placing order
    // Get current price estimate for risk calculation (use a recent price or market price)
    try {
      // Note: We need an estimated price for risk validation
      // For now, we'll skip if we don't have a price estimate
      // In a real scenario, you'd get the current market price first
      const accountConfig = await getOkxAccountConfig(apiKey, apiSecret, passphrase, baseUrl);

      // Only validate for Portfolio margin (4) and Multi-currency margin (3)
      if (accountConfig && (accountConfig.acctLv === '3' || accountConfig.acctLv === '4')) {
        // For risk validation, we'd need the current market price
        // This is a placeholder - in production, you'd fetch the current price first
        // For now, we'll skip detailed risk validation and rely on max-size checks
        console.log(`🔍 [OKX API] Account mode: ${accountConfig.acctLv === '3' ? 'Multi-currency margin' : 'Portfolio margin'} - Risk validation available`);
      }
    } catch (riskError) {
      // Risk validation is optional, continue if it fails
      console.log(`⚠️ [OKX API] Could not perform risk validation: ${riskError.message}`);
    }

    // For cross margin mode, posSide was already determined above (line 924)
    // 'buy' = long position, 'sell' = short position

    const body = {
      instId: symbol,
      tdMode: tdMode, // Isolated margin for derivatives
      side: side.toLowerCase(), // 'buy' (long) or 'sell' (short)
      posSide: posSide, // Position side: 'long' for buy, 'short' for sell (required for derivatives)
      ordType: 'market', // Market order
      sz: roundedContracts.toString(), // Size (contract quantity, rounded to lot size)
      lever: leverage.toString() // Leverage (1-125, default 1x)
    };

    // Add reduceOnly flag if specified (for TP/SL orders)
    if (reduceOnly) {
      body.reduceOnly = true;
    }

    // Log order details for debugging
    console.log(`🔵 [OKX API] Order body:`, JSON.stringify(body));

    if (roundedQuantity !== quantity) {
      console.log(`⚠️ [OKX API] Quantity adjusted from ${quantity} to ${roundedQuantity} (validation or lot size requirement)`);
    }

    console.log(`🔵 [OKX API] Sending derivatives order: ${side} ${roundedQuantity} ${symbol} (Market, Leverage: ${leverage}x)`);
    console.log(`🔵 [OKX API] API Key: ${apiKey.substring(0, 8)}... (verifying permissions)`);

    const response = await executeOkxRequestWithFallback({
      apiKey,
      apiSecret,
      passphrase,
      baseUrl,
      requestPath,
      method: 'POST',
      body
    });

    console.log(`🔵 [OKX API] Response data:`, JSON.stringify(response.data).substring(0, 500));

    if (response.data && response.data.code === '0' && response.data.data && response.data.data.length > 0) {
      const order = response.data.data[0];
      const executedQty = parseFloat(order.accFillSz || roundedQuantity || 0);
      const executedPrice = parseFloat(order.avgPx || order.px || 0);

      // Calculate estimated fee after execution (now we know the price)
      if (feeInfo && executedPrice > 0) {
        // For derivatives, order value = quantity * contract size * price
        // For simplicity, we'll estimate based on notional value
        // Note: Actual contract size varies by instrument, but this gives a reasonable estimate
        const orderValue = executedQty * executedPrice; // Approximate notional value
        estimatedFee = calculateEstimatedFee('SWAP', orderValue, 'market', feeInfo);

        if (estimatedFee > 0) {
          console.log(`💰 [OKX API] Estimated trading fee: $${estimatedFee.toFixed(4)} (${((estimatedFee / orderValue) * 100).toFixed(4)}% of order value)`);
        }
      }

      console.log(`✅ [OKX API] Order executed successfully!`);
      console.log(`   Order ID: ${order.ordId}`);
      console.log(`   Symbol: ${order.instId}`);
      console.log(`   Side: ${order.side}`);
      console.log(`   Quantity: ${executedQty}`);
      console.log(`   Price: $${executedPrice.toFixed(2)}`);
      if (estimatedFee > 0) {
        console.log(`   Estimated Fee: $${estimatedFee.toFixed(4)}`);
      }
      console.log(`   Status: ${order.state}`);

      return {
        success: true,
        orderId: order.ordId,
        symbol: order.instId,
        side: order.side,
        executedQty: executedQty,
        price: executedPrice,
        status: order.state,
        estimatedFee: estimatedFee,
        feeInfo: feeInfo ? {
          takerRate: parseFloat(feeInfo.takerU || feeInfo.taker || 0),
          makerRate: parseFloat(feeInfo.makerU || feeInfo.maker || 0),
          takerPercent: (Math.abs(parseFloat(feeInfo.takerU || feeInfo.taker || 0)) * 100).toFixed(4),
          makerPercent: (Math.abs(parseFloat(feeInfo.makerU || feeInfo.maker || 0)) * 100).toFixed(4)
        } : null,
        mode: 'OKX',
        data: response.data
      };
    } else {
      const errorMsg = response.data?.msg || response.data?.message || 'Unknown error';
      const errorCode = response.data?.code || response.status || 0;
      const sCode = response.data?.data?.[0]?.sCode;
      const sMsg = response.data?.data?.[0]?.sMsg;

      // Handle specific OKX error codes
      if (errorCode === '1' && sCode === '51000') {
        console.log(`❌ [OKX API] Order failed: Parameter error (Code: ${sCode})`);
        console.log(`   Error: ${sMsg || errorMsg}`);
        console.log(`   💡 This error means a required parameter is missing or incorrect.`);
        console.log(`   💡 Common causes:`);
        console.log(`      1. Missing 'posSide' parameter for derivatives orders`);
        console.log(`      2. Invalid 'tdMode' or 'posSide' combination`);
        console.log(`      3. Missing or incorrect 'instId' (symbol format)`);
        console.log(`   💡 The bot automatically adds 'posSide' parameter - if error persists, check OKX API documentation\n`);
      } else if (errorCode === '1' && sCode === '51008') {
        console.log(`❌ [OKX API] Order failed: Insufficient margin (Code: ${sCode})`);
        console.log(`   Error: ${sMsg || errorMsg}`);
        console.log(`   💡 This error means your OKX demo account doesn't have enough USDT balance to execute this order.`);
        console.log(`   💡 SOLUTION:`);
        console.log(`      1. Check your OKX demo account balance at https://www.okx.com`);
        console.log(`      2. Demo accounts typically start with limited balance (e.g., $10,000 virtual USD)`);
        console.log(`      3. The bot is trying to place an order larger than available margin`);
        console.log(`      4. Reduce position size in trading rules or wait for existing positions to close`);
        console.log(`      5. For testing, you can manually fund your demo account via OKX website if needed\n`);
      } else if (errorCode === '1' && sCode === '51010') {
        console.log(`❌ [OKX API] Order failed: Account mode error (Code: ${sCode})`);
        console.log(`   Error: ${sMsg || errorMsg}`);
        console.log(`   💡 This error means your OKX account is not in the correct trading mode for derivatives.`);
        console.log(`   💡 SOLUTION: Switch your account to "Spot and Futures" mode:`);
        console.log(`      1. Go to https://www.okx.com and log in to your DEMO account`);
        console.log(`      2. Navigate to: Trade → Futures → Settings`);
        console.log(`      3. Find "Trading Mode" option`);
        console.log(`      4. Select "Spot and Futures mode" (NOT just "Spot mode")`);
        console.log(`      5. Click "Switch" to confirm`);
        console.log(`      6. This MUST be done through the website/app interface first (cannot be done via API)`);
        console.log(`   💡 Additional checks:`);
        console.log(`      - Ensure your API key has 'Futures Trading' permissions enabled`);
        console.log(`      - Verify you're using API keys from your DEMO account (not live account)`);
        console.log(`      - The 'x-simulated-trading: 1' header is automatically added`);
      } else {
        console.log(`❌ [OKX API] Order failed: ${errorMsg} (Code: ${errorCode})`);
        if (sCode && sMsg) {
          console.log(`   Detailed error: ${sMsg} (Code: ${sCode})`);
        }
        console.log(`   Full response:`, JSON.stringify(response.data).substring(0, 500));
      }

      return {
        success: false,
        error: sMsg || errorMsg,
        code: sCode || errorCode,
        rawResponse: response.data
      };
    }
  } catch (error) {
    const errorMsg = error.response?.data?.msg || error.response?.data?.message || error.message;
    const errorCode = error.response?.data?.code || error.response?.status || 0;
    const sCode = error.response?.data?.data?.[0]?.sCode;
    const sMsg = error.response?.data?.data?.[0]?.sMsg;

    // Handle specific error 51008 (insufficient margin)
    if (errorCode === '1' && sCode === '51008') {
      console.log(`❌ [OKX API] Order execution error: Insufficient margin (Code: ${sCode})`);
      console.log(`   Error: ${sMsg || errorMsg}`);
      console.log(`   💡 This error means your OKX demo account doesn't have enough USDT balance to execute this order.`);
      console.log(`   💡 SOLUTION:`);
      console.log(`      1. Check your OKX demo account balance at https://www.okx.com`);
      console.log(`      2. Demo accounts typically start with limited balance (e.g., $10,000 virtual USD)`);
      console.log(`      3. The bot is trying to place an order larger than available margin`);
      console.log(`      4. Reduce position size in trading rules or wait for existing positions to close`);
      console.log(`      5. For testing, you can manually fund your demo account via OKX website if needed\n`);
    } else {
      console.log(`❌ [OKX API] Order execution error: ${errorMsg} (Code: ${errorCode})`);
    }

    return {
      success: false,
      error: errorMsg,
      code: errorCode,
      rawResponse: error.response?.data
    };
  }
}

/**
 * Get OKX account balance
 * @param {string} asset - Asset symbol (e.g., 'USDT', 'BTC')
 * @param {string} apiKey - OKX API key
 * @param {string} apiSecret - OKX API secret
 * @param {string} passphrase - OKX passphrase
 * @param {string} baseUrl - OKX API base URL
 * @returns {Promise<number>} Available balance
 */
/**
 * Fetch OKX contract specifications from API
 * Gets ctVal (contract value), minSz (minimum size), lotSz (lot size) for each symbol
 * @param {Array<string>} symbols - Array of OKX symbols (e.g., ['BTC-USDT-SWAP', 'ETH-USDT-SWAP'])
 * @param {string} baseUrl - OKX API base URL
 * @returns {Promise<Map>} Map of symbol -> {ctVal, minSz, lotSz}
 */
async function fetchOkxContractSpecs(symbols, baseUrl = OKX_BASE_URL) {
  try {
    console.log(`📋 Fetching OKX contract specs for ${symbols.length} symbols...`);

    const specs = new Map();

    // Fetch specs for each symbol
    for (const symbol of symbols) {
      try {
        const endpoint = `/api/v5/public/instruments?instType=SWAP&instId=${symbol}`;
        const url = `${baseUrl}${endpoint}`;

        const response = await axios.get(url, {
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json'
          }
        });

        if (response.data && response.data.code === '0' && response.data.data && response.data.data.length > 0) {
          const instrument = response.data.data[0];
          specs.set(symbol, {
            ctVal: parseFloat(instrument.ctVal),      // Contract value (coins per contract)
            minSz: parseFloat(instrument.minSz),      // Minimum order size (contracts)
            lotSz: parseFloat(instrument.lotSz),      // Lot size (contract step)
            ctMult: parseFloat(instrument.ctMult || 1), // Contract multiplier
            ctValCcy: instrument.ctValCcy             // Contract value currency
          });
          console.log(`  ✅ ${symbol}: ctVal=${instrument.ctVal}, minSz=${instrument.minSz}, lotSz=${instrument.lotSz}`);
        } else {
          console.log(`  ⚠️ ${symbol}: No data returned from API`);
        }
      } catch (error) {
        console.log(`  ❌ ${symbol}: Failed to fetch specs - ${error.message}`);
      }
    }

    // Update cache
    contractSpecsCache = specs;
    contractSpecsLastFetch = Date.now();

    console.log(`✅ Fetched specs for ${specs.size}/${symbols.length} symbols`);
    return specs;

  } catch (error) {
    console.error('❌ Failed to fetch OKX contract specs:', error.message);
    return new Map();
  }
}

/**
 * Get contract specs for a symbol (from cache or fetch if needed)
 * @param {string} symbol - OKX symbol (e.g., 'BTC-USDT-SWAP')
 * @param {string} baseUrl - OKX API base URL
 * @returns {Promise<Object|null>} Contract specs or null if not available
 */
async function getContractSpecs(symbol, baseUrl = OKX_BASE_URL) {
  // Check cache first
  if (contractSpecsCache.has(symbol)) {
    const cacheAge = Date.now() - (contractSpecsLastFetch || 0);
    if (cacheAge < SPECS_CACHE_TTL) {
      return contractSpecsCache.get(symbol);
    }
  }

  // Fetch if not in cache or cache expired
  await fetchOkxContractSpecs([symbol], baseUrl);
  return contractSpecsCache.get(symbol) || null;
}

/**
 * Get OKX account balance for a specific asset
 */
async function getOkxBalance(asset, apiKey, apiSecret, passphrase, baseUrl) {
  try {
    const requestPath = '/api/v5/account/balance';

    const response = await executeOkxRequestWithFallback({
      apiKey,
      apiSecret,
      passphrase,
      baseUrl,
      requestPath,
      method: 'GET'
    });

    if (response.data && response.data.code === '0' && response.data.data && response.data.data.length > 0) {
      const balances = response.data.data[0].details || [];
      const assetBalance = balances.find(b => b.ccy === asset);
      return assetBalance ? parseFloat(assetBalance.availBal || assetBalance.bal || 0) : 0;
    }
    return 0;
  } catch (error) {
    console.log(`⚠️ Failed to get OKX balance for ${asset}: ${error.message}`);
    return 0;
  }
}

/**
 * Get open positions from OKX Derivatives/Perpetual Swaps
 * @param {string} apiKey - OKX API key
 * @param {string} apiSecret - OKX API secret
 * @param {string} passphrase - OKX passphrase
 * @param {string} baseUrl - OKX API base URL
 * @returns {Promise<Array>} Array of open positions {coin, quantity, value, side, leverage}
 */
async function getOkxOpenPositions(apiKey, apiSecret, passphrase, baseUrl) {
  try {
    // Use positions endpoint for derivatives (not balance endpoint)
    const requestPath = '/api/v5/account/positions';

    const response = await executeOkxRequestWithFallback({
      apiKey,
      apiSecret,
      passphrase,
      baseUrl,
      requestPath,
      method: 'GET'
    });

    if (response.data && response.data.code === '0' && response.data.data && response.data.data.length > 0) {
      const positions = [];

      // Filter for positions with non-zero size (open positions)
      response.data.data.forEach(position => {
        const pos = parseFloat(position.pos || 0);
        const avgPx = parseFloat(position.avgPx || 0);
        const leverage = parseFloat(position.lever || 1);
        const side = pos > 0 ? 'long' : pos < 0 ? 'short' : null;
        const absPos = Math.abs(pos);

        if (absPos > 0.00000001) {
          // Extract coin symbol from instId (e.g., 'BTC-USDT-SWAP' -> 'BTC')
          const instId = position.instId || '';
          const coin = instId.split('-')[0] || instId;

          positions.push({
            coin: coin,
            symbol: coin,
            quantity: absPos,
            side: side, // 'long' or 'short'
            leverage: leverage,
            avgPrice: avgPx,
            unrealizedPnl: parseFloat(position.upl || 0),
            margin: parseFloat(position.margin || 0),
            usdValue: Math.abs(parseFloat(position.notionalUsd || 0))
          });
        }
      });

      if (positions.length > 0) {
        console.log(`✅ [OKX API] Found ${positions.length} open positions on OKX:`);
        positions.forEach(pos => {
          console.log(`   - ${pos.coin} ${pos.side?.toUpperCase() || ''}: ${pos.quantity.toFixed(8)} @ ${pos.avgPrice.toFixed(2)} (Leverage: ${pos.leverage}x, PnL: $${pos.unrealizedPnl.toFixed(2)})`);
        });
      } else {
        console.log(`✅ [OKX API] No open positions found on OKX (all positions closed)`);
      }

      return positions;
    } else {
      const errorMsg = response.data?.msg || 'Unknown error';
      console.log(`⚠️ [OKX API] Failed to get positions: ${errorMsg}`);
      return [];
    }
  } catch (error) {
    const errorMsg = error.response?.data?.msg || error.message;
    console.log(`❌ [OKX API] Error fetching positions: ${errorMsg}`);
    return [];
  }
}

/**
 * Get OKX account configuration
 * @param {string} apiKey - OKX API key
 * @param {string} apiSecret - OKX API secret
 * @param {string} passphrase - OKX passphrase
 * @param {string} baseUrl - OKX API base URL
 * @returns {Promise<Object>} Account configuration
 */
async function getOkxAccountConfig(apiKey, apiSecret, passphrase, baseUrl) {
  try {
    const requestPath = '/api/v5/account/config';
    const response = await executeOkxRequestWithFallback({
      apiKey,
      apiSecret,
      passphrase,
      baseUrl,
      requestPath,
      method: 'GET'
    });

    if (response.data?.code === '0' && response.data?.data?.[0]) {
      return response.data.data[0];
    }
    return null;
  } catch (error) {
    console.log(`⚠️ [OKX API] Failed to get account config: ${error.message}`);
    return null;
  }
}

/**
 * Get OKX leverage info for an instrument
 * @param {string} instId - Instrument ID (e.g., 'BTC-USDT-SWAP')
 * @param {string} mgnMode - Margin mode ('cross' or 'isolated')
 * @param {string} apiKey - OKX API key
 * @param {string} apiSecret - OKX API secret
 * @param {string} passphrase - OKX passphrase
 * @param {string} baseUrl - OKX API base URL
 * @returns {Promise<Object>} Leverage info
 */
async function getOkxLeverageInfo(instId, mgnMode, apiKey, apiSecret, passphrase, baseUrl) {
  try {
    const requestPath = `/api/v5/account/leverage-info?instId=${instId}&mgnMode=${mgnMode}`;
    const response = await executeOkxRequestWithFallback({
      apiKey,
      apiSecret,
      passphrase,
      baseUrl,
      requestPath,
      method: 'GET'
    });

    if (response.data?.code === '0' && response.data?.data?.[0]) {
      return response.data.data[0];
    }
    return null;
  } catch (error) {
    console.log(`⚠️ [OKX API] Failed to get leverage info: ${error.message}`);
    return null;
  }
}

/**
 * Get maximum order size for an instrument
 * @param {string} instId - Instrument ID (e.g., 'BTC-USDT-SWAP')
 * @param {string} tdMode - Trade mode ('cross' or 'isolated')
 * @param {string} apiKey - OKX API key
 * @param {string} apiSecret - OKX API secret
 * @param {string} passphrase - OKX passphrase
 * @param {string} baseUrl - OKX API base URL
 * @param {string} leverage - Leverage (optional)
 * @returns {Promise<Object>} Max order size info
 */
async function getOkxMaxSize(instId, tdMode, apiKey, apiSecret, passphrase, baseUrl, leverage = null) {
  try {
    let requestPath = `/api/v5/account/max-size?instId=${instId}&tdMode=${tdMode}`;
    if (leverage) {
      requestPath += `&leverage=${leverage}`;
    }

    const response = await executeOkxRequestWithFallback({
      apiKey,
      apiSecret,
      passphrase,
      baseUrl,
      requestPath,
      method: 'GET'
    });

    if (response.data?.code === '0' && response.data?.data?.[0]) {
      return response.data.data[0];
    }
    return null;
  } catch (error) {
    console.log(`⚠️ [OKX API] Failed to get max size: ${error.message}`);
    return null;
  }
}

/**
 * Get maximum available balance/equity for an instrument
 * @param {string} instId - Instrument ID (e.g., 'BTC-USDT-SWAP')
 * @param {string} tdMode - Trade mode ('cross' or 'isolated')
 * @param {string} apiKey - OKX API key
 * @param {string} apiSecret - OKX API secret
 * @param {string} passphrase - OKX passphrase
 * @param {string} baseUrl - OKX API base URL
 * @returns {Promise<Object>} Max available balance info
 */
async function getOkxMaxAvailSize(instId, tdMode, apiKey, apiSecret, passphrase, baseUrl) {
  try {
    const requestPath = `/api/v5/account/max-avail-size?instId=${instId}&tdMode=${tdMode}`;
    const response = await executeOkxRequestWithFallback({
      apiKey,
      apiSecret,
      passphrase,
      baseUrl,
      requestPath,
      method: 'GET'
    });

    if (response.data?.code === '0' && response.data?.data?.[0]) {
      return response.data.data[0];
    }
    return null;
  } catch (error) {
    console.log(`⚠️ [OKX API] Failed to get max available size: ${error.message}`);
    return null;
  }
}

// Fee cache to avoid excessive API calls (cache for 1 hour)
const feeCache = {
  data: null,
  timestamp: 0,
  ttl: 60 * 60 * 1000 // 1 hour
};

/**
 * Get OKX trading fee rates
 * @param {string} instType - Instrument type ('SPOT', 'MARGIN', 'SWAP', 'FUTURES', 'OPTION')
 * @param {string} apiKey - OKX API key
 * @param {string} apiSecret - OKX API secret
 * @param {string} passphrase - OKX passphrase
 * @param {string} baseUrl - OKX API base URL
 * @param {string} instId - Optional instrument ID for specific fee lookup
 * @returns {Promise<Object>} Fee rates info
 */
async function getOkxTradeFee(instType, apiKey, apiSecret, passphrase, baseUrl, instId = null) {
  try {
    // Check cache first
    const now = Date.now();
    if (feeCache.data && (now - feeCache.timestamp) < feeCache.ttl) {
      // Return cached data if it matches the requested instType
      const cached = feeCache.data.find(fee => fee.instType === instType);
      if (cached) {
        return cached;
      }
    }

    // Build request path
    let requestPath = `/api/v5/account/trade-fee?instType=${instType}`;
    if (instId) {
      requestPath += `&instId=${instId}`;
    }

    const response = await executeOkxRequestWithFallback({
      apiKey,
      apiSecret,
      passphrase,
      baseUrl,
      requestPath,
      method: 'GET'
    });

    if (response.data?.code === '0' && response.data?.data?.[0]) {
      const feeData = response.data.data[0];

      // Update cache
      if (!feeCache.data) {
        feeCache.data = [];
      }
      const existingIndex = feeCache.data.findIndex(f => f.instType === instType);
      if (existingIndex >= 0) {
        feeCache.data[existingIndex] = feeData;
      } else {
        feeCache.data.push(feeData);
      }
      feeCache.timestamp = now;

      return feeData;
    }
    return null;
  } catch (error) {
    console.log(`⚠️ [OKX API] Failed to get trade fee: ${error.message}`);
    return null;
  }
}

/**
 * Calculate estimated trading fee for an order
 * @param {string} instType - Instrument type ('SWAP', 'FUTURES', etc.)
 * @param {number} orderValue - Order value in USD
 * @param {string} orderType - Order type ('market' = taker, 'limit' = maker)
 * @param {Object} feeData - Fee data from getOkxTradeFee
 * @returns {number} Estimated fee in USD
 */
function calculateEstimatedFee(instType, orderValue, orderType, feeData) {
  if (!feeData) {
    return 0;
  }

  // For SWAP/FUTURES derivatives, use takerU or makerU (USDT-margined)
  // For SPOT/MARGIN, use taker or maker
  let feeRate = 0;

  if (instType === 'SWAP' || instType === 'FUTURES') {
    // Derivatives: use USDT-margined fees
    if (orderType === 'market') {
      feeRate = parseFloat(feeData.takerU || feeData.taker || 0);
    } else {
      feeRate = parseFloat(feeData.makerU || feeData.maker || 0);
    }
  } else {
    // SPOT/MARGIN: use regular fees
    if (orderType === 'market') {
      feeRate = parseFloat(feeData.taker || 0);
    } else {
      feeRate = parseFloat(feeData.maker || 0);
    }
  }

  // Fee rate is negative (commission) or positive (rebate)
  // Calculate absolute fee amount
  const feeAmount = Math.abs(orderValue * feeRate);

  return feeAmount;
}

/**
 * Get OKX account risk state (Portfolio margin only)
 * @param {string} apiKey - OKX API key
 * @param {string} apiSecret - OKX API secret
 * @param {string} passphrase - OKX passphrase
 * @param {string} baseUrl - OKX API base URL
 * @returns {Promise<Object>} Risk state info
 */
async function getOkxAccountRiskState(apiKey, apiSecret, passphrase, baseUrl) {
  try {
    const requestPath = '/api/v5/account/risk-state';
    const response = await executeOkxRequestWithFallback({
      apiKey,
      apiSecret,
      passphrase,
      baseUrl,
      requestPath,
      method: 'GET'
    });

    if (response.data?.code === '0' && response.data?.data?.[0]) {
      return response.data.data[0];
    }
    return null;
  } catch (error) {
    console.log(`⚠️ [OKX API] Failed to get account risk state: ${error.message}`);
    return null;
  }
}

/**
 * Calculate portfolio margin information using Position Builder
 * This can be used for pre-trade validation and risk assessment
 * @param {Object} options - Position builder options
 * @param {string} options.apiKey - OKX API key
 * @param {string} options.apiSecret - OKX API secret
 * @param {string} options.passphrase - OKX passphrase
 * @param {string} options.baseUrl - OKX API base URL
 * @param {boolean} options.inclRealPosAndEq - Include real positions and equity (default: true)
 * @param {Array} options.simPos - Simulated positions [{instId, pos, avgPx, lever?}]
 * @param {Array} options.simAsset - Simulated assets [{ccy, amt}]
 * @param {string} options.acctLv - Account level ('3' for Multi-currency, '4' for Portfolio, default: '4')
 * @param {string} options.lever - Cross margin leverage (default: '1')
 * @param {string} options.greeksType - Greeks type ('BS', 'PA', 'CASH', default: 'BS')
 * @returns {Promise<Object>} Position builder result
 */
async function getOkxPositionBuilder(options) {
  try {
    const {
      apiKey,
      apiSecret,
      passphrase,
      baseUrl,
      inclRealPosAndEq = true,
      simPos = [],
      simAsset = [],
      acctLv = '4',
      lever = '1',
      greeksType = 'BS'
    } = options;

    const requestPath = '/api/v5/account/position-builder';

    const body = {
      inclRealPosAndEq,
      acctLv,
      lever,
      greeksType
    };

    if (simPos.length > 0) {
      body.simPos = simPos.map(pos => ({
        instId: pos.instId,
        pos: pos.pos.toString(),
        avgPx: pos.avgPx.toString(),
        ...(pos.lever ? { lever: pos.lever.toString() } : {})
      }));
    }

    if (simAsset.length > 0) {
      body.simAsset = simAsset.map(asset => ({
        ccy: asset.ccy,
        amt: asset.amt.toString()
      }));
    }

    const response = await executeOkxRequestWithFallback({
      apiKey,
      apiSecret,
      passphrase,
      baseUrl,
      requestPath,
      method: 'POST',
      body
    });

    if (response.data?.code === '0' && response.data?.data?.[0]) {
      return response.data.data[0];
    }
    return null;
  } catch (error) {
    console.log(`⚠️ [OKX API] Failed to get position builder: ${error.message}`);
    return null;
  }
}

/**
 * Validate position risk before placing order
 * Uses Position Builder to check if the position would be safe
 * @param {string} symbol - Instrument ID (e.g., 'BTC-USDT-SWAP')
 * @param {number} quantity - Position quantity
 * @param {number} price - Estimated entry price
 * @param {string} side - 'buy' or 'sell'
 * @param {number} leverage - Leverage multiplier
 * @param {string} apiKey - OKX API key
 * @param {string} apiSecret - OKX API secret
 * @param {string} passphrase - OKX passphrase
 * @param {string} baseUrl - OKX API base URL
 * @param {Object} accountConfig - Account configuration (from getOkxAccountConfig)
 * @returns {Promise<Object>} Validation result
 */
async function validatePositionRisk(symbol, quantity, price, side, leverage, apiKey, apiSecret, passphrase, baseUrl, accountConfig = null) {
  try {
    // Get account config if not provided
    if (!accountConfig) {
      accountConfig = await getOkxAccountConfig(apiKey, apiSecret, passphrase, baseUrl);
    }

    if (!accountConfig) {
      return {
        valid: true,
        warning: 'Could not get account config, skipping risk validation',
        marginRatio: null
      };
    }

    const acctLv = accountConfig.acctLv;

    // Position builder is mainly useful for Portfolio margin (4) and Multi-currency margin (3)
    // For Futures mode (2), we can still use it but it's less critical
    if (acctLv !== '3' && acctLv !== '4') {
      // For Futures mode, risk validation is less critical, but we can still check
      return {
        valid: true,
        warning: 'Account mode is not Portfolio or Multi-currency margin, using basic validation',
        marginRatio: null
      };
    }

    // Determine position side and quantity
    const pos = side.toLowerCase() === 'buy' ? quantity.toString() : (-quantity).toString();

    // Build simulated position
    const simPos = [{
      instId: symbol,
      pos: pos,
      avgPx: price.toString(),
      lever: leverage.toString()
    }];

    // Get position builder result
    const builderResult = await getOkxPositionBuilder({
      apiKey,
      apiSecret,
      passphrase,
      baseUrl,
      inclRealPosAndEq: true, // Include existing positions
      simPos: simPos,
      acctLv: acctLv,
      lever: leverage.toString(),
      greeksType: 'CASH' // Use empirical Greeks for better accuracy
    });

    if (!builderResult) {
      return {
        valid: true,
        warning: 'Could not calculate position builder, skipping risk validation',
        marginRatio: null
      };
    }

    // Extract key risk metrics
    const marginRatio = parseFloat(builderResult.marginRatio || 0);
    const totalMmr = parseFloat(builderResult.totalMmr || 0);
    const totalImr = parseFloat(builderResult.totalImr || 0);
    const eq = parseFloat(builderResult.eq || 0);
    const upl = parseFloat(builderResult.upl || 0);

    // Risk thresholds
    const CRITICAL_MARGIN_RATIO = 150; // 150% - very risky, near liquidation
    const WARNING_MARGIN_RATIO = 200; // 200% - warning level
    const SAFE_MARGIN_RATIO = 300; // 300% - safe level

    let valid = true;
    let warning = null;
    let error = null;

    // Check margin ratio
    if (marginRatio < CRITICAL_MARGIN_RATIO && marginRatio > 0) {
      valid = false;
      error = `Position would push margin ratio to ${marginRatio.toFixed(2)}% (critical: <${CRITICAL_MARGIN_RATIO}%). Risk of liquidation!`;
    } else if (marginRatio < WARNING_MARGIN_RATIO && marginRatio > 0) {
      valid = true;
      warning = `Position would push margin ratio to ${marginRatio.toFixed(2)}% (warning: <${WARNING_MARGIN_RATIO}%). Consider reducing position size.`;
    } else if (marginRatio < SAFE_MARGIN_RATIO && marginRatio > 0) {
      valid = true;
      warning = `Position margin ratio: ${marginRatio.toFixed(2)}% (safe: >${SAFE_MARGIN_RATIO}%). Monitor closely.`;
    }

    // Check if account equity would go negative
    if (eq < 0) {
      valid = false;
      error = `Position would result in negative equity: $${eq.toFixed(2)}. Cannot place order.`;
    }

    // Get worst-case scenario from stress tests
    const worstCasePnl = builderResult.riskUnitData?.[0]?.mr1FinalResult?.pnl;
    if (worstCasePnl) {
      const worstCase = parseFloat(worstCasePnl);
      if (worstCase < -eq * 0.5) { // If worst case would lose more than 50% of equity
        warning = warning || `Worst-case scenario could result in significant loss: $${worstCase.toFixed(2)}`;
      }
    }

    return {
      valid,
      marginRatio,
      totalMmr,
      totalImr,
      eq,
      upl,
      warning,
      error,
      builderResult
    };
  } catch (error) {
    console.log(`⚠️ [OKX API] Error validating position risk: ${error.message}`);
    return {
      valid: true,
      warning: `Risk validation error: ${error.message}. Proceeding with caution.`,
      marginRatio: null
    };
  }
}

/**
 * Check account mode switch precheck
 * Retrieves precheck information for switching account modes
 * Provides detailed diagnostics about why mode switching might fail
 * @param {string} targetAcctLv - Target account level ('2'=Futures, '3'=Multi-currency, '4'=Portfolio)
 * @param {string} apiKey - OKX API key
 * @param {string} apiSecret - OKX API secret
 * @param {string} passphrase - OKX passphrase
 * @param {string} baseUrl - OKX API base URL
 * @returns {Promise<Object>} Precheck result
 */
async function checkOkxAccountModeSwitchPrecheck(targetAcctLv, apiKey, apiSecret, passphrase, baseUrl) {
  try {
    const requestPath = `/api/v5/account/set-account-switch-precheck?acctLv=${targetAcctLv}`;
    const response = await executeOkxRequestWithFallback({
      apiKey,
      apiSecret,
      passphrase,
      baseUrl,
      requestPath,
      method: 'GET'
    });

    if (response.data?.code === '0' && response.data?.data?.[0]) {
      return response.data.data[0];
    } else if (response.data?.code === '51070') {
      // Special error: User doesn't meet requirements (need to complete Q&A on web/app)
      return {
        sCode: '51070',
        error: 'You do not meet the requirements for switching to this account mode. Please upgrade the account mode on the OKX website or App',
        requiresWebApp: true
      };
    }
    return null;
  } catch (error) {
    console.log(`⚠️ [OKX API] Failed to check account mode switch precheck: ${error.message}`);
    return null;
  }
}

/**
 * Get OKX collateral assets (Portfolio margin only)
 * @param {string} apiKey - OKX API key
 * @param {string} apiSecret - OKX API secret
 * @param {string} passphrase - OKX passphrase
 * @param {string} baseUrl - OKX API base URL
 * @param {string} ccy - Optional currency filter
 * @returns {Promise<Array>} Collateral assets list
 */
async function getOkxCollateralAssets(apiKey, apiSecret, passphrase, baseUrl, ccy = null) {
  try {
    let requestPath = '/api/v5/account/collateral-assets';
    if (ccy) {
      requestPath += `?ccy=${ccy}`;
    }

    const response = await executeOkxRequestWithFallback({
      apiKey,
      apiSecret,
      passphrase,
      baseUrl,
      requestPath,
      method: 'GET'
    });

    if (response.data?.code === '0' && response.data?.data) {
      return response.data.data;
    }
    return [];
  } catch (error) {
    console.log(`⚠️ [OKX API] Failed to get collateral assets: ${error.message}`);
    return [];
  }
}

/**
 * Set OKX settle currency for USD-margined contracts
 * Only applicable to USD-margined contracts (FUTURES/SWAP)
 * @param {string} settleCcy - Settlement currency ('USD', 'USDC', 'USDG')
 * @param {string} apiKey - OKX API key
 * @param {string} apiSecret - OKX API secret
 * @param {string} passphrase - OKX passphrase
 * @param {string} baseUrl - OKX API base URL
 * @returns {Promise<Object>} Result with settleCcy if successful
 */
async function setOkxSettleCurrency(settleCcy, apiKey, apiSecret, passphrase, baseUrl) {
  try {
    const requestPath = '/api/v5/account/set-settle-currency';
    const body = {
      settleCcy: settleCcy
    };

    // executeOkxRequestWithFallback expects body as object (it will stringify internally)
    // Passing JSON.stringify(body) causes double stringification and invalid JSON
    const response = await executeOkxRequestWithFallback({
      apiKey,
      apiSecret,
      passphrase,
      baseUrl,
      requestPath,
      method: 'POST',
      body: body // Pass as object, not stringified
    });

    if (response.data?.code === '0' && response.data?.data?.[0]) {
      console.log(`✅ [OKX API] Settle currency set to: ${settleCcy}`);
      return {
        success: true,
        settleCcy: response.data.data[0].settleCcy
      };
    } else {
      const errorMsg = response.data?.msg || 'Unknown error';
      console.log(`⚠️ [OKX API] Failed to set settle currency: ${errorMsg}`);
      return {
        success: false,
        error: errorMsg
      };
    }
  } catch (error) {
    console.log(`⚠️ [OKX API] Error setting settle currency: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get OKX settle currency list (from account config)
 * @param {string} apiKey - OKX API key
 * @param {string} apiSecret - OKX API secret
 * @param {string} passphrase - OKX passphrase
 * @param {string} baseUrl - OKX API base URL
 * @returns {Promise<Object>} Current settle currency and available list
 */
async function getOkxSettleCurrency(apiKey, apiSecret, passphrase, baseUrl) {
  try {
    const accountConfig = await getOkxAccountConfig(apiKey, apiSecret, passphrase, baseUrl);

    if (accountConfig) {
      return {
        success: true,
        currentSettleCcy: accountConfig.settleCcy || null,
        availableSettleCcyList: accountConfig.settleCcyList || []
      };
    }

    return {
      success: false,
      error: 'Could not retrieve account config'
    };
  } catch (error) {
    console.log(`⚠️ [OKX API] Error getting settle currency: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Place multiple orders on OKX in a single batch request
 * Maximum 20 orders can be placed per request
 * @param {Array<Object>} orders - Array of order objects
 *   Each order should have: { instId, tdMode, side, ordType, sz, px (if limit), posSide (if derivatives), lever (if derivatives), etc. }
 * @param {string} apiKey - OKX API key
 * @param {string} apiSecret - OKX API secret
 * @param {string} passphrase - OKX passphrase
 * @param {string} baseUrl - OKX API base URL
 * @returns {Promise<Object>} Batch order result with array of order results
 */
async function executeOkxBatchOrders(orders, apiKey, apiSecret, passphrase, baseUrl) {
  try {
    if (!Array.isArray(orders) || orders.length === 0) {
      throw new Error('Orders must be a non-empty array');
    }

    if (orders.length > 20) {
      throw new Error('Maximum 20 orders per batch request');
    }

    const requestPath = '/api/v5/trade/batch-orders';

    // Prepare order bodies (ensure all required fields are present)
    const orderBodies = orders.map(order => {
      const body = {
        instId: order.instId,
        tdMode: order.tdMode || 'cross',
        side: order.side.toLowerCase(),
        ordType: order.ordType || 'market',
        sz: order.sz.toString()
      };

      // Add optional fields
      if (order.px) body.px = order.px.toString();
      if (order.posSide) body.posSide = order.posSide;
      if (order.lever) body.lever = order.lever.toString();
      if (order.clOrdId) body.clOrdId = order.clOrdId;
      if (order.tag) body.tag = order.tag;
      if (order.ccy) body.ccy = order.ccy;
      if (order.reduceOnly !== undefined) body.reduceOnly = order.reduceOnly;
      if (order.tgtCcy) body.tgtCcy = order.tgtCcy;
      if (order.banAmend !== undefined) body.banAmend = order.banAmend;
      if (order.pxAmendType) body.pxAmendType = order.pxAmendType;
      if (order.tradeQuoteCcy) body.tradeQuoteCcy = order.tradeQuoteCcy;
      if (order.stpMode) body.stpMode = order.stpMode;
      if (order.attachAlgoOrds) body.attachAlgoOrds = order.attachAlgoOrds;

      return body;
    });

    const response = await executeOkxRequestWithFallback({
      apiKey,
      apiSecret,
      passphrase,
      baseUrl,
      requestPath,
      method: 'POST',
      body: JSON.stringify(orderBodies)
    });

    if (response.data?.code === '0' && response.data?.data) {
      console.log(`✅ [OKX API] Batch order placed: ${response.data.data.length} order(s)`);
      return {
        success: true,
        orders: response.data.data,
        inTime: response.data.inTime,
        outTime: response.data.outTime
      };
    } else {
      const errorMsg = response.data?.msg || 'Unknown error';
      console.log(`❌ [OKX API] Batch order failed: ${errorMsg}`);
      return {
        success: false,
        error: errorMsg,
        code: response.data?.code
      };
    }
  } catch (error) {
    console.log(`❌ [OKX API] Error placing batch orders: ${error.message}`);
    throw error;
  }
}

/**
 * Cancel an order on OKX
 * @param {string} instId - Instrument ID (e.g., 'BTC-USDT-SWAP')
 * @param {string} ordId - Order ID (optional if clOrdId is provided)
 * @param {string} clOrdId - Client Order ID (optional if ordId is provided)
 * @param {string} apiKey - OKX API key
 * @param {string} apiSecret - OKX API secret
 * @param {string} passphrase - OKX passphrase
 * @param {string} baseUrl - OKX API base URL
 * @returns {Promise<Object>} Cancel order result
 */
async function cancelOkxOrder(instId, ordId, clOrdId, apiKey, apiSecret, passphrase, baseUrl) {
  try {
    if (!ordId && !clOrdId) {
      throw new Error('Either ordId or clOrdId must be provided');
    }

    const requestPath = '/api/v5/trade/cancel-order';
    const body = {
      instId: instId
    };

    // NOTE: tdMode is NOT supported for order cancellations on OKX
    // Only include ordId or clOrdId

    if (ordId) {
      body.ordId = ordId;
    } else if (clOrdId) {
      body.clOrdId = clOrdId;
    }

    const response = await executeOkxRequestWithFallback({
      apiKey,
      apiSecret,
      passphrase,
      baseUrl,
      requestPath,
      method: 'POST',
      body: body  // Pass object, not stringified JSON (executeOkxRequestWithFallback will stringify)
    });

    if (response.data?.code === '0' && response.data?.data?.[0]) {
      const orderData = response.data.data[0];
      console.log(`✅ [OKX API] Order canceled: ${orderData.ordId || orderData.clOrdId}`);
      return {
        success: true,
        ordId: orderData.ordId,
        clOrdId: orderData.clOrdId,
        sCode: orderData.sCode,
        sMsg: orderData.sMsg,
        ts: orderData.ts
      };
    } else {
      const errorMsg = response.data?.msg || 'Unknown error';
      console.log(`❌ [OKX API] Cancel order failed: ${errorMsg}`);
      return {
        success: false,
        error: errorMsg,
        code: response.data?.code
      };
    }
  } catch (error) {
    console.log(`❌ [OKX API] Error canceling order: ${error.message}`);
    throw error;
  }
}

/**
 * Cancel multiple orders on OKX (batch wrapper for cancelOkxOrder)
 * @param {Array<Object>} orders - Array of {instId, ordId, clOrdId}
 * @param {string} apiKey - OKX API key
 * @param {string} apiSecret - OKX API secret
 * @param {string} passphrase - OKX passphrase
 * @param {string} baseUrl - OKX API base URL
 * @returns {Promise<Object>} Cancel orders result
 */
async function cancelOkxOrders(orders, apiKey, apiSecret, passphrase, baseUrl) {
  try {
    if (!Array.isArray(orders) || orders.length === 0) {
      return {
        success: false,
        error: 'Orders must be a non-empty array'
      };
    }

    const results = [];
    let successCount = 0;
    let failCount = 0;

    // Cancel each order individually (don't pass tdMode for limit orders)
    for (const order of orders) {
      try {
        const result = await cancelOkxOrder(
          order.instId,
          order.ordId,
          order.clOrdId,
          apiKey,
          apiSecret,
          passphrase,
          baseUrl,
          null  // Don't pass tdMode for limit orders
        );

        results.push(result);
        if (result.success) {
          successCount++;
        } else {
          failCount++;
        }
      } catch (error) {
        failCount++;
        results.push({
          success: false,
          error: error.message,
          ordId: order.ordId
        });
      }
    }

    return {
      success: successCount > 0,
      successCount: successCount,
      failCount: failCount,
      results: results
    };
  } catch (error) {
    console.log(`❌ [OKX API] Error canceling orders: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Place a Take Profit / Stop Loss algo order on OKX
 * Algo orders don't freeze margin and execute automatically when trigger price is hit
 * @param {Object} params - Order parameters
 * @param {string} params.instId - Instrument ID (e.g., 'BTC-USDT-SWAP')
 * @param {string} params.tdMode - Trade mode ('cross', 'isolated', 'cash')
 * @param {string} params.side - Order side ('buy' or 'sell')
 * @param {string} params.posSide - Position side ('long', 'short', 'net')
 * @param {string} params.sz - Quantity (or use closeFraction for full position)
 * @param {string} params.tpTriggerPx - Take profit trigger price
 * @param {string} params.tpOrdPx - Take profit order price (-1 for market)
 * @param {string} params.slTriggerPx - Stop loss trigger price
 * @param {string} params.slOrdPx - Stop loss order price (-1 for market)
 * @param {string} params.tpTriggerPxType - TP trigger type ('last', 'index', 'mark')
 * @param {string} params.slTriggerPxType - SL trigger type ('last', 'index', 'mark')
 * @param {string} params.tpOrdKind - TP order kind ('condition', 'limit')
 * @param {boolean} params.reduceOnly - Whether order can only reduce position
 * @param {boolean} params.cxlOnClosePos - Cancel TP/SL when position is closed
 * @param {string} params.closeFraction - Fraction to close (1 = full position)
 * @param {string} params.algoClOrdId - Client-supplied algo ID
 * @param {string} apiKey - OKX API key
 * @param {string} apiSecret - OKX API secret
 * @param {string} passphrase - OKX passphrase
 * @param {string} baseUrl - OKX API base URL
 * @returns {Promise<Object>} Algo order result
 */
async function placeOkxAlgoOrder(params, apiKey, apiSecret, passphrase, baseUrl, retryCount = 0) {
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 1000; // 1 second

  try {
    const requestPath = '/api/v5/trade/order-algo';

    const body = {
      instId: params.instId,
      tdMode: params.tdMode || 'cross',
      side: params.side.toLowerCase(),
      ordType: params.ordType || 'conditional', // conditional, trigger, move_order_stop, twap, etc.
    };

    // Required: either sz or closeFraction
    // OKX API expects closeFraction as a string (e.g., "1" for full position)
    if (params.closeFraction) {
      body.closeFraction = params.closeFraction.toString();
    } else if (params.sz) {
      body.sz = params.sz.toString();
    } else {
      throw new Error('Either sz or closeFraction must be provided');
    }

    // Position side (required for derivatives in long/short mode)
    if (params.posSide) {
      body.posSide = params.posSide;
    }

    // Take Profit parameters (both TP and SL can be in same conditional order)
    if (params.tpTriggerPx) {
      body.tpTriggerPx = params.tpTriggerPx.toString();
      // tpOrdPx is required if tpTriggerPx is set
      body.tpOrdPx = params.tpOrdPx ? params.tpOrdPx.toString() : '-1';
    }
    if (params.tpTriggerPxType) {
      body.tpTriggerPxType = params.tpTriggerPxType;
    }
    if (params.tpOrdKind) {
      body.tpOrdKind = params.tpOrdKind;
    }

    // Stop Loss parameters (both TP and SL can be in same conditional order)
    if (params.slTriggerPx) {
      body.slTriggerPx = params.slTriggerPx.toString();
      // slOrdPx is required if slTriggerPx is set
      body.slOrdPx = params.slOrdPx ? params.slOrdPx.toString() : '-1';
    }
    if (params.slTriggerPxType) {
      body.slTriggerPxType = params.slTriggerPxType;
    }

    // Optional parameters
    // OKX API accepts boolean values as actual booleans (true/false)
    if (params.reduceOnly !== undefined) {
      body.reduceOnly = params.reduceOnly;
    }
    if (params.cxlOnClosePos !== undefined) {
      body.cxlOnClosePos = params.cxlOnClosePos;
    }
    if (params.algoClOrdId) {
      body.algoClOrdId = params.algoClOrdId;
    }
    if (params.tag) {
      body.tag = params.tag;
    }
    if (params.ccy) {
      body.ccy = params.ccy;
    }

    // Trigger order specific parameters
    if (params.ordType === 'trigger') {
      if (params.triggerPx) {
        body.triggerPx = params.triggerPx.toString();
      }
      if (params.orderPx) {
        body.orderPx = params.orderPx.toString();
      }
      if (params.triggerPxType) {
        body.triggerPxType = params.triggerPxType;
      }
      if (params.attachAlgoOrds) {
        body.attachAlgoOrds = params.attachAlgoOrds;
      }
    }

    // Trailing stop order specific parameters
    if (params.ordType === 'move_order_stop') {
      if (params.callbackRatio) {
        body.callbackRatio = params.callbackRatio.toString();
      }
      if (params.callbackSpread) {
        body.callbackSpread = params.callbackSpread.toString();
      }
      if (params.activePx) {
        body.activePx = params.activePx.toString();
      }
    }

    // TWAP order specific parameters
    if (params.ordType === 'twap') {
      if (params.pxVar) {
        body.pxVar = params.pxVar.toString();
      }
      if (params.pxSpread) {
        body.pxSpread = params.pxSpread.toString();
      }
      if (params.szLimit) {
        body.szLimit = params.szLimit.toString();
      }
      if (params.pxLimit) {
        body.pxLimit = params.pxLimit.toString();
      }
      if (params.timeInterval) {
        body.timeInterval = params.timeInterval.toString();
      }
    }

    // executeOkxRequestWithFallback expects body as object (it will stringify internally)
    // Passing JSON.stringify(body) causes double stringification and invalid JSON
    // Log the body for debugging
    console.log(`📋 [OKX API] Algo order body:`, JSON.stringify(body, null, 2));

    const response = await executeOkxRequestWithFallback({
      apiKey,
      apiSecret,
      passphrase,
      baseUrl,
      requestPath,
      method: 'POST',
      body: body // Pass as object, not stringified
    });

    // OKX API response structure:
    // Success: code === '0', data[0] contains order info
    // Error: code === '1' or other, data[0] contains error info with sCode and sMsg
    if (response.data?.code === '0' && response.data?.data?.[0]) {
      const algoData = response.data.data[0];
      // Check if there's an error in the data (sCode indicates error)
      if (algoData.sCode && algoData.sCode !== '0') {
        // Error in response data
        const errorMsg = algoData.sMsg || 'Unknown error';
        const errorCode = algoData.sCode;
        console.log(`❌ [OKX API] Algo order failed: ${errorMsg} (sCode: ${errorCode})`);

        return {
          success: false,
          error: errorMsg,
          code: errorCode,
          sCode: errorCode,
          sMsg: errorMsg,
          fullResponse: JSON.stringify(response.data, null, 2)
        };
      }

      console.log(`✅ [OKX API] Algo order placed: ${algoData.algoId || algoData.algoClOrdId}`);
      console.log(`   Response: ${JSON.stringify(algoData, null, 2)}`);
      return {
        success: true,
        algoId: algoData.algoId,
        algoClOrdId: algoData.algoClOrdId,
        sCode: algoData.sCode,
        sMsg: algoData.sMsg,
        tag: algoData.tag
      };
    } else {
      // Extract error from response
      const responseData = response.data?.data?.[0];
      const errorMsg = responseData?.sMsg || response.data?.msg || 'Unknown error';
      const errorCode = responseData?.sCode || response.data?.code;
      const fullResponse = JSON.stringify(response.data, null, 2);

      console.log(`❌ [OKX API] Algo order failed: ${errorMsg} (code: ${errorCode})`);
      console.log(`   Full response: ${fullResponse}`);

      // Retry on transient errors (rate limits, temporary failures)
      const isRetryableError = errorCode === '50013' || errorCode === '50014' || errorCode === '50015' ||
        errorMsg.includes('rate limit') || errorMsg.includes('temporary') ||
        errorMsg.includes('timeout') || errorMsg.includes('network');

      if (isRetryableError && retryCount < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * (retryCount + 1); // Exponential backoff
        console.log(`⚠️ [OKX API] Algo order failed (retryable): ${errorMsg}. Retrying in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return placeOkxAlgoOrder(params, apiKey, apiSecret, passphrase, baseUrl, retryCount + 1);
      }

      return {
        success: false,
        error: errorMsg,
        code: errorCode,
        sCode: responseData?.sCode || errorCode, // Ensure sCode is set
        sMsg: responseData?.sMsg || errorMsg,
        fullResponse: fullResponse
      };
    }
  } catch (error) {
    // Retry on network errors
    if (retryCount < MAX_RETRIES && (error.message.includes('network') || error.message.includes('timeout') || error.code === 'ECONNRESET')) {
      const delay = RETRY_DELAY_MS * (retryCount + 1);
      console.log(`⚠️ [OKX API] Network error placing algo order: ${error.message}. Retrying in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return placeOkxAlgoOrder(params, apiKey, apiSecret, passphrase, baseUrl, retryCount + 1);
    }

    console.log(`❌ [OKX API] Error placing algo order: ${error.message}`);
    throw error;
  }
}

/**
 * Cancel algo orders on OKX (up to 10 per request)
 * @param {Array<Object>} orders - Array of {instId, algoId or algoClOrdId}
 * @param {string} apiKey - OKX API key
 * @param {string} apiSecret - OKX API secret
 * @param {string} passphrase - OKX passphrase
 * @param {string} baseUrl - OKX API base URL
 * @returns {Promise<Object>} Cancel algo orders result
 */
async function cancelOkxAlgoOrders(orders, apiKey, apiSecret, passphrase, baseUrl) {
  try {
    if (!Array.isArray(orders) || orders.length === 0) {
      throw new Error('Orders must be a non-empty array');
    }

    if (orders.length > 10) {
      throw new Error('Maximum 10 algo orders per cancel request');
    }

    const requestPath = '/api/v5/trade/cancel-algos';

    // Prepare cancel order bodies
    const cancelBodies = orders.map(order => {
      const body = {
        instId: order.instId
      };

      if (order.algoId) {
        body.algoId = order.algoId;
      } else if (order.algoClOrdId) {
        body.algoClOrdId = order.algoClOrdId;
      } else {
        throw new Error('Either algoId or algoClOrdId must be provided for each order');
      }

      return body;
    });

    const response = await executeOkxRequestWithFallback({
      apiKey,
      apiSecret,
      passphrase,
      baseUrl,
      requestPath,
      method: 'POST',
      body: cancelBodies
    });

    if (response.data?.code === '0' && response.data?.data) {
      console.log(`✅ [OKX API] Canceled ${response.data.data.length} algo order(s)`);
      return {
        success: true,
        orders: response.data.data
      };
    } else {
      const errorMsg = response.data?.msg || 'Unknown error';
      console.log(`❌ [OKX API] Cancel algo orders failed: ${errorMsg}`);
      return {
        success: false,
        error: errorMsg,
        code: response.data?.code
      };
    }
  } catch (error) {
    console.log(`❌ [OKX API] Error canceling algo orders: ${error.message}`);
    throw error;
  }
}

/**
 * Get all algo orders for an instrument
 * @param {string} instId - Instrument ID (e.g., 'BTC-USDT-SWAP')
 * @param {string} ordType - Order type ('conditional', 'oco', 'trigger', 'move_order_stop', 'iceberg', 'twap')
 * @param {string} apiKey - OKX API key
 * @param {string} apiSecret - OKX API secret
 * @param {string} passphrase - OKX passphrase
 * @param {string} baseUrl - OKX API base URL
 * @returns {Promise<Object>} Algo orders list
 */
async function getOkxAlgoOrders(instId, ordType, apiKey, apiSecret, passphrase, baseUrl, instType = 'SWAP') {
  try {
    const requestPath = '/api/v5/trade/orders-algo-pending';

    const params = {};
    if (instId) {
      params.instId = instId;
      params.instType = instType;
    } else {
      params.instType = instType; // Fetch all for this type
    }

    if (ordType) {
      params.ordType = ordType;
    }

    const queryString = new URLSearchParams(params).toString();
    const fullPath = `${requestPath}?${queryString}`;

    const response = await executeOkxRequestWithFallback({
      apiKey,
      apiSecret,
      passphrase,
      baseUrl,
      requestPath: fullPath,
      method: 'GET'
    });

    if (response.data?.code === '0' && response.data?.data) {
      const orders = Array.isArray(response.data.data) ? response.data.data : [];
      return {
        success: true,
        orders: orders
      };
    } else {
      const errorMsg = response.data?.msg || 'Unknown error';
      return {
        success: false,
        error: errorMsg,
        orders: []
      };
    }
  } catch (error) {
    console.log(`❌ [OKX API] Error getting algo orders: ${error.message}`);
    return {
      success: false,
      error: error.message,
      orders: []
    };
  }
}

/**
 * Get algo order details
 * @param {string} algoId - Algo ID (optional if algoClOrdId is provided)
 * @param {string} algoClOrdId - Client-supplied algo ID (optional if algoId is provided)
 * @param {string} apiKey - OKX API key
 * @param {string} apiSecret - OKX API secret
 * @param {string} passphrase - OKX passphrase
 * @param {string} baseUrl - OKX API base URL
 * @returns {Promise<Object>} Algo order details
 */
async function getOkxAlgoOrderDetails(algoId, algoClOrdId, apiKey, apiSecret, passphrase, baseUrl) {
  try {
    if (!algoId && !algoClOrdId) {
      throw new Error('Either algoId or algoClOrdId must be provided');
    }

    let requestPath = '/api/v5/trade/order-algo?';
    if (algoId) {
      requestPath += `algoId=${algoId}`;
    } else {
      requestPath += `algoClOrdId=${algoClOrdId}`;
    }

    const response = await executeOkxRequestWithFallback({
      apiKey,
      apiSecret,
      passphrase,
      baseUrl,
      requestPath,
      method: 'GET'
    });

    if (response.data?.code === '0' && response.data?.data?.[0]) {
      return {
        success: true,
        order: response.data.data[0]
      };
    } else {
      const errorMsg = response.data?.msg || 'Unknown error';
      return {
        success: false,
        error: errorMsg,
        code: response.data?.code
      };
    }
  } catch (error) {
    console.log(`❌ [OKX API] Error getting algo order details: ${error.message}`);
    throw error;
  }
}

/**
 * Check algo order status (wrapper for getOkxAlgoOrderDetails)
 * @param {string} algoId - Algo ID (optional if algoClOrdId is provided)
 * @param {string} algoClOrdId - Client-supplied algo ID (optional if algoId is provided)
 * @param {string} apiKey - OKX API key
 * @param {string} apiSecret - OKX API secret
 * @param {string} passphrase - OKX passphrase
 * @param {string} baseUrl - OKX API base URL
 * @returns {Promise<Object>} Algo order status (active, canceled, executed, etc.)
 */
async function checkOkxAlgoOrderStatus(algoId, algoClOrdId, apiKey, apiSecret, passphrase, baseUrl) {
  try {
    const result = await getOkxAlgoOrderDetails(algoId, algoClOrdId, apiKey, apiSecret, passphrase, baseUrl);

    if (result.success && result.order) {
      const order = result.order;
      // OKX algo order states: 'live', 'effective', 'canceled', 'partially_filled', 'filled', 'failed'
      const state = order.state || order.ordState || 'unknown';
      const isActive = state === 'live' || state === 'effective' || state === 'partially_filled';

      return {
        success: true,
        isActive: isActive,
        state: state,
        order: order
      };
    }

    return {
      success: false,
      isActive: false,
      error: result.error || 'Order not found'
    };
  } catch (error) {
    console.log(`⚠️ [OKX API] Error checking algo order status: ${error.message}`);
    return {
      success: false,
      isActive: false,
      error: error.message
    };
  }
}

/**
 * Validate leverage against OKX limits
 * @param {string} instId - Instrument ID (e.g., 'BTC-USDT-SWAP')
 * @param {number} requestedLeverage - Requested leverage
 * @param {string} tdMode - Trade mode ('cross' or 'isolated')
 * @param {string} apiKey - OKX API key
 * @param {string} apiSecret - OKX API secret
 * @param {string} passphrase - OKX passphrase
 * @param {string} baseUrl - OKX API base URL
 * @returns {Promise<Object>} Validation result with max allowed leverage
 */
async function validateOkxLeverage(instId, requestedLeverage, tdMode, apiKey, apiSecret, passphrase, baseUrl) {
  try {
    const leverageInfo = await getOkxLeverageInfo(instId, tdMode, apiKey, apiSecret, passphrase, baseUrl);

    if (!leverageInfo) {
      console.warn(`⚠️ [OKX API] Could not fetch leverage info for ${instId}, allowing requested leverage ${requestedLeverage}x`);
      return {
        valid: true,
        requestedLeverage: requestedLeverage,
        maxLeverage: null,
        message: 'Leverage info unavailable, proceeding with requested leverage'
      };
    }

    // OKX returns leverage info with maxLeverage field
    const maxLeverage = parseFloat(leverageInfo.lever || leverageInfo.maxLeverage || '125'); // Default to 125x for derivatives

    if (requestedLeverage > maxLeverage) {
      console.warn(`⚠️ [OKX API] Requested leverage ${requestedLeverage}x exceeds max ${maxLeverage}x for ${instId}`);
      return {
        valid: false,
        requestedLeverage: requestedLeverage,
        maxLeverage: maxLeverage,
        message: `Requested leverage ${requestedLeverage}x exceeds maximum ${maxLeverage}x`
      };
    }

    return {
      valid: true,
      requestedLeverage: requestedLeverage,
      maxLeverage: maxLeverage,
      message: `Leverage ${requestedLeverage}x is within limits (max: ${maxLeverage}x)`
    };
  } catch (error) {
    console.warn(`⚠️ [OKX API] Error validating leverage: ${error.message}`);
    // On error, allow the requested leverage (fail open)
    return {
      valid: true,
      requestedLeverage: requestedLeverage,
      maxLeverage: null,
      message: `Leverage validation failed, proceeding with requested leverage: ${error.message}`
    };
  }
}

/**
 * Set leverage for an instrument on OKX
 * @param {string} instId - Instrument ID (e.g., 'BTC-USDT-SWAP')
 * @param {number} leverage - Leverage (1-125)
 * @param {string} mgnMode - Margin mode ('cross' or 'isolated')
 * @param {string} posSide - Position side ('long', 'short', or 'net')
 * @param {string} apiKey - OKX API key
 * @param {string} apiSecret - OKX API secret
 * @param {string} passphrase - OKX passphrase
 * @param {string} baseUrl - OKX API base URL
 * @returns {Promise<Object>} Result with success status
 */
async function setOkxLeverage(instId, leverage, mgnMode, posSide, apiKey, apiSecret, passphrase, baseUrl) {
  try {
    const requestPath = '/api/v5/account/set-leverage';

    // FIXED: For isolated mode, don't include posSide - causes 50002 error
    // Only required fields: instId, lever, mgnMode
    const body = {
      instId,
      lever: leverage.toString(),
      mgnMode: mgnMode || 'isolated'
      // posSide removed - causes "Incorrect json data format" error (50002)
    };

    console.log(`🎯 [OKX API] Setting leverage (corrected):`, JSON.stringify(body));

    const response = await executeOkxRequestWithFallback({
      apiKey,
      apiSecret,
      passphrase,
      baseUrl,
      requestPath,
      method: 'POST',
      body
    });

    if (response.data?.code === '0') {
      console.log(`✅ [OKX API] Leverage set successfully to ${leverage}x for ${instId}`);
      return { success: true };
    } else if (response.data?.code === '59107') {
      // Leverage already set to this value
      console.log(`ℹ️ [OKX API] Leverage already set to ${leverage}x for ${instId}`);
      return { success: true, warning: 'Leverage already at target value' };
    } else {
      console.log(`⚠️ [OKX API] Leverage setting returned code ${response.data?.code}: ${response.data?.msg}`);
      return { success: false, error: response.data?.msg };
    }
  } catch (error) {
    console.log(`⚠️ [OKX API] Leverage setting non-critical error: ${error.message}`);
    console.log(`📝 Continuing with OKX account default leverage...`);
    return { success: false, error: error.message, warning: 'Using account default leverage' };
  }
}
try {
  const requestPath = '/api/v5/account/set-leverage';

  // Get account configuration to check position mode
  let accountConfig = null;
  let posMode = 'net_mode'; // Default to net_mode
  try {
    accountConfig = await getOkxAccountConfig(apiKey, apiSecret, passphrase, baseUrl);
    posMode = accountConfig?.posMode || 'net_mode';
    console.log(`🔍 [OKX API] Account position mode: ${posMode}`);
  } catch (configError) {
    console.log(`⚠️ [OKX API] Could not get account config, assuming net_mode: ${configError.message}`);
  }

  // Build request body according to OKX API documentation
  // For SWAP instruments:
  // - Net Mode (net_mode): NO posSide parameter
  // - Hedge Mode (long_short_mode): REQUIRES posSide parameter for isolated margin
  const body = {
    instId: instId,
    lever: leverage.toString(),
    mgnMode: mgnMode
  };

  // Only include posSide for Hedge Mode (long_short_mode) with isolated margin
  // Per OKX API docs: "posSide is only required when margin mode is isolated in long/short position mode"
  if (posMode === 'long_short_mode' && mgnMode === 'isolated' && posSide && posSide !== 'net') {
    body.posSide = posSide;
    console.log(`🔧 [OKX API] Setting leverage to ${leverage}x for ${instId} (${mgnMode} mode, ${posSide} side, Hedge Mode)...`);
  } else {
    console.log(`🔧 [OKX API] Setting leverage to ${leverage}x for ${instId} (${mgnMode} mode, Net Mode)...`);
  }

  console.log(`📋 [OKX API] Leverage request body:`, JSON.stringify(body));

  const response = await executeOkxRequestWithFallback({
    apiKey,
    apiSecret,
    passphrase,
    baseUrl,
    requestPath,
    method: 'POST',
    body: JSON.stringify(body)
  });

  if (response.data?.code === '0') {
    console.log(`✅ [OKX API] Leverage set to ${leverage}x successfully for ${posSide}`);
    return {
      success: true,
      leverage: leverage
    };
  } else {
    const errorMsg = response.data?.msg || 'Unknown error';
    const errorCode = response.data?.code || 'N/A';
    console.warn(`⚠️ [OKX API] Failed to set leverage for ${posSide} (code: ${errorCode}): ${errorMsg}`);
    console.warn(`📋 [OKX API] Request was:`, JSON.stringify(body));

    // If error 50002 and we're in long/short mode, try setting for both sides
    if (errorCode === '50002' && (posSide === 'long' || posSide === 'short')) {
      console.log(`🔄 [OKX API] Trying to set leverage for both long and short sides...`);

      const oppositeSide = posSide === 'long' ? 'short' : 'long';
      const oppositeBody = { ...body, posSide: oppositeSide };

      const oppositeResponse = await executeOkxRequestWithFallback({
        apiKey,
        apiSecret,
        passphrase,
        baseUrl,
        requestPath,
        method: 'POST',
        body: JSON.stringify(oppositeBody)
      });

      if (oppositeResponse.data?.code === '0') {
        console.log(`✅ [OKX API] Leverage set to ${leverage}x for ${oppositeSide}`);
        // Now try original side again
        const retryResponse = await executeOkxRequestWithFallback({
          apiKey,
          apiSecret,
          passphrase,
          baseUrl,
          requestPath,
          method: 'POST',
          body: JSON.stringify(body)
        });

        if (retryResponse.data?.code === '0') {
          console.log(`✅ [OKX API] Leverage set to ${leverage}x for ${posSide} after setting opposite side`);
          return {
            success: true,
            leverage: leverage
          };
        }
      }
    }

    // Return success anyway if error is not critical (leverage might already be set)
    return {
      success: errorCode === '59107', // Already set to same leverage
      leverage: leverage,
      warning: errorMsg,
      errorCode: errorCode
    };
  }
} catch (error) {
  console.warn(`⚠️ [OKX API] Error setting leverage: ${error.message}`);
  // Fail gracefully - order might still work
  return {
    success: false,
    error: error.message
  };
}
}

/**
 * Amend algo order (Stop order and Trigger order only)
 * @param {Object} params - Amendment parameters
 * @param {string} params.instId - Instrument ID
 * @param {string} params.algoId - Algo ID (optional if algoClOrdId is provided)
 * @param {string} params.algoClOrdId - Client-supplied algo ID (optional if algoId is provided)
 * @param {string} params.newSz - New quantity
 * @param {string} params.newTpTriggerPx - New TP trigger price
 * @param {string} params.newTpOrdPx - New TP order price
 * @param {string} params.newSlTriggerPx - New SL trigger price
 * @param {string} params.newSlOrdPx - New SL order price
 * @param {string} params.newTriggerPx - New trigger price (for trigger orders)
 * @param {string} params.newOrdPx - New order price (for trigger orders)
 * @param {boolean} params.cxlOnFail - Cancel order if amendment fails
 * @param {string} params.reqId - Client request ID
 * @param {string} apiKey - OKX API key
 * @param {string} apiSecret - OKX API secret
 * @param {string} passphrase - OKX passphrase
 * @param {string} baseUrl - OKX API base URL
 * @returns {Promise<Object>} Amendment result
 */
async function amendOkxAlgoOrder(params, apiKey, apiSecret, passphrase, baseUrl) {
  try {
    const requestPath = '/api/v5/trade/amend-algos';

    const body = {
      instId: params.instId
    };

    if (params.algoId) {
      body.algoId = params.algoId;
    } else if (params.algoClOrdId) {
      body.algoClOrdId = params.algoClOrdId;
    } else {
      throw new Error('Either algoId or algoClOrdId must be provided');
    }

    // Amendment parameters
    if (params.newSz) {
      body.newSz = params.newSz.toString();
    }
    if (params.newTpTriggerPx) {
      body.newTpTriggerPx = params.newTpTriggerPx.toString();
    }
    if (params.newTpOrdPx) {
      body.newTpOrdPx = params.newTpOrdPx.toString();
    }
    if (params.newSlTriggerPx) {
      body.newSlTriggerPx = params.newSlTriggerPx.toString();
    }
    if (params.newSlOrdPx) {
      body.newSlOrdPx = params.newSlOrdPx.toString();
    }
    if (params.newTpTriggerPxType) {
      body.newTpTriggerPxType = params.newTpTriggerPxType;
    }
    if (params.newSlTriggerPxType) {
      body.newSlTriggerPxType = params.newSlTriggerPxType;
    }
    if (params.newTriggerPx) {
      body.newTriggerPx = params.newTriggerPx.toString();
    }
    if (params.newOrdPx) {
      body.newOrdPx = params.newOrdPx.toString();
    }
    if (params.newTriggerPxType) {
      body.newTriggerPxType = params.newTriggerPxType;
    }
    if (params.cxlOnFail !== undefined) {
      body.cxlOnFail = params.cxlOnFail;
    }
    if (params.reqId) {
      body.reqId = params.reqId;
    }
    if (params.attachAlgoOrds) {
      body.attachAlgoOrds = params.attachAlgoOrds;
    }

    const response = await executeOkxRequestWithFallback({
      apiKey,
      apiSecret,
      passphrase,
      baseUrl,
      requestPath,
      method: 'POST',
      body: JSON.stringify(body)
    });

    if (response.data?.code === '0' && response.data?.data?.[0]) {
      const algoData = response.data.data[0];
      console.log(`✅ [OKX API] Algo order amended: ${algoData.algoId || algoData.algoClOrdId}`);
      return {
        success: true,
        algoId: algoData.algoId,
        algoClOrdId: algoData.algoClOrdId,
        reqId: algoData.reqId,
        sCode: algoData.sCode,
        sMsg: algoData.sMsg
      };
    } else {
      const errorMsg = response.data?.msg || 'Unknown error';
      console.log(`❌ [OKX API] Amend algo order failed: ${errorMsg}`);
      return {
        success: false,
        error: errorMsg,
        code: response.data?.code
      };
    }
  } catch (error) {
    console.log(`❌ [OKX API] Error amending algo order: ${error.message}`);
    throw error;
  }
}

/**
 * Get OKX ticker data (latest price, 24h stats) - No authentication required
 * @param {string} instId - Instrument ID (e.g., 'BTC-USDT-SWAP')
 * @param {string} baseUrl - OKX API base URL
 * @returns {Promise<Object>} Ticker data
 */
async function getOkxTicker(instId, baseUrl) {
  try {
    const requestPath = `/api/v5/market/ticker?instId=${instId}`;

    // Market data endpoints don't require authentication
    const response = await axios.get(`${baseUrl}${requestPath}`, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (response.data?.code === '0' && response.data?.data?.[0]) {
      const ticker = response.data.data[0];
      return {
        success: true,
        instId: ticker.instId,
        last: parseFloat(ticker.last || 0),
        askPx: parseFloat(ticker.askPx || 0),
        bidPx: parseFloat(ticker.bidPx || 0),
        open24h: parseFloat(ticker.open24h || 0),
        high24h: parseFloat(ticker.high24h || 0),
        low24h: parseFloat(ticker.low24h || 0),
        vol24h: parseFloat(ticker.vol24h || 0),
        volCcy24h: parseFloat(ticker.volCcy24h || 0),
        ts: parseInt(ticker.ts || 0)
      };
    } else {
      return {
        success: false,
        error: response.data?.msg || 'Unknown error'
      };
    }
  } catch (error) {
    console.log(`⚠️ [OKX API] Error getting ticker for ${instId}: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get OKX tickers for all instruments of a type - No authentication required
 * @param {string} instType - Instrument type ('SPOT', 'SWAP', 'FUTURES', 'OPTION')
 * @param {string} instFamily - Optional instrument family (for FUTURES/SWAP/OPTION)
 * @param {string} baseUrl - OKX API base URL
 * @returns {Promise<Array>} Array of ticker data
 */
async function getOkxTickers(instType, instFamily, baseUrl) {
  try {
    let requestPath = `/api/v5/market/tickers?instType=${instType}`;
    if (instFamily) {
      requestPath += `&instFamily=${instFamily}`;
    }

    const response = await axios.get(`${baseUrl}${requestPath}`, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (response.data?.code === '0' && response.data?.data) {
      return {
        success: true,
        tickers: response.data.data.map(ticker => ({
          instId: ticker.instId,
          last: parseFloat(ticker.last || 0),
          askPx: parseFloat(ticker.askPx || 0),
          bidPx: parseFloat(ticker.bidPx || 0),
          open24h: parseFloat(ticker.open24h || 0),
          high24h: parseFloat(ticker.high24h || 0),
          low24h: parseFloat(ticker.low24h || 0),
          vol24h: parseFloat(ticker.vol24h || 0),
          volCcy24h: parseFloat(ticker.volCcy24h || 0),
          ts: parseInt(ticker.ts || 0)
        }))
      };
    } else {
      return {
        success: false,
        error: response.data?.msg || 'Unknown error',
        tickers: []
      };
    }
  } catch (error) {
    console.log(`⚠️ [OKX API] Error getting tickers: ${error.message}`);
    return {
      success: false,
      error: error.message,
      tickers: []
    };
  }
}

/**
 * Get OKX candlesticks (OHLCV data) - No authentication required
 * @param {string} instId - Instrument ID (e.g., 'BTC-USDT-SWAP')
 * @param {string} bar - Bar size (e.g., '1m', '5m', '1H', '1D')
 * @param {string} limit - Number of candles (max 300, default 100)
 * @param {string} after - Pagination: return records earlier than this timestamp
 * @param {string} before - Pagination: return records newer than this timestamp
 * @param {string} baseUrl - OKX API base URL
 * @returns {Promise<Array>} Array of candlestick data
 */
async function getOkxCandles(instId, bar, limit, after, before, baseUrl) {
  try {
    let requestPath = `/api/v5/market/candles?instId=${instId}`;
    if (bar) requestPath += `&bar=${bar}`;
    if (limit) requestPath += `&limit=${limit}`;
    if (after) requestPath += `&after=${after}`;
    if (before) requestPath += `&before=${before}`;

    const response = await axios.get(`${baseUrl}${requestPath}`, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (response.data?.code === '0' && response.data?.data) {
      // Parse candlestick data: [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]
      const candles = response.data.data.map(candle => ({
        ts: parseInt(candle[0] || 0),
        open: parseFloat(candle[1] || 0),
        high: parseFloat(candle[2] || 0),
        low: parseFloat(candle[3] || 0),
        close: parseFloat(candle[4] || 0),
        volume: parseFloat(candle[5] || 0),
        volumeCcy: parseFloat(candle[6] || 0),
        volumeCcyQuote: parseFloat(candle[7] || 0),
        confirm: parseInt(candle[8] || 0) === 1
      }));

      return {
        success: true,
        candles: candles
      };
    } else {
      return {
        success: false,
        error: response.data?.msg || 'Unknown error',
        candles: []
      };
    }
  } catch (error) {
    console.log(`⚠️ [OKX API] Error getting candles for ${instId}: ${error.message}`);
    return {
      success: false,
      error: error.message,
      candles: []
    };
  }
}

/**
 * Get OKX order book - No authentication required
 * @param {string} instId - Instrument ID (e.g., 'BTC-USDT-SWAP')
 * @param {number} sz - Order book depth per side (max 400, default 1)
 * @param {string} baseUrl - OKX API base URL
 * @returns {Promise<Object>} Order book data
 */
async function getOkxOrderBook(instId, sz, baseUrl) {
  try {
    let requestPath = `/api/v5/market/books?instId=${instId}`;
    if (sz) requestPath += `&sz=${sz}`;

    const response = await axios.get(`${baseUrl}${requestPath}`, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (response.data?.code === '0' && response.data?.data?.[0]) {
      const book = response.data.data[0];
      // Parse order book: asks/bids are arrays of [price, size, deprecated, orderCount]
      const asks = (book.asks || []).map(ask => ({
        price: parseFloat(ask[0] || 0),
        size: parseFloat(ask[1] || 0),
        orderCount: parseInt(ask[3] || 0)
      }));

      const bids = (book.bids || []).map(bid => ({
        price: parseFloat(bid[0] || 0),
        size: parseFloat(bid[1] || 0),
        orderCount: parseInt(bid[3] || 0)
      }));

      return {
        success: true,
        asks: asks,
        bids: bids,
        ts: parseInt(book.ts || 0),
        bestAsk: asks.length > 0 ? asks[0].price : null,
        bestBid: bids.length > 0 ? bids[0].price : null,
        spread: asks.length > 0 && bids.length > 0 ? asks[0].price - bids[0].price : null
      };
    } else {
      return {
        success: false,
        error: response.data?.msg || 'Unknown error'
      };
    }
  } catch (error) {
    console.log(`⚠️ [OKX API] Error getting order book for ${instId}: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get OKX recent trades - No authentication required
 * @param {string} instId - Instrument ID (e.g., 'BTC-USDT-SWAP')
 * @param {number} limit - Number of trades (max 500, default 100)
 * @param {string} baseUrl - OKX API base URL
 * @returns {Promise<Array>} Array of trade data
 */
async function getOkxTrades(instId, limit, baseUrl) {
  try {
    let requestPath = `/api/v5/market/trades?instId=${instId}`;
    if (limit) requestPath += `&limit=${limit}`;

    const response = await axios.get(`${baseUrl}${requestPath}`, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (response.data?.code === '0' && response.data?.data) {
      const trades = response.data.data.map(trade => ({
        instId: trade.instId,
        tradeId: trade.tradeId,
        price: parseFloat(trade.px || 0),
        size: parseFloat(trade.sz || 0),
        side: trade.side,
        ts: parseInt(trade.ts || 0)
      }));

      return {
        success: true,
        trades: trades
      };
    } else {
      return {
        success: false,
        error: response.data?.msg || 'Unknown error',
        trades: []
      };
    }
  } catch (error) {
    console.log(`⚠️ [OKX API] Error getting trades for ${instId}: ${error.message}`);
    return {
      success: false,
      error: error.message,
      trades: []
    };
  }
}

/**
 * Verify OKX account mode and SWAP instrument access
 * This function checks if the account is configured correctly for derivatives trading
 * Uses the account config endpoint for direct account mode detection
 * @param {string} apiKey - OKX API key
 * @param {string} apiSecret - OKX API secret
 * @param {string} passphrase - OKX passphrase
 * @param {string} baseUrl - OKX API base URL
 * @returns {Promise<Object>} Account mode verification result
 */
async function verifyOkxAccountMode(apiKey, apiSecret, passphrase, baseUrl) {
  try {
    console.log('🔍 [OKX API] Verifying account mode and derivatives access...');

    // 1. Get account configuration (direct account mode detection)
    const accountConfig = await getOkxAccountConfig(apiKey, apiSecret, passphrase, baseUrl);

    let detectedMode = 'Unknown';
    let supportsDerivatives = false;
    let acctLv = null;
    let posMode = null;

    if (accountConfig) {
      acctLv = accountConfig.acctLv;
      posMode = accountConfig.posMode;

      // Map account level to mode name
      const modeMap = {
        '1': 'Spot mode (NOT SUPPORTED for derivatives)',
        '2': 'Futures mode',
        '3': 'Multi-currency margin',
        '4': 'Portfolio margin'
      };

      detectedMode = modeMap[acctLv] || 'Unknown mode';
      supportsDerivatives = acctLv === '2' || acctLv === '3' || acctLv === '4';

      console.log(`📊 [OKX API] Account Level (acctLv): ${acctLv} - ${detectedMode}`);
      console.log(`📊 [OKX API] Position Mode: ${posMode || 'N/A'}`);
    } else {
      // Fallback: Check balance endpoint if config fails
      console.log(`⚠️ [OKX API] Account config unavailable, falling back to balance endpoint...`);
      const balancePath = '/api/v5/account/balance';
      const balanceResponse = await executeOkxRequestWithFallback({
        apiKey,
        apiSecret,
        passphrase,
        baseUrl,
        requestPath: balancePath,
        method: 'GET'
      });

      if (balanceResponse.data?.code === '0') {
        const accountData = balanceResponse.data?.data?.[0] || {};
        const hasNotionalUsdForSwap = accountData.notionalUsdForSwap !== undefined && accountData.notionalUsdForSwap !== '';
        const hasIsoEq = accountData.isoEq !== undefined && accountData.isoEq !== '';

        if (hasNotionalUsdForSwap) {
          detectedMode = 'Multi-currency margin or Portfolio margin (detected via balance)';
          supportsDerivatives = true;
        } else if (hasIsoEq) {
          detectedMode = 'Futures mode (detected via balance)';
          supportsDerivatives = true;
        } else {
          detectedMode = 'Spot mode (NOT SUPPORTED for derivatives) - detected via balance';
          supportsDerivatives = false;
        }
      }
    }

    // 2. Check if SWAP instruments are accessible
    const instrumentsPath = '/api/v5/account/instruments?instType=SWAP';
    let canAccessSwap = false;
    let swapInstrumentsCount = 0;
    let instrumentsError = null;

    try {
      const instrumentsResponse = await executeOkxRequestWithFallback({
        apiKey,
        apiSecret,
        passphrase,
        baseUrl,
        requestPath: instrumentsPath,
        method: 'GET'
      });

      if (instrumentsResponse.data?.code === '0') {
        const swapInstruments = instrumentsResponse.data?.data || [];
        swapInstrumentsCount = swapInstruments.length;
        canAccessSwap = swapInstrumentsCount > 0;
      } else {
        instrumentsError = instrumentsResponse.data?.msg || 'Unknown error';
      }
    } catch (error) {
      instrumentsError = error.message;
    }

    // Final verification: derivatives support requires both account mode and instrument access
    const finalSupportsDerivatives = supportsDerivatives && canAccessSwap;

    // If account doesn't support derivatives, get detailed diagnostics via precheck
    let switchPrecheck = null;
    let actionableSteps = [];

    if (!finalSupportsDerivatives && acctLv) {
      // Try to get precheck for switching to Futures mode (2) or Multi-currency margin (3)
      // Start with Futures mode as it's simpler
      try {
        switchPrecheck = await checkOkxAccountModeSwitchPrecheck('2', apiKey, apiSecret, passphrase, baseUrl);

        if (!switchPrecheck || switchPrecheck.sCode === '51070') {
          // Try Multi-currency margin as alternative
          switchPrecheck = await checkOkxAccountModeSwitchPrecheck('3', apiKey, apiSecret, passphrase, baseUrl);
        }

        if (switchPrecheck) {
          const sCode = switchPrecheck.sCode || '0';

          // Build actionable steps based on precheck results
          if (sCode === '51070' || switchPrecheck.requiresWebApp) {
            actionableSteps.push('Complete Q&A on OKX website/app to enable account mode switching');
          } else if (sCode === '1') {
            // Unmatched information
            const unmatchedInfo = switchPrecheck.unmatchedInfoCheck || [];
            unmatchedInfo.forEach(info => {
              const type = info.type || '';
              const typeMap = {
                'repay_borrowings': 'Repay all borrowings before switching',
                'pending_orders': 'Cancel all pending orders',
                'pending_algos': 'Cancel all pending algo orders (iceberg, TWAP, etc.)',
                'isolated_margin': 'Close or convert isolated margin positions',
                'isolated_contract': 'Close or convert isolated contract positions',
                'cross_margin': 'Close or convert cross margin positions',
                'asset_validation': 'Resolve asset validation issues',
                'all_positions': 'Close all positions before switching'
              };

              const step = typeMap[type] || `Resolve ${type.replace(/_/g, ' ')} issues`;
              if (info.totalAsset) {
                actionableSteps.push(`${step} (Total assets: ${info.totalAsset})`);
              } else {
                actionableSteps.push(step);
              }
            });
          } else if (sCode === '3') {
            // Leverage not set
            const posList = switchPrecheck.posList || [];
            if (posList.length > 0) {
              actionableSteps.push(`Set leverage for ${posList.length} cross-margin position(s) before switching`);
            } else {
              actionableSteps.push('Preset leverage for cross-margin positions before switching');
            }
          } else if (sCode === '4') {
            // Position tier check failed
            const posTierCheck = switchPrecheck.posTierCheck || [];
            if (posTierCheck.length > 0) {
              actionableSteps.push(`Reduce position sizes for ${posTierCheck.length} instrument(s) that exceed tier limits`);
            } else {
              actionableSteps.push('Reduce position sizes to meet tier requirements');
            }
          } else if (sCode === '0') {
            // Can switch - show margin impact
            if (switchPrecheck.mgnBf && switchPrecheck.mgnAft) {
              const mgnRatioBf = parseFloat(switchPrecheck.mgnBf.mgnRatio || 0);
              const mgnRatioAft = parseFloat(switchPrecheck.mgnAft.mgnRatio || 0);
              actionableSteps.push(`Margin ratio will change from ${mgnRatioBf.toFixed(2)}% to ${mgnRatioAft.toFixed(2)}%`);
            }
            actionableSteps.push('Account mode switch is ready - you can switch via OKX Web/App');
          }
        }
      } catch (precheckError) {
        console.log(`⚠️ [OKX API] Could not get switch precheck: ${precheckError.message}`);
      }
    }

    // Build recommendation with actionable steps
    let recommendation = '';
    if (finalSupportsDerivatives) {
      recommendation = '✅ Account mode supports derivatives trading. You can place SWAP orders.';
    } else {
      recommendation = '❌ Account mode does NOT support derivatives.';

      if (actionableSteps.length > 0) {
        recommendation += '\n\n📋 Actionable Steps to Enable Derivatives:';
        actionableSteps.forEach((step, index) => {
          recommendation += `\n   ${index + 1}. ${step}`;
        });
        recommendation += '\n\n💡 After completing these steps, switch to Futures mode, Multi-currency margin, or Portfolio margin mode via OKX Web/App interface (Trade → Futures → Settings → Trading Mode).';
      } else {
        recommendation += ' Switch to Futures mode, Multi-currency margin, or Portfolio margin mode via OKX Web/App interface (Trade → Futures → Settings → Trading Mode).';
      }
    }

    console.log(`📊 [OKX API] Account mode detected: ${detectedMode}`);
    console.log(`📊 [OKX API] Derivatives support: ${finalSupportsDerivatives ? '✅ Yes' : '❌ No'}`);
    console.log(`📊 [OKX API] SWAP instruments accessible: ${canAccessSwap ? `✅ Yes (${swapInstrumentsCount} instruments)` : '❌ No'}`);

    if (switchPrecheck && !finalSupportsDerivatives) {
      console.log(`📊 [OKX API] Switch precheck status: ${switchPrecheck.sCode || 'N/A'}`);
      if (actionableSteps.length > 0) {
        console.log(`📊 [OKX API] Actionable steps: ${actionableSteps.length} item(s) found`);
      }
    }

    return {
      success: true,
      accountMode: detectedMode,
      accountLevel: acctLv,
      positionMode: posMode,
      supportsDerivatives: finalSupportsDerivatives,
      canAccessSwapInstruments: canAccessSwap,
      swapInstrumentsCount: swapInstrumentsCount,
      config: accountConfig ? {
        acctLv: accountConfig.acctLv,
        posMode: accountConfig.posMode,
        perm: accountConfig.perm,
        uid: accountConfig.uid
      } : null,
      switchPrecheck: switchPrecheck ? {
        sCode: switchPrecheck.sCode,
        curAcctLv: switchPrecheck.curAcctLv,
        acctLv: switchPrecheck.acctLv,
        unmatchedInfoCheck: switchPrecheck.unmatchedInfoCheck || [],
        posList: switchPrecheck.posList || [],
        posTierCheck: switchPrecheck.posTierCheck || [],
        mgnBf: switchPrecheck.mgnBf,
        mgnAft: switchPrecheck.mgnAft
      } : null,
      actionableSteps: actionableSteps,
      instrumentsError: instrumentsError,
      recommendation: recommendation
    };
  } catch (error) {
    console.log(`❌ [OKX API] Error verifying account mode: ${error.message}`);
    return {
      success: false,
      error: error.message,
      recommendation: 'Failed to verify account mode. Check API credentials and network connection.'
    };
  }
}

/**
 * Execute a market order on Bybit (Spot Trading)
 * @param {string} symbol - Trading pair symbol (e.g., 'BTCUSDT')
 * @param {string} side - 'Buy' or 'Sell' (Bybit uses capitalized)
 * @param {number} quantity - Amount to trade
 * @param {string} apiKey - Bybit API key
 * @param {string} apiSecret - Bybit API secret
 * @param {string} baseUrl - Bybit API base URL (testnet or mainnet)
 * @returns {Promise<Object>} Order result
 */
async function executeBybitMarketOrder(symbol, side, quantity, apiKey, apiSecret, baseUrl) {
  try {
    const timestamp = Date.now();
    const recvWindow = 5000; // 5 second receive window

    // Bybit Spot API parameters (v5 format)
    const params = {
      category: 'spot',
      symbol: symbol,
      side: side, // 'Buy' or 'Sell'
      orderType: 'Market',
      qty: quantity.toString(),
      timestamp: timestamp.toString(),
      recvWindow: recvWindow.toString()
    };

    // Use automatic fallback helper (ScrapeOps → ScraperAPI → Direct)
    console.log(`🔵 [BYBIT API] Sending order: ${side} ${quantity} ${symbol} (Market)`);
    console.log(`🔵 [BYBIT API] API Key: ${apiKey.substring(0, 8)}... (verifying permissions)`);

    const response = await executeBybitRequestWithFallback({
      apiKey,
      apiSecret,
      baseUrl,
      endpoint: '/v5/order/create',
      method: 'POST',
      requestParams: params,
      body: { ...params, signature: generateBybitSignature(params, apiSecret) }
    });

    // Log full response for debugging
    console.log(`🔵 [BYBIT API] Response status: ${response.status}`);
    console.log(`🔵 [BYBIT API] Response data:`, JSON.stringify(response.data).substring(0, 500));

    if (response.data && response.data.retCode === 0 && response.data.result) {
      const order = response.data.result;
      console.log(`✅ [BYBIT API] Order executed successfully!`);
      console.log(`   Order ID: ${order.orderId}`);
      console.log(`   Symbol: ${order.symbol}`);
      console.log(`   Side: ${order.side}`);
      console.log(`   Quantity: ${order.executedQty || order.qty}`);
      console.log(`   Price: ${order.avgPrice || order.price}`);
      console.log(`   Status: ${order.orderStatus}`);

      return {
        success: true,
        orderId: order.orderId,
        symbol: order.symbol,
        side: order.side,
        executedQty: parseFloat(order.executedQty || order.qty || 0),
        price: parseFloat(order.avgPrice || order.price || 0),
        status: order.orderStatus,
        mode: 'BYBIT',
        data: response.data
      };
    } else {
      // Enhanced error handling
      const errorMsg = response.data?.retMsg || response.data?.message || 'Unknown error';
      const errorCode = response.data?.retCode || response.status || 0;

      console.log(`❌ [BYBIT API] Order failed: ${errorMsg} (Code: ${errorCode})`);
      console.log(`   Full response:`, JSON.stringify(response.data).substring(0, 500));

      // Check for common error patterns
      if (response.data && typeof response.data === 'string') {
        if (response.data.includes('<!DOCTYPE')) {
          if (response.data.includes('CloudFront') || response.data.includes('block access from your country')) {
            console.log(`   ⚠️ GEO-BLOCKING DETECTED: CloudFront is blocking your server's country/region`);
            console.log(`   💡 This is NOT an API key issue - it's a network geo-blocking issue`);
            console.log(`   💡 Solutions:`);
            console.log(`      1. Deploy to a server in a different country/region (US, EU, Singapore)`);
            console.log(`      2. Use a VPN or proxy service to route requests`);
            console.log(`      3. Contact Bybit support about geo-restrictions`);
            console.log(`      4. Check if your hosting provider offers different regions`);
            console.log(`   💡 Your server IP is being blocked by CloudFront, not Bybit API`);
          } else {
            console.log(`   ⚠️ HTML response detected - CDN/Cloudflare blocking`);
          }
        }
      }

      if (errorCode === 0 && !response.data) {
        console.log(`   ⚠️ Empty response - possible network issue or timeout`);
      }

      return {
        success: false,
        error: errorMsg,
        code: errorCode,
        rawResponse: response.data
      };
    }
  } catch (error) {
    // Enhanced error logging
    console.log(`❌ [BYBIT API] Order execution exception caught`);
    console.log(`   Error type: ${error.name || 'Unknown'}`);
    console.log(`   Error message: ${error.message}`);

    if (error.response) {
      console.log(`   Response status: ${error.response.status}`);
      console.log(`   Response headers:`, JSON.stringify(error.response.headers).substring(0, 300));
      console.log(`   Response data:`, JSON.stringify(error.response.data).substring(0, 500));
    } else if (error.request) {
      console.log(`   No response received - request made but no answer`);
      console.log(`   Request config:`, JSON.stringify({
        url: error.config?.url,
        method: error.config?.method,
        timeout: error.config?.timeout
      }));
    }

    const errorMsg = error.response?.data?.retMsg || error.response?.data?.message || error.message;
    const errorCode = error.response?.data?.retCode || error.response?.status || 0;

    console.log(`❌ [BYBIT API] Order execution error: ${errorMsg} (Code: ${errorCode})`);

    // Detailed diagnostics for common errors
    if (errorCode === 403 || error.response?.status === 403) {
      console.log(`   💡 403 Forbidden - Possible causes:`);
      console.log(`   1. API key doesn't have 'Write' or 'Trade' permissions`);
      console.log(`   2. API key is from mainnet but using testnet (or vice versa)`);
      console.log(`   3. IP address not whitelisted (if IP whitelist is enabled)`);
      console.log(`   4. Invalid API key or secret`);
      console.log(`   5. API key doesn't have 'Spot Trading' scope enabled`);
      console.log(`   💡 Check: https://testnet.bybit.com → Profile → API Management`);
      console.log(`   💡 Required: Read-Write permissions + Spot Trading scope`);
    } else if (errorCode === 401 || error.response?.status === 401) {
      console.log(`   💡 401 Unauthorized - Invalid API key or signature`);
      console.log(`   💡 Verify: API key and secret are correct`);
    } else if (errorCode === 10001) {
      console.log(`   💡 10001 - Invalid API key`);
    } else if (errorCode === 10002) {
      console.log(`   💡 10002 - Invalid signature`);
    } else if (errorCode === 10003) {
      console.log(`   💡 10003 - Request timestamp expired`);
    } else if (errorCode === 10004) {
      console.log(`   💡 10004 - Invalid request parameter`);
    }

    if (error.response?.data) {
      const responseData = JSON.stringify(error.response.data);
      console.log(`   Full Response: ${responseData.substring(0, 400)}`);
    }

    return {
      success: false,
      error: errorMsg,
      code: errorCode
    };
  }
}

/**
 * Execute a market order on Binance (legacy, kept for compatibility)
 */
async function executeMarketOrder(symbol, side, quantity, apiKey, apiSecret) {
  try {
    const timestamp = Date.now();
    const params = {
      symbol: symbol,
      side: side,
      type: 'MARKET',
      quantity: quantity.toString(),
      timestamp: timestamp
    };

    const queryString = Object.keys(params)
      .map(key => `${key}=${params[key]}`)
      .join('&');

    const signature = generateSignature(queryString, apiSecret);

    const response = await axios.post(
      'https://api.binance.com/api/v3/order',
      null,
      {
        params: {
          ...params,
          signature: signature
        },
        headers: {
          'X-MBX-APIKEY': apiKey
        },
        timeout: 10000
      }
    );

    return {
      success: true,
      orderId: response.data.orderId,
      symbol: response.data.symbol,
      side: response.data.side,
      executedQty: parseFloat(response.data.executedQty),
      price: parseFloat(response.data.price || response.data.fills?.[0]?.price || 0),
      status: response.data.status,
      data: response.data
    };
  } catch (error) {
    return {
      success: false,
      error: error.response?.data?.msg || error.message,
      code: error.response?.status || 0
    };
  }
}


/**
 * Get account balance for a specific asset (Bybit or legacy Binance)
 * @param {string} asset - Asset symbol (e.g., 'USDT', 'BTC')
 * @param {string} apiKey - API key
 * @param {string} apiSecret - API secret
 * @returns {Promise<number>} Available balance
 */
async function getBalance(asset, apiKey, apiSecret) {
  const exchange = getPreferredExchange();

  if (exchange.exchange === 'OKX' && exchange.baseUrl) {
    return await getOkxBalance(asset, apiKey, apiSecret, exchange.passphrase, exchange.baseUrl);
  }

  // No exchange configured
  console.log(`⚠️ Failed to get balance for ${asset}: No exchange configured`);
  return 0;
}

/**
 * Validate price is reasonable for the coin (prevents wrong coin data)
 * @param {string} symbol - Coin symbol
 * @param {number} price - Price to validate
 * @returns {boolean} True if price is valid
 */
function validatePrice(symbol, price) {
  const ranges = {
    'BTC': { min: 1000, max: 200000 },
    'ETH': { min: 100, max: 10000 },
    'BNB': { min: 10, max: 2000 },
    'SOL': { min: 1, max: 500 },
    'XRP': { min: 0.01, max: 10 },
    'DOGE': { min: 0.001, max: 1 },
    'ADA': { min: 0.01, max: 10 },
    'AVAX': { min: 1, max: 200 },
    'LINK': { min: 1, max: 100 },
    'DOT': { min: 0.1, max: 100 }
  };

  const range = ranges[symbol];
  if (!range) return price > 0 && price < 1000000; // Generic validation

  return price >= range.min && price <= range.max;
}

/**
 * Calculate trade quantity based on position size
 * @param {string} symbol - Coin symbol (e.g., 'BTC')
 * @param {number} price - Current price
 * @param {number} positionSizeUSD - Position size in USD
 * @returns {number} Quantity to trade
 */
function calculateQuantity(symbol, price, positionSizeUSD) {
  // Use portfolio-based position size if not specified
  let size = positionSizeUSD;
  if (!size || size <= 0) {
    const { getPortfolio } = require('./portfolioService');
    const portfolio = getPortfolio();
    const portfolioValue = portfolio.currentBalance || portfolio.initialCapital || 5000;
    size = portfolioValue * 0.015; // 1.5% of portfolio (default)
  }

  // Calculate quantity
  const quantity = size / price;

  // Round to appropriate decimal places based on symbol
  // Most cryptos use 4-8 decimal places
  const decimals = symbol === 'BTC' ? 6 : symbol === 'ETH' ? 4 : 2;

  return Math.floor(quantity * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

/**
 * Execute Take Profit order via OKX
 * @param {Object} trade - Trade object
 * @returns {Promise<Object>} Execution result
 */
async function executeTakeProfit(trade) {
  const config = isExchangeTradingEnabled();

  if (!config.enabled) {
    return {
      success: false,
      error: 'Trading not enabled. Please configure OKX_API_KEY, OKX_API_SECRET, OKX_PASSPHRASE (or BYBIT_API_KEY and BYBIT_API_SECRET) for demo trading.',
      skipped: true
    };
  }

  const exchange = getPreferredExchange();

  // Validate price before execution (prevent wrong coin data)
  if (!validatePrice(trade.symbol, trade.currentPrice)) {
    return {
      success: false,
      error: `Invalid price for ${trade.symbol}: $${trade.currentPrice.toFixed(2)}. Price validation failed - likely wrong coin data.`,
      skipped: true
    };
  }

  // For BUY positions: Sell to take profit
  // For SELL positions: Buy to cover (take profit)
  const side = trade.action === 'BUY' ? 'sell' : 'buy';

  // Use trade quantity directly (already calculated based on portfolio size)
  // Fallback to portfolio-based calculation if quantity not available
  let quantity = trade.quantity || trade.executedQty || trade.okxExecutedQuantity;

  if (!quantity || quantity <= 0) {
    // Fallback: Calculate from portfolio-based position size
    const { getPortfolio } = require('./portfolioService');
    const portfolio = getPortfolio();
    const portfolioValue = portfolio.currentBalance || portfolio.initialCapital || 5000;
    const positionSizeUSD = portfolioValue * 0.015; // 1.5% of portfolio
    quantity = calculateQuantity(trade.symbol, trade.currentPrice, positionSizeUSD);
  }

  if (quantity <= 0) {
    return {
      success: false,
      error: 'Invalid quantity calculated'
    };
  }

  const okxSymbol = OKX_SYMBOL_MAP[trade.symbol];
  if (!okxSymbol) {
    return {
      success: false,
      error: `Symbol ${trade.symbol} not available on OKX`
    };
  }

  const modeLabel = 'OKX_DEMO';
  const leverage = parseFloat(process.env.OKX_LEVERAGE || '1'); // Default 1x leverage
  console.log(`📈 Executing TAKE PROFIT (${modeLabel}): ${side} ${quantity} ${trade.symbol} at $${trade.currentPrice.toFixed(2)} (Leverage: ${leverage}x)`);

  return await executeOkxMarketOrder(
    okxSymbol,
    side,
    quantity,
    exchange.apiKey,
    exchange.apiSecret,
    exchange.passphrase,
    exchange.baseUrl,
    leverage,
    true  // reduceOnly = true for Take Profit
  );
}

/**
 * Execute Stop Loss order via OKX
 * @param {Object} trade - Trade object
 * @returns {Promise<Object>} Execution result
 */
async function executeStopLoss(trade) {
  const config = isExchangeTradingEnabled();

  if (!config.enabled) {
    return {
      success: false,
      error: 'Trading not enabled. Please configure OKX_API_KEY, OKX_API_SECRET, OKX_PASSPHRASE (or BYBIT_API_KEY and BYBIT_API_SECRET) for demo trading.',
      skipped: true
    };
  }

  const exchange = getPreferredExchange();

  // Validate price before execution (prevent wrong coin data)
  if (!validatePrice(trade.symbol, trade.currentPrice)) {
    return {
      success: false,
      error: `Invalid price for ${trade.symbol}: $${trade.currentPrice.toFixed(2)}. Price validation failed - likely wrong coin data.`,
      skipped: true
    };
  }

  // For BUY positions: Sell to stop loss
  // For SELL positions: Buy to cover (stop loss)
  const side = trade.action === 'BUY' ? 'sell' : 'buy';

  // Use trade quantity directly (already calculated based on portfolio size)
  // Fallback to portfolio-based calculation if quantity not available
  let quantity = trade.quantity || trade.executedQty || trade.okxExecutedQuantity;

  if (!quantity || quantity <= 0) {
    // Fallback: Calculate from portfolio-based position size
    const { getPortfolio } = require('./portfolioService');
    const portfolio = getPortfolio();
    const portfolioValue = portfolio.currentBalance || portfolio.initialCapital || 5000;
    const positionSizeUSD = portfolioValue * 0.015; // 1.5% of portfolio
    quantity = calculateQuantity(trade.symbol, trade.currentPrice, positionSizeUSD);
  }

  if (quantity <= 0) {
    return {
      success: false,
      error: 'Invalid quantity calculated'
    };
  }

  const okxSymbol = OKX_SYMBOL_MAP[trade.symbol];
  if (!okxSymbol) {
    return {
      success: false,
      error: `Symbol ${trade.symbol} not available on OKX`
    };
  }

  const modeLabel = 'OKX_DEMO';
  const leverage = parseFloat(process.env.OKX_LEVERAGE || '1'); // Default 1x leverage
  console.log(`🛑 Executing STOP LOSS (${modeLabel}): ${side} ${quantity} ${trade.symbol} at $${trade.currentPrice.toFixed(2)} (Leverage: ${leverage}x)`);

  return await executeOkxMarketOrder(
    okxSymbol,
    side,
    quantity,
    exchange.apiKey,
    exchange.apiSecret,
    exchange.passphrase,
    exchange.baseUrl,
    leverage,
    true  // reduceOnly = true for Stop Loss
  );
}

/**
 * Execute Add Position (DCA) order via OKX
 * @param {Object} trade - Trade object
 * @returns {Promise<Object>} Execution result
 */
async function executeAddPosition(trade) {
  const config = isExchangeTradingEnabled();

  if (!config.enabled) {
    return {
      success: false,
      error: 'Trading not enabled. Please configure OKX_API_KEY, OKX_API_SECRET, and OKX_PASSPHRASE for demo trading.',
      skipped: true
    };
  }

  const exchange = getPreferredExchange();

  // Validate price before execution (prevent wrong coin data)
  if (!validatePrice(trade.symbol, trade.currentPrice)) {
    return {
      success: false,
      error: `Invalid price for ${trade.symbol}: $${trade.currentPrice.toFixed(2)}. Price validation failed - likely wrong coin data.`,
      skipped: true
    };
  }

  // For BUY positions: Buy more (average down)
  // For SELL positions: Sell more (average up)
  const side = trade.action === 'BUY' ? 'buy' : 'sell';

  // Calculate quantity for DCA using portfolio service (percentage-based)
  const { getDCASize, getPortfolio } = require('./portfolioService');
  const dcaCount = trade.dcaCount || 0; // Get current DCA count
  const dcaSizeUSD = getDCASize(dcaCount); // Calculate DCA size based on count and portfolio value
  const portfolio = getPortfolio();
  const portfolioValue = portfolio.currentBalance || portfolio.initialCapital || 5000;
  console.log(`💰 DCA #${dcaCount + 1} sizing: $${dcaSizeUSD.toFixed(2)} (${((dcaSizeUSD / portfolioValue) * 100).toFixed(2)}% of portfolio)`);
  const quantity = calculateQuantity(trade.symbol, trade.currentPrice, dcaSizeUSD);

  if (quantity <= 0) {
    return {
      success: false,
      error: 'Invalid quantity calculated'
    };
  }

  const okxSymbol = OKX_SYMBOL_MAP[trade.symbol];
  if (!okxSymbol) {
    return {
      success: false,
      error: `Symbol ${trade.symbol} not available on OKX`
    };
  }

  const modeLabel = 'OKX_DEMO';
  const leverage = parseFloat(process.env.OKX_LEVERAGE || '1'); // Default 1x leverage
  console.log(`💰 Executing ADD POSITION (DCA) (${modeLabel}): ${side} ${quantity} ${trade.symbol} at $${trade.currentPrice.toFixed(2)} (Leverage: ${leverage}x)`);

  return await executeOkxMarketOrder(
    okxSymbol,
    side,
    quantity,
    exchange.apiKey,
    exchange.apiSecret,
    exchange.passphrase,
    exchange.baseUrl,
    leverage
  );
}

/**
 * Get Bybit account balance (for demo trading)
 * @param {string} asset - Asset symbol (e.g., 'USDT', 'BTC')
 * @param {string} apiKey - Bybit API key
 * @param {string} apiSecret - Bybit API secret
 * @param {string} baseUrl - Bybit API base URL
 * @returns {Promise<number>} Available balance
 */
async function getBybitBalance(asset, apiKey, apiSecret, baseUrl) {
  try {
    const timestamp = Date.now();
    const recvWindow = 5000;

    const params = {
      accountType: 'SPOT',
      timestamp: timestamp.toString(),
      recvWindow: recvWindow.toString()
    };

    // Use automatic fallback helper (ScrapeOps → ScraperAPI → Direct)
    const response = await executeBybitRequestWithFallback({
      apiKey,
      apiSecret,
      baseUrl,
      endpoint: '/v5/account/wallet-balance',
      method: 'GET',
      requestParams: params
    });

    if (response.data && response.data.retCode === 0 && response.data.result) {
      const spot = response.data.result.list?.[0]?.coin?.find(c => c.coin === asset);
      return spot ? parseFloat(spot.availableToWithdraw || spot.free || 0) : 0;
    }
    return 0;
  } catch (error) {
    // Error already logged by fallback helper
    console.log(`⚠️ Failed to get Bybit balance for ${asset}: ${error.message}`);
    return 0;
  }
}

/**
 * Get open positions from Bybit Spot Trading
 * Returns actual positions held on Bybit exchange
 * @param {string} apiKey - Bybit API key
 * @param {string} apiSecret - Bybit API secret
 * @param {string} baseUrl - Bybit API base URL
 * @returns {Promise<Array>} Array of open positions {coin, quantity, value}
 */
async function getBybitOpenPositions(apiKey, apiSecret, baseUrl) {
  try {
    const timestamp = Date.now();
    const recvWindow = 5000;

    // Bybit v5 wallet-balance parameters
    const params = {
      accountType: 'SPOT',
      timestamp: timestamp.toString(),
      recvWindow: recvWindow.toString()
    };

    // Use automatic fallback helper (ScrapeOps → ScraperAPI → Direct)
    console.log(`🔵 [BYBIT API] Fetching open positions from ${baseUrl}/v5/account/wallet-balance`);
    console.log(`🔵 [BYBIT API] Params: accountType=SPOT, timestamp=${timestamp}, recvWindow=${recvWindow}`);
    console.log(`🔵 [BYBIT API] API Key: ${apiKey.substring(0, 8)}... (checking permissions)`);

    const response = await executeBybitRequestWithFallback({
      apiKey,
      apiSecret,
      baseUrl,
      endpoint: '/v5/account/wallet-balance',
      method: 'GET',
      requestParams: params
    });

    if (response.data && response.data.retCode === 0 && response.data.result) {
      const coins = response.data.result.list?.[0]?.coin || [];
      const positions = [];

      // Filter for coins with non-zero balance (actual positions)
      coins.forEach(coin => {
        const free = parseFloat(coin.free || 0);
        const locked = parseFloat(coin.locked || 0);
        const total = free + locked;

        // Only include coins with actual holdings (exclude USDT and zero balances)
        if (total > 0.00000001 && coin.coin !== 'USDT') {
          positions.push({
            coin: coin.coin,
            symbol: coin.coin, // For compatibility
            quantity: total,
            free: free,
            locked: locked,
            availableToWithdraw: parseFloat(coin.availableToWithdraw || 0),
            usdValue: parseFloat(coin.usdValue || 0) // If Bybit provides USD value
          });
        }
      });

      if (positions.length > 0) {
        console.log(`✅ [BYBIT API] Found ${positions.length} open positions on Bybit:`);
        positions.forEach(pos => {
          console.log(`   - ${pos.coin}: ${pos.quantity.toFixed(8)} (Free: ${pos.free.toFixed(8)}, Locked: ${pos.locked.toFixed(8)})`);
        });
      } else {
        console.log(`✅ [BYBIT API] No open positions found on Bybit (all positions closed or zero balance)`);
      }

      return positions;
    } else {
      const errorMsg = response.data?.retMsg || 'Unknown error';
      console.log(`⚠️ [BYBIT API] Failed to get positions: ${errorMsg}`);
      return [];
    }
  } catch (error) {
    // Error already logged by fallback helper
    const errorMsg = error.response?.data?.retMsg || error.message;
    console.log(`❌ [BYBIT API] Error fetching positions: ${errorMsg}`);

    // Return empty array on error - caller should handle gracefully
    // Don't mark trades as closed if we can't verify positions
    return [];
  }
}

/**
 * Get open orders from Bybit (pending orders)
 * @param {string} apiKey - Bybit API key
 * @param {string} apiSecret - Bybit API secret
 * @param {string} baseUrl - Bybit API base URL
 * @returns {Promise<Array>} Array of open orders
 */
async function getBybitOpenOrders(apiKey, apiSecret, baseUrl) {
  try {
    const timestamp = Date.now();
    const recvWindow = 5000;

    const params = {
      category: 'spot',
      timestamp: timestamp.toString(),
      recvWindow: recvWindow.toString()
    };

    // Use automatic fallback helper (ScrapeOps → ScraperAPI → Direct)
    const response = await executeBybitRequestWithFallback({
      apiKey,
      apiSecret,
      baseUrl,
      endpoint: '/v5/order/realtime',
      method: 'GET',
      requestParams: params
    });

    if (response.data && response.data.retCode === 0 && response.data.result) {
      const orders = response.data.result.list || [];
      return orders.filter(order =>
        order.orderStatus === 'New' ||
        order.orderStatus === 'PartiallyFilled'
      );
    }
    return [];
  } catch (error) {
    console.log(`⚠️ Failed to get Bybit open orders: ${error.message}`);
    return [];
  }
}


/**
 * Get pending orders for an instrument
 * @param {string} instId - Instrument ID (e.g., 'BTC-USDT-SWAP')
 * @param {string} apiKey - OKX API key
 * @param {string} apiSecret - OKX API secret
 * @param {string} passphrase - OKX passphrase
 * @param {string} baseUrl - OKX API base URL
 * @returns {Promise<Object>} Pending orders list
 */
async function getOkxPendingOrders(instId, apiKey, apiSecret, passphrase, baseUrl, instType = 'SWAP') {
  try {
    const requestPath = '/api/v5/trade/orders-pending';

    const params = {};
    if (instId) {
      params.instId = instId;
      params.instType = instType; // OKX often requires instType even with instId
    } else {
      params.instType = instType; // Fetch all for this type (e.g. SWAP)
    }

    const queryString = new URLSearchParams(params).toString();
    const fullPath = `${requestPath}?${queryString}`;

    const response = await executeOkxRequestWithFallback({
      apiKey,
      apiSecret,
      passphrase,
      baseUrl,
      requestPath: fullPath,
      method: 'GET'
    });

    if (response.data?.code === '0' && response.data?.data) {
      const orders = Array.isArray(response.data.data) ? response.data.data : [];
      return {
        success: true,
        orders: orders
      };
    } else {
      const errorMsg = response.data?.msg || 'Unknown error';
      return {
        success: false,
        error: errorMsg,
        orders: []
      };
    }
  } catch (error) {
    console.log(`❌ [OKX API] Error getting pending orders: ${error.message}`);
    return {
      success: false,
      error: error.message,
      orders: []
    };
  }
}

module.exports = {
  isExchangeTradingEnabled,
  executeTakeProfit,
  executeStopLoss,
  executeAddPosition,
  getBalance,
  getOkxBalance,
  getOkxOpenPositions,
  verifyOkxAccountMode,
  getOkxAccountConfig,
  getOkxLeverageInfo,
  getOkxMaxSize,
  getOkxMaxAvailSize,
  getOkxTradeFee,
  calculateEstimatedFee,
  getOkxAccountRiskState,
  getOkxPositionBuilder,
  validatePositionRisk,
  checkOkxAccountModeSwitchPrecheck,
  getOkxCollateralAssets,
  setOkxSettleCurrency,
  getOkxSettleCurrency,
  executeOkxBatchOrders,
  cancelOkxOrder,
  cancelOkxOrders,
  placeOkxAlgoOrder,
  cancelOkxAlgoOrders,
  getOkxAlgoOrders,
  getOkxAlgoOrderDetails,
  checkOkxAlgoOrderStatus,
  getOkxPendingOrders,
  validateOkxLeverage,
  setOkxLeverage,
  amendOkxAlgoOrder,
  getOkxTicker,
  getOkxTickers,
  getOkxCandles,
  getOkxOrderBook,
  getOkxTrades,
  calculateQuantity,
  getPreferredExchange,
  executeOkxMarketOrder,
  executeOkxLimitOrder,
  OKX_SYMBOL_MAP,
  BYBIT_SYMBOL_MAP, // Legacy (kept for backward compatibility)
  BINANCE_SYMBOL_MAP, // Legacy
  MEXC_SYMBOL_MAP // Legacy
};

