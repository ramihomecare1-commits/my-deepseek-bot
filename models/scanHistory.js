const fs = require('fs');
const path = require('path');

/**
 * Scan History Management
 * Tracks pattern scanner execution history and statistics
 * Note: Data is stored in JSON and will be lost on redeployment (ephemeral storage)
 */

const HISTORY_FILE = path.join(__dirname, '../data/scanHistory.json');
const MAX_HISTORY = 50; // Keep last 50 scans

// Default structure
const DEFAULT_HISTORY = {
    scans: [],
    stats: {
        totalScans: 0,
        successfulScans: 0,
        failedScans: 0,
        avgDuration: 0,
        lastScan: null,
        lastSuccess: null,
        lastFailure: null
    }
};

/**
 * Load scan history
 * @returns {Object} History object
 */
function loadHistory() {
    try {
        // Ensure data directory exists
        const dataDir = path.dirname(HISTORY_FILE);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        // Load history file
        if (fs.existsSync(HISTORY_FILE)) {
            const data = fs.readFileSync(HISTORY_FILE, 'utf8');
            return { ...DEFAULT_HISTORY, ...JSON.parse(data) };
        }

        // Create default history file
        saveHistory(DEFAULT_HISTORY);
        return DEFAULT_HISTORY;
    } catch (error) {
        console.error('Error loading scan history:', error.message);
        return DEFAULT_HISTORY;
    }
}

/**
 * Save scan history
 * @param {Object} history - History to save
 */
function saveHistory(history) {
    try {
        const dataDir = path.dirname(HISTORY_FILE);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
    } catch (error) {
        console.error('Error saving scan history:', error.message);
    }
}

/**
 * Add scan result to history
 * @param {Object} scanData - Scan result data
 */
function addScanResult(scanData) {
    const history = loadHistory();
    const timestamp = new Date().toISOString();

    const scanRecord = {
        id: `scan_${Date.now()}`,
        timestamp,
        duration: scanData.duration || 0,
        status: scanData.status || 'unknown',
        coinsScanned: scanData.coinsScanned || 0,
        patternsFound: {
            critical: scanData.critical || 0,
            watch: scanData.watch || 0,
            total: (scanData.critical || 0) + (scanData.watch || 0)
        },
        aiSummary: scanData.aiSummary || null, // Store AI summary string
        errors: scanData.errors || []
    };

    // Add to beginning of array (most recent first)
    history.scans.unshift(scanRecord);

    // Keep only last MAX_HISTORY scans
    history.scans = history.scans.slice(0, MAX_HISTORY);

    // Update stats
    history.stats.totalScans++;
    history.stats.lastScan = timestamp;

    if (scanRecord.status === 'success') {
        history.stats.successfulScans++;
        history.stats.lastSuccess = timestamp;
    } else if (scanRecord.status === 'failure') {
        history.stats.failedScans++;
        history.stats.lastFailure = timestamp;
    }

    // Calculate average duration
    const totalDuration = history.scans.reduce((sum, scan) => sum + scan.duration, 0);
    history.stats.avgDuration = Math.round(totalDuration / history.scans.length);

    saveHistory(history);
    return scanRecord;
}

/**
 * Get recent scans
 * @param {number} limit - Number of scans to return
 * @returns {Array} Recent scans
 */
function getRecentScans(limit = 10) {
    const history = loadHistory();
    return history.scans.slice(0, limit);
}

/**
 * Get last N scans
 * @param {number} count - Number of scans to retrieve
 * @returns {Array} Last N scans
 */
function getLastScans(count = 5) {
    const history = loadHistory();
    return history.scans.slice(0, count);
}

/**
 * Get scan statistics
 * @returns {Object} Statistics
 */
function getStats() {
    const history = loadHistory();
    const stats = { ...history.stats };

    // Calculate success rate
    if (stats.totalScans > 0) {
        stats.successRate = ((stats.successfulScans / stats.totalScans) * 100).toFixed(1);
    } else {
        stats.successRate = 0;
    }

    // Time since last scan
    if (stats.lastScan) {
        const lastScanTime = new Date(stats.lastScan);
        const now = new Date();
        const diffMs = now - lastScanTime;
        const diffMins = Math.floor(diffMs / 60000);

        if (diffMins < 60) {
            stats.timeSinceLastScan = `${diffMins} minutes ago`;
        } else {
            const diffHours = Math.floor(diffMins / 60);
            stats.timeSinceLastScan = `${diffHours} hours ago`;
        }
    } else {
        stats.timeSinceLastScan = 'Never';
    }

    return stats;
}

/**
 * Clear all history (useful for testing)
 */
function clearHistory() {
    saveHistory(DEFAULT_HISTORY);
    console.log('✅ Scan history cleared');
}

module.exports = {
    addScanResult,
    getHistory: loadHistory, // Assuming getHistory is meant to be loadHistory
    getLastScans,
    getStats,
    clearHistory
};
