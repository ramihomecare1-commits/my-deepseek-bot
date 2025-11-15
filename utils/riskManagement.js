/**
 * Risk Management Utilities
 * Position sizing and risk calculation
 */

const { calculatePositionSize, calculateRiskPercent, calculateRiskRewardRatio } = require('./tradeMath');

/**
 * Risk Management Configuration
 */
const RISK_CONFIG = {
  // Maximum percentage of account to risk per trade
  MAX_RISK_PER_TRADE: 2.0, // 2%
  
  // Default risk percentage
  DEFAULT_RISK_PER_TRADE: 1.0, // 1%
  
  // Maximum percentage of account in open trades
  MAX_TOTAL_EXPOSURE: 10.0, // 10%
  
  // Minimum risk/reward ratio
  MIN_RISK_REWARD: 1.5,
  
  // Maximum number of concurrent trades
  MAX_CONCURRENT_TRADES: 5,
  
  // Maximum correlation between trades
  MAX_CORRELATION: 0.7,
  
  // Volatility adjustment factors
  VOLATILITY_LOW: 1.2,     // Increase position size in low volatility
  VOLATILITY_MEDIUM: 1.0,  // Normal position size
  VOLATILITY_HIGH: 0.7,    // Decrease position size in high volatility
  VOLATILITY_EXTREME: 0.5  // Significantly decrease in extreme volatility
};

/**
 * Calculate optimal position size based on risk management
 * @param {Object} params
 * @param {number} params.accountBalance - Total account balance
 * @param {number} params.entryPrice - Entry price
 * @param {number} params.stopLoss - Stop loss price
 * @param {number} params.volatility - Current volatility (optional)
 * @param {number} params.openTradesCount - Number of open trades (optional)
 * @param {number} params.totalExposure - Current total exposure percentage (optional)
 * @returns {Object} Position sizing recommendation
 */
function calculateOptimalPositionSize(params) {
  const {
    accountBalance,
    entryPrice,
    stopLoss,
    volatility = 0,
    openTradesCount = 0,
    totalExposure = 0
  } = params;

  // Base risk percentage
  let riskPercent = RISK_CONFIG.DEFAULT_RISK_PER_TRADE;

  // Adjust for number of open trades
  if (openTradesCount >= RISK_CONFIG.MAX_CONCURRENT_TRADES) {
    return {
      allowed: false,
      reason: 'Maximum concurrent trades reached',
      positionSize: 0,
      riskAmount: 0
    };
  }

  // Adjust for total exposure
  if (totalExposure >= RISK_CONFIG.MAX_TOTAL_EXPOSURE) {
    return {
      allowed: false,
      reason: 'Maximum total exposure reached',
      positionSize: 0,
      riskAmount: 0
    };
  }

  // Adjust for volatility
  let volatilityMultiplier = RISK_CONFIG.VOLATILITY_MEDIUM;
  if (volatility > 8) {
    volatilityMultiplier = RISK_CONFIG.VOLATILITY_EXTREME;
  } else if (volatility > 5) {
    volatilityMultiplier = RISK_CONFIG.VOLATILITY_HIGH;
  } else if (volatility < 2) {
    volatilityMultiplier = RISK_CONFIG.VOLATILITY_LOW;
  }

  // Adjust risk based on volatility
  riskPercent = Math.min(
    riskPercent * volatilityMultiplier,
    RISK_CONFIG.MAX_RISK_PER_TRADE
  );

  // Calculate position size
  const positionSize = calculatePositionSize(accountBalance, riskPercent, entryPrice, stopLoss);
  const riskAmount = accountBalance * (riskPercent / 100);
  const positionValue = positionSize * entryPrice;
  const positionPercent = (positionValue / accountBalance) * 100;

  return {
    allowed: true,
    positionSize: positionSize,
    riskAmount: riskAmount,
    riskPercent: riskPercent,
    positionValue: positionValue,
    positionPercent: positionPercent,
    volatilityMultiplier: volatilityMultiplier,
    recommendation: getPositionSizeRecommendation(positionPercent, riskPercent, volatility)
  };
}

/**
 * Get position size recommendation
 * @param {number} positionPercent - Position size as percentage of account
 * @param {number} riskPercent - Risk as percentage of account
 * @param {number} volatility - Current volatility
 * @returns {string} Recommendation text
 */
function getPositionSizeRecommendation(positionPercent, riskPercent, volatility) {
  if (volatility > 8) {
    return `EXTREME volatility (${volatility.toFixed(1)}%) - reduced position size to ${riskPercent.toFixed(1)}% risk`;
  } else if (volatility > 5) {
    return `HIGH volatility (${volatility.toFixed(1)}%) - reduced position size to ${riskPercent.toFixed(1)}% risk`;
  } else if (volatility < 2) {
    return `LOW volatility (${volatility.toFixed(1)}%) - increased position size to ${riskPercent.toFixed(1)}% risk`;
  } else {
    return `NORMAL volatility (${volatility.toFixed(1)}%) - standard position size at ${riskPercent.toFixed(1)}% risk`;
  }
}

