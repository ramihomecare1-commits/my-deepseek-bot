/**
 * Portfolio Rebalancing Service
 * Automatically rebalances portfolio based on target allocation percentages
 */

const { getPortfolio } = require('./portfolioService');

/**
 * Calculate current portfolio allocation
 * @param {Array} activeTrades - Array of active trades
 * @returns {Object} Current allocation by coin
 */
function calculateCurrentAllocation(activeTrades) {
  if (!activeTrades || activeTrades.length === 0) {
    return {};
  }
  
  const portfolio = getPortfolio();
  const totalValue = portfolio.currentBalance || portfolio.initialCapital || 10000;
  
  const allocation = {};
  let totalAllocated = 0;
  
  activeTrades.forEach(trade => {
    const positionValue = (trade.currentPrice || trade.entryPrice) * (trade.quantity || 0);
    const percent = (positionValue / totalValue) * 100;
    
    if (!allocation[trade.symbol]) {
      allocation[trade.symbol] = {
        symbol: trade.symbol,
        currentValue: 0,
        currentPercent: 0,
        targetPercent: 0,
        deviation: 0,
        quantity: 0
      };
    }
    
    allocation[trade.symbol].currentValue += positionValue;
    allocation[trade.symbol].quantity += (trade.quantity || 0);
    totalAllocated += positionValue;
  });
  
  // Calculate percentages
  Object.keys(allocation).forEach(symbol => {
    allocation[symbol].currentPercent = (allocation[symbol].currentValue / totalValue) * 100;
  });
  
  return {
    allocations: allocation,
    totalAllocated,
    totalValue,
    unallocated: totalValue - totalAllocated,
    unallocatedPercent: ((totalValue - totalAllocated) / totalValue) * 100
  };
}

/**
 * Calculate rebalancing actions needed
 * @param {Object} currentAllocation - Current allocation from calculateCurrentAllocation
 * @param {Object} targetAllocation - Target allocation percentages by symbol
 * @param {number} deviationThreshold - Minimum deviation to trigger rebalance (default: 5%)
 * @returns {Array} Rebalancing actions needed
 */
function calculateRebalancingActions(currentAllocation, targetAllocation, deviationThreshold = 5) {
  const actions = [];
  const totalValue = currentAllocation.totalValue;
  
  Object.keys(targetAllocation).forEach(symbol => {
    const targetPercent = targetAllocation[symbol];
    const current = currentAllocation.allocations[symbol];
    const currentPercent = current ? current.currentPercent : 0;
    const deviation = currentPercent - targetPercent;
    
    if (Math.abs(deviation) >= deviationThreshold) {
      const targetValue = totalValue * (targetPercent / 100);
      const currentValue = current ? current.currentValue : 0;
      const adjustmentNeeded = targetValue - currentValue;
      
      actions.push({
        symbol,
        action: adjustmentNeeded > 0 ? 'BUY' : 'SELL',
        currentPercent: Math.round(currentPercent * 100) / 100,
        targetPercent: Math.round(targetPercent * 100) / 100,
        deviation: Math.round(deviation * 100) / 100,
        adjustmentAmount: Math.abs(adjustmentNeeded),
        adjustmentPercent: Math.abs(deviation)
      });
    }
  });
  
  // Sort by deviation (largest first)
  actions.sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation));
  
  return actions;
}

/**
 * Get recommended rebalancing strategy
 * @param {Array} activeTrades - Active trades
 * @param {Object} targetAllocation - Target allocation (e.g., { 'BTC': 30, 'ETH': 20, 'BNB': 15 })
 * @param {Object} options - Rebalancing options
 * @returns {Object} Rebalancing recommendations
 */
function getRebalancingStrategy(activeTrades, targetAllocation = {}, options = {}) {
  const {
    deviationThreshold = 5, // 5% deviation triggers rebalance
    maxPositions = 10, // Maximum number of positions
    minPositionSize = 50 // Minimum position size in USD
  } = options;
  
  // Default target allocation if not provided (equal weight)
  if (Object.keys(targetAllocation).length === 0 && activeTrades.length > 0) {
    const equalWeight = 100 / activeTrades.length;
    activeTrades.forEach(trade => {
      targetAllocation[trade.symbol] = equalWeight;
    });
  }
  
  const currentAllocation = calculateCurrentAllocation(activeTrades);
  const actions = calculateRebalancingActions(currentAllocation, targetAllocation, deviationThreshold);
  
  return {
    currentAllocation,
    targetAllocation,
    actions,
    needsRebalancing: actions.length > 0,
    summary: {
      totalPositions: Object.keys(currentAllocation.allocations).length,
      positionsNeedingRebalance: actions.length,
      totalDeviation: actions.reduce((sum, a) => sum + Math.abs(a.deviation), 0)
    }
  };
}

module.exports = {
  calculateCurrentAllocation,
  calculateRebalancingActions,
  getRebalancingStrategy
};

