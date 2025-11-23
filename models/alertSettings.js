/**
 * Alert Settings Model
 * Manages alert configuration and persistence
 */

const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, '../data/alertSettings.json');
const HISTORY_FILE = path.join(__dirname, '../data/alertHistory.json');

// Default settings
const DEFAULT_SETTINGS = {
    enabled: true,
    alertTypes: {
        levelBreakout: true,
        keyLevelTest: true,
        volumeMomentum: true
    },
    thresholds: {
        minConfidence: 7,
        maxDistance: 2.0,
        minStrength: 0.7
    },
    coinSettings: {
        BTC: { distance: 2, scanInterval: 15 },
        ETH: { distance: 2, scanInterval: 15 },
        default: { distance: 3, scanInterval: 60 }
    },
    quietHours: {
        enabled: false,
        start: "22:00",
        end: "06:00"
    }
};

/**
 * Ensure data directory exists
 */
function ensureDataDirectory() {
    const dataDir = path.join(__dirname, '../data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
}

/**
 * Load alert settings from file
 * @returns {Object} Alert settings
 */
function loadAlertSettings() {
    try {
        ensureDataDirectory();

        if (fs.existsSync(SETTINGS_FILE)) {
            const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
            return JSON.parse(data);
        }

        // Create default settings file
        saveAlertSettings(DEFAULT_SETTINGS);
        return DEFAULT_SETTINGS;
    } catch (error) {
        console.error('Error loading alert settings:', error);
        return DEFAULT_SETTINGS;
    }
}

/**
 * Save alert settings to file
 * @param {Object} settings - Alert settings
 */
function saveAlertSettings(settings) {
    try {
        ensureDataDirectory();
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
        console.log('✅ Alert settings saved');
    } catch (error) {
        console.error('Error saving alert settings:', error);
    }
}

/**
 * Load alert history from file
 * @returns {Array} Alert history
 */
function loadAlertHistory() {
    try {
        ensureDataDirectory();

        if (fs.existsSync(HISTORY_FILE)) {
            const data = fs.readFileSync(HISTORY_FILE, 'utf8');
            return JSON.parse(data);
        }

        return [];
    } catch (error) {
        console.error('Error loading alert history:', error);
        return [];
    }
}

/**
 * Save alert to history
 * @param {Object} alert - Alert object
 * @param {boolean} sent - Whether alert was sent successfully
 */
function saveAlertToHistory(alert, sent = true) {
    try {
        const history = loadAlertHistory();

        const alertRecord = {
            id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: alert.timestamp || new Date(),
            type: alert.type,
            symbol: alert.symbol,
            price: alert.price,
            level: alert.level,
            confidence: alert.confidence,
            sent
        };

        history.push(alertRecord);

        // Keep only last 100 alerts
        const trimmed = history.slice(-100);

        ensureDataDirectory();
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(trimmed, null, 2));
    } catch (error) {
        console.error('Error saving alert to history:', error);
    }
}

/**
 * Get coin-specific settings
 * @param {string} symbol - Coin symbol
 * @param {Object} settings - Alert settings
 * @returns {Object} Coin settings
 */
function getCoinSettings(symbol, settings) {
    return settings.coinSettings[symbol] || settings.coinSettings.default;
}

module.exports = {
    loadAlertSettings,
    saveAlertSettings,
    loadAlertHistory,
    saveAlertToHistory,
    getCoinSettings,
    DEFAULT_SETTINGS
};
