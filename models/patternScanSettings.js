const fs = require('fs');
const path = require('path');

/**
 * Pattern Scanner Settings Management
 * Stores and manages automatic pattern scan scheduling settings
 */

const SETTINGS_FILE = path.join(__dirname, '../data/patternScanSettings.json');

// Default settings
const DEFAULT_SETTINGS = {
    enabled: false,
    interval: '4H', // Options: '1H', '4H', '6H', '12H', '1D'
    lastRun: null,
    nextRun: null,
    coins: 20
};

/**
 * Load pattern scan settings
 * @returns {Object} Settings object
 */
function loadPatternScanSettings() {
    try {
        // Ensure data directory exists
        const dataDir = path.dirname(SETTINGS_FILE);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        // Load settings file
        if (fs.existsSync(SETTINGS_FILE)) {
            const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
            return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
        }

        // Create default settings file
        savePatternScanSettings(DEFAULT_SETTINGS);
        return DEFAULT_SETTINGS;
    } catch (error) {
        console.error('Error loading pattern scan settings:', error.message);
        return DEFAULT_SETTINGS;
    }
}

/**
 * Save pattern scan settings
 * @param {Object} settings - Settings to save
 */
function savePatternScanSettings(settings) {
    try {
        const dataDir = path.dirname(SETTINGS_FILE);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
        console.log('✅ Pattern scan settings saved');
    } catch (error) {
        console.error('Error saving pattern scan settings:', error.message);
    }
}

/**
 * Update pattern scan interval
 * @param {string} interval - New interval ('1H', '4H', '6H', '12H', '1D')
 */
function updateInterval(interval) {
    const validIntervals = ['1H', '4H', '6H', '12H', '1D'];
    if (!validIntervals.includes(interval)) {
        throw new Error(`Invalid interval. Must be one of: ${validIntervals.join(', ')}`);
    }

    const settings = loadPatternScanSettings();
    settings.interval = interval;
    savePatternScanSettings(settings);
    return settings;
}

/**
 * Enable/disable pattern scanner
 * @param {boolean} enabled - True to enable, false to disable
 */
function setEnabled(enabled) {
    const settings = loadPatternScanSettings();
    settings.enabled = enabled;
    savePatternScanSettings(settings);
    return settings;
}

/**
 * Update last run timestamp
 */
function updateLastRun() {
    const settings = loadPatternScanSettings();
    settings.lastRun = new Date().toISOString();
    savePatternScanSettings(settings);
}

module.exports = {
    loadPatternScanSettings,
    savePatternScanSettings,
    updateInterval,
    setEnabled,
    updateLastRun
};
