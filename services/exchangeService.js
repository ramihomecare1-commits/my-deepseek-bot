const axios = require('axios');
const crypto = require('crypto');
const config = require('../config/config');

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
      if (response.data && response.data.code !== undefined && response.data.code !== '0') {
        const errorMsg = response.data.msg || response.data.message || 'Unknown error';
        const errorCode = response.data.code;
        const sCode = response.data?.data?.[0]?.sCode;
        const sMsg = response.data?.data?.[0]?.sMsg;
        
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
        
        throw new Error(`OKX API Error (${errorCode}): ${errorMsg}`);
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
        
        throw new Error(`OKX API Error (${errorCode}): ${errorMsg}`);
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
async function executeOkxMarketOrder(symbol, side, quantity, apiKey, apiSecret, passphrase, baseUrl, leverage = 1) {
  try {
    const requestPath = '/api/v5/trade/order';
    
    // OKX perpetual swaps require quantity to be a multiple of lot size (usually 1 contract)
    // Round to nearest integer (minimum 1 contract)
    const roundedQuantity = Math.max(1, Math.round(quantity));
    
    // For cross margin mode, posSide should match the side
    // 'buy' = long position, 'sell' = short position
    const posSide = side.toLowerCase() === 'buy' ? 'long' : 'short';
    
    const body = {
      instId: symbol,
      tdMode: 'cross', // Cross margin for derivatives (allows leverage and shorting)
      side: side.toLowerCase(), // 'buy' (long) or 'sell' (short)
      posSide: posSide, // Position side: 'long' for buy, 'short' for sell (required for derivatives)
      ordType: 'market', // Market order
      sz: roundedQuantity.toString(), // Size (contract quantity, rounded to lot size)
      lever: leverage.toString() // Leverage (1-125, default 1x)
    };
    
    // Log order details for debugging
    console.log(`🔵 [OKX API] Order body:`, JSON.stringify(body));
    
    if (roundedQuantity !== quantity) {
      console.log(`⚠️ [OKX API] Quantity rounded from ${quantity} to ${roundedQuantity} (lot size requirement)`);
    }
    
    console.log(`🔵 [OKX API] Sending derivatives order: ${side} ${quantity} ${symbol} (Market, Leverage: ${leverage}x)`);
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
      console.log(`✅ [OKX API] Order executed successfully!`);
      console.log(`   Order ID: ${order.ordId}`);
      console.log(`   Symbol: ${order.instId}`);
      console.log(`   Side: ${order.side}`);
      console.log(`   Quantity: ${order.accFillSz || quantity}`);
      console.log(`   Status: ${order.state}`);
      
      return {
        success: true,
        orderId: order.ordId,
        symbol: order.instId,
        side: order.side,
        executedQty: parseFloat(order.accFillSz || quantity || 0),
        price: parseFloat(order.avgPx || order.px || 0),
        status: order.state,
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
    
    console.log(`❌ [OKX API] Order execution error: ${errorMsg} (Code: ${errorCode})`);
    
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
  // Default position size if not specified
  const defaultSize = parseFloat(process.env.DEFAULT_POSITION_SIZE_USD || '100');
  const size = positionSizeUSD || defaultSize;
  
  // Calculate quantity
  const quantity = size / price;
  
  // Round to appropriate decimal places based on symbol
  // Most cryptos use 4-8 decimal places
  const decimals = symbol === 'BTC' ? 6 : symbol === 'ETH' ? 4 : 2;
  
  return Math.floor(quantity * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

/**
 * Execute Take Profit order via Bybit
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
  
  // Calculate quantity based on position size
  const positionSizeUSD = parseFloat(process.env.DEFAULT_POSITION_SIZE_USD || '100');
  const quantity = calculateQuantity(trade.symbol, trade.currentPrice, positionSizeUSD);

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
    leverage
  );
}

/**
 * Execute Stop Loss order via Bybit
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
  
  // Calculate quantity
  const positionSizeUSD = parseFloat(process.env.DEFAULT_POSITION_SIZE_USD || '100');
  const quantity = calculateQuantity(trade.symbol, trade.currentPrice, positionSizeUSD);

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
    leverage
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


module.exports = {
  isExchangeTradingEnabled,
  executeTakeProfit,
  executeStopLoss,
  executeAddPosition,
  getBalance,
  getOkxBalance,
  getOkxOpenPositions,
  calculateQuantity,
  getPreferredExchange,
  executeOkxMarketOrder,
  OKX_SYMBOL_MAP,
  BYBIT_SYMBOL_MAP, // Legacy (kept for backward compatibility)
  BINANCE_SYMBOL_MAP, // Legacy
  MEXC_SYMBOL_MAP // Legacy
};

