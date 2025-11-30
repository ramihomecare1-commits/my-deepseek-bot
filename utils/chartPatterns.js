/**
 * Chart Pattern Detection
 * Detects major chart patterns for trading alerts
 */

/**
 * Find swing highs and lows for pattern detection
 * @param {Array} candles - Historical candles
 * @param {number} lookback - Lookback period
 * @returns {Object} Swing points
 */
function findSwingPoints(candles, lookback = 5) {
    const swingHighs = [];
    const swingLows = [];

    for (let i = lookback; i < candles.length - lookback; i++) {
        const current = candles[i];
        let isSwingHigh = true;
        let isSwingLow = true;

        // Check if current is higher/lower than surrounding candles
        for (let j = i - lookback; j <= i + lookback; j++) {
            if (j === i) continue;
            if (candles[j].high >= current.high) isSwingHigh = false;
            if (candles[j].low <= current.low) isSwingLow = false;
        }

        if (isSwingHigh) {
            swingHighs.push({ index: i, price: current.high, time: current.time });
        }
        if (isSwingLow) {
            swingLows.push({ index: i, price: current.low, time: current.time });
        }
    }

    return { swingHighs, swingLows };
}

/**
 * Detect Head and Shoulders pattern (Bearish)
 * @param {Array} candles - Historical candles
 * @returns {Object|null} Pattern or null
 */
function detectHeadAndShoulders(candles) {
    if (candles.length < 50) return null;

    const { swingHighs } = findSwingPoints(candles);
    if (swingHighs.length < 3) return null;

    // Look at last 3 swing highs
    const recentHighs = swingHighs.slice(-3);
    const [leftShoulder, head, rightShoulder] = recentHighs;

    // Head must be highest
    if (head.price <= leftShoulder.price || head.price <= rightShoulder.price) {
        return null;
    }

    // Shoulders should be roughly equal (within 3%)
    const shoulderDiff = Math.abs(leftShoulder.price - rightShoulder.price) / leftShoulder.price;
    if (shoulderDiff > 0.03) return null;

    // Find neckline (support between shoulders)
    const necklineCandles = candles.slice(leftShoulder.index, rightShoulder.index);
    const neckline = Math.min(...necklineCandles.map(c => c.low));

    const currentPrice = candles[candles.length - 1].close;
    const breakout = currentPrice < neckline;

    // Calculate confidence
    let confidence = 5;
    if (shoulderDiff < 0.01) confidence += 2; // Shoulders very equal
    if (head.price > leftShoulder.price * 1.05) confidence += 1; // Clear head
    if (breakout) confidence += 2; // Neckline broken

    // Volume confirmation
    const avgVolume = candles.slice(-20).reduce((sum, c) => sum + c.volume, 0) / 20;
    const recentVolume = candles.slice(-3).reduce((sum, c) => sum + c.volume, 0) / 3;
    const volumeConfirmed = recentVolume > avgVolume * 1.5;
    if (volumeConfirmed) confidence += 1;

    if (!breakout || confidence < 7.0) return null;

    const target = neckline - (head.price - neckline);

    return {
        type: 'HEAD_AND_SHOULDERS',
        direction: 'bearish',
        neckline,
        head: head.price,
        leftShoulder: leftShoulder.price,
        rightShoulder: rightShoulder.price,
        target,
        currentPrice,
        confidence: Math.min(confidence, 10),
        volumeConfirmed,
        volumeRatio: parseFloat((recentVolume / avgVolume).toFixed(2))
    };
}

/**
 * Detect Inverse Head and Shoulders pattern (Bullish)
 * @param {Array} candles - Historical candles
 * @returns {Object|null} Pattern or null
 */
