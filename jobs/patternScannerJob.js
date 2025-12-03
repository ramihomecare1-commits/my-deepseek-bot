/**
 * Pattern Scanner Job
 * Automatic scheduled pattern scanning with configurable intervals
 */

const cron = require('node-cron');
const { scanAllCoinsForPatterns, generateTelegramReport } = require('../services/patternScanService');
const { sendTelegramMessage } = require('../services/notificationService');
const { loadPatternScanSettings, updateLastRun } = require('../models/patternScanSettings');

let activeJob = null;

/**
 * Get cron expression for interval
 * @param {string} interval - Interval ('1H', '4H', '6H', '12H', '1D')
 * @returns {string} Cron expression
 */
function getCronExpression(interval) {
    const expressions = {
        '1H': '0 * * * *',      // Every hour at :00
        '4H': '0 */4 * * *',    // Every 4 hours
        '6H': '0 */6 * * *',    // Every 6 hours
        '12H': '0 */12 * * *',  // Every 12 hours
        '1D': '0 0 * * *'       // Daily at midnight UTC
    };

    return expressions[interval] || expressions['4H'];
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

    // Stop existing job if any
    if (activeJob) {
        activeJob.stop();
    }

    const cronExpression = getCronExpression(settings.interval);

    console.log('');
    console.log('🔍 PATTERN SCANNER SCHEDULER');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`   ✅ Status: ENABLED`);
    console.log(`   ⏰ Interval: ${settings.interval}`);
    console.log(`   📊 Coins: ${settings.coins}`);
    console.log(`   🎯 Patterns: RSI Divergence, Double Top/Bottom, H&S, Triangles`);
    console.log(`   📈 Timeframes: 1D + 1W`);
    console.log(`   🤖 AI Analysis: Enabled for critical alerts`);
    console.log('');

    activeJob = cron.schedule(cronExpression, runPatternScan, {
        timezone: 'UTC'
    });

    console.log('✅ Pattern scanner job started!');
    console.log(`   Next run: ${getNextRunTime(settings.interval)}`);
    console.log('');
}

/**
 * Stop pattern scanner job
 */
function stopPatternScannerJob() {
    if (activeJob) {
        activeJob.stop();
        activeJob = null;
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

/**
 * Get next run time estimate
 * @param {string} interval - Interval setting
 * @returns {string} Next run time
 */
function getNextRunTime(interval) {
    const now = new Date();
    const next = new Date(now);

    switch (interval) {
        case '1H':
            next.setHours(next.getHours() + 1, 0, 0, 0);
            break;
        case '4H':
            next.setHours(Math.ceil(next.getHours() / 4) * 4, 0, 0, 0);
            break;
        case '6H':
            next.setHours(Math.ceil(next.getHours() / 6) * 6, 0, 0, 0);
            break;
        case '12H':
            next.setHours(Math.ceil(next.getHours() / 12) * 12, 0, 0, 0);
            break;
        case '1D':
            next.setDate(next.getDate() + 1);
            next.setHours(0, 0, 0, 0);
            break;
    }

    return next.toISOString();
}

module.exports = {
    startPatternScannerJob,
    stopPatternScannerJob,
    restartPatternScannerJob,
    runPatternScan
};
