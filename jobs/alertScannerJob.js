/**
 * Alert Scanner Job
 * Background job that scans for trading alerts at scheduled intervals
 */

const cron = require('node-cron');
const { fetchMexcCandlesBatch } = require('../services/mexcDataService');
const { findSupportResistance, addVolumeConfirmation, checkProximity } = require('../utils/patternDetector');
const {
    detectBreakout,
    detectLevelTest,
    detectVolumeMomentum,
    detectHeadAndShoulders,
    detectInverseHeadAndShoulders,
    detectDoubleTop,
    detectDoubleBottom,
    detectTriangle,
    detectCandlestickPatterns
} = require('../services/alertService');
const { sendAlert } = require('../services/alertNotificationService');
const { loadAlertSettings, getCoinSettings } = require('../models/alertSettings');

// Track last alert time to avoid spam (coin_type_timeframe => timestamp)
const lastAlertTime = new Map();

/**
 * Check if alert should be sent (deduplication)
 * @param {Object} alert - Alert object
 * @param {string} coin - Coin symbol
 * @param {string} timeframe - Timeframe
 * @returns {boolean} True if should send
 */
function shouldSendAlert(alert, coin, timeframe) {
    const key = `${coin}_${alert.type}_${timeframe}`;
    const lastTime = lastAlertTime.get(key);

    if (!lastTime) return true;

    // Don't send same alert type for same coin/timeframe within 1 hour
    const hourInMs = 60 * 60 * 1000;
    return (Date.now() - lastTime) > hourInMs;
}

/**
 * Scan for alerts on specific coins
 * @param {Array} coins - Array of coin symbols
 * @param {Object} settings - Alert settings
 */
async function scanForAlerts(coins, settings) {
    for (const coin of coins) {
        try {
            // Check if coin is enabled in settings
            const coinSettings = getCoinSettings(coin, settings);
            if (coinSettings.enabled === false) {
                console.log(`⏭️ ${coin}: Disabled in settings`);
                continue;
            }

            console.log(`🔍 Scanning ${coin} for alerts...`);

            // Get timeframes for this coin (default: 1d and 1w)
            const timeframes = coinSettings.timeframes || ['1d', '1w'];

            for (const timeframe of timeframes) {
                console.log(`   📊 Timeframe: ${timeframe.toUpperCase()}`);

                // Fetch candles for this timeframe
                const candles = await fetchMexcCandlesBatch(`${coin}USDT`, timeframe, 500);
                if (!candles || candles.length === 0) {
                    console.log(`   ⚠️ No ${timeframe} candles for ${coin}`);
                    continue;
                }

                // Detect levels
                const levels = findSupportResistance(candles);
                const currentPrice = candles[candles.length - 1].close;

                // Apply volume confirmation and proximity
                const enhancedLevels = {
                    support: levels.swingLevels.support
                        .filter(l => l.price < currentPrice)
                        .map(l => addVolumeConfirmation(l, candles))
                        .map(l => checkProximity(l, currentPrice)),
                    resistance: levels.swingLevels.resistance
                        .filter(l => l.price > currentPrice)
                        .map(l => addVolumeConfirmation(l, candles))
                        .map(l => checkProximity(l, currentPrice))
                };

                // Detect alerts (pass settings for strict filtering)
                const alerts = [];

                // Level-based alerts
                if (settings.alertTypes.levelBreakout) {
                    const breakout = detectBreakout(coin, candles, enhancedLevels, settings);
                    if (breakout) {
                        breakout.timeframe = timeframe;
                        alerts.push(breakout);
                    }
                }

                if (settings.alertTypes.keyLevelTest) {
                    const levelTest = detectLevelTest(coin, candles, enhancedLevels, settings);
                    if (levelTest) {
                        levelTest.timeframe = timeframe;
                        alerts.push(levelTest);
                    }
                }

                // Volume momentum disabled by default in ultra-filtered mode
                if (settings.alertTypes.volumeMomentum) {
                    const momentum = detectVolumeMomentum(coin, candles, enhancedLevels);
                    if (momentum && momentum.confidence >= 8.5) {
                        momentum.timeframe = timeframe;
                        alerts.push(momentum);
                    }
                }

                // Chart pattern alerts
                if (settings.alertTypes.headAndShoulders) {
                    const hs = detectHeadAndShoulders(candles);
                    if (hs) {
                        hs.symbol = coin;
                        hs.timeframe = timeframe;
                        alerts.push(hs);
                    }

                    const ihs = detectInverseHeadAndShoulders(candles);
                    if (ihs) {
                        ihs.symbol = coin;
                        ihs.timeframe = timeframe;
                        alerts.push(ihs);
                    }
                }

                if (settings.alertTypes.doubleTops) {
                    const dt = detectDoubleTop(candles);
                    if (dt) {
                        dt.symbol = coin;
                        dt.timeframe = timeframe;
                        alerts.push(dt);
                    }

                    const db = detectDoubleBottom(candles);
                    if (db) {
                        db.symbol = coin;
                        db.timeframe = timeframe;
                        alerts.push(db);
                    }
                }

                if (settings.alertTypes.triangles) {
                    const triangle = detectTriangle(candles);
                    if (triangle) {
                        triangle.symbol = coin;
                        triangle.timeframe = timeframe;
                        alerts.push(triangle);
                    }
                }

                if (settings.alertTypes.candlestickPatterns) {
                    const candlestick = detectCandlestickPatterns(candles);
                    if (candlestick && candlestick.confidence >= 8.5) {
                        candlestick.symbol = coin;
                        candlestick.timeframe = timeframe;
                        alerts.push(candlestick);
                    }
                }

                // Send alerts (with deduplication)
                for (const alert of alerts) {
                    if (shouldSendAlert(alert, coin, timeframe)) {
                        const sent = await sendAlert(alert, settings);
                        if (sent) {
                            lastAlertTime.set(`${coin}_${alert.type}_${timeframe}`, Date.now());
                        }
                    }
                }

                if (alerts.length === 0) {
                    console.log(`   ✅ ${timeframe.toUpperCase()}: No high-probability alerts`);
                } else {
                    console.log(`   🔔 ${timeframe.toUpperCase()}: ${alerts.length} alert(s) found`);
                }
            }

        } catch (error) {
            console.error(`❌ Error scanning ${coin}:`, error.message);
        }
    }
}

