const { calculateRSI, findRSISwingPoints, findSwingPoints } = require('./chartPatterns');

/**
 * RSI Divergence Detector
 * Detects bullish and bearish RSI divergences for reversal signals
 */

/**
 * Detect RSI Divergence
 * @param {Array} candles - Historical candles
 * @param {string} timeframe - Timeframe for context
 * @returns {Array|null} Array of divergences or null
 */
function detectRSIDivergence(candles, timeframe = '1D') {
    if (candles.length < 50) return null;

    // Calculate RSI
    const rsiValues = calculateRSI(candles, 14);
    if (rsiValues.length < 20) return null;

    // Find swing points in price
    const priceSwingPoints = findSwingPoints(candles, 20);
    const priceHighs = priceSwingPoints.swingHighs;
    const priceLows = priceSwingPoints.swingLows;

    // Find swing points in RSI
    const rsiSwingPoints = findRSISwingPoints(rsiValues, 10);
    const rsiHighs = rsiSwingPoints.swingHighs;
    const rsiLows = rsiSwingPoints.swingLows;

    const divergences = [];
    const currentRSI = rsiValues[rsiValues.length - 1].value;
    const currentPrice = candles[candles.length - 1].close;

    // BULLISH DIVERGENCE: Price lower low, RSI higher low
    if (priceLows.length >= 2 && rsiLows.length >= 2) {
        const [pLow1, pLow2] = priceLows.slice(-2);
        const [rLow1, rLow2] = rsiLows.slice(-2);

        // Ensure recent swing points (last 30% of data)
        const recentThreshold = candles.length * 0.7;
        if (pLow2.index > recentThreshold && rLow2.index > recentThreshold) {
            // Price making lower low, RSI making higher low
            if (pLow2.price < pLow1.price && rLow2.value > rLow1.value) {
                let confidence = 8.0;

                // Increase confidence if RSI is oversold
                if (currentRSI < 30) confidence = 8.5;
                if (currentRSI < 25) confidence = 9.0;

                divergences.push({
                    type: 'RSI_DIVERGENCE',
                    divergenceType: 'regular',
                    direction: 'bullish',
                    confidence: confidence,
                    pricePoints: [pLow1, pLow2],
                    rsiPoints: [rLow1, rLow2],
                    currentRSI: currentRSI,
                    currentPrice: currentPrice,
                    isOversold: currentRSI < 30,
                    invalidationLevel: pLow2.price * 0.98, // 2% below recent low
                    description: `Bullish RSI Divergence - Price lower low (${pLow2.price.toFixed(2)}), RSI higher low (${rLow2.value.toFixed(1)})`
                });
            }
        }
    }

    // BEARISH DIVERGENCE: Price higher high, RSI lower high
    if (priceHighs.length >= 2 && rsiHighs.length >= 2) {
        const [pHigh1, pHigh2] = priceHighs.slice(-2);
        const [rHigh1, rHigh2] = rsiHighs.slice(-2);

        const recentThreshold = candles.length * 0.7;
        if (pHigh2.index > recentThreshold && rHigh2.index > recentThreshold) {
            // Price making higher high, RSI making lower high
            if (pHigh2.price > pHigh1.price && rHigh2.value < rHigh1.value) {
                let confidence = 8.0;

                // Increase confidence if RSI is overbought
                if (currentRSI > 70) confidence = 8.5;
                if (currentRSI > 75) confidence = 9.0;

                divergences.push({
                    type: 'RSI_DIVERGENCE',
                    divergenceType: 'regular',
                    direction: 'bearish',
                    confidence: confidence,
                    pricePoints: [pHigh1, pHigh2],
                    rsiPoints: [rHigh1, rHigh2],
                    currentRSI: currentRSI,
                    currentPrice: currentPrice,
                    isOverbought: currentRSI > 70,
                    invalidationLevel: pHigh2.price * 1.02, // 2% above recent high
                    description: `Bearish RSI Divergence - Price higher high (${pHigh2.price.toFixed(2)}), RSI lower high (${rHigh2.value.toFixed(1)})`
                });
            }
        }
    }

    return divergences.length > 0 ? divergences : null;
}

module.exports = {
    detectRSIDivergence
};
