// Trading pattern detection functions

/**
 * Detect parallel channels (ascending/descending/horizontal)
 * Parallel channels have two parallel trend lines
 */
function detectParallelChannel(prices, period = 20) {
  if (prices.length < period) return null;
  
  const recentPrices = prices.slice(-period);
  // Handle different price data formats
  const highs = recentPrices.map(p => {
    if (typeof p === 'number') return p;
    return p.high || p.price || (typeof p === 'object' && p.value) || 0;
  });
  const lows = recentPrices.map(p => {
    if (typeof p === 'number') return p;
    return p.low || p.price || (typeof p === 'object' && p.value) || 0;
  });
  
  // Find highest highs and lowest lows
  const highestHigh = Math.max(...highs);
  const lowestLow = Math.min(...lows);
  const highIndex = highs.indexOf(highestHigh);
  const lowIndex = lows.indexOf(lowestLow);
  
  // Calculate trend lines
  const highTrend = calculateTrendLine(highs, highIndex);
  const lowTrend = calculateTrendLine(lows, lowIndex);
  
  // Check if lines are parallel (similar slopes)
  const slopeDiff = Math.abs(highTrend.slope - lowTrend.slope);
  const avgSlope = (Math.abs(highTrend.slope) + Math.abs(lowTrend.slope)) / 2;
  const isParallel = slopeDiff < (avgSlope * 0.3); // Within 30% difference
  
  if (!isParallel) return null;
  
  // Determine channel type
  let channelType = 'HORIZONTAL';
  if (highTrend.slope > 0.001) channelType = 'ASCENDING';
  else if (highTrend.slope < -0.001) channelType = 'DESCENDING';
  
  return {
    pattern: 'PARALLEL_CHANNEL',
    type: channelType,
    upperLine: highTrend,
    lowerLine: lowTrend,
    width: highestHigh - lowestLow,
    confidence: isParallel ? 0.7 : 0.4,
    signal: channelType === 'ASCENDING' ? 'BULLISH' : channelType === 'DESCENDING' ? 'BEARISH' : 'NEUTRAL'
  };
}

/**
 * Detect Head and Shoulders pattern
 * H-S-H pattern where middle peak (head) is higher than two side peaks (shoulders)
 */
function detectHeadAndShoulders(prices, period = 30) {
  if (prices.length < period) return null;
  
  const recentPrices = prices.slice(-period);
  const priceValues = recentPrices.map(p => {
    if (typeof p === 'number') return p;
    return p.price || (typeof p === 'object' && p.value) || 0;
  });
  
  // Find local peaks
  const peaks = findLocalPeaks(priceValues, 3);
  if (peaks.length < 3) return null;
  
  // Sort peaks by value (highest first)
  const sortedPeaks = peaks.sort((a, b) => b.value - a.value);
  
  // Check for H-S-H pattern: middle peak should be highest
  if (sortedPeaks.length >= 3) {
    const head = sortedPeaks[0];
    const leftShoulder = sortedPeaks.find(p => p.index < head.index);
    const rightShoulder = sortedPeaks.find(p => p.index > head.index);
    
    if (leftShoulder && rightShoulder) {
      const shoulderAvg = (leftShoulder.value + rightShoulder.value) / 2;
      const headHeight = head.value - shoulderAvg;
      
      // Head should be at least 2% higher than average shoulder
      if (head.value > shoulderAvg * 1.02) {
        return {
          pattern: 'HEAD_AND_SHOULDERS',
          type: 'BEARISH',
          head: head,
          leftShoulder: leftShoulder,
          rightShoulder: rightShoulder,
          neckline: shoulderAvg,
          confidence: Math.min(0.8, 0.5 + (headHeight / head.value)),
          signal: 'BEARISH'
        };
      }
    }
  }
  
  // Check for inverse H-S-H (bottom pattern)
  const sortedTroughs = peaks.sort((a, b) => a.value - b.value);
  if (sortedTroughs.length >= 3) {
    const head = sortedTroughs[0];
    const leftShoulder = sortedTroughs.find(p => p.index < head.index);
    const rightShoulder = sortedTroughs.find(p => p.index > head.index);
    
    if (leftShoulder && rightShoulder) {
      const shoulderAvg = (leftShoulder.value + rightShoulder.value) / 2;
      const headDepth = shoulderAvg - head.value;
      
      if (head.value < shoulderAvg * 0.98) {
        return {
          pattern: 'INVERSE_HEAD_AND_SHOULDERS',
          type: 'BULLISH',
          head: head,
          leftShoulder: leftShoulder,
          rightShoulder: rightShoulder,
          neckline: shoulderAvg,
          confidence: Math.min(0.8, 0.5 + (headDepth / head.value)),
          signal: 'BULLISH'
        };
      }
    }
  }
  
  return null;
}

