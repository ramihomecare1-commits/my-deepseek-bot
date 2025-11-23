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

            // Detect alerts
            const alerts = [];

            if (settings.alertTypes.levelBreakout) {
                const breakout = detectBreakout(coin, candles, enhancedLevels);
                if (breakout) alerts.push(breakout);
            }

            if (settings.alertTypes.keyLevelTest) {
                const levelTest = detectLevelTest(coin, candles, enhancedLevels);
                if (levelTest) alerts.push(levelTest);
            }

            if (settings.alertTypes.volumeMomentum) {
                const momentum = detectVolumeMomentum(coin, candles, enhancedLevels);
                if (momentum) alerts.push(momentum);
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
                console.log(`✅ ${coin}: No alerts`);
            }

        } catch (error) {
            console.error(`❌ Error scanning ${coin}:`, error.message);
        }
    }
}

/**
 * Start alert scanner jobs
 */
function startAlertScanner() {
    const settings = loadAlertSettings();

    if (!settings.enabled) {
        console.log('⏸️ Alert scanner disabled in settings');
        return;
    }

    console.log('🚀 Starting alert scanner...');
    console.log('');

    // BTC/ETH - Every 15 minutes
    cron.schedule('*/15 * * * *', () => {
        console.log('');
        console.log('🔍 [15min] Scanning BTC/ETH for alerts...');
        scanForAlerts(['BTC', 'ETH'], settings);
    });

    // Major altcoins - Every 30 minutes
    cron.schedule('*/30 * * * *', () => {
        console.log('');
        console.log('🔍 [30min] Scanning major altcoins for alerts...');
        scanForAlerts(['BNB', 'SOL', 'XRP', 'ADA'], settings);
    });

    // All coins - Every hour
    cron.schedule('0 * * * *', () => {
        console.log('');
        console.log('🔍 [1hr] Scanning all coins for alerts...');
        scanForAlerts(['AVAX', 'DOT', 'MATIC', 'LINK'], settings);
    });

    console.log('✅ Alert scanner started successfully!');
    console.log('   📊 BTC/ETH: Every 15 minutes');
    console.log('   📊 Major Altcoins: Every 30 minutes');
    console.log('   📊 All Coins: Every hour');
    console.log('');

    // Run initial scan immediately
    console.log('🔍 Running initial scan...');
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
