const axios = require('axios');
const crypto = require('crypto');

/**
 * Exchange Service
 * Handles order execution (virtual/paper trading or real Binance)
 * Supports virtual trading mode for testing without real money
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

// Map coin symbols to MEXC trading pairs (same format as Binance)
const MEXC_SYMBOL_MAP = {
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
 * Get preferred exchange for trading
 * Priority: MEXC (if API keys available) > Binance > Virtual
 */
function getPreferredExchange() {
  const mexcApiKey = process.env.MEXC_API_KEY || '';
  const mexcApiSecret = process.env.MEXC_API_SECRET || '';
  const binanceApiKey = process.env.BINANCE_API_KEY || '';
  const binanceApiSecret = process.env.BINANCE_API_SECRET || '';
  
  if (mexcApiKey && mexcApiSecret) {
    return { exchange: 'MEXC', apiKey: mexcApiKey, apiSecret: mexcApiSecret };
  } else if (binanceApiKey && binanceApiSecret) {
    return { exchange: 'BINANCE', apiKey: binanceApiKey, apiSecret: binanceApiSecret };
  }
  
  return { exchange: 'VIRTUAL', apiKey: null, apiSecret: null };
}

// Virtual trading state (in-memory, resets on restart)
let virtualBalance = parseFloat(process.env.VIRTUAL_STARTING_BALANCE || '10000'); // Default $10,000 virtual balance
let virtualPositions = {}; // Track long positions (positive = we own)
let virtualShorts = {}; // Track short positions (positive = we owe/short)
let virtualOrderCounter = 1000000; // Start order IDs from 1,000,000 to distinguish from real orders

/**
 * Check if exchange trading is enabled (real or virtual)
 */