/**
 * Start alert scanner jobs (ULTRA-FILTERED - Top 20 coins)
 */
function startAlertScanner() {
    const settings = loadAlertSettings();

    if (!settings.enabled) {
        console.log('⏸️ Alert scanner disabled in settings');
        return;
    }

    console.log('🚀 Starting ULTRA-FILTERED alert scanner with CHART PATTERNS...');
    console.log('   🎯 Coverage: Top 20 coins (excluding stablecoins/wrapped)');
    console.log('   📊 Timeframes: 1D + 1W');
    console.log('   🎨 Patterns: H&S, Double Tops/Bottoms, Triangles, Candlesticks');
    console.log('   📊 Filters: Confidence 8.5+, Volume 180%+, 3+ confluence');
    console.log('');

    // Tier 1: BTC/ETH - Every 15 minutes
    cron.schedule('*/15 * * * *', () => {
        console.log('');
        console.log('🔍 [15min] Scanning Tier 1 (BTC/ETH)...');
        scanForAlerts(['BTC', 'ETH'], settings);
    });

    // Tier 2: Major altcoins - Every 30 minutes
    cron.schedule('*/30 * * * *', () => {
        console.log('');
        console.log('🔍 [30min] Scanning Tier 2 (BNB/SOL/XRP/ADA/DOGE/TRX/AVAX/DOT)...');
        scanForAlerts(['BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'TRX', 'AVAX', 'DOT'], settings);
    });

    // Tier 3: Other top 20 - Every 1 hour
    cron.schedule('0 * * * *', () => {
        console.log('');
        console.log('🔍 [1hr] Scanning Tier 3 (MATIC/LINK/UNI/ATOM/LTC/APT/ARB/OP/INJ/SUI)...');
        scanForAlerts(['MATIC', 'LINK', 'UNI', 'ATOM', 'LTC', 'APT', 'ARB', 'OP', 'INJ', 'SUI'], settings);
    });

    console.log('✅ ULTRA-FILTERED alert scanner started!');
    console.log('   📊 Tier 1 (BTC/ETH): Every 15 minutes');
    console.log('   📊 Tier 2 (8 coins): Every 30 minutes');
    console.log('   📊 Tier 3 (10 coins): Every hour');
    console.log('   ⚡ Only CRITICAL and HIGH priority alerts');
    console.log('   🎨 Chart patterns + Level breakouts/tests');
    console.log('');

    // Run initial scan immediately
    console.log('🔍 Running initial HIGH-PROBABILITY scan...');
    scanForAlerts(['BTC', 'ETH'], settings);
}

/**
 * Stop alert scanner (for graceful shutdown)
 */
function stopAlertScanner() {
    console.log('⏹️ Stopping alert scanner...');
    // Cron jobs will be stopped when process exits
}

module.exports = {
    startAlertScanner,
    stopAlertScanner,
    scanForAlerts
};
