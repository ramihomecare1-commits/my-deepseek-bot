/**
 * Wyckoff Pattern Detection - Enhanced Version
 * Detects accumulation and distribution phases based on Wyckoff methodology
 * Uses precise volume thresholds and price action to identify major market turning points
 * 
 * Enhancements:
 * - 2.5x volume threshold for climax detection (was 2x)
 * - Candle color confirmation (red for selling, green for buying)
 * - 0.7x volume threshold for secondary tests (more precise)
 */

/**
 * Check if volume qualifies as climax (high volume spike)
 * @param {number} volume - Current volume
 * @param {Array} previousVolumes - Array of previous volumes
 * @param {number} multiplier - Volume multiplier threshold (default 2.5)
 * @returns {boolean}
 */
function isClimaxVolume(volume, previousVolumes, multiplier = 2.5) {
    const avgVolume = previousVolumes.reduce((a, b) => a + b, 0) / previousVolumes.length;
    return volume > avgVolume * multiplier;
}

/**
 * Check if volume qualifies as test (lower volume)
 * @param {number} volume - Current volume
 * @param {number} climaxVolume - Volume of the climax candle
 * @param {number} multiplier - Volume multiplier threshold (default 0.7)
 * @returns {boolean}
 */
function isTestVolume(volume, climaxVolume, multiplier = 0.7) {
    return volume < climaxVolume * multiplier;
}

/**
 * Detect Wyckoff accumulation pattern
 * Phases: PS → SC → AR → ST → Spring
 * @param {Array} candles - OHLCV candle data
 * @returns {Object|null} Accumulation pattern or null
 */
function detectAccumulation(candles) {
    if (candles.length < 50) return null;

    const volumes = candles.map(c => c.volume);
    const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;

    // Find potential Selling Climax (SC) - highest volume in downtrend
    let scIndex = -1;
    let maxVolume = 0;

    for (let i = 20; i < candles.length - 20; i++) {
        const previousVolumes = candles.slice(i - 20, i).map(c => c.volume);

        // Enhanced: 2.5x volume threshold + red candle confirmation
        if (isClimaxVolume(candles[i].volume, previousVolumes, 2.5) &&
            candles[i].close < candles[i].open) { // Red candle (selling)

            // Check if in downtrend (price declining before this point)
            const prevTrend = candles.slice(i - 10, i);
            const isDowntrend = prevTrend[0].close > prevTrend[prevTrend.length - 1].close;

            if (isDowntrend && candles[i].volume > maxVolume) {
                maxVolume = candles[i].volume;
                scIndex = i;
            }
        }
    }

    if (scIndex === -1) return null;

    const sc = candles[scIndex];

    // Find Automatic Rally (AR) - bounce after SC
    let arIndex = -1;
    let arHigh = sc.low;

    for (let i = scIndex + 1; i < Math.min(scIndex + 15, candles.length); i++) {
        if (candles[i].high > arHigh) {
            arHigh = candles[i].high;
            arIndex = i;
        }
    }

    if (arIndex === -1) return null;

    // Find Secondary Test (ST) - retest of SC lows on lower volume
    let stIndex = -1;
    const scLow = sc.low;

    for (let i = arIndex + 1; i < Math.min(arIndex + 20, candles.length); i++) {
        const nearSCLow = Math.abs(candles[i].low - scLow) / scLow < 0.03; // Within 3%
        const lowerVolume = isTestVolume(candles[i].volume, sc.volume, 0.7); // Enhanced: precise test volume

        if (nearSCLow && lowerVolume) {
            stIndex = i;
            break;
        }
    }

    if (stIndex === -1) return null;

    // Find Spring - false breakdown below support, quick recovery
    let springIndex = -1;
    const supportLevel = Math.min(sc.low, candles[stIndex].low);

    for (let i = stIndex + 1; i < Math.min(stIndex + 15, candles.length - 1); i++) {
        const breaksSupport = candles[i].low < supportLevel * 0.98;
        const quickRecovery = candles[i + 1].close > supportLevel;

        if (breaksSupport && quickRecovery) {
            springIndex = i;
            break;
        }
    }

    // Calculate confidence based on phases present
    let confidence = 6.0;
    let phasesFound = 3; // SC, AR, ST always present at this point

    if (springIndex !== -1) {
        confidence = 9.0; // All phases present
        phasesFound = 4;
    } else {
        confidence = 7.5; // Missing spring
    }

    // Check if pattern is recent (last 30% of data)
    const recentThreshold = candles.length * 0.7;
    if (scIndex < recentThreshold) return null; // Too old

    const currentPrice = candles[candles.length - 1].close;

    return {
        type: 'WYCKOFF_ACCUMULATION',
        direction: 'bullish',
        confidence,
        phases: {
            sellingClimax: { index: scIndex, price: sc.low, volume: sc.volume },
            automaticRally: { index: arIndex, price: arHigh },
            secondaryTest: { index: stIndex, price: candles[stIndex].low },
            spring: springIndex !== -1 ? { index: springIndex, price: candles[springIndex].low } : null
        },
        phasesFound,
        supportLevel,
        currentPrice,
        invalidationLevel: supportLevel * 0.95, // 5% below support
        description: `Wyckoff Accumulation (${phasesFound}/4 phases) - SC at $${sc.low.toFixed(2)}, Support: $${supportLevel.toFixed(2)}`
    };
}

