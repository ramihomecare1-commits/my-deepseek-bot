/**
 * Performance Analytics Service
 * Track, analyze, and optimize trading performance
 */

/**
 * Calculate comprehensive trading metrics
 * @param {Array} closedTrades - Array of closed trades
 * @param {number} accountBalance - Current account balance
 * @returns {Object} Performance metrics
 */
function calculatePerformanceMetrics(closedTrades, accountBalance) {
  if (!closedTrades || closedTrades.length === 0) {
    return {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      averageWin: 0,
      averageLoss: 0,
      largestWin: 0,
      largestLoss: 0,
      profitFactor: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      totalProfit: 0,
      totalLoss: 0,
      netProfit: 0,
      roi: 0
    };
  }

  const wins = closedTrades.filter(t => (t.profitLoss || 0) > 0);
  const losses = closedTrades.filter(t => (t.profitLoss || 0) <= 0);

  const totalProfit = wins.reduce((sum, t) => sum + (t.profitLoss || 0), 0);
  const totalLoss = Math.abs(losses.reduce((sum, t) => sum + (t.profitLoss || 0), 0));
  const netProfit = totalProfit - totalLoss;

  const averageWin = wins.length > 0 ? totalProfit / wins.length : 0;
  const averageLoss = losses.length > 0 ? totalLoss / losses.length : 0;

  const largestWin = wins.length > 0 ? Math.max(...wins.map(t => t.profitLoss || 0)) : 0;
  const largestLoss = losses.length > 0 ? Math.min(...losses.map(t => t.profitLoss || 0)) : 0;

  const winRate = closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0;
  const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? Infinity : 0;

  // Calculate Sharpe Ratio (simplified)
  const returns = closedTrades.map(t => (t.profitLossPercent || 0) / 100);
  const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0; // Annualized

  // Calculate Maximum Drawdown
  let peak = 0;
  let maxDrawdown = 0;
  let equity = accountBalance - netProfit;

  for (const trade of closedTrades) {
    equity += (trade.profitLoss || 0);
    if (equity > peak) {
      peak = equity;
    }
    const drawdown = ((peak - equity) / peak) * 100;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  // Calculate ROI
  const initialCapital = accountBalance - netProfit;
  const roi = initialCapital > 0 ? (netProfit / initialCapital) * 100 : 0;

  return {
    totalTrades: closedTrades.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    winRate: Number(winRate.toFixed(2)),
    averageWin: Number(averageWin.toFixed(2)),
    averageLoss: Number(averageLoss.toFixed(2)),
    largestWin: Number(largestWin.toFixed(2)),
    largestLoss: Number(largestLoss.toFixed(2)),
    profitFactor: Number(profitFactor.toFixed(2)),
    sharpeRatio: Number(sharpeRatio.toFixed(2)),
    maxDrawdown: Number(maxDrawdown.toFixed(2)),
    totalProfit: Number(totalProfit.toFixed(2)),
    totalLoss: Number(totalLoss.toFixed(2)),
    netProfit: Number(netProfit.toFixed(2)),
    roi: Number(roi.toFixed(2)),
    expectancy: Number(((winRate / 100 * averageWin) - ((100 - winRate) / 100 * averageLoss)).toFixed(2))
  };
}

/**
 * Analyze trading performance by symbol
 * @param {Array} closedTrades - Array of closed trades
 * @returns {Object} Performance by symbol
 */
function analyzePerformanceBySymbol(closedTrades) {
  if (!closedTrades || closedTrades.length === 0) {
    return {};
  }

  const symbolStats = {};

  for (const trade of closedTrades) {
    const symbol = trade.symbol;
    if (!symbolStats[symbol]) {
      symbolStats[symbol] = {
        symbol: symbol,
        trades: [],
        totalTrades: 0,
        wins: 0,
        losses: 0,
        totalProfit: 0
      };
    }

    symbolStats[symbol].trades.push(trade);
    symbolStats[symbol].totalTrades++;
    
    if ((trade.profitLoss || 0) > 0) {
      symbolStats[symbol].wins++;
    } else {
      symbolStats[symbol].losses++;
    }
    
    symbolStats[symbol].totalProfit += (trade.profitLoss || 0);
  }

  // Calculate metrics for each symbol
  for (const symbol in symbolStats) {
    const stats = symbolStats[symbol];
    stats.winRate = (stats.wins / stats.totalTrades) * 100;
    stats.avgProfit = stats.totalProfit / stats.totalTrades;
  }

  // Sort by total profit
  return Object.values(symbolStats).sort((a, b) => b.totalProfit - a.totalProfit);
}

/**
 * Analyze trading performance by time period
 * @param {Array} closedTrades - Array of closed trades
 * @returns {Object} Performance by time period
 */
function analyzePerformanceByPeriod(closedTrades) {
  if (!closedTrades || closedTrades.length === 0) {
    return {
      daily: [],
      weekly: [],
      monthly: []
    };
  }

  const now = new Date();
  const periods = {
    daily: {},
    weekly: {},
    monthly: {}
  };

  for (const trade of closedTrades) {
    const closeDate = new Date(trade.closedAt || trade.exitTime);
    
    // Daily
    const dayKey = closeDate.toISOString().split('T')[0];
    if (!periods.daily[dayKey]) {
      periods.daily[dayKey] = { date: dayKey, profit: 0, trades: 0 };
    }
    periods.daily[dayKey].profit += (trade.profitLoss || 0);
    periods.daily[dayKey].trades++;

    // Weekly
    const weekStart = new Date(closeDate);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekKey = weekStart.toISOString().split('T')[0];
    if (!periods.weekly[weekKey]) {
      periods.weekly[weekKey] = { date: weekKey, profit: 0, trades: 0 };
    }
    periods.weekly[weekKey].profit += (trade.profitLoss || 0);
    periods.weekly[weekKey].trades++;

    // Monthly
    const monthKey = `${closeDate.getFullYear()}-${String(closeDate.getMonth() + 1).padStart(2, '0')}`;
    if (!periods.monthly[monthKey]) {
      periods.monthly[monthKey] = { date: monthKey, profit: 0, trades: 0 };
    }
    periods.monthly[monthKey].profit += (trade.profitLoss || 0);
    periods.monthly[monthKey].trades++;
  }

  return {
    daily: Object.values(periods.daily).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30),
    weekly: Object.values(periods.weekly).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12),
    monthly: Object.values(periods.monthly).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12)
  };
}

