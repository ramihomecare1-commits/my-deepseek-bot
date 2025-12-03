const { fetchMexcCandlesBatch } = require('./mexcDataService');
const { addVolumeConfirmation, checkProximity, findSupportResistance } = require('../utils/patternDetector');
const {
    detectDoubleTop,
    detectDoubleBottom,
    detectHeadAndShoulders,
    detectInverseHeadAndShoulders,
    detectTriangle,
    detectCandlestickPatterns
} = require('../utils/chartPatterns');
const { detectRSIDivergence } = require('../utils/rsiDivergence');
const { analyzeMarketStructure, isPatternAlignedWithStructure } = require('../utils/marketStructure');
const { generateCriticalAlertSummary } = require('./aiAlertSummary');
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
            console.error(`   ❌ ${symbol}: ${error.message} `);
            results.noSignals.push(symbol);
        }
    }

    console.log(`✅ Scan complete: ${results.critical.length} critical, ${results.watchList.length} watch, ${results.noSignals.length} no signals`);

    // Calculate multi-timeframe confluence
    results.critical = calculateTimeframeConfluence(results.critical);
    results.watchList = calculateTimeframeConfluence(results.watchList);

    // Generate AI summary for critical alerts
    if (results.critical.length > 0) {
        console.log(`🤖 Generating AI summary for ${results.critical.length} critical alert(s)...`);
        results.aiSummary = await generateCriticalAlertSummary(results.critical);
    }

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
        alerts: [],
        currentPrice: null
    };

    // Fetch candles for 1D and 1W timeframes
    const timeframes = ['1D', '1W'];

    for (const timeframe of timeframes) {
        // Map MATIC to POL (MEXC rebrand)
        const mexcSymbol = symbol === 'MATIC' ? 'POL' : symbol;

        // Fetch candles for this symbol and timeframe
        const candles = await fetchMexcCandlesBatch(`${mexcSymbol} USDT`, timeframe, 2000);

        if (!candles || candles.length < 50) continue;

        const currentPrice = candles[candles.length - 1].close;

        // Store current price (use latest from any timeframe)
        if (!findings.currentPrice) {
            findings.currentPrice = currentPrice;
        }

        // Analyze market structure FIRST (provides context for patterns)
        const marketStructure = analyzeMarketStructure(candles);

        // 1. Check Support/Resistance Proximity
        const srLevels = findSupportResistance(candles);
        const allLevels = [
            ...(srLevels.swingLevels?.resistance || []),
            ...(srLevels.swingLevels?.support || [])
        ];

        for (const level of allLevels) {
            const levelWithProximity = checkProximity(level, currentPrice);
            if (levelWithProximity.isNear) {
                // Determine if it's support or resistance based on approach direction
                // Look at last 5 candles to determine trend direction
                const recentCandles = candles.slice(-5);
                const priceChange = recentCandles[recentCandles.length - 1].close - recentCandles[0].close;
                const isMovingUp = priceChange > 0;

                // If moving UP towards a level ABOVE current price → resistance
                // If moving DOWN towards a level BELOW current price → support
                let levelType;
                if (currentPrice < level.price) {
                    // Level is above current price
                    levelType = isMovingUp ? 'resistance' : 'resistance'; // Always resistance if above
                } else {
                    // Level is below current price
                    levelType = 'support'; // Always support if below
                }

                findings.alerts.push({
                    type: 'PROXIMITY',
                    timeframe,
                    severity: levelWithProximity.distancePercent < 1 ? 'critical' : 'watch',
                    message: `Near ${levelType} at $${level.price.toFixed(2)} (${levelWithProximity.distancePercent.toFixed(2)}% away)`,
                    price: level.price,
                    distance: levelWithProximity.distancePercent,
                    levelType: levelType
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

        // 3. Check RSI Divergence
        const rsiDivergences = detectRSIDivergence(candles, timeframe);
        if (rsiDivergences && rsiDivergences.length > 0) {
            patterns.push(...rsiDivergences);
        }

        for (const pattern of patterns) {
            // Check pattern alignment with market structure
            const structureAlignment = isPatternAlignedWithStructure(pattern, marketStructure);

            // Adjust confidence based on structure
            let adjustedConfidence = pattern.confidence + structureAlignment.confidenceAdjustment;
            adjustedConfidence = Math.max(0, Math.min(10, adjustedConfidence)); // Clamp to 0-10

            // Use specific pattern name (e.g., "hammer", "bullish_engulfing") instead of generic "CANDLESTICK_PATTERN"
            const patternName = pattern.pattern || pattern.type;
            const formattedName = patternName.replace(/_/g, ' ').toUpperCase();

            // Format message based on pattern type
            let message;
            if (pattern.type === 'RSI_DIVERGENCE') {
                // RSI divergence: include type (hidden vs regular), RSI value and invalidation level
                const divType = pattern.divergenceType === 'hidden' ? 'HIDDEN ' : '';
                message = `${divType}RSI ${pattern.direction.toUpperCase()} DIVERGENCE (RSI: ${pattern.currentRSI.toFixed(1)})`;
                if (pattern.invalidationLevel) {
                    message += ` - Stop: $${pattern.invalidationLevel.toFixed(2)}`;
                }
            } else {
                // Regular patterns
                message = `${formattedName} (${pattern.direction})`;
                if (pattern.invalidationLevel) {
                    message += ` - Stop: $${pattern.invalidationLevel.toFixed(2)}`;
                }
            }

            findings.alerts.push({
                type: 'PATTERN',
                timeframe,
                severity: adjustedConfidence >= 8.5 ? 'critical' : 'watch',
                message: message,
                pattern: pattern.type,
                confidence: adjustedConfidence,
                volumeConfirmed: pattern.volumeConfirmed || false,
                volumeRatio: pattern.volumeRatio || null,
                // Add market structure context
                marketStructure: {
                    trend: marketStructure.trend,
                    strength: marketStructure.strength,
                    aligned: structureAlignment.aligned
                }
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
    report += `🕐 ${timestamp} \n\n`;
    report += `📈 SCANNED: ${results.totalCoins} coins\n\n`;

    // AI-Enhanced Critical Alerts
    if (results.critical.length > 0) {
        if (results.aiSummary) {
            report += `🤖 AI MARKET ANALYSIS: \n\n`;
            report += `${results.aiSummary} \n\n`;
        } else {
            // Fallback to basic format if AI fails
            report += `🔴 CRITICAL ALERTS(${results.critical.length}): \n`;
            for (const coin of results.critical) {
                const priceStr = coin.currentPrice ? ` @$${coin.currentPrice.toFixed(2)} ` : '';
                report += `\n💎 ${coin.symbol}${priceStr}: \n`;
                for (const alert of coin.alerts.filter(a => a.severity === 'critical')) {
                    report += `  •[${alert.timeframe}] ${alert.message} \n`;
                }
            }
            report += `\n`;
        }
    }

    // Watch List - Group by coin with better formatting
    if (results.watchList.length > 0) {
        report += `⚠️ WATCH LIST(${results.watchList.length}): \n\n`;
        for (const coin of results.watchList) {
            const priceStr = coin.currentPrice ? ` @$${coin.currentPrice.toFixed(2)} ` : '';
            report += `💎 ${coin.symbol}${priceStr}: \n`;

            // Group alerts by timeframe for clarity
            const alertsByTimeframe = {};
            for (const alert of coin.alerts) {
                if (!alertsByTimeframe[alert.timeframe]) {
                    alertsByTimeframe[alert.timeframe] = [];
                }
                alertsByTimeframe[alert.timeframe].push(alert.message);
            }

            // Display grouped alerts
            for (const [timeframe, messages] of Object.entries(alertsByTimeframe)) {
                report += `  [${timeframe}] ${messages.join(', ')} \n`;
            }
            report += `\n`;
        }
    }

    // No Signals
    if (results.noSignals.length > 0) {
        report += `✅ NO SIGNALS(${results.noSignals.length}): \n`;
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

/**
 * Calculate multi-timeframe confluence
 * Detects when patterns align across timeframes and boosts confidence
 * @param {Array} coinAlerts - Array of coin alert objects
 * @returns {Array} Updated coin alerts with confluence data
 */
function calculateTimeframeConfluence(coinAlerts) {
    return coinAlerts.map(coinAlert => {
        const { symbol, alerts } = coinAlert;

        // Group alerts by timeframe
        const dailyAlerts = alerts.filter(a => a.timeframe === '1D');
        const weeklyAlerts = alerts.filter(a => a.timeframe === '1W');

        if (dailyAlerts.length === 0 || weeklyAlerts.length === 0) {
            return coinAlert; // No confluence possible
        }

        // Check for directional alignment
        const dailyBullish = dailyAlerts.some(a => a.pattern && a.message &&
            (a.message.toLowerCase().includes('bullish') || a.message.toLowerCase().includes('bottom')));
        const dailyBearish = dailyAlerts.some(a => a.pattern && a.message &&
            (a.message.toLowerCase().includes('bearish') || a.message.toLowerCase().includes('top')));

        const weeklyBullish = weeklyAlerts.some(a => a.pattern && a.message &&
            (a.message.toLowerCase().includes('bullish') || a.message.toLowerCase().includes('bottom')));
        const weeklyBearish = weeklyAlerts.some(a => a.pattern && a.message &&
            (a.message.toLowerCase().includes('bearish') || a.message.toLowerCase().includes('top')));

        // Determine confluence
        let hasConfluence = false;
        let confluenceDirection = null;
        let confluenceBoost = 0;

        if (dailyBullish && weeklyBullish) {
            hasConfluence = true;
            confluenceDirection = 'bullish';
            confluenceBoost = 2.0;
        } else if (dailyBearish && weeklyBearish) {
            hasConfluence = true;
            confluenceDirection = 'bearish';
            confluenceBoost = 2.0;
        } else if ((dailyBullish && weeklyBearish) || (dailyBearish && weeklyBullish)) {
            // Conflicting signals - reduce confidence
            confluenceBoost = -1.0;
        }

        // Apply confluence boost to all alerts
        if (hasConfluence || confluenceBoost !== 0) {
            alerts.forEach(alert => {
                if (alert.confidence) {
                    alert.confidence = Math.max(0, Math.min(10, alert.confidence + confluenceBoost));
                    alert.confluence = {
                        hasConfluence,
                        direction: confluenceDirection,
                        boost: confluenceBoost
                    };
                }
            });
        }

        return { ...coinAlert, alerts };
    });
}

module.exports = {
    scanAllCoinsForPatterns,
    scanCoinForPatterns,
    generateTelegramReport,
    executeManualPatternScan,
    calculateTimeframeConfluence
};
```
