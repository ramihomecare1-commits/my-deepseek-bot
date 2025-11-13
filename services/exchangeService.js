const axios = require('axios');
const crypto = require('crypto');

/**
 * Binance Exchange Service
 * Handles order execution, position management, and trade automation
 */

// Map coin symbols to Binance trading pairs
const BINANCE_SYMBOL_MAP = {
  'BTC': 'BTCUSDT', 'ETH': 'ETHUSDT', 'BNB': 'BNBUSDT', 'SOL': 'SOLUSDT',
  'XRP': 'XRPUSDT', 'DOGE': 'DOGEUSDT', 'ADA': 'ADAUSDT', 'AVAX': 'AVAXUSDT',
  'LINK': 'LINKUSDT', 'DOT': 'DOTUSDT', 'MATIC': 'MATICUSDT', 'LTC': 'LTCUSDT',
  'UNI': 'UNIUSDT', 'ATOM': 'ATOMUSDT', 'XLM': 'XLMUSDT', 'ETC': 'ETCUSDT',
  'XMR': 'XMRUSDT', 'ALGO': 'ALGOUSDT', 'FIL': 'FILUSDT', 'ICP': 'ICPUSDT',
  'VET': 'VETUSDT', 'EOS': 'EOSUSDT', 'XTZ': 'XTZUSDT', 'AAVE': 'AAVEUSDT',
  'MKR': 'MKRUSDT', 'GRT': 'GRTUSDT', 'THETA': 'THETAUSDT', 'RUNE': 'RUNEUSDT',
  'NEO': 'NEOUSDT', 'FTM': 'FTMUSDT'
};

/**
 * Check if exchange trading is enabled
 */
function isExchangeTradingEnabled() {
  const apiKey = process.env.BINANCE_API_KEY || '';
  const apiSecret = process.env.BINANCE_API_SECRET || '';
  const tradingEnabled = process.env.ENABLE_AUTO_TRADING === 'true' || process.env.ENABLE_AUTO_TRADING === '1';
  
  return {
    enabled: tradingEnabled && apiKey.length > 0 && apiSecret.length > 0,
    hasApiKey: apiKey.length > 0,
    hasApiSecret: apiSecret.length > 0,
    tradingEnabled: tradingEnabled
  };
}

/**
 * Generate Binance API signature
 */
function generateSignature(queryString, apiSecret) {
  return crypto
    .createHmac('sha256', apiSecret)
    .update(queryString)
    .digest('hex');
}

/**
 * Execute a market order on Binance
 * @param {string} symbol - Trading pair symbol (e.g., 'BTCUSDT')
 * @param {string} side - 'BUY' or 'SELL'
 * @param {number} quantity - Amount to trade
 * @param {string} apiKey - Binance API key
 * @param {string} apiSecret - Binance API secret
 * @returns {Promise<Object>} Order result
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
 * Get account balance for a specific asset
 * @param {string} asset - Asset symbol (e.g., 'USDT', 'BTC')
 * @param {string} apiKey - Binance API key
 * @param {string} apiSecret - Binance API secret
 * @returns {Promise<number>} Available balance
 */
