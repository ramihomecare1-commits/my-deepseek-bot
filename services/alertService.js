/**
 * Alert Detection Service
 * Detects high-probability trading opportunities from pattern scanner data
 */

const { addVolumeConfirmation } = require('../utils/patternDetector');
const {
    detectHeadAndShoulders,
    detectInverseHeadAndShoulders,
    detectDoubleTop,
    detectDoubleBottom,
    detectTriangle,
    detectCandlestickPatterns
} = require('../utils/chartPatterns');

/**
 * Calculate average volume over N periods
 * @param {Array} candles - Historical candles
 * @param {number} periods - Number of periods
 * @returns {number} Average volume
 */
function calculateAverageVolume(candles, periods = 20) {
    const recent = candles.slice(-periods);
    return recent.reduce((sum, c) => sum + c.volume, 0) / periods;
}

/**
 * Check if price broke through a level
 * @param {number} currentPrice - Current price
 * @param {number} previousPrice - Previous price
 * @param {Object} level - Support/resistance level
 * @returns {boolean} True if breakout occurred
 */
function checkBreakout(currentPrice, previousPrice, level) {
    if (level.type === 'support') {
        // Support broken: previous above, current below
        return previousPrice >= level.price && currentPrice < level.price;
    } else {
        // Resistance broken: previous below, current above
        return previousPrice <= level.price && currentPrice > level.price;
    }
}

/**
 * Count confluence factors for a level
 * @param {Object} level - Support/resistance level
 * @returns {number} Number of confluence factors
 */
function countConfluence(level) {
    let count = 0;

    if (level.method && level.method.includes('Psychological')) count++;
    if (level.method && level.method.includes('Swing')) count++;
    if (level.method && level.method.includes('MA')) count++;
    if (level.volumeConfirmed) count++;
    if (level.touchCount >= 3) count++;

    return count;
}

/**
 * Calculate breakout confidence score
 * @param {Object} level - Level that was broken
 * @param {number} currentVolume - Current volume
 * @param {number} avgVolume - Average volume
 * @returns {number} Confidence score 1-10
 */
function calculateBreakoutConfidence(level, currentVolume, avgVolume) {
    let score = 5; // Base score

    // Level strength (0-2 points)
    if (level.strength === 'strong') score += 2;
    else if (level.strength === 'medium') score += 1;

    // Volume confirmation (0-2 points)
    const volumeRatio = currentVolume / avgVolume;
    if (volumeRatio >= 2.0) score += 2;
    else if (volumeRatio >= 1.5) score += 1;

    // Touch count (0-1 point)
    if (level.touchCount >= 5) score += 1;

    // Confluence (0-1 point)
    const confluence = countConfluence(level);
    if (confluence >= 3) score += 1;

    return Math.min(score, 10);
}

/**
 * Calculate level test confidence score
 * @param {Object} level - Level being tested
 * @returns {number} Confidence score 1-10
 */
function calculateLevelTestConfidence(level) {
    let score = 6; // Base score

    // Strength (0-2 points)
    if (level.strength === 'strong') score += 2;
    else if (level.strength === 'medium') score += 1;

    // Touch count (0-2 points)
    if (level.touchCount >= 5) score += 2;
    else if (level.touchCount >= 3) score += 1;

    // Volume confirmation (0-1 point)
    if (level.volumeConfirmed) score += 1;

    // Confluence (0-1 point)
    const confluence = countConfluence(level);
    if (confluence >= 2) score += 1;

    return Math.min(score, 10);
}

/**
 * Check if price is near a key level
 * @param {number} price - Current price
 * @param {Object} levels - Support/resistance levels
 * @param {number} threshold - Distance threshold (e.g., 0.02 for 2%)
 * @returns {boolean} True if near a key level
 */
function isNearKeyLevel(price, levels, threshold = 0.02) {
    const allLevels = [...levels.support, ...levels.resistance];

    for (const level of allLevels) {
        const distance = Math.abs(level.price - price) / price;
        if (distance < threshold && level.strength >= 0.7) {
            return true;
        }
    }

    return false;
}

/**
 * Detect level breakout alerts (ULTRA-FILTERED)
 * @param {string} symbol - Coin symbol
 * @param {Array} candles - Historical candles
 * @param {Object} levels - Support/resistance levels
 * @param {Object} settings - Alert settings (optional)
 * @returns {Object|null} Alert object or null
 */
