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
    
    // Check if file exists
    try {
      await fs.access(TRADES_FILE);
      console.log(`📂 Trades file found at: ${TRADES_FILE}`);
    } catch (accessError) {
      console.log(`📂 Trades file does not exist at: ${TRADES_FILE}`);
      console.log(`📂 Data directory: ${DATA_DIR}`);
      return [];
    }
    
    const data = await fs.readFile(TRADES_FILE, 'utf8');
    console.log(`📂 Trades file size: ${data.length} bytes`);
    
    if (!data || data.trim().length === 0) {
      console.log('⚠️ Trades file is empty');
      return [];
    }
    
    const trades = JSON.parse(data);
    console.log(`📂 Parsed ${Array.isArray(trades) ? trades.length : 0} trades from file`);
    
    // Validate and convert dates
    if (Array.isArray(trades)) {
      const validTrades = trades.map(trade => {
        // Convert ISO date strings back to Date objects
        if (trade.entryTime && typeof trade.entryTime === 'string') {
          trade.entryTime = new Date(trade.entryTime);
        }
        return trade;
      }).filter(trade => trade && trade.symbol); // Filter out invalid trades
      
      console.log(`✅ Loaded ${validTrades.length} valid trades`);
      return validTrades;
    }
    
    console.log('⚠️ Trades file does not contain an array');
    return [];
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist yet, return empty array
      console.log(`📂 Trades file not found: ${TRADES_FILE}`);
      return [];
    }
    console.error('❌ Error loading trades:', error);
    console.error('Error details:', error.message);
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
    
    const jsonData = JSON.stringify(tradesToSave, null, 2);
    await fs.writeFile(TRADES_FILE, jsonData, 'utf8');
    console.log(`💾 Saved ${tradesToSave.length} trades to ${TRADES_FILE} (${jsonData.length} bytes)`);
    return true;
  } catch (error) {
    console.error('❌ Error saving trades:', error);
    console.error('Error details:', error.message);
    console.error('File path:', TRADES_FILE);
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