/**
 * Validate trade setup meets risk management criteria
 * @param {Object} trade - Trade setup
 * @returns {Object} Validation result
 */
function validateTradeSetup(trade) {
  const {
    entryPrice,
    stopLoss,
    takeProfit,
    symbol
  } = trade;

  const errors = [];
  const warnings = [];

  // Check if prices are valid
  if (!entryPrice || entryPrice <= 0) {
    errors.push('Invalid entry price');
  }
  if (!stopLoss || stopLoss <= 0) {
    errors.push('Invalid stop loss');
  }
  if (!takeProfit || takeProfit <= 0) {
    errors.push('Invalid take profit');
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors: errors,
      warnings: warnings
    };
  }

  // Calculate risk/reward
  const riskReward = calculateRiskRewardRatio(entryPrice, stopLoss, takeProfit, true);

  // Check minimum risk/reward
  if (riskReward < RISK_CONFIG.MIN_RISK_REWARD) {
    errors.push(`Risk/Reward ratio ${riskReward.toFixed(2)} is below minimum ${RISK_CONFIG.MIN_RISK_REWARD}`);
  }

  // Check if stop loss is too tight
  const riskPercent = calculateRiskPercent(entryPrice, stopLoss, true);
  if (riskPercent < 1) {
    warnings.push(`Stop loss is very tight (${riskPercent.toFixed(2)}%) - may get stopped out prematurely`);
  }

  // Check if stop loss is too wide
  if (riskPercent > 10) {
    warnings.push(`Stop loss is very wide (${riskPercent.toFixed(2)}%) - consider tighter stop`);
  }

  return {
    valid: errors.length === 0,
    errors: errors,
    warnings: warnings,
    riskReward: riskReward,
    riskPercent: riskPercent
  };
}

/**
 * Calculate correlation between two symbols (simplified)
 * @param {Array} priceHistory1 - Price history for symbol 1
 * @param {Array} priceHistory2 - Price history for symbol 2
 * @returns {number} Correlation coefficient (-1 to 1)
 */
function calculateCorrelation(priceHistory1, priceHistory2) {
  if (!priceHistory1 || !priceHistory2 || priceHistory1.length !== priceHistory2.length) {
    return 0;
  }

  const n = Math.min(priceHistory1.length, priceHistory2.length);
  if (n < 2) return 0;

  // Calculate means
  const mean1 = priceHistory1.reduce((sum, p) => sum + p, 0) / n;
  const mean2 = priceHistory2.reduce((sum, p) => sum + p, 0) / n;

  // Calculate correlation
  let numerator = 0;
  let sum1Sq = 0;
  let sum2Sq = 0;

  for (let i = 0; i < n; i++) {
    const diff1 = priceHistory1[i] - mean1;
    const diff2 = priceHistory2[i] - mean2;
    numerator += diff1 * diff2;
    sum1Sq += diff1 * diff1;
    sum2Sq += diff2 * diff2;
  }

  const denominator = Math.sqrt(sum1Sq * sum2Sq);
  return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * Check if adding a new trade would violate correlation limits
 * @param {Object} newTrade - New trade to check
 * @param {Array} existingTrades - Existing open trades
 * @param {Object} priceHistories - Historical prices for all symbols
 * @returns {Object} Correlation check result
 */
function checkTradeCorrelation(newTrade, existingTrades, priceHistories) {
  if (!existingTrades || existingTrades.length === 0) {
    return {
      allowed: true,
      maxCorrelation: 0,
      correlatedSymbols: []
    };
  }

  const newSymbol = newTrade.symbol;
  const correlatedSymbols = [];
  let maxCorrelation = 0;

  for (const trade of existingTrades) {
    if (trade.symbol === newSymbol) {
      continue; // Same symbol, skip
    }

    // Get price histories
    const history1 = priceHistories[newSymbol] || [];
    const history2 = priceHistories[trade.symbol] || [];

    const correlation = Math.abs(calculateCorrelation(history1, history2));

    if (correlation > maxCorrelation) {
      maxCorrelation = correlation;
    }

    if (correlation > RISK_CONFIG.MAX_CORRELATION) {
      correlatedSymbols.push({
        symbol: trade.symbol,
        correlation: correlation
      });
    }
  }

  return {
    allowed: correlatedSymbols.length === 0,
    maxCorrelation: maxCorrelation,
    correlatedSymbols: correlatedSymbols,
    warning: correlatedSymbols.length > 0 
      ? `High correlation with ${correlatedSymbols.map(c => c.symbol).join(', ')}`
      : null
  };
}

module.exports = {
  RISK_CONFIG,
  calculateOptimalPositionSize,
  validateTradeSetup,
  calculateCorrelation,
  checkTradeCorrelation,
  getPositionSizeRecommendation
};

