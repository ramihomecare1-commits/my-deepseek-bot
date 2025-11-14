# Active Trades Persistence Solution

## Current Problem

Active trades are currently stored **in-memory** in the `ProfessionalTradingBot.js` class:
```javascript
this.activeTrades = []; // Line 105 in ProfessionalTradingBot.js
```

**Problem:** When the bot restarts (deployment, crash, or update), all active trades are lost because they're only stored in RAM.

## Solution: File-Based Persistence

### Where to Store Trades

**Location:** `data/active-trades.json`

This file will be created in a `data/` directory at the root of your project:
```
my-deepseek-bot/
├── data/
│   └── active-trades.json  ← Trades stored here
├── bot/
├── services/
└── ...
```

### Why This Location?

1. **Persistent:** File survives bot restarts
2. **Simple:** No database needed (JSON is easy to read/write)
3. **Portable:** Can be backed up, versioned, or moved
4. **Human-readable:** You can inspect trades manually if needed

### File Structure

The `active-trades.json` file will contain an array of trade objects:
```json
[
  {
    "tradeId": "BTC-1701234567890",
    "symbol": "BTC",
    "name": "Bitcoin",
    "action": "BUY",
    "entryPrice": 99000,
    "currentPrice": 99500,
    "takeProfit": 104000,
    "stopLoss": 94000,
    "addPosition": 95000,
    "status": "OPEN",
    "entryTime": "2024-11-13T12:00:00.000Z",
    "quantity": 0.001,
    "pnl": 5.00,
    "pnlPercent": 0.51,
    "coinData": {
      "symbol": "BTC",
      "name": "Bitcoin",
      "id": "bitcoin",
      "coinmarketcap_id": "1",
      "coinpaprika_id": "btc-bitcoin"
    }
  }
]
```

## Implementation Strategy

### 1. Create a Trade Persistence Service

**File:** `services/tradePersistenceService.js`

This service will handle:
- **Saving trades** to `data/active-trades.json`
- **Loading trades** from `data/active-trades.json`
- **Automatic saving** whenever trades are added/updated
- **Error handling** if file doesn't exist or is corrupted

### 2. When to Save Trades

Save trades automatically in these scenarios:

1. **When a new trade is added** (`addActiveTrade()` method)
   - Save immediately after `this.activeTrades.push(newTrade)`

2. **When a trade is updated** (`updateActiveTrades()` method)
   - Save after updating price, P&L, or status

3. **When a trade status changes** (TP_HIT, SL_HIT, DCA_HIT)
   - Save immediately when status changes

4. **On bot shutdown** (graceful shutdown handler)
   - Save all trades before process exits

### 3. When to Load Trades

Load trades **once** when the bot initializes:

1. **On bot startup** (in `ProfessionalTradingBot` constructor)
   - After `this.activeTrades = []` initialization
   - Load from file and populate `this.activeTrades`
   - Log how many trades were restored

### 4. Implementation Flow

```
Bot Starts
    ↓
Load trades from data/active-trades.json
    ↓
Populate this.activeTrades array
    ↓
Bot runs normally...
    ↓
New trade detected → addActiveTrade()
    ↓
Save to data/active-trades.json (auto-save)
    ↓
Trade updated → updateActiveTrades()
    ↓
Save to data/active-trades.json (auto-save)
    ↓
Bot restarts → Load trades again (cycle repeats)
```

## Code Structure

### Service: `services/tradePersistenceService.js`

```javascript
const fs = require('fs').promises;
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const TRADES_FILE = path.join(DATA_DIR, 'active-trades.json');

// Ensure data directory exists
async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (error) {
    // Directory might already exist, that's fine
  }
}

// Load trades from file
async function loadTrades() {
  try {
    await ensureDataDir();
    const data = await fs.readFile(TRADES_FILE, 'utf8');
    const trades = JSON.parse(data);
    return Array.isArray(trades) ? trades : [];
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist yet, return empty array
      return [];
    }
    console.error('Error loading trades:', error);
    return [];
  }
}

// Save trades to file
async function saveTrades(trades) {
  try {
    await ensureDataDir();
    await fs.writeFile(TRADES_FILE, JSON.stringify(trades, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error saving trades:', error);
    return false;
  }
}

module.exports = { loadTrades, saveTrades };
```

### Integration in ProfessionalTradingBot.js

**In Constructor:**
```javascript
const { loadTrades, saveTrades } = require('../services/tradePersistenceService');

// After this.activeTrades = []
async initializeTrades() {
  const savedTrades = await loadTrades();
  if (savedTrades.length > 0) {
    this.activeTrades = savedTrades;
    addLogEntry(`Restored ${savedTrades.length} active trades from storage`, 'success');
  }
}
```

**In addActiveTrade():**
```javascript
this.activeTrades.push(newTrade);
await saveTrades(this.activeTrades); // Auto-save
```

**In updateActiveTrades():**
```javascript
// After updating trade prices/status
await saveTrades(this.activeTrades); // Auto-save
```

## Benefits

1. ✅ **Trades survive restarts** - No data loss on deployment
2. ✅ **Simple implementation** - Just JSON file, no database
3. ✅ **Automatic persistence** - Saves on every change
4. ✅ **Easy backup** - Just copy the JSON file
5. ✅ **Debugging friendly** - Can inspect trades manually

## Edge Cases to Handle

1. **File corruption:** If JSON is invalid, log error and start with empty array
2. **Missing directory:** Create `data/` directory automatically
3. **Concurrent writes:** Use `fs.promises` for async operations
4. **Date serialization:** JSON.stringify handles Date objects (converts to ISO string)
5. **Large files:** If you have 1000+ trades, consider archiving old closed trades

## Alternative: Database Storage

If you want a more robust solution later, you could use:
- **SQLite** (file-based database, no server needed)
- **MongoDB** (if you want cloud storage)
- **PostgreSQL** (for production environments)

But for now, **JSON file storage is perfect** - simple, reliable, and sufficient for your needs.

## Summary

**Storage Location:** `data/active-trades.json`
**When to Save:** After every add/update operation
**When to Load:** Once on bot startup
**Format:** JSON array of trade objects
**Implementation:** Create `services/tradePersistenceService.js` and integrate into `ProfessionalTradingBot.js`

This ensures your trades are never lost, even when the bot restarts! 🎯

