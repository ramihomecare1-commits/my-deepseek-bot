/**
 * Trading Mathematics Utilities
 * Centralized calculations to reduce repeated code
 */

/**
 * Calculate risk percentage between entry and stop loss
 * @param {number} entryPrice - Entry price
 * @param {number} stopLoss - Stop loss price
 * @param {boolean} isLong - Is this a long position?
 * @returns {number} Risk percentage
 */
function calculateRiskPercent(entryPrice, stopLoss, isLong = true) {
  if (isLong) {
    return ((entryPrice - stopLoss) / entryPrice) * 100;
  } else {
    return ((stopLoss - entryPrice) / entryPrice) * 100;
  }
}

/**
 * Calculate reward percentage between entry and take profit
 * @param {number} entryPrice - Entry price
 * @param {number} takeProfit - Take profit price
 * @param {boolean} isLong - Is this a long position?
 * @returns {number} Reward percentage
 */
function calculateRewardPercent(entryPrice, takeProfit, isLong = true) {
  if (isLong) {
    return ((takeProfit - entryPrice) / entryPrice) * 100;
  } else {
    return ((entryPrice - takeProfit) / entryPrice) * 100;
  }
}

/**
 * Calculate risk/reward ratio
 * @param {number} entryPrice - Entry price
 * @param {number} stopLoss - Stop loss price
 * @param {number} takeProfit - Take profit price
 * @param {boolean} isLong - Is this a long position?
 * @returns {number} Risk/reward ratio
 */
function calculateRiskRewardRatio(entryPrice, stopLoss, takeProfit, isLong = true) {
  const risk = Math.abs(calculateRiskPercent(entryPrice, stopLoss, isLong));
  const reward = Math.abs(calculateRewardPercent(entryPrice, takeProfit, isLong));
  return reward / risk;
}

/**
 * Calculate position size based on risk management
 * @param {number} accountBalance - Total account balance
 * @param {number} riskPercent - Percentage of account to risk (e.g., 1 = 1%)
 * @param {number} entryPrice - Entry price
 * @param {number} stopLoss - Stop loss price
 * @returns {number} Position size in units
 */
function calculatePositionSize(accountBalance, riskPercent, entryPrice, stopLoss) {
  const riskAmount = accountBalance * (riskPercent / 100);
  const riskPerUnit = Math.abs(entryPrice - stopLoss);
  if (riskPerUnit === 0) return 0;
  return riskAmount / riskPerUnit;
}

/**
 * Calculate new stop loss price from percentage
 * @param {number} currentPrice - Current price
 * @param {number} stopLossPercent - Stop loss percentage (e.g., 5 = 5%)
 * @param {boolean} isLong - Is this a long position?
 * @returns {number} Stop loss price
 */
function calculateStopLossPrice(currentPrice, stopLossPercent, isLong = true) {
  if (isLong) {
    return currentPrice * (1 - stopLossPercent / 100);
  } else {
    return currentPrice * (1 + stopLossPercent / 100);
  }
}

/**
 * Calculate new take profit price from percentage
 * @param {number} currentPrice - Current price
 * @param {number} takeProfitPercent - Take profit percentage (e.g., 10 = 10%)
 * @param {boolean} isLong - Is this a long position?
 * @returns {number} Take profit price
 */
function calculateTakeProfitPrice(currentPrice, takeProfitPercent, isLong = true) {
  if (isLong) {
    return currentPrice * (1 + takeProfitPercent / 100);
  } else {
    return currentPrice * (1 - takeProfitPercent / 100);
  }
}

/**
 * Calculate profit/loss percentage
 * @param {number} entryPrice - Entry price
 * @param {number} currentPrice - Current price
 * @param {boolean} isLong - Is this a long position?
 * @returns {number} P/L percentage
 */
function calculateProfitLossPercent(entryPrice, currentPrice, isLong = true) {
  if (isLong) {
    return ((currentPrice - entryPrice) / entryPrice) * 100;
  } else {
    return ((entryPrice - currentPrice) / entryPrice) * 100;
  }
}

/**
 * Calculate profit/loss in USD
 * @param {number} entryPrice - Entry price
 * @param {number} currentPrice - Current price
 * @param {number} quantity - Position size
 * @param {boolean} isLong - Is this a long position?
 * @returns {number} P/L in USD
 */
function calculateProfitLossUSD(entryPrice, currentPrice, quantity, isLong = true) {
  if (isLong) {
    return (currentPrice - entryPrice) * quantity;
  } else {
    return (entryPrice - currentPrice) * quantity;
  }
}

/**
 * Calculate Average True Range (ATR) from candles
 * @param {Array} candles - Array of OHLC candles
 * @param {number} period - ATR period (default 14)
 * @returns {number} ATR value
 */
function calculateATR(candles, period = 14) {
  if (!candles || candles.length < period) return 0;
  
  const trueRanges = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high || candles[i].h || 0;
    const low = candles[i].low || candles[i].l || 0;
    const prevClose = candles[i - 1].close || candles[i - 1].c || 0;
    
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trueRanges.push(tr);
  }
  
  // Simple Moving Average of True Ranges
  const recentTR = trueRanges.slice(-period);
  return recentTR.reduce((sum, tr) => sum + tr, 0) / recentTR.length;
}

/**
 * Calculate dynamic stop loss based on ATR
 * @param {number} currentPrice - Current price
 * @param {number} atr - Average True Range
 * @param {number} multiplier - ATR multiplier (default 2)
 * @param {boolean} isLong - Is this a long position?
 * @returns {number} Stop loss price
 */
function calculateATRStopLoss(currentPrice, atr, multiplier = 2, isLong = true) {
  if (isLong) {
    return currentPrice - (atr * multiplier);
  } else {
    return currentPrice + (atr * multiplier);
  }
}

/**
 * Calculate dynamic take profit based on ATR
 * @param {number} currentPrice - Current price
 * @param {number} atr - Average True Range
 * @param {number} multiplier - ATR multiplier (default 3)
 * @param {boolean} isLong - Is this a long position?
 * @returns {number} Take profit price
 */
function calculateATRTakeProfit(currentPrice, atr, multiplier = 3, isLong = true) {
  if (isLong) {
    return currentPrice + (atr * multiplier);
  } else {
    return currentPrice - (atr * multiplier);
  }
}

/**
 * Calculate percentage distance from price to target
 * @param {number} currentPrice - Current price
 * @param {number} targetPrice - Target price
 * @returns {number} Distance percentage
 */
function calculatePriceDistance(currentPrice, targetPrice) {
  return Math.abs(((targetPrice - currentPrice) / currentPrice) * 100);
}

module.exports = {
  calculateRiskPercent,
  calculateRewardPercent,
  calculateRiskRewardRatio,
  calculatePositionSize,
  calculateStopLossPrice,
  calculateTakeProfitPrice,
  calculateProfitLossPercent,
  calculateProfitLossUSD,
  calculateATR,
  calculateATRStopLoss,
  calculateATRTakeProfit,
  calculatePriceDistance
};

