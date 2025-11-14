const fs = require('fs').promises;
const path = require('path');

/**
 * Portfolio Service
 * Manages portfolio capital, balance, positions, and performance metrics
 * Persists portfolio state to survive bot restarts
 */

const DATA_DIR = path.join(__dirname, '..', 'data');
const PORTFOLIO_FILE = path.join(DATA_DIR, 'portfolio.json');

// Default portfolio settings
const DEFAULT_CAPITAL = 10000; // Starting capital: $10,000
const DEFAULT_POSITION_SIZE = 100; // Each position: $100 USD
const DEFAULT_DCA_SIZE = 100; // DCA position: $100 USD

// Portfolio state (in-memory)
let portfolioState = {
  initialCapital: DEFAULT_CAPITAL,
  currentBalance: DEFAULT_CAPITAL,
  totalInvested: 0,
  totalRealized: 0,
  totalUnrealized: 0,
  totalPnl: 0,
  totalPnlPercent: 0,
  totalTrades: 0,
  winningTrades: 0,
  losingTrades: 0,
  winRate: 0,
  averageWin: 0,
  averageLoss: 0,
  largestWin: 0,
  largestLoss: 0,
  openPositions: 0,
  closedPositions: 0,
  lastUpdated: new Date().toISOString()
};

/**
 * Ensure data directory exists
 */
async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (error) {
    // Directory might already exist
  }
}

/**
 * Load portfolio state from file
 */
async function loadPortfolio() {
  try {
    await ensureDataDir();
    const data = await fs.readFile(PORTFOLIO_FILE, 'utf8');
    const loaded = JSON.parse(data);
    
    // Merge with defaults to handle missing fields
    portfolioState = {
      ...portfolioState,
      ...loaded,
      lastUpdated: new Date().toISOString()
    };
    
    return portfolioState;
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist, initialize with defaults
      await savePortfolio();
      return portfolioState;
    }
    console.error('Error loading portfolio:', error);
    return portfolioState;
  }
}

/**
 * Save portfolio state to file
 */
