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

    // VALIDATION 1: Head must be highest
    if (head.price <= leftShoulder.price || head.price <= rightShoulder.price) {
        return null;
    }

    // VALIDATION 2: Head must be significantly higher than shoulders (3%+)
    const headToLeftDiff = (head.price - leftShoulder.price) / leftShoulder.price;
    const headToRightDiff = (head.price - rightShoulder.price) / rightShoulder.price;
    if (headToLeftDiff < 0.03 || headToRightDiff < 0.03) return null;

    // VALIDATION 3: Shoulders should be roughly equal (within 5%)
    const shoulderDiff = Math.abs(leftShoulder.price - rightShoulder.price) / leftShoulder.price;
    if (shoulderDiff > 0.05) return null;

    // VALIDATION 4: Check for uptrend BEFORE the pattern
    // H&S should form at the END of an uptrend
    const lookbackStart = Math.max(0, leftShoulder.index - 50);
    const priorCandles = candles.slice(lookbackStart, leftShoulder.index);
    if (priorCandles.length > 10) {
        const priorLow = Math.min(...priorCandles.map(c => c.low));
        const priorHigh = Math.max(...priorCandles.map(c => c.high));
        const priorTrend = (priorHigh - priorLow) / priorLow;

        // Require at least 5% uptrend before the pattern
        if (priorTrend < 0.05) return null;
    }

    // Find neckline (support between shoulders)
    const necklineCandles = candles.slice(leftShoulder.index, rightShoulder.index);
    const neckline = Math.min(...necklineCandles.map(c => c.low));

    const currentPrice = candles[candles.length - 1].close;
    const breakout = currentPrice < neckline;

    // Calculate confidence
    let confidence = 5;
    if (shoulderDiff < 0.02) confidence += 2; // Shoulders very equal
    if (head.price > leftShoulder.price * 1.05) confidence += 1; // Clear head
    if (breakout) confidence += 2; // Neckline broken

    // Volume confirmation
    const avgVolume = candles.slice(-20).reduce((sum, c) => sum + c.volume, 0) / 20;
    const recentVolume = candles.slice(-3).reduce((sum, c) => sum + c.volume, 0) / 3;
    const volumeConfirmed = recentVolume > avgVolume * 1.5;
    if (volumeConfirmed) confidence += 1;

    // Only return if breakout occurred AND confidence is high
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

    // VALIDATION 1: Head must be lowest
    if (head.price >= leftShoulder.price || head.price >= rightShoulder.price) {
        return null;
    }

    // VALIDATION 2: Head must be significantly lower than shoulders (3%+)
    const headToLeftDiff = (leftShoulder.price - head.price) / head.price;
    const headToRightDiff = (rightShoulder.price - head.price) / head.price;
    if (headToLeftDiff < 0.03 || headToRightDiff < 0.03) return null;

    // VALIDATION 3: Shoulders should be roughly equal (within 5%)
    const shoulderDiff = Math.abs(leftShoulder.price - rightShoulder.price) / leftShoulder.price;
    if (shoulderDiff > 0.05) return null;

    // VALIDATION 4: Check for downtrend BEFORE the pattern
    // Inverse H&S should form at the END of a downtrend
    const lookbackStart = Math.max(0, leftShoulder.index - 50);
    const priorCandles = candles.slice(lookbackStart, leftShoulder.index);
    if (priorCandles.length > 10) {
        const priorHigh = Math.max(...priorCandles.map(c => c.high));
        const priorLow = Math.min(...priorCandles.map(c => c.low));
        const priorTrend = (priorHigh - priorLow) / priorHigh;

        // Require at least 5% downtrend before the pattern
        if (priorTrend < 0.05) return null;
    }

    // Find neckline (resistance between shoulders)
    const necklineCandles = candles.slice(leftShoulder.index, rightShoulder.index);
    const neckline = Math.max(...necklineCandles.map(c => c.high));

    const currentPrice = candles[candles.length - 1].close;
    const breakout = currentPrice > neckline;

    // Calculate confidence
    let confidence = 5;
    if (shoulderDiff < 0.02) confidence += 2; // Shoulders very equal
    if (head.price < leftShoulder.price * 0.95) confidence += 1; // Clear head
    if (breakout) confidence += 2; // Neckline broken

    // Volume confirmation
    const avgVolume = candles.slice(-20).reduce((sum, c) => sum + c.volume, 0) / 20;
    const recentVolume = candles.slice(-3).reduce((sum, c) => sum + c.volume, 0) / 3;
    const volumeConfirmed = recentVolume > avgVolume * 1.5;
    if (volumeConfirmed) confidence += 1;

    // Only return if breakout occurred AND confidence is high
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

    // VALIDATION 0: Second peak must be recent (within last 20% of candles)
    // This prevents detecting old historical patterns
    const recentThreshold = candles.length - Math.floor(candles.length * 0.2);
    if (peak2.index < recentThreshold) return null;

    // VALIDATION 0.5: Peaks should be separated by at least 5 candles
    // Prevents detecting noise as double tops
    if (Math.abs(peak2.index - peak1.index) < 5) return null;

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

    // VALIDATION 4: Pattern must be forming NOW (not already broken down)
    // Reject if price has moved too far from the pattern area
    const distanceFromPeaks = Math.abs(currentPrice - avgPeak) / avgPeak;
    const distanceFromTrough = currentPrice < trough ? (trough - currentPrice) / trough : 0;

    // If price is far from the pattern zone, it's old news
    if (distanceFromPeaks > 0.10) return null; // More than 10% away from peaks
    if (distanceFromTrough > 0.01) return null; // More than 1% below trough (already broken down)

    // Pattern must be either:
    // 1. Still forming (price near peaks, within 5%)
    // 2. Just starting to break (price at or just below trough, within 1%)
    const isForming = distanceFromPeaks <= 0.05;
    const isJustBreaking = breakout && distanceFromTrough <= 0.01;

    if (!isForming && !isJustBreaking) return null;

    // Calculate confidence
    let confidence = 6;
    if (peakDiff < 0.01) confidence += 1; // Peaks very equal
    if (breakout) confidence += 2; // Support broken (confirmed pattern)

    // Volume: second peak should have lower volume (weakness)
    const vol1 = candles[peak1.index].volume;
    const vol2 = candles[peak2.index].volume;
    const volumeDivergence = vol2 < vol1 * 0.8;
    if (volumeDivergence) confidence += 1;

    // Breakout volume
    const avgVolume = candles.slice(-20).reduce((sum, c) => sum + c.volume, 0) / 20;
    const recentVolume = candles.slice(-3).reduce((sum, c) => sum + c.volume, 0) / 3;
    const volumeConfirmed = recentVolume > avgVolume * 1.5;
    if (volumeConfirmed && breakout) confidence += 1;

    // Require minimum confidence
    if (confidence < 7.0) return null;

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
        volumeRatio: parseFloat((recentVolume / avgVolume).toFixed(2)),
        breakoutConfirmed: breakout
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

    // VALIDATION 1: Troughs should be within 2% of each other
    const troughDiff = Math.abs(trough1.price - trough2.price) / trough1.price;
    if (troughDiff > 0.02) return null;

    // VALIDATION 2: Check for downtrend BEFORE the pattern
    // Double bottom should form at the END of a downtrend, not in an uptrend
    const lookbackStart = Math.max(0, trough1.index - 50);
    const priorCandles = candles.slice(lookbackStart, trough1.index);
    if (priorCandles.length > 10) {
        const priorHigh = Math.max(...priorCandles.map(c => c.high));
        const priorLow = Math.min(...priorCandles.map(c => c.low));
        const priorTrend = (priorHigh - priorLow) / priorHigh;

        // Require at least 5% downtrend before the pattern
        if (priorTrend < 0.05) return null;
    }

    // VALIDATION 3: Troughs should be at similar levels (support)
    // Both troughs should be lower than the peak between them by at least 3%
    const peakCandles = candles.slice(trough1.index, trough2.index);
    if (peakCandles.length === 0) return null;

    const peak = Math.max(...peakCandles.map(c => c.high));
    const avgTrough = (trough1.price + trough2.price) / 2;
    const troughToPeakRise = (peak - avgTrough) / avgTrough;

    // Require at least 3% rise between troughs
    if (troughToPeakRise < 0.03) return null;

    const currentPrice = candles[candles.length - 1].close;
    const breakout = currentPrice > peak;

    // Calculate confidence
    let confidence = 5;
    if (troughDiff < 0.01) confidence += 2; // Troughs very equal
    if (breakout) confidence += 2; // Resistance broken

    // Volume: second trough should have lower volume (capitulation)
    const vol1 = candles[trough1.index].volume;
    const vol2 = candles[trough2.index].volume;
    const volumeDivergence = vol2 < vol1 * 0.8;
    if (volumeDivergence) confidence += 1;

    // Breakout volume
    const avgVolume = candles.slice(-20).reduce((sum, c) => sum + c.volume, 0) / 20;
    const recentVolume = candles.slice(-3).reduce((sum, c) => sum + c.volume, 0) / 3;
    const volumeConfirmed = recentVolume > avgVolume * 1.5;
    if (volumeConfirmed) confidence += 1;

    // Only return if breakout occurred AND confidence is high
    if (!breakout || confidence < 7.0) return null;

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

    // VALIDATION 1: Require at least 4 swing points (2 on each trendline)
    if (swingHighs.length < 4 || swingLows.length < 4) return null;

    // Get recent swings (last 4 for better validation)
    const recentHighs = swingHighs.slice(-4);
    const recentLows = swingLows.slice(-4);

    // VALIDATION 2: Pattern duration should be reasonable (15-50 candles)
    const patternDuration = recentHighs[3].index - recentHighs[0].index;
    if (patternDuration < 15 || patternDuration > 50) return null;

    // Check for ascending triangle (higher lows, flat resistance)
    const lowsAscending = recentLows[1].price > recentLows[0].price &&
        recentLows[2].price > recentLows[1].price &&
        recentLows[3].price > recentLows[2].price;
    const highsFlat = Math.abs(recentHighs[3].price - recentHighs[0].price) / recentHighs[0].price < 0.02;

    // Check for descending triangle (lower highs, flat support)
    const highsDescending = recentHighs[1].price < recentHighs[0].price &&
        recentHighs[2].price < recentHighs[1].price &&
        recentHighs[3].price < recentHighs[2].price;
    const lowsFlat = Math.abs(recentLows[3].price - recentLows[0].price) / recentLows[0].price < 0.02;

    // Check for symmetrical triangle (converging)
    const converging = lowsAscending && highsDescending;

    // VALIDATION 3: Must be one of the three triangle types
    if (!lowsAscending && !highsDescending && !converging) return null;

    // VALIDATION 4: For symmetrical, ensure trendlines are actually converging
    if (converging) {
        const initialRange = recentHighs[0].price - recentLows[0].price;
        const finalRange = recentHighs[3].price - recentLows[3].price;
        const convergenceRatio = finalRange / initialRange;

        // Range should narrow by at least 30%
        if (convergenceRatio > 0.7) return null;
    }

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
        breakoutLevel = (recentHighs[3].price + recentLows[3].price) / 2;
        direction = 'neutral';
    }

    const currentPrice = candles[candles.length - 1].close;

    // VALIDATION 5: Breakout must be significant (2%+ from boundary)
    const breakoutDistance = direction === 'bullish' ?
        (currentPrice - breakoutLevel) / breakoutLevel :
        (breakoutLevel - currentPrice) / breakoutLevel;

    const breakout = breakoutDistance > 0.02;
    if (!breakout) return null;

    // Calculate confidence
    let confidence = 5;
    if (triangleType === 'ascending' || triangleType === 'descending') confidence += 1;
    if (breakout) confidence += 2;

    // Volume confirmation (higher threshold for triangles)
    const avgVolume = candles.slice(-20).reduce((sum, c) => sum + c.volume, 0) / 20;
    const recentVolume = candles.slice(-3).reduce((sum, c) => sum + c.volume, 0) / 3;
    const volumeConfirmed = recentVolume > avgVolume * 1.8;
    if (volumeConfirmed) confidence += 2;

    // Only return if confidence is high
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
    if (candles.length < 10) return null; // Need more candles for trend context

    const [c1, c2, c3] = candles.slice(-3);
    const current = c3;

    const body = Math.abs(current.close - current.open);
    const range = current.high - current.low;
    const upperWick = current.high - Math.max(current.open, current.close);
    const lowerWick = Math.min(current.open, current.close) - current.low;

    // VALIDATION: Check prior trend (last 5 candles before current)
    const priorCandles = candles.slice(-8, -3);
    const priorTrendBullish = priorCandles.filter(c => c.close > c.open).length >= 3;
    const priorTrendBearish = priorCandles.filter(c => c.close < c.open).length >= 3;

    // Hammer (Bullish reversal) - requires prior downtrend
    if (lowerWick > body * 2 && upperWick < body * 0.3 && current.close > current.open) {
        // VALIDATION: Hammer should appear after downtrend
        if (!priorTrendBearish) return null;

        return {
            type: 'CANDLESTICK_PATTERN',
            pattern: 'hammer',
            direction: 'bullish',
            currentPrice: current.close,
            confidence: 8.0, // Slightly lower, needs confirmation
            description: 'Hammer - Bullish reversal (needs confirmation)',
            needsConfirmation: true
        };
    }

    // Shooting Star (Bearish reversal) - requires prior uptrend
    if (upperWick > body * 2 && lowerWick < body * 0.3 && current.close < current.open) {
        // VALIDATION: Shooting star should appear after uptrend
        if (!priorTrendBullish) return null;

        return {
            type: 'CANDLESTICK_PATTERN',
            pattern: 'shooting_star',
            direction: 'bearish',
            currentPrice: current.close,
            confidence: 8.0, // Slightly lower, needs confirmation
            description: 'Shooting Star - Bearish reversal (needs confirmation)',
            needsConfirmation: true
        };
    }

    // Bullish Engulfing - requires prior downtrend
    if (c2.close < c2.open && // Previous red
        current.close > current.open && // Current green
        current.open < c2.close && // Opens below previous close
        current.close > c2.open) { // Closes above previous open

        // VALIDATION: Should appear after downtrend
        if (!priorTrendBearish) return null;

        // VALIDATION: Engulfing should be significant (>1% range)
        const engulfingSize = (current.close - current.open) / current.open;
        if (engulfingSize < 0.01) return null;

        return {
            type: 'CANDLESTICK_PATTERN',
            pattern: 'bullish_engulfing',
            direction: 'bullish',
            currentPrice: current.close,
            confidence: 8.5,
            description: 'Bullish Engulfing - Strong reversal',
            needsConfirmation: false
        };
    }

    // Bearish Engulfing - requires prior uptrend
    if (c2.close > c2.open && // Previous green
        current.close < current.open && // Current red
        current.open > c2.close && // Opens above previous close
        current.close < c2.open) { // Closes below previous open

        // VALIDATION: Should appear after uptrend
        if (!priorTrendBullish) return null;

        // VALIDATION: Engulfing should be significant (>1% range)
        const engulfingSize = (current.open - current.close) / current.open;
        if (engulfingSize < 0.01) return null;

        return {
            type: 'CANDLESTICK_PATTERN',
            pattern: 'bearish_engulfing',
            direction: 'bearish',
            currentPrice: current.close,
            confidence: 8.5,
            description: 'Bearish Engulfing - Strong reversal',
            needsConfirmation: false
        };
    }

    // Doji (Indecision) - only at extremes
    if (body < range * 0.1) {
        // VALIDATION: Doji should appear at trend extremes
        const priorRange = Math.max(...priorCandles.map(c => c.high)) - Math.min(...priorCandles.map(c => c.low));
        const priorRangePercent = priorRange / priorCandles[0].close;

        // Only alert if there was significant prior movement (5%+)
        if (priorRangePercent < 0.05) return null;

        return {
            type: 'CANDLESTICK_PATTERN',
            pattern: 'doji',
            direction: 'neutral',
            currentPrice: current.close,
            confidence: 7.0, // Lower confidence - needs confirmation
            description: 'Doji - Indecision at trend extreme (watch next candle)',
            needsConfirmation: true
        };
    }

    return null;
}

