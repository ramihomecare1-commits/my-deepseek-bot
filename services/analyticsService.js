/**
 * Performance Analytics Service
 * Calculates comprehensive trading performance metrics
 */

const { getPortfolio } = require('./portfolioService');

/**
 * Calculate Sharpe Ratio
 * @param {Array} returns - Array of periodic returns
 * @param {number} riskFreeRate - Risk-free rate (default: 0.02 = 2% annual)
 * @returns {number} Sharpe ratio
 */
function calculateSharpeRatio(returns, riskFreeRate = 0.02) {
  if (!returns || returns.length === 0) return 0;
  
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  
  if (stdDev === 0) return 0;
  
  // Annualized Sharpe ratio (assuming daily returns)
  const annualizedReturn = avgReturn * 365;
  const annualizedStdDev = stdDev * Math.sqrt(365);
  const annualizedRiskFree = riskFreeRate;
  
  return (annualizedReturn - annualizedRiskFree) / annualizedStdDev;
}

/**
 * Calculate Maximum Drawdown
 * @param {Array} equityCurve - Array of portfolio values over time
 * @returns {Object} Drawdown metrics
 */
function calculateMaxDrawdown(equityCurve) {
  if (!equityCurve || equityCurve.length === 0) {
    return { maxDrawdown: 0, maxDrawdownPercent: 0, peak: 0, trough: 0 };
  }
  
  let peak = equityCurve[0];
  let maxDrawdown = 0;
  let maxDrawdownPercent = 0;
  let trough = peak;
  
  for (let i = 1; i < equityCurve.length; i++) {
    const value = equityCurve[i];
    if (value > peak) {
      peak = value;
      trough = value;
    } else if (value < trough) {
      trough = value;
      const drawdown = peak - trough;
      const drawdownPercent = (drawdown / peak) * 100;
      
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
        maxDrawdownPercent = drawdownPercent;
      }
    }
  }
  
  return {
    maxDrawdown,
    maxDrawdownPercent: Math.round(maxDrawdownPercent * 100) / 100,
    peak,
    trough
  };
}

/**
 * Calculate win rate by coin
 * @param {Array} closedTrades - Array of closed trades
 * @returns {Object} Win rate statistics by coin
 */
function calculateWinRateByCoin(closedTrades) {
  if (!closedTrades || closedTrades.length === 0) {
    return {};
  }
  
  const coinStats = {};
  
  closedTrades.forEach(trade => {
    const symbol = trade.symbol;
    if (!coinStats[symbol]) {
      coinStats[symbol] = {
        total: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        totalPnl: 0,
        avgPnl: 0
      };
    }
    
    coinStats[symbol].total++;
    const pnl = trade.finalPnl || trade.pnl || 0;
    coinStats[symbol].totalPnl += pnl;
    
    if (pnl > 0) {
      coinStats[symbol].wins++;
    } else if (pnl < 0) {
      coinStats[symbol].losses++;
    }
  });
  
  // Calculate win rates and averages
  Object.keys(coinStats).forEach(symbol => {
    const stats = coinStats[symbol];
    stats.winRate = stats.total > 0 ? (stats.wins / stats.total) * 100 : 0;
    stats.avgPnl = stats.total > 0 ? stats.totalPnl / stats.total : 0;
    stats.winRate = Math.round(stats.winRate * 100) / 100;
    stats.avgPnl = Math.round(stats.avgPnl * 100) / 100;
  });
  
  return coinStats;
}

/**
 * Calculate performance by time period
 * @param {Array} closedTrades - Array of closed trades
 * @returns {Object} Performance by hour/day/week
 */
function calculatePerformanceByTime(closedTrades) {
  if (!closedTrades || closedTrades.length === 0) {
    return { byHour: {}, byDay: {}, byWeek: {} };
  }
  
  const byHour = {};
  const byDay = {};
  const byWeek = {};
  
  closedTrades.forEach(trade => {
    const closedAt = new Date(trade.closedAt || trade.entryTime);
    const hour = closedAt.getHours();
    const day = closedAt.getDay(); // 0 = Sunday, 6 = Saturday
    const week = Math.floor(closedAt.getDate() / 7); // Week of month
    
    const pnl = trade.finalPnl || trade.pnl || 0;
    
    // By hour
    if (!byHour[hour]) {
      byHour[hour] = { total: 0, wins: 0, losses: 0, totalPnl: 0 };
    }
    byHour[hour].total++;
    byHour[hour].totalPnl += pnl;
    if (pnl > 0) byHour[hour].wins++;
    else if (pnl < 0) byHour[hour].losses++;
    
    // By day
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayName = dayNames[day];
    if (!byDay[dayName]) {
      byDay[dayName] = { total: 0, wins: 0, losses: 0, totalPnl: 0 };
    }
    byDay[dayName].total++;
    byDay[dayName].totalPnl += pnl;
    if (pnl > 0) byDay[dayName].wins++;
    else if (pnl < 0) byDay[dayName].losses++;
  });
  
  // Calculate win rates
  Object.keys(byHour).forEach(h => {
    const stats = byHour[h];
    stats.winRate = stats.total > 0 ? (stats.wins / stats.total) * 100 : 0;
    stats.avgPnl = stats.total > 0 ? stats.totalPnl / stats.total : 0;
  });
  
  Object.keys(byDay).forEach(d => {
    const stats = byDay[d];
    stats.winRate = stats.total > 0 ? (stats.wins / stats.total) * 100 : 0;
    stats.avgPnl = stats.total > 0 ? stats.totalPnl / stats.total : 0;
  });
  
  return { byHour, byDay, byWeek };
}