/**
 * Detect triangle patterns (ascending, descending, symmetrical)
 */
function detectTriangle(prices, period = 20) {
  if (prices.length < period) return null;
  
  const recentPrices = prices.slice(-period);
  const highs = recentPrices.map(p => {
    if (typeof p === 'number') return p;
    return p.high || p.price || (typeof p === 'object' && p.value) || 0;
  });
  const lows = recentPrices.map(p => {
    if (typeof p === 'number') return p;
    return p.low || p.price || (typeof p === 'object' && p.value) || 0;
  });
  
  // Calculate trend lines for highs and lows
  const highTrend = calculateTrendLine(highs);
  const lowTrend = calculateTrendLine(lows);
  
  // Check if lines are converging
  const convergence = Math.abs(highTrend.slope - lowTrend.slope);
  
  if (convergence < 0.0001) return null; // Lines are parallel, not a triangle
  
  // Determine triangle type
  let triangleType = 'SYMMETRICAL';
  if (highTrend.slope < -0.001 && lowTrend.slope > 0.001) {
    triangleType = 'ASCENDING'; // Rising lows, flat/falling highs
  } else if (highTrend.slope < -0.001 && lowTrend.slope < 0.001) {
    triangleType = 'DESCENDING'; // Falling highs, flat/falling lows
  }
  
  return {
    pattern: 'TRIANGLE',
    type: triangleType,
    upperTrend: highTrend,
    lowerTrend: lowTrend,
    convergence: convergence,
    confidence: 0.6,
    signal: triangleType === 'ASCENDING' ? 'BULLISH' : triangleType === 'DESCENDING' ? 'BEARISH' : 'NEUTRAL'
  };
}

/**
 * Detect wedge patterns (rising/falling)
 */
function detectWedge(prices, period = 20) {
  if (prices.length < period) return null;
  
  const recentPrices = prices.slice(-period);
  const highs = recentPrices.map(p => {
    if (typeof p === 'number') return p;
    return p.high || p.price || (typeof p === 'object' && p.value) || 0;
  });
  const lows = recentPrices.map(p => {
    if (typeof p === 'number') return p;
    return p.low || p.price || (typeof p === 'object' && p.value) || 0;
  });
  
  const highTrend = calculateTrendLine(highs);
  const lowTrend = calculateTrendLine(lows);
  
  // Both lines should be moving in same direction
  const bothRising = highTrend.slope > 0 && lowTrend.slope > 0;
  const bothFalling = highTrend.slope < 0 && lowTrend.slope < 0;
  
  if (!bothRising && !bothFalling) return null;
  
  // Lines should be converging
  const convergence = Math.abs(highTrend.slope - lowTrend.slope);
  
  return {
    pattern: 'WEDGE',
    type: bothRising ? 'RISING' : 'FALLING',
    upperTrend: highTrend,
    lowerTrend: lowTrend,
    confidence: 0.65,
    signal: bothRising ? 'BEARISH' : 'BULLISH' // Rising wedge is bearish, falling is bullish
  };
}

/**
 * Detect double top/bottom patterns
 */
