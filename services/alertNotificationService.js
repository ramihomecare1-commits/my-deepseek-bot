/**
 * Alert Notification Service
 * Formats and sends alert notifications via Telegram
 */

const config = require('../config/config');
const { saveAlertToHistory } = require('../models/alertSettings');

/**
 * Check if current time is within quiet hours
 * @param {Object} quietHours - Quiet hours configuration
 * @returns {boolean} True if in quiet hours
 */
function isQuietHours(quietHours) {
    if (!quietHours || !quietHours.enabled) return false;

    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTime = currentHour * 60 + currentMinute;

    const [startHour, startMinute] = quietHours.start.split(':').map(Number);
    const [endHour, endMinute] = quietHours.end.split(':').map(Number);
    const startTime = startHour * 60 + startMinute;
    const endTime = endHour * 60 + endMinute;

    if (startTime < endTime) {
        return currentTime >= startTime && currentTime < endTime;
    } else {
        // Quiet hours span midnight
        return currentTime >= startTime || currentTime < endTime;
    }
}

/**
 * Format alert message for Telegram
 * @param {Object} alert - Alert object
 * @returns {string} Formatted message
 */
function formatAlertMessage(alert) {
    const emoji = {
        'LEVEL_BREAKOUT': '🚨',
        'KEY_LEVEL_TEST': '⚠️',
        'VOLUME_MOMENTUM': '📊'
    };

    const typeLabel = {
        'LEVEL_BREAKOUT': 'BREAKOUT',
        'KEY_LEVEL_TEST': 'LEVEL TEST',
        'VOLUME_MOMENTUM': 'MOMENTUM'
    };

    let message = `${emoji[alert.type]} *${alert.symbol} ${typeLabel[alert.type]}*\n\n`;
    message += `💰 Current: $${alert.price.toLocaleString()}\n`;

    if (alert.level) {
        const distance = ((alert.level - alert.price) / alert.price * 100).toFixed(2);
        message += `🎯 Level: $${alert.level.toLocaleString()} (${distance > 0 ? '+' : ''}${distance}%)\n`;
    }

    message += `📊 Confidence: ${alert.confidence}/10\n`;

    if (alert.volumeRatio) {
        message += `📈 Volume: ${alert.volumeRatio}x average\n`;
    }

    if (alert.touchCount) {
        message += `🔄 Tests: ${alert.touchCount} touches\n`;
    }

    if (alert.strength) {
        message += `💪 Strength: ${alert.strength}\n`;
    }

    if (alert.confluence) {
        message += `🎯 Confluence: ${alert.confluence} factors\n`;
    }

    if (alert.priceChange) {
        message += `📉 Move: ${alert.priceChange}% ${alert.direction}\n`;
    }

    if (alert.action) {
        message += `\n💡 *${alert.action.replace(/_/g, ' ')}*\n`;
    }

    const time = new Date(alert.timestamp).toLocaleTimeString();
    message += `\n⏰ ${time}`;

    return message;
}

/**
 * Determine alert urgency level
 * @param {Object} alert - Alert object
 * @returns {string} Urgency level (HIGH/MEDIUM/LOW)
 */
function getUrgency(alert) {
    if (alert.type === 'LEVEL_BREAKOUT' && alert.confidence >= 8) {
        return 'HIGH';
    }
    if (alert.type === 'KEY_LEVEL_TEST' && alert.touchCount >= 5) {
        return 'HIGH';
    }
    if (alert.type === 'VOLUME_MOMENTUM' && alert.volumeRatio >= 2.5) {
        return 'HIGH';
    }
    if (alert.confidence >= 7) {
        return 'MEDIUM';
    }
    return 'LOW';
}

/**
 * Send alert notification via Telegram
 * @param {Object} alert - Alert object
 * @param {Object} settings - Alert settings
 * @returns {Promise<boolean>} True if sent successfully
 */
async function sendAlert(alert, settings) {
    // Check if alerts are enabled
    if (!settings.enabled) {
        console.log('⏸️ Alerts disabled');
        return false;
    }

    // Check quiet hours
    if (isQuietHours(settings.quietHours)) {
        console.log('⏰ Quiet hours - alert suppressed');
        saveAlertToHistory(alert, false);
        return false;
    }

    // Check confidence threshold
    if (alert.confidence < settings.thresholds.minConfidence) {
        console.log(`📉 Confidence too low: ${alert.confidence} < ${settings.thresholds.minConfidence}`);
        return false;
    }

    // Format message
    const message = formatAlertMessage(alert);
    const urgency = getUrgency(alert);

    console.log(`\n${urgency === 'HIGH' ? '🔴' : urgency === 'MEDIUM' ? '🟡' : '🟢'} ${urgency} ALERT:`);
    console.log(message);

    // Send via Telegram if configured
    if (config.TELEGRAM_ENABLED) {
        try {
            const axios = require('axios');
            const url = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`;

            await axios.post(url, {
                chat_id: config.TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: 'Markdown'
            });

            console.log('✅ Alert sent via Telegram');
            saveAlertToHistory(alert, true);
            return true;
        } catch (error) {
            console.error('❌ Failed to send Telegram alert:', error.message);
            saveAlertToHistory(alert, false);
            return false;
        }
    } else {
        console.log('📱 Telegram not configured - alert logged only');
        saveAlertToHistory(alert, false);
        return false;
    }
}

/**
 * Send test alert
 * @returns {Promise<boolean>} True if sent successfully
 */
async function sendTestAlert() {
    const testAlert = {
        type: 'LEVEL_BREAKOUT',
        symbol: 'BTC',
        price: 87500,
        level: 87000,
        levelType: 'resistance',
        direction: 'ABOVE',
        confidence: 9,
        volumeRatio: 2.1,
        strength: 'strong',
        confluence: 3,
        touchCount: 5,
        action: 'CONSIDER_LONG_BREAKOUT',
        timestamp: new Date()
    };

    const settings = require('../models/alertSettings').loadAlertSettings();
    return await sendAlert(testAlert, settings);
}

module.exports = {
    sendAlert,
    sendTestAlert,
    formatAlertMessage,
    getUrgency,
    isQuietHours
};