/**
 * Calculate average holding time
 * @param {Array} closedTrades - Array of closed trades
 * @returns {Object} Holding time statistics
 */
function calculateHoldingTime(closedTrades) {
  if (!closedTrades || closedTrades.length === 0) {
    return { avgHours: 0, avgDays: 0, minHours: 0, maxHours: 0 };
  }
  
  const holdingTimes = [];
  
  closedTrades.forEach(trade => {
    const entryTime = new Date(trade.entryTime || trade.entryTime);
    const closedAt = new Date(trade.closedAt || new Date());
    const hours = (closedAt - entryTime) / (1000 * 60 * 60);
    holdingTimes.push(hours);
  });
  
  const avgHours = holdingTimes.reduce((a, b) => a + b, 0) / holdingTimes.length;
  const minHours = Math.min(...holdingTimes);
  const maxHours = Math.max(...holdingTimes);
  
  return {
    avgHours: Math.round(avgHours * 100) / 100,
    avgDays: Math.round((avgHours / 24) * 100) / 100,
    minHours: Math.round(minHours * 100) / 100,
    maxHours: Math.round(maxHours * 100) / 100
  };
}

/**
 * Get comprehensive performance analytics
 * @param {Array} closedTrades - Array of closed trades
 * @param {Array} activeTrades - Array of active trades
 * @returns {Object} Complete analytics
 */
function getPerformanceAnalytics(closedTrades = [], activeTrades = []) {
  const portfolio = getPortfolio();
  
  // Calculate returns from closed trades
  const returns = closedTrades.map(trade => {
    const pnl = trade.finalPnl || trade.pnl || 0;
    const entryPrice = trade.entryPrice || 1;
    return pnl / (entryPrice * (trade.quantity || 1));
  });
  
  // Build equity curve
  let equity = portfolio.initialCapital || 10000;
  const equityCurve = [equity];
  closedTrades.forEach(trade => {
    const pnl = trade.finalPnl || trade.pnl || 0;
    equity += pnl;
    equityCurve.push(equity);
  });
  
  // Calculate metrics
  const sharpeRatio = calculateSharpeRatio(returns);
  const drawdown = calculateMaxDrawdown(equityCurve);
  const winRateByCoin = calculateWinRateByCoin(closedTrades);
  const performanceByTime = calculatePerformanceByTime(closedTrades);
  const holdingTime = calculateHoldingTime(closedTrades);
  
  // Best and worst trades
  const sortedTrades = [...closedTrades].sort((a, b) => {
    const pnlA = a.finalPnl || a.pnl || 0;
    const pnlB = b.finalPnl || b.pnl || 0;
    return pnlB - pnlA;
  });
  
  const bestTrades = sortedTrades.slice(0, 5);
  const worstTrades = sortedTrades.slice(-5).reverse();
  
  return {
    sharpeRatio: Math.round(sharpeRatio * 100) / 100,
    maxDrawdown: drawdown.maxDrawdown,
    maxDrawdownPercent: drawdown.maxDrawdownPercent,
    winRateByCoin,
    performanceByTime,
    holdingTime,
    bestTrades: bestTrades.map(t => ({
      symbol: t.symbol,
      pnl: t.finalPnl || t.pnl || 0,
      pnlPercent: t.finalPnlPercent || t.pnlPercent || 0,
      entryPrice: t.entryPrice,
      exitPrice: t.closePrice || t.executionPrice
    })),
    worstTrades: worstTrades.map(t => ({
      symbol: t.symbol,
      pnl: t.finalPnl || t.pnl || 0,
      pnlPercent: t.finalPnlPercent || t.pnlPercent || 0,
      entryPrice: t.entryPrice,
      exitPrice: t.closePrice || t.executionPrice
    })),
    totalTrades: closedTrades.length,
    activeTrades: activeTrades.length,
    portfolio: {
      initialCapital: portfolio.initialCapital,
      currentBalance: portfolio.currentBalance,
      totalPnl: portfolio.totalPnl,
      totalPnlPercent: portfolio.totalPnlPercent,
      winRate: portfolio.winRate
    }
  };
}

module.exports = {
  calculateSharpeRatio,
  calculateMaxDrawdown,
  calculateWinRateByCoin,
  calculatePerformanceByTime,
  calculateHoldingTime,
  getPerformanceAnalytics
};

