const { fetchMexcCandlesBatch } = require('./mexcDataService');
const { findSupportResistance, addVolumeConfirmation, checkProximity } = require('../utils/patternDetector');
const {
    detectHeadAndShoulders,
    detectInverseHeadAndShoulders,
    detectDoubleTop,
    detectDoubleBottom,
    detectTriangle,
    detectCandlestickPatterns
} = require('./alertService');
const { sendTelegramMessage } = require('./notificationService');

/**
 * Scan all coins for patterns and generate comprehensive report
 * @returns {Promise<Object>} Scan results
 */
async function scanAllCoinsForPatterns() {
    const coins = [
        'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'TRX', 'AVAX', 'DOT',
        'MATIC', 'LINK', 'UNI', 'ATOM', 'LTC', 'APT', 'ARB', 'OP', 'INJ', 'SUI'
    ];

    const results = {
        timestamp: new Date().toISOString(),
        totalCoins: coins.length,
        critical: [],
        watchList: [],
        noSignals: []
    };

    console.log(`📊 Starting manual pattern scan for ${coins.length} coins...`);

    for (const symbol of coins) {
        try {
            const coinFindings = await scanCoinForPatterns(symbol);

            if (coinFindings.alerts.length > 0) {
                // Has critical alerts
                if (coinFindings.alerts.some(a => a.severity === 'critical')) {
                    results.critical.push(coinFindings);
                } else {
                    results.watchList.push(coinFindings);
                }
            } else {
                results.noSignals.push(symbol);
            }

            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
            console.error(`   ❌ ${symbol}: ${error.message}`);
            results.noSignals.push(symbol);
        }
    }

    console.log(`✅ Scan complete: ${results.critical.length} critical, ${results.watchList.length} watch, ${results.noSignals.length} no signals`);
    return results;
}

/**
 * Scan a single coin for patterns
 * @param {string} symbol - Coin symbol
 * @returns {Promise<Object>} Coin findings
 */
async function scanCoinForPatterns(symbol) {
    const findings = {
        symbol,
        alerts: []
    };

    // Fetch candles for 1D and 1W timeframes
    const timeframes = ['1D', '1W'];

    for (const timeframe of timeframes) {
        // Map MATIC to POL (MEXC rebrand)
        const mexcSymbol = symbol === 'MATIC' ? 'POL' : symbol;

        // Fetch candles for this symbol and timeframe
        const candles = await fetchMexcCandlesBatch(`${mexcSymbol}USDT`, timeframe, 2000);

        if (!candles || candles.length < 50) continue;

        const currentPrice = candles[candles.length - 1].close;

        // 1. Check Support/Resistance Proximity
        const srLevels = findSupportResistance(candles);
        const allLevels = [
            ...(srLevels.swingLevels?.resistance || []),
            ...(srLevels.swingLevels?.support || [])
        ];

        for (const level of allLevels) {
            const levelWithProximity = checkProximity(level, currentPrice);
            if (levelWithProximity.isNear) {
                findings.alerts.push({
                    type: 'PROXIMITY',
                    timeframe,
                    severity: levelWithProximity.distancePercent < 1 ? 'critical' : 'watch',
                    message: `Near ${level.type || 'level'} at $${level.price.toFixed(2)} (${levelWithProximity.distancePercent.toFixed(2)}% away)`,
                    price: level.price,
                    distance: levelWithProximity.distancePercent
                });
            }
        }

        // 2. Check Chart Patterns
        const patterns = [
            detectDoubleTop(candles),
            detectDoubleBottom(candles),
            detectHeadAndShoulders(candles),
            detectInverseHeadAndShoulders(candles),
            detectTriangle(candles),
            detectCandlestickPatterns(candles)
        ].filter(Boolean);

        for (const pattern of patterns) {
            // Use specific pattern name (e.g., "hammer", "bullish_engulfing") instead of generic "CANDLESTICK_PATTERN"
            const patternName = pattern.pattern || pattern.type;
            const formattedName = patternName.replace(/_/g, ' ').toUpperCase();

            findings.alerts.push({
                type: 'PATTERN',
                timeframe,
                severity: pattern.confidence >= 8.5 ? 'critical' : 'watch',
                message: `${formattedName} (${pattern.direction})`,
                pattern: pattern.type,
                confidence: pattern.confidence
            });
        }
    }

    return findings;
}

/**
 * Generate formatted Telegram report
 * @param {Object} results - Scan results
 * @returns {string} Formatted report
 */
function generateTelegramReport(results) {
    const timestamp = new Date(results.timestamp).toLocaleString('en-US', {
        timeZone: 'UTC',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short'
    });

    let report = `📊 PATTERN SCAN REPORT\n`;
    report += `🕐 ${timestamp}\n\n`;
    report += `📈 SCANNED: ${results.totalCoins} coins\n\n`;

    // Critical Alerts
    if (results.critical.length > 0) {
        report += `🔴 CRITICAL ALERTS (${results.critical.length}):\n`;
        for (const coin of results.critical) {
            report += `\n💎 ${coin.symbol}:\n`;
            for (const alert of coin.alerts.filter(a => a.severity === 'critical')) {
                report += `  • [${alert.timeframe}] ${alert.message}\n`;
            }
        }
        report += `\n`;
    }

    // Watch List
    if (results.watchList.length > 0) {
        report += `⚠️ WATCH LIST (${results.watchList.length}):\n`;
        for (const coin of results.watchList) {
            const messages = coin.alerts.map(a => a.message).join(', ');
            report += `• ${coin.symbol}: ${messages}\n`;
        }
        report += `\n`;
    }

    // No Signals
    if (results.noSignals.length > 0) {
        report += `✅ NO SIGNALS (${results.noSignals.length}):\n`;
        report += results.noSignals.join(', ');
    }

    // Truncate if too long (Telegram limit is 4096 chars)
    if (report.length > 4000) {
        report = report.substring(0, 3950) + '\n\n... (Report truncated)';
    }

    return report;
}

/**
 * Execute manual pattern scan and send Telegram report
 * @returns {Promise<Object>} Result
 */
async function executeManualPatternScan() {
    try {
        console.log('🚀 Manual pattern scan triggered...');

        // Scan all coins
        const results = await scanAllCoinsForPatterns();

        // Generate report
        const report = generateTelegramReport(results);

        // Send to Telegram
        const telegramResult = await sendTelegramMessage(report);

        return {
            success: true,
            message: 'Pattern scan completed and report sent to Telegram',
            stats: {
                total: results.totalCoins,
                critical: results.critical.length,
                watch: results.watchList.length,
                noSignals: results.noSignals.length
            },
            telegramSent: telegramResult.success
        };
    } catch (error) {
        console.error('❌ Manual pattern scan failed:', error);
        return {
            success: false,
            message: error.message,
            error: error.message
        };
    }
}

module.exports = {
    scanAllCoinsForPatterns,
    scanCoinForPatterns,
    generateTelegramReport,
    executeManualPatternScan
};
