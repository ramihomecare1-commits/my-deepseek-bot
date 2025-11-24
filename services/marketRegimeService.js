/**
 * Market Regime Detection Service
 * Identifies bull/bear/sideways market conditions
 */

const { calculateRSI } = require('../bot/indicators');

/**
 * Market regime types
 */
const REGIME_TYPES = {
  BULL: 'bull',
  BEAR: 'bear',
  SIDEWAYS: 'sideways',
  VOLATILE: 'volatile',
  UNKNOWN: 'unknown'
};

/**
 * Detect market regime from price history
 * @param {Array} priceHistory - Array of historical prices {timestamp, price}
 * @param {Object} globalMetrics - Global market metrics (optional)
 * @returns {Object} Market regime analysis
 */
function detectMarketRegime(priceHistory, globalMetrics = null) {
  if (!priceHistory || priceHistory.length < 20) {
    return {
      regime: REGIME_TYPES.UNKNOWN,
      confidence: 0,
      indicators: {}
    };
  }

  const prices = priceHistory.map(p => p.price || p.close || p.c || 0);
  const recent = prices.slice(-20); // Last 20 periods

  // Calculate trend indicators
  const trendAnalysis = analyzeTrend(recent);
  const volatilityAnalysis = analyzeVolatility(recent);
  const momentumAnalysis = analyzeMomentum(prices);

  // Determine regime
  const regime = determineRegime(trendAnalysis, volatilityAnalysis, momentumAnalysis, globalMetrics);

  return {
    regime: regime.type,
    confidence: regime.confidence,
    indicators: {
      trend: trendAnalysis,
      volatility: volatilityAnalysis,
      momentum: momentumAnalysis
    },
    tradingStrategy: getRegimeStrategy(regime.type),
    timestamp: new Date()
  };
}

/**
 * Analyze price trend
 * @param {Array} prices - Recent price array
 * @returns {Object} Trend analysis
 */
function analyzeTrend(prices) {
  const length = prices.length;
  const firstHalf = prices.slice(0, Math.floor(length / 2));
  const secondHalf = prices.slice(Math.floor(length / 2));

  const firstAvg = firstHalf.reduce((sum, p) => sum + p, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((sum, p) => sum + p, 0) / secondHalf.length;

  const change = ((secondAvg - firstAvg) / firstAvg) * 100;

  // Simple Moving Averages
  const sma10 = prices.slice(-10).reduce((sum, p) => sum + p, 0) / 10;
  const sma20 = prices.reduce((sum, p) => sum + p, 0) / prices.length;

  let direction = 'sideways';
  if (change > 5) {
    direction = 'up';
  } else if (change < -5) {
    direction = 'down';
  }

  // Handle null/NaN values
  const safeChange = isNaN(change) ? 0 : change;
  const safeSma10 = isNaN(sma10) || sma10 === null ? 0 : sma10;
  const safeSma20 = isNaN(sma20) || sma20 === null ? 0 : sma20;

  return {
    direction: direction,
    change: Number(safeChange.toFixed(2)),
    sma10: Number(safeSma10.toFixed(2)),
    sma20: Number(safeSma20.toFixed(2)),
    sma10Above20: safeSma10 > safeSma20
  };
}

/**
 * Analyze volatility
 * @param {Array} prices - Recent price array
 * @returns {Object} Volatility analysis
 */
function analyzeVolatility(prices) {
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }

  // Calculate standard deviation
  const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const squaredDiffs = returns.map(r => Math.pow(r - mean, 2));
  const variance = squaredDiffs.reduce((sum, d) => sum + d, 0) / squaredDiffs.length;
  const stdDev = Math.sqrt(variance) * 100; // As percentage

  let level = 'medium';
  if (stdDev > 5) {
    level = 'extreme';
  } else if (stdDev > 3) {
    level = 'high';
  } else if (stdDev < 1.5) {
    level = 'low';
  }

  return {
    level: level,
    value: Number(stdDev.toFixed(2)),
    isHighVolatility: stdDev > 3
  };
}