async function getBalance(asset, apiKey, apiSecret) {
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
 * Execute Take Profit order
 * @param {Object} trade - Trade object
 * @returns {Promise<Object>} Execution result
 */
async function executeTakeProfit(trade) {
  const config = isExchangeTradingEnabled();
  
  if (!config.enabled) {
    return {
      success: false,
      error: 'Exchange trading not enabled. Set BINANCE_API_KEY, BINANCE_API_SECRET, and ENABLE_AUTO_TRADING=true',
      skipped: true
    };
  }

  const apiKey = process.env.BINANCE_API_KEY;
  const apiSecret = process.env.BINANCE_API_SECRET;
  const binanceSymbol = BINANCE_SYMBOL_MAP[trade.symbol];

  if (!binanceSymbol) {
    return {
      success: false,
      error: `Symbol ${trade.symbol} not available on Binance`
    };
  }

  // For BUY positions: SELL to take profit
  // For SELL positions: BUY to cover (take profit)
  const side = trade.action === 'BUY' ? 'SELL' : 'BUY';
  
  // Calculate quantity based on position size
  const positionSizeUSD = parseFloat(process.env.DEFAULT_POSITION_SIZE_USD || '100');
  const quantity = calculateQuantity(trade.symbol, trade.currentPrice, positionSizeUSD);

  if (quantity <= 0) {
    return {
      success: false,
      error: 'Invalid quantity calculated'
    };
  }

  console.log(`📈 Executing TAKE PROFIT: ${side} ${quantity} ${trade.symbol} at $${trade.currentPrice.toFixed(2)}`);
  
  return await executeMarketOrder(binanceSymbol, side, quantity, apiKey, apiSecret);
}

/**
 * Execute Stop Loss order
 * @param {Object} trade - Trade object
 * @returns {Promise<Object>} Execution result
 */
async function executeStopLoss(trade) {
  const config = isExchangeTradingEnabled();
  
  if (!config.enabled) {
    return {
      success: false,
      error: 'Exchange trading not enabled',
      skipped: true
    };
  }

  const apiKey = process.env.BINANCE_API_KEY;
  const apiSecret = process.env.BINANCE_API_SECRET;
  const binanceSymbol = BINANCE_SYMBOL_MAP[trade.symbol];

  if (!binanceSymbol) {
    return {
      success: false,
      error: `Symbol ${trade.symbol} not available on Binance`
    };
  }

  // For BUY positions: SELL to stop loss
  // For SELL positions: BUY to cover (stop loss)
  const side = trade.action === 'BUY' ? 'SELL' : 'BUY';
  
  // Calculate quantity
  const positionSizeUSD = parseFloat(process.env.DEFAULT_POSITION_SIZE_USD || '100');
  const quantity = calculateQuantity(trade.symbol, trade.currentPrice, positionSizeUSD);

  if (quantity <= 0) {
    return {
      success: false,
      error: 'Invalid quantity calculated'
    };
  }

  console.log(`🛑 Executing STOP LOSS: ${side} ${quantity} ${trade.symbol} at $${trade.currentPrice.toFixed(2)}`);
  
  return await executeMarketOrder(binanceSymbol, side, quantity, apiKey, apiSecret);
}

/**
 * Execute Add Position (DCA) order
 * @param {Object} trade - Trade object
 * @returns {Promise<Object>} Execution result
 */
async function executeAddPosition(trade) {
  const config = isExchangeTradingEnabled();
  
  if (!config.enabled) {
    return {
      success: false,
      error: 'Exchange trading not enabled',
      skipped: true
    };
  }

  const apiKey = process.env.BINANCE_API_KEY;
  const apiSecret = process.env.BINANCE_API_SECRET;
  const binanceSymbol = BINANCE_SYMBOL_MAP[trade.symbol];

  if (!binanceSymbol) {
    return {
      success: false,
      error: `Symbol ${trade.symbol} not available on Binance`
    };
  }

  // For BUY positions: BUY more (average down)
  // For SELL positions: SELL more (average up)
  const side = trade.action; // Same direction as original trade
  
  // Calculate quantity for DCA (typically smaller than initial position)
  const dcaSizeUSD = parseFloat(process.env.DCA_POSITION_SIZE_USD || '50'); // Default 50% of initial
  const quantity = calculateQuantity(trade.symbol, trade.currentPrice, dcaSizeUSD);

  if (quantity <= 0) {
    return {
      success: false,
      error: 'Invalid quantity calculated'
    };
  }

  console.log(`💰 Executing ADD POSITION (DCA): ${side} ${quantity} ${trade.symbol} at $${trade.currentPrice.toFixed(2)}`);
  
  return await executeMarketOrder(binanceSymbol, side, quantity, apiKey, apiSecret);
}

module.exports = {
  isExchangeTradingEnabled,
  executeTakeProfit,
  executeStopLoss,
  executeAddPosition,
  getBalance,
  calculateQuantity,
  BINANCE_SYMBOL_MAP
};