function detectBreakout(symbol, candles, levels, settings = null) {
    if (candles.length < 2) return null;

    const currentCandle = candles[candles.length - 1];
    const previousCandle = candles[candles.length - 2];
    const currentPrice = currentCandle.close;
    const previousPrice = previousCandle.close;
    const currentVolume = currentCandle.volume;
    const avgVolume = calculateAverageVolume(candles, 20);

    // ULTRA-STRICT: Minimum volume ratio (default 200% for breakouts)
    const minVolumeRatio = settings?.thresholds?.minVolumeRatio || 2.0;
    const minConfluence = settings?.thresholds?.minConfluence || 3;
    const minTouchCount = settings?.thresholds?.minTouchCount || 3;

    // Check each level
    const allLevels = [...levels.support, ...levels.resistance];

    for (const level of allLevels) {
        const isBreakout = checkBreakout(currentPrice, previousPrice, level);
        const volumeRatio = currentVolume / avgVolume;
        const hasVolumeConfirmation = volumeRatio >= minVolumeRatio;
        const confluence = countConfluence(level);

        // ULTRA-STRICT FILTERS:
        // 1. Must be breakout
        // 2. Volume > 200% (or configured minimum)
        // 3. Strength must be "strong" (0.8+)
        // 4. Minimum 3 confluence factors
        // 5. Minimum 3 historical touches
        if (isBreakout &&
            hasVolumeConfirmation &&
            level.strength >= 0.8 &&
            confluence >= minConfluence &&
            (level.touchCount || 0) >= minTouchCount) {

            const confidence = calculateBreakoutConfidence(level, currentVolume, avgVolume);

            // FINAL FILTER: Confidence must be 8.5+
            if (confidence < 8.5) continue;

            return {
                type: 'LEVEL_BREAKOUT',
                symbol,
                price: currentPrice,
                level: level.price,
                levelType: level.type,
                direction: level.type === 'support' ? 'BELOW' : 'ABOVE',
                confidence,
                volumeRatio: parseFloat(volumeRatio.toFixed(2)),
                strength: level.strength,
                confluence,
                touchCount: level.touchCount || 0,
                action: level.type === 'support' ?
                    'STRONG_BREAKDOWN_CONFIRMED' :
                    'STRONG_BREAKOUT_CONFIRMED',
                priority: confidence >= 9.0 && volumeRatio >= 2.5 ? 'CRITICAL' : 'HIGH',
                timestamp: new Date()
            };
        }
    }

    return null;
}

/**
 * Detect key level test alerts (ULTRA-FILTERED)
 * @param {string} symbol - Coin symbol
 * @param {Array} candles - Historical candles
 * @param {Object} levels - Support/resistance levels
 * @param {Object} settings - Alert settings (optional)
 * @returns {Object|null} Alert object or null
 */
function detectLevelTest(symbol, candles, levels, settings = null) {
    if (candles.length === 0) return null;

    const currentPrice = candles[candles.length - 1].close;
    const allLevels = [...levels.support, ...levels.resistance];

    const minTouchCount = settings?.thresholds?.minTouchCount || 3;
    const minConfluence = settings?.thresholds?.minConfluence || 3;

    for (const level of allLevels) {
        const distance = Math.abs(level.price - currentPrice) / currentPrice;

        // ULTRA-STRICT FILTERS:
        // 1. Within 0.5% (tighter than before)
        // 2. Strong level only (0.8+)
        // 3. Minimum 3 touches
        // 4. Minimum 3 confluence factors
        if (distance < 0.005 &&  // 0.5% instead of 1%
            level.strength >= 0.8 &&
            (level.touchCount || 0) >= minTouchCount &&
            countConfluence(level) >= minConfluence) {

            const confidence = calculateLevelTestConfidence(level);

            // FINAL FILTER: Confidence must be 8.5+
            if (confidence < 8.5) continue;

            return {
                type: 'KEY_LEVEL_TEST',
                symbol,
                price: currentPrice,
                level: level.price,
                levelType: level.type,
                distance: parseFloat((distance * 100).toFixed(2)),
                touchCount: level.touchCount,
                confidence,
                strength: level.strength,
                confluence: countConfluence(level),
                volumeConfirmed: level.volumeConfirmed || false,
                action: level.type === 'support' ?
                    'STRONG_BOUNCE_EXPECTED' :
                    'STRONG_REJECTION_EXPECTED',
                priority: confidence >= 9.0 && level.touchCount >= 5 ? 'CRITICAL' : 'HIGH',
                timestamp: new Date()
            };
        }
    }

    return null;
}

/**
 * Detect volume/momentum spike alerts
 * @param {string} symbol - Coin symbol
 * @param {Array} candles - Historical candles
 * @param {Object} levels - Support/resistance levels
 * @returns {Object|null} Alert object or null
 */
function detectVolumeMomentum(symbol, candles, levels) {
    if (candles.length < 2) return null;

    const current = candles[candles.length - 1];
    const previous = candles[candles.length - 2];
    const avgVolume = calculateAverageVolume(candles, 20);

    const volumeSpike = current.volume > avgVolume * 2.0;
    const priceMove = Math.abs(current.close - previous.close) / previous.close;
    const atKeyLevel = isNearKeyLevel(current.close, levels, 0.02);

    if (volumeSpike && priceMove > 0.03 && atKeyLevel) {
        return {
            type: 'VOLUME_MOMENTUM',
            symbol,
            price: current.close,
            volumeRatio: parseFloat((current.volume / avgVolume).toFixed(2)),
            priceChange: parseFloat((priceMove * 100).toFixed(2)),
            direction: current.close > previous.close ? 'UP' : 'DOWN',
            confidence: 8,
            action: current.close > previous.close ?
                'STRONG_MOMENTUM_UP' :
                'STRONG_MOMENTUM_DOWN',
            timestamp: new Date()
        };
    }

    return null;
}

module.exports = {
    detectBreakout,
    detectLevelTest,
    detectVolumeMomentum,
    calculateAverageVolume,
    calculateBreakoutConfidence,
    calculateLevelTestConfidence,
    // Chart patterns
    detectHeadAndShoulders,
    detectInverseHeadAndShoulders,
    detectDoubleTop,
    detectDoubleBottom,
    detectTriangle,
    detectCandlestickPatterns
};

