/**
 * Enhanced Pattern Detector
 * Detects chart patterns, support/resistance, and candlestick patterns
 * Uses multiple methods for improved accuracy
 */

/**
 * Find support and resistance levels using multiple methods
 * @param {Array} candles - Historical candle data
 * @returns {Object} Support and resistance levels with confidence scores
 */
function findSupportResistance(candles) {
    return {
        swingLevels: findSwingHighsLows(candles),
        volumeProfile: findHighVolumeNodes(candles),
        psychological: findRoundNumbers(candles),
        movingAverages: findMASupport(candles)
    };
}

/**
 * Find swing highs and lows
 * @param {Array} candles - Historical candle data
 * @param {number} lookback - Number of candles to look back (default 20)
 * @returns {Object} Swing levels
 */
function findSwingHighsLows(candles, lookback = 20) {
    const swingHighs = [];
    const swingLows = [];

    for (let i = lookback; i < candles.length - lookback; i++) {
        const current = candles[i];
        let isSwingHigh = true;
        let isSwingLow = true;

        // Check if current is highest/lowest in lookback period
        for (let j = i - lookback; j <= i + lookback; j++) {
            if (j === i) continue;

            if (candles[j].high > current.high) isSwingHigh = false;
            if (candles[j].low < current.low) isSwingLow = false;
        }

        if (isSwingHigh) {
            swingHighs.push({
                price: current.high,
                timestamp: current.timestamp,
                type: 'resistance',
                strength: calculateLevelStrength(candles, current.high, 'resistance')
            });
        }

        if (isSwingLow) {
            swingLows.push({
                price: current.low,
                timestamp: current.timestamp,
                type: 'support',
                strength: calculateLevelStrength(candles, current.low, 'support')
            });
        }
    }

    return {
        resistance: clusterLevels(swingHighs),
        support: clusterLevels(swingLows)
    };
}

/**
 * Find high volume nodes (volume profile)
 * @param {Array} candles - Historical candle data
 * @returns {Object} High volume price levels
 */
function findHighVolumeNodes(candles) {
    // Create price bins
    const prices = candles.map(c => c.close);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const binCount = 50;
    const binSize = (maxPrice - minPrice) / binCount;

    const volumeBins = new Array(binCount).fill(0).map((_, i) => ({
        priceStart: minPrice + (i * binSize),
        priceEnd: minPrice + ((i + 1) * binSize),
        volume: 0
    }));

    // Accumulate volume in bins
    candles.forEach(candle => {
        const binIndex = Math.min(
            Math.floor((candle.close - minPrice) / binSize),
            binCount - 1
        );
        volumeBins[binIndex].volume += candle.volume;
    });

    // Find high volume nodes (top 20%)
    const sortedBins = [...volumeBins].sort((a, b) => b.volume - a.volume);
    const threshold = sortedBins[Math.floor(binCount * 0.2)].volume;

    const highVolumeNodes = volumeBins
        .filter(bin => bin.volume >= threshold)
        .map(bin => ({
            price: (bin.priceStart + bin.priceEnd) / 2,
            volume: bin.volume,
            strength: bin.volume / sortedBins[0].volume // Normalize to 0-1
        }));

    return highVolumeNodes;
}

/**
 * Find psychological levels (round numbers)
 * @param {Array} candles - Historical candle data
 * @returns {Array} Psychological price levels
 */
function findRoundNumbers(candles) {
    const currentPrice = candles[candles.length - 1].close;
    const levels = [];

    // Determine magnitude (e.g., $50k, $100k for BTC)
    const magnitude = Math.pow(10, Math.floor(Math.log10(currentPrice)));
    const roundingFactors = [magnitude, magnitude / 2, magnitude / 5, magnitude / 10];

    roundingFactors.forEach(factor => {
        // Find round numbers near current price
        const lower = Math.floor(currentPrice / factor) * factor;
        const upper = Math.ceil(currentPrice / factor) * factor;

        [lower, upper].forEach(level => {
            if (level > 0 && !levels.find(l => Math.abs(l.price - level) < factor * 0.1)) {
                levels.push({
                    price: level,
                    type: level > currentPrice ? 'resistance' : 'support',
                    strength: 0.7, // Psychological levels have moderate strength
                    reason: `Round number: $${level.toLocaleString()}`
                });
            }
        });
    });

    return levels.sort((a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice)).slice(0, 10);
}

/**
 * Find moving average support/resistance
 * @param {Array} candles - Historical candle data
 * @returns {Array} MA levels
 */
function findMASupport(candles) {
    const periods = [50, 200];
    const maLevels = [];

    periods.forEach(period => {
        if (candles.length >= period) {
            const ma = calculateMA(candles, period);
            const currentPrice = candles[candles.length - 1].close;

            maLevels.push({
                price: ma,
                type: ma > currentPrice ? 'resistance' : 'support',
                strength: period === 200 ? 0.9 : 0.7, // 200 MA is stronger
                reason: `${period} MA`
            });
        }
    });

    return maLevels;
}

/**
 * Calculate pattern confidence score
 * @param {Object} pattern - Detected pattern
 * @param {Array} candles - Historical candle data
 * @returns {number} Confidence score (0-100)
 */
