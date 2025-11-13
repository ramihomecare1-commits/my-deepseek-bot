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

// Virtual trading state (in-memory, resets on restart)
let virtualBalance = parseFloat(process.env.VIRTUAL_STARTING_BALANCE || '10000'); // Default $10,000 virtual balance
let virtualPositions = {}; // Track virtual positions
let virtualOrderCounter = 1000000; // Start order IDs from 1,000,000 to distinguish from real orders

/**
 * Check if exchange trading is enabled (real or virtual)
 */
function isExchangeTradingEnabled() {
  const apiKey = process.env.BINANCE_API_KEY || '';
  const apiSecret = process.env.BINANCE_API_SECRET || '';
  const realTradingEnabled = process.env.ENABLE_AUTO_TRADING === 'true' || process.env.ENABLE_AUTO_TRADING === '1';
  const virtualTradingEnabled = process.env.ENABLE_VIRTUAL_TRADING !== 'false'; // Default to true
  
  // Real trading requires API keys
  const realTrading = realTradingEnabled && apiKey.length > 0 && apiSecret.length > 0;
  
  // Virtual trading is default (no API keys needed)
  const virtualTrading = virtualTradingEnabled;
  
  return {
    enabled: realTrading || virtualTrading,
    mode: realTrading ? 'REAL' : 'VIRTUAL',
    realTrading: realTrading,
    virtualTrading: virtualTrading,
    hasApiKey: apiKey.length > 0,
    hasApiSecret: apiSecret.length > 0,
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
    if (side === 'BUY') {
      // Buying: Deduct USDT, add crypto
      if (virtualBalance < cost) {
        return {
          success: false,
          error: 'Insufficient virtual balance',
          virtualBalance: virtualBalance,
          required: cost
        };
      }
      virtualBalance -= cost;
      const baseAsset = symbol.replace('USDT', '');
      virtualPositions[baseAsset] = (virtualPositions[baseAsset] || 0) + quantity;
    } else {
      // Selling: Add USDT, deduct crypto
      const baseAsset = symbol.replace('USDT', '');
      if (!virtualPositions[baseAsset] || virtualPositions[baseAsset] < quantity) {
        return {
          success: false,
          error: `Insufficient ${baseAsset} position`,
          virtualPosition: virtualPositions[baseAsset] || 0,
          required: quantity
        };
      }
      virtualBalance += cost;
      virtualPositions[baseAsset] -= quantity;
      if (virtualPositions[baseAsset] <= 0) {
        delete virtualPositions[baseAsset];
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
  BINANCE_SYMBOL_MAP
};

