// Technical indicator calculations
// RSI using Wilder's Smoothing Method (matches TradingView standard exactly)
function calculateRSI(prices, period = 14) {
  // Need at least period + 1 prices to calculate RSI
  if (!prices || prices.length < period + 1) {
    return null;
  }

  // Ensure all prices are numbers and valid
  const validPrices = prices
    .map(p => typeof p === 'number' ? p : parseFloat(p))
    .filter(p => !isNaN(p) && isFinite(p) && p > 0);
  
  if (validPrices.length < period + 1) {
    return null;
  }

  // Calculate price changes (deltas)
  const deltas = [];
  for (let i = 1; i < validPrices.length; i++) {
    deltas.push(validPrices[i] - validPrices[i - 1]);
  }

  // Separate gains and losses
  const gains = deltas.map(delta => delta > 0 ? delta : 0);
  const losses = deltas.map(delta => delta < 0 ? -delta : 0);

  // Calculate initial average gain and loss (simple average of first period)
  let sumGain = 0;
  let sumLoss = 0;
  
  for (let i = 0; i < period; i++) {
    sumGain += gains[i];
    sumLoss += losses[i];
  }
  
  let avgGain = sumGain / period;
  let avgLoss = sumLoss / period;

  // Apply Wilder's smoothing for remaining periods
  // Formula: newAvg = (oldAvg * (period - 1) + newValue) / period
  for (let i = period; i < deltas.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }

  // Calculate RSI
  // RSI = 100 - (100 / (1 + RS))
  // RS = Average Gain / Average Loss
  if (avgLoss === 0) {
    // If no losses, RSI is 100
    return 100.0;
  }
  
  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));
  
  // Round to 2 decimal places (TradingView precision)
  // Use proper rounding to match TradingView exactly
  return Math.round(rsi * 100) / 100;
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

// Calculate Fibonacci retracement levels
function calculateFibonacciRetracement(high, low) {
  const diff = high - low;
  return {
    level0: high,           // 100% (high)
    level236: high - (diff * 0.236),  // 23.6%
    level382: high - (diff * 0.382),  // 38.2%
    level500: high - (diff * 0.500),  // 50.0%
    level618: high - (diff * 0.618),  // 61.8%
    level786: high - (diff * 0.786),  // 78.6%
    level100: low,          // 100% (low)
  };
}

// Calculate Fibonacci from price array (finds high and low)
function calculateFibonacciFromPrices(prices, period = 20) {
  if (prices.length < 2) {
    const price = prices[0] || 100;
    return calculateFibonacciRetracement(price * 1.1, price * 0.9);
  }
  
  const recentPrices = prices.slice(-period);
  const high = Math.max(...recentPrices);
  const low = Math.min(...recentPrices);
  
  return calculateFibonacciRetracement(high, low);
}

// Find current price position relative to Fibonacci levels
function getFibonacciPosition(currentPrice, fibLevels) {
  if (currentPrice >= fibLevels.level0) return 'ABOVE_100';
  if (currentPrice >= fibLevels.level236) return '23.6-100';
  if (currentPrice >= fibLevels.level382) return '38.2-23.6';
  if (currentPrice >= fibLevels.level500) return '50.0-38.2';
  if (currentPrice >= fibLevels.level618) return '61.8-50.0';
  if (currentPrice >= fibLevels.level786) return '78.6-61.8';
  if (currentPrice >= fibLevels.level100) return '100-78.6';
  return 'BELOW_100';
}

module.exports = {
  calculateRSI,
  calculateBollingerBands,
  identifySupportResistance,
  identifyTrend,
  getBollingerPosition,
  calculateMomentum,
  calculateFibonacciRetracement,
  calculateFibonacciFromPrices,
  getFibonacciPosition,
  placeholderBollinger
};