function isExchangeTradingEnabled() {
  const binanceApiKey = process.env.BINANCE_API_KEY || '';
  const binanceApiSecret = process.env.BINANCE_API_SECRET || '';
  const mexcApiKey = process.env.MEXC_API_KEY || '';
  const mexcApiSecret = process.env.MEXC_API_SECRET || '';
  const realTradingEnabled = process.env.ENABLE_AUTO_TRADING === 'true' || process.env.ENABLE_AUTO_TRADING === '1';
  const virtualTradingEnabled = process.env.ENABLE_VIRTUAL_TRADING !== 'false'; // Default to true
  
  // Real trading requires API keys (MEXC or Binance)
  const hasBinanceKeys = binanceApiKey.length > 0 && binanceApiSecret.length > 0;
  const hasMEXCKeys = mexcApiKey.length > 0 && mexcApiSecret.length > 0;
  const realTrading = realTradingEnabled && (hasBinanceKeys || hasMEXCKeys);
  
  // Virtual trading is default (no API keys needed)
  const virtualTrading = virtualTradingEnabled;
  
  const preferredExchange = getPreferredExchange();
  
  return {
    enabled: realTrading || virtualTrading,
    mode: realTrading ? 'REAL' : 'VIRTUAL',
    realTrading: realTrading,
    virtualTrading: virtualTrading,
    preferredExchange: preferredExchange.exchange,
    hasBinanceKeys: hasBinanceKeys,
    hasMEXCKeys: hasMEXCKeys,
    virtualBalance: virtualTrading ? virtualBalance : null
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
 * Execute a virtual market order (paper trading - no real money)
 * @param {string} symbol - Trading pair symbol (e.g., 'BTCUSDT')
 * @param {string} side - 'BUY' or 'SELL'
 * @param {number} quantity - Amount to trade
 * @param {number} price - Current market price
 * @returns {Promise<Object>} Simulated order result
 */
async function executeVirtualMarketOrder(symbol, side, quantity, price) {
  try {
    // Simulate small slippage (0.1% for market orders)
    const slippage = 0.001;
    const executionPrice = side === 'BUY' 
      ? price * (1 + slippage)  // Buy slightly higher
      : price * (1 - slippage); // Sell slightly lower
    
    const orderId = virtualOrderCounter++;
    const cost = quantity * executionPrice;
    
    // Update virtual balance and positions
    const baseAsset = symbol.replace('USDT', '');
    
    if (side === 'BUY') {
      // Buying: Could be opening long OR covering short
      if (virtualShorts[baseAsset] && virtualShorts[baseAsset] > 0) {
        // Covering a short position
        const coverAmount = Math.min(quantity, virtualShorts[baseAsset]);
        virtualShorts[baseAsset] -= coverAmount;
        if (virtualShorts[baseAsset] <= 0) {
          delete virtualShorts[baseAsset];
        }
        // Pay to cover (deduct USDT)
        if (virtualBalance < cost) {
          return {
            success: false,
            error: 'Insufficient virtual balance to cover short',
            virtualBalance: virtualBalance,
            required: cost
          };
        }
        virtualBalance -= cost;
      } else {
        // Opening a long position
        if (virtualBalance < cost) {
          return {
            success: false,
            error: 'Insufficient virtual balance',
            virtualBalance: virtualBalance,
            required: cost
          };
        }
        virtualBalance -= cost;
        virtualPositions[baseAsset] = (virtualPositions[baseAsset] || 0) + quantity;
      }
    } else {
      // Selling: Could be closing long OR opening short
      if (virtualPositions[baseAsset] && virtualPositions[baseAsset] > 0) {
        // Closing a long position
        const sellAmount = Math.min(quantity, virtualPositions[baseAsset]);
        virtualPositions[baseAsset] -= sellAmount;
        if (virtualPositions[baseAsset] <= 0) {
          delete virtualPositions[baseAsset];
        }
        // Get USDT from sale
        virtualBalance += cost;
      } else {
        // Opening a short position (we don't own it, so we short it)
        virtualShorts[baseAsset] = (virtualShorts[baseAsset] || 0) + quantity;
        // Get USDT from short sale
        virtualBalance += cost;
      }
    }
    
    // Simulate order execution delay
    await new Promise(resolve => setTimeout(resolve, 100));
    
    return {
      success: true,
      orderId: orderId,
      symbol: symbol,
      side: side,
      executedQty: quantity,
      price: executionPrice,
      status: 'FILLED',
      mode: 'VIRTUAL',
      virtualBalance: virtualBalance,
      virtualPositions: { ...virtualPositions }
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      mode: 'VIRTUAL'
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
 * Execute Take Profit order
 * @param {Object} trade - Trade object
 * @returns {Promise<Object>} Execution result
 */
async function executeTakeProfit(trade) {
  const config = isExchangeTradingEnabled();
  
  if (!config.enabled) {
    return {
      success: false,
      error: 'Trading not enabled. Set ENABLE_VIRTUAL_TRADING=true (default) or ENABLE_AUTO_TRADING=true with API keys',
      skipped: true
    };
  }

  const binanceSymbol = BINANCE_SYMBOL_MAP[trade.symbol];

  if (!binanceSymbol) {
    return {
      success: false,
      error: `Symbol ${trade.symbol} not available on Binance`
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

  console.log(`📈 Executing TAKE PROFIT (${config.mode}): ${side} ${quantity} ${trade.symbol} at $${trade.currentPrice.toFixed(2)}`);
  
  // Use virtual trading if real trading is not enabled
  if (config.mode === 'VIRTUAL') {
    return await executeVirtualMarketOrder(binanceSymbol, side, quantity, trade.currentPrice);
  } else {
    const apiKey = process.env.BINANCE_API_KEY;
    const apiSecret = process.env.BINANCE_API_SECRET;
    return await executeMarketOrder(binanceSymbol, side, quantity, apiKey, apiSecret);
  }
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
      error: 'Trading not enabled. Set ENABLE_VIRTUAL_TRADING=true (default) or ENABLE_AUTO_TRADING=true with API keys',
      skipped: true
    };
  }

  const binanceSymbol = BINANCE_SYMBOL_MAP[trade.symbol];

  if (!binanceSymbol) {
    return {
      success: false,
      error: `Symbol ${trade.symbol} not available on Binance`
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

  console.log(`🛑 Executing STOP LOSS (${config.mode}): ${side} ${quantity} ${trade.symbol} at $${trade.currentPrice.toFixed(2)}`);
  
  // Use virtual trading if real trading is not enabled
  if (config.mode === 'VIRTUAL') {
    return await executeVirtualMarketOrder(binanceSymbol, side, quantity, trade.currentPrice);
  } else {
    const apiKey = process.env.BINANCE_API_KEY;
    const apiSecret = process.env.BINANCE_API_SECRET;
    return await executeMarketOrder(binanceSymbol, side, quantity, apiKey, apiSecret);
  }
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
      error: 'Trading not enabled. Set ENABLE_VIRTUAL_TRADING=true (default) or ENABLE_AUTO_TRADING=true with API keys',
      skipped: true
    };
  }

  const binanceSymbol = BINANCE_SYMBOL_MAP[trade.symbol];

  if (!binanceSymbol) {
    return {
      success: false,
      error: `Symbol ${trade.symbol} not available on Binance`
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

  // For BUY positions: BUY more (average down)
  // For SELL positions: SELL more (average up)
  const side = trade.action; // Same direction as original trade
  
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

  console.log(`💰 Executing ADD POSITION (DCA) (${config.mode}): ${side} ${quantity} ${trade.symbol} at $${trade.currentPrice.toFixed(2)}`);
  
  // Use virtual trading if real trading is not enabled
  if (config.mode === 'VIRTUAL') {
    return await executeVirtualMarketOrder(binanceSymbol, side, quantity, trade.currentPrice);
  } else {
    const apiKey = process.env.BINANCE_API_KEY;
    const apiSecret = process.env.BINANCE_API_SECRET;
    return await executeMarketOrder(binanceSymbol, side, quantity, apiKey, apiSecret);
  }
}

/**
 * Get virtual trading balance and positions
 * @returns {Object} Virtual trading state
 */
function getVirtualTradingState() {
  return {
    balance: virtualBalance,
    positions: { ...virtualPositions },
    totalValue: virtualBalance + Object.keys(virtualPositions).reduce((sum, asset) => {
      // Note: This is a simplified calculation - in real implementation,
      // you'd need current prices to calculate total portfolio value
      return sum;
    }, 0)
  };
}

/**
 * Reset virtual trading state (for testing)
 */
function resetVirtualTrading() {
  virtualBalance = parseFloat(process.env.VIRTUAL_STARTING_BALANCE || '10000');
  virtualPositions = {};
  virtualShorts = {};
  virtualOrderCounter = 1000000;
}

module.exports = {
  isExchangeTradingEnabled,
  executeTakeProfit,
  executeStopLoss,
  executeAddPosition,
  getBalance,
  calculateQuantity,
  getVirtualTradingState,
  resetVirtualTrading,
  getPreferredExchange,
  BINANCE_SYMBOL_MAP,
  MEXC_SYMBOL_MAP
};

