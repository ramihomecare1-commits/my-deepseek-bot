/**
 * Position Sizing Service
 * Calculates optimal position sizes based on risk management rules
 */

const { getPortfolio } = require('./portfolioService');

/**
 * Calculate Average True Range (ATR) for volatility measurement
 * @param {Array} prices - Array of price objects with high, low, close
 * @param {number} period - ATR period (default: 14)
 * @returns {number} ATR value
 */
function calculateATR(prices, period = 14) {
  if (!prices || prices.length < period + 1) {
    return 0;
  }

  const trueRanges = [];
  for (let i = 1; i < prices.length; i++) {
    const high = prices[i].high || prices[i].price || prices[i];
    const low = prices[i].low || prices[i].price || prices[i];
    const prevClose = prices[i - 1].close || prices[i - 1].price || prices[i - 1];

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trueRanges.push(tr);
  }

  // Calculate ATR as SMA of true ranges
  if (trueRanges.length < period) {
    return trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length;
  }

  const recentTRs = trueRanges.slice(-period);
  return recentTRs.reduce((a, b) => a + b, 0) / period;
}

/**
 * Calculate optimal position size based on risk management rules
 * @param {Object} params - Position sizing parameters
 * @param {number} params.entryPrice - Entry price
 * @param {number} params.stopLoss - Stop loss price
 * @param {number} params.riskPerTrade - Risk percentage per trade (default: 0.02 = 2%)
 * @param {number} params.maxPositionSize - Max position size as % of capital (default: 0.10 = 10%)
 * @param {number} params.minPositionSize - Minimum position size in USD (default: 50)
 * @param {boolean} params.useVolatility - Whether to adjust based on volatility (default: true)
 * @param {number} params.volatility - ATR or volatility value (optional)
 * @param {number} params.currentPrice - Current price for volatility calculation
 * @returns {Object} Position sizing result
 */
function calculatePositionSize(params) {
  const {
    entryPrice,
    stopLoss,
    riskPerTrade = 0.02,
    maxPositionSize = 0.10,
    minPositionSize = 50,
    useVolatility = true,
    volatility = null,
    currentPrice = null
  } = params;

  const portfolio = getPortfolio();
  const accountBalance = portfolio.currentBalance || portfolio.initialCapital || 5000;

  // Calculate risk amount (2% of account balance by default)
  const riskAmount = accountBalance * riskPerTrade;

  // Calculate stop loss distance in dollars
  const stopLossDistance = Math.abs(entryPrice - stopLoss);
  const stopLossPercent = (stopLossDistance / entryPrice) * 100;

  // CORRECT position size calculation:
  // Quantity = Risk Amount / Stop Loss Distance (per unit)
  // Position Size USD = Quantity * Entry Price
  const quantity = riskAmount / stopLossDistance;
  let positionSizeUSD = quantity * entryPrice;

  // Adjust for volatility if enabled
  if (useVolatility && volatility && currentPrice) {
    const volatilityPercent = (volatility / currentPrice) * 100;
    // Reduce position size if volatility is high
    if (volatilityPercent > 5) {
      const volatilityMultiplier = Math.max(0.5, 1 - (volatilityPercent - 5) / 20);
      positionSizeUSD *= volatilityMultiplier;
    }
  }

  // Apply maximum position size limit
  const maxPositionUSD = accountBalance * maxPositionSize;
  positionSizeUSD = Math.min(positionSizeUSD, maxPositionUSD);

  // Apply minimum position size
  positionSizeUSD = Math.max(positionSizeUSD, minPositionSize);

  // Recalculate final quantity based on adjusted position size
  const finalQuantity = positionSizeUSD / entryPrice;

  return {
    positionSizeUSD: Math.round(positionSizeUSD * 100) / 100,
    quantity: Math.round(finalQuantity * 1000000) / 1000000, // Round to 6 decimals
    riskAmount: Math.round(riskAmount * 100) / 100,
    stopLossPercent: Math.round(stopLossPercent * 100) / 100,
    riskRewardRatio: null, // Will be calculated if takeProfit is provided
    accountBalance: accountBalance,
    maxPositionUSD: maxPositionUSD
  };
}

/**
 * Calculate position size with risk/reward ratio
 * @param {Object} params - Same as calculatePositionSize plus takeProfit
 * @returns {Object} Position sizing result with risk/reward
 */
function calculatePositionSizeWithRR(params) {
  const result = calculatePositionSize(params);

  if (params.takeProfit) {
    const entryPrice = params.entryPrice;
    const stopLoss = params.stopLoss;
    const takeProfit = params.takeProfit;

    const risk = Math.abs(entryPrice - stopLoss);
    const reward = Math.abs(takeProfit - entryPrice);

    if (risk > 0) {
      result.riskRewardRatio = Math.round((reward / risk) * 100) / 100;
    }
  }

  return result;
}

module.exports = {
  calculateATR,
  calculatePositionSize,
  calculatePositionSizeWithRR
};