function detectInverseHeadAndShoulders(candles) {
    if (candles.length < 50) return null;

    const { swingLows } = findSwingPoints(candles);
    if (swingLows.length < 3) return null;

    // Look at last 3 swing lows
    const recentLows = swingLows.slice(-3);
    const [leftShoulder, head, rightShoulder] = recentLows;

    // Head must be lowest
    if (head.price >= leftShoulder.price || head.price >= rightShoulder.price) {
        return null;
    }

    // Shoulders should be roughly equal (within 3%)
    const shoulderDiff = Math.abs(leftShoulder.price - rightShoulder.price) / leftShoulder.price;
    if (shoulderDiff > 0.03) return null;

    // Find neckline (resistance between shoulders)
    const necklineCandles = candles.slice(leftShoulder.index, rightShoulder.index);
    const neckline = Math.max(...necklineCandles.map(c => c.high));

    const currentPrice = candles[candles.length - 1].close;
    const breakout = currentPrice > neckline;

    // Calculate confidence
    let confidence = 5;
    if (shoulderDiff < 0.01) confidence += 2;
    if (head.price < leftShoulder.price * 0.95) confidence += 1;
    if (breakout) confidence += 2;

    // Volume confirmation
    const avgVolume = candles.slice(-20).reduce((sum, c) => sum + c.volume, 0) / 20;
    const recentVolume = candles.slice(-3).reduce((sum, c) => sum + c.volume, 0) / 3;
    const volumeConfirmed = recentVolume > avgVolume * 1.5;
    if (volumeConfirmed) confidence += 1;

    if (!breakout || confidence < 7.0) return null;

    const target = neckline + (neckline - head.price);

    return {
        type: 'INVERSE_HEAD_AND_SHOULDERS',
        direction: 'bullish',
        neckline,
        head: head.price,
        leftShoulder: leftShoulder.price,
        rightShoulder: rightShoulder.price,
        target,
        currentPrice,
        confidence: Math.min(confidence, 10),
        volumeConfirmed,
        volumeRatio: parseFloat((recentVolume / avgVolume).toFixed(2))
    };
}

/**
 * Detect Double Top pattern (Bearish)
 * @param {Array} candles - Historical candles
 * @returns {Object|null} Pattern or null
 */
function detectDoubleTop(candles) {
    if (candles.length < 30) return null;

    const { swingHighs, swingLows } = findSwingPoints(candles);
    if (swingHighs.length < 2 || swingLows.length < 1) return null;

    // Look at last 2 swing highs
    const [peak1, peak2] = swingHighs.slice(-2);

    // VALIDATION 1: Peaks should be within 2% of each other
    const peakDiff = Math.abs(peak1.price - peak2.price) / peak1.price;
    if (peakDiff > 0.02) return null;

    // VALIDATION 2: Check for uptrend BEFORE the pattern
    // Double top should form at the END of an uptrend, not in a downtrend
    const lookbackStart = Math.max(0, peak1.index - 50);
    const priorCandles = candles.slice(lookbackStart, peak1.index);
    if (priorCandles.length > 10) {
        const priorLow = Math.min(...priorCandles.map(c => c.low));
        const priorHigh = Math.max(...priorCandles.map(c => c.high));
        const priorTrend = (priorHigh - priorLow) / priorLow;

        // Require at least 5% uptrend before the pattern
        if (priorTrend < 0.05) return null;
    }

    // VALIDATION 3: Peaks should be at similar levels (resistance)
    // Both peaks should be higher than the trough between them by at least 3%
    const troughCandles = candles.slice(peak1.index, peak2.index);
    if (troughCandles.length === 0) return null;

    const trough = Math.min(...troughCandles.map(c => c.low));
    const avgPeak = (peak1.price + peak2.price) / 2;
    const peakToTroughDrop = (avgPeak - trough) / avgPeak;

    // Require at least 3% drop between peaks
    if (peakToTroughDrop < 0.03) return null;

    const currentPrice = candles[candles.length - 1].close;
    const breakout = currentPrice < trough;

    // Calculate confidence
    let confidence = 5;
    if (peakDiff < 0.01) confidence += 2; // Peaks very equal
    if (breakout) confidence += 2; // Support broken

    // Volume: second peak should have lower volume (weakness)
    const vol1 = candles[peak1.index].volume;
    const vol2 = candles[peak2.index].volume;
    const volumeDivergence = vol2 < vol1 * 0.8;
    if (volumeDivergence) confidence += 1;

    // Breakout volume
    const avgVolume = candles.slice(-20).reduce((sum, c) => sum + c.volume, 0) / 20;
    const recentVolume = candles.slice(-3).reduce((sum, c) => sum + c.volume, 0) / 3;
    const volumeConfirmed = recentVolume > avgVolume * 1.5;
    if (volumeConfirmed) confidence += 1;

    // Only return if breakout occurred AND confidence is high
    if (!breakout || confidence < 7.0) return null;

    const target = trough - (avgPeak - trough);

    return {
        type: 'DOUBLE_TOP',
        direction: 'bearish',
        resistance: avgPeak,
        support: trough,
        target,
        currentPrice,
        confidence: Math.min(confidence, 10),
        volumeConfirmed,
        volumeDivergence,
        volumeRatio: parseFloat((recentVolume / avgVolume).toFixed(2))
    };
}