/**
 * Analyze momentum
 * @param {Array} prices - Full price array
 * @returns {Object} Momentum analysis
 */
function analyzeMomentum(prices) {
  if (prices.length < 14) {
    return {
      rsi: 50,
      momentum: 'neutral'
    };
  }

  const rsi = calculateRSI(prices, 14);

  // Handle null/undefined RSI (can happen with insufficient data)
  if (rsi === null || rsi === undefined || isNaN(rsi)) {
    return {
      rsi: 50,
      momentum: 'neutral'
    };
  }

  let momentum = 'neutral';
  if (rsi > 70) {
    momentum = 'overbought';
  } else if (rsi > 55) {
    momentum = 'strong';
  } else if (rsi < 30) {
    momentum = 'oversold';
  } else if (rsi < 45) {
    momentum = 'weak';
  }

  return {
    rsi: Number(rsi.toFixed(2)),
    momentum: momentum
  };
}

/**
 * Determine market regime from indicators
 * @param {Object} trend - Trend analysis
 * @param {Object} volatility - Volatility analysis
 * @param {Object} momentum - Momentum analysis
 * @param {Object} globalMetrics - Global metrics (optional)
 * @returns {Object} Regime determination
 */
function determineRegime(trend, volatility, momentum, globalMetrics) {
  let score = 0;
  let confidence = 0;

  // Extreme volatility overrides other factors
  if (volatility.level === 'extreme') {
    return {
      type: REGIME_TYPES.VOLATILE,
      confidence: 0.9
    };
  }

  // Trend scoring
  if (trend.direction === 'up') {
    score += 3;
    confidence += 0.3;
  } else if (trend.direction === 'down') {
    score -= 3;
    confidence += 0.3;
  } else {
    confidence += 0.1;
  }

  // SMA alignment
  if (trend.sma10Above20 && trend.direction === 'up') {
    score += 2;
    confidence += 0.2;
  } else if (!trend.sma10Above20 && trend.direction === 'down') {
    score -= 2;
    confidence += 0.2;
  }

  // Momentum scoring
  if (momentum.momentum === 'strong' || momentum.momentum === 'overbought') {
    score += 1;
    confidence += 0.1;
  } else if (momentum.momentum === 'weak' || momentum.momentum === 'oversold') {
    score -= 1;
    confidence += 0.1;
  }

  // Volatility adjustment
  if (volatility.isHighVolatility) {
    confidence -= 0.2; // Lower confidence in high volatility
  }

  // Global metrics (if available)
  if (globalMetrics && globalMetrics.coinpaprika) {
    const btcDominance = globalMetrics.coinpaprika.bitcoin_dominance_percentage;
    if (btcDominance > 60) {
      // High BTC dominance often indicates alt-coin bear market
      score -= 1;
    } else if (btcDominance < 40) {
      // Low BTC dominance often indicates alt-coin bull market
      score += 1;
    }
    confidence += 0.1;
  }

  // Determine regime type
  let type = REGIME_TYPES.SIDEWAYS;
  if (score >= 4) {
    type = REGIME_TYPES.BULL;
  } else if (score <= -4) {
    type = REGIME_TYPES.BEAR;
  }

  // Clamp confidence
  confidence = Math.max(0, Math.min(1, confidence));

  return {
    type: type,
    confidence: Number(confidence.toFixed(2))
  };
}

/**
 * Get trading strategy for market regime
 * @param {string} regime - Market regime type
 * @returns {Object} Trading strategy recommendations
 */
