/**
 * Pattern Scanner Job
 * Automatic scheduled pattern scanning with configurable intervals
 */

const { scanAllCoinsForPatterns, generateTelegramReport } = require('../services/patternScanService');
const { sendTelegramMessage } = require('../services/notificationService');
const { loadPatternScanSettings, updateLastRun } = require('../models/patternScanSettings');

let activeInterval = null;

/**
 * Get interval in milliseconds
 * @param {string} interval - Interval ('1H', '4H', '6H', '12H', '1D')
 * @returns {number} Interval in milliseconds
 */
function getIntervalMs(interval) {
    const intervals = {
        '1H': 60 * 60 * 1000,           // 1 hour
        '4H': 4 * 60 * 60 * 1000,       // 4 hours
        '6H': 6 * 60 * 60 * 1000,       // 6 hours
        '12H': 12 * 60 * 60 * 1000,     // 12 hours
        '1D': 24 * 60 * 60 * 1000       // 24 hours
    };

    return intervals[interval] || intervals['4H'];
}

/**
 * Run pattern scan
 */
async function runPatternScan() {
    try {
        console.log('');
        console.log('📊 [AUTO] Running scheduled pattern scan...');
        console.log(`   ⏰ Time: ${new Date().toISOString()}`);

        const results = await scanAllCoinsForPatterns();
        const report = generateTelegramReport(results);

        await sendTelegramMessage(report);

        updateLastRun();

        console.log('✅ Scheduled pattern scan complete');
        console.log(`   🔴 Critical: ${results.critical.length}`);
        console.log(`   ⚠️  Watch: ${results.watchList.length}`);
        console.log(`   ✅ No signals: ${results.noSignals.length}`);
    } catch (error) {
        console.error('❌ Error in scheduled pattern scan:', error.message);

        // Send error notification
        try {
            await sendTelegramMessage(
                `❌ Pattern Scan Error\n\n` +
                `Time: ${new Date().toISOString()}\n` +
                `Error: ${error.message}`
            );
        } catch (notifyError) {
            console.error('Failed to send error notification:', notifyError.message);
        }
    }
}

/**
 * Start pattern scanner job
 */
function startPatternScannerJob() {
    const settings = loadPatternScanSettings();

    if (!settings.enabled) {
        console.log('⏸️  Pattern scanner is disabled');
        return;
    }

    // Stop existing interval if any
    if (activeInterval) {
        console.log('🔄 Stopping existing pattern scanner job...');
        clearInterval(activeInterval);
        activeInterval = null;
    }

    const intervalMs = getIntervalMs(settings.interval);
    const intervalHours = intervalMs / (60 * 60 * 1000);

    console.log('');
    console.log('🔍 PATTERN SCANNER SCHEDULER');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`   ✅ Status: ENABLED`);
    console.log(`   ⏰ Interval: ${settings.interval} (${intervalHours}h)`);
    console.log(`   📊 Coins: ${settings.coins}`);
    console.log(`   🎯 Patterns: RSI Divergence, Double Top/Bottom, H&S, Triangles`);
    console.log(`   📈 Timeframes: 1D + 1W`);
    console.log(`   🤖 AI Analysis: Enabled for critical alerts`);
    console.log('');

    try {
        // Run immediately on start
        console.log('🚀 Running initial scan...');
        runPatternScan();

        // Then run on interval
        activeInterval = setInterval(() => {
            console.log(`⏰ [INTERVAL] Pattern scanner triggered at ${new Date().toISOString()}`);
            runPatternScan();
        }, intervalMs);

        const nextRun = new Date(Date.now() + intervalMs);
        console.log('✅ Pattern scanner job started!');
        console.log(`   Next run: ${nextRun.toISOString()}`);
        console.log(`   Interval active: ${activeInterval ? 'YES' : 'NO'}`);
        console.log('');
    } catch (error) {
        console.error('❌ Failed to start pattern scanner job:', error.message);
    }
}

/**
 * Stop pattern scanner job
 */
function stopPatternScannerJob() {
    if (activeInterval) {
        clearInterval(activeInterval);
        activeInterval = null;
        console.log('⏸️  Pattern scanner job stopped');
    }
}

/**
 * Restart pattern scanner job (reload settings)
 */
function restartPatternScannerJob() {
    stopPatternScannerJob();
    startPatternScannerJob();
}

module.exports = {
    startPatternScannerJob,
    stopPatternScannerJob,
    restartPatternScannerJob,
    runPatternScan
};
