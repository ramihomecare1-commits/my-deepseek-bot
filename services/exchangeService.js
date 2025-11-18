const axios = require('axios');
const crypto = require('crypto');
const config = require('../config/config');

/**
 * Exchange Service
 * Handles order execution via Bybit Demo Trading API
 * Uses Bybit testnet for risk-free demo trading
 * Uses ScraperAPI proxy to bypass geo-blocking if configured
 */

// Bybit API endpoints
const BYBIT_TESTNET_URL = 'https://api-demo.bybit.com';
const BYBIT_MAINNET_URL = 'https://api.bybit.com';

// Map coin symbols to Bybit trading pairs (Spot trading uses same format)
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
 * Priority: Bybit Demo (if API keys available) > Bybit Mainnet > Disabled
 */
function getPreferredExchange() {
  const bybitApiKey = process.env.BYBIT_API_KEY || '';
  const bybitApiSecret = process.env.BYBIT_API_SECRET || '';
  const useTestnet = (process.env.BYBIT_TESTNET || 'true').toLowerCase() === 'true';
  
  if (bybitApiKey && bybitApiSecret) {
    return { 
      exchange: 'BYBIT', 
      apiKey: bybitApiKey, 
      apiSecret: bybitApiSecret,
      testnet: useTestnet,
      baseUrl: useTestnet ? BYBIT_TESTNET_URL : BYBIT_MAINNET_URL
    };
  }
  
  return { exchange: 'DISABLED', apiKey: null, apiSecret: null, testnet: false, baseUrl: null };
}

/**
 * Check if exchange trading is enabled (Bybit Demo Trading)
 */
