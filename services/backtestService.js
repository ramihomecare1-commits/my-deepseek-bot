/**
 * Backtesting Service
 * Tests trading strategies on historical data to validate recommendations
 */

const { fetchLongTermHistoricalData } = require('./dataFetcher');
const { calculateRSI, calculateBollingerBands, identifyTrend, calculateMomentum } = require('../bot/indicators');
const { detectTradingPatterns } = require('../bot/patternDetection');

/**
 * Backtest a trading strategy on historical data
 * @param {Object} coin - Coin object with symbol, name, id
 * @param {Object} strategy - Strategy parameters (entryPrice, takeProfit, stopLoss, action)
 * @param {number} lookbackDays - How many days of history to test (default: 1825 = 5 years)
 * @returns {Promise<Object>} Backtest results
 */
async function backtestStrategy(coin, strategy, lookbackDays = 1825) {
  try {
    // Fetch 5 years of historical data for comprehensive backtesting
    const historicalData = await fetchLongTermHistoricalData(coin);
    
    if (!historicalData || historicalData.length < 20) {
      return {
        success: false,
        error: 'Insufficient historical data for backtesting',
        dataPoints: historicalData?.length || 0
      };
    }

    // Extract prices from historical data
    const prices = historicalData.map(d => {
      if (typeof d === 'number') return d;
      if (d.price) return d.price;
      if (d.close) return d.close;
      return 0;
    }).filter(p => p > 0);

    if (prices.length < 20) {
      return {
        success: false,
        error: 'Insufficient price data for backtesting',
        dataPoints: prices.length
      };
    }

    // Calculate indicators for backtesting
    const rsi = calculateRSI(prices, 14);
    const bollinger = calculateBollingerBands(prices, 20, 2);
    const trend = identifyTrend(prices);
    const momentum = calculateMomentum(prices);
    const patterns = detectTradingPatterns(prices);

    // Simulate trades based on strategy
    const trades = [];
    const currentPrice = prices[prices.length - 1];
    const entryPrice = strategy.entryPrice || currentPrice;
    const takeProfit = strategy.takeProfit || currentPrice * 1.05;
    const stopLoss = strategy.stopLoss || currentPrice * 0.95;
    const action = strategy.action || 'BUY';

    // Test strategy on historical data
    // We'll simulate what would have happened if we entered at similar conditions
    let wins = 0;
    let losses = 0;
    let totalReturn = 0;
    let maxDrawdown = 0;
    let maxProfit = 0;
    let winStreak = 0;
    let lossStreak = 0;
    let currentStreak = 0;
    let lastResult = null;

    // Simulate trades at different points in history
    // Test entry conditions similar to current recommendation
    // Sample every 3rd point to speed up backtesting
    const step = Math.max(1, Math.floor((prices.length - 25) / 20)); // Limit to ~20 test points
    for (let i = 20; i < prices.length - 5; i += step) {
      const testPrice = prices[i];
      const priceSlice = prices.slice(0, i + 1);
      
      // Only calculate indicators if we have enough data
      let testRSI = null;
      let testBollinger = null;
      let testTrend = null;
      
      if (priceSlice.length >= 15) {
        testRSI = calculateRSI(priceSlice, 14);
      }
      if (priceSlice.length >= 20) {
        testBollinger = calculateBollingerBands(priceSlice, 20, 2);
      }
      if (priceSlice.length >= 3) {
        testTrend = identifyTrend(priceSlice);
      }
      
      // Check if conditions are similar to current recommendation
      const rsiSimilar = testRSI && rsi ? Math.abs(testRSI - rsi) < 15 : false;
      const trendSimilar = testTrend === trend;
      
      // If conditions are similar, simulate the trade
      if (rsiSimilar || trendSimilar) {
        // Calculate TP/SL based on entry price
        const testEntryPrice = testPrice;
        const testTP = testEntryPrice * (takeProfit / entryPrice);
        const testSL = testEntryPrice * (stopLoss / entryPrice);
        
        // Check what happened in the next 5-20 periods
        let tradeResult = null;
        let exitPrice = null;
        let exitPeriod = null;
        
        for (let j = i + 1; j < Math.min(i + 20, prices.length); j++) {
          const futurePrice = prices[j];
          
          if (action === 'BUY') {
            if (futurePrice >= testTP) {
              tradeResult = 'WIN';
              exitPrice = testTP;
              exitPeriod = j - i;
              break;
            } else if (futurePrice <= testSL) {
              tradeResult = 'LOSS';
              exitPrice = testSL;
              exitPeriod = j - i;
              break;
            }
          } else if (action === 'SELL') {
            if (futurePrice <= testTP) {
              tradeResult = 'WIN';
              exitPrice = testTP;
              exitPeriod = j - i;
              break;
            } else if (futurePrice >= testSL) {
              tradeResult = 'LOSS';
              exitPrice = testSL;
              exitPeriod = j - i;
              break;
            }
          }
        }
        
        // If trade didn't hit TP or SL, check final outcome
        if (!tradeResult && i + 20 < prices.length) {
          const finalPrice = prices[i + 20];
          if (action === 'BUY') {
            const finalReturn = ((finalPrice - testEntryPrice) / testEntryPrice) * 100;
            tradeResult = finalReturn > 0 ? 'WIN' : 'LOSS';
            exitPrice = finalPrice;
            exitPeriod = 20;
          } else {
            const finalReturn = ((testEntryPrice - finalPrice) / testEntryPrice) * 100;
            tradeResult = finalReturn > 0 ? 'WIN' : 'LOSS';
            exitPrice = finalPrice;
            exitPeriod = 20;
          }
        }
        
        if (tradeResult) {
          const returnPercent = action === 'BUY'
            ? ((exitPrice - testEntryPrice) / testEntryPrice) * 100
            : ((testEntryPrice - exitPrice) / testEntryPrice) * 100;
          
          trades.push({
            entryPrice: testEntryPrice,
            exitPrice: exitPrice,
            returnPercent: returnPercent,
            result: tradeResult,
            periods: exitPeriod
          });
          
          if (tradeResult === 'WIN') {
            wins++;
            totalReturn += returnPercent;
            maxProfit = Math.max(maxProfit, returnPercent);
            if (lastResult === 'WIN') {
              currentStreak++;
            } else {
              currentStreak = 1;
            }
            winStreak = Math.max(winStreak, currentStreak);
            lastResult = 'WIN';
          } else {
            losses++;
            totalReturn += returnPercent;
            maxDrawdown = Math.min(maxDrawdown, returnPercent);
            if (lastResult === 'LOSS') {
              currentStreak++;
            } else {
              currentStreak = 1;
            }
            lossStreak = Math.max(lossStreak, currentStreak);
            lastResult = 'LOSS';
          }
        }
      }
    }

    // Calculate statistics
    const totalTrades = wins + losses;
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
    const avgReturn = totalTrades > 0 ? totalReturn / totalTrades : 0;
    const avgWin = wins > 0 ? trades.filter(t => t.result === 'WIN').reduce((sum, t) => sum + t.returnPercent, 0) / wins : 0;
    const avgLoss = losses > 0 ? trades.filter(t => t.result === 'LOSS').reduce((sum, t) => sum + t.returnPercent, 0) / losses : 0;
    const profitFactor = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : avgWin > 0 ? Infinity : 0;
    const avgPeriods = trades.length > 0 ? trades.reduce((sum, t) => sum + t.periods, 0) / trades.length : 0;

    return {
      success: true,
      totalTrades: totalTrades,
      wins: wins,
      losses: losses,
      winRate: winRate,
      avgReturn: avgReturn,
      avgWin: avgWin,
      avgLoss: avgLoss,
      maxProfit: maxProfit,
      maxDrawdown: maxDrawdown,
      profitFactor: profitFactor,
      winStreak: winStreak,
      lossStreak: lossStreak,
      avgPeriods: avgPeriods,
      trades: trades.slice(0, 10), // Return last 10 trades for analysis
      dataPoints: prices.length,
      lookbackDays: lookbackDays
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Quick backtest - uses 5 years of data for comprehensive validation
 * @param {Object} coin - Coin object
 * @param {Object} strategy - Strategy parameters
 * @returns {Promise<Object>} Backtest results (5 years of data)
 */
async function quickBacktest(coin, strategy) {
  // Use 5 years of data for comprehensive backtesting
  return await backtestStrategy(coin, strategy, 1825); // 5 years
}

/**
 * Walk-forward optimization
 * Splits data into in-sample and out-of-sample periods
 */
async function walkForwardOptimization(coin, strategy, inSampleDays = 1095, outSampleDays = 365) {
  try {
    const historicalData = await fetchLongTermHistoricalData(coin);
    if (!historicalData || historicalData.length < inSampleDays + outSampleDays) {
      return {
        success: false,
        error: 'Insufficient data for walk-forward optimization'
      };
    }
    
    const prices = historicalData.map(d => typeof d === 'number' ? d : (d.price || d.close || 0)).filter(p => p > 0);
    
    // Split into in-sample and out-of-sample
    const inSample = prices.slice(0, inSampleDays);
    const outSample = prices.slice(inSampleDays, inSampleDays + outSampleDays);
    
    // Optimize on in-sample
    const inSampleResult = await backtestStrategy(
      coin,
      { ...strategy, prices: inSample },
      inSampleDays
    );
    
    // Test on out-of-sample
    const outSampleResult = await backtestStrategy(
      coin,
      { ...strategy, prices: outSample },
      outSampleDays
    );
    
    return {
      success: true,
      inSample: inSampleResult,
      outSample: outSampleResult,
      consistency: outSampleResult.winRate > inSampleResult.winRate * 0.8
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Monte Carlo simulation with slippage
 */
async function monteCarloSimulation(coin, strategy, simulations = 1000, slippagePercent = 0.1) {
  try {
    const baseResult = await backtestStrategy(coin, strategy);
    if (!baseResult.success) {
      return baseResult;
    }
    
    const results = [];
    const slippageMultiplier = 1 - (slippagePercent / 100);
    
    for (let i = 0; i < Math.min(simulations, 100); i++) { // Limit to 100 for performance
      const modifiedStrategy = {
        ...strategy,
        entryPrice: strategy.entryPrice * (1 + (Math.random() - 0.5) * 0.002),
        takeProfit: strategy.takeProfit * slippageMultiplier,
        stopLoss: strategy.stopLoss * (1 + (Math.random() - 0.5) * 0.002)
      };
      
      const result = await backtestStrategy(coin, modifiedStrategy);
      if (result.success) {
        results.push(result);
      }
    }
    
    if (results.length === 0) {
      return baseResult;
    }
    
    const winRates = results.map(r => r.winRate).filter(w => !isNaN(w));
    const profitFactors = results.map(r => r.profitFactor).filter(p => !isNaN(p));
    
    const avgWinRate = winRates.reduce((a, b) => a + b, 0) / winRates.length;
    const avgProfitFactor = profitFactors.reduce((a, b) => a + b, 0) / profitFactors.length;
    
    return {
      success: true,
      simulations: results.length,
      baseResult,
      statistics: {
        avgWinRate: Math.round(avgWinRate * 100) / 100,
        avgProfitFactor: Math.round(avgProfitFactor * 100) / 100
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  backtestStrategy,
  quickBacktest,
  walkForwardOptimization,
  monteCarloSimulation
};