/**
 * Get swing window size based on timeframe
 * @param {string} timeframe - Timeframe (1D, 1W, 4H, etc.)
 * @returns {number} Lookback period
 */
function getSwingWindow(timeframe) {
    const windows = {
        '1D': 20,  // 20 trading days (~1 month)
        '1W': 8,   // 8 weeks (~2 months)
        '4H': 30,  // 30 periods
        '1H': 40   // 40 periods
    };
    return windows[timeframe] || 14; // Default to 14
}

/**
 * Calculate RSI using Wilder's smoothing method
 * @param {Array} candles - Historical candles
 * @param {number} period - RSI period (default 14)
 * @returns {Array} RSI values with timestamps
 */
function calculateRSI(candles, period = 14) {
    if (candles.length < period + 10) return [];

    const rsiValues = [];
    let gains = 0;
    let losses = 0;

    // Calculate initial average gain/loss
    for (let i = 1; i <= period; i++) {
        const change = candles[i].close - candles[i - 1].close;
        if (change > 0) {
            gains += change;
        } else {
            losses += Math.abs(change);
        }
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    // Calculate RSI for subsequent candles using Wilder's smoothing
    for (let i = period; i < candles.length; i++) {
        const change = candles[i].close - candles[i - 1].close;
        const currentGain = change > 0 ? change : 0;
        const currentLoss = change < 0 ? Math.abs(change) : 0;

        // Wilder's smoothing: (previous avg * (period - 1) + current) / period
        avgGain = ((avgGain * (period - 1)) + currentGain) / period;
        avgLoss = ((avgLoss * (period - 1)) + currentLoss) / period;

        // Calculate RS and RSI
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        const rsi = 100 - (100 / (1 + rs));

        rsiValues.push({
            index: i,
            value: rsi,
            timestamp: candles[i].timestamp || candles[i].time
        });
    }

    return rsiValues;
}

/**
 * Find swing points in RSI values
 * @param {Array} rsiValues - RSI values from calculateRSI
 * @param {number} window - Lookback window
 * @returns {Object} RSI swing highs and lows
 */
function findRSISwingPoints(rsiValues, window = 10) {
    const swingHighs = [];
    const swingLows = [];

    for (let i = window; i < rsiValues.length - window; i++) {
        const current = rsiValues[i];
        let isSwingHigh = true;
        let isSwingLow = true;

        // Check if current is higher/lower than surrounding RSI values
        for (let j = i - window; j <= i + window; j++) {
            if (j === i) continue;
            if (rsiValues[j].value >= current.value) isSwingHigh = false;
            if (rsiValues[j].value <= current.value) isSwingLow = false;
        }

        if (isSwingHigh) {
            swingHighs.push({
                index: current.index,
                value: current.value,
                timestamp: current.timestamp,
                type: 'high'
            });
        }
        if (isSwingLow) {
            swingLows.push({
                index: current.index,
                value: current.value,
                timestamp: current.timestamp,
                type: 'low'
            });
        }
    }

    return { swingHighs, swingLows };
}

module.exports = {
    detectHeadAndShoulders,
    detectInverseHeadAndShoulders,
    detectDoubleTop,
    detectDoubleBottom,
    detectTriangle,
    detectCandlestickPatterns,
    findSwingPoints,
    getSwingWindow,
    calculateRSI,
    findRSISwingPoints
};

