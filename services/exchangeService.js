const axios = require('axios');
const crypto = require('crypto');

/**
 * Exchange Service
 * Handles order execution via Bybit Demo Trading API
 * Uses Bybit testnet for risk-free demo trading
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
    virtualTrading: false, // Virtual trading disabled
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

    console.log(`🔵 [BYBIT API] Sending order to ${baseUrl}/v5/order/create`);
    console.log(`🔵 [BYBIT API] Order: ${side} ${quantity} ${symbol} (Market)`);
    
    const response = await axios.post(
      `${baseUrl}/v5/order/create`,
      requestParams,
      {
        headers: {
          'X-BAPI-API-KEY': apiKey,
          'X-BAPI-TIMESTAMP': timestamp.toString(),
          'X-BAPI-RECV-WINDOW': recvWindow.toString(),
          'X-BAPI-SIGN': signature,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

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
      const errorMsg = response.data?.retMsg || 'Unknown error';
      const errorCode = response.data?.retCode || 0;
      console.log(`❌ [BYBIT API] Order failed: ${errorMsg} (Code: ${errorCode})`);
      return {
        success: false,
        error: errorMsg,
        code: errorCode
      };
    }
  } catch (error) {
    const errorMsg = error.response?.data?.retMsg || error.response?.data?.message || error.message;
    const errorCode = error.response?.data?.retCode || error.response?.status || 0;
    console.log(`❌ [BYBIT API] Order execution error: ${errorMsg} (Code: ${errorCode})`);
    if (error.response?.data) {
      console.log(`   Response:`, JSON.stringify(error.response.data).substring(0, 200));
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
 * ============================================================================
 * VIRTUAL TRADING FUNCTIONS (HIDDEN - KEPT FOR FUTURE USE)
 * ============================================================================
 * These functions are commented out but preserved for potential future use.
 * Currently, all trading goes through Bybit API.
 * ============================================================================
 */

// HIDDEN: Virtual trading function (kept for future use)
// async function executeVirtualMarketOrder(symbol, side, quantity, price) {
//   // Virtual trading implementation - hidden but preserved
//   return {
//     success: false,
//     error: 'Virtual trading is disabled. Please configure Bybit API keys for demo trading.',
//     mode: 'DISABLED'
//   };
// }

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

    const response = await axios.get(`${baseUrl}/v5/account/wallet-balance`, {
      params: requestParams,
      headers: {
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-TIMESTAMP': timestamp.toString(),
        'X-BAPI-RECV-WINDOW': recvWindow.toString(),
        'X-BAPI-SIGN': signature
      },
      timeout: 10000
    });

    if (response.data && response.data.retCode === 0 && response.data.result) {
      const spot = response.data.result.list?.[0]?.coin?.find(c => c.coin === asset);
      return spot ? parseFloat(spot.availableToWithdraw || spot.free || 0) : 0;
    }
    return 0;
  } catch (error) {
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

    // Generate signature BEFORE adding it to params
    const signature = generateBybitSignature(params, apiSecret);
    
    // Add signature to request params
    const requestParams = {
      ...params,
      signature: signature
    };

    console.log(`🔵 [BYBIT API] Fetching open positions from ${baseUrl}/v5/account/wallet-balance`);
    console.log(`🔵 [BYBIT API] Params: accountType=SPOT, timestamp=${timestamp}, recvWindow=${recvWindow}`);
    console.log(`🔵 [BYBIT API] API Key: ${apiKey.substring(0, 8)}... (checking permissions)`);
    
    const response = await axios.get(`${baseUrl}/v5/account/wallet-balance`, {
      params: requestParams,
      headers: {
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-TIMESTAMP': timestamp.toString(),
        'X-BAPI-RECV-WINDOW': recvWindow.toString(),
        'X-BAPI-SIGN': signature
      },
      timeout: 10000
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
    const errorMsg = error.response?.data?.retMsg || error.response?.data?.retMsg || error.message;
    const errorCode = error.response?.data?.retCode || error.response?.status || 0;
    
    console.log(`❌ [BYBIT API] Error fetching positions: ${errorMsg} (Code: ${errorCode})`);
    
    if (errorCode === 403) {
      console.log(`   💡 403 Forbidden - Possible causes:`);
      console.log(`   1. API key doesn't have 'Read' permissions`);
      console.log(`   2. API key is from mainnet but using testnet (or vice versa)`);
      console.log(`   3. IP address not whitelisted (if IP whitelist is enabled)`);
      console.log(`   4. Invalid API key or secret`);
      console.log(`   💡 Check: https://testnet.bybit.com → Profile → API Management`);
    } else if (errorCode === 401) {
      console.log(`   💡 401 Unauthorized - Invalid API key or signature`);
      console.log(`   💡 Verify: API key and secret are correct`);
    }
    
    if (error.response?.data) {
      console.log(`   Response:`, JSON.stringify(error.response.data).substring(0, 300));
    }
    
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

    const response = await axios.get(`${baseUrl}/v5/order/realtime`, {
      params: params,
      headers: {
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-TIMESTAMP': timestamp.toString(),
        'X-BAPI-RECV-WINDOW': recvWindow.toString(),
        'X-BAPI-SIGN': signature
      },
      timeout: 10000
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
 * ============================================================================
 * HIDDEN: Virtual trading state functions (kept for future use)
 * ============================================================================
 */

// HIDDEN: Get virtual trading state (kept for future use)
// function getVirtualTradingState() {
//   return {
//     balance: 0,
//     positions: {},
//     totalValue: 0,
//     message: 'Virtual trading disabled. Using Bybit Demo Trading.'
//   };
// }

// HIDDEN: Reset virtual trading (kept for future use)
// function resetVirtualTrading() {
//   console.log('⚠️ Virtual trading is disabled. Use Bybit Demo Trading instead.');
// }

// Temporary stub functions for backward compatibility
function getVirtualTradingState() {
  return {
    balance: 0,
    positions: {},
    totalValue: 0,
    message: 'Virtual trading disabled. Using Bybit Demo Trading.'
  };
}

function resetVirtualTrading() {
  // No-op: Virtual trading is disabled
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
  getVirtualTradingState,
  resetVirtualTrading,
  getPreferredExchange,
  executeBybitMarketOrder,
  BYBIT_SYMBOL_MAP,
  BINANCE_SYMBOL_MAP, // Legacy
  MEXC_SYMBOL_MAP // Legacy
};

