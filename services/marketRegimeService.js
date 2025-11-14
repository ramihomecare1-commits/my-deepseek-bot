/**
 * Market Regime Detection Service
 * Detects market conditions (trending, ranging, volatile, low volatility)
 * and adapts trading strategy accordingly
 */

const { calculateRSI, identifyTrend, calculateBollingerBands } = require('../bot/indicators');

/**
 * Detect market regime based on price action and indicators
 * @param {Array} prices - Array of price data
 * @param {Object} indicators - Pre-calculated indicators (optional)
 * @returns {Object} Market regime classification
 */
function detectMarketRegime(prices, indicators = {}) {
  if (!prices || prices.length < 50) {
    return {
      regime: 'unknown',
      confidence: 0,
      recommendation: {
        minConfidence: 0.65,
        useBreakouts: false,
        useMeanReversion: false,
        reducePositionSize: false,
        increasePositionSize: false
      }
    };
  }
  
  // Extract price values
  const priceValues = prices.map(p => typeof p === 'number' ? p : (p.price || p.close || 0)).filter(p => p > 0);
  
  if (priceValues.length < 50) {
    return {
      regime: 'unknown',
      confidence: 0,
      recommendation: {
        minConfidence: 0.65,
        useBreakouts: false,
        useMeanReversion: false,
        reducePositionSize: false,
        increasePositionSize: false
      }
    };
  }
  
  // Calculate indicators if not provided
  const rsi = indicators.rsi || calculateRSI(priceValues, 14);
  const trend = indicators.trend || identifyTrend(priceValues);
  const bollinger = indicators.bollinger || calculateBollingerBands(priceValues, 20, 2);
  
  // Calculate volatility (standard deviation of returns)
  const returns = [];
  for (let i = 1; i < priceValues.length; i++) {
    returns.push((priceValues[i] - priceValues[i - 1]) / priceValues[i - 1]);
  }
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const volatility = Math.sqrt(variance) * 100; // As percentage
  
  // Calculate trend strength
  const trendStrength = Math.abs(trend.slope || 0);
  const isUptrend = trend.direction === 'BULLISH' || trend.slope > 0;
  const isDowntrend = trend.direction === 'BEARISH' || trend.slope < 0;
  
  // Calculate price range (for ranging detection)
  const recentPrices = priceValues.slice(-20);
  const priceRange = (Math.max(...recentPrices) - Math.min(...recentPrices)) / Math.min(...recentPrices) * 100;
  
  // Calculate Bollinger Band width (for volatility)
  const bbWidth = bollinger.upper && bollinger.lower && bollinger.middle
    ? ((bollinger.upper[bollinger.upper.length - 1] - bollinger.lower[bollinger.lower.length - 1]) / bollinger.middle[bollinger.middle.length - 1]) * 100
    : 0;
  
  // Classify regime
  let regime = 'neutral';
  let confidence = 0.5;
  const recommendation = {
    minConfidence: 0.65,
    useBreakouts: false,
    useMeanReversion: false,
    reducePositionSize: false,
    increasePositionSize: false
  };
  
  // High volatility regime (> 3% daily volatility)
  if (volatility > 3 || bbWidth > 5) {
    regime = 'volatile';
    confidence = 0.7;
    recommendation.minConfidence = 0.80;
    recommendation.reducePositionSize = true;
    recommendation.useBreakouts = false;
  }
  // Low volatility regime (< 1% daily volatility)
  else if (volatility < 1 && bbWidth < 2) {
    regime = 'lowVolatility';
    confidence = 0.6;
    recommendation.minConfidence = 0.60;
    recommendation.increasePositionSize = true;
    recommendation.useMeanReversion = true;
  }
  // Trending regime (strong trend + low range)
  else if (trendStrength > 0.5 && priceRange < 5 && (isUptrend || isDowntrend)) {
    regime = 'trending';
    confidence = 0.75;
    recommendation.minConfidence = 0.65;
    recommendation.useBreakouts = true;
    recommendation.useMeanReversion = false;
  }
  // Ranging regime (weak trend + high range)
  else if (trendStrength < 0.3 && priceRange > 3) {
    regime = 'ranging';
    confidence = 0.7;
    recommendation.minConfidence = 0.75;
    recommendation.useMeanReversion = true;
    recommendation.useBreakouts = false;
  }
  // Neutral/default
  else {
    regime = 'neutral';
    confidence = 0.5;
    recommendation.minConfidence = 0.65;
  }
  
  return {
    regime,
    confidence: Math.round(confidence * 100) / 100,
    metrics: {
      volatility: Math.round(volatility * 100) / 100,
      trendStrength: Math.round(trendStrength * 100) / 100,
      priceRange: Math.round(priceRange * 100) / 100,
      bbWidth: Math.round(bbWidth * 100) / 100,
      rsi: rsi[rsi.length - 1] || 50,
      trendDirection: trend.direction || 'NEUTRAL'
    },
    recommendation
  };
}

/**
 * Get market regime for multiple coins
 * @param {Array} coinsData - Array of coin data with prices
 * @returns {Object} Regime analysis for each coin
 */
function detectMarketRegimes(coinsData) {
  const regimes = {};
  
  coinsData.forEach(coin => {
    if (coin.frames && coin.frames.daily && coin.frames.daily.length > 0) {
      const prices = coin.frames.daily.map(f => f.price || f.close || 0).filter(p => p > 0);
      regimes[coin.symbol] = detectMarketRegime(prices);
    }
  });
  
  return regimes;
}

module.exports = {
  detectMarketRegime,
  detectMarketRegimes
};