function isExchangeTradingEnabled() {
  const bybitApiKey = process.env.BYBIT_API_KEY || '';
  const bybitApiSecret = process.env.BYBIT_API_SECRET || '';
  const useTestnet = (process.env.BYBIT_TESTNET || 'true').toLowerCase() === 'true';
  
  const hasBybitKeys = bybitApiKey.length > 0 && bybitApiSecret.length > 0;
  const tradingEnabled = hasBybitKeys;
  
  const preferredExchange = getPreferredExchange();
  
  // Log Bybit status on first call (startup)
  if (!isExchangeTradingEnabled._logged) {
    isExchangeTradingEnabled._logged = true;
    console.log('\n' + '='.repeat(60));
    console.log('🔵 BYBIT TRADING CONFIGURATION');
    console.log('='.repeat(60));
    if (tradingEnabled) {
      console.log(`✅ Status: ENABLED`);
      console.log(`✅ Mode: ${useTestnet ? 'BYBIT_DEMO (Testnet)' : 'BYBIT_MAINNET (Production)'}`);
      console.log(`✅ API Endpoint: ${preferredExchange.baseUrl}`);
      console.log(`✅ API Key: ${bybitApiKey.substring(0, 10)}...${bybitApiKey.substring(bybitApiKey.length - 4)}`);
      console.log(`✅ All orders will execute via Bybit API`);
    } else {
      console.log(`❌ Status: DISABLED`);
      console.log(`❌ Reason: BYBIT_API_KEY or BYBIT_API_SECRET not configured`);
      console.log(`💡 To enable: Set BYBIT_API_KEY and BYBIT_API_SECRET in environment variables`);
      console.log(`💡 Get keys from: https://testnet.bybit.com → Profile → API Management`);
    }
    console.log('='.repeat(60) + '\n');
  }
  
  return {
    enabled: tradingEnabled,
    mode: tradingEnabled ? (useTestnet ? 'BYBIT_DEMO' : 'BYBIT_MAINNET') : 'DISABLED',
    realTrading: tradingEnabled,
    preferredExchange: preferredExchange.exchange,
    hasBybitKeys: hasBybitKeys,
    testnet: useTestnet,
    baseUrl: preferredExchange.baseUrl
  };
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

    // Generate signature (must be done before adding signature to params)
    const signature = generateBybitSignature(params, apiSecret);
    
    // Add signature to params for the request
    const requestParams = {
      ...params,
      signature: signature
    };

    // Use proxy if configured (ScrapeOps preferred, ScraperAPI as fallback)
    const scrapeOpsKey = config.SCRAPEOPS_API_KEY || '';
    const scraperApiKey = config.SCRAPER_API_KEY || '';
    const proxyPriority = config.PROXY_PRIORITY || 'scrapeops';
    
    const useScrapeOps = scrapeOpsKey && scrapeOpsKey.length > 0 && (proxyPriority === 'scrapeops' || !scraperApiKey);
    const useScraperAPI = scraperApiKey && scraperApiKey.length > 0 && !useScrapeOps;
    const useProxy = useScrapeOps || useScraperAPI;
    
    // Debug logging for proxy selection
    console.log(`🔍 [PROXY DEBUG] ScrapeOps Key: ${scrapeOpsKey ? 'SET (' + scrapeOpsKey.substring(0, 8) + '...)' : 'NOT SET'}`);
    console.log(`🔍 [PROXY DEBUG] ScraperAPI Key: ${scraperApiKey ? 'SET (' + scraperApiKey.substring(0, 8) + '...)' : 'NOT SET'}`);
    console.log(`🔍 [PROXY DEBUG] Priority Setting: ${proxyPriority}`);
    console.log(`🔍 [PROXY DEBUG] Selected Proxy: ${useScrapeOps ? 'ScrapeOps ✅' : useScraperAPI ? 'ScraperAPI ✅' : 'Direct Connection ⚠️'}`);
    
    // Debug logging for proxy status
    if (!useProxy) {
      console.log(`⚠️ [BYBIT API] No proxy configured - requests may be geo-blocked`);
      console.log(`   💡 To bypass geo-blocking, set SCRAPEOPS_API_KEY or SCRAPER_API_KEY`);
      console.log(`   💡 ScrapeOps: https://scrapeops.io/ (1,000 free credits)`);
      console.log(`   💡 ScraperAPI: https://www.scraperapi.com/ (1,000 requests/month free)`);
    }
    
    let targetUrl = `${baseUrl}/v5/order/create`;
    let requestConfig = {
      headers: {
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-TIMESTAMP': timestamp.toString(),
        'X-BAPI-RECV-WINDOW': recvWindow.toString(),
        'X-BAPI-SIGN': signature,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: useProxy ? 45000 : 10000, // Longer timeout for proxy (45s), shorter for direct (10s)
      validateStatus: function (status) {
        return status < 500; // Don't throw for 4xx errors, we'll handle them
      }
    };
    
    if (useScrapeOps) {
      // Route through ScrapeOps to bypass geo-blocking
      targetUrl = 'https://proxy.scrapeops.io/v1/';
      const fullUrl = `${baseUrl}/v5/order/create`;
      
      // ScrapeOps format: uses 'url' parameter and supports custom headers
      const customHeaders = {
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-TIMESTAMP': timestamp.toString(),
        'X-BAPI-RECV-WINDOW': recvWindow.toString(),
        'X-BAPI-SIGN': signature,
        'Content-Type': 'application/json'
      };
      
      requestConfig.params = {
        api_key: scrapeOpsKey,
        url: fullUrl,
        method: 'POST',
        headers: JSON.stringify(customHeaders)
      };
      
      // POST body as JSON
      requestConfig.data = JSON.stringify(requestParams);
      requestConfig.headers = {}; // Headers are in ScrapeOps params
      
      console.log(`🔵 [BYBIT API] Using ScrapeOps proxy to bypass geo-blocking`);
      console.log(`   📤 Headers: X-BAPI-API-KEY=${apiKey.substring(0, 8)}..., X-BAPI-SIGN, etc.`);
    } else if (useScraperAPI) {
      // Route through ScraperAPI to bypass geo-blocking (fallback)
      targetUrl = 'http://api.scraperapi.com';
      const fullUrl = `${baseUrl}/v5/order/create`;
      
      const customHeaders = {
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-TIMESTAMP': timestamp.toString(),
        'X-BAPI-RECV-WINDOW': recvWindow.toString(),
        'X-BAPI-SIGN': signature,
        'Content-Type': 'application/json'
      };
      
      requestConfig.params = {
        api_key: scraperApiKey,
        url: fullUrl,
        method: 'POST',
        headers: JSON.stringify(customHeaders),
        body: JSON.stringify(requestParams)
      };
      
      requestConfig.data = JSON.stringify(requestParams);
      requestConfig.headers = {};
      
      console.log(`🔵 [BYBIT API] Using ScraperAPI proxy to bypass geo-blocking (fallback)`);
    } else {
      requestConfig.data = requestParams; // POST body for direct request
    }
    
    const proxyLabel = useScrapeOps ? 'ScrapeOps → ' : useScraperAPI ? 'ScraperAPI → ' : '';
    console.log(`🔵 [BYBIT API] Sending order to ${proxyLabel}${baseUrl}/v5/order/create`);
    console.log(`🔵 [BYBIT API] Order: ${side} ${quantity} ${symbol} (Market)`);
    console.log(`🔵 [BYBIT API] API Key: ${apiKey.substring(0, 8)}... (verifying permissions)`);
    
    const response = await axios.post(targetUrl, requestConfig.data || requestParams, requestConfig);

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
  
  if (exchange.exchange === 'BYBIT' && exchange.baseUrl) {
    return await getBybitBalance(asset, apiKey, apiSecret, exchange.baseUrl);
  }
  
  // Legacy Binance support (kept for backward compatibility)
  try {
    const timestamp = Date.now();
    const queryString = `timestamp=${timestamp}`;
    const signature = generateSignature(queryString, apiSecret);

    const response = await axios.get('https://api.binance.com/api/v3/account', {
      params: {
        timestamp: timestamp,
        signature: signature
      },
      headers: {
        'X-MBX-APIKEY': apiKey
      },
      timeout: 10000
    });

    const balance = response.data.balances.find(b => b.asset === asset);
    return balance ? parseFloat(balance.free) : 0;
  } catch (error) {
    console.log(`⚠️ Failed to get balance for ${asset}: ${error.message}`);
    return 0;
  }
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
      error: 'Trading not enabled. Please configure BYBIT_API_KEY and BYBIT_API_SECRET for demo trading.',
      skipped: true
    };
  }

  const bybitSymbol = BYBIT_SYMBOL_MAP[trade.symbol];

  if (!bybitSymbol) {
    return {
      success: false,
      error: `Symbol ${trade.symbol} not available on Bybit`
    };
  }

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
  // Bybit uses 'Buy' and 'Sell' (capitalized)
  const side = trade.action === 'BUY' ? 'Sell' : 'Buy';
  
  // Calculate quantity based on position size
  const positionSizeUSD = parseFloat(process.env.DEFAULT_POSITION_SIZE_USD || '100');
  const quantity = calculateQuantity(trade.symbol, trade.currentPrice, positionSizeUSD);

  if (quantity <= 0) {
    return {
      success: false,
      error: 'Invalid quantity calculated'
    };
  }

  const exchange = getPreferredExchange();
  const modeLabel = config.testnet ? 'BYBIT_DEMO' : 'BYBIT_MAINNET';
  console.log(`📈 Executing TAKE PROFIT (${modeLabel}): ${side} ${quantity} ${trade.symbol} at $${trade.currentPrice.toFixed(2)}`);
  
  return await executeBybitMarketOrder(
    bybitSymbol, 
    side, 
    quantity, 
    exchange.apiKey, 
    exchange.apiSecret,
    exchange.baseUrl
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
      error: 'Trading not enabled. Please configure BYBIT_API_KEY and BYBIT_API_SECRET for demo trading.',
      skipped: true
    };
  }

  const bybitSymbol = BYBIT_SYMBOL_MAP[trade.symbol];

  if (!bybitSymbol) {
    return {
      success: false,
      error: `Symbol ${trade.symbol} not available on Bybit`
    };
  }

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
  // Bybit uses 'Buy' and 'Sell' (capitalized)
  const side = trade.action === 'BUY' ? 'Sell' : 'Buy';
  
  // Calculate quantity
  const positionSizeUSD = parseFloat(process.env.DEFAULT_POSITION_SIZE_USD || '100');
  const quantity = calculateQuantity(trade.symbol, trade.currentPrice, positionSizeUSD);

  if (quantity <= 0) {
    return {
      success: false,
      error: 'Invalid quantity calculated'
    };
  }

  const exchange = getPreferredExchange();
  const modeLabel = config.testnet ? 'BYBIT_DEMO' : 'BYBIT_MAINNET';
  console.log(`🛑 Executing STOP LOSS (${modeLabel}): ${side} ${quantity} ${trade.symbol} at $${trade.currentPrice.toFixed(2)}`);
  
  return await executeBybitMarketOrder(
    bybitSymbol, 
    side, 
    quantity, 
    exchange.apiKey, 
    exchange.apiSecret,
    exchange.baseUrl
  );
}

