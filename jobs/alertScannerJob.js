/**
 * Alert Scanner Job
 * Background job that scans for trading alerts at scheduled intervals
 */

const cron = require('node-cron');
const { fetchMexcCandlesBatch } = require('../services/mexcDataService');
const { findSupportResistance, addVolumeConfirmation, checkProximity } = require('../utils/patternDetector');
const { detectBreakout, detectLevelTest, detectVolumeMomentum } = require('../services/alertService');
const { sendAlert } = require('../services/alertNotificationService');
const { loadAlertSettings, getCoinSettings } = require('../models/alertSettings');

// Track last alert time to avoid spam (coin_type => timestamp)
const lastAlertTime = new Map();

/**
 * Check if alert should be sent (deduplication)
 * @param {Object} alert - Alert object
 * @param {string} coin - Coin symbol
 * @returns {boolean} True if should send
 */
function shouldSendAlert(alert, coin) {
    const key = `${coin}_${alert.type}`;
    const lastTime = lastAlertTime.get(key);

    if (!lastTime) return true;

    // Don't send same alert type for same coin within 1 hour
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

            // Fetch candles
            const candles = await fetchMexcCandlesBatch(`${coin}USDT`, '1d', 500);
            if (!candles || candles.length === 0) {
                console.log(`⚠️ No candles for ${coin}`);
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

            if (settings.alertTypes.levelBreakout) {
                const breakout = detectBreakout(coin, candles, enhancedLevels, settings);
                if (breakout) alerts.push(breakout);
            }

            if (settings.alertTypes.keyLevelTest) {
                const levelTest = detectLevelTest(coin, candles, enhancedLevels, settings);
                if (levelTest) alerts.push(levelTest);
            }

            // Volume momentum disabled by default in ultra-filtered mode
            if (settings.alertTypes.volumeMomentum) {
                const momentum = detectVolumeMomentum(coin, candles, enhancedLevels);
                if (momentum && momentum.confidence >= 8.5) alerts.push(momentum);
            }

            // Send alerts (with deduplication)
            for (const alert of alerts) {
                if (shouldSendAlert(alert, coin)) {
                    const sent = await sendAlert(alert, settings);
                    if (sent) {
                        lastAlertTime.set(`${coin}_${alert.type}`, Date.now());
                    }
                }
            }

            if (alerts.length === 0) {
                console.log(`✅ ${coin}: No high-probability alerts`);
            }

        } catch (error) {
            console.error(`❌ Error scanning ${coin}:`, error.message);
        }
    }
}

/**
 * Start alert scanner jobs (ULTRA-FILTERED - Top 5 only)
 */
function startAlertScanner() {
    const settings = loadAlertSettings();

    if (!settings.enabled) {
        console.log('⏸️ Alert scanner disabled in settings');
        return;
    }

    console.log('🚀 Starting ULTRA-FILTERED alert scanner...');
    console.log('   🎯 Focus: BTC, ETH, Top 5 market cap only');
    console.log('   📊 Filters: Confidence 8.5+, Volume 180%+, 3+ confluence');
    console.log('');

    // BTC/ETH - Every 15 minutes (highest priority)
    cron.schedule('*/15 * * * *', () => {
        console.log('');
        console.log('🔍 [15min] Scanning BTC/ETH for HIGH-PROBABILITY alerts...');
        scanForAlerts(['BTC', 'ETH'], settings);
    });

    // Top 5 market cap - Every 30 minutes
    cron.schedule('*/30 * * * *', () => {
        console.log('');
        console.log('🔍 [30min] Scanning Top 5 for HIGH-PROBABILITY alerts...');
        scanForAlerts(['BNB', 'SOL', 'XRP'], settings);
    });

    console.log('✅ ULTRA-FILTERED alert scanner started!');
    console.log('   📊 BTC/ETH: Every 15 minutes');
    console.log('   📊 Top 5 (BNB/SOL/XRP): Every 30 minutes');
    console.log('   ⚡ Only CRITICAL and HIGH priority alerts');
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