function detectDoubleTopBottom(prices, period = 30) {
  if (prices.length < period) return null;
  
  const recentPrices = prices.slice(-period);
  const priceValues = recentPrices.map(p => {
    if (typeof p === 'number') return p;
    return p.price || (typeof p === 'object' && p.value) || 0;
  });
  
  const peaks = findLocalPeaks(priceValues, 2);
  const troughs = findLocalTroughs(priceValues, 2);
  
  // Check for double top
  if (peaks.length >= 2) {
    const peak1 = peaks[0];
    const peak2 = peaks[1];
    const priceDiff = Math.abs(peak1.value - peak2.value) / peak1.value;
    
    if (priceDiff < 0.02) { // Within 2%
      return {
        pattern: 'DOUBLE_TOP',
        type: 'BEARISH',
        peak1: peak1,
        peak2: peak2,
        resistance: (peak1.value + peak2.value) / 2,
        confidence: 0.7,
        signal: 'BEARISH'
      };
    }
  }
  
  // Check for double bottom
  if (troughs.length >= 2) {
    const trough1 = troughs[0];
    const trough2 = troughs[1];
    const priceDiff = Math.abs(trough1.value - trough2.value) / trough1.value;
    
    if (priceDiff < 0.02) { // Within 2%
      return {
        pattern: 'DOUBLE_BOTTOM',
        type: 'BULLISH',
        trough1: trough1,
        trough2: trough2,
        support: (trough1.value + trough2.value) / 2,
        confidence: 0.7,
        signal: 'BULLISH'
      };
    }
  }
  
  return null;
}

// Helper functions
function calculateTrendLine(values, startIndex = 0) {
  const n = values.length - startIndex;
  if (n < 2) return { slope: 0, intercept: values[0] || 0 };
  
  const x = Array.from({ length: n }, (_, i) => i);
  const y = values.slice(startIndex);
  
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
  const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);
  
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  
  return { slope, intercept };
}

function findLocalPeaks(values, minPeaks = 2) {
  const peaks = [];
  for (let i = 1; i < values.length - 1; i++) {
    if (values[i] > values[i - 1] && values[i] > values[i + 1]) {
      peaks.push({ index: i, value: values[i] });
    }
  }
  // Sort by value descending and return top N
  return peaks.sort((a, b) => b.value - a.value).slice(0, minPeaks);
}

function findLocalTroughs(values, minTroughs = 2) {
  const troughs = [];
  for (let i = 1; i < values.length - 1; i++) {
    if (values[i] < values[i - 1] && values[i] < values[i + 1]) {
      troughs.push({ index: i, value: values[i] });
    }
  }
  // Sort by value ascending and return bottom N
  return troughs.sort((a, b) => a.value - b.value).slice(0, minTroughs);
}

/**
 * Main function to detect all patterns
 */
function detectTradingPatterns(priceData) {
  const patterns = [];
  
  if (!priceData || priceData.length < 10) return patterns;
  
  // Convert price data to array format - handle different formats
  const prices = priceData.map(p => {
    if (typeof p === 'number') {
      return { price: p, high: p, low: p };
    }
    return {
      price: p.price || (typeof p === 'object' && p.value) || 0,
      high: p.high || p.price || (typeof p === 'object' && p.value) || 0,
      low: p.low || p.price || (typeof p === 'object' && p.value) || 0
    };
  });
  
  // Detect patterns
  const parallelChannel = detectParallelChannel(prices);
  if (parallelChannel) patterns.push(parallelChannel);
  
  const headShoulders = detectHeadAndShoulders(prices);
  if (headShoulders) patterns.push(headShoulders);
  
  const triangle = detectTriangle(prices);
  if (triangle) patterns.push(triangle);
  
  const wedge = detectWedge(prices);
  if (wedge) patterns.push(wedge);
  
  const doubleTopBottom = detectDoubleTopBottom(prices);
  if (doubleTopBottom) patterns.push(doubleTopBottom);
  
  return patterns;
}

module.exports = {
  detectTradingPatterns,
  detectParallelChannel,
  detectHeadAndShoulders,
  detectTriangle,
  detectWedge,
  detectDoubleTopBottom
};