/**
 * Execute Add Position (DCA) order via Bybit
 * @param {Object} trade - Trade object
 * @returns {Promise<Object>} Execution result
 */
async function executeAddPosition(trade) {
  const config = isExchangeTradingEnabled();
  
  if (!config.enabled) {
    return {
      success: false,
      error: 'Trading not enabled. Please configure BYBIT_API_KEY and BYBIT_API_SECRET for demo trading.',
      skipped: true
    };
  }

  const bybitSymbol = BYBIT_SYMBOL_MAP[trade.symbol];

  if (!bybitSymbol) {
    return {
      success: false,
      error: `Symbol ${trade.symbol} not available on Bybit`
    };
  }

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
  // Bybit uses 'Buy' and 'Sell' (capitalized)
  const side = trade.action === 'BUY' ? 'Buy' : 'Sell';
  
  // Calculate quantity for DCA using portfolio service ($100 USD)
  const { getDCASize } = require('./portfolioService');
  const dcaSizeUSD = getDCASize(); // $100 USD per DCA
  const quantity = calculateQuantity(trade.symbol, trade.currentPrice, dcaSizeUSD);

  if (quantity <= 0) {
    return {
      success: false,
      error: 'Invalid quantity calculated'
    };
  }

  const exchange = getPreferredExchange();
  const modeLabel = config.testnet ? 'BYBIT_DEMO' : 'BYBIT_MAINNET';
  console.log(`💰 Executing ADD POSITION (DCA) (${modeLabel}): ${side} ${quantity} ${trade.symbol} at $${trade.currentPrice.toFixed(2)}`);
  
  return await executeBybitMarketOrder(
    bybitSymbol, 
    side, 
    quantity, 
    exchange.apiKey, 
    exchange.apiSecret,
    exchange.baseUrl
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

    // Generate signature
    const signature = generateBybitSignature(params, apiSecret);
    
    // Add signature to params for GET request
    const requestParams = {
      ...params,
      signature: signature
    };

    // Use proxy if configured (ScrapeOps preferred, ScraperAPI as fallback)
    const scrapeOpsKey = config.SCRAPEOPS_API_KEY || '';
    const scraperApiKey = config.SCRAPER_API_KEY || '';
    const proxyPriority = config.PROXY_PRIORITY || 'scrapeops';
    
    const useScrapeOps = scrapeOpsKey && scrapeOpsKey.length > 0 && (proxyPriority === 'scrapeops' || !scraperApiKey);
    const useScraperAPI = scraperApiKey && scraperApiKey.length > 0 && !useScrapeOps;
    const useProxy = useScrapeOps || useScraperAPI;
    
    let targetUrl = `${baseUrl}/v5/account/wallet-balance`;
    let requestConfig = {
      params: useScrapeOps ? {
        api_key: scrapeOpsKey,
        url: `${baseUrl}/v5/account/wallet-balance?${new URLSearchParams(requestParams).toString()}`,
        method: 'GET',
        headers: JSON.stringify({
          'X-BAPI-API-KEY': apiKey,
          'X-BAPI-TIMESTAMP': timestamp.toString(),
          'X-BAPI-RECV-WINDOW': recvWindow.toString(),
          'X-BAPI-SIGN': signature
        })
      } : useScraperAPI ? {
        api_key: scraperApiKey,
        url: `${baseUrl}/v5/account/wallet-balance?${new URLSearchParams(requestParams).toString()}`,
        method: 'GET',
        headers: JSON.stringify({
          'X-BAPI-API-KEY': apiKey,
          'X-BAPI-TIMESTAMP': timestamp.toString(),
          'X-BAPI-RECV-WINDOW': recvWindow.toString(),
          'X-BAPI-SIGN': signature
        })
      } : requestParams,
      headers: {
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-TIMESTAMP': timestamp.toString(),
        'X-BAPI-RECV-WINDOW': recvWindow.toString(),
        'X-BAPI-SIGN': signature,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: useProxy ? 45000 : 10000, // Longer timeout for proxy (45s), shorter for direct (10s)
      validateStatus: function (status) {
        return status < 500; // Don't throw for 4xx errors, we'll handle them
      }
    };
    
    if (useScrapeOps) {
      targetUrl = 'https://proxy.scrapeops.io/v1/';
      console.log(`🔵 [BYBIT API] Using ScrapeOps proxy to bypass geo-blocking`);
    } else if (useScraperAPI) {
      targetUrl = 'http://api.scraperapi.com';
      console.log(`🔵 [BYBIT API] Using ScraperAPI proxy to bypass geo-blocking (fallback)`);
    }
    
    const response = await axios.get(targetUrl, requestConfig);

    if (response.data && response.data.retCode === 0 && response.data.result) {
      const spot = response.data.result.list?.[0]?.coin?.find(c => c.coin === asset);
      return spot ? parseFloat(spot.availableToWithdraw || spot.free || 0) : 0;
    }
    return 0;
  } catch (error) {
    // Check for timeout errors
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      // Detect which proxy was being used
      const scrapeOpsKey = config.SCRAPEOPS_API_KEY || '';
      const scraperApiKey = config.SCRAPER_API_KEY || '';
      const proxyPriority = config.PROXY_PRIORITY || 'scrapeops';
      const useScrapeOps = scrapeOpsKey && scrapeOpsKey.length > 0 && (proxyPriority === 'scrapeops' || !scraperApiKey);
      const useScraperAPI = scraperApiKey && scraperApiKey.length > 0 && !useScrapeOps;
      const proxyName = useScrapeOps ? 'ScrapeOps' : useScraperAPI ? 'ScraperAPI' : 'direct connection';
      
      console.log(`❌ [BYBIT API] Balance request timeout - ${proxyName} may be slow or unresponsive`);
      console.log(`   💡 Timeout occurred after ${error.config?.timeout || 'unknown'}ms`);
      if (useScrapeOps) {
        console.log(`   💡 ScrapeOps free tier may have rate limits or high latency`);
        console.log(`   💡 Try again in a few moments or check ScrapeOps dashboard`);
      } else if (useScraperAPI) {
        console.log(`   💡 ScraperAPI free tier may have rate limits or high latency`);
        console.log(`   💡 Try again in a few moments or check ScraperAPI status`);
      } else {
        console.log(`   💡 Direct connection may be geo-blocked`);
        console.log(`   💡 Consider using ScrapeOps or ScraperAPI proxy`);
      }
    } else {
      console.log(`⚠️ Failed to get Bybit balance for ${asset}: ${error.message}`);
    }
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

    // Generate signature BEFORE adding it to params
    const signature = generateBybitSignature(params, apiSecret);
    
    // Add signature to request params
    const requestParams = {
      ...params,
      signature: signature
    };

    // Use proxy if configured (ScrapeOps preferred, ScraperAPI as fallback)
    const scrapeOpsKey = config.SCRAPEOPS_API_KEY || '';
    const scraperApiKey = config.SCRAPER_API_KEY || '';
    const proxyPriority = config.PROXY_PRIORITY || 'scrapeops';
    
    const useScrapeOps = scrapeOpsKey && scrapeOpsKey.length > 0 && (proxyPriority === 'scrapeops' || !scraperApiKey);
    const useScraperAPI = scraperApiKey && scraperApiKey.length > 0 && !useScrapeOps;
    const useProxy = useScrapeOps || useScraperAPI;
    
    // Debug logging for positions function
    console.log(`🔍 [PROXY DEBUG] Positions - ScrapeOps: ${scrapeOpsKey ? 'SET' : 'NOT SET'}, ScraperAPI: ${scraperApiKey ? 'SET' : 'NOT SET'}, Priority: ${proxyPriority}, Using: ${useScrapeOps ? 'ScrapeOps ✅' : useScraperAPI ? 'ScraperAPI ✅' : 'Direct ⚠️'}`);
    
    let targetUrl = `${baseUrl}/v5/account/wallet-balance`;
    let requestConfig = {
      params: useScrapeOps ? {
        api_key: scrapeOpsKey,
        url: `${baseUrl}/v5/account/wallet-balance?${new URLSearchParams(requestParams).toString()}`,
        method: 'GET',
        headers: JSON.stringify({
          'X-BAPI-API-KEY': apiKey,
          'X-BAPI-TIMESTAMP': timestamp.toString(),
          'X-BAPI-RECV-WINDOW': recvWindow.toString(),
          'X-BAPI-SIGN': signature
        })
      } : useScraperAPI ? {
        api_key: scraperApiKey,
        url: `${baseUrl}/v5/account/wallet-balance?${new URLSearchParams(requestParams).toString()}`,
        method: 'GET',
        headers: JSON.stringify({
          'X-BAPI-API-KEY': apiKey,
          'X-BAPI-TIMESTAMP': timestamp.toString(),
          'X-BAPI-RECV-WINDOW': recvWindow.toString(),
          'X-BAPI-SIGN': signature
        })
      } : requestParams,
      headers: {
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-TIMESTAMP': timestamp.toString(),
        'X-BAPI-RECV-WINDOW': recvWindow.toString(),
        'X-BAPI-SIGN': signature,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: useProxy ? 45000 : 10000, // Longer timeout for proxy (45s), shorter for direct (10s)
      validateStatus: function (status) {
        return status < 500; // Don't throw for 4xx errors, we'll handle them
      }
    };
    
    if (useScrapeOps) {
      targetUrl = 'https://proxy.scrapeops.io/v1/';
      console.log(`🔵 [BYBIT API] Using ScrapeOps proxy to bypass geo-blocking`);
    } else if (useScraperAPI) {
      targetUrl = 'http://api.scraperapi.com';
      console.log(`🔵 [BYBIT API] Using ScraperAPI proxy to bypass geo-blocking (fallback)`);
    }
    
    const proxyLabel = useScrapeOps ? 'ScrapeOps → ' : useScraperAPI ? 'ScraperAPI → ' : '';
    console.log(`🔵 [BYBIT API] Fetching open positions from ${proxyLabel}${baseUrl}/v5/account/wallet-balance`);
    console.log(`🔵 [BYBIT API] Params: accountType=SPOT, timestamp=${timestamp}, recvWindow=${recvWindow}`);
    console.log(`🔵 [BYBIT API] API Key: ${apiKey.substring(0, 8)}... (checking permissions)`);
    
    const response = await axios.get(targetUrl, requestConfig);

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
    // Check for timeout errors first
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      // Detect which proxy was being used
      const scrapeOpsKey = config.SCRAPEOPS_API_KEY || '';
      const scraperApiKey = config.SCRAPER_API_KEY || '';
      const proxyPriority = config.PROXY_PRIORITY || 'scrapeops';
      const useScrapeOps = scrapeOpsKey && scrapeOpsKey.length > 0 && (proxyPriority === 'scrapeops' || !scraperApiKey);
      const useScraperAPI = scraperApiKey && scraperApiKey.length > 0 && !useScrapeOps;
      const proxyName = useScrapeOps ? 'ScrapeOps' : useScraperAPI ? 'ScraperAPI' : 'direct connection';
      
      console.log(`❌ [BYBIT API] Request timeout - ${proxyName} may be slow or unresponsive`);
      console.log(`   💡 Timeout occurred after ${error.config?.timeout || 'unknown'}ms`);
      console.log(`   💡 Possible causes:`);
      if (useScrapeOps) {
        console.log(`      1. ScrapeOps is experiencing high latency`);
        console.log(`      2. ScrapeOps free tier may have rate limits`);
        console.log(`      3. Network connectivity issues`);
        console.log(`   💡 Solutions:`);
        console.log(`      1. Try again in a few moments`);
        console.log(`      2. Check ScrapeOps dashboard for service status`);
        console.log(`      3. Consider upgrading ScrapeOps plan`);
        console.log(`      4. Use ScraperAPI as fallback (set PROXY_PRIORITY=scraperapi)`);
      } else if (useScraperAPI) {
        console.log(`      1. ScraperAPI is experiencing high latency`);
        console.log(`      2. ScraperAPI free tier may have rate limits`);
        console.log(`      3. Network connectivity issues`);
        console.log(`   💡 Solutions:`);
        console.log(`      1. Try again in a few moments`);
        console.log(`      2. Consider upgrading ScraperAPI plan`);
        console.log(`      3. Use ScrapeOps instead (set SCRAPEOPS_API_KEY)`);
        console.log(`      4. Use a VPN or deploy to a different region`);
      } else {
        console.log(`      1. Direct connection may be geo-blocked`);
        console.log(`      2. Network connectivity issues`);
        console.log(`   💡 Solutions:`);
        console.log(`      1. Set SCRAPEOPS_API_KEY to use proxy`);
        console.log(`      2. Use a VPN or deploy to a different region`);
        console.log(`      3. Check network connectivity`);
      }
      return [];
    }
    
    const errorMsg = error.response?.data?.retMsg || error.response?.data?.retMsg || error.message;
    const errorCode = error.response?.data?.retCode || error.response?.status || 0;
    
    // Check if response is HTML (Cloudflare/CDN blocking)
    const responseData = error.response?.data;
    const isHtmlResponse = responseData && 
      (typeof responseData === 'string' && responseData.includes('<!DOCTYPE') ||
       error.response?.headers?.['content-type']?.includes('text/html'));
    
    if (isHtmlResponse) {
      const isGeoBlocked = responseData && typeof responseData === 'string' && 
        (responseData.includes('CloudFront') || responseData.includes('block access from your country'));
      
      if (isGeoBlocked) {
        console.log(`❌ [BYBIT API] Error fetching positions: GEO-BLOCKING DETECTED (Code: ${errorCode})`);
        console.log(`   💡 CloudFront is blocking your server's country/region`);
        console.log(`   💡 This is NOT an API key issue - it's a network geo-blocking issue`);
        console.log(`   💡 Solutions:`);
        console.log(`      1. Deploy to a server in a different country/region (US, EU, Singapore)`);
        console.log(`      2. Use a VPN or proxy service to route requests`);
        console.log(`      3. Contact Bybit support about geo-restrictions`);
        console.log(`      4. Check if your hosting provider offers different regions`);
        console.log(`   💡 Your server IP is being blocked by CloudFront, not Bybit API`);
      } else {
        console.log(`❌ [BYBIT API] Error fetching positions: Request blocked by CDN/Cloudflare (Code: ${errorCode})`);
        console.log(`   💡 This indicates the request is being blocked BEFORE reaching Bybit API`);
        console.log(`   💡 The HTML response suggests Cloudflare is blocking your server's IP`);
        console.log(`   💡 Possible causes:`);
        console.log(`   1. Geo-blocking: Your server IP may be in a blocked region`);
        console.log(`   2. IP reputation: Your server IP may be flagged by Cloudflare`);
        console.log(`   3. Rate limiting: Too many requests from this IP`);
        console.log(`   4. Network/firewall: Corporate firewall or proxy blocking requests`);
        console.log(`   💡 Solutions:`);
        console.log(`   - Added User-Agent headers to bypass Cloudflare bot detection`);
        console.log(`   - Check if your server can access ${baseUrl} from command line`);
        console.log(`   - Your server IP may be flagged by Cloudflare's automatic protection`);
        console.log(`   - Try using a different server location or contact Bybit support`);
        console.log(`   - Verify API endpoint: ${baseUrl}/v5/account/wallet-balance`);
        console.log(`   - Note: IP restriction is disabled, so this is a Cloudflare network-level block`);
      }
    } else {
      console.log(`❌ [BYBIT API] Error fetching positions: ${errorMsg} (Code: ${errorCode})`);
      
      if (errorCode === 403 || error.response?.status === 403) {
        console.log(`   💡 403 Forbidden - Possible causes:`);
        console.log(`   1. API key doesn't have 'Read' permissions`);
        console.log(`   2. API key is from mainnet but using testnet (or vice versa)`);
        console.log(`   3. IP address not whitelisted (if IP whitelist is enabled)`);
        console.log(`   4. Invalid API key or secret`);
        console.log(`   💡 Check: https://testnet.bybit.com → Profile → API Management`);
        console.log(`   💡 Ensure API key has 'Read' permission and matches testnet/mainnet setting`);
      } else if (errorCode === 401 || error.response?.status === 401) {
        console.log(`   💡 401 Unauthorized - Invalid API key or signature`);
        console.log(`   💡 Verify: API key and secret are correct`);
      }
      
      if (responseData) {
        const responseStr = typeof responseData === 'string' 
          ? responseData 
          : JSON.stringify(responseData);
        console.log(`   Response: ${responseStr.substring(0, 300)}`);
      }
    }
    
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

    const signature = generateBybitSignature(params, apiSecret);
    params.signature = signature;

    // Use proxy if configured (ScrapeOps preferred, ScraperAPI as fallback)
    const scrapeOpsKey = config.SCRAPEOPS_API_KEY || '';
    const scraperApiKey = config.SCRAPER_API_KEY || '';
    const proxyPriority = config.PROXY_PRIORITY || 'scrapeops';
    
    const useScrapeOps = scrapeOpsKey && scrapeOpsKey.length > 0 && (proxyPriority === 'scrapeops' || !scraperApiKey);
    const useScraperAPI = scraperApiKey && scraperApiKey.length > 0 && !useScrapeOps;
    const useProxy = useScrapeOps || useScraperAPI;
    
    let targetUrl = `${baseUrl}/v5/order/realtime`;
    let requestConfig = {
      params: useScrapeOps ? {
        api_key: scrapeOpsKey,
        url: `${baseUrl}/v5/order/realtime?${new URLSearchParams(params).toString()}`,
        method: 'GET',
        headers: JSON.stringify({
          'X-BAPI-API-KEY': apiKey,
          'X-BAPI-TIMESTAMP': timestamp.toString(),
          'X-BAPI-RECV-WINDOW': recvWindow.toString(),
          'X-BAPI-SIGN': signature
        })
      } : useScraperAPI ? {
        api_key: scraperApiKey,
        url: `${baseUrl}/v5/order/realtime?${new URLSearchParams(params).toString()}`,
        method: 'GET',
        headers: JSON.stringify({
          'X-BAPI-API-KEY': apiKey,
          'X-BAPI-TIMESTAMP': timestamp.toString(),
          'X-BAPI-RECV-WINDOW': recvWindow.toString(),
          'X-BAPI-SIGN': signature
        })
      } : params,
      headers: {
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-TIMESTAMP': timestamp.toString(),
        'X-BAPI-RECV-WINDOW': recvWindow.toString(),
        'X-BAPI-SIGN': signature,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: useProxy ? 45000 : 10000 // Longer timeout for proxy (45s), shorter for direct (10s)
    };
    
    if (useScrapeOps) {
      targetUrl = 'https://proxy.scrapeops.io/v1/';
    } else if (useScraperAPI) {
      targetUrl = 'http://api.scraperapi.com';
    }
    
    const response = await axios.get(targetUrl, requestConfig);

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
  getBybitBalance,
  getBybitOpenPositions,
  getBybitOpenOrders,
  calculateQuantity,
  getPreferredExchange,
  executeBybitMarketOrder,
  BYBIT_SYMBOL_MAP,
  BINANCE_SYMBOL_MAP, // Legacy
  MEXC_SYMBOL_MAP // Legacy
};

