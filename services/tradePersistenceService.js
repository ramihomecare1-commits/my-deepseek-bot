const fs = require('fs').promises;
const path = require('path');

/**
 * Trade Persistence Service
 * Handles saving and loading active trades to/from disk or MongoDB
 * Ensures trades survive bot restarts
 * 
 * Priority: MongoDB (if MONGODB_URI set) → File System
 */

const DATA_DIR = path.join(__dirname, '..', 'data');
const TRADES_FILE = path.join(DATA_DIR, 'active-trades.json');

// MongoDB connection (lazy initialization)
let mongoClient = null;
let mongoDb = null;
let useMongoDB = false;

/**
 * Initialize MongoDB connection if URI is provided
 */
async function initMongoDB() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    return false;
  }

  try {
    const { MongoClient } = require('mongodb');
    mongoClient = new MongoClient(mongoUri);
    await mongoClient.connect();
    mongoDb = mongoClient.db();
    useMongoDB = true;
    console.log('✅ MongoDB connected for trade persistence');
    return true;
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    console.log('📂 Falling back to file system storage');
    return false;
  }
}

/**
 * Load trades from MongoDB
 */
async function loadTradesFromMongo() {
  try {
    if (!mongoDb) {
      const connected = await initMongoDB();
      if (!connected) return [];
    }

    const collection = mongoDb.collection('activeTrades');
    const trades = await collection.find({}).toArray();
    
    // Remove MongoDB _id field and convert dates
    return trades.map(trade => {
      const { _id, ...tradeData } = trade;
      if (tradeData.entryTime && typeof tradeData.entryTime === 'string') {
        tradeData.entryTime = new Date(tradeData.entryTime);
      }
      return tradeData;
    });
  } catch (error) {
    console.error('❌ Error loading trades from MongoDB:', error);
    return [];
  }
}

/**
 * Save trades to MongoDB
 */
async function saveTradesToMongo(trades) {
  try {
    if (!mongoDb) {
      const connected = await initMongoDB();
      if (!connected) return false;
    }

    const collection = mongoDb.collection('activeTrades');
    
    // Clear existing trades and insert new ones
    await collection.deleteMany({});
    
    // Convert dates to ISO strings for MongoDB
    const tradesToSave = trades.map(trade => {
      const tradeCopy = { ...trade };
      if (tradeCopy.entryTime instanceof Date) {
        tradeCopy.entryTime = tradeCopy.entryTime.toISOString();
      }
      return tradeCopy;
    });
    
    if (tradesToSave.length > 0) {
      await collection.insertMany(tradesToSave);
    }
    
    console.log(`💾 Saved ${tradesToSave.length} trades to MongoDB`);
    return true;
  } catch (error) {
    console.error('❌ Error saving trades to MongoDB:', error);
    return false;
  }
}

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
 * Load trades from MongoDB or file
 * @returns {Promise<Array>} Array of trade objects
 */
async function loadTrades() {
  // Try MongoDB first if URI is set
  if (process.env.MONGODB_URI) {
    console.log('📂 Attempting to load trades from MongoDB...');
    const mongoTrades = await loadTradesFromMongo();
    if (mongoTrades && mongoTrades.length > 0) {
      console.log(`✅ Loaded ${mongoTrades.length} trades from MongoDB`);
      return mongoTrades;
    } else if (useMongoDB) {
      console.log('📂 No trades found in MongoDB');
      return [];
    }
    // If MongoDB connection failed, fall through to file system
  }

  // Fallback to file system
  try {
    await ensureDataDir();
    
    // Check if file exists
    try {
      await fs.access(TRADES_FILE);
      console.log(`📂 Trades file found at: ${TRADES_FILE}`);
    } catch (accessError) {
      console.log(`📂 Trades file does not exist at: ${TRADES_FILE}`);
      console.log(`📂 Data directory: ${DATA_DIR}`);
      console.log(`⚠️ NOTE: On Render, filesystem is ephemeral - files don't persist between deployments.`);
      console.log(`💡 Solution: Use MongoDB Atlas (free) for persistent storage. Set MONGODB_URI environment variable.`);
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
 * Save trades to MongoDB or file
 * @param {Array} trades - Array of trade objects
 * @returns {Promise<boolean>} Success status
 */
async function saveTrades(trades) {
  // Try MongoDB first if URI is set
  if (process.env.MONGODB_URI) {
    const saved = await saveTradesToMongo(trades);
    if (saved) {
      return true;
    }
    // If MongoDB save failed, fall through to file system
  }

  // Fallback to file system
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

