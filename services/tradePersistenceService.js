const fs = require('fs').promises;
const path = require('path');
const { docClient, TABLES, ScanCommand, BatchWriteCommand, PutCommand } = require('../config/awsConfig');
const { v4: uuidv4 } = require('uuid');

/**
 * Trade Persistence Service
 * Handles saving and loading active trades to/from disk or DynamoDB
 * Ensures trades survive bot restarts
 * 
 * Priority: DynamoDB (if AWS credentials set) → File System
 */

const DATA_DIR = path.join(__dirname, '..', 'data');
const TRADES_FILE = path.join(DATA_DIR, 'active-trades.json');

// DynamoDB connection (lazy initialization)
let useDynamoDB = false;

/**
 * Initialize DynamoDB connection if credentials are provided
 */
async function initDynamoDB() {
  const hasCredentials = process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY;
  if (!hasCredentials) {
    return false;
  }

  try {
    useDynamoDB = true;
    console.log('✅ DynamoDB connected for trade persistence');
    return true;
  } catch (error) {
    console.error('❌ DynamoDB connection failed:', error.message);
    console.log('📂 Falling back to file system storage');
    return false;
  }
}

/**
 * Load trades from DynamoDB
 */
async function loadTradesFromDynamo() {
  try {
    if (!useDynamoDB) {
      const connected = await initDynamoDB();
      if (!connected) return [];
    }

    const result = await docClient.send(new ScanCommand({
      TableName: TABLES.ACTIVE_TRADES
    }));

    const loadedTrades = (result.Items || []).map(trade => {
      // Convert timestamp back to Date object
      if (trade.entryTime && typeof trade.entryTime === 'number') {
        trade.entryTime = new Date(trade.entryTime);
      }
      // Ensure both id and tradeId exist (for compatibility)
      const tradeId = trade.id || trade.tradeId || uuidv4();
      trade.id = tradeId;
      trade.tradeId = tradeId;
      return trade;
    });
    
    if (loadedTrades.length > 0) {
      console.log(`📋 Loaded ${loadedTrades.length} trades from DynamoDB:`, loadedTrades.map(t => ({ symbol: t.symbol, id: t.id, status: t.status })));
    }
    
    return loadedTrades;
  } catch (error) {
    console.error('❌ Error loading trades from DynamoDB:', error);
    return [];
  }
}

/**
 * Save trades to DynamoDB
 */