/**
 * Identify best and worst performing trades
 * @param {Array} closedTrades - Array of closed trades
 * @returns {Object} Best and worst trades
 */
function identifyExtremes(closedTrades) {
  if (!closedTrades || closedTrades.length === 0) {
    return {
      bestTrades: [],
      worstTrades: []
    };
  }

  const sorted = [...closedTrades].sort((a, b) => (b.profitLoss || 0) - (a.profitLoss || 0));

  return {
    bestTrades: sorted.slice(0, 5),
    worstTrades: sorted.slice(-5).reverse()
  };
}

/**
 * Calculate trade holding time statistics
 * @param {Array} closedTrades - Array of closed trades
 * @returns {Object} Holding time stats
 */
function analyzeHoldingTimes(closedTrades) {
  if (!closedTrades || closedTrades.length === 0) {
    return {
      avgHoldingTime: 0,
      minHoldingTime: 0,
      maxHoldingTime: 0
    };
  }

  const holdingTimes = closedTrades.map(trade => {
    const entry = new Date(trade.entryTime || trade.openedAt);
    const exit = new Date(trade.exitTime || trade.closedAt);
    return (exit - entry) / (1000 * 60 * 60); // Hours
  }).filter(t => !isNaN(t) && t > 0);

  if (holdingTimes.length === 0) {
    return {
      avgHoldingTime: 0,
      minHoldingTime: 0,
      maxHoldingTime: 0
    };
  }

  const avgHoldingTime = holdingTimes.reduce((sum, t) => sum + t, 0) / holdingTimes.length;
  const minHoldingTime = Math.min(...holdingTimes);
  const maxHoldingTime = Math.max(...holdingTimes);

  return {
    avgHoldingTime: Number(avgHoldingTime.toFixed(2)),
    minHoldingTime: Number(minHoldingTime.toFixed(2)),
    maxHoldingTime: Number(maxHoldingTime.toFixed(2))
  };
}