/**
 * Detect Double Bottom pattern (Bullish)
 * @param {Array} candles - Historical candles
 * @returns {Object|null} Pattern or null
 */
function detectDoubleBottom(candles) {
    if (candles.length < 30) return null;

    const { swingHighs, swingLows } = findSwingPoints(candles);
    if (swingLows.length < 2 || swingHighs.length < 1) return null;

    // Look at last 2 swing lows
    const [trough1, trough2] = swingLows.slice(-2);

    // Troughs should be within 2% of each other
    const troughDiff = Math.abs(trough1.price - trough2.price) / trough1.price;
    if (troughDiff > 0.02) return null;

    // Find peak between troughs
    const peakCandles = candles.slice(trough1.index, trough2.index);
    if (peakCandles.length === 0) return null;

    const peak = Math.max(...peakCandles.map(c => c.high));

    const currentPrice = candles[candles.length - 1].close;
    const breakout = currentPrice > peak;

    // Calculate confidence
    let confidence = 5;
    if (troughDiff < 0.01) confidence += 2;
    if (breakout) confidence += 2;

    // Volume: second trough should have lower volume (weakness)
    const vol1 = candles[trough1.index].volume;
    const vol2 = candles[trough2.index].volume;
    const volumeDivergence = vol2 < vol1 * 0.8;
    if (volumeDivergence) confidence += 1;

    // Breakout volume
    const avgVolume = candles.slice(-20).reduce((sum, c) => sum + c.volume, 0) / 20;
    const recentVolume = candles.slice(-3).reduce((sum, c) => sum + c.volume, 0) / 3;
    const volumeConfirmed = recentVolume > avgVolume * 1.5;
    if (volumeConfirmed) confidence += 1;

    if (!breakout || confidence < 7.0) return null;

    const avgTrough = (trough1.price + trough2.price) / 2;
    const target = peak + (peak - avgTrough);

    return {
        type: 'DOUBLE_BOTTOM',
        direction: 'bullish',
        support: avgTrough,
        resistance: peak,
        target,
        currentPrice,
        confidence: Math.min(confidence, 10),
        volumeConfirmed,
        volumeDivergence,
        volumeRatio: parseFloat((recentVolume / avgVolume).toFixed(2))
    };
}

/**
 * Detect Triangle breakout
 * @param {Array} candles - Historical candles
 * @returns {Object|null} Pattern or null
 */
function detectTriangle(candles) {
    if (candles.length < 40) return null;

    const { swingHighs, swingLows } = findSwingPoints(candles);
    if (swingHighs.length < 3 || swingLows.length < 3) return null;

    // Get recent swings
    const recentHighs = swingHighs.slice(-3);
    const recentLows = swingLows.slice(-3);

    // Check for ascending triangle (higher lows, flat resistance)
    const lowsAscending = recentLows[1].price > recentLows[0].price &&
        recentLows[2].price > recentLows[1].price;
    const highsFlat = Math.abs(recentHighs[2].price - recentHighs[0].price) / recentHighs[0].price < 0.02;

    // Check for descending triangle (lower highs, flat support)
    const highsDescending = recentHighs[1].price < recentHighs[0].price &&
        recentHighs[2].price < recentHighs[1].price;
    const lowsFlat = Math.abs(recentLows[2].price - recentLows[0].price) / recentLows[0].price < 0.02;

    // Check for symmetrical triangle (converging)
    const converging = lowsAscending && highsDescending;

    if (!lowsAscending && !highsDescending && !converging) return null;

    let triangleType, breakoutLevel, direction;

    if (lowsAscending && highsFlat) {
        triangleType = 'ascending';
        breakoutLevel = recentHighs[0].price;
        direction = 'bullish';
    } else if (highsDescending && lowsFlat) {
        triangleType = 'descending';
        breakoutLevel = recentLows[0].price;
        direction = 'bearish';
    } else {
        triangleType = 'symmetrical';
        breakoutLevel = (recentHighs[2].price + recentLows[2].price) / 2;
        direction = 'neutral';
    }

    const currentPrice = candles[candles.length - 1].close;
    const breakout = (direction === 'bullish' && currentPrice > breakoutLevel) ||
        (direction === 'bearish' && currentPrice < breakoutLevel);

    if (!breakout) return null;

    // Calculate confidence
    let confidence = 5;
    if (triangleType === 'ascending' || triangleType === 'descending') confidence += 1;
    if (breakout) confidence += 2;

    // Volume confirmation
    const avgVolume = candles.slice(-20).reduce((sum, c) => sum + c.volume, 0) / 20;
    const recentVolume = candles.slice(-3).reduce((sum, c) => sum + c.volume, 0) / 3;
    const volumeConfirmed = recentVolume > avgVolume * 1.8;
    if (volumeConfirmed) confidence += 2;

    if (confidence < 7.0) return null;

    const height = Math.abs(recentHighs[0].price - recentLows[0].price);
    const target = direction === 'bullish' ?
        breakoutLevel + height :
        breakoutLevel - height;

    return {
        type: 'TRIANGLE_BREAKOUT',
        triangleType,
        direction,
        breakoutLevel,
        target,
        currentPrice,
        confidence: Math.min(confidence, 10),
        volumeConfirmed,
        volumeRatio: parseFloat((recentVolume / avgVolume).toFixed(2))
    };
}

