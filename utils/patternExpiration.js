/**
 * Pattern Expiration Logic
 * Filters out old patterns that are no longer relevant
 * Patterns decay based on timeframe and age
 */

/**
 * Check if a pattern is still valid based on age
 * @param {Object} pattern - Pattern object with timestamp and timeframe
 * @param {number} currentTime - Current timestamp
 * @returns {boolean} True if pattern is still valid
 */
function isPatternValid(pattern, currentTime = Date.now()) {
    if (!pattern.timestamp) return true; // No timestamp = assume valid

    const age = currentTime - pattern.timestamp;

    // Define max age based on timeframe
    const maxAge = getMaxAge(pattern.timeframe);

    return age < maxAge;
}

/**
 * Get maximum age for a pattern based on timeframe
 * @param {string} timeframe - Pattern timeframe (1d, 1W, etc.)
 * @returns {number} Max age in milliseconds
 */
function getMaxAge(timeframe) {
    const DAY_MS = 24 * 60 * 60 * 1000;

    switch (timeframe) {
        case '1d':
        case '1D':
            return 7 * DAY_MS; // 7 days for daily patterns
        case '1W':
        case '1w':
            return 30 * DAY_MS; // 30 days for weekly patterns
        case '4h':
        case '4H':
            return 3 * DAY_MS; // 3 days for 4H patterns
        case '1h':
        case '1H':
            return 1 * DAY_MS; // 1 day for hourly patterns
        default:
            return 7 * DAY_MS; // Default 7 days
    }
}

/**
 * Filter patterns by validity (remove expired)
 * @param {Array} patterns - Array of patterns
 * @param {number} currentTime - Current timestamp
 * @returns {Array} Valid patterns only
 */
function filterValidPatterns(patterns, currentTime = Date.now()) {
    return patterns.filter(pattern => isPatternValid(pattern, currentTime));
}

/**
 * Calculate pattern decay factor (confidence reduction over time)
 * @param {Object} pattern - Pattern object
 * @param {number} currentTime - Current timestamp
 * @returns {number} Decay factor (0-1, where 1 = no decay)
 */
function calculateDecayFactor(pattern, currentTime = Date.now()) {
    if (!pattern.timestamp) return 1.0; // No decay if no timestamp

    const age = currentTime - pattern.timestamp;
    const maxAge = getMaxAge(pattern.timeframe);

    // Linear decay: 100% at 0 age, 70% at max age
    const decayRate = 0.3; // 30% max decay
    const ageRatio = Math.min(age / maxAge, 1.0);

    return 1.0 - (decayRate * ageRatio);
}

/**
 * Apply decay to pattern confidence
 * @param {Object} pattern - Pattern object with confidence
 * @param {number} currentTime - Current timestamp
 * @returns {Object} Pattern with adjusted confidence
 */
function applyPatternDecay(pattern, currentTime = Date.now()) {
    const decayFactor = calculateDecayFactor(pattern, currentTime);

    return {
        ...pattern,
        originalConfidence: pattern.confidence,
        confidence: pattern.confidence * decayFactor,
        decayFactor,
        age: currentTime - (pattern.timestamp || currentTime)
    };
}

module.exports = {
    isPatternValid,
    getMaxAge,
    filterValidPatterns,
    calculateDecayFactor,
    applyPatternDecay
};
