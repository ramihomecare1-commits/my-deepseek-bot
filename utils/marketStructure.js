/**
 * Market Structure Analysis
 * Identifies market trends, swing points, and structure strength
 */

/**
 * Analyze market structure to determine trend direction
 * @param {Array} candles - Historical candles
 * @returns {Object} Structure analysis
 */
function analyzeMarketStructure(candles) {
    if (!candles || candles.length < 20) {
        return {
            trend: 'ranging',
            strength: 0,
            swingPoints: [],
            lastStructureBreak: null
        };
    }

    const swingPoints = identifySwingPoints(candles);
    const trend = determineTrend(swingPoints);
    const strength = calculateTrendStrength(swingPoints, trend);

    return {
        trend,
        strength,
        swingPoints,
        lastStructureBreak: findLastStructureBreak(swingPoints, trend)
    };
}

/**
 * Identify swing highs and swing lows
 * @param {Array} candles - Historical candles
 * @returns {Array} Swing points
 */
function identifySwingPoints(candles) {
    const swingPoints = [];
    const lookback = 5; // Number of candles to look back/forward

    for (let i = lookback; i < candles.length - lookback; i++) {
        const current = candles[i];

        // Check for swing high
        let isSwingHigh = true;
        for (let j = i - lookback; j <= i + lookback; j++) {
            if (j !== i && candles[j].high >= current.high) {
                isSwingHigh = false;
                break;
            }
        }

        if (isSwingHigh) {
            swingPoints.push({
                type: 'high',
                price: current.high,
                index: i,
                timestamp: current.timestamp
            });
        }

        // Check for swing low
        let isSwingLow = true;
        for (let j = i - lookback; j <= i + lookback; j++) {
            if (j !== i && candles[j].low <= current.low) {
                isSwingLow = false;
                break;
            }
        }

        if (isSwingLow) {
            swingPoints.push({
                type: 'low',
                price: current.low,
                index: i,
                timestamp: current.timestamp
            });
        }
    }

    // Sort by index
    return swingPoints.sort((a, b) => a.index - b.index);
}

/**
 * Determine trend based on swing points
 * @param {Array} swingPoints - Identified swing points
 * @returns {string} Trend direction
 */
function determineTrend(swingPoints) {
    if (swingPoints.length < 4) return 'ranging';

    const highs = swingPoints.filter(p => p.type === 'high');
    const lows = swingPoints.filter(p => p.type === 'low');

    if (highs.length < 2 || lows.length < 2) return 'ranging';

    // Get last 3 highs and lows
    const recentHighs = highs.slice(-3);
    const recentLows = lows.slice(-3);

    // Check for higher highs and higher lows (uptrend)
    let higherHighs = 0;
    let higherLows = 0;

    for (let i = 1; i < recentHighs.length; i++) {
        if (recentHighs[i].price > recentHighs[i - 1].price) higherHighs++;
    }

    for (let i = 1; i < recentLows.length; i++) {
        if (recentLows[i].price > recentLows[i - 1].price) higherLows++;
    }

    // Check for lower highs and lower lows (downtrend)
    let lowerHighs = 0;
    let lowerLows = 0;

    for (let i = 1; i < recentHighs.length; i++) {
        if (recentHighs[i].price < recentHighs[i - 1].price) lowerHighs++;
    }

    for (let i = 1; i < recentLows.length; i++) {
        if (recentLows[i].price < recentLows[i - 1].price) lowerLows++;
    }

    // Determine trend
    const uptrendScore = higherHighs + higherLows;
    const downtrendScore = lowerHighs + lowerLows;

    if (uptrendScore >= 3) return 'uptrend';
    if (downtrendScore >= 3) return 'downtrend';
    return 'ranging';
}

/**
 * Calculate trend strength (1-10)
 * @param {Array} swingPoints - Swing points
 * @param {string} trend - Trend direction
 * @returns {number} Strength score
 */
function calculateTrendStrength(swingPoints, trend) {
    if (trend === 'ranging') return 0;

    const highs = swingPoints.filter(p => p.type === 'high').slice(-3);
    const lows = swingPoints.filter(p => p.type === 'low').slice(-3);

    if (highs.length < 2 || lows.length < 2) return 0;

    let consistency = 0;
    const maxConsistency = 4; // 2 highs + 2 lows

    if (trend === 'uptrend') {
        // Check consistency of higher highs
        for (let i = 1; i < highs.length; i++) {
            if (highs[i].price > highs[i - 1].price) consistency++;
        }
        // Check consistency of higher lows
        for (let i = 1; i < lows.length; i++) {
            if (lows[i].price > lows[i - 1].price) consistency++;
        }
    } else if (trend === 'downtrend') {
        // Check consistency of lower highs
        for (let i = 1; i < highs.length; i++) {
            if (highs[i].price < highs[i - 1].price) consistency++;
        }
        // Check consistency of lower lows
        for (let i = 1; i < lows.length; i++) {
            if (lows[i].price < lows[i - 1].price) consistency++;
        }
    }

    // Convert to 1-10 scale
    return Math.round((consistency / maxConsistency) * 10);
}

/**
 * Find the last structure break point
 * @param {Array} swingPoints - Swing points
 * @param {string} trend - Current trend
 * @returns {number|null} Index of last structure break
 */
function findLastStructureBreak(swingPoints, trend) {
    if (trend === 'ranging' || swingPoints.length < 4) return null;

    const highs = swingPoints.filter(p => p.type === 'high');
    const lows = swingPoints.filter(p => p.type === 'low');

    if (trend === 'uptrend') {
        // Find last lower low (structure break in uptrend)
        for (let i = lows.length - 1; i > 0; i--) {
            if (lows[i].price < lows[i - 1].price) {
                return lows[i].index;
            }
        }
    } else if (trend === 'downtrend') {
        // Find last higher high (structure break in downtrend)
        for (let i = highs.length - 1; i > 0; i--) {
            if (highs[i].price > highs[i - 1].price) {
                return highs[i].index;
            }
        }
    }

    return null;
}

/**
 * Check if pattern is aligned with market structure
 * @param {Object} pattern - Pattern object
 * @param {Object} structure - Market structure
 * @returns {Object} Alignment result with confidence adjustment
 */
function isPatternAlignedWithStructure(pattern, structure) {
    if (!pattern || !structure || structure.trend === 'ranging') {
        return {
            aligned: false,
            confidenceAdjustment: 0,
            reason: 'No clear trend'
        };
    }

    const patternDirection = pattern.direction;
    const trendDirection = structure.trend === 'uptrend' ? 'bullish' : 'bearish';

    const aligned = patternDirection === trendDirection;

    // Calculate confidence adjustment based on alignment and trend strength
    let confidenceAdjustment = 0;
    let reason = '';

    if (aligned) {
        // Bonus for alignment, scaled by trend strength
        confidenceAdjustment = 1.0 + (structure.strength / 10);
        reason = `Aligned with ${structure.trend} (strength: ${structure.strength}/10)`;
    } else {
        // Penalty for counter-trend patterns
        confidenceAdjustment = -2.0;
        reason = `Counter to ${structure.trend} (risky)`;
    }

    return {
        aligned,
        confidenceAdjustment,
        reason,
        trendStrength: structure.strength
    };
}

module.exports = {
    analyzeMarketStructure,
    identifySwingPoints,
    isPatternAlignedWithStructure
};