/**
 * Detect candlestick patterns
 * @param {Array} candles - Historical candles
 * @returns {Object|null} Pattern or null
 */
function detectCandlestickPatterns(candles) {
    if (candles.length < 3) return null;

    const [c1, c2, c3] = candles.slice(-3);
    const current = c3;

    const body = Math.abs(current.close - current.open);
    const range = current.high - current.low;
    const upperWick = current.high - Math.max(current.open, current.close);
    const lowerWick = Math.min(current.open, current.close) - current.low;

    // Hammer (Bullish reversal)
    if (lowerWick > body * 2 && upperWick < body * 0.3 && current.close > current.open) {
        return {
            type: 'CANDLESTICK_PATTERN',
            pattern: 'hammer',
            direction: 'bullish',
            currentPrice: current.close,
            confidence: 8.5,
            description: 'Hammer - Bullish reversal'
        };
    }

    // Shooting Star (Bearish reversal)
    if (upperWick > body * 2 && lowerWick < body * 0.3 && current.close < current.open) {
        return {
            type: 'CANDLESTICK_PATTERN',
            pattern: 'shooting_star',
            direction: 'bearish',
            currentPrice: current.close,
            confidence: 8.5,
            description: 'Shooting Star - Bearish reversal'
        };
    }

    // Bullish Engulfing
    if (c2.close < c2.open && // Previous red
        current.close > current.open && // Current green
        current.open < c2.close && // Opens below previous close
        current.close > c2.open) { // Closes above previous open
        return {
            type: 'CANDLESTICK_PATTERN',
            pattern: 'bullish_engulfing',
            direction: 'bullish',
            currentPrice: current.close,
            confidence: 9.0,
            description: 'Bullish Engulfing - Strong reversal'
        };
    }

    // Bearish Engulfing
    if (c2.close > c2.open && // Previous green
        current.close < current.open && // Current red
        current.open > c2.close && // Opens above previous close
        current.close < c2.open) { // Closes below previous open
        return {
            type: 'CANDLESTICK_PATTERN',
            pattern: 'bearish_engulfing',
            direction: 'bearish',
            currentPrice: current.close,
            confidence: 9.0,
            description: 'Bearish Engulfing - Strong reversal'
        };
    }

    // Doji (Indecision)
    if (body < range * 0.1) {
        return {
            type: 'CANDLESTICK_PATTERN',
            pattern: 'doji',
            direction: 'neutral',
            currentPrice: current.close,
            confidence: 7.5, // Lower confidence - needs confirmation
            description: 'Doji - Indecision, watch for next candle'
        };
    }

    return null;
}

module.exports = {
    detectHeadAndShoulders,
    detectInverseHeadAndShoulders,
    detectDoubleTop,
    detectDoubleBottom,
    detectTriangle,
    detectCandlestickPatterns,
    findSwingPoints
};