/**
 * Detect Wyckoff distribution pattern
 * Phases: PSY → BC → AR → ST → Upthrust
 * @param {Array} candles - OHLCV candle data
 * @returns {Object|null} Distribution pattern or null
 */
function detectDistribution(candles) {
    if (candles.length < 50) return null;

    const volumes = candles.map(c => c.volume);
    const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;

    // Find potential Buying Climax (BC) - highest volume in uptrend
    let bcIndex = -1;
    let maxVolume = 0;

    for (let i = 20; i < candles.length - 20; i++) {
        const previousVolumes = candles.slice(i - 20, i).map(c => c.volume);

        // Enhanced: 2.5x volume threshold + green candle confirmation
        if (isClimaxVolume(candles[i].volume, previousVolumes, 2.5) &&
            candles[i].close > candles[i].open) { // Green candle (buying)

            // Check if in uptrend (price rising before this point)
            const prevTrend = candles.slice(i - 10, i);
            const isUptrend = prevTrend[0].close < prevTrend[prevTrend.length - 1].close;

            if (isUptrend && candles[i].volume > maxVolume) {
                maxVolume = candles[i].volume;
                bcIndex = i;
            }
        }
    }

    if (bcIndex === -1) return null;

    const bc = candles[bcIndex];

    // Find Automatic Reaction (AR) - drop after BC
    let arIndex = -1;
    let arLow = bc.high;

    for (let i = bcIndex + 1; i < Math.min(bcIndex + 15, candles.length); i++) {
        if (candles[i].low < arLow) {
            arLow = candles[i].low;
            arIndex = i;
        }
    }

    if (arIndex === -1) return null;

    // Find Secondary Test (ST) - retest of BC highs on lower volume
    let stIndex = -1;
    const bcHigh = bc.high;

    for (let i = arIndex + 1; i < Math.min(arIndex + 20, candles.length); i++) {
        const nearBCHigh = Math.abs(candles[i].high - bcHigh) / bcHigh < 0.03; // Within 3%
        const lowerVolume = isTestVolume(candles[i].volume, bc.volume, 0.7); // Enhanced: precise test volume

        if (nearBCHigh && lowerVolume) {
            stIndex = i;
            break;
        }
    }

    if (stIndex === -1) return null;

    // Find Upthrust - false breakout above resistance, quick reversal
    let upthrustIndex = -1;
    const resistanceLevel = Math.max(bc.high, candles[stIndex].high);

    for (let i = stIndex + 1; i < Math.min(stIndex + 15, candles.length - 1); i++) {
        const breaksResistance = candles[i].high > resistanceLevel * 1.02;
        const quickReversal = candles[i + 1].close < resistanceLevel;

        if (breaksResistance && quickReversal) {
            upthrustIndex = i;
            break;
        }
    }

    // Calculate confidence based on phases present
    let confidence = 6.0;
    let phasesFound = 3; // BC, AR, ST always present at this point

    if (upthrustIndex !== -1) {
        confidence = 9.0; // All phases present
        phasesFound = 4;
    } else {
        confidence = 7.5; // Missing upthrust
    }

    // Check if pattern is recent (last 30% of data)
    const recentThreshold = candles.length * 0.7;
    if (bcIndex < recentThreshold) return null; // Too old

    const currentPrice = candles[candles.length - 1].close;

    return {
        type: 'WYCKOFF_DISTRIBUTION',
        direction: 'bearish',
        confidence,
        phases: {
            buyingClimax: { index: bcIndex, price: bc.high, volume: bc.volume },
            automaticReaction: { index: arIndex, price: arLow },
            secondaryTest: { index: stIndex, price: candles[stIndex].high },
            upthrust: upthrustIndex !== -1 ? { index: upthrustIndex, price: candles[upthrustIndex].high } : null
        },
        phasesFound,
        resistanceLevel,
        currentPrice,
        invalidationLevel: resistanceLevel * 1.05, // 5% above resistance
        description: `Wyckoff Distribution (${phasesFound}/4 phases) - BC at $${bc.high.toFixed(2)}, Resistance: $${resistanceLevel.toFixed(2)}`
    };
}

/**
 * Detect all Wyckoff patterns
 * @param {Array} candles - OHLCV candle data
 * @returns {Array} Array of detected patterns
 */
function detectWyckoffPatterns(candles) {
    const patterns = [];

    const accumulation = detectAccumulation(candles);
    if (accumulation) patterns.push(accumulation);

    const distribution = detectDistribution(candles);
    if (distribution) patterns.push(distribution);

    return patterns;
}

module.exports = {
    detectWyckoffPatterns,
    detectAccumulation,
    detectDistribution
};
