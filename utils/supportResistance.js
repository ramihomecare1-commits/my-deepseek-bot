/**
 * Support and Resistance Level Detection
 * Identifies key price levels where multiple touches occur
 * Used for confluence detection with patterns
 */

/**
 * Find support and resistance levels using price clustering
 * @param {Array} candles - OHLCV candle data
 * @param {number} tolerance - Price tolerance for clustering (default 0.005 = 0.5%)
 * @param {number} minTouches - Minimum touches required (default 3)
 * @returns {Array} Array of S/R levels with strength
 */
function findSupportResistanceLevels(candles, tolerance = 0.005, minTouches = 3) {
    const levels = [];

    // Collect all significant price points (highs and lows)
    const pricePoints = [];
    candles.forEach(candle => {
        pricePoints.push({ price: candle.high, type: 'resistance' });
        pricePoints.push({ price: candle.low, type: 'support' });
    });

    // Cluster nearby prices
    pricePoints.forEach(point => {
        const nearbyLevel = levels.find(level =>
            Math.abs(level.price - point.price) / point.price < tolerance
        );

        if (nearbyLevel) {
            // Add to existing level
            nearbyLevel.strength++;
            nearbyLevel.touches.push(point.price);
            nearbyLevel.avgPrice = nearbyLevel.touches.reduce((a, b) => a + b, 0) / nearbyLevel.touches.length;
        } else {
            // Create new level
            levels.push({
                price: point.price,
                avgPrice: point.price,
                strength: 1,
                touches: [point.price],
                type: point.type
            });
        }
    });

    // Filter levels with minimum touches and sort by strength
    return levels
        .filter(level => level.strength >= minTouches)
        .sort((a, b) => b.strength - a.strength)
        .map(level => ({
            price: level.avgPrice,
            strength: level.strength,
            type: level.type,
            isStrong: level.strength >= 5 // 5+ touches = strong level
        }));
}

/**
 * Check if a pattern is near a support/resistance level
 * @param {number} patternPrice - Pattern price level
 * @param {Array} srLevels - Support/Resistance levels
 * @param {number} tolerance - Price tolerance (default 0.01 = 1%)
 * @returns {Object|null} Matching S/R level or null
 */
function isNearSRLevel(patternPrice, srLevels, tolerance = 0.01) {
    return srLevels.find(level =>
        Math.abs(level.price - patternPrice) / patternPrice < tolerance
    ) || null;
}

/**
 * Calculate confluence score for a pattern
 * @param {Object} pattern - Pattern object with price
 * @param {Array} srLevels - Support/Resistance levels
 * @param {Array} otherPatterns - Other patterns to check for confluence
 * @returns {Object} Confluence information
 */
function calculateConfluence(pattern, srLevels, otherPatterns = []) {
    let confluenceScore = 0;
    const confluenceFactors = [];

    // Check S/R level confluence
    const nearSR = isNearSRLevel(pattern.price || pattern.currentPrice, srLevels);
    if (nearSR) {
        confluenceScore += nearSR.isStrong ? 1.0 : 0.5;
        confluenceFactors.push({
            type: 'S/R Level',
            strength: nearSR.strength,
            bonus: nearSR.isStrong ? 1.0 : 0.5
        });
    }

    // Check pattern confluence (multiple patterns at same level)
    const nearbyPatterns = otherPatterns.filter(p => {
        const pPrice = p.price || p.currentPrice;
        const patternPrice = pattern.price || pattern.currentPrice;
        return Math.abs(pPrice - patternPrice) / patternPrice < 0.02; // Within 2%
    });

    if (nearbyPatterns.length >= 1) {
        confluenceScore += 0.5;
        confluenceFactors.push({
            type: 'Pattern Confluence',
            count: nearbyPatterns.length + 1,
            bonus: 0.5
        });
    }

    if (nearbyPatterns.length >= 2) {
        confluenceScore += 0.5;
        confluenceFactors.push({
            type: 'Multiple Pattern Confluence',
            count: nearbyPatterns.length + 1,
            bonus: 0.5
        });
    }

    return {
        score: confluenceScore,
        factors: confluenceFactors,
        hasConfluence: confluenceScore > 0
    };
}

module.exports = {
    findSupportResistanceLevels,
    isNearSRLevel,
    calculateConfluence
};
