/**
 * Alert Settings Model
 * Manages alert configuration and persistence
 */

const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, '../data/alertSettings.json');
const HISTORY_FILE = path.join(__dirname, '../data/alertHistory.json');

// Default settings - ULTRA-FILTERED for highest probability only
const DEFAULT_SETTINGS = {
    enabled: true,
    alertTypes: {
        levelBreakout: true,
        keyLevelTest: true,
        volumeMomentum: false // Disabled - too noisy without other confirmations
    },
    thresholds: {
        minConfidence: 8.5,        // Increased from 7 to 8.5
        maxDistance: 1.5,           // Decreased from 2.0 to 1.5%
        minStrength: 0.8,           // Increased from 0.7 to 0.8 (strong only)
        minConfluence: 3,           // NEW: Minimum 3 confluence factors
        minVolumeRatio: 1.8,        // NEW: Minimum 180% volume
        minTouchCount: 3            // NEW: Minimum 3 historical tests
    },
    coinSettings: {
        BTC: { distance: 1.5, scanInterval: 15, enabled: true },
        ETH: { distance: 1.5, scanInterval: 15, enabled: true },
        BNB: { distance: 1.5, scanInterval: 30, enabled: true },
        SOL: { distance: 1.5, scanInterval: 30, enabled: true },
        XRP: { distance: 1.5, scanInterval: 30, enabled: true },
        // Disable other coins - focus on top 5 only
        default: { distance: 1.5, scanInterval: 60, enabled: false }
    },
    quietHours: {
        enabled: false,
        start: "22:00",
        end: "06:00"
    },
    priorityLevels: {
        // Only CRITICAL and HIGH - no MEDIUM/LOW
        critical: {
            minConfidence: 9.0,
            minVolumeRatio: 2.5,
            minConfluence: 4
        },
        high: {
            minConfidence: 8.5,
            minVolumeRatio: 1.8,
            minConfluence: 3
        }
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