function getRegimeStrategy(regime) {
  const strategies = {
    [REGIME_TYPES.BULL]: {
      strategy: 'TREND_FOLLOWING',
      advice: 'Focus on breakouts and momentum trades. Buy dips.',
      positionSizing: 'Normal to aggressive',
      stopLoss: 'Wider stops to avoid whipsaws',
      takeProfit: 'Trail profits, let winners run',
      riskReward: 'Can accept lower R:R (1.5:1)',
      preferredSetups: ['Pullback to support', 'Breakout continuation', 'Uptrend reversal']
    },
    [REGIME_TYPES.BEAR]: {
      strategy: 'CAPITAL_PRESERVATION',
      advice: 'Be selective. Wait for strong reversal signals. Protect capital.',
      positionSizing: 'Conservative',
      stopLoss: 'Tight stops',
      takeProfit: 'Take profits quickly',
      riskReward: 'Require higher R:R (2:1+)',
      preferredSetups: ['Oversold bounce', 'Double bottom', 'Bull divergence']
    },
    [REGIME_TYPES.SIDEWAYS]: {
      strategy: 'RANGE_TRADING',
      advice: 'Trade the range. Buy support, sell resistance.',
      positionSizing: 'Normal',
      stopLoss: 'Tight stops at range boundaries',
      takeProfit: 'Quick profits at opposite range boundary',
      riskReward: 'Standard R:R (2:1)',
      preferredSetups: ['Range support bounce', 'Range resistance rejection', 'Breakout of range']
    },
    [REGIME_TYPES.VOLATILE]: {
      strategy: 'WAIT_AND_SEE',
      advice: 'Reduce position sizes. Wait for regime clarity. High risk.',
      positionSizing: 'Very conservative (50% normal)',
      stopLoss: 'Very tight stops',
      takeProfit: 'Very quick profits',
      riskReward: 'Require high R:R (3:1+)',
      preferredSetups: ['Only highest confidence setups', 'Wait for volatility to decrease']
    },
    [REGIME_TYPES.UNKNOWN]: {
      strategy: 'WAIT',
      advice: 'Insufficient data. Wait for clear signals.',
      positionSizing: 'No positions',
      stopLoss: 'N/A',
      takeProfit: 'N/A',
      riskReward: 'N/A',
      preferredSetups: ['Wait for more data']
    }
  };

  return strategies[regime] || strategies[REGIME_TYPES.UNKNOWN];
}

/**
 * Adjust trade parameters based on market regime
 * @param {Object} trade - Trade parameters
 * @param {string} regime - Market regime
 * @returns {Object} Adjusted trade parameters
 */
function adjustTradeForRegime(trade, regime) {
  const strategy = getRegimeStrategy(regime);
  const adjustments = {};

  // Position size adjustment
  if (regime === REGIME_TYPES.VOLATILE) {
    adjustments.positionSizeMultiplier = 0.5;
  } else if (regime === REGIME_TYPES.BEAR) {
    adjustments.positionSizeMultiplier = 0.7;
  } else if (regime === REGIME_TYPES.BULL) {
    adjustments.positionSizeMultiplier = 1.2;
  } else {
    adjustments.positionSizeMultiplier = 1.0;
  }

  // Confidence adjustment
  if (regime === REGIME_TYPES.BULL && trade.direction === 'long') {
    adjustments.confidenceBoost = 0.05;
  } else if (regime === REGIME_TYPES.BEAR && trade.direction === 'short') {
    adjustments.confidenceBoost = 0.05;
  } else if ((regime === REGIME_TYPES.BULL && trade.direction === 'short') ||
    (regime === REGIME_TYPES.BEAR && trade.direction === 'long')) {
    adjustments.confidenceBoost = -0.1;
  } else {
    adjustments.confidenceBoost = 0;
  }

  return {
    ...trade,
    regime: regime,
    regimeStrategy: strategy.strategy,
    adjustments: adjustments,
    regimeAdvice: strategy.advice
  };
}

module.exports = {
  REGIME_TYPES,
  detectMarketRegime,
  getRegimeStrategy,
  adjustTradeForRegime,
  analyzeTrend,
  analyzeVolatility,
  analyzeMomentum
};