async function saveTradesToDynamo(trades) {
  try {
    if (!useDynamoDB) {
      const connected = await initDynamoDB();
      if (!connected) return false;
    }

    // Delete all existing trades first
    const existing = await docClient.send(new ScanCommand({ TableName: TABLES.ACTIVE_TRADES }));
    if (existing.Items && existing.Items.length > 0) {
      const deleteOps = existing.Items.map(item => {
        // Use id or tradeId (for compatibility)
        const itemId = item.id || item.tradeId;
        if (!itemId) {
          console.warn(`⚠️ Trade item missing id/tradeId:`, item);
        }
        return {
          DeleteRequest: { Key: { id: itemId || 'unknown' } }
        };
      }).filter(op => op.DeleteRequest.Key.id !== 'unknown'); // Filter out invalid keys
    
      // DynamoDB batch write (max 25 items per batch)
      const batches = [];
      for (let i = 0; i < deleteOps.length; i += 25) {
        batches.push(deleteOps.slice(i, i + 25));
      }

      for (const batch of batches) {
        await docClient.send(new BatchWriteCommand({
          RequestItems: {
            [TABLES.ACTIVE_TRADES]: batch
          }
        }));
      }
    }

    // Insert new trades
    if (trades.length > 0) {
      const putOps = trades.map(trade => {
        // Use tradeId if id doesn't exist (for compatibility)
        const tradeId = trade.id || trade.tradeId || uuidv4();
        return {
          PutRequest: {
            Item: {
              id: tradeId,
              ...trade,
              tradeId: tradeId, // Ensure both fields exist for compatibility
              entryTime: trade.entryTime instanceof Date ? trade.entryTime.getTime() : trade.entryTime
            }
          }
        };
      });

      // DynamoDB batch write (max 25 items per batch)
      const batches = [];
      for (let i = 0; i < putOps.length; i += 25) {
        batches.push(putOps.slice(i, i + 25));
      }

      for (const batch of batches) {
        await docClient.send(new BatchWriteCommand({
          RequestItems: {
            [TABLES.ACTIVE_TRADES]: batch
          }
        }));
      }
      
      console.log(`💾 Saved ${trades.length} trades to DynamoDB`);
      // Debug: Log trade IDs for verification
      const tradeIds = trades.map(t => ({ symbol: t.symbol, id: t.id || t.tradeId, status: t.status }));
      console.log(`📋 Trade IDs saved:`, tradeIds);
    } else {
      console.log(`⚠️ No trades to save (trades array is empty)`);
    }
    
    return true;
  } catch (error) {
    console.error('❌ Error saving trades to DynamoDB:', error);
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
 * Load trades from DynamoDB or file
 * @returns {Promise<Array>} Array of trade objects
 */
async function loadTrades() {
  // Try DynamoDB first if credentials are set
  if (process.env.AWS_ACCESS_KEY_ID) {
    console.log('📂 Attempting to load trades from DynamoDB...');
    const dynamoTrades = await loadTradesFromDynamo();
    if (dynamoTrades && dynamoTrades.length > 0) {
      console.log(`✅ Loaded ${dynamoTrades.length} trades from DynamoDB`);
      return dynamoTrades;
    } else if (useDynamoDB) {
      console.log('📂 No trades found in DynamoDB');
      return [];
    }
    // If DynamoDB connection failed, fall through to file system
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
      console.log(`💡 Solution: Use AWS DynamoDB (free tier) for persistent storage. Set AWS_ACCESS_KEY_ID environment variable.`);
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
 * Save trades to DynamoDB or file
 * @param {Array} trades - Array of trade objects
 * @returns {Promise<boolean>} Success status
 */
async function saveTrades(trades) {
  // Try DynamoDB first if credentials are set
  if (process.env.AWS_ACCESS_KEY_ID) {
    const saved = await saveTradesToDynamo(trades);
    if (saved) {
      return true;
    }
    // If DynamoDB save failed, fall through to file system
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

/**
 * Load closed trades from DynamoDB or file
 * @returns {Promise<Array>} Array of closed trade objects
 */
async function loadClosedTrades() {
  // Try DynamoDB first if credentials are set
  if (process.env.AWS_ACCESS_KEY_ID) {
    try {
      if (!useDynamoDB) {
        const connected = await initDynamoDB();
        if (!connected) return [];
      }
      
      const result = await docClient.send(new ScanCommand({
        TableName: TABLES.CLOSED_TRADES
      }));
      
      const trades = (result.Items || [])
        .sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0))
        .slice(0, 100)
        .map(trade => {
          // Convert timestamps back to Date objects
          if (trade.entryTime && typeof trade.entryTime === 'number') {
            trade.entryTime = new Date(trade.entryTime);
        }
          if (trade.closedAt && typeof trade.closedAt === 'number') {
            trade.closedAt = new Date(trade.closedAt);
        }
          return trade;
      });
      
      return trades;
    } catch (error) {
      console.error('❌ Error loading closed trades from DynamoDB:', error);
      return [];
    }
  }
  
  // Fallback to file system
  try {
    await ensureDataDir();
    const CLOSED_TRADES_FILE = path.join(DATA_DIR, 'closed-trades.json');
    
    try {
      await fs.access(CLOSED_TRADES_FILE);
    } catch (accessError) {
      return [];
    }
    
    const data = await fs.readFile(CLOSED_TRADES_FILE, 'utf8');
    if (!data || data.trim().length === 0) {
      return [];
    }
    
    const trades = JSON.parse(data);
    if (Array.isArray(trades)) {
      return trades.map(trade => {
        if (trade.entryTime && typeof trade.entryTime === 'string') {
          trade.entryTime = new Date(trade.entryTime);
        }
        if (trade.closedAt && typeof trade.closedAt === 'string') {
          trade.closedAt = new Date(trade.closedAt);
        }
        return trade;
      }).filter(trade => trade && trade.symbol);
    }
    
    return [];
  } catch (error) {
    console.error('❌ Error loading closed trades:', error);
    return [];
  }
}

/**
 * Save closed trades to DynamoDB or file
 * @param {Array} trades - Array of closed trade objects
 * @returns {Promise<boolean>} Success status
 */
async function saveClosedTrades(trades) {
  // Try DynamoDB first if credentials are set
  if (process.env.AWS_ACCESS_KEY_ID) {
    try {
      if (!useDynamoDB) {
        const connected = await initDynamoDB();
        if (!connected) return false;
      }
      
      // Convert dates to timestamps for DynamoDB
      const tradesToSave = trades.map(trade => {
        const tradeCopy = { ...trade };
        if (tradeCopy.entryTime instanceof Date) {
          tradeCopy.entryTime = tradeCopy.entryTime.getTime();
        }
        if (tradeCopy.closedAt instanceof Date) {
          tradeCopy.closedAt = tradeCopy.closedAt.getTime();
        }
        // Ensure id exists
        if (!tradeCopy.id) {
          tradeCopy.id = uuidv4();
        }
        return tradeCopy;
      });
      
      // Upsert closed trades (update if exists, insert if not)
      // Use id as unique identifier
      for (const trade of tradesToSave) {
        await docClient.send(new PutCommand({
          TableName: TABLES.CLOSED_TRADES,
          Item: trade
        }));
      }
      
      // Keep only last 500 closed trades in DynamoDB
      const allTrades = await docClient.send(new ScanCommand({ TableName: TABLES.CLOSED_TRADES }));
      if (allTrades.Items && allTrades.Items.length > 500) {
        // Sort by closedAt and delete oldest
        const sorted = allTrades.Items.sort((a, b) => (a.closedAt || 0) - (b.closedAt || 0));
        const excess = sorted.slice(0, sorted.length - 500);
        
        // Delete in batches
        const deleteOps = excess.map(trade => ({
          DeleteRequest: { Key: { id: trade.id } }
        }));
        
        const batches = [];
        for (let i = 0; i < deleteOps.length; i += 25) {
          batches.push(deleteOps.slice(i, i + 25));
        }
        
        for (const batch of batches) {
          await docClient.send(new BatchWriteCommand({
            RequestItems: {
              [TABLES.CLOSED_TRADES]: batch
            }
          }));
        }
      }
      
      console.log(`💾 Saved ${tradesToSave.length} closed trades to DynamoDB`);
      return true;
    } catch (error) {
      console.error('❌ Error saving closed trades to DynamoDB:', error);
      return false;
    }
  }
  
  // Fallback to file system
  try {
    await ensureDataDir();
    const CLOSED_TRADES_FILE = path.join(DATA_DIR, 'closed-trades.json');
    
    // Convert to JSON-safe format
    const tradesToSave = trades.map(trade => {
      const tradeCopy = { ...trade };
      if (tradeCopy.entryTime instanceof Date) {
        tradeCopy.entryTime = tradeCopy.entryTime.toISOString();
      }
      if (tradeCopy.closedAt instanceof Date) {
        tradeCopy.closedAt = tradeCopy.closedAt.toISOString();
      }
      return tradeCopy;
    });
    
    const jsonData = JSON.stringify(tradesToSave, null, 2);
    await fs.writeFile(CLOSED_TRADES_FILE, jsonData, 'utf8');
    console.log(`💾 Saved ${tradesToSave.length} closed trades to ${CLOSED_TRADES_FILE}`);
    return true;
  } catch (error) {
    console.error('❌ Error saving closed trades:', error);
    return false;
  }
}

module.exports = {
  loadTrades,
  saveTrades,
  loadClosedTrades,
  saveClosedTrades,
  getTradesFilePath
};