function calculatePatternConfidence(pattern, candles) {
    const factors = {
        volumeConfirmation: checkVolumeSpike(pattern, candles),
        timeframeAlignment: checkMultipleTimeframes(pattern, candles),
        clarity: measurePatternSharpness(pattern, candles),
        historicalSuccess: backtestSimilarPatterns(pattern, candles)
    };

    // Weighted average
    const weights = {
        volumeConfirmation: 0.3,
        timeframeAlignment: 0.2,
        clarity: 0.3,
        historicalSuccess: 0.2
    };

    let confidence = 0;
    Object.keys(factors).forEach(key => {
        confidence += factors[key] * weights[key];
    });

    return Math.round(confidence * 100);
}

/**
 * Check for volume spike confirmation
 * @param {Object} pattern - Pattern object
 * @param {Array} candles - Historical candle data
 * @returns {number} Score 0-1
 */
function checkVolumeSpike(pattern, candles) {
    if (!pattern.startIndex || !pattern.endIndex) return 0.5;

    const patternCandles = candles.slice(pattern.startIndex, pattern.endIndex + 1);
    const avgVolume = candles.slice(-100).reduce((sum, c) => sum + c.volume, 0) / 100;
    const patternVolume = patternCandles.reduce((sum, c) => sum + c.volume, 0) / patternCandles.length;

    const volumeRatio = patternVolume / avgVolume;
    return Math.min(volumeRatio / 2, 1); // Cap at 1
}

/**
 * Check pattern clarity (sharpness)
 * @param {Object} pattern - Pattern object
 * @param {Array} candles - Historical candle data
 * @returns {number} Score 0-1
 */
function measurePatternSharpness(pattern, candles) {
    // Measure how well-defined the pattern is
    // Higher score for cleaner, more obvious patterns
    if (!pattern.keyPoints) return 0.5;

    // Check if key points are distinct
    const points = pattern.keyPoints.map(p => p.price);
    const range = Math.max(...points) - Math.min(...points);
    const avgPrice = points.reduce((a, b) => a + b, 0) / points.length;

    const clarity = range / avgPrice;
    return Math.min(clarity * 10, 1); // Normalize
}

/**
 * Backtest similar patterns (simplified)
 * @param {Object} pattern - Pattern object
 * @param {Array} candles - Historical candle data
 * @returns {number} Score 0-1
 */
function backtestSimilarPatterns(pattern, candles) {
    // Simplified: return moderate confidence
    // Full implementation would search for similar patterns in history
    return 0.6;
}

/**
 * Check multiple timeframes (placeholder)
 * @param {Object} pattern - Pattern object
 * @param {Array} candles - Historical candle data
 * @returns {number} Score 0-1
 */
function checkMultipleTimeframes(pattern, candles) {
    // Placeholder: would check if pattern appears on multiple timeframes
    return 0.7;
}

/**
 * Calculate level strength based on tests
 * @param {Array} candles - Historical candle data
 * @param {number} level - Price level
 * @param {string} type - 'support' or 'resistance'
 * @returns {string} Strength rating
 */
function calculateLevelStrength(candles, level, type) {
    const tolerance = level * 0.01; // 1% tolerance
    let tests = 0;

    candles.forEach(candle => {
        if (type === 'support' && Math.abs(candle.low - level) < tolerance) tests++;
        if (type === 'resistance' && Math.abs(candle.high - level) < tolerance) tests++;
    });

    if (tests >= 5) return 'strong';
    if (tests >= 3) return 'medium';
    return 'weak';
}

/**
 * Cluster nearby levels
 * @param {Array} levels - Array of price levels
 * @returns {Array} Clustered levels
 */
function clusterLevels(levels) {
    if (levels.length === 0) return [];

    const clustered = [];
    const sorted = [...levels].sort((a, b) => a.price - b.price);

    let currentCluster = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const current = sorted[i];

        // If within 2% of previous, add to cluster
        if ((current.price - prev.price) / prev.price < 0.02) {
            currentCluster.push(current);
        } else {
            // Finalize cluster
            if (currentCluster.length > 0) {
                clustered.push({
                    price: currentCluster.reduce((sum, l) => sum + l.price, 0) / currentCluster.length,
                    strength: currentCluster[0].strength,
                    tests: currentCluster.length
                });
            }
            currentCluster = [current];
        }
    }

    // Add last cluster
    if (currentCluster.length > 0) {
        clustered.push({
            price: currentCluster.reduce((sum, l) => sum + l.price, 0) / currentCluster.length,
            strength: currentCluster[0].strength,
            tests: currentCluster.length
        });
    }

    return clustered.sort((a, b) => b.tests - a.tests).slice(0, 5); // Top 5
}

/**
 * Calculate simple moving average
 * @param {Array} candles - Historical candle data
 * @param {number} period - MA period
 * @returns {number} MA value
 */
function calculateMA(candles, period) {
    const recent = candles.slice(-period);
    return recent.reduce((sum, c) => sum + c.close, 0) / period;
}

module.exports = {
    findSupportResistance,
    findSwingHighsLows,
    findHighVolumeNodes,
    findRoundNumbers,
    findMASupport,
    calculatePatternConfidence,
    checkVolumeSpike,
    measurePatternSharpness
};