/**
 * Generate comprehensive performance report
 * @param {Array} closedTrades - Array of closed trades
 * @param {number} accountBalance - Current account balance
 * @returns {Object} Comprehensive performance report
 */
function generatePerformanceReport(closedTrades, accountBalance) {
  return {
    overview: calculatePerformanceMetrics(closedTrades, accountBalance),
    bySymbol: analyzePerformanceBySymbol(closedTrades),
    byPeriod: analyzePerformanceByPeriod(closedTrades),
    extremes: identifyExtremes(closedTrades),
    holdingTimes: analyzeHoldingTimes(closedTrades),
    generatedAt: new Date().toISOString()
  };
}

/**
 * Get real-time performance score (0-100)
 * @param {Object} metrics - Performance metrics
 * @returns {number} Performance score
 */
function calculatePerformanceScore(metrics) {
  let score = 0;

  // Win rate (30 points)
  if (metrics.winRate >= 60) {
    score += 30;
  } else if (metrics.winRate >= 50) {
    score += 20;
  } else if (metrics.winRate >= 40) {
    score += 10;
  }

  // Profit factor (30 points)
  if (metrics.profitFactor >= 2.0) {
    score += 30;
  } else if (metrics.profitFactor >= 1.5) {
    score += 20;
  } else if (metrics.profitFactor >= 1.2) {
    score += 10;
  }

  // Sharpe ratio (20 points)
  if (metrics.sharpeRatio >= 2.0) {
    score += 20;
  } else if (metrics.sharpeRatio >= 1.0) {
    score += 15;
  } else if (metrics.sharpeRatio >= 0.5) {
    score += 10;
  }

  // Max drawdown (20 points - inverse)
  if (metrics.maxDrawdown <= 5) {
    score += 20;
  } else if (metrics.maxDrawdown <= 10) {
    score += 15;
  } else if (metrics.maxDrawdown <= 15) {
    score += 10;
  } else if (metrics.maxDrawdown <= 20) {
    score += 5;
  }

  return Math.min(100, score);
}

/**
 * Identify areas for improvement
 * @param {Object} metrics - Performance metrics
 * @returns {Array} Recommendations
 */
function getImprovementRecommendations(metrics) {
  const recommendations = [];

  if (metrics.winRate < 50) {
    recommendations.push({
      area: 'Win Rate',
      current: metrics.winRate,
      target: 50,
      priority: 'HIGH',
      suggestion: 'Improve trade entry signals. Consider waiting for higher confidence setups.'
    });
  }

  if (metrics.profitFactor < 1.5) {
    recommendations.push({
      area: 'Profit Factor',
      current: metrics.profitFactor,
      target: 1.5,
      priority: 'HIGH',
      suggestion: 'Average wins are too small relative to losses. Let winners run longer or cut losses faster.'
    });
  }

  if (metrics.maxDrawdown > 15) {
    recommendations.push({
      area: 'Max Drawdown',
      current: metrics.maxDrawdown,
      target: 10,
      priority: 'HIGH',
      suggestion: 'Reduce position sizes or tighten stop losses to limit drawdowns.'
    });
  }

  if (metrics.sharpeRatio < 1.0) {
    recommendations.push({
      area: 'Risk-Adjusted Returns',
      current: metrics.sharpeRatio,
      target: 1.5,
      priority: 'MEDIUM',
      suggestion: 'Returns are volatile. Focus on consistent smaller wins over large but infrequent wins.'
    });
  }

  if (metrics.averageWin > 0 && metrics.averageLoss > 0) {
    const avgWinLossRatio = metrics.averageWin / metrics.averageLoss;
    if (avgWinLossRatio < 1.5) {
      recommendations.push({
        area: 'Average Win/Loss Ratio',
        current: avgWinLossRatio,
        target: 2.0,
        priority: 'MEDIUM',
        suggestion: 'Aim for wins that are at least 2x your average loss. Adjust TP/SL ratios.'
      });
    }
  }

  return recommendations;
}

module.exports = {
  calculatePerformanceMetrics,
  analyzePerformanceBySymbol,
  analyzePerformanceByPeriod,
  identifyExtremes,
  analyzeHoldingTimes,
  generatePerformanceReport,
  calculatePerformanceScore,
  getImprovementRecommendations
};

