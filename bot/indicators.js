// Technical indicator calculations
function calculateRSI(prices, period = 14) {
  if (!prices || !Array.isArray(prices) || prices.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = prices[prices.length - i] - prices[prices.length - i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function calculateBollingerBands(prices, period = 20, multiplier = 2) {
  if (prices.length < period) {
    return placeholderBollinger(prices[prices.length - 1]);
  }
  const slice = prices.slice(-period);
  const mean = slice.reduce((sum, price) => sum + price, 0) / period;
  const variance = slice.reduce((sum, price) => sum + (price - mean) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);

  return {
    upper: mean + multiplier * stdDev,
    lower: mean - multiplier * stdDev,
    middle: mean,
  };
}

function placeholderBollinger(currentPrice) {
  return {
    upper: currentPrice * 1.1,
    lower: currentPrice * 0.9,
    middle: currentPrice,
  };
}

function identifySupportResistance(prices) {
  const recentPrices = prices.slice(-20);
  return {
    support: Math.min(...recentPrices),
    resistance: Math.max(...recentPrices),
  };
}

function identifyTrend(prices) {
  if (prices.length < 3) return 'SIDEWAYS';

  const shortTerm = prices.slice(-3);
  const longTerm = prices.slice(-7);

  const shortTrend = shortTerm[shortTerm.length - 1] - shortTerm[0];
  const longTrend = longTerm[longTerm.length - 1] - longTerm[0];

  if (shortTrend > 0 && longTrend > 0) return 'BULLISH';
  if (shortTrend < 0 && longTrend < 0) return 'BEARISH';
  return 'SIDEWAYS';
}

function getBollingerPosition(price, upperBand, lowerBand) {
  const bandWidth = upperBand - lowerBand;
  if (bandWidth === 0) return 'MIDDLE';

  const position = (price - lowerBand) / bandWidth;
  if (position > 0.8) return 'UPPER';
  if (position < 0.2) return 'LOWER';
  return 'MIDDLE';
}

function calculateMomentum(prices) {
  if (prices.length < 2) return 'NEUTRAL';
  const recentChange = ((prices[prices.length - 1] - prices[prices.length - 2]) / prices[prices.length - 2]) * 100;

  if (recentChange > 2) return 'STRONG_UP';
  if (recentChange > 0.5) return 'UP';
  if (recentChange < -2) return 'STRONG_DOWN';
  if (recentChange < -0.5) return 'DOWN';
  return 'NEUTRAL';
}

module.exports = {
  calculateRSI,
  calculateBollingerBands,
  identifySupportResistance,
  identifyTrend,
  getBollingerPosition,
  calculateMomentum,
  placeholderBollinger
};
