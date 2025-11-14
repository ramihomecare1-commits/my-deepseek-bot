const fs = require('fs').promises;
const path = require('path');

/**
 * Trade Persistence Service
 * Handles saving and loading active trades to/from disk
 * Ensures trades survive bot restarts
 */

const DATA_DIR = path.join(__dirname, '..', 'data');
const TRADES_FILE = path.join(DATA_DIR, 'active-trades.json');

/**
 * Ensure data directory exists
 */
async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (error) {
    // Directory might already exist, that's fine
  }
}

/**
 * Load trades from file
 * @returns {Promise<Array>} Array of trade objects
 */
async function loadTrades() {
  try {
    await ensureDataDir();
    const data = await fs.readFile(TRADES_FILE, 'utf8');
    const trades = JSON.parse(data);
    
    // Validate and convert dates
    if (Array.isArray(trades)) {
      return trades.map(trade => {
        // Convert ISO date strings back to Date objects
        if (trade.entryTime && typeof trade.entryTime === 'string') {
          trade.entryTime = new Date(trade.entryTime);
        }
        return trade;
      });
    }
    
    return [];
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist yet, return empty array
      return [];
    }
    console.error('Error loading trades:', error);
    return [];
  }
}

/**
 * Save trades to file
 * @param {Array} trades - Array of trade objects
 * @returns {Promise<boolean>} Success status
 */
async function saveTrades(trades) {
  try {
    await ensureDataDir();
    
    // Convert to JSON-safe format (Date objects to ISO strings)
    const tradesToSave = trades.map(trade => {
      const tradeCopy = { ...trade };
      if (tradeCopy.entryTime instanceof Date) {
        tradeCopy.entryTime = tradeCopy.entryTime.toISOString();
      }
      return tradeCopy;
    });
    
    await fs.writeFile(TRADES_FILE, JSON.stringify(tradesToSave, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error saving trades:', error);
    return false;
  }
}

/**
 * Get trades file path (for backup/debugging)
 */
function getTradesFilePath() {
  return TRADES_FILE;
}

module.exports = {
  loadTrades,
  saveTrades,
  getTradesFilePath
};