async function savePortfolio() {
  try {
    await ensureDataDir();
    portfolioState.lastUpdated = new Date().toISOString();
    await fs.writeFile(PORTFOLIO_FILE, JSON.stringify(portfolioState, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error saving portfolio:', error);
    return false;
  }
}

/**
 * Get current portfolio state
 */
function getPortfolio() {
  return { ...portfolioState };
}

/**
 * Get portfolio statistics
 */
function getPortfolioStats() {
  const stats = { ...portfolioState };
  
  // Calculate additional metrics
  stats.availableBalance = stats.currentBalance;
  stats.totalEquity = stats.currentBalance + stats.totalUnrealized;
  stats.roi = stats.initialCapital > 0 
    ? ((stats.totalEquity - stats.initialCapital) / stats.initialCapital) * 100 
    : 0;
  
  return stats;
}

/**
 * Update balance (when trade is executed)
 */
async function updateBalance(amount, type = 'TRADE') {
  portfolioState.currentBalance += amount;
  portfolioState.lastUpdated = new Date().toISOString();
  
  if (type === 'INVEST') {
    portfolioState.totalInvested += Math.abs(amount);
  } else if (type === 'REALIZE') {
    portfolioState.totalRealized += amount;
  }
  
  await savePortfolio();
  return portfolioState.currentBalance;
}

/**
 * Record a new trade
 */
async function recordTrade(trade) {
  portfolioState.totalTrades++;
  portfolioState.openPositions++;
  portfolioState.lastUpdated = new Date().toISOString();
  await savePortfolio();
}

/**
 * Update trade P&L (unrealized)
 */
async function updateTradePnl(tradeId, pnl, pnlPercent) {
  // This is called when trade price updates
  // We'll recalculate total unrealized P&L from all active trades
  portfolioState.lastUpdated = new Date().toISOString();
  await savePortfolio();
}

/**
 * Close a trade (realized P&L)
 */
async function closeTrade(tradeId, pnl, pnlPercent, entryPrice, exitPrice, quantity) {
  portfolioState.closedPositions++;
  portfolioState.openPositions = Math.max(0, portfolioState.openPositions - 1);
  
  // Update realized P&L
  portfolioState.totalRealized += pnl;
  portfolioState.totalPnl += pnl;
  
  // Update win/loss stats
  if (pnl > 0) {
    portfolioState.winningTrades++;
    portfolioState.averageWin = portfolioState.winningTrades > 0
      ? (portfolioState.averageWin * (portfolioState.winningTrades - 1) + pnl) / portfolioState.winningTrades
      : pnl;
    if (pnl > portfolioState.largestWin) {
      portfolioState.largestWin = pnl;
    }
  } else if (pnl < 0) {
    portfolioState.losingTrades++;
    portfolioState.averageLoss = portfolioState.losingTrades > 0
      ? (portfolioState.averageLoss * (portfolioState.losingTrades - 1) + pnl) / portfolioState.losingTrades
      : pnl;
    if (pnl < portfolioState.largestLoss) {
      portfolioState.largestLoss = pnl;
    }
  }
  
  // Update win rate
  const closedCount = portfolioState.winningTrades + portfolioState.losingTrades;
  portfolioState.winRate = closedCount > 0
    ? (portfolioState.winningTrades / closedCount) * 100
    : 0;
  
  // Update balance
  portfolioState.currentBalance += pnl;
  
  portfolioState.lastUpdated = new Date().toISOString();
  await savePortfolio();
}

/**
 * Recalculate portfolio metrics from active trades
 */
async function recalculateFromTrades(activeTrades) {
  let totalUnrealized = 0;
  let openCount = 0;
  
  activeTrades.forEach(trade => {
    if (trade.status === 'OPEN' || trade.status === 'DCA_HIT') {
      openCount++;
      totalUnrealized += trade.pnl || 0;
    }
  });
  
  portfolioState.openPositions = openCount;
  portfolioState.totalUnrealized = totalUnrealized;
  portfolioState.totalPnl = portfolioState.totalRealized + totalUnrealized;
  portfolioState.totalPnlPercent = portfolioState.initialCapital > 0
    ? (portfolioState.totalPnl / portfolioState.initialCapital) * 100
    : 0;
  
  portfolioState.lastUpdated = new Date().toISOString();
  await savePortfolio();
}

/**
 * Recalculate portfolio from closed trades (on startup)
 * This ensures portfolio reflects all historical closed trades
 */
async function recalculateFromClosedTrades(closedTrades) {
  if (!closedTrades || closedTrades.length === 0) {
    return;
  }
  
  // Reset realized P&L and stats (will recalculate from closed trades)
  let totalRealized = 0;
  let winningTrades = 0;
  let losingTrades = 0;
  let totalClosedPositions = 0;
  let largestWin = 0;
  let largestLoss = 0;
  let totalWinAmount = 0;
  let totalLossAmount = 0;
  
  for (const trade of closedTrades) {
    const pnl = trade.finalPnl || trade.pnl || 0;
    const pnlPercent = trade.finalPnlPercent || trade.pnlPercent || 0;
    const entryPrice = trade.entryPrice || 0;
    const exitPrice = trade.closePrice || trade.executionPrice || trade.currentPrice || 0;
    const quantity = trade.quantity || trade.executedQty || 0;
    
    totalRealized += pnl;
    totalClosedPositions++;
    
    if (pnl > 0) {
      winningTrades++;
      totalWinAmount += pnl;
      if (pnl > largestWin) {
        largestWin = pnl;
      }
    } else if (pnl < 0) {
      losingTrades++;
      totalLossAmount += pnl;
      if (pnl < largestLoss) {
        largestLoss = pnl;
      }
    }
  }
  
  // Update portfolio state
  portfolioState.totalRealized = totalRealized;
  portfolioState.closedPositions = totalClosedPositions;
  portfolioState.winningTrades = winningTrades;
  portfolioState.losingTrades = losingTrades;
  portfolioState.largestWin = largestWin;
  portfolioState.largestLoss = largestLoss;
  portfolioState.averageWin = winningTrades > 0 ? totalWinAmount / winningTrades : 0;
  portfolioState.averageLoss = losingTrades > 0 ? totalLossAmount / losingTrades : 0;
  portfolioState.winRate = (winningTrades + losingTrades) > 0
    ? (winningTrades / (winningTrades + losingTrades)) * 100
    : 0;
  
  // Update balance: start from initial capital, add all realized P&L
  portfolioState.currentBalance = portfolioState.initialCapital + totalRealized;
  
  // Recalculate total P&L (will be updated when active trades are recalculated)
  portfolioState.totalPnl = portfolioState.totalRealized + portfolioState.totalUnrealized;
  portfolioState.totalPnlPercent = portfolioState.initialCapital > 0
    ? (portfolioState.totalPnl / portfolioState.initialCapital) * 100
    : 0;
  
  portfolioState.lastUpdated = new Date().toISOString();
  await savePortfolio();
  
  console.log(`✅ Recalculated portfolio from ${closedTrades.length} closed trades: ${winningTrades} wins, ${losingTrades} losses, Total P&L: $${totalRealized.toFixed(2)}`);
}

/**
 * Reset portfolio (for testing)
 */
async function resetPortfolio() {
  portfolioState = {
    initialCapital: DEFAULT_CAPITAL,
    currentBalance: DEFAULT_CAPITAL,
    totalInvested: 0,
    totalRealized: 0,
    totalUnrealized: 0,
    totalPnl: 0,
    totalPnlPercent: 0,
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    winRate: 0,
    averageWin: 0,
    averageLoss: 0,
    largestWin: 0,
    largestLoss: 0,
    openPositions: 0,
    closedPositions: 0,
    lastUpdated: new Date().toISOString()
  };
  await savePortfolio();
  return portfolioState;
}

/**
 * Get position size (USD)
 */
function getPositionSize() {
  return DEFAULT_POSITION_SIZE;
}

/**
 * Get DCA position size (USD)
 */
function getDCASize() {
  return DEFAULT_DCA_SIZE;
}

// Note: loadPortfolio() is called explicitly in ProfessionalTradingBot.initialize()
// to avoid module loading issues and circular dependencies

module.exports = {
  loadPortfolio,
  savePortfolio,
  getPortfolio,
  getPortfolioStats,
  updateBalance,
  recordTrade,
  updateTradePnl,
  closeTrade,
  recalculateFromTrades,
  recalculateFromClosedTrades,
  resetPortfolio,
  getPositionSize,
  getDCASize,
  DEFAULT_CAPITAL,
  DEFAULT_POSITION_SIZE,
  DEFAULT_DCA_SIZE
};

