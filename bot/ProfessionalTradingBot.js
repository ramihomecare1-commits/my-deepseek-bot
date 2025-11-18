const axios = require('axios');
const config = require('../config/config');
const { sleep, getTop100Coins } = require('../utils/helpers');
const { 
  calculateRSI, 
  calculateBollingerBands, 
  identifyTrend, 
  calculateMomentum,
  getBollingerPosition,
  identifySupportResistance
} = require('./indicators');
const { 
  fetchEnhancedPriceData, 
  fetchHistoricalData,
  fetchGlobalMetrics: fetchGlobalMetricsService,
  ensureGreedFearIndex 
} = require('../services/dataFetcher');
const { 
  sendTelegramNotification,
  sendTestNotification,
  sendTelegramMessage
} = require('../services/notificationService');
const { getAITechnicalAnalysis, getBatchAIAnalysis } = require('../services/aiService');
const { fetchCryptoNews } = require('../services/newsService');
const { detectTradingPatterns } = require('./patternDetection');
const { storeAIEvaluation, retrieveRelatedData } = require('../services/dataStorageService');
const monitoringService = require('../services/monitoringService');
const tradeMonitoringService = require('../services/tradeMonitoringService');
const {
  isExchangeTradingEnabled,
  executeTakeProfit,
  executeStopLoss,
  executeAddPosition
} = require('../services/exchangeService');
const { quickBacktest } = require('../services/backtestService');
const { loadTrades, saveTrades, loadClosedTrades, saveClosedTrades } = require('../services/tradePersistenceService');
const { loadPortfolio, recalculateFromTrades, recalculateFromClosedTrades, getPortfolioStats, closeTrade, getDcaTriggerTimestamp, setDcaTriggerTimestamp } = require('../services/portfolioService');

// Helper function to add log entries
// Note: We can't require routes/api here as it causes circular dependency
// We'll use console.log only - routes/api can call this function if needed
// but we won't call back to routes/api to avoid circular dependency
function addLogEntry(message, level = 'info') {
  // Simply use console.log - no dependencies, no circular issues
  const levelUpper = level.toUpperCase();
  console.log(`[${levelUpper}] ${message}`);
}

class ProfessionalTradingBot {
  constructor() {
    this.isRunning = false;
    this.scanTimer = null;
    this.scanInProgress = false;
    this.tradesUpdateTimer = null; // Separate timer for active trades updates
    this.monitoringTimer = null; // Two-tier AI monitoring timer

    this.trackedCoins = getTop100Coins();
    this.minConfidence = 0.65; // Will be synced with tradingRules.minConfidence

    this.analysisHistory = [];
    this.liveAnalysis = [];
    this.currentlyAnalyzing = null;
    

    this.stats = {
      totalScans: 0,
      totalOpportunities: 0,
      avgConfidence: 0,
      lastScanDuration: 0,
      lastScanTime: null,
      notificationsSent: 0,
      lastSuccessfulScan: null,
      mockDataUsage: 0,
      apiErrors: 0,
      skippedDueToOverlap: 0,
      coinmarketcapUsage: 0,
      coinpaprikaUsage: 0,
      aiCalls: 0,  // Track AI API calls
    };

    this.tradeAutomationRules = {
      partialTakeProfit: {
        enabled: true,
        steps: [
          { triggerPercent: 2, takePercent: 25 },
          { triggerPercent: 4, takePercent: 25 },
          { triggerPercent: 6, takePercent: 25 }
        ],
        lockStopToEntry: true
      },
      dca: {
        maxPerTrade: 3,
        cooldownMinutes: 60
      }
    };

    this.lastNotificationTime = {};
    // Cache to avoid spamming duplicate rejection notifications
    // Structure: { 'SYMBOL:reasonType:YYYY-MM-DD': timestamp }
    this.rejectionNotificationCache = {};
    // Cooldown for open-trade AI re-evaluation (ms) - applies to BOTH AI calls and Telegram summary
    this.openTradesReevalCooldownMs = 5 * 60 * 1000; // 5 minutes
    this.lastOpenTradesReevalAt = 0; // timestamp of last AI re-evaluation call
    this.lastOpenTradesReevalNotifiedAt = null; // timestamp of last Telegram summary
    // Unified cooldown for ALL triggers (DCA execution, DCA proximity, TP proximity, SL proximity)
    this.dcaTriggerReevalCooldownMs = 3 * 60 * 60 * 1000; // 3 hours (unified for all triggers)
    this.lastDcaTriggerReevalAt = 0; // timestamp of last trigger-based re-evaluation
    this.dcaTriggerReevalInProgress = false; // flag to prevent multiple simultaneous re-evaluations
    this.botStartTime = Date.now(); // track when bot started (prevents re-eval during startup)
    this.dcaTriggerStartupDelayMs = 3 * 60 * 1000; // 3 minutes startup delay (prevents timeout during deployment)
    this.lastBtcMissingWarning = 0; // timestamp of last BTC missing warning (throttles logging)
    this.selectedIntervalKey = '1h';
    this.scanIntervalMs = config.SCAN_INTERVAL_OPTIONS[this.selectedIntervalKey];
    this.nextScanTime = null; // Track when next scan is scheduled (prevents reset on page refresh)
    this.scanProgress = {
      running: false,
      processed: 0,
      total: this.trackedCoins.length,
      percent: 0,
    };
    this.greedFearIndex = {
      value: null,
      classification: null,
      timestamp: null,
    };
    this.latestHeatmap = [];
    this.newsCache = new Map();
    this.newsCacheMaxSize = 200; // Limit news cache to 200 entries
    this.priceCache = new Map();
    this.priceCacheMaxSize = 100; // Limit price cache to 100 entries
    this.globalMetrics = {
      coinmarketcap: null,
      coinpaprika: null,
      lastUpdated: null
    };
    this.lastBatchAIResults = {
      results: {},
      timestamp: null,
      coinsAnalyzed: 0,
    };
    
    // Active trades management
    this.activeTrades = []; // Stores currently open trades
    this.closedTrades = []; // Stores closed trades for performance tracking
    
    // Customizable trading rules
    this.tradingRules = {
      minConfidence: 0.65,
      enabledIndicators: {
        rsi: true,
        bollinger: true,
        supportResistance: true,
        fibonacci: true,
        momentum: true,
        trend: true
      },
      trailingStopLoss: {
        enabled: true,
        activationPercent: 2.0,  // Activate when profit reaches 2%
        trailingPercent: 1.0,    // Trail by 1% from peak
        updateInterval: 60000    // Check every minute
      },
      positionSizing: {
        enabled: true,
        riskPerTrade: 0.02,       // 2% of capital per trade
        maxPositionSize: 0.10,    // Max 10% of capital per position
        useVolatility: true,      // Adjust based on volatility (ATR)
        minPositionSize: 50      // Minimum $50 per trade
      },
      rsi: {
        oversold: 30,
        overbought: 70,
        neutralMin: 30,
        neutralMax: 70
      },
      bollinger: {
        lowerThreshold: 0.2,  // Position < 0.2 = lower band
        upperThreshold: 0.8   // Position > 0.8 = upper band
      },
      fibonacci: {
        enabled: true,
        supportLevels: [0.618, 0.786],  // 61.8% and 78.6%
        resistanceLevels: [0.236, 0.382] // 23.6% and 38.2%
      },
      supportResistance: {
        lookbackPeriod: 20,
        breakoutThreshold: 0.02  // 2% breakout
      },
      multiTimeframeConsensus: {
        enabled: true,
        requiredMatches: 2,
        timeframes: ['4h', '1d', '1w']  // Long-term trading: 4h, daily, and weekly
      },
      patterns: {
        buy: {
          enabled: true,
          requireRSIOversold: true,
          requireBollingerLower: false,
          requireSupportLevel: false,
          requireFibonacciSupport: false,
          requireBullishTrend: false,
          requirePattern: false,  // Require trading pattern (H&S, channels, etc.)
          minTimeframeAlignment: 2  // At least 2 timeframes must align
        },
        sell: {
          enabled: true,
          requireRSIOverbought: true,
          requireBollingerUpper: false,
          requireResistanceLevel: false,
          requireFibonacciResistance: false,
          requireBearishTrend: false,
          requirePattern: false,  // Require trading pattern
          minTimeframeAlignment: 2
        }
      },
      patternDetection: {
        enabled: true,
        parallelChannels: true,
        headAndShoulders: true,
        triangles: true,
        wedges: true,
        doubleTopBottom: true
      },
      bybitTradingEnabled: true  // Enable Bybit demo trading (requires BYBIT_API_KEY and BYBIT_API_SECRET)
    };
    
    // Sync minConfidence
    this.minConfidence = this.tradingRules.minConfidence;
  }

  /**
   * Initialize bot: Load saved trades and portfolio state
   */
  async initialize() {
    try {
      console.log('🔄 Starting bot initialization...');
      
      // Load portfolio state
      await loadPortfolio();
      addLogEntry('Portfolio state loaded', 'success');
      console.log('✅ Portfolio state loaded');
      
      // Load persisted unified trigger timestamp
      this.lastDcaTriggerReevalAt = getDcaTriggerTimestamp();
      if (this.lastDcaTriggerReevalAt > 0) {
        const elapsed = Date.now() - this.lastDcaTriggerReevalAt;
        const elapsedHours = Math.floor(elapsed / 3600000);
        const elapsedMinutes = Math.floor((elapsed % 3600000) / 60000);
        console.log(`📅 Loaded unified trigger timestamp: ${elapsedHours}h ${elapsedMinutes}m ago`);
      }
      
      // Load trades: BYBIT IS PRIMARY SOURCE, DynamoDB is metadata only
      console.log('📂 Loading active trades from Bybit (primary source)...');
      
      const { isExchangeTradingEnabled, getPreferredExchange, getBybitOpenPositions } = require('../services/exchangeService');
      const exchangeConfig = isExchangeTradingEnabled();
      
      if (exchangeConfig.enabled) {
        console.log('🔄 Fetching positions from Bybit (source of truth)...');
        const exchange = getPreferredExchange();
        
        try {
          // Get actual positions from Bybit (PRIMARY SOURCE)
          const bybitPositions = await getBybitOpenPositions(
            exchange.apiKey,
            exchange.apiSecret,
            exchange.baseUrl
          );
          
          if (bybitPositions.length > 0) {
            console.log(`✅ Found ${bybitPositions.length} positions on Bybit`);
            
            // Load metadata from DynamoDB (entry price, DCA count, TP/SL levels)
            const savedTrades = await loadTrades();
            console.log(`📂 Loaded ${savedTrades ? savedTrades.length : 0} trade metadata records from DynamoDB`);
            
            // Match Bybit positions with DynamoDB metadata
            const syncedTrades = [];
            
            bybitPositions.forEach(bybitPos => {
              // Find matching trade metadata in DynamoDB
              const tradeMetadata = savedTrades?.find(t => t.symbol === bybitPos.coin);
              
              if (tradeMetadata) {
                // Merge: Bybit quantities + DynamoDB metadata
                tradeMetadata.quantity = bybitPos.quantity; // Bybit is source of truth
                tradeMetadata.bybitQuantity = bybitPos.quantity;
                tradeMetadata.bybitFree = bybitPos.free;
                tradeMetadata.bybitLocked = bybitPos.locked;
                tradeMetadata.lastSyncedWithBybit = new Date();
                syncedTrades.push(tradeMetadata);
                console.log(`   ✅ ${bybitPos.coin}: Synced - Quantity: ${bybitPos.quantity.toFixed(8)} (from Bybit), Entry: $${tradeMetadata.entryPrice?.toFixed(2) || 'N/A'} (from DynamoDB)`);
              } else {
                // Position on Bybit but no metadata - create minimal trade record
                console.log(`   ⚠️ ${bybitPos.coin}: Found on Bybit but no metadata in DynamoDB - creating minimal record`);
                syncedTrades.push({
                  id: `${bybitPos.coin}-${Date.now()}`,
                  symbol: bybitPos.coin,
                  action: 'BUY', // Default assumption
                  entryPrice: 0, // Unknown - will be updated on next price fetch
                  quantity: bybitPos.quantity,
                  bybitQuantity: bybitPos.quantity,
                  bybitFree: bybitPos.free,
                  bybitLocked: bybitPos.locked,
                  status: 'OPEN',
                  entryTime: new Date(),
                  lastSyncedWithBybit: new Date(),
                  note: 'Position found on Bybit without metadata'
                });
              }
            });
            
            // Check for trades in DynamoDB that aren't on Bybit (closed positions)
            if (savedTrades) {
              savedTrades.forEach(trade => {
                const onBybit = bybitPositions.find(p => p.coin === trade.symbol);
                if (!onBybit && trade.quantity > 0) {
                  console.log(`   ⚠️ ${trade.symbol}: In DynamoDB but not on Bybit - position likely closed`);
                }
              });
            }
            
            this.activeTrades = syncedTrades;
            console.log(`✅ Loaded ${syncedTrades.length} active trades from Bybit (with DynamoDB metadata)`);
            
            // Save synced trades back to DynamoDB (metadata sync)
            if (syncedTrades.length > 0) {
              await saveTrades(syncedTrades);
              console.log(`💾 Synced trade metadata to DynamoDB`);
            }
          } else {
            console.log(`✅ No open positions on Bybit`);
            this.activeTrades = [];
            
            // Clear any stale trades from DynamoDB if Bybit has no positions
            const savedTrades = await loadTrades();
            if (savedTrades && savedTrades.length > 0) {
              console.log(`⚠️ Found ${savedTrades.length} trades in DynamoDB but none on Bybit - positions may be closed`);
              // Don't auto-delete - let user verify
            }
          }
        } catch (error) {
          console.error(`❌ Error fetching Bybit positions: ${error.message}`);
          console.log('📂 Falling back to DynamoDB metadata only (Bybit unavailable)');
          
          // Fallback: Load from DynamoDB if Bybit unavailable
          const savedTrades = await loadTrades();
          if (savedTrades && savedTrades.length > 0) {
            this.activeTrades = savedTrades;
            console.log(`⚠️ Loaded ${savedTrades.length} trades from DynamoDB (Bybit unavailable - verify positions manually)`);
          } else {
            this.activeTrades = [];
          }
        }
      } else {
        // Bybit not enabled - can't load real positions
        console.log('⚠️ Bybit not configured - cannot load real positions');
        console.log('   Configure BYBIT_API_KEY and BYBIT_API_SECRET to use Bybit as source of truth');
        this.activeTrades = [];
      }
      
      if (this.activeTrades && this.activeTrades.length > 0) {
        console.log(`✅ Active trades loaded: ${this.activeTrades.length} trades`);
        console.log('✅ Trades will be synced with Bybit on next update');
      } else {
        console.log('📂 No active trades found');
      }
      
      // Load closed trades
      await this.loadClosedTrades();
      
      // Recalculate portfolio from closed trades first (historical P&L)
      if (this.closedTrades && this.closedTrades.length > 0) {
        await recalculateFromClosedTrades(this.closedTrades);
        addLogEntry(`Portfolio recalculated from ${this.closedTrades.length} closed trades`, 'info');
        console.log(`✅ Portfolio recalculated from ${this.closedTrades.length} closed trades`);
      }
      
      // Recalculate portfolio metrics from active trades (unrealized P&L)
      await recalculateFromTrades(this.activeTrades);
      addLogEntry('Portfolio metrics recalculated from restored trades', 'info');
      console.log('✅ Portfolio metrics recalculated');
      
      // Start trade monitoring service for AI evaluation at key levels (delayed to avoid blocking)
      if (this.activeTrades && this.activeTrades.length > 0) {
        setTimeout(() => {
          try {
            tradeMonitoringService.start(this);
            console.log('✅ Trade monitoring service started');
          } catch (error) {
            console.error('❌ Error starting trade monitoring:', error.message);
          }
        }, 5000); // Start after 5 seconds to allow bot to fully initialize
      }
    } catch (error) {
      console.error('❌ Error initializing bot:', error);
      console.error('Error stack:', error.stack);
      addLogEntry(`Error initializing: ${error.message}`, 'error');
    }
  }

  /**
   * Check whether we should send a rejection notification for this symbol/reason today.
   * Prevents multiple identical messages (e.g., RSI rule rejection) in the same day.
   * @param {string} symbol
   * @param {string} reasonType - e.g. 'rules', 'backtest'
   * @returns {boolean} true if notification should be sent
   */
  shouldNotifyRejection(symbol, reasonType) {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const key = `${symbol}:${reasonType}:${today}`;

    if (this.rejectionNotificationCache[key]) {
      // Already notified today for this symbol + reason
      return false;
    }

    this.rejectionNotificationCache[key] = Date.now();
    return true;
  }

  async applyPartialTakeProfits(trade, currentPrice) {
    const rules = this.tradeAutomationRules?.partialTakeProfit;
    if (!rules || !rules.enabled || trade.status !== 'OPEN') {
      return;
    }

    const pnlPercent = trade.pnlPercent || 0;
    const steps = rules.steps || [];
    if (!trade.partialTakeProfits) {
      trade.partialTakeProfits = [];
    }

    for (const step of steps) {
      const trigger = step.triggerPercent;
      const takePercent = step.takePercent || 0;
      if (!trigger || !takePercent) continue;

      const alreadyExecuted = trade.partialTakeProfits.some(
        (p) => p.triggerPercent === trigger
      );
      if (alreadyExecuted) continue;

      if (pnlPercent >= trigger) {
        const quantity = trade.quantity || 0;
        if (quantity <= 0) {
          continue;
        }
        const portion = takePercent / 100;
        const qtyToClose = quantity * portion;
        if (qtyToClose <= 0) continue;

        const avgEntry = trade.averageEntryPrice || trade.entryPrice;
        let realized = 0;
        if (trade.action === 'BUY') {
          realized = (currentPrice - avgEntry) * qtyToClose;
        } else {
          realized = (avgEntry - currentPrice) * qtyToClose;
        }

        trade.quantity = quantity - qtyToClose;
        if (trade.quantity < 0) {
          trade.quantity = 0;
        }
        trade.realizedPnl = (trade.realizedPnl || 0) + realized;
        trade.partialTakeProfits.push({
          triggerPercent: trigger,
          takePercent,
          qty: qtyToClose,
          realized,
          price: currentPrice,
          executedAt: new Date()
        });

        // Calculate P&L percentage for the partial closure
        const partialPnlPercent = trade.action === 'BUY' 
          ? ((currentPrice - avgEntry) / avgEntry) * 100
          : ((avgEntry - currentPrice) / avgEntry) * 100;

        // Create a closed trade entry for the partial closure
        const partialClosedTrade = {
          ...trade,
          id: `${trade.id || trade.tradeId || 'unknown'}_partial_${Date.now()}`,
          tradeId: `${trade.id || trade.tradeId || 'unknown'}_partial_${Date.now()}`,
          status: 'PARTIAL_TP',
          closedAt: new Date(),
          closePrice: currentPrice,
          closeReason: `Partial Take Profit (${takePercent}% at ${pnlPercent.toFixed(2)}% profit)`,
          finalPnl: realized,
          finalPnlPercent: partialPnlPercent,
          executionPrice: currentPrice,
          quantity: qtyToClose, // Only the closed portion
          originalQuantity: quantity, // Original quantity before partial close
          partialPercent: takePercent,
          triggerPercent: trigger,
          remainingQuantity: trade.quantity, // Remaining quantity after partial close
          parentTradeId: trade.id || trade.tradeId
        };

        // Add to closed trades
        if (!this.closedTrades) {
          this.closedTrades = [];
        }
        
        // Check for duplicates (same partial TP trigger)
        const duplicateCheck = this.closedTrades.find(ct => 
          ct.parentTradeId === (trade.id || trade.tradeId) &&
          ct.triggerPercent === trigger &&
          ct.status === 'PARTIAL_TP'
        );
        
        if (!duplicateCheck) {
          this.closedTrades.push(partialClosedTrade);
          
          // Keep only last 100 closed trades in memory
          if (this.closedTrades.length > 100) {
            this.closedTrades = this.closedTrades.slice(-100);
          }
          
          // Save closed trades to DynamoDB
          await this.saveClosedTrades();
          
          // Update portfolio with partial closure
          const { closeTrade } = require('../services/portfolioService');
          await closeTrade(
            trade.symbol,
            realized,
            partialPnlPercent,
            avgEntry,
            currentPrice,
            qtyToClose
          );
          
          console.log(`✅ Created partial closed trade entry for ${trade.symbol}: ${takePercent}% (${qtyToClose.toFixed(4)} ${trade.symbol}) at $${currentPrice.toFixed(2)}`);
        }

        addLogEntry(
          `✂️ ${trade.symbol}: Partial TP (${takePercent}%) executed at ${pnlPercent.toFixed(
            2
          )}% profit (realized $${realized.toFixed(2)})`,
          'info'
        );

        await saveTrades(this.activeTrades);
        await sendTelegramMessage(
          `✂️ Partial Take-Profit\n\n${trade.symbol} locked in ${takePercent}% of the position at $${currentPrice.toFixed(
            2
          )}\nRealized P&L: $${realized.toFixed(2)} (${pnlPercent.toFixed(
            2
          )}%)`
        ).catch(() => {});

        if (rules.lockStopToEntry) {
          const avg = trade.averageEntryPrice || trade.entryPrice;
          if (trade.action === 'BUY' && trade.stopLoss < avg) {
            trade.stopLoss = avg;
            addLogEntry(
              `🔒 ${trade.symbol}: Stop loss moved to breakeven after partial TP`,
              'info'
            );
          } else if (trade.action === 'SELL' && trade.stopLoss > avg) {
            trade.stopLoss = avg;
            addLogEntry(
              `🔒 ${trade.symbol}: Stop loss moved to breakeven after partial TP (short)`,
              'info'
            );
          }
        }
      }
    }
  }

  recordTradeOutcome(trade, outcome) {
    this.tradeInsights = this.tradeInsights || [];
    const entryTime = new Date(trade.entryTime || trade.openedAt || Date.now());
    const exitTime = new Date();
    const durationHours = (exitTime - entryTime) / (1000 * 60 * 60);
    this.tradeInsights.unshift({
      symbol: trade.symbol,
      outcome,
      pnlPercent: trade.pnlPercent,
      realizedPnl: trade.realizedPnl || trade.pnl || 0,
      dcaCount: trade.dcaCount || 0,
      durationHours: Number(durationHours.toFixed(2)),
      closedAt: exitTime
    });
    if (this.tradeInsights.length > 100) {
      this.tradeInsights.pop();
    }
  }

  passesMultiTimeframeConsensus(analysis) {
    const consensusRules = this.tradingRules.multiTimeframeConsensus;
    if (!consensusRules || !consensusRules.enabled) {
      return { passed: true };
    }

    const timeframes = consensusRules.timeframes || ['4h', '1d', '1w'];
    
    // Use minTimeframeAlignment from patterns if available (respects user's trading rules setting)
    // This allows users to set "one timeframe alignment" (minTimeframeAlignment: 1)
    // Otherwise fall back to requiredMatches from multiTimeframeConsensus
    let requiredMatches;
    if (analysis.action === 'BUY' && this.tradingRules.patterns.buy.minTimeframeAlignment !== undefined) {
      requiredMatches = this.tradingRules.patterns.buy.minTimeframeAlignment;
      console.log(`🔍 [BUY] Using minTimeframeAlignment from trading rules: ${requiredMatches}`);
    } else if (analysis.action === 'SELL' && this.tradingRules.patterns.sell.minTimeframeAlignment !== undefined) {
      requiredMatches = this.tradingRules.patterns.sell.minTimeframeAlignment;
      console.log(`🔍 [SELL] Using minTimeframeAlignment from trading rules: ${requiredMatches}`);
    } else {
      requiredMatches = consensusRules.requiredMatches || timeframes.length;
      console.log(`🔍 Using requiredMatches from multiTimeframeConsensus: ${requiredMatches}`);
    }
    
    const frames =
      analysis.frames ||
      analysis.indicators?.frames ||
      {};

    let matches = 0;
    const timeframeDetails = [];
    timeframes.forEach((tf) => {
      const frame = frames[tf];
      if (!frame || !frame.trend) {
        timeframeDetails.push({ timeframe: tf, trend: 'N/A', matched: false });
        return;
      }
      const trend = (frame.trend || '').toUpperCase();
      let matched = false;
      if (analysis.action === 'BUY' && trend === 'BULLISH') {
        matches += 1;
        matched = true;
      } else if (analysis.action === 'SELL' && trend === 'BEARISH') {
        matches += 1;
        matched = true;
      }
      timeframeDetails.push({ timeframe: tf, trend, matched });
    });

    const passed = matches >= requiredMatches;
    return {
      passed,
      matches,
      required: requiredMatches,
      timeframes: timeframeDetails
    };
  }

  setAutoScanInterval(key) {
    if (!config.SCAN_INTERVAL_OPTIONS[key]) {
      throw new Error(`Unsupported interval: ${key}`);
    }
    this.selectedIntervalKey = key;
    this.scanIntervalMs = config.SCAN_INTERVAL_OPTIONS[key];
    if (this.isRunning) {
      if (this.scanTimer) {
        clearTimeout(this.scanTimer);
        this.scanTimer = null;
      }
      this.scheduleNextScan();
    }
  }

  getScanProgress() {
    return { ...this.scanProgress, interval: this.selectedIntervalKey };
  }

  // Limit price cache size to prevent memory leaks
  _limitPriceCache() {
    if (this.priceCache.size > this.priceCacheMaxSize) {
      const entries = Array.from(this.priceCache.entries());
      entries.sort((a, b) => (a[1].timestamp || 0) - (b[1].timestamp || 0));
      const toRemove = entries.slice(0, this.priceCache.size - this.priceCacheMaxSize);
      toRemove.forEach(([key]) => this.priceCache.delete(key));
      console.log(`🧹 Cleaned price cache: ${toRemove.length} old entries removed`);
    }
  }

  // Limit news cache size to prevent memory leaks
  _limitNewsCache() {
    if (this.newsCache.size > this.newsCacheMaxSize) {
      const entries = Array.from(this.newsCache.entries());
      entries.sort((a, b) => (a[1].timestamp || 0) - (b[1].timestamp || 0));
      const toRemove = entries.slice(0, this.newsCache.size - this.newsCacheMaxSize);
      toRemove.forEach(([key]) => this.newsCache.delete(key));
      console.log(`🧹 Cleaned news cache: ${toRemove.length} old entries removed`);
    }
  }

  async ensureGreedFearIndex() {
    return await ensureGreedFearIndex(this.greedFearIndex);
  }

  async fetchGlobalMetrics() {
    const result = await fetchGlobalMetricsService(
      this.globalMetrics, 
      this.stats,
      config.COINMARKETCAP_ENABLED,
      config.COINMARKETCAP_API_KEY
    );
    this.globalMetrics = result;
    return result;
  }

  computeFrameScore(frameData) {
    if (!frameData) return 0;
    let score = 0;
    const rsi = Number(frameData.rsi);
    if (!Number.isNaN(rsi)) {
      if (rsi < 30) score += 1.5;
      else if (rsi < 45) score += 0.5;
      else if (rsi > 70) score -= 1.5;
      else if (rsi > 55) score -= 0.5;
    }
    if (frameData.trend === 'BULLISH') score += 1;
    else if (frameData.trend === 'BEARISH') score -= 1;
    if (frameData.momentum === 'STRONG_UP') score += 1;
    else if (frameData.momentum === 'UP') score += 0.5;
    else if (frameData.momentum === 'STRONG_DOWN') score -= 1;
    else if (frameData.momentum === 'DOWN') score -= 0.5;
    return score;
  }

  buildHeatmapEntry(coin, frames) {
    const frameSummaries = {};
    let totalScore = 0;
    let counted = 0;
    Object.entries(frames).forEach(([key, data]) => {
      const frameData = {
        rsi: data.rsi,
        trend: data.trend,
        momentum: data.momentum,
        bollinger: data.bollingerPosition,
        score: this.computeFrameScore(data),
      };
      frameSummaries[key] = frameData;
      if (frameData.score !== 0) {
        totalScore += frameData.score;
        counted += 1;
      }
    });
    return {
      symbol: coin.symbol,
      name: coin.name,
      frames: frameSummaries,
      overallScore: counted ? (totalScore / counted) : 0,
    };
  }

  aggregateSeries(data = [], chunkSize = 1, maxPoints = 120) {
    if (!Array.isArray(data) || data.length === 0) return [];
    const cleaned = data
      .filter((item) => item && typeof item.price === 'number' && Number.isFinite(item.price))
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    if (chunkSize <= 1) {
      return cleaned.slice(-maxPoints);
    }
    const aggregated = [];
    for (let i = chunkSize - 1; i < cleaned.length; i += chunkSize) {
      const slice = cleaned.slice(i - chunkSize + 1, i + 1);
      const avg =
        slice.reduce((sum, point) => sum + point.price, 0) / slice.length;
      aggregated.push({
        timestamp: cleaned[i].timestamp,
        price: avg,
      });
    }
    return aggregated.slice(-maxPoints);
  }

  prepareTimeframeSeries(minuteData, hourlyData, dailyData) {
    return {
      '10m': this.aggregateSeries(minuteData, 10, 120),
      '1h': this.aggregateSeries(hourlyData, 1, 168),
      '4h': this.aggregateSeries(hourlyData, 4, 84),
      '1d': this.aggregateSeries(dailyData, 1, 90),
      '1w': this.aggregateSeries(dailyData, 7, 52),
    };
  }

  scheduleNextScan() {
    if (!this.isRunning) return;
    const delay = Math.max(this.scanIntervalMs - this.stats.lastScanDuration, 5000);
    
    // Store the actual scheduled time (prevents reset on page refresh)
    this.nextScanTime = new Date(Date.now() + delay);
    
    this.scanTimer = setTimeout(async () => {
      if (this.scanInProgress) {
        console.log('⏳ Previous scan still running, skipping scheduled scan');
        this.stats.skippedDueToOverlap += 1;
        this.scheduleNextScan();
        return;
      }
      await this.performTechnicalScan();
      this.scheduleNextScan();
    }, delay);
  }

  async startAutoScan() {
    if (this.isRunning) {
      console.log('🔄 Auto-scan already running');
      return { status: 'already_running' };
    }

    this.isRunning = true;
    console.log('🚀 Starting automated technical analysis scan');

    await this.performTechnicalScan();
    this.scheduleNextScan();

    return {
      status: 'started',
      interval: this.selectedIntervalKey,
      coins: this.trackedCoins.length,
      time: new Date(),
    };
  }

  stopAutoScan() {
    this.isRunning = false;
    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
    this.nextScanTime = null; // Clear next scan time when stopped
    console.log('🛑 Auto-scan stopped');
    return { status: 'stopped', time: new Date() };
  }

  // Start separate timer for active trades updates (every 1 minute)
  // This runs COMPLETELY INDEPENDENTLY of the scanner - starts when bot initializes
  startTradesUpdateTimer() {
    // Prevent duplicate timers - guard against multiple calls
    if (this.tradesUpdateTimer) {
      console.log('⏰ Trades update timer already running, skipping duplicate initialization');
      return;
    }
    
    // Initialize rebalancing variables if not already set
    if (this.rebalancingTimer === undefined) {
      this.rebalancingTimer = null;
      this.rebalancingEnabled = false;
      this.targetAllocation = {};
      this.rebalancingDeviationThreshold = 5;
    }
    
    // Flag to prevent concurrent updates
    this.isUpdatingTrades = false;

    // Update immediately on start
    this.updateActiveTrades().catch(err => {
      console.log(`⚠️ Initial trades update failed: ${err.message}`);
    });

    // Then update every 1 minute - runs independently of scans
    this.tradesUpdateTimer = setInterval(async () => {
      // Prevent concurrent updates
      if (this.isUpdatingTrades) {
        console.log('⏭️ Skipping trade update - previous update still in progress');
        return;
      }
      
      if (this.activeTrades.length > 0) {
        this.isUpdatingTrades = true;
        try {
          await this.updateActiveTrades();
        } finally {
          this.isUpdatingTrades = false;
        }
      }
    }, 60000); // 1 minute

    console.log('⏰ Active trades update timer started (1min interval, independent of scans)');
  }

  // Stop the trades update timer (manual stop only - not called automatically)
  stopTradesUpdateTimer() {
    if (this.tradesUpdateTimer) {
      clearInterval(this.tradesUpdateTimer);
      this.tradesUpdateTimer = null;
      console.log('⏰ Active trades update timer stopped');
    }
  }

  // Start two-tier AI monitoring timer (every 1 minute)
  // This uses free v3 model to continuously monitor for opportunities
  // Escalates to premium R1 model when high-confidence opportunities detected
  startMonitoringTimer() {
    if (!config.MONITORING_ENABLED) {
      console.log('🔇 Two-tier AI monitoring disabled in config');
      return;
    }

    if (this.monitoringTimer) {
      console.log('👀 Monitoring timer already running, skipping duplicate initialization');
      return;
    }

    // Check for monitoring API key (supports hybrid mode with separate keys)
    if (!config.MONITORING_API_KEY) {
      console.log('⚠️ No monitoring API key configured - monitoring disabled');
      console.log('   Set FREE_TIER_API_KEY (recommended) or OPENROUTER_API_KEY (legacy)');
      return;
    }

    console.log('🤖 Starting Two-Tier AI Monitoring System');
    console.log(`   Mode: ${config.USE_HYBRID_MODE ? 'HYBRID 🔥' : 'Single API'}`);
    console.log(`   Free Model: ${config.MONITORING_MODEL} (${config.MONITORING_API_TYPE.toUpperCase()})`);
    console.log(`   Premium Model: ${config.AI_MODEL} (${config.PREMIUM_API_TYPE.toUpperCase()})`);
    console.log(`   Schedule: 9:00 AM, 9:00 PM, and on startup`);
    console.log(`   Escalation Threshold: ${(config.ESCALATION_THRESHOLD * 100).toFixed(0)}%`);

    // Flag to prevent concurrent monitoring
    this.isMonitoring = false;

    // Calculate next 9 AM and 9 PM times
    const scheduleNextRun = () => {
      const now = new Date();
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();
      
      // Target times: 9:00 AM (9:00) and 9:00 PM (21:00)
      let nextRun = new Date();
      
      if (currentHour < 9 || (currentHour === 9 && currentMinute < 0)) {
        // Before 9 AM today - schedule for 9 AM today
        nextRun.setHours(9, 0, 0, 0);
      } else if (currentHour < 21 || (currentHour === 21 && currentMinute < 0)) {
        // Before 9 PM today - schedule for 9 PM today
        nextRun.setHours(21, 0, 0, 0);
      } else {
        // After 9 PM - schedule for 9 AM tomorrow
        nextRun.setDate(nextRun.getDate() + 1);
        nextRun.setHours(9, 0, 0, 0);
      }
      
      const msUntilNext = nextRun.getTime() - now.getTime();
      const hoursUntil = (msUntilNext / (1000 * 60 * 60)).toFixed(1);
      
      console.log(`   Next scan scheduled: ${nextRun.toLocaleString()} (in ${hoursUntil} hours)`);
      
      // Clear any existing timer
      if (this.monitoringTimer) {
        clearTimeout(this.monitoringTimer);
      }
      
      // Schedule next run
      this.monitoringTimer = setTimeout(async () => {
        if (this.isMonitoring) {
          console.log('⏭️ Skipping monitoring - previous check still in progress');
          scheduleNextRun(); // Reschedule
          return;
        }

        this.isMonitoring = true;
        try {
          console.log(`\n🕐 Scheduled bulk scan started at ${new Date().toLocaleString()}`);
          await this.runMonitoringCycle();
        } catch (error) {
          console.log(`⚠️ Monitoring error: ${error.message}`);
        } finally {
          this.isMonitoring = false;
          scheduleNextRun(); // Schedule next run after completion
        }
      }, msUntilNext);
    };

    // Run initial scan on startup (delayed to allow server to respond to health checks first)
    console.log('🚀 Initial bulk scan will start in 10 seconds...');
    setTimeout(() => {
      console.log('🚀 Running initial bulk scan...');
    (async () => {
      if (this.isMonitoring) {
        console.log('⏭️ Skipping initial scan - already in progress');
        return;
      }
      this.isMonitoring = true;
      try {
        await this.runMonitoringCycle();
      } catch (error) {
        console.log(`⚠️ Monitoring error: ${error.message}`);
      } finally {
        this.isMonitoring = false;
      }
    })();
    }, 10000); // Delay 10 seconds to allow server to be fully ready

    // Schedule future runs (9 AM and 9 PM)
    scheduleNextRun();

    console.log('👀 Scheduled bulk scan monitoring started!');
  }

  stopMonitoringTimer() {
    if (this.monitoringTimer) {
      clearTimeout(this.monitoringTimer); // Changed from clearInterval to clearTimeout
      this.monitoringTimer = null;
      console.log('🛑 Monitoring timer stopped');
    }
  }

  async runMonitoringCycle() {
    try {
      // Ensure trades array exists
      if (!this.trades || !Array.isArray(this.trades)) {
        this.trades = [];
      }

      // Array to collect all coins that need escalation
      const escalations = [];

      // PRIORITY 1: Batch monitor active/open trades (one API call for all)
      const activeTradeSymbols = this.trades
        .filter(t => t && t.status === 'OPEN')
        .map(t => t.symbol);
      
      if (activeTradeSymbols.length > 0) {
        console.log(`🔴 Batch monitoring ${activeTradeSymbols.length} open trades in one API call...`);
        
        // Gather price data for all open trades first
        const openTradeCoinsData = [];
        for (const symbol of activeTradeSymbols) {
          const coin = this.trackedCoins.find(c => c.symbol === symbol);
          if (!coin) continue;
          
          try {
            const coinDataForFetch = { symbol: coin.symbol, id: coin.id };
            
            if (!config) {
              console.log(`⚠️ Config not available, skipping ${coin.symbol}`);
              continue;
            }
            if (!this.priceCache) {
              this.priceCache = new Map();
            }
            if (!this.stats) {
              this.stats = { coinmarketcapUsage: 0, coinpaprikaUsage: 0 };
            }
            
            const priceResult = await fetchEnhancedPriceData(coinDataForFetch, this.priceCache, this.stats, config);
            
            if (!priceResult || !priceResult.data || !priceResult.data.price) {
              console.log(`⚠️ ${coin.symbol}: No price data available, skipping`);
              continue;
            }

            // Extract price data
            const priceData = priceResult.data;
            const lastPrice = monitoringService.lastPrices.get(coin.symbol);
            const coinData = {
              symbol: coin.symbol,
              name: coin.name,
              id: coin.id,
              currentPrice: priceData.price,
              priceChange24h: priceData.change_24h || priceData.priceChange24h || 0,
              volume24h: priceData.volume_24h || priceData.volume24h || 0,
            };
            
            // Debug: trace volume fed into monitoring for BCH to investigate "0 volume" rejections
            if (coin.symbol === 'BCH') {
              console.log('[Monitoring Input Debug] BCH coinData:', JSON.stringify(coinData));
            }
            
            // Track price changes
            if (lastPrice) {
              const priceChange = ((coinData.currentPrice - lastPrice) / lastPrice) * 100;
              coinData.minutePriceChange = priceChange;
            }
            monitoringService.lastPrices.set(coin.symbol, coinData.currentPrice);
            
            openTradeCoinsData.push(coinData);
          } catch (error) {
            console.log(`⚠️ Error fetching data for ${coin.symbol}:`, error.message);
          }
        }
        
        // Batch monitor all open trades in one API call
        if (openTradeCoinsData.length > 0) {
          const batchResults = await monitoringService.batchVolatilityCheck(openTradeCoinsData);
          
          // Process batch results and collect escalations
          for (const batchResult of batchResults) {
            const coinData = openTradeCoinsData.find(c => c.symbol === batchResult.symbol);
            if (!coinData) continue;
            
            const analysis = batchResult.analysis;
            if (!analysis) {
              console.log(`🔴 [OPEN TRADE] ${batchResult.symbol}: No analysis returned`);
              continue;
            }
            
            // Log monitoring activity
            try {
              const { addMonitoringActivity, setMonitoringActive } = require('../services/monitoringStore');
              setMonitoringActive(true);
              const priceChangePercent = Math.abs(coinData.priceChange24h || 0);
              const volatilityLevel = monitoringService.calculateVolatilityLevel(priceChangePercent);
              const activityData = {
                symbol: coinData.symbol,
                volatility: volatilityLevel,
                priceChange: priceChangePercent.toFixed(2),
                confidence: analysis.confidence || 0,
                escalated: false
              };
              addMonitoringActivity(activityData);
            } catch (err) {
              console.log(`⚠️ Failed to log monitoring activity for ${coinData.symbol}: ${err.message}`);
            }
            
            // Check if escalation is needed - collect for batch escalation
            if (analysis.shouldEscalate && analysis.confidence >= monitoringService.ESCALATION_THRESHOLD) {
              // Check if already in escalation queue (deduplication)
              const alreadyQueued = escalations.some(e => e.coinData.symbol === coinData.symbol);
              if (!alreadyQueued) {
                escalations.push({ coinData, v3Analysis: analysis, isPriority: true });
                console.log(`🔴 [OPEN TRADE] ${coinData.symbol}: ${analysis.signal} (${(analysis.confidence * 100).toFixed(0)}%) - Will escalate to premium`);
              } else {
                console.log(`🔴 [OPEN TRADE] ${coinData.symbol}: ${analysis.signal} (${(analysis.confidence * 100).toFixed(0)}%) - Already queued for escalation`);
              }
            } else {
              console.log(`🔴 [OPEN TRADE] ${coinData.symbol}: ${analysis.signal} (${(analysis.confidence * 100).toFixed(0)}%)`);
            }
          }
        }
      }
      
      // PRIORITY 2: Bulk scan top 200 coins using TAAPI.IO (fast, all indicators)
      console.log(`🚀 Bulk scanning top 25 coins for oversold opportunities...`);
      
      // Use bulk indicator service to scan top 25 coins (reduced to avoid rate limits)
      // Pass all trigger settings from UI (automatically uses latest saved settings)
      const bulkScanResults = await monitoringService.bulkScanTop200Coins({
        maxCoins: 25 // Reduced from 200 to avoid CoinGecko rate limits
        // All other settings (rsiThreshold, minTriggers, enableBollinger, etc.) 
        // are automatically read from monitoringService.triggerSettings
      });
      
      if (bulkScanResults.length > 0) {
        console.log(`✅ Found ${bulkScanResults.length} oversold coins from bulk scan`);
        
        // Process bulk scan results and collect escalations
        for (const bulkResult of bulkScanResults) {
          // Skip if this coin is already in an open trade (handled in PRIORITY 1)
          if (activeTradeSymbols.includes(bulkResult.symbol)) {
            continue;
          }
          
          // Convert to coinData format for escalation
          const coinData = {
            symbol: bulkResult.symbol,
            name: bulkResult.name,
            id: bulkResult.symbol.toLowerCase(),
            currentPrice: bulkResult.price,
            priceChange24h: bulkResult.priceChange24h || 0,
            volume24h: bulkResult.volume24h || bulkResult.marketCap || 0, // Use volume from bulk scan
            rank: bulkResult.rank
          };
          
          // Debug: Log volume for troubleshooting
          if (coinData.symbol === 'DOGE' || coinData.symbol === 'BCH') {
            console.log(`[Bulk Scan Volume Debug] ${coinData.symbol}: volume24h=${coinData.volume24h}, marketCap=${bulkResult.marketCap}`);
          }
          
          // Track price
          monitoringService.lastPrices.set(coinData.symbol, coinData.currentPrice);
          
          const analysis = bulkResult.analysis;
          if (!analysis) {
            continue;
          }
          
          // Log monitoring activity
          try {
            const { addMonitoringActivity, setMonitoringActive } = require('../services/monitoringStore');
            setMonitoringActive(true);
            const priceChangePercent = Math.abs(coinData.priceChange24h || 0);
            const volatilityLevel = monitoringService.calculateVolatilityLevel(priceChangePercent);
            const activityData = {
              symbol: coinData.symbol,
              volatility: volatilityLevel,
              priceChange: priceChangePercent.toFixed(2),
              confidence: analysis.confidence || 0,
              escalated: false
            };
            addMonitoringActivity(activityData);
          } catch (err) {
            console.log(`⚠️ Failed to log monitoring activity for ${coinData.symbol}: ${err.message}`);
          }
          
          // Check if escalation is needed
          if (analysis.confidence >= monitoringService.ESCALATION_THRESHOLD) {
            const alreadyQueued = escalations.some(e => e.coinData.symbol === coinData.symbol);
            if (!alreadyQueued) {
              const v3Analysis = {
                signal: analysis.recommendation,
                confidence: analysis.confidence,
                reason: analysis.reason,
                shouldEscalate: true
              };
              escalations.push({ coinData, v3Analysis, isPriority: false });
              console.log(`🔍 ${coinData.symbol} (Rank #${bulkResult.rank}): ${analysis.recommendation} (${(analysis.confidence * 100).toFixed(0)}%) - ${bulkResult.triggerCount} triggers - Will escalate to premium`);
            }
          } else {
            console.log(`🔍 ${coinData.symbol} (Rank #${bulkResult.rank}): ${analysis.recommendation} (${(analysis.confidence * 100).toFixed(0)}%) - ${bulkResult.triggerCount} triggers`);
          }
        }
      }

      // STEP 3: Batch escalate all coins that need escalation in ONE premium API call
      if (escalations.length > 0) {
        console.log(`\n🚨 Batch escalating ${escalations.length} coins to Premium AI in one API call...`);
        
        const batchEscalationResults = await monitoringService.batchEscalateToR1(escalations);
        
        // Process batch escalation results
        for (const result of batchEscalationResults) {
          const { symbol, coinData, v3Analysis, r1Decision } = result;
          const priorityLabel = escalations.find(e => e.coinData.symbol === symbol)?.isPriority ? '🔴 [OPEN TRADE]' : '🔍';
          
          // Safety check for r1Decision
          if (!r1Decision) {
            console.log(`⚠️ ${symbol} - No r1Decision in result, skipping`);
            continue;
          }
          
          if (r1Decision.decision === 'CONFIRMED') {
            console.log(`${priorityLabel} ✅ R1 CONFIRMED opportunity for ${symbol}!`);
            console.log(`   Action: ${r1Decision.action}, Confidence: ${(r1Decision.confidence * 100).toFixed(0)}%`);
            console.log(`   Stop Loss: ${r1Decision.stopLoss}%, Take Profit: ${r1Decision.takeProfit}%`);
            console.log(`   Reason: ${r1Decision.reason?.substring(0, 150) || 'No reason provided'}...`);
            
            // Execute trade (will check for existing trades and handle accordingly)
            try {
              // Check for existing trade and handle it
              const handled = await this.handleExistingTrade(
                symbol, 
                r1Decision.action, 
                coinData.currentPrice, 
                r1Decision.stopLoss, 
                r1Decision.takeProfit, 
                r1Decision.confidence, 
                r1Decision.reason
              );
              
              if (!handled) {
                // No existing trade - create new trade
                await this.addActiveTrade({
                  symbol,
                  name: symbol,
                  id: symbol.toLowerCase(),
                  action: r1Decision.action,
                  price: coinData.currentPrice,
                  entryPrice: coinData.currentPrice,
                  takeProfit: coinData.currentPrice * (1 + (r1Decision.takeProfit || 0) / 100),
                  stopLoss: coinData.currentPrice * (1 - (r1Decision.stopLoss || 0) / 100),
                  expectedGainPercent: typeof r1Decision.takeProfit === 'number' ? r1Decision.takeProfit : 5,
                  reason: r1Decision.reason,
                  insights: [],
                  dataSource: 'monitoring'
                });
                console.log(`${priorityLabel} ✅ New trade executed successfully for ${symbol}`);
              } else {
                console.log(`${priorityLabel} ✅ Trade handled for ${symbol} (existing position managed)`);
              }
            } catch (error) {
              if (error.message === 'Trading is disabled' || error.message.includes('Trading not enabled')) {
                console.log(`${priorityLabel} ⚠️ Bybit trading disabled - trade not executed for ${symbol}`);
              } else {
                console.log(`${priorityLabel} ⚠️ Failed to execute trade for ${symbol}: ${error.message}`);
              }
            }
          } else if (r1Decision.decision === 'SKIPPED') {
            console.log(`⏭️ ${symbol} - Skipped: ${r1Decision.reason || 'On cooldown or recently rejected'}`);
          } else if (r1Decision.decision === 'ERROR') {
            console.log(`${priorityLabel} ❌ Premium AI error for ${symbol}: ${r1Decision.reason}`);
          } else {
            console.log(`${priorityLabel} ❌ R1 rejected ${symbol}: ${r1Decision.reason?.substring(0, 100) || 'No reason provided'}`);
          }
        }
        
        // Send Telegram notifications (one per coin with both free and premium insights)
        await monitoringService.notifyR1DecisionBatch(batchEscalationResults);
      } else {
        console.log('✅ No coins need escalation to premium AI');
      }

      console.log('✅ Monitoring cycle complete');

    } catch (error) {
      console.log('⚠️ Monitoring cycle error:', error.message);
      console.log('   Error stack:', error.stack?.substring(0, 300));
    }
  }

  /**
   * Monitor a single coin
   */
  async monitorSingleCoin(coin, isPriority = false) {
    try {
      const priorityLabel = isPriority ? '🔴 [OPEN TRADE]' : '🔍';
      
      console.log(`${priorityLabel} Monitoring ${coin.symbol}...`);
      
      // Fetch current price data (need to pass coin object, cache, stats, and config)
      const coinDataForFetch = { symbol: coin.symbol, id: coin.id };
      
      // Ensure all required parameters are available
      if (!config) {
        console.log(`⚠️ Config not available, skipping ${coin.symbol}`);
        return;
      }
      if (!this.priceCache) {
        this.priceCache = new Map();
      }
      if (!this.stats) {
        this.stats = { coinmarketcapUsage: 0, coinpaprikaUsage: 0 };
      }
      
      const priceResult = await fetchEnhancedPriceData(coinDataForFetch, this.priceCache, this.stats, config);
      
      if (!priceResult || !priceResult.data || !priceResult.data.price) {
        console.log(`⚠️ ${coin.symbol}: No price data available, skipping`);
        return;
      }

      // Extract price data from result
      const priceData = priceResult.data;
      const coinData = {
        symbol: coin.symbol,
        name: coin.name,
        id: coin.id,
        currentPrice: priceData.price,
        priceChange24h: priceData.change_24h || priceData.priceChange24h || 0,
        volume24h: priceData.volume_24h || priceData.volume24h || 0,
      };

      // Monitor with v3
      console.log(`${priorityLabel} Calling monitoring service for ${coin.symbol} at $${coinData.currentPrice}...`);
      const result = await monitoringService.monitorCoin(coinData);
      console.log(`${priorityLabel} Monitoring service result for ${coin.symbol}:`, result ? 'received' : 'null');

      // Log monitoring activity to web UI using shared store
      if (result && result.v3Analysis) {
        try {
          // Use the shared monitoring store (same instance as API endpoint)
          const { addMonitoringActivity, setMonitoringActive } = require('../services/monitoringStore');
          setMonitoringActive(true);
          const activityData = {
            symbol: coin.symbol,
            volatility: result.v3Analysis.volatilityLevel || 'low',
            priceChange: (result.v3Analysis.priceChangePercent || 0).toFixed(2),
            confidence: result.v3Analysis.confidence || 0,
            escalated: !!result.r1Decision
          };
          console.log(`📊 Attempting to add monitoring activity:`, activityData);
          addMonitoringActivity(activityData);
          console.log(`✅ Monitoring activity added for ${coin.symbol}`);
        } catch (err) {
          console.log(`⚠️ Failed to log monitoring activity: ${err.message}`);
        }
      }

      if (result && result.r1Decision) {
        // R1 was triggered and made a decision
        if (result.r1Decision.decision === 'CONFIRMED') {
          console.log(`${priorityLabel} ✅ R1 CONFIRMED opportunity for ${coin.symbol}!`);
          
          // Execute trade if Bybit trading is enabled
          if (this.tradingRules.bybitTradingEnabled) {
            // Check for existing trade and handle it
            const handled = await this.handleExistingTrade(
              coin.symbol,
              result.r1Decision.action,
              coinData.currentPrice,
              result.r1Decision.stopLoss,
              result.r1Decision.takeProfit,
              result.r1Decision.confidence,
              result.r1Decision.reason
            );
            
            if (!handled) {
              // No existing trade - create new trade
              await this.addActiveTrade({
                symbol: coin.symbol,
                name: coin.symbol,
                id: coin.symbol.toLowerCase(),
                action: result.r1Decision.action,
                price: coinData.currentPrice,
                entryPrice: coinData.currentPrice,
                takeProfit: coinData.currentPrice * (1 + (result.r1Decision.takeProfit || 0) / 100),
                stopLoss: coinData.currentPrice * (1 - (result.r1Decision.stopLoss || 0) / 100),
                expectedGainPercent: typeof result.r1Decision.takeProfit === 'number' ? result.r1Decision.takeProfit : 5,
                reason: result.r1Decision.reason,
                insights: [],
                dataSource: 'monitoring'
              });
            }
          }
        } else if (result.r1Decision.decision === 'SKIPPED') {
          console.log(`⏭️ ${coin.symbol} - Recently rejected, skipped escalation (saves cost)`);
        } else {
          console.log(`${priorityLabel} ❌ R1 rejected ${coin.symbol}`);
        }
      } else if (result && result.v3Analysis) {
        // v3 analyzed but didn't escalate
        console.log(`${priorityLabel} ${coin.symbol}: ${result.v3Analysis.signal} (${(result.v3Analysis.confidence * 100).toFixed(0)}%)`);
      }

    } catch (error) {
      console.log(`⚠️ Error monitoring ${coin.symbol}:`, error.message);
    }
  }

  /**
   * Handle existing trade when new signal is confirmed
   * Returns true if handled, false if should create new trade
   */
  async handleExistingTrade(symbol, newAction, newPrice, newStopLoss, newTakeProfit, newConfidence, newReason) {
    // Find existing open trade for this symbol
    // Check both activeTrades and trades arrays (trades might be used in monitoring)
    const existingTrade = (this.activeTrades || []).find(t => 
      t.symbol === symbol && (t.status === 'OPEN' || t.status === 'DCA_HIT' || t.status === 'ACTIVE')
    ) || (this.trades || []).find(t => 
      t && t.symbol === symbol && (t.status === 'OPEN' || t.status === 'DCA_HIT' || t.status === 'ACTIVE')
    );

    if (!existingTrade) {
      return false; // No existing trade, proceed with new trade
    }

    console.log(`🔍 Found existing ${existingTrade.action} trade for ${symbol}`);
    
    // Calculate current P&L
    const currentPrice = newPrice; // Use the new signal price as current price
    const entryPrice = existingTrade.averageEntryPrice || existingTrade.entryPrice;
    const pnlPercent = existingTrade.action === 'BUY' 
      ? ((currentPrice - entryPrice) / entryPrice) * 100
      : ((entryPrice - currentPrice) / entryPrice) * 100;

    console.log(`   Current P&L: ${pnlPercent.toFixed(2)}%`);
    console.log(`   Entry: $${entryPrice.toFixed(2)}, Current: $${currentPrice.toFixed(2)}`);
    console.log(`   Current TP: $${existingTrade.takeProfit.toFixed(2)}, SL: $${existingTrade.stopLoss.toFixed(2)}`);

    // Same direction - consider adding to position or adjusting TP/SL
    if (existingTrade.action === newAction) {
      console.log(`   ✅ Same direction (${newAction}) - evaluating position management...`);

      // If in profit and new signal has higher confidence, consider adjusting TP
      if (pnlPercent > 0 && newConfidence > (existingTrade.confidence || 0.5)) {
        const newTPPrice = newPrice * (1 + newTakeProfit / 100);
        const newSLPrice = newPrice * (1 - newStopLoss / 100);
        
        // Only adjust if new TP is better (higher for BUY, lower for SELL)
        const shouldAdjustTP = existingTrade.action === 'BUY' 
          ? newTPPrice > existingTrade.takeProfit
          : newTPPrice < existingTrade.takeProfit;
        
        // Only adjust SL if it's tighter (better protection)
        const shouldAdjustSL = existingTrade.action === 'BUY'
          ? newSLPrice > existingTrade.stopLoss
          : newSLPrice < existingTrade.stopLoss;

        if (shouldAdjustTP || shouldAdjustSL) {
          const oldTP = existingTrade.takeProfit;
          const oldSL = existingTrade.stopLoss;
          
          if (shouldAdjustTP) {
            existingTrade.takeProfit = newTPPrice;
            console.log(`   📈 Adjusted Take Profit: $${oldTP.toFixed(2)} → $${newTPPrice.toFixed(2)}`);
          }
          
          if (shouldAdjustSL) {
            existingTrade.stopLoss = newSLPrice;
            console.log(`   🛡️ Adjusted Stop Loss: $${oldSL.toFixed(2)} → $${newSLPrice.toFixed(2)}`);
          }

          existingTrade.reason = `${existingTrade.reason || ''} | Updated: ${newReason?.substring(0, 100)}`;
          existingTrade.confidence = Math.max(existingTrade.confidence || 0.5, newConfidence);
          
          await saveTrades(this.activeTrades);
          
          await sendTelegramMessage(`📊 Position Updated: ${symbol}

${existingTrade.action} position adjusted based on new signal
Current P&L: ${pnlPercent.toFixed(2)}%
Entry: $${entryPrice.toFixed(2)} → Current: $${currentPrice.toFixed(2)}

${shouldAdjustTP ? `Take Profit: $${oldTP.toFixed(2)} → $${newTPPrice.toFixed(2)}` : ''}
${shouldAdjustSL ? `Stop Loss: $${oldSL.toFixed(2)} → $${newSLPrice.toFixed(2)}` : ''}

New Signal Confidence: ${(newConfidence * 100).toFixed(0)}%
Reason: ${newReason?.substring(0, 200)}`);

          return true; // Handled by adjusting TP/SL
        } else {
          console.log(`   ℹ️ New signal doesn't improve TP/SL - keeping existing levels`);
          return true; // Handled (no change needed)
        }
      } else if (pnlPercent < -2 && newConfidence > 0.7) {
        // In loss but high confidence new signal - could add to position (DCA)
        console.log(`   💰 Position in loss (-${Math.abs(pnlPercent).toFixed(2)}%) but high confidence signal - could DCA`);
        // For now, just adjust SL to protect better
        const newSLPrice = newPrice * (1 - newStopLoss / 100);
        if (existingTrade.action === 'BUY' && newSLPrice > existingTrade.stopLoss) {
          existingTrade.stopLoss = newSLPrice;
          console.log(`   🛡️ Tightened Stop Loss to $${newSLPrice.toFixed(2)}`);
          await saveTrades(this.activeTrades);
          return true;
        }
        return true; // Handled
      } else {
        console.log(`   ℹ️ No action needed - position already open with similar signal`);
        return true; // Handled (no change needed)
      }
    } else {
      // Opposite direction - consider closing early if strong signal
      console.log(`   ⚠️ Opposite direction (${existingTrade.action} → ${newAction})`);
      
      if (newConfidence > 0.75 && pnlPercent > -1) {
        // Strong opposite signal and not in big loss - close early
        console.log(`   🔄 Closing position early due to strong opposite signal`);
        
        const { closeTrade } = require('../services/portfolioService');
        await closeTrade(existingTrade.id, currentPrice, 'EARLY_CLOSE', 
          `Closed due to opposite ${newAction} signal (confidence: ${(newConfidence * 100).toFixed(0)}%)`);
        
        // Remove from active trades
        this.activeTrades = this.activeTrades.filter(t => t.id !== existingTrade.id);
        await saveTrades(this.activeTrades);
        
        await sendTelegramMessage(`🔄 Position Closed Early: ${symbol}

Closed ${existingTrade.action} position due to strong opposite ${newAction} signal
Entry: $${entryPrice.toFixed(2)} → Exit: $${currentPrice.toFixed(2)}
P&L: ${pnlPercent.toFixed(2)}%

New Signal Confidence: ${(newConfidence * 100).toFixed(0)}%
Reason: ${newReason?.substring(0, 200)}`);

        return false; // Position closed, can create new trade
      } else if (pnlPercent < -3) {
        // In significant loss - keep position, don't reverse
        console.log(`   ⚠️ Position in significant loss (-${Math.abs(pnlPercent).toFixed(2)}%) - keeping position`);
        return true; // Handled (keep existing position)
      } else {
        console.log(`   ℹ️ Opposite signal not strong enough or position in loss - keeping existing position`);
        return true; // Handled (keep existing position)
      }
    }
  }


  getPortfolioValue() {
    // Simple mock for now - should integrate with actual portfolio
    return 10000; // $10k default
  }

  // Start portfolio rebalancing automation
  startRebalancingTimer() {
    if (this.rebalancingTimer) {
      console.log('⏰ Rebalancing timer already running');
      return;
    }

    if (!this.rebalancingEnabled) {
      console.log('⏰ Rebalancing is disabled');
      return;
    }

    // Check for rebalancing every 6 hours
    this.rebalancingTimer = setInterval(async () => {
      if (!this.rebalancingEnabled) return;
      
      try {
        await this.checkAndRebalance();
      } catch (error) {
        console.error('Rebalancing error:', error);
        addLogEntry(`Rebalancing error: ${error.message}`, 'error');
      }
    }, 6 * 60 * 60 * 1000); // 6 hours

    // Initial check after 1 hour
    setTimeout(() => {
      if (this.rebalancingEnabled) {
        this.checkAndRebalance();
      }
    }, 60 * 60 * 1000); // 1 hour

    console.log('⏰ Portfolio rebalancing timer started (checks every 6 hours)');
  }

  // Stop rebalancing timer
  stopRebalancingTimer() {
    if (this.rebalancingTimer) {
      clearInterval(this.rebalancingTimer);
      this.rebalancingTimer = null;
      console.log('⏰ Rebalancing timer stopped');
    }
  }

  // Check portfolio and rebalance if needed
  async checkAndRebalance() {
    if (!this.rebalancingEnabled || Object.keys(this.targetAllocation).length === 0) {
      return;
    }

    try {
      const { getRebalancingStrategy } = require('../services/rebalancingService');
      
      const strategy = getRebalancingStrategy(this.activeTrades, this.targetAllocation, {
        deviationThreshold: this.rebalancingDeviationThreshold,
        maxPositions: 10,
        minPositionSize: 50
      });

      if (!strategy.needsRebalancing) {
        addLogEntry('Portfolio is balanced - no rebalancing needed', 'info');
        return;
      }

      addLogEntry(`Portfolio rebalancing needed: ${strategy.actions.length} positions require adjustment`, 'info');
      console.log(`📊 Rebalancing: ${strategy.actions.length} positions need adjustment`);

      // Log actions (actual execution would require exchange API integration)
      strategy.actions.forEach(action => {
        addLogEntry(
          `Rebalancing: ${action.action} ${action.symbol} - Adjust by ${action.adjustmentPercent.toFixed(2)}% (${action.adjustmentAmount.toFixed(2)} USD)`,
          'info'
        );
      });

      // In production, this would execute trades via exchange service
      // For now, we just log the actions
      addLogEntry('Rebalancing actions logged (execution requires exchange API integration)', 'info');
    } catch (error) {
      console.error('Rebalancing check error:', error);
      addLogEntry(`Rebalancing check failed: ${error.message}`, 'error');
    }
  }

  // Enable/disable rebalancing
  setRebalancing(enabled, targetAllocation = {}, deviationThreshold = 5) {
    this.rebalancingEnabled = enabled;
    this.targetAllocation = targetAllocation;
    this.rebalancingDeviationThreshold = deviationThreshold;

    if (enabled) {
      this.startRebalancingTimer();
    } else {
      this.stopRebalancingTimer();
    }

    return {
      enabled: this.rebalancingEnabled,
      targetAllocation: this.targetAllocation,
      deviationThreshold: this.rebalancingDeviationThreshold
    };
  }

  // Main technical scan method
  async performTechnicalScan(options = {}) {
    if (this.scanInProgress) {
      console.log('⏳ Scan skipped; previous scan still running');
      this.stats.skippedDueToOverlap += 1;
      return {
        scanTime: new Date(),
        status: 'skipped',
        reason: 'previous_scan_in_progress',
      };
    }

    const startTime = Date.now();
    this.scanInProgress = true;
    this.scanProgress = {
      running: true,
      processed: 0,
      total: this.trackedCoins.length,
      percent: 0,
      interval: this.selectedIntervalKey,
      startedAt: new Date(),
      params: options,
    };

    try {
      // Note: Active trades are updated by the independent timer (every 1 minute)
      // No need to update here to avoid duplicate calls
      
      // Fetch global metrics in parallel (both independent operations)
      await Promise.all([
        this.ensureGreedFearIndex(),
        this.fetchGlobalMetrics()
      ]);
      
      // Detect market regime and adjust strategy
      const { detectMarketRegime } = require('../services/marketRegimeService');
      const { calculateAdaptiveThreshold } = require('../services/mlService');
      
      // Get recent closed trades for adaptive threshold
      const recentTrades = this.closedTrades?.slice(-30) || [];
      const adaptiveThreshold = calculateAdaptiveThreshold(recentTrades, this.tradingRules.minConfidence);
      
      // Update minConfidence if adaptive threshold is different
      if (Math.abs(adaptiveThreshold - this.tradingRules.minConfidence) > 0.01) {
        const oldThreshold = this.tradingRules.minConfidence;
        this.tradingRules.minConfidence = adaptiveThreshold;
        this.minConfidence = adaptiveThreshold;
        addLogEntry(`🧠 ML: Adaptive threshold adjusted from ${(oldThreshold * 100).toFixed(0)}% to ${(adaptiveThreshold * 100).toFixed(0)}%`, 'info');
      }
      
      console.log(`\n🎯 TECHNICAL SCAN STARTED: ${new Date().toLocaleString()}`);
      console.log(`🌐 Global Metrics: CoinPaprika ${this.globalMetrics.coinpaprika ? '✅' : '❌'}, CoinMarketCap ${this.globalMetrics.coinmarketcap ? '✅' : '❌'}`);
      console.log(`🧠 ML Adaptive Threshold: ${(adaptiveThreshold * 100).toFixed(0)}%`);
      
      addLogEntry('Technical scan started', 'info');
      addLogEntry(`Scanning ${this.trackedCoins.length} coins`, 'info');
      addLogEntry(`Analysis engine: JavaScript`, 'info');
      addLogEntry(`ML Adaptive Threshold: ${(adaptiveThreshold * 100).toFixed(0)}%`, 'info');

      const opportunities = [];
      let analyzedCount = 0;
      let mockDataUsed = 0;
      const heatmapEntries = [];
      const allCoinsData = []; // Collect all coin data for batch AI
      const analysisResults = new Map(); // Store analysis results to avoid re-computation

      // Step 1: Collect all coin technical data (in batches of 10 for parallel processing)
      console.log('📊 Step 1: Collecting technical data for all coins...');
      addLogEntry('Step 1: Collecting technical data for all coins...', 'info');
      
      // Start news fetching early in parallel (will be awaited later)
      let newsFetchPromise = null;
      const startNewsFetch = () => {
        if (allCoinsData.length > 0 && !newsFetchPromise) {
          newsFetchPromise = (async () => {
            // Wait a bit to collect more coins, then fetch news for all collected coins
            await sleep(500); // Small delay to let more coins accumulate
            
            const coinsToFetch = [...allCoinsData]; // Copy current array
            const NEWS_BATCH_SIZE = 10;
            for (let i = 0; i < coinsToFetch.length; i += NEWS_BATCH_SIZE) {
              const batch = coinsToFetch.slice(i, i + NEWS_BATCH_SIZE);
              const newsPromises = batch.map(async (coin) => {
                try {
                  const news = await fetchCryptoNews(coin.symbol, 5);
                  // Update the coin in allCoinsData array
                  const coinIndex = allCoinsData.findIndex(c => c.symbol === coin.symbol);
                  if (coinIndex >= 0) {
                    allCoinsData[coinIndex].news = news;
                  }
                  return news;
                } catch (error) {
                  const coinIndex = allCoinsData.findIndex(c => c.symbol === coin.symbol);
                  if (coinIndex >= 0) {
                    allCoinsData[coinIndex].news = { articles: [], total: 0 };
                  }
                  return null;
                }
              });
              await Promise.allSettled(newsPromises);
              if (i + NEWS_BATCH_SIZE < coinsToFetch.length) {
                await sleep(100);
              }
            }
          })();
        }
        return newsFetchPromise;
      };
      
      const BATCH_SIZE = 5; // Reduced from 10 to 5 to limit memory usage
      for (let i = 0; i < this.trackedCoins.length; i += BATCH_SIZE) {
        const batch = this.trackedCoins.slice(i, i + BATCH_SIZE);
        console.log(`📦 Processing batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} coins)...`);
        
        // Process all coins in batch in parallel
        const analysisPromises = batch.map(coin => 
          this.analyzeWithTechnicalIndicators(coin, { 
            options,
            globalMetrics: this.globalMetrics 
          }).catch(error => {
            this.stats.apiErrors += 1;
            return null; // Return null on error so Promise.allSettled continues
          })
        );
        
        const results = await Promise.allSettled(analysisPromises);
        
        // Process results
        for (let j = 0; j < results.length; j++) {
          const result = results[j];
          const coin = batch[j];
          
          if (result.status === 'fulfilled' && result.value) {
            const analysis = result.value;
            analyzedCount += 1;

            // Store analysis result
            analysisResults.set(coin.symbol, analysis);

            if (analysis.usesMockData) {
              mockDataUsed += 1;
            }

            if (analysis.heatmapEntry) {
              heatmapEntries.push(analysis.heatmapEntry);
            }

            // Collect data for batch AI
            // Check if we have valid frame data
            const hasFrames = analysis.frames && typeof analysis.frames === 'object';
            const frameCount = hasFrames ? Object.keys(analysis.frames).length : 0;
            
            // Verify frames have actual data (not just empty objects)
            let hasValidFrameData = false;
            if (hasFrames && frameCount > 0) {
              // Check if at least one timeframe has valid indicators (not all 'N/A')
              const timeframes = Object.keys(analysis.frames);
              for (const tf of timeframes) {
                const frame = analysis.frames[tf];
                if (frame && (frame.rsi !== 'N/A' || frame.price > 0)) {
                  hasValidFrameData = true;
                  break;
                }
              }
            }
            
            if (hasFrames && frameCount > 0 && hasValidFrameData) {
              const priceValue = typeof analysis.price === 'string' 
                ? parseFloat(analysis.price.replace('$', '').replace(/,/g, '')) 
                : analysis.price || 0;
              
              allCoinsData.push({
                symbol: coin.symbol,
                name: coin.name,
                currentPrice: priceValue,
                frames: analysis.frames,
                dataSource: analysis.dataSource || 'CoinGecko',
              });
              
              // Start news fetching when we have enough coins (start early, fetch in parallel)
              if (allCoinsData.length === 5) {
                startNewsFetch(); // Start fetching news early
              }
            } else {
              // Log why coin was skipped
              if (!hasFrames) {
                console.warn(`⚠️ ${coin.symbol}: No frames object in analysis`);
              } else if (frameCount === 0) {
                console.warn(`⚠️ ${coin.symbol}: Frames object is empty`);
              } else if (!hasValidFrameData) {
                console.warn(`⚠️ ${coin.symbol}: Frames exist but contain no valid data (all N/A or price=0)`);
              }
            }
          } else {
            this.stats.apiErrors += 1;
            // Log detailed error information
            if (result.status === 'rejected') {
              console.error(`❌ Analysis failed for ${coin.symbol}:`, result.reason?.message || result.reason || 'Unknown error');
              if (result.reason?.stack) {
                console.error(`   Error stack:`, result.reason.stack.substring(0, 500));
              }
            } else if (!result.value) {
              console.warn(`⚠️ Analysis returned null/undefined for ${coin.symbol}`);
            }
          }

          this.scanProgress.processed += 1;
          this.scanProgress.percent = Math.min(
            Math.round((this.scanProgress.processed / this.trackedCoins.length) * 60), // 60% for data collection
            60,
          );
        }
        
        // Small delay between batches to respect rate limits
        if (i + BATCH_SIZE < this.trackedCoins.length) {
          await sleep(100); // 100ms delay between batches (reduced from 200ms)
        }
      }

      // Diagnostic logging after data collection
      console.log(`\n${'='.repeat(60)}`);
      console.log(`📊 DATA COLLECTION SUMMARY`);
      console.log(`${'='.repeat(60)}`);
      console.log(`✅ Analyzed: ${analyzedCount}/${this.trackedCoins.length} coins`);
      console.log(`📦 Coins with valid frames: ${allCoinsData.length}`);
      console.log(`❌ API Errors: ${this.stats.apiErrors}`);
      if (allCoinsData.length > 0) {
        console.log(`📋 Coins ready for AI: ${allCoinsData.map(c => c.symbol).join(', ')}`);
      } else {
        console.warn(`⚠️ WARNING: No coins have valid frame data!`);
        console.warn(`   This means technical analysis failed for all coins or returned no frame data.`);
        console.warn(`   Check if data fetching is working correctly.`);
      }
      console.log(`${'='.repeat(60)}\n`);

      // Step 2a: Wait for news fetching (started early in parallel with coin analysis)
      if (allCoinsData.length > 0) {
        console.log('📰 Fetching news for coins...');
        addLogEntry('Fetching recent news for analysis...', 'info');
        
        // If news fetching hasn't started yet, start it now
        if (!newsFetchPromise) {
          startNewsFetch();
        }
        
        // Wait for news fetching to complete
        if (newsFetchPromise) {
          await newsFetchPromise;
        } else {
          // Fallback: fetch news now if it wasn't started
          const NEWS_BATCH_SIZE = 10;
          for (let i = 0; i < allCoinsData.length; i += NEWS_BATCH_SIZE) {
            const batch = allCoinsData.slice(i, i + NEWS_BATCH_SIZE);
            const newsPromises = batch.map(async (coin) => {
              try {
                const news = await fetchCryptoNews(coin.symbol, 5);
                coin.news = news;
                return news;
              } catch (error) {
                coin.news = { articles: [], total: 0 };
                return null;
              }
            });
            await Promise.allSettled(newsPromises);
            if (i + NEWS_BATCH_SIZE < allCoinsData.length) {
              await sleep(100);
            }
          }
        }
        
        const newsCount = allCoinsData.filter(c => c.news && c.news.articles && c.news.articles.length > 0).length;
        console.log(`✅ Fetched news for ${newsCount}/${allCoinsData.length} coins`);
      } else {
        console.log(`⚠️ Skipping news fetch - no coins with valid frame data (allCoinsData.length = ${allCoinsData.length})`);
      }
      
      // Step 2: Send all data to AI at once (batch analysis)
      console.log(`\n${'='.repeat(60)}`);
      console.log(`🤖 Step 2: AI BATCH ANALYSIS`);
      console.log(`📊 Proceeding to AI analysis step...`);
      console.log(`📊 Analyzed ${analyzedCount} coins total`);
      console.log(`📊 Collected ${allCoinsData.length} coins with valid frame data for AI`);
      if (allCoinsData.length > 0) {
        const newsCount = allCoinsData.filter(c => c.news && c.news.articles && c.news.articles.length > 0).length;
        console.log(`📰 News fetched for ${newsCount} coins`);
      }
      console.log(`🔑 AI API Key configured: ${config.AI_API_KEY ? 'YES' : 'NO'}`);
      console.log(`🤖 AI Model: ${config.AI_MODEL}`);
      if (allCoinsData.length > 0) {
        console.log(`📋 Coins ready for AI: ${allCoinsData.map(c => c.symbol).join(', ')}`);
      }
      console.log(`${'='.repeat(60)}\n`);
      
      addLogEntry(`Step 2: AI batch analysis - ${allCoinsData.length} coins ready`, 'info');
      
      // Update progress to 70% for AI analysis
      this.scanProgress.percent = 70;
      this.scanProgress.stage = 'AI Analysis';
      
      this.currentlyAnalyzing = {
        symbol: 'BATCH',
        name: 'Batch AI Analysis',
        stage: `Analyzing ${allCoinsData.length} coins with AI...`,
        timestamp: new Date(),
        progress: 70,
      };
      this.updateLiveAnalysis();

      let batchAIResults = {};
      if (allCoinsData.length > 0 && config.AI_API_KEY) {
        try {
          console.log(`🤖 Calling AI API with ${allCoinsData.length} coins...`);
          console.log(`🔑 AI API Key present: ${config.AI_API_KEY ? 'YES' : 'NO'}`);
          console.log(`📊 Coins to analyze: ${allCoinsData.map(c => c.symbol).join(', ')}`);
          
          addLogEntry(`Calling AI API with ${allCoinsData.length} coins...`, 'info');
          
          // Update progress during AI call
          this.scanProgress.percent = 75;
          
          batchAIResults = await getBatchAIAnalysis(allCoinsData, this.globalMetrics, options);
          this.stats.aiCalls += 1; // Track AI API call
          
          // Log what we got back from AI
          const resultCount = Object.keys(batchAIResults).length;
          console.log(`📊 AI returned results for ${resultCount}/${allCoinsData.length} coins`);
          if (resultCount > 0) {
            // Show sample of first 3 results
            const sampleSymbols = Object.keys(batchAIResults).slice(0, 3);
            sampleSymbols.forEach(symbol => {
              const result = batchAIResults[symbol];
              console.log(`   📋 ${symbol}: ${result.action} (${(result.confidence * 100).toFixed(0)}%) - AI: ${result.aiEvaluated ? '✅' : '❌'}`);
            });
          } else {
            console.warn(`⚠️ WARNING: AI returned NO results! All coins will use fallback analysis (HOLD).`);
          }
          
          // Store AI evaluations in database
          for (const coin of allCoinsData) {
            if (batchAIResults[coin.symbol]) {
              const aiResult = batchAIResults[coin.symbol];
              // Store AI evaluation with limited context to prevent MongoDB size issues
              storeAIEvaluation({
                symbol: coin.symbol,
                type: 'coin_analysis',
                data: aiResult,
                model: config.AI_MODEL,
                context: {
                  news: coin.news?.articles?.slice(0, 5) || [], // Only last 5 articles
                  // Don't include historicalData - it's too large
                }
              }).catch(err => {
                console.error(`⚠️ Failed to store evaluation for ${coin.symbol}:`, err.message);
              });
            }
          }
          
          console.log(`✅ Batch AI analysis completed for ${Object.keys(batchAIResults).length} coins`);
          console.log(`📊 AI API calls this session: ${this.stats.aiCalls}`);
          
          addLogEntry(`AI analysis completed for ${Object.keys(batchAIResults).length} coins`, 'success');
          
          this.currentlyAnalyzing.stage = `AI evaluation complete - ${Object.keys(batchAIResults).length} coins analyzed`;
          this.currentlyAnalyzing.progress = 85;
          this.scanProgress.percent = 85;
        } catch (error) {
          console.log(`⚠️ Batch AI failed: ${error.message}`);
          console.error('Full AI error:', error);
          console.error('Error stack:', error.stack);
          
          addLogEntry(`AI analysis failed: ${error.message}`, 'error');
          
          this.currentlyAnalyzing.stage = `AI analysis failed, using fallback`;
          this.scanProgress.percent = 80; // Still update progress even on error
        }
      } else {
        if (!config.AI_API_KEY) {
          console.log('⚠️ Skipping AI analysis - API_KEY not configured');
          console.log(`   Check environment variable: AI_API_KEY`);
          addLogEntry('Skipping AI analysis - API key not configured', 'warning');
        } else if (allCoinsData.length === 0) {
          console.log(`⚠️ Skipping AI analysis - no valid coin data collected`);
          console.log(`   Analyzed ${analyzedCount} coins, but none had frame data`);
          console.log(`   Check if coins are using mock data or if data collection is failing`);
          addLogEntry('Skipping AI analysis - no valid coin data', 'warning');
        }
        this.scanProgress.percent = 80; // Update progress even if skipping
      }

      // Step 3: Merge AI results with stored technical analysis
      console.log('🔄 Step 3: Merging AI results with technical analysis...');
      addLogEntry('Step 3: Merging AI results with technical analysis...', 'info');
      this.scanProgress.percent = 90;
      this.scanProgress.stage = 'Merging Results';
      for (const coin of this.trackedCoins) {
        try {
          const analysis = analysisResults.get(coin.symbol);
          if (!analysis) continue;

          // Merge AI results if available
          if (batchAIResults[coin.symbol]) {
            const aiResult = batchAIResults[coin.symbol];
            analysis.action = aiResult.action;
            analysis.confidence = aiResult.confidence;
            analysis.reason = aiResult.reason;
            analysis.insights = aiResult.insights;
            analysis.signal = aiResult.signal;
            analysis.aiEvaluated = aiResult.aiEvaluated || false;
            
            // Add risk management fields from AI
            if (aiResult.entryPrice) analysis.entryPrice = aiResult.entryPrice;
            if (aiResult.takeProfit) analysis.takeProfit = aiResult.takeProfit;
            if (aiResult.stopLoss) analysis.stopLoss = aiResult.stopLoss;
            if (aiResult.addPosition) analysis.addPosition = aiResult.addPosition;
            if (aiResult.expectedGainPercent) analysis.expectedGainPercent = aiResult.expectedGainPercent;
            
            // If AI didn't provide risk management, calculate it
            if (!aiResult.entryPrice || !aiResult.takeProfit || !aiResult.stopLoss) {
              const riskLevels = this.calculateRiskManagement(analysis);
              analysis.entryPrice = riskLevels.entryPrice;
              analysis.takeProfit = riskLevels.takeProfit;
              analysis.stopLoss = riskLevels.stopLoss;
              analysis.addPosition = riskLevels.addPosition;
              analysis.expectedGainPercent = riskLevels.expectedGainPercent;
            }
          }

          console.log(`🔍 ${coin.symbol}: ${analysis.action} (${(analysis.confidence * 100).toFixed(0)}%) - AI: ${analysis.aiEvaluated ? '✅' : '❌'}`);

          // Only send rejection notifications for actionable signals (BUY / SELL)
          const isActionNotifiable = analysis.action === 'BUY' || analysis.action === 'SELL';

          // Only add real opportunities with valid data
          if (analysis.confidence >= this.tradingRules.minConfidence && !analysis.usesMockData) {
            const consensusResult = this.passesMultiTimeframeConsensus(analysis);
            if (!consensusResult.passed) {
              console.log(`🚫 ${coin.symbol}: Fails multi-timeframe consensus check (${consensusResult.matches}/${consensusResult.required} timeframes match)`);
              
              // Send Telegram notification for multi-timeframe consensus rejection
              if (config.ENABLE_REJECTION_NOTIFICATIONS && isActionNotifiable && this.shouldNotifyRejection(coin.symbol, 'consensus')) {
                try {
                  const { sendTelegramMessage } = require('../services/notificationService');
                  
                  // Build timeframe details
                  const timeframeChecks = consensusResult.timeframes.map(tf => {
                    const status = tf.matched ? '✅' : '❌';
                    const trendDisplay = tf.trend === 'N/A' ? 'No data' : tf.trend;
                    return `${status} ${tf.timeframe}: ${trendDisplay}`;
                  }).join('\n');
                  
                  const expectedTrend = analysis.action === 'BUY' ? 'BULLISH' : 'BEARISH';
                  
                  const rejectionMessage =
`🚫 AI Opportunity Rejected - Multi-Timeframe Consensus

Symbol: ${coin.symbol}
Action: ${analysis.action}
Confidence: ${(analysis.confidence * 100).toFixed(0)}%
Entry: $${analysis.entryPrice?.toFixed(2) || 'N/A'}
TP: $${analysis.takeProfit?.toFixed(2) || 'N/A'} (+${analysis.expectedGainPercent?.toFixed(1) || 'N/A'}%)
SL: $${analysis.stopLoss?.toFixed(2) || 'N/A'}

Rejection Reason: Multi-timeframe consensus check failed

Required: ${consensusResult.required} out of ${consensusResult.timeframes.length} timeframes must be ${expectedTrend}
Actual: ${consensusResult.matches} out of ${consensusResult.timeframes.length} timeframes match

Timeframe Analysis:
${timeframeChecks}

AI Reasoning:
${analysis.reason?.substring(0, 200) || 'No reasoning provided'}...

Action: Consider adjusting multi-timeframe consensus settings or review timeframe trends`;

                  sendTelegramMessage(rejectionMessage).catch((err) =>
                    console.error('⚠️ Failed to send consensus rejection notification:', err.message)
                  );
                } catch (notifError) {
                  console.error('⚠️ Error creating consensus rejection notification:', notifError.message);
                }
              }
              
              continue;
            }
            if (!this.applyScanFilters(analysis, options)) {
              console.log(`🚫 ${coin.symbol}: Filtered out by scan filters`);
              // NOTE: We intentionally do NOT send Telegram notifications here anymore
              // to avoid duplicate / noisy messages. Higher-signal rejections are
              // handled by custom trading rules and backtest filters below.
              continue;
            }
            // Apply custom trading rules
            if (!this.matchesTradingRules(analysis)) {
              console.log(`🚫 ${coin.symbol}: Does not match custom trading rules`);
              
              // Send Telegram notification with DETAILED rule diagnostics
              if (config.ENABLE_REJECTION_NOTIFICATIONS && isActionNotifiable && this.shouldNotifyRejection(coin.symbol, 'rules')) {
                try {
                  // Build detailed rule check diagnostics
                  const indicators = analysis.indicators || {};
                  const dailyRSI = Number(indicators.daily?.rsi) || 50;
                  const bollingerPos = indicators.daily?.bollingerPosition || 'MIDDLE';
                  const frames = indicators.frames || {};
                  const bullishFrames = Object.values(frames).filter(
                    (f) => f.trend === 'BULLISH'
                  ).length;
                  const patterns = (analysis.patterns || []).filter(
                    (p) => p.signal === 'BULLISH'
                  );
                  
                  const buyRules = this.tradingRules.patterns.buy;
                  let ruleChecks = [];
                  
                  if (analysis.action === 'BUY') {
                    if (buyRules.requireRSIOversold) {
                      const passed = dailyRSI < this.tradingRules.rsi.oversold;
                      ruleChecks.push(
                        `${passed ? '✅' : '❌'} RSI Oversold: ${dailyRSI.toFixed(
                          2
                        )} ${passed ? '<' : '≥'} ${this.tradingRules.rsi.oversold} (REQUIRED)`
                      );
                    }
                    if (buyRules.requireBollingerLower) {
                      const passed = bollingerPos === 'LOWER';
                      ruleChecks.push(
                        `${passed ? '✅' : '❌'} Bollinger Lower: ${bollingerPos} ${
                          passed ? '=' : '≠'
                        } LOWER (REQUIRED)`
                      );
                    }
                    if (buyRules.requireBullishTrend) {
                      const passed = bullishFrames >= buyRules.minTimeframeAlignment;
                      ruleChecks.push(
                        `${passed ? '✅' : '❌'} Bullish Trend: ${bullishFrames}/${
                          buyRules.minTimeframeAlignment
                        } timeframes (REQUIRED)`
                      );
                    }
                    if (buyRules.requirePattern) {
                      const passed = patterns.length > 0;
                      ruleChecks.push(
                        `${passed ? '✅' : '❌'} Pattern Required: ${
                          patterns.length
                        } found (REQUIRED)`
                      );
                    }
                  }
                  
                  const rejectionMessage =
`🚫 AI Opportunity Rejected

Symbol: ${coin.symbol}
Action: ${analysis.action}
Confidence: ${(analysis.confidence * 100).toFixed(0)}%
Entry: $${analysis.entryPrice?.toFixed(2) || 'N/A'}
TP: $${analysis.takeProfit?.toFixed(2) || 'N/A'} (+${analysis.expectedGainPercent?.toFixed(1) || 'N/A'}%)
SL: $${analysis.stopLoss?.toFixed(2) || 'N/A'}

Rejection Reason: Does not match custom trading rules

Rule Checks (needs ≥1 pass):
${ruleChecks.length > 0 ? ruleChecks.join('\n') : '• No specific rules enabled'}

AI Reasoning:
${analysis.reason?.substring(0, 250) || 'No reasoning provided'}

Fix: ${
  dailyRSI > 30 && dailyRSI < 40
    ? `RSI at ${dailyRSI.toFixed(
        1
      )} is "near" oversold but not < 30. Consider lowering requireRSIOversold threshold or set it to false.`
    : 'Review your trading rules configuration'
}`;
 
                  sendTelegramMessage(rejectionMessage).catch((err) =>
                    console.error('⚠️ Failed to send rejection notification:', err.message)
                  );
                } catch (notifError) {
                  console.error('⚠️ Error creating rejection notification:', notifError.message);
                }
              }
              
              continue;
            }
            
            // Run backtest on this opportunity
            try {
              addLogEntry(`Running backtest for ${coin.symbol}...`, 'info');
              const backtestResult = await quickBacktest(coin, {
                action: analysis.action,
                entryPrice: analysis.entryPrice,
                takeProfit: analysis.takeProfit,
                stopLoss: analysis.stopLoss
              });
              
              if (backtestResult.success) {
                analysis.backtest = {
                  winRate: backtestResult.winRate,
                  totalTrades: backtestResult.totalTrades,
                  avgReturn: backtestResult.avgReturn,
                  profitFactor: backtestResult.profitFactor,
                  maxDrawdown: backtestResult.maxDrawdown,
                  dataPoints: backtestResult.dataPoints
                };
                
                // Filter by profit factor: Only accept trades with profit factor > 1.5 OR win rate > 50%
                const minProfitFactor = 1.5;
                const minWinRate = 50;
                const isProfitable = backtestResult.profitFactor > minProfitFactor || backtestResult.winRate > minWinRate;
                
                if (!isProfitable) {
                  console.log(`🚫 ${coin.symbol}: Filtered out - Profit Factor: ${backtestResult.profitFactor.toFixed(2)}, Win Rate: ${backtestResult.winRate.toFixed(1)}%`);
                  
                  // Send Telegram notification about backtest rejection
                  if (config.ENABLE_REJECTION_NOTIFICATIONS && isActionNotifiable && this.shouldNotifyRejection(coin.symbol, 'backtest')) {
                    try {
                      const backtestMessage =
`📊 AI Opportunity Failed Backtest

Symbol: ${coin.symbol}
Action: ${analysis.action}
Confidence: ${(analysis.confidence * 100).toFixed(0)}%
Entry: $${analysis.entryPrice?.toFixed(2) || 'N/A'}
TP: $${analysis.takeProfit?.toFixed(2) || 'N/A'} (+${analysis.expectedGainPercent?.toFixed(1) || 'N/A'}%)
SL: $${analysis.stopLoss?.toFixed(2) || 'N/A'}

Rejection Reason: Backtest shows poor historical performance

Backtest Results:
- Profit Factor: ${backtestResult.profitFactor.toFixed(2)} (Required: ${minProfitFactor})
- Win Rate: ${backtestResult.winRate.toFixed(1)}% (Required: ${minWinRate}%)
- Avg Return: ${backtestResult.avgReturn?.toFixed(2) || 'N/A'}%
- Max Drawdown: ${backtestResult.maxDrawdown?.toFixed(2) || 'N/A'}%
- Historical Trades: ${backtestResult.totalTrades}
- Data Points: ${backtestResult.dataPoints} days

AI Reasoning:
${analysis.reason?.substring(0, 250) || 'No reasoning provided'}

Action: AI may be overly optimistic, or backtest period may not match current market conditions`;
 
                      sendTelegramMessage(backtestMessage).catch((err) =>
                        console.error('⚠️ Failed to send backtest notification:', err.message)
                      );
                    } catch (notifError) {
                      console.error('⚠️ Error creating backtest notification:', notifError.message);
                    }
                  }
                  
                  addLogEntry(`🚫 ${coin.symbol}: Filtered (PF: ${backtestResult.profitFactor.toFixed(2)}, WR: ${backtestResult.winRate.toFixed(1)}%)`, 'warning');
                  continue; // Skip this opportunity
                }
                
                addLogEntry(`✅ ${coin.symbol}: Backtest complete - ${backtestResult.winRate.toFixed(1)}% win rate, PF: ${backtestResult.profitFactor.toFixed(2)} (${backtestResult.totalTrades} trades)`, 'success');
          } else {
                analysis.backtest = {
                  error: backtestResult.error || 'Backtest failed',
                  dataPoints: backtestResult.dataPoints || 0
                };
                addLogEntry(`⚠️ ${coin.symbol}: Backtest failed - ${backtestResult.error}`, 'warning');
              }
            } catch (backtestError) {
              console.log(`⚠️ ${coin.symbol}: Backtest error - ${backtestError.message}`);
              analysis.backtest = {
                error: backtestError.message
              };
            }
            
            opportunities.push(analysis);
            console.log(`✅ ${coin.symbol}: ${analysis.action} (${(analysis.confidence * 100).toFixed(0)}% confidence) - ADDED TO OPPORTUNITIES`);
            addLogEntry(`${coin.symbol}: ${analysis.action} signal detected (${(analysis.confidence * 100).toFixed(0)}% confidence)`, 'success');
          }
        } catch (error) {
          console.log(`❌ ${coin.symbol}: Merge failed - ${error.message}`);
          addLogEntry(`${coin.symbol}: Merge failed - ${error.message}`, 'error');
        }
      }

      this.scanProgress.percent = 100;
      addLogEntry(`Scan complete: ${opportunities.length} opportunities found`, opportunities.length > 0 ? 'success' : 'info');

      // Store batch AI results for UI display
      this.lastBatchAIResults = {
        results: batchAIResults,
        timestamp: new Date(),
        coinsAnalyzed: allCoinsData.length,
      };

      this.currentlyAnalyzing = null;
      this.updateLiveAnalysis();

      opportunities.sort((a, b) => b.confidence - a.confidence);

      this.stats.totalScans += 1;
      this.stats.totalOpportunities += opportunities.length;
      this.stats.lastScanDuration = Date.now() - startTime;
      this.stats.lastScanTime = Date.now();
      this.stats.mockDataUsage += mockDataUsed;
      this.stats.lastSuccessfulScan = new Date();
      this.latestHeatmap = heatmapEntries.sort((a, b) => (b.overallScore || 0) - (a.overallScore || 0));

      if (opportunities.length > 0) {
        this.stats.avgConfidence =
          opportunities.reduce((sum, o) => sum + o.confidence, 0) / opportunities.length;
      }

      // Log Bybit trading status
      const { isExchangeTradingEnabled } = require('../services/exchangeService');
      const exchangeConfig = isExchangeTradingEnabled();
      console.log(`\n${'='.repeat(60)}`);
      console.log(`📊 OPPORTUNITIES SUMMARY`);
      console.log(`${'='.repeat(60)}`);
      console.log(`✅ Opportunities found: ${opportunities.length}`);
      console.log(`📝 Bybit Trading: ${exchangeConfig.enabled ? `✅ ENABLED (${exchangeConfig.mode})` : '❌ DISABLED - Configure BYBIT_API_KEY and BYBIT_API_SECRET'}`);
      console.log(`📱 Telegram: ${config.TELEGRAM_ENABLED ? '✅ ENABLED' : '❌ DISABLED'}`);
      if (opportunities.length === 0) {
        console.log(`⚠️ No opportunities found - possible reasons:`);
        console.log(`   - All coins analyzed as HOLD (no BUY/SELL signals)`);
        console.log(`   - Confidence below threshold (${(this.tradingRules.minConfidence * 100).toFixed(0)}%)`);
        console.log(`   - Filtered out by trading rules or backtest`);
        console.log(`   - AI analysis failed and fallback returned HOLD for all coins`);
      }
      console.log(`${'='.repeat(60)}\n`);

      if (config.TELEGRAM_ENABLED && opportunities.length > 0) {
        console.log(`📱 Sending Telegram notifications for ${opportunities.length} opportunities...`);
        for (const opp of opportunities) {
          const allowMock = config.ALLOW_MOCK_NOTIFICATIONS;
          if (opp.usesMockData && !allowMock) {
            console.log(`⏭️ Skipping Telegram for ${opp.symbol} (mock data). Set ALLOW_MOCK_NOTIFICATIONS=true to send anyway.`);
            continue;
          }
          await sendTelegramNotification(
            opp,
            this.lastNotificationTime,
            this.stats,
            this.greedFearIndex,
            this.globalMetrics,
            { force: allowMock }
          );
          // Add the opportunity as an active trade if it's a BUY/SELL signal
          if (opp.action === 'BUY' || opp.action === 'SELL') {
            console.log(`💼 Executing trade for ${opp.symbol}: ${opp.action} at $${opp.entryPrice?.toFixed(2) || 'N/A'}`);
            try {
            await this.addActiveTrade(opp);
              console.log(`✅ Trade executed successfully for ${opp.symbol}`);
            } catch (tradeError) {
              console.error(`❌ Failed to execute trade for ${opp.symbol}:`, tradeError.message);
            }
          } else {
            console.log(`⏭️ Skipping trade execution for ${opp.symbol} - action is ${opp.action} (not BUY/SELL)`);
          }
          await sleep(1500);
        }
      }

      this.analysisHistory.unshift({
        timestamp: new Date(),
        opportunities: opportunities.length,
        details: opportunities,
        duration: this.stats.lastScanDuration,
        analyzed: analyzedCount,
        globalMetrics: this.globalMetrics,
      });

      if (this.analysisHistory.length > 288) {
        this.analysisHistory = this.analysisHistory.slice(0, 288);
      }

      // Clean up memory after scan
      this._limitPriceCache();
      this._limitNewsCache();
      
      // Clear large data structures to free memory
      if (allCoinsData.length > 0) {
        allCoinsData.length = 0; // Clear array but keep reference
      }
      if (analysisResults.size > 0) {
        analysisResults.clear(); // Clear Map
      }
      
      console.log(`\n📈 SCAN COMPLETE: ${opportunities.length} opportunities found`);
      console.log(`📊 API Usage: CoinGecko (primary), CoinPaprika: ${this.stats.coinpaprikaUsage}, CoinMarketCap: ${this.stats.coinmarketcapUsage}`);
      
      // Re-evaluate open trades with AI
      await this.reevaluateOpenTradesWithAI();
      
      // Learn from closed trades and update ML model
      if (this.closedTrades && this.closedTrades.length >= 10) {
        try {
          const { learnFromTrades } = require('../services/mlService');
          const mlResults = learnFromTrades(this.closedTrades);
          if (mlResults.success) {
            addLogEntry(`🧠 ML: Top features: ${mlResults.featureImportance.topFeatures.join(', ')}`, 'info');
            console.log(`🧠 ML Learning: Optimal confidence ${(mlResults.recommendations.optimalConfidence * 100).toFixed(0)}%`);
          }
        } catch (error) {
          console.error('ML learning error:', error);
        }
      }
      
      this.scanInProgress = false;
      this.scanProgress = {
        running: false,
        processed: this.trackedCoins.length,
        total: this.trackedCoins.length,
        percent: 100,
        interval: this.selectedIntervalKey,
        completedAt: new Date(),
      };

      return {
        scanTime: new Date(),
        totalCoins: this.trackedCoins.length,
        analyzedCoins: analyzedCount,
        opportunitiesFound: opportunities.length,
        opportunities,
        nextScan: this.isRunning ? new Date(Date.now() + this.scanIntervalMs) : null,
        duration: this.stats.lastScanDuration,
        mockDataUsed,
        greedFear: this.greedFearIndex,
        heatmap: heatmapEntries,
        globalMetrics: this.globalMetrics,
        apiUsage: {
          coinpaprika: this.stats.coinpaprikaUsage,
          coinmarketcap: this.stats.coinmarketcapUsage,
        },
      };
    } catch (error) {
      console.log('❌ Technical scan failed:', error.message);
      this.scanInProgress = false;
      this.scanProgress = {
        running: false,
        processed: this.scanProgress.processed,
        total: this.trackedCoins.length,
        percent: Math.min(
          Math.round((this.scanProgress.processed / this.trackedCoins.length) * 100),
          100,
        ),
        interval: this.selectedIntervalKey,
        error: error.message,
        completedAt: new Date(),
      };
      return {
        scanTime: new Date(),
        error: error.message,
        opportunities: [],
        greedFear: this.greedFearIndex,
        globalMetrics: this.globalMetrics,
      };
    }
  }

  // Individual coin analysis
  async analyzeWithTechnicalIndicators(coin, context = {}) {
    // This method would be implemented similarly to the original
    // but using the imported service functions
    // For brevity, showing the structure
    
    const scanOptions = context.options || {};
    const globalMetrics = context.globalMetrics || {};

    try {
      this.currentlyAnalyzing = {
        symbol: coin.symbol,
        name: coin.name,
        stage: 'Fetching enhanced price data…',
        timestamp: new Date(),
        progress: 10,
      };
      this.updateLiveAnalysis();

      // Fetch price first, then historical data in parallel (pass price to avoid duplicate fetch)
      if (this.currentlyAnalyzing) {
      this.currentlyAnalyzing.stage = 'Fetching price and historical data...';
      this.currentlyAnalyzing.progress = 30;
      this.updateLiveAnalysis();
      }

      // Fetch price first
      const priceResult = await fetchEnhancedPriceData(coin, this.priceCache, this.stats, config);
      const usesMockData = priceResult.usedMock;
      const dataSource = priceResult.data.source;
      const currentPrice = priceResult.data.price;
      
      // Fetch historical data in parallel with price already available (pass price to avoid duplicate fetch)
      const historicalData = await fetchHistoricalData(coin.id, coin, this.stats, config, currentPrice);
      const { dailyData, hourlyData, minuteData, usedMock: historicalMock } = historicalData;

      // Detect trading patterns (if enabled)
      let patterns = [];
      let hourlyPatterns = [];
      
      if (this.tradingRules.patternDetection && this.tradingRules.patternDetection.enabled) {
        if (this.currentlyAnalyzing) {
        this.currentlyAnalyzing.stage = 'Detecting trading patterns...';
        this.currentlyAnalyzing.progress = 50;
        this.updateLiveAnalysis();
        }

        // Detect all patterns once, then filter based on enabled types
        const allDailyPatterns = detectTradingPatterns(dailyData || []);
        const allHourlyPatterns = detectTradingPatterns(hourlyData || []);
        
        // Filter daily patterns based on enabled types
        if (this.tradingRules.patternDetection.parallelChannels) {
          patterns.push(...allDailyPatterns.filter(p => p.pattern === 'PARALLEL_CHANNEL'));
        }
        if (this.tradingRules.patternDetection.headAndShoulders) {
          patterns.push(...allDailyPatterns.filter(p => p.pattern.includes('HEAD_AND_SHOULDERS')));
        }
        if (this.tradingRules.patternDetection.triangles) {
          patterns.push(...allDailyPatterns.filter(p => p.pattern === 'TRIANGLE'));
        }
        if (this.tradingRules.patternDetection.wedges) {
          patterns.push(...allDailyPatterns.filter(p => p.pattern === 'WEDGE'));
        }
        if (this.tradingRules.patternDetection.doubleTopBottom) {
          patterns.push(...allDailyPatterns.filter(p => p.pattern.includes('DOUBLE')));
        }
        
        // Add hourly patterns (all types if pattern detection is enabled)
        hourlyPatterns = allHourlyPatterns;
      }

      // Combine patterns from different timeframes
      const allPatterns = [...patterns, ...hourlyPatterns];

      // Calculate technical indicators for all timeframes
      const frames = this.prepareTimeframeSeries(minuteData || [], hourlyData || [], dailyData || []);
      
      // Calculate indicators for each timeframe (format expected by AI)
      const framesWithIndicators = {};
      for (const [timeframe, series] of Object.entries(frames)) {
        if (series && series.length > 0) {
          // Extract close prices (TradingView RSI uses close prices)
          const prices = series.map(s => {
            // Handle different data formats
            if (typeof s === 'number') return s;
            if (s.price) return s.price;
            if (s.close) return s.close;
            return s;
          }).filter(p => p && !isNaN(p) && p > 0);
          
          if (prices.length < 15) {
            // Need at least 15 data points for RSI(14)
            framesWithIndicators[timeframe] = {
              rsi: 'N/A',
              bollingerPosition: 'MIDDLE',
              trend: 'SIDEWAYS',
              momentum: 'NEUTRAL',
              price: prices[prices.length - 1] || 0,
              support: prices.length > 0 ? Math.min(...prices) : 0,
              resistance: prices.length > 0 ? Math.max(...prices) : 0,
              series: series
            };
            continue;
          }
          
          // Calculate RSI using Wilder's method (matches TradingView standard)
          // Ensure we have enough data points (RSI(14) needs at least 15 prices)
          const rsi = prices.length >= 15 ? calculateRSI(prices, 14) : null;
          const bollinger = calculateBollingerBands(prices, 20, 2);
          const trend = identifyTrend(prices);
          const momentum = calculateMomentum(prices);
          
          // Calculate Bollinger position
          const currentPrice = prices[prices.length - 1];
          const bbPosition = bollinger ? 
            ((currentPrice - bollinger.lower) / (bollinger.upper - bollinger.lower) * 100) : null;
          const bollingerPosition = bbPosition < 20 ? 'LOWER' : bbPosition > 80 ? 'UPPER' : 'MIDDLE';
          
          framesWithIndicators[timeframe] = {
            rsi: (rsi !== null && rsi !== undefined && !isNaN(rsi)) ? Number(rsi).toFixed(2) : 'N/A',
            bollingerPosition: bollingerPosition || 'MIDDLE',
            trend: trend || 'SIDEWAYS',
            momentum: momentum || 'NEUTRAL',
            price: currentPrice,
            support: Math.min(...prices.slice(-20)), // Support from last 20 periods
            resistance: Math.max(...prices.slice(-20)), // Resistance from last 20 periods
            series: series,
            dataPoints: prices.length // For debugging
          };
        }
      }
      
      // Build analysis result with patterns
      const analysis = {
        symbol: coin.symbol,
        name: coin.name,
        id: coin.id, // Store coin ID for price fetching
        coinmarketcap_id: coin.coinmarketcap_id,
        coinpaprika_id: coin.coinpaprika_id,
        action: 'HOLD',
        price: currentPrice && !isNaN(currentPrice) ? `$${Number(currentPrice).toFixed(2)}` : '$0.00',
        confidence: 0.5,
        signal: 'HOLD | Technical Analysis',
        reason: 'Analysis completed',
        insights: [],
        timestamp: new Date(),
        usesMockData: usesMockData || historicalMock,
        dataSource: dataSource,
        patterns: allPatterns,
        frames: framesWithIndicators, // Add frames at top level for AI
        indicators: {
          frames: framesWithIndicators,
          daily: framesWithIndicators['1d'] || {},
          hourly: framesWithIndicators['1h'] || {},
          momentum: framesWithIndicators['1h']?.momentum || 'NEUTRAL'
        },
        heatmapEntry: null
      };

      // Add pattern insights and adjust confidence based on patterns
      if (allPatterns.length > 0) {
        allPatterns.forEach(pattern => {
          analysis.insights.push(`${pattern.pattern.replace(/_/g, ' ')} detected (${pattern.type}) - ${pattern.signal} signal`);
          
          // Boost confidence if pattern matches signal
          if (pattern.signal === 'BULLISH' && analysis.action === 'BUY') {
            analysis.confidence = Math.min(0.95, analysis.confidence + (pattern.confidence * 0.2));
          } else if (pattern.signal === 'BEARISH' && analysis.action === 'SELL') {
            analysis.confidence = Math.min(0.95, analysis.confidence + (pattern.confidence * 0.2));
          }
        });
        
        // If pattern detection is required, check if we have matching patterns
        if (this.tradingRules.patterns.buy.requirePattern && analysis.action === 'BUY') {
          const bullishPatterns = allPatterns.filter(p => p.signal === 'BULLISH');
          if (bullishPatterns.length === 0) {
            analysis.confidence = 0.3; // Lower confidence if pattern required but not found
          }
        }
        
        if (this.tradingRules.patterns.sell.requirePattern && analysis.action === 'SELL') {
          const bearishPatterns = allPatterns.filter(p => p.signal === 'BEARISH');
          if (bearishPatterns.length === 0) {
            analysis.confidence = 0.3; // Lower confidence if pattern required but not found
          }
        }
      }

      // Detect market regime and adjust strategy
      try {
        const { detectMarketRegime } = require('../services/marketRegimeService');
        
        // Use daily data for regime detection
        const dailyPrices = dailyData || [];
        if (dailyPrices.length >= 50) {
          const prices = dailyPrices.map(d => typeof d === 'number' ? d : (d.price || d.close || 0)).filter(p => p > 0);
          
          if (prices.length >= 50) {
            // Prepare indicators for regime detection
            const { calculateRSI, identifyTrend, calculateBollingerBands } = require('../bot/indicators');
            const rsi = calculateRSI(prices, 14);
            const trend = identifyTrend(prices);
            const bollinger = calculateBollingerBands(prices, 20, 2);
            
            const regime = detectMarketRegime(prices, {
              rsi: rsi[rsi.length - 1],
              trend: trend,
              bollinger: bollinger
            });
            
            analysis.marketRegime = regime;
            
            // Adjust confidence based on market regime
            if (regime.recommendation) {
              const rec = regime.recommendation;
              
              // Apply regime-specific adjustments
              if (rec.minConfidence && rec.minConfidence > this.tradingRules.minConfidence) {
                // Regime requires higher confidence - apply penalty
                const penalty = (rec.minConfidence - this.tradingRules.minConfidence) * 0.5;
                analysis.confidence = Math.max(0.3, analysis.confidence - penalty);
                analysis.insights.push(`Market regime: ${regime.regime} (confidence penalty applied)`);
              } else if (rec.minConfidence && rec.minConfidence < this.tradingRules.minConfidence) {
                // Regime allows lower confidence - apply bonus
                const bonus = (this.tradingRules.minConfidence - rec.minConfidence) * 0.3;
                analysis.confidence = Math.min(0.95, analysis.confidence + bonus);
                analysis.insights.push(`Market regime: ${regime.regime} (confidence bonus applied)`);
              } else {
                analysis.insights.push(`Market regime: ${regime.regime} (${(regime.confidence * 100).toFixed(0)}% confidence)`);
              }
              
              // Adjust strategy recommendations
              if (rec.useBreakouts && analysis.action === 'BUY') {
                analysis.insights.push('Breakout strategy recommended');
              } else if (rec.useMeanReversion && analysis.action === 'BUY') {
                analysis.insights.push('Mean reversion strategy recommended');
              }
            }
          }
        }
      } catch (error) {
        console.error(`Market regime detection error for ${coin.symbol}:`, error);
        // Continue without regime detection if it fails
      }

      return analysis;
      
    } catch (error) {
      console.log(`❌ Technical analysis failed for ${coin.symbol}:`, error.message);
      this.currentlyAnalyzing = {
        symbol: coin.symbol,
        name: coin.name,
        stage: `Analysis failed: ${error.message}`,
        timestamp: new Date(),
        error: true,
      };
      this.updateLiveAnalysis();

      setTimeout(() => {
        this.currentlyAnalyzing = null;
        this.updateLiveAnalysis();
      }, 3000);

      return this.basicTechnicalAnalysis(coin, true);
    }
  }

  updateLiveAnalysis() {
    if (this.currentlyAnalyzing) {
      this.liveAnalysis.unshift({ ...this.currentlyAnalyzing });
      if (this.liveAnalysis.length > 25) {
        this.liveAnalysis = this.liveAnalysis.slice(0, 25);
      }
    }
  }

  getLiveAnalysis() {
    return {
      currentlyAnalyzing: this.currentlyAnalyzing,
      recentAnalysis: this.liveAnalysis.slice(0, 10),
      timestamp: new Date(),
    };
  }

  getBatchAIResults() {
    return this.lastBatchAIResults || {
      results: {},
      timestamp: null,
      coinsAnalyzed: 0,
    };
  }

  getStats() {
    return {
      ...this.stats,
      running: this.isRunning,
      minConfidence: this.minConfidence,
      trackedCoins: this.trackedCoins.length,
      telegramEnabled: config.TELEGRAM_ENABLED,
      newsEnabled: config.NEWS_ENABLED,
      coinmarketcapEnabled: config.COINMARKETCAP_ENABLED,
      coinpaprikaEnabled: config.COINPAPRIKA_ENABLED,
      selectedInterval: this.selectedIntervalKey,
      scanProgress: this.getScanProgress(),
      greedFear: this.greedFearIndex,
      heatmap: this.latestHeatmap,
      globalMetrics: this.globalMetrics,
      apiUsage: {
        coinpaprika: this.stats.coinpaprikaUsage,
        coinmarketcap: this.stats.coinmarketcapUsage,
      },
    };
  }

  getScanHistory() {
    return this.analysisHistory.slice(0, 10);
  }

  // New method: Add a new opportunity as an active trade
  async addActiveTrade(opportunity) {
    if (opportunity.action === 'HOLD') {
      addLogEntry(`Attempted to add HOLD signal for ${opportunity.symbol} as active trade, skipping.`, 'warning');
      return;
    }

    // Check if trade already exists for this symbol (prevent duplicates)
    const existingTrade = this.activeTrades.find(t => 
      t.symbol === opportunity.symbol && 
      t.action === opportunity.action && 
      (t.status === 'OPEN' || t.status === 'DCA_HIT')
    );
    
    if (existingTrade) {
      addLogEntry(`Trade already exists for ${opportunity.symbol} (${opportunity.action}). Skipping duplicate.`, 'info');
      return;
    }

    const tradeId = `${opportunity.symbol}-${Date.now()}`; // Unique ID for the trade
    
    // Parse prices correctly (handle both string and number formats)
    const parsePrice = (price) => {
      if (typeof price === 'number') return price;
      if (typeof price === 'string') {
        return parseFloat(price.replace(/[^0-9.]/g, '')) || 0;
      }
      return 0;
    };
    
    const currentPrice = parsePrice(opportunity.price);
    const entryPrice = parsePrice(opportunity.entryPrice) || currentPrice;
    const takeProfit = parsePrice(opportunity.takeProfit) || currentPrice * 1.05;
    const stopLoss = parsePrice(opportunity.stopLoss) || currentPrice * 0.95;
    const addPosition = parsePrice(opportunity.addPosition) || currentPrice;
    
    // Calculate position size using risk management
    const { calculateQuantity } = require('../services/exchangeService');
    const { recordTrade, getPositionSize } = require('../services/portfolioService');
    const { calculatePositionSizeWithRR } = require('../services/positionSizingService');
    
    let positionSizeUSD = 100; // Default fallback
    let initialQuantity = 0;
    
    // Use dynamic position sizing if enabled
    if (this.tradingRules.positionSizing?.enabled) {
      const positionSizeResult = calculatePositionSizeWithRR({
        entryPrice: entryPrice,
        stopLoss: stopLoss,
        takeProfit: takeProfit,
        riskPerTrade: this.tradingRules.positionSizing.riskPerTrade || 0.02,
        maxPositionSize: this.tradingRules.positionSizing.maxPositionSize || 0.10,
        minPositionSize: this.tradingRules.positionSizing.minPositionSize || 50,
        useVolatility: this.tradingRules.positionSizing.useVolatility || true,
        currentPrice: currentPrice
      });
      
      positionSizeUSD = positionSizeResult.positionSizeUSD;
      initialQuantity = positionSizeResult.quantity;
      
      addLogEntry(`💰 Position sizing: $${positionSizeUSD.toFixed(2)} (Risk: ${(this.tradingRules.positionSizing.riskPerTrade * 100).toFixed(1)}%, SL: ${positionSizeResult.stopLossPercent.toFixed(2)}%)`, 'info');
    } else {
      // Fallback to fixed position size
      positionSizeUSD = getPositionSize(); // $100 USD per position
      initialQuantity = calculateQuantity(opportunity.symbol, entryPrice, positionSizeUSD);
    }
    
    // Store coin data for proper price fetching
    const coinData = {
      symbol: opportunity.symbol,
      name: opportunity.name,
      id: opportunity.id || opportunity.name?.toLowerCase(),
      coinmarketcap_id: opportunity.coinmarketcap_id,
      coinpaprika_id: opportunity.coinpaprika_id
    };
    
    const newTrade = {
      id: tradeId, // DynamoDB primary key
      tradeId: tradeId, // Legacy field for compatibility
      symbol: opportunity.symbol,
      name: opportunity.name,
      action: opportunity.action,
      entryPrice: entryPrice,
      takeProfit: takeProfit,
      stopLoss: stopLoss,
      addPosition: addPosition,
      expectedGainPercent: opportunity.expectedGainPercent || 5,
      entryTime: new Date(),
      status: 'OPEN', // OPEN, TP_HIT, SL_HIT, DCA_HIT, CLOSED (manually)
      currentPrice: currentPrice,
      quantity: initialQuantity, // Track position size
      pnl: 0,
      pnlPercent: 0,
      dcaCount: 0, // Track number of DCA additions (max 5)
      averageEntryPrice: entryPrice, // Track average entry price after DCAs
      insights: opportunity.insights || [],
      reason: opportunity.reason || '',
      dataSource: opportunity.dataSource || 'unknown',
      coinData: coinData, // Store full coin data for price fetching
      coinId: coinData.id,
      coinmarketcap_id: coinData.coinmarketcap_id,
      coinpaprika_id: coinData.coinpaprika_id,
      // Trailing stop loss tracking
      trailingStopLoss: {
        enabled: this.tradingRules.trailingStopLoss?.enabled || false,
        activated: false,
        peakPrice: entryPrice,
        currentStopLoss: stopLoss,
        activationPercent: this.tradingRules.trailingStopLoss?.activationPercent || 2.0,
        trailingPercent: this.tradingRules.trailingStopLoss?.trailingPercent || 1.0
      }
    };

    // EXECUTE ORDER ON BYBIT FIRST (source of truth)
    const { isExchangeTradingEnabled, getPreferredExchange, executeBybitMarketOrder, BYBIT_SYMBOL_MAP } = require('../services/exchangeService');
    const exchangeConfig = isExchangeTradingEnabled();
    
    if (exchangeConfig.enabled) {
      const bybitSymbol = BYBIT_SYMBOL_MAP[newTrade.symbol];
      if (bybitSymbol) {
        const exchange = getPreferredExchange();
        const side = newTrade.action === 'BUY' ? 'Buy' : 'Sell'; // Bybit uses 'Buy'/'Sell'
        const modeLabel = exchangeConfig.testnet ? 'BYBIT_DEMO' : 'BYBIT_MAINNET';
        
        console.log(`💰 Executing ${newTrade.action} order on Bybit (${modeLabel}): ${side} ${initialQuantity} ${newTrade.symbol} at $${entryPrice.toFixed(2)}`);
        
        try {
          const orderResult = await executeBybitMarketOrder(
            bybitSymbol,
            side,
            initialQuantity,
            exchange.apiKey,
            exchange.apiSecret,
            exchange.baseUrl
          );
          
          if (orderResult.success) {
            console.log(`✅ Bybit order executed successfully! Order ID: ${orderResult.orderId || 'N/A'}`);
            newTrade.bybitOrderId = orderResult.orderId;
            newTrade.bybitExecutedPrice = orderResult.price || entryPrice;
            newTrade.bybitExecutedQuantity = orderResult.executedQty || initialQuantity;
            newTrade.bybitExecutedAt = new Date();
            // Update quantity from actual execution
            newTrade.quantity = orderResult.executedQty || initialQuantity;
          } else {
            console.error(`❌ Bybit order failed: ${orderResult.error}`);
            throw new Error(`Bybit order execution failed: ${orderResult.error}`);
          }
        } catch (orderError) {
          console.error(`❌ Failed to execute Bybit order for ${newTrade.symbol}:`, orderError.message);
          throw new Error(`Cannot create trade - Bybit order execution failed: ${orderError.message}`);
        }
      } else {
        throw new Error(`Symbol ${newTrade.symbol} not available on Bybit`);
      }
    } else {
      throw new Error('Bybit trading not enabled. Configure BYBIT_API_KEY and BYBIT_API_SECRET.');
    }
    
    // Only add to active trades AFTER successful Bybit execution
    this.activeTrades.push(newTrade);
    
    // Special logging for BTC trades to track them
    if (newTrade.symbol === 'BTC' || newTrade.symbol === 'btc') {
      console.log(`🔵 BTC TRADE CREATED & EXECUTED ON BYBIT: id=${newTrade.id || newTrade.tradeId}, entryPrice=$${newTrade.entryPrice}, quantity=${newTrade.quantity}`);
    }
    
    // Record trade in portfolio
    await recordTrade(newTrade);
    
    // Save trades to DynamoDB (metadata only - Bybit is source of truth)
    try {
      await saveTrades(this.activeTrades);
      if (newTrade.symbol === 'BTC' || newTrade.symbol === 'btc') {
        console.log(`🔵 BTC TRADE SAVED TO DYNAMODB: id=${newTrade.id || newTrade.tradeId}, total activeTrades=${this.activeTrades.length}`);
      }
    } catch (saveError) {
      console.error(`⚠️ Failed to save trade metadata to DynamoDB (trade still active on Bybit):`, saveError.message);
      // Don't throw - trade is already on Bybit, DynamoDB is just metadata
    }
    
    addLogEntry(`NEW TRADE EXECUTED ON BYBIT: ${newTrade.action} ${newTrade.symbol} at $${newTrade.entryPrice.toFixed(2)} (TP: $${newTrade.takeProfit.toFixed(2)}, SL: $${newTrade.stopLoss.toFixed(2)})`, 'success');
    // TODO: Send Telegram notification for new trade opened
  }

  // New method: Update existing active trades
  /**
   * Sync active trades with Bybit positions (source of truth)
   * Updates quantities from Bybit, keeps DynamoDB data for tracking
   */
  async syncWithBybitPositions() {
    const { isExchangeTradingEnabled, getPreferredExchange, getBybitOpenPositions } = require('../services/exchangeService');
    const exchangeConfig = isExchangeTradingEnabled();
    
    if (!exchangeConfig.enabled || this.activeTrades.length === 0) {
      return; // No Bybit or no trades to sync
    }
    
    try {
      const exchange = getPreferredExchange();
      const bybitPositions = await getBybitOpenPositions(
        exchange.apiKey,
        exchange.apiSecret,
        exchange.baseUrl
      );
      
      if (bybitPositions.length === 0) {
        // No positions on Bybit - but don't mark as closed if API call failed
        // Only log warning, don't update quantities if we can't verify
        console.log(`⚠️ No positions found on Bybit - trades may be closed or API call failed`);
        console.log(`   Keeping existing trade data until successful sync`);
        return;
      }
      
      // Update quantities from Bybit (source of truth)
      let syncedCount = 0;
      this.activeTrades.forEach(trade => {
        const bybitPos = bybitPositions.find(p => p.coin === trade.symbol);
        
        if (bybitPos) {
          const oldQuantity = trade.quantity || 0;
          trade.quantity = bybitPos.quantity;
          trade.bybitQuantity = bybitPos.quantity;
          trade.bybitFree = bybitPos.free;
          trade.bybitLocked = bybitPos.locked;
          trade.lastSyncedWithBybit = new Date();
          
          if (Math.abs(oldQuantity - bybitPos.quantity) > 0.00000001) {
            console.log(`🔄 ${trade.symbol}: Synced with Bybit - Quantity: ${oldQuantity.toFixed(8)} → ${bybitPos.quantity.toFixed(8)}`);
            syncedCount++;
          }
        } else if (trade.quantity > 0) {
          // Trade in memory but not on Bybit
          trade.bybitQuantity = 0;
          trade.lastSyncedWithBybit = new Date();
        }
      });
      
      if (syncedCount > 0) {
        // Save synced trades
        const { saveTrades } = require('../services/tradePersistenceService');
        await saveTrades(this.activeTrades);
        console.log(`💾 Synced ${syncedCount} trades with Bybit positions`);
      }
    } catch (error) {
      console.error(`❌ Error syncing with Bybit positions: ${error.message}`);
    }
  }

  async updateActiveTrades() {
    if (this.activeTrades.length === 0) {
      return;
    }

    // Sync with Bybit positions first (source of truth for quantities)
    await this.syncWithBybitPositions();

    addLogEntry(`Updating ${this.activeTrades.length} active trades...`, 'info');

    // Filter only OPEN or DCA_HIT trades
    const activeTradesToUpdate = this.activeTrades.filter(t => t.status === 'OPEN' || t.status === 'DCA_HIT');
    const maxDcaPerTrade = this.tradeAutomationRules?.dca?.maxPerTrade || 5;
    const dcaCooldownMs = (this.tradeAutomationRules?.dca?.cooldownMinutes || 0) * 60 * 1000;
    
    if (activeTradesToUpdate.length === 0) {
      return;
    }

    // Process trades in batches of 10 for parallel price fetching
    const BATCH_SIZE = 10;
    for (let i = 0; i < activeTradesToUpdate.length; i += BATCH_SIZE) {
      const batch = activeTradesToUpdate.slice(i, i + BATCH_SIZE);
      
      // Fetch prices for all trades in batch in parallel
      const pricePromises = batch.map(trade => {
        const coinData = trade.coinData || { 
          symbol: trade.symbol, 
          name: trade.name,
          id: trade.coinId,
          coinmarketcap_id: trade.coinmarketcap_id,
          coinpaprika_id: trade.coinpaprika_id
        };
        return fetchEnhancedPriceData(coinData, this.priceCache, this.stats, config)
          .then(priceResult => ({ trade, priceResult, success: true }))
          .catch(error => {
            console.error(`⚠️ Price fetch failed for ${trade.symbol}:`, error.message);
            return { trade, priceResult: null, success: false, error };
          });
      });
      
      const priceResults = await Promise.allSettled(pricePromises);
      
      // Process each trade with its price result
      for (let j = 0; j < priceResults.length; j++) {
        const result = priceResults[j];
        if (result.status !== 'fulfilled') {
          continue;
        }
        
        const { trade, priceResult, success } = result.value;
        
        if (!success || !priceResult) {
          continue;
        }

      try {
        
        // Handle different price formats
        let currentPrice = 0;
        if (priceResult && priceResult.data) {
          const priceValue = priceResult.data.price;
          if (typeof priceValue === 'number') {
            currentPrice = priceValue;
          } else if (typeof priceValue === 'string') {
            currentPrice = parseFloat(priceValue.replace(/[^0-9.]/g, '')) || 0;
          }
        }
        
        // Coin-specific price validation (prevent wrong coin data)
        const getPriceRange = (symbol) => {
          const ranges = {
            'BTC': { min: 1000, max: 200000 },
            'ETH': { min: 100, max: 10000 },
            'BNB': { min: 10, max: 2000 },
            'SOL': { min: 1, max: 500 },
            'XRP': { min: 0.01, max: 10 },
            'DOGE': { min: 0.001, max: 1 },
            'ADA': { min: 0.01, max: 10 },
            'AVAX': { min: 1, max: 200 },
            'LINK': { min: 1, max: 100 },
            'DOT': { min: 0.1, max: 100 }
          };
          return ranges[symbol] || { min: 0.0001, max: 1000000 };
        };
        
        const priceRange = getPriceRange(trade.symbol);
        if (currentPrice < priceRange.min || currentPrice > priceRange.max) {
          addLogEntry(`⚠️ ${trade.symbol}: Invalid price for coin ($${currentPrice.toFixed(2)}), expected range $${priceRange.min}-$${priceRange.max}. Using last known price $${trade.currentPrice.toFixed(2)}`, 'warning');
          continue; // Skip this trade update
        }
        
        // If price fetch failed, use last known price and skip update
        if (!currentPrice || currentPrice === 0) {
          addLogEntry(`⚠️ ${trade.symbol}: Price fetch failed, using last known price $${trade.currentPrice.toFixed(2)}`, 'warning');
          continue; // Skip this trade update but don't mark as error
        }
        
        // Additional validation: price shouldn't change by more than 30% in one update (likely wrong coin)
        if (trade.currentPrice && trade.currentPrice > 0) {
          const priceChangePercent = Math.abs((currentPrice - trade.currentPrice) / trade.currentPrice) * 100;
          if (priceChangePercent > 30) {
            addLogEntry(`⚠️ ${trade.symbol}: Suspicious price change (${priceChangePercent.toFixed(1)}%), using last known price $${trade.currentPrice.toFixed(2)}`, 'warning');
            continue; // Skip this update
          }
        }
        
        trade.currentPrice = currentPrice;

        // Calculate P&L based on position size (USD)
        // Position size is $100, so quantity = $100 / entryPrice
        const positionSizeUSD = 100; // $100 per position
        const quantity = trade.quantity || (positionSizeUSD / trade.entryPrice);
        // Use average entry price if DCAs have been executed, otherwise use original entry
        const avgEntry = trade.averageEntryPrice || trade.entryPrice;
        
        if (trade.action === 'BUY') {
          // For BUY: (currentPrice - avgEntryPrice) * quantity = USD gain/loss
          const priceDiff = currentPrice - avgEntry;
          trade.pnl = priceDiff * quantity; // USD P&L
          trade.pnlPercent = parseFloat(((priceDiff / avgEntry) * 100).toFixed(2));
        } else if (trade.action === 'SELL') { // Short position
          // For SELL (short): (avgEntryPrice - currentPrice) * quantity = USD gain/loss
          const priceDiff = avgEntry - currentPrice;
          trade.pnl = priceDiff * quantity; // USD P&L
          trade.pnlPercent = parseFloat(((priceDiff / avgEntry) * 100).toFixed(2));
        }

        // Trailing Stop Loss Logic
        if (trade.trailingStopLoss && trade.trailingStopLoss.enabled && trade.action === 'BUY' && trade.status === 'OPEN') {
          const trailing = trade.trailingStopLoss;
          const pnlPercent = trade.pnlPercent;
          
          // Update peak price if current price is higher
          if (currentPrice > trailing.peakPrice) {
            trailing.peakPrice = currentPrice;
          }
          
          // Activate trailing stop if profit reaches activation threshold
          if (!trailing.activated && pnlPercent >= trailing.activationPercent) {
            trailing.activated = true;
            const newStopLoss = trailing.peakPrice * (1 - trailing.trailingPercent / 100);
            trailing.currentStopLoss = Math.max(newStopLoss, trade.stopLoss); // Don't go below original SL
            trade.stopLoss = trailing.currentStopLoss;
            addLogEntry(`🔄 ${trade.symbol}: Trailing stop loss activated at $${trailing.peakPrice.toFixed(2)} (${pnlPercent.toFixed(2)}% profit)`, 'info');
          }
          
          // Update trailing stop if activated
          if (trailing.activated) {
            const newStopLoss = trailing.peakPrice * (1 - trailing.trailingPercent / 100);
            if (newStopLoss > trailing.currentStopLoss) {
              trailing.currentStopLoss = newStopLoss;
              trade.stopLoss = trailing.currentStopLoss;
              addLogEntry(`📈 ${trade.symbol}: Trailing stop loss updated to $${trailing.currentStopLoss.toFixed(2)} (peak: $${trailing.peakPrice.toFixed(2)})`, 'info');
            }
          }
        }

        await this.applyPartialTakeProfits(trade, currentPrice);

        let notificationNeeded = false;
        let notificationMessage = '';
        let notificationLevel = 'info';

        if (trade.action === 'BUY') {
          // Check Take Profit for BUY (highest priority)
          if (currentPrice >= trade.takeProfit && trade.status === 'OPEN') {
            // Execute Take Profit order
            const tpResult = await executeTakeProfit(trade);
            const executionPrice = tpResult.price || trade.takeProfit || currentPrice;
            
            // Recalculate P&L based on actual execution price (TP price), not current price
            const avgEntry = trade.averageEntryPrice || trade.entryPrice;
            const quantity = trade.quantity || 0;
            const priceDiff = executionPrice - avgEntry;
            const finalPnl = priceDiff * quantity;
            const finalPnlPercent = parseFloat(((priceDiff / avgEntry) * 100).toFixed(2));
            
            if (tpResult.success) {
              trade.status = 'TP_HIT';
              trade.executedAt = new Date();
              trade.executionPrice = executionPrice;
              trade.executionOrderId = tpResult.orderId;
              // Update P&L with actual execution price
              trade.pnl = finalPnl;
              trade.pnlPercent = finalPnlPercent;
              notificationMessage = `✅ TAKE PROFIT EXECUTED: ${trade.symbol} sold ${tpResult.executedQty} at $${executionPrice.toFixed(2)} (Profit: ${finalPnlPercent >= 0 ? '+' : ''}${finalPnlPercent.toFixed(2)}%)`;
              notificationLevel = 'success';
              notificationNeeded = true;
              addLogEntry(`✅ TP EXECUTED: ${trade.symbol} - Order ID: ${tpResult.orderId}`, 'success');
              this.recordTradeOutcome(trade, 'TAKE_PROFIT');
            } else if (!tpResult.skipped) {
              // Only log if it's an actual error (not just disabled)
              trade.status = 'TP_HIT'; // Mark as hit even if execution failed
              trade.executionPrice = executionPrice;
              // Update P&L with actual execution price
              trade.pnl = finalPnl;
              trade.pnlPercent = finalPnlPercent;
              notificationMessage = `✅ TAKE PROFIT HIT (Execution ${tpResult.error ? 'failed' : 'skipped'}): ${trade.symbol} at $${executionPrice.toFixed(2)} (Profit: ${finalPnlPercent >= 0 ? '+' : ''}${finalPnlPercent.toFixed(2)}%)`;
              notificationLevel = 'success';
              notificationNeeded = true;
              addLogEntry(`⚠️ TP hit but execution failed: ${trade.symbol} - ${tpResult.error}`, 'warning');
              this.recordTradeOutcome(trade, 'TAKE_PROFIT');
            }
          }
          // Check DCA for BUY (BEFORE stop loss - priority!)
          // LONG: First DCA at 10% loss, then 12% from average for each subsequent DCA (max 5 total)
          else if (trade.status === 'OPEN' && (trade.dcaCount || 0) < maxDcaPerTrade) {
            const avgEntry = trade.averageEntryPrice || trade.entryPrice;
            let dcaLevel = 0;
            
            if (trade.dcaCount === 0) {
              // First DCA: 10% loss from original entry
              dcaLevel = trade.entryPrice * 0.90; // 10% down
            } else {
              // Subsequent DCAs: 12% loss from current average entry
              dcaLevel = avgEntry * 0.88; // 12% down from average
            }
            
            // Check if price hit DCA level
            if (currentPrice <= dcaLevel && !trade.dcaNotified) {
              const now = Date.now();
              if (dcaCooldownMs > 0 && trade.lastDcaAt && (now - trade.lastDcaAt) < dcaCooldownMs) {
                addLogEntry(`🕒 ${trade.symbol}: DCA cooldown active (${Math.round((dcaCooldownMs - (now - trade.lastDcaAt)) / 60000)}m remaining)`, 'info');
              } else {
              // Execute Add Position (DCA) order with retry logic
              let dcaResult = null;
              let retryCount = 0;
              const maxRetries = 2;
              
              while (retryCount <= maxRetries && (!dcaResult || !dcaResult.success)) {
                if (retryCount > 0) {
                  console.log(`🔄 Retrying DCA execution for ${trade.symbol} (attempt ${retryCount + 1}/${maxRetries + 1})...`);
                  await sleep(2000); // Wait 2 seconds before retry
                }
                
                try {
                  dcaResult = await executeAddPosition(trade);
                  
              if (dcaResult.success) {
                    break; // Success, exit retry loop
                  } else if (dcaResult.skipped) {
                    break; // Skipped (e.g., trading disabled), don't retry
                  }
                  
                  retryCount++;
                } catch (error) {
                  console.error(`❌ DCA execution error for ${trade.symbol} (attempt ${retryCount + 1}):`, error.message);
                  dcaResult = {
                    success: false,
                    error: error.message,
                    skipped: false
                  };
                  retryCount++;
                }
              }
              
              if (dcaResult && dcaResult.success) {
                trade.status = 'DCA_HIT';
                trade.dcaCount = (trade.dcaCount || 0) + 1;
                trade.dcaExecutedAt = new Date();
                trade.dcaExecutionPrice = dcaResult.price || currentPrice;
                trade.dcaOrderId = dcaResult.orderId;
                trade.dcaQuantity = dcaResult.executedQty;
                
                // Update average entry price (weighted average)
                const oldQuantity = trade.quantity || 1;
                const totalQuantity = oldQuantity + dcaResult.executedQty;
                const oldAvgEntry = avgEntry;
                trade.averageEntryPrice = ((avgEntry * oldQuantity) + (dcaResult.price * dcaResult.executedQty)) / totalQuantity;
                trade.quantity = totalQuantity;
                
                // Recalculate P&L based on new average entry
                const pnlFromAvg = currentPrice - trade.averageEntryPrice;
                const pnlPercentFromAvg = (pnlFromAvg / trade.averageEntryPrice) * 100;
                trade.pnl = pnlFromAvg;
                trade.pnlPercent = pnlPercentFromAvg;
                
                // Update TP/SL percentages based on new average entry (optional - keep original targets or adjust)
                // For now, we keep the original TP/SL price targets but recalculate the percentage gains
                const tpGainPercent = ((trade.takeProfit - trade.averageEntryPrice) / trade.averageEntryPrice) * 100;
                const slLossPercent = ((trade.averageEntryPrice - trade.stopLoss) / trade.averageEntryPrice) * 100;
                
                notificationMessage = `💰 DCA #${trade.dcaCount} EXECUTED: ${trade.symbol} bought ${dcaResult.executedQty} at $${dcaResult.price.toFixed(2)}\n` +
                  `   📊 Avg Entry: $${oldAvgEntry.toFixed(2)} → $${trade.averageEntryPrice.toFixed(2)}\n` +
                  `   📦 Position Size: ${oldQuantity.toFixed(4)} → ${totalQuantity.toFixed(4)}\n` +
                  `   💹 Current P&L: ${pnlPercentFromAvg >= 0 ? '+' : ''}${pnlPercentFromAvg.toFixed(2)}%\n` +
                  `   🎯 TP Target: ${tpGainPercent.toFixed(2)}% | SL Risk: ${slLossPercent.toFixed(2)}%`;
                notificationLevel = 'warning';
                notificationNeeded = true;
                trade.dcaNotified = true;
                trade.lastDcaAt = now;
                addLogEntry(`💰 DCA #${trade.dcaCount} EXECUTED: ${trade.symbol} - Order ID: ${dcaResult.orderId}`, 'info');
                addLogEntry(`📊 ${trade.symbol} metrics updated: Avg Entry $${trade.averageEntryPrice.toFixed(2)}, Size ${totalQuantity.toFixed(4)}, P&L ${pnlPercentFromAvg.toFixed(2)}%`, 'info');
                
                // Explicitly save trade after successful DCA
                try {
                  await saveTrades(this.activeTrades);
                  console.log(`💾 Saved ${trade.symbol} trade after DCA #${trade.dcaCount} execution`);
                } catch (saveError) {
                  console.error(`❌ Failed to save ${trade.symbol} trade after DCA:`, saveError.message);
                }
                
                // Trigger re-evaluation of ALL open trades after DCA execution (with 1-hour cooldown)
                // Always check persisted value to ensure cooldown persists across restarts
                const persistedTimestamp = getDcaTriggerTimestamp();
                const lastDcaReeval = Math.max(this.lastDcaTriggerReevalAt || 0, persistedTimestamp || 0);
                const elapsedSinceLastDcaReeval = now - lastDcaReeval;
                const timeSinceStartup = now - this.botStartTime;
                
                // Check startup delay, cooldown, AND if re-evaluation is already in progress
                if (!this.dcaTriggerReevalInProgress && 
                    timeSinceStartup >= this.dcaTriggerStartupDelayMs &&
                    elapsedSinceLastDcaReeval >= this.dcaTriggerReevalCooldownMs) {
                  // Set flag AND timestamp IMMEDIATELY to prevent other DCAs from triggering
                  this.dcaTriggerReevalInProgress = true;
                  const triggerTimestamp = Date.now();
                  this.lastDcaTriggerReevalAt = triggerTimestamp; // Set immediately, not inside async callback
                  await setDcaTriggerTimestamp(triggerTimestamp); // Persist to portfolio state
                  console.log(`🔄 [DCA TRIGGER] DCA executed for ${trade.symbol} - triggering re-evaluation of ALL open trades (3-hour cooldown starts now)...`);
                  addLogEntry(`🔄 DCA executed for ${trade.symbol} - triggering re-evaluation of all open trades (3-hour cooldown)`, 'info');
                  
                  // Trigger re-evaluation asynchronously (don't block DCA execution)
                  setImmediate(async () => {
                    try {
                      await this.reevaluateOpenTradesWithAI();
                    } catch (reevalError) {
                      console.error(`❌ Error during DCA-triggered re-evaluation:`, reevalError.message);
                      addLogEntry(`❌ Error during DCA-triggered re-evaluation: ${reevalError.message}`, 'error');
                    } finally {
                      // Always clear the flag when done (success or error)
                      this.dcaTriggerReevalInProgress = false;
                    }
                  });
                } else if (this.dcaTriggerReevalInProgress) {
                  console.log(`⏱️ Skipping DCA-triggered re-evaluation (already in progress)`);
                  addLogEntry(`⏱️ Skipped DCA-triggered re-evaluation (already in progress)`, 'info');
                } else if (timeSinceStartup < this.dcaTriggerStartupDelayMs) {
                  const remainingStartupDelay = Math.ceil((this.dcaTriggerStartupDelayMs - timeSinceStartup) / 60000);
                  console.log(`⏱️ Skipping DCA-triggered re-evaluation (startup delay ${remainingStartupDelay}min remaining)`);
                  addLogEntry(`⏱️ Skipped DCA-triggered re-evaluation (startup delay ${remainingStartupDelay}min remaining)`, 'info');
                } else {
                  const remainingCooldownMs = this.dcaTriggerReevalCooldownMs - elapsedSinceLastDcaReeval;
                  const remainingHours = Math.floor(remainingCooldownMs / 3600000);
                  const remainingMinutes = Math.ceil((remainingCooldownMs % 3600000) / 60000);
                  console.log(`⏱️ Skipping DCA-triggered re-evaluation (unified cooldown: ${remainingHours}h ${remainingMinutes}m remaining)`);
                  addLogEntry(`⏱️ Skipped DCA-triggered re-evaluation (cooldown: ${remainingHours}h ${remainingMinutes}m remaining)`, 'info');
                }
              } else if (dcaResult && !dcaResult.skipped) {
                // DCA failed after retries - mark as hit but don't increment count
                // This allows it to retry on next price update
                trade.status = 'DCA_HIT';
                // Don't set dcaNotified = true here - allow retry on next update
                // Only set it if we've exhausted retries
                if (retryCount > maxRetries) {
                  trade.dcaNotified = true; // Prevent infinite retries
                  trade.lastDcaAt = now; // Set cooldown
                }
                notificationMessage = `💰 DCA #${trade.dcaCount + 1} (Execution ${dcaResult.error ? 'failed' : 'skipped'}): ${trade.symbol} at $${currentPrice.toFixed(2)}. ${retryCount > maxRetries ? 'Max retries reached.' : 'Will retry on next update.'}`;
                notificationLevel = 'warning';
                notificationNeeded = true;
                addLogEntry(`⚠️ DCA hit but execution failed for ${trade.symbol} after ${retryCount} attempts: ${dcaResult.error || 'Unknown error'}`, 'warning');
                
                // Still save the trade state even on failure
                try {
                  await saveTrades(this.activeTrades);
                  console.log(`💾 Saved ${trade.symbol} trade state after DCA failure`);
                } catch (saveError) {
                  console.error(`❌ Failed to save ${trade.symbol} trade after DCA failure:`, saveError.message);
                }
              }
              }
            }
          }
          // Reset DCA_HIT back to OPEN if price moves away from DCA level
          else if (trade.status === 'DCA_HIT') {
            const avgEntry = trade.averageEntryPrice || trade.entryPrice;
            let nextDcaLevel = 0;
            if (trade.dcaCount === 0) {
              nextDcaLevel = trade.entryPrice * 0.90;
            } else {
              nextDcaLevel = avgEntry * 0.88;
            }
            
            if (currentPrice > nextDcaLevel && (trade.dcaCount || 0) < maxDcaPerTrade) {
              trade.status = 'OPEN';
              trade.dcaNotified = false; // Reset so it can trigger again if price drops back
            }
          }
          // Check Stop Loss for BUY (LAST - only after all 5 DCAs used)
          else if (currentPrice <= trade.stopLoss && trade.status === 'OPEN' && (trade.dcaCount || 0) >= maxDcaPerTrade) {
            // Execute Stop Loss order (only after all 5 DCAs used)
            const slResult = await executeStopLoss(trade);
            const executionPrice = slResult.price || trade.stopLoss || currentPrice;
            
            // Recalculate P&L based on actual execution price (SL price), not current price
            const avgEntry = trade.averageEntryPrice || trade.entryPrice;
            const quantity = trade.quantity || 0;
            const priceDiff = executionPrice - avgEntry;
            const finalPnl = priceDiff * quantity;
            const finalPnlPercent = parseFloat(((priceDiff / avgEntry) * 100).toFixed(2));
            
            if (slResult.success) {
              trade.status = 'SL_HIT';
              trade.executedAt = new Date();
              trade.executionPrice = executionPrice;
              trade.executionOrderId = slResult.orderId;
              // Update P&L with actual execution price
              trade.pnl = finalPnl;
              trade.pnlPercent = finalPnlPercent;
              notificationMessage = `❌ STOP LOSS EXECUTED: ${trade.symbol} sold ${slResult.executedQty} at $${executionPrice.toFixed(2)} (Loss: ${finalPnlPercent >= 0 ? '+' : ''}${finalPnlPercent.toFixed(2)}%)`;
              notificationLevel = 'error';
              notificationNeeded = true;
              addLogEntry(`🛑 SL EXECUTED: ${trade.symbol} - Order ID: ${slResult.orderId}`, 'error');
              this.recordTradeOutcome(trade, 'STOP_LOSS');
            } else if (!slResult.skipped) {
              trade.status = 'SL_HIT';
              trade.executionPrice = executionPrice;
              // Update P&L with actual execution price
              trade.pnl = finalPnl;
              trade.pnlPercent = finalPnlPercent;
              notificationMessage = `❌ STOP LOSS HIT (Execution ${slResult.error ? 'failed' : 'skipped'}): ${trade.symbol} at $${executionPrice.toFixed(2)} (Loss: ${finalPnlPercent >= 0 ? '+' : ''}${finalPnlPercent.toFixed(2)}%)`;
              notificationLevel = 'error';
              notificationNeeded = true;
              addLogEntry(`⚠️ SL hit but execution failed: ${trade.symbol} - ${slResult.error}`, 'error');
              this.recordTradeOutcome(trade, 'STOP_LOSS');
            }
          }
        } else if (trade.action === 'SELL') { // Short position logic
          // Check Take Profit for SELL (highest priority)
          if (currentPrice <= trade.takeProfit && trade.status === 'OPEN') {
            // Execute Take Profit order (cover short)
            const tpResult = await executeTakeProfit(trade);
            const executionPrice = tpResult.price || trade.takeProfit || currentPrice;
            
            // Recalculate P&L based on actual execution price (TP price), not current price
            // For SHORT: (avgEntryPrice - executionPrice) * quantity = USD gain/loss
            const avgEntry = trade.averageEntryPrice || trade.entryPrice;
            const quantity = trade.quantity || 0;
            const priceDiff = avgEntry - executionPrice; // For short, profit when price goes down
            const finalPnl = priceDiff * quantity;
            const finalPnlPercent = parseFloat(((priceDiff / avgEntry) * 100).toFixed(2));
            
            if (tpResult.success) {
              trade.status = 'TP_HIT';
              trade.executedAt = new Date();
              trade.executionPrice = executionPrice;
              trade.executionOrderId = tpResult.orderId;
              // Update P&L with actual execution price
              trade.pnl = finalPnl;
              trade.pnlPercent = finalPnlPercent;
              notificationMessage = `✅ TAKE PROFIT EXECUTED (SHORT): ${trade.symbol} covered ${tpResult.executedQty} at $${executionPrice.toFixed(2)} (Profit: ${finalPnlPercent >= 0 ? '+' : ''}${finalPnlPercent.toFixed(2)}%)`;
              notificationLevel = 'success';
              notificationNeeded = true;
              addLogEntry(`✅ TP EXECUTED (SHORT): ${trade.symbol} - Order ID: ${tpResult.orderId}`, 'success');
              this.recordTradeOutcome(trade, 'TAKE_PROFIT');
            } else if (!tpResult.skipped) {
              trade.status = 'TP_HIT';
              trade.executionPrice = executionPrice;
              // Update P&L with actual execution price
              trade.pnl = finalPnl;
              trade.pnlPercent = finalPnlPercent;
              notificationMessage = `✅ TAKE PROFIT HIT (SHORT, Execution ${tpResult.error ? 'failed' : 'skipped'}): ${trade.symbol} at $${executionPrice.toFixed(2)} (Profit: ${finalPnlPercent >= 0 ? '+' : ''}${finalPnlPercent.toFixed(2)}%)`;
              notificationLevel = 'success';
              notificationNeeded = true;
              addLogEntry(`⚠️ TP hit but execution failed (SHORT): ${trade.symbol} - ${tpResult.error}`, 'warning');
              this.recordTradeOutcome(trade, 'TAKE_PROFIT');
            }
          }
          // Check DCA for SELL (BEFORE stop loss - priority!)
          // SHORT: First DCA at 15% loss, then 25% from average for each subsequent DCA (max 5 total)
          else if (trade.status === 'OPEN' && (trade.dcaCount || 0) < maxDcaPerTrade) {
            const avgEntry = trade.averageEntryPrice || trade.entryPrice;
            let dcaLevel = 0;
            
            if (trade.dcaCount === 0) {
              // First DCA: 15% loss from original entry (price rises 15%)
              dcaLevel = trade.entryPrice * 1.15; // 15% up
            } else {
              // Subsequent DCAs: 25% loss from current average entry (price rises 25% from average)
              dcaLevel = avgEntry * 1.25; // 25% up from average
            }
            
            // Check if price hit DCA level
            if (currentPrice >= dcaLevel && !trade.dcaNotified) {
              const now = Date.now();
              if (dcaCooldownMs > 0 && trade.lastDcaAt && (now - trade.lastDcaAt) < dcaCooldownMs) {
                addLogEntry(`🕒 ${trade.symbol}: DCA cooldown active (${Math.round((dcaCooldownMs - (now - trade.lastDcaAt)) / 60000)}m remaining)`, 'info');
              } else {
              // Execute Add Position (DCA) order (short more) with retry logic
              let dcaResult = null;
              let retryCount = 0;
              const maxRetries = 2;
              
              while (retryCount <= maxRetries && (!dcaResult || !dcaResult.success)) {
                if (retryCount > 0) {
                  console.log(`🔄 Retrying DCA execution for ${trade.symbol} (SHORT) (attempt ${retryCount + 1}/${maxRetries + 1})...`);
                  await sleep(2000); // Wait 2 seconds before retry
                }
                
                try {
                  dcaResult = await executeAddPosition(trade);
                  
              if (dcaResult.success) {
                    break; // Success, exit retry loop
                  } else if (dcaResult.skipped) {
                    break; // Skipped (e.g., trading disabled), don't retry
                  }
                  
                  retryCount++;
                } catch (error) {
                  console.error(`❌ DCA execution error for ${trade.symbol} (SHORT) (attempt ${retryCount + 1}):`, error.message);
                  dcaResult = {
                    success: false,
                    error: error.message,
                    skipped: false
                  };
                  retryCount++;
                }
              }
              
              if (dcaResult && dcaResult.success) {
                trade.status = 'DCA_HIT';
                trade.dcaCount = (trade.dcaCount || 0) + 1;
                trade.dcaExecutedAt = new Date();
                trade.dcaExecutionPrice = dcaResult.price || currentPrice;
                trade.dcaOrderId = dcaResult.orderId;
                trade.dcaQuantity = dcaResult.executedQty;
                
                // Update average entry price (weighted average for short)
                const oldQuantity = trade.quantity || 1;
                const totalQuantity = oldQuantity + dcaResult.executedQty;
                const oldAvgEntry = avgEntry;
                trade.averageEntryPrice = ((avgEntry * oldQuantity) + (dcaResult.price * dcaResult.executedQty)) / totalQuantity;
                trade.quantity = totalQuantity;
                
                // Recalculate P&L based on new average entry (SHORT: profit when price goes down)
                const pnlFromAvg = trade.averageEntryPrice - currentPrice;
                const pnlPercentFromAvg = (pnlFromAvg / trade.averageEntryPrice) * 100;
                trade.pnl = pnlFromAvg;
                trade.pnlPercent = pnlPercentFromAvg;
                
                // Update TP/SL percentages based on new average entry
                const tpGainPercent = ((trade.averageEntryPrice - trade.takeProfit) / trade.averageEntryPrice) * 100;
                const slLossPercent = ((trade.stopLoss - trade.averageEntryPrice) / trade.averageEntryPrice) * 100;
                
                notificationMessage = `💰 DCA #${trade.dcaCount} EXECUTED (SHORT): ${trade.symbol} shorted ${dcaResult.executedQty} more at $${dcaResult.price.toFixed(2)}\n` +
                  `   📊 Avg Entry: $${oldAvgEntry.toFixed(2)} → $${trade.averageEntryPrice.toFixed(2)}\n` +
                  `   📦 Position Size: ${oldQuantity.toFixed(4)} → ${totalQuantity.toFixed(4)}\n` +
                  `   💹 Current P&L: ${pnlPercentFromAvg >= 0 ? '+' : ''}${pnlPercentFromAvg.toFixed(2)}%\n` +
                  `   🎯 TP Target: ${tpGainPercent.toFixed(2)}% | SL Risk: ${slLossPercent.toFixed(2)}%`;
                notificationLevel = 'warning';
                notificationNeeded = true;
                trade.dcaNotified = true;
                trade.lastDcaAt = now;
                addLogEntry(`💰 DCA #${trade.dcaCount} EXECUTED (SHORT): ${trade.symbol} - Order ID: ${dcaResult.orderId}`, 'info');
                addLogEntry(`📊 ${trade.symbol} metrics updated: Avg Entry $${trade.averageEntryPrice.toFixed(2)}, Size ${totalQuantity.toFixed(4)}, P&L ${pnlPercentFromAvg.toFixed(2)}%`, 'info');
                
                // Explicitly save trade after successful DCA
                try {
                  await saveTrades(this.activeTrades);
                  console.log(`💾 Saved ${trade.symbol} trade after DCA #${trade.dcaCount} execution (SHORT)`);
                } catch (saveError) {
                  console.error(`❌ Failed to save ${trade.symbol} trade after DCA:`, saveError.message);
                }
                
                // Trigger re-evaluation of ALL open trades after DCA execution (with 1-hour cooldown)
                // Always check persisted value to ensure cooldown persists across restarts
                const persistedTimestamp = getDcaTriggerTimestamp();
                const lastDcaReeval = Math.max(this.lastDcaTriggerReevalAt || 0, persistedTimestamp || 0);
                const elapsedSinceLastDcaReeval = now - lastDcaReeval;
                const timeSinceStartup = now - this.botStartTime;
                
                // Check startup delay, cooldown, AND if re-evaluation is already in progress
                if (!this.dcaTriggerReevalInProgress && 
                    timeSinceStartup >= this.dcaTriggerStartupDelayMs &&
                    elapsedSinceLastDcaReeval >= this.dcaTriggerReevalCooldownMs) {
                  // Set flag AND timestamp IMMEDIATELY to prevent other DCAs from triggering
                  this.dcaTriggerReevalInProgress = true;
                  const triggerTimestamp = Date.now();
                  this.lastDcaTriggerReevalAt = triggerTimestamp; // Set immediately, not inside async callback
                  await setDcaTriggerTimestamp(triggerTimestamp); // Persist to portfolio state
                  console.log(`🔄 [DCA TRIGGER] DCA executed for ${trade.symbol} (SHORT) - triggering re-evaluation of ALL open trades (3-hour cooldown starts now)...`);
                  addLogEntry(`🔄 DCA executed for ${trade.symbol} (SHORT) - triggering re-evaluation of all open trades (3-hour cooldown)`, 'info');
                  
                  // Trigger re-evaluation asynchronously (don't block DCA execution)
                  setImmediate(async () => {
                    try {
                      await this.reevaluateOpenTradesWithAI();
                    } catch (reevalError) {
                      console.error(`❌ Error during DCA-triggered re-evaluation:`, reevalError.message);
                      addLogEntry(`❌ Error during DCA-triggered re-evaluation: ${reevalError.message}`, 'error');
                    } finally {
                      // Always clear the flag when done (success or error)
                      this.dcaTriggerReevalInProgress = false;
                    }
                  });
                } else if (this.dcaTriggerReevalInProgress) {
                  console.log(`⏱️ Skipping DCA-triggered re-evaluation (already in progress)`);
                  addLogEntry(`⏱️ Skipped DCA-triggered re-evaluation (already in progress)`, 'info');
                } else if (timeSinceStartup < this.dcaTriggerStartupDelayMs) {
                  const remainingStartupDelay = Math.ceil((this.dcaTriggerStartupDelayMs - timeSinceStartup) / 60000);
                  console.log(`⏱️ Skipping DCA-triggered re-evaluation (startup delay ${remainingStartupDelay}min remaining)`);
                  addLogEntry(`⏱️ Skipped DCA-triggered re-evaluation (startup delay ${remainingStartupDelay}min remaining)`, 'info');
                } else {
                  const remainingCooldownMs = this.dcaTriggerReevalCooldownMs - elapsedSinceLastDcaReeval;
                  const remainingHours = Math.floor(remainingCooldownMs / 3600000);
                  const remainingMinutes = Math.ceil((remainingCooldownMs % 3600000) / 60000);
                  console.log(`⏱️ Skipping DCA-triggered re-evaluation (unified cooldown: ${remainingHours}h ${remainingMinutes}m remaining)`);
                  addLogEntry(`⏱️ Skipped DCA-triggered re-evaluation (cooldown: ${remainingHours}h ${remainingMinutes}m remaining)`, 'info');
                }
              } else if (dcaResult && !dcaResult.skipped) {
                // DCA failed after retries - mark as hit but don't increment count
                trade.status = 'DCA_HIT';
                // Don't set dcaNotified = true here - allow retry on next update
                if (retryCount > maxRetries) {
                  trade.dcaNotified = true; // Prevent infinite retries
                  trade.lastDcaAt = now; // Set cooldown
                }
                notificationMessage = `💰 DCA #${trade.dcaCount + 1} (SHORT, Execution ${dcaResult.error ? 'failed' : 'skipped'}): ${trade.symbol} at $${currentPrice.toFixed(2)}. ${retryCount > maxRetries ? 'Max retries reached.' : 'Will retry on next update.'}`;
                notificationLevel = 'warning';
                notificationNeeded = true;
                addLogEntry(`⚠️ DCA hit but execution failed for ${trade.symbol} (SHORT) after ${retryCount} attempts: ${dcaResult.error || 'Unknown error'}`, 'warning');
                
                // Still save the trade state even on failure
                try {
                  await saveTrades(this.activeTrades);
                  console.log(`💾 Saved ${trade.symbol} trade state after DCA failure (SHORT)`);
                } catch (saveError) {
                  console.error(`❌ Failed to save ${trade.symbol} trade after DCA failure:`, saveError.message);
                }
              }
              }
            }
          }
          // Reset DCA_HIT back to OPEN if price moves away from DCA level
          else if (trade.status === 'DCA_HIT') {
            const avgEntry = trade.averageEntryPrice || trade.entryPrice;
            let nextDcaLevel = 0;
            if (trade.dcaCount === 0) {
              nextDcaLevel = trade.entryPrice * 1.15;
            } else {
              nextDcaLevel = avgEntry * 1.25;
            }
            
            if (currentPrice < nextDcaLevel && (trade.dcaCount || 0) < maxDcaPerTrade) {
              trade.status = 'OPEN';
              trade.dcaNotified = false; // Reset so it can trigger again if price rises back
            }
          }
          // Check Stop Loss for SELL (LAST - only after all 5 DCAs used)
          else if (currentPrice >= trade.stopLoss && trade.status === 'OPEN' && (trade.dcaCount || 0) >= maxDcaPerTrade) {
            // Execute Stop Loss order (only after all 5 DCAs used)
            const slResult = await executeStopLoss(trade);
            const executionPrice = slResult.price || trade.stopLoss || currentPrice;
            
            // Recalculate P&L based on actual execution price (SL price), not current price
            // For SHORT: (avgEntryPrice - executionPrice) * quantity = USD gain/loss
            const avgEntry = trade.averageEntryPrice || trade.entryPrice;
            const quantity = trade.quantity || 0;
            const priceDiff = avgEntry - executionPrice; // For short, loss when price goes up
            const finalPnl = priceDiff * quantity;
            const finalPnlPercent = parseFloat(((priceDiff / avgEntry) * 100).toFixed(2));
            
            if (slResult.success) {
              trade.status = 'SL_HIT';
              trade.executedAt = new Date();
              trade.executionPrice = executionPrice;
              trade.executionOrderId = slResult.orderId;
              // Update P&L with actual execution price
              trade.pnl = finalPnl;
              trade.pnlPercent = finalPnlPercent;
              notificationMessage = `❌ STOP LOSS EXECUTED (SHORT): ${trade.symbol} covered ${slResult.executedQty} at $${executionPrice.toFixed(2)} (Loss: ${finalPnlPercent >= 0 ? '+' : ''}${finalPnlPercent.toFixed(2)}%)`;
              notificationLevel = 'error';
              notificationNeeded = true;
              addLogEntry(`🛑 SL EXECUTED (SHORT): ${trade.symbol} - Order ID: ${slResult.orderId}`, 'error');
              this.recordTradeOutcome(trade, 'STOP_LOSS');
            } else if (!slResult.skipped) {
              trade.status = 'SL_HIT';
              trade.executionPrice = executionPrice;
              // Update P&L with actual execution price
              trade.pnl = finalPnl;
              trade.pnlPercent = finalPnlPercent;
              notificationMessage = `❌ STOP LOSS HIT (SHORT, Execution ${slResult.error ? 'failed' : 'skipped'}): ${trade.symbol} at $${executionPrice.toFixed(2)} (Loss: ${finalPnlPercent >= 0 ? '+' : ''}${finalPnlPercent.toFixed(2)}%)`;
              notificationLevel = 'error';
              notificationNeeded = true;
              addLogEntry(`⚠️ SL hit but execution failed (SHORT): ${trade.symbol} - ${slResult.error}`, 'error');
              this.recordTradeOutcome(trade, 'STOP_LOSS');
            }
          }
        }

        addLogEntry(`${trade.symbol}: Current Price $${currentPrice.toFixed(2)}, P&L: ${trade.pnlPercent}% (Status: ${trade.status})`, 'info');

        if (notificationNeeded) {
          addLogEntry(notificationMessage, notificationLevel);
          // TODO: Send Telegram notification for status change
        }

      } catch (error) {
        addLogEntry(`⚠️ Failed to update trade for ${trade.symbol}: ${error.message}. Will retry on next scan.`, 'warning');
        // Don't mark as ERROR - just skip this update and retry next scan
        // This handles temporary API failures gracefully
      }
      }
      
      // Small delay between batches to respect rate limits
      if (i + BATCH_SIZE < activeTradesToUpdate.length) {
        await sleep(100); // 100ms delay between batches (reduced from 200ms)
      }
    }
    
    // Move closed trades (TP_HIT, SL_HIT) from activeTrades to closedTrades
    const closedTradesToMove = this.activeTrades.filter(t => t.status === 'TP_HIT' || t.status === 'SL_HIT');
    if (closedTradesToMove.length > 0) {
      for (const trade of closedTradesToMove) {
        // Ensure execution price is set (should be set when TP/SL is hit)
        let executionPrice = trade.executionPrice;
        
        // If execution price is missing, try to infer from status
        if (!executionPrice) {
          if (trade.status === 'TP_HIT') {
            executionPrice = trade.takeProfit || trade.currentPrice;
          } else if (trade.status === 'SL_HIT') {
            executionPrice = trade.stopLoss || trade.currentPrice;
          } else {
            executionPrice = trade.currentPrice;
          }
        }
        
        // Validate status matches execution price (sanity check)
        if (trade.status === 'TP_HIT') {
          // For BUY: execution price should be >= TP (within 5% tolerance for slippage)
          // For SELL: execution price should be <= TP (within 5% tolerance for slippage)
          const tolerance = 0.05; // 5% tolerance
          const tpPrice = trade.takeProfit;
          if (trade.action === 'BUY' && executionPrice < tpPrice * (1 - tolerance)) {
            console.warn(`⚠️ ${trade.symbol}: TP_HIT status but execution price ($${executionPrice.toFixed(2)}) is much lower than TP ($${tpPrice.toFixed(2)}). Using TP price.`);
            executionPrice = tpPrice; // Use TP price if execution price seems wrong
          } else if (trade.action === 'SELL' && executionPrice > tpPrice * (1 + tolerance)) {
            console.warn(`⚠️ ${trade.symbol}: TP_HIT status but execution price ($${executionPrice.toFixed(2)}) is much higher than TP ($${tpPrice.toFixed(2)}). Using TP price.`);
            executionPrice = tpPrice; // Use TP price if execution price seems wrong
          }
        } else if (trade.status === 'SL_HIT') {
          // For BUY: execution price should be <= SL (within 5% tolerance)
          // For SELL: execution price should be >= SL (within 5% tolerance)
          const tolerance = 0.05; // 5% tolerance
          const slPrice = trade.stopLoss;
          if (trade.action === 'BUY' && executionPrice > slPrice * (1 + tolerance)) {
            console.warn(`⚠️ ${trade.symbol}: SL_HIT status but execution price ($${executionPrice.toFixed(2)}) is much higher than SL ($${slPrice.toFixed(2)}). Using SL price.`);
            executionPrice = slPrice; // Use SL price if execution price seems wrong
          } else if (trade.action === 'SELL' && executionPrice < slPrice * (1 - tolerance)) {
            console.warn(`⚠️ ${trade.symbol}: SL_HIT status but execution price ($${executionPrice.toFixed(2)}) is much lower than SL ($${slPrice.toFixed(2)}). Using SL price.`);
            executionPrice = slPrice; // Use SL price if execution price seems wrong
          }
        }
        
        // Recalculate P&L to ensure accuracy (use execution price, not current price)
        const avgEntry = trade.averageEntryPrice || trade.entryPrice;
        const quantity = trade.quantity || 0;
        let finalPnl = trade.pnl;
        let finalPnlPercent = trade.pnlPercent;
        
        // Always recalculate P&L based on execution price to ensure accuracy
        if (trade.action === 'BUY') {
          const priceDiff = executionPrice - avgEntry;
          finalPnl = priceDiff * quantity;
          finalPnlPercent = parseFloat(((priceDiff / avgEntry) * 100).toFixed(2));
        } else if (trade.action === 'SELL') {
          const priceDiff = avgEntry - executionPrice; // For short, profit when price goes down
          finalPnl = priceDiff * quantity;
          finalPnlPercent = parseFloat(((priceDiff / avgEntry) * 100).toFixed(2));
        }
        
        // Validate status matches P&L (sanity check)
        if (trade.status === 'TP_HIT' && finalPnlPercent < 0) {
          console.warn(`⚠️ ${trade.symbol}: TP_HIT status but P&L is negative (${finalPnlPercent.toFixed(2)}%). This may indicate incorrect status or execution price.`);
        } else if (trade.status === 'SL_HIT' && finalPnlPercent > 0) {
          console.warn(`⚠️ ${trade.symbol}: SL_HIT status but P&L is positive (${finalPnlPercent.toFixed(2)}%). This may indicate incorrect status or execution price.`);
        }
        
        // Check if this trade is already in closedTrades (prevent duplicates)
        const tradeId = trade.id || trade.tradeId;
        const alreadyClosed = this.closedTrades.find(ct => 
          (ct.id === tradeId || ct.tradeId === tradeId) && 
          ct.symbol === trade.symbol
        );
        
        if (alreadyClosed) {
          console.log(`⏭️ ${trade.symbol} trade (id: ${tradeId}) already exists in closedTrades. Skipping duplicate.`);
          continue; // Skip adding duplicate
        }
        
        const closedTrade = {
          ...trade,
          closedAt: trade.executedAt || new Date(),
          closePrice: executionPrice,
          closeReason: trade.status === 'TP_HIT' ? 'Take Profit Hit' : 'Stop Loss Hit',
          finalPnl: finalPnl,
          finalPnlPercent: finalPnlPercent,
          executionPrice: executionPrice // Ensure this is set
        };
        this.closedTrades.push(closedTrade);
        
        // Update portfolio with closed trade (use recalculated values)
        await closeTrade(
          trade.symbol,
          finalPnl || 0,
          finalPnlPercent || 0,
          avgEntry,
          executionPrice,
          quantity || 0
        );
      }
      
      // Remove closed trades from active trades
      this.activeTrades = this.activeTrades.filter(t => t.status !== 'TP_HIT' && t.status !== 'SL_HIT');
      
      // Keep only last 100 closed trades in memory
      if (this.closedTrades.length > 100) {
        this.closedTrades = this.closedTrades.slice(-100);
      }
      
      // Save closed trades
      await this.saveClosedTrades();
      
      console.log(`✅ Moved ${closedTradesToMove.length} closed trade(s) to closedTrades and updated portfolio`);
    }
    
    // Sync trades from DynamoDB BEFORE saving - reload any open trades that exist in DB but not in memory
    // This prevents losing trades that were in DynamoDB but somehow not in memory
    try {
      const { loadTrades } = require('../services/tradePersistenceService');
      const dbTrades = await loadTrades();
      const memoryTradeIds = new Set(this.activeTrades.map(t => t.id || t.tradeId).filter(Boolean));
      
      const tradesToReload = dbTrades.filter(dbTrade => {
        const dbTradeId = dbTrade.id || dbTrade.tradeId;
        const isOpen = dbTrade.status === 'OPEN' || dbTrade.status === 'DCA_HIT';
        return dbTradeId && !memoryTradeIds.has(dbTradeId) && isOpen;
      });
      
      if (tradesToReload.length > 0) {
        console.log(`🔄 Reloading ${tradesToReload.length} open trade(s) from DynamoDB that weren't in memory:`);
        for (const trade of tradesToReload) {
          // Convert entryTime back to Date if needed
          if (trade.entryTime && typeof trade.entryTime === 'number') {
            trade.entryTime = new Date(trade.entryTime);
          }
          this.activeTrades.push(trade);
          console.log(`   ✅ Reloaded ${trade.symbol} (id=${trade.id || trade.tradeId}, status=${trade.status})`);
        }
        console.log(`   💡 These trades will now be preserved in the next save.`);
      }
    } catch (syncError) {
      console.error(`⚠️ Error syncing trades from DynamoDB:`, syncError.message);
    }
    
    // Save trades to disk after updates (now includes any reloaded trades)
    await saveTrades(this.activeTrades);
    
    // Log all active trades for tracking (helps identify missing trades)
    if (this.activeTrades.length > 0) {
      const tradeSummary = this.activeTrades.map(t => ({
        symbol: t.symbol,
        id: t.id || t.tradeId,
        status: t.status,
        action: t.action,
        entryPrice: t.entryPrice,
        dcaCount: t.dcaCount || 0
      }));
      console.log(`📊 Active trades summary (${this.activeTrades.length} total):`, tradeSummary);
      
      // Check for specific symbols that might be missing (e.g., BTC)
      // Only log when there's an actual issue, not on every check (reduces log noise)
      const btcTrade = this.activeTrades.find(t => t.symbol === 'BTC');
      if (!btcTrade) {
        // Only check DynamoDB if BTC is missing - but don't log routine checks
        try {
          const { loadTrades, loadClosedTrades } = require('../services/tradePersistenceService');
          const dbActiveTrades = await loadTrades();
          const dbClosedTrades = await loadClosedTrades();
          
          // Check for BTC with case-insensitive matching
          const dbBtcActive = dbActiveTrades.find(t => 
            t.symbol === 'BTC' || t.symbol === 'btc' || (t.symbol && t.symbol.toUpperCase() === 'BTC')
          );
          const dbBtcClosed = dbClosedTrades.find(t => 
            t.symbol === 'BTC' || t.symbol === 'btc' || (t.symbol && t.symbol.toUpperCase() === 'BTC')
          );
          
          if (dbBtcActive) {
            // ISSUE: BTC exists in DB but not in memory - this is a problem!
            console.warn(`⚠️ BTC found in DynamoDB activeTrades but not in memory!`);
            console.warn(`   Trade details: id=${dbBtcActive.id || dbBtcActive.tradeId}, status=${dbBtcActive.status}, entryPrice=$${dbBtcActive.entryPrice}`);
            console.warn(`   🔧 Attempting to reload BTC trade into memory...`);
            
            // Try to reload the trade
            const existingIndex = this.activeTrades.findIndex(t => 
              (t.id === dbBtcActive.id || t.tradeId === dbBtcActive.id || t.tradeId === dbBtcActive.tradeId) &&
              (t.symbol === 'BTC' || t.symbol === 'btc')
            );
            
            if (existingIndex === -1) {
              // Convert entryTime back to Date if needed
              if (dbBtcActive.entryTime && typeof dbBtcActive.entryTime === 'number') {
                dbBtcActive.entryTime = new Date(dbBtcActive.entryTime);
              }
              this.activeTrades.push(dbBtcActive);
              console.log(`   ✅ Reloaded BTC trade into activeTrades`);
            }
          } else if (!dbBtcClosed) {
            // BTC completely missing - only log once per hour to avoid spam
            const now = Date.now();
            const lastBtcWarning = this.lastBtcMissingWarning || 0;
            const oneHour = 60 * 60 * 1000;
            
            if (now - lastBtcWarning > oneHour) {
              this.lastBtcMissingWarning = now;
              console.error(`❌ BTC trade not found in DynamoDB! (logged once per hour)`);
              console.error(`   📋 All symbols in DynamoDB: ${dbActiveTrades.map(t => t.symbol).join(', ') || 'none'}`);
              console.error(`   💡 Possible causes: Trade was never saved, save failed, or was deleted`);
            }
          }
          // If BTC is in closedTrades, that's fine - don't log (it's expected)
        } catch (dbError) {
          // Only log errors, not routine checks
          console.error(`❌ Error checking DynamoDB for BTC: ${dbError.message}`);
        }
      }
      // Don't log when BTC is found - that's normal, no need to spam logs
    } else {
      console.log(`📊 No active trades currently`);
    }
    
    // Recalculate portfolio metrics from updated trades
    await recalculateFromTrades(this.activeTrades);
  }

  // Re-evaluate open trades with AI during scan
  async reevaluateOpenTradesWithAI() {
    const now = Date.now();
    const lastEval = this.lastOpenTradesReevalAt || 0;
    const elapsed = now - lastEval;

    // Global cooldown to avoid calling Premium AI too often (saves cost)
    if (elapsed < this.openTradesReevalCooldownMs) {
      console.log(
        `⏱️ Skipping AI re-evaluation of open trades (cooldown ${
          this.openTradesReevalCooldownMs / 60000
        }min, elapsed ${(elapsed / 1000).toFixed(1)}s)`
      );
      addLogEntry(
        '⏱️ Skipped AI re-evaluation of open trades due to cooldown',
        'info'
      );
      return [];
    }

    // Update last evaluation timestamp BEFORE making AI calls
    this.lastOpenTradesReevalAt = now;

    const openTrades = this.activeTrades.filter(t => t.status === 'OPEN' || t.status === 'DCA_HIT');
    
    console.log(`\n🤖 Starting AI re-evaluation for ${openTrades.length} open trades...`);
    addLogEntry(`🤖 Re-evaluating ${openTrades.length} open trades with AI...`, 'info');
    
    if (openTrades.length === 0) {
      console.log('⚠️ No open trades to evaluate');
      addLogEntry('⚠️ No open trades to evaluate', 'warning');
      return [];
    }
    
    // Check for API key (force using main AI key to avoid 401 auth issues)
    const apiKey = config.AI_API_KEY;
    if (!apiKey) {
      console.log('⚠️ AI API key not configured - cannot re-evaluate');
      addLogEntry('⚠️ AI API key not configured', 'warning');
      return [];
    }
    
    console.log(`✅ Using API key for re-evaluation: ${apiKey.substring(0, 15)}...`);

    try {
      console.log(`📊 Preparing trade data for ${openTrades.length} trades...`);
      // Prepare trade data for AI analysis
      const tradesForAI = await Promise.all(openTrades.map(async (trade) => {
        const coinData = trade.coinData || {
          symbol: trade.symbol,
          name: trade.name,
          id: trade.coinId,
          coinmarketcap_id: trade.coinmarketcap_id,
          coinpaprika_id: trade.coinpaprika_id
        };

        // Fetch current price and data
        const priceResult = await fetchEnhancedPriceData(coinData, this.priceCache, this.stats, config);
        const currentPrice = priceResult?.data?.price || trade.currentPrice;

        // Calculate fresh P&L based on current price
        let pnl = 0;
        let pnlPercent = 0;
        if (trade.action === 'BUY') {
          pnl = currentPrice - trade.entryPrice;
          pnlPercent = ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100;
        } else if (trade.action === 'SELL') {
          pnl = trade.entryPrice - currentPrice;
          pnlPercent = ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100;
        }
        
        // Ensure pnlPercent is a number before using toFixed
        const safePnlPercent = typeof pnlPercent === 'number' ? pnlPercent : 0;
        console.log(`💰 ${trade.symbol} P&L: Entry $${trade.entryPrice.toFixed(2)} → Current $${currentPrice.toFixed(2)} = ${safePnlPercent >= 0 ? '+' : ''}${safePnlPercent.toFixed(2)}%`);

        // Fetch historical data for analysis (pass currentPrice to avoid duplicate price fetch)
        const historicalData = await fetchHistoricalData(coinData.id || trade.symbol, coinData, this.stats, config, currentPrice);
        
        return {
          symbol: trade.symbol,
          name: trade.name,
          currentPrice: currentPrice,
          entryPrice: trade.entryPrice,
          takeProfit: trade.takeProfit,
          stopLoss: trade.stopLoss,
          action: trade.action,
          pnl: pnl,
          pnlPercent: pnlPercent,
          status: trade.status,
          historicalData: historicalData
        };
      }));

      // Retrieve historical data for each trade
      console.log('📚 Retrieving historical data for trades...');
      const tradesWithHistory = await Promise.all(tradesForAI.map(async (trade) => {
        try {
          const historical = await retrieveRelatedData({ 
            symbol: trade.symbol, 
            days: 30, 
            limit: 10 
          });
          return { ...trade, historicalData: historical };
        } catch (error) {
          console.error(`⚠️ Failed to retrieve historical data for ${trade.symbol}:`, error.message);
          return { ...trade, historicalData: { evaluations: [], news: [] } };
        }
      }));

      // Fetch news for each trade (with timeout protection)
      console.log('📰 Fetching news for trades...');
      const tradesWithNews = await Promise.all(tradesWithHistory.map(async (trade) => {
        try {
          // Add timeout wrapper to prevent hanging
          const newsPromise = fetchCryptoNews(trade.symbol, 3);
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('News fetch timeout')), 5000)
          );
          const news = await Promise.race([newsPromise, timeoutPromise]);
          if (news && news.articles && news.articles.length > 0) {
            console.log(`✅ Fetched ${news.articles.length} news articles for ${trade.symbol}`);
          }
          return { ...trade, news };
        } catch (error) {
          // Silently fail - news is optional
          return { ...trade, news: { articles: [], total: 0 } };
        }
      }));
      console.log('✅ Trade data prepared with news');

      // Create AI prompt for trade re-evaluation
      // Limit context size to prevent token limit issues
      // For many trades, we'll process in smaller batches
      const MAX_TRADES_PER_BATCH = 5; // Process max 5 trades at a time to avoid truncation
      const tradeBatches = [];
      for (let i = 0; i < tradesWithNews.length; i += MAX_TRADES_PER_BATCH) {
        tradeBatches.push(tradesWithNews.slice(i, i + MAX_TRADES_PER_BATCH));
      }
      
      let allRecommendations = [];
      
      // Process each batch separately
      for (let batchIdx = 0; batchIdx < tradeBatches.length; batchIdx++) {
        const batch = tradeBatches[batchIdx];
        console.log(`📦 Processing trade batch ${batchIdx + 1}/${tradeBatches.length} (${batch.length} trades)...`);
        
        try {
          const prompt = `You are a professional crypto trading analyst. Re-evaluate these ${batch.length} open trades and provide your recommendation for each.
IMPORTANT: Consider technical analysis, recent news, AND historical context when making recommendations.
- Review previous evaluations to see if patterns are consistent or changing
- Historical news can provide context for current price movements
- If previous evaluations were wrong, learn from those mistakes

${batch.map((t, i) => {
  let newsText = '';
  if (t.news && t.news.articles && t.news.articles.length > 0) {
    const newsItems = t.news.articles.slice(0, 3).map(n => `    - ${n.title} (${n.source})`).join('\n');
    newsText = `\n- Recent News:\n${newsItems}`;
  } else {
    newsText = '\n- Recent News: No significant news found';
  }
  
  // Include historical context
  let historicalText = '';
  const historical = t.historicalData || { evaluations: [], news: [] };
  if (historical.evaluations && historical.evaluations.length > 0) {
    const recentEvals = historical.evaluations
      .slice(0, 2)
      .filter(evaluation => evaluation && evaluation.data) // Filter out entries with null data
      .map(evaluation => {
        const date = new Date(evaluation.timestamp).toLocaleDateString();
        const recommendation = evaluation.data.recommendation || evaluation.data.action || 'HOLD';
        const confidence = ((evaluation.data.confidence || 0) * 100).toFixed(0);
        return `    - [${date}] ${recommendation} (${confidence}%)`;
      })
      .join('\n');
    if (recentEvals) {
      historicalText += `\n- Previous Evaluations:\n${recentEvals}`;
    }
  }
  if (historical.news && historical.news.length > 0) {
    const historicalNews = historical.news
      .slice(0, 2)
      .filter(n => n && n.title && n.publishedAt) // Filter out entries with null data
      .map(n => {
        const date = new Date(n.publishedAt).toLocaleDateString();
        return `    - [${date}] ${n.title}`;
      })
      .join('\n');
    if (historicalNews) {
      historicalText += `\n- Historical News:\n${historicalNews}`;
    }
  }
  
  // Safely handle pnlPercent - might be undefined or not a number
  const pnlPercent = typeof t.pnlPercent === 'number' ? t.pnlPercent : 0;
  const pnlText = `${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%`;
  
  // Calculate TP/SL as percentages for context (but make it clear they're dollar amounts)
  const tpPercent = ((t.takeProfit - t.entryPrice) / t.entryPrice) * 100;
  const slPercent = ((t.entryPrice - t.stopLoss) / t.entryPrice) * 100;
  
  return `
Trade ${i + 1}: ${t.symbol} (${t.name})
- Action: ${t.action}
- Entry Price: $${t.entryPrice.toFixed(2)}
- Current Price: $${t.currentPrice.toFixed(2)}
- Take Profit: $${t.takeProfit.toFixed(2)} (which equals ${tpPercent >= 0 ? '+' : ''}${tpPercent.toFixed(2)}% gain from entry price of $${t.entryPrice.toFixed(2)})
  ⚠️ CRITICAL: The Take Profit value "$${t.takeProfit.toFixed(2)}" is a DOLLAR AMOUNT (price level), NOT a percentage. 
  Example: If TP is $1000.00, that means sell when price reaches $1000.00, NOT 1000% gain.
- Stop Loss: $${t.stopLoss.toFixed(2)} (which equals ${slPercent >= 0 ? '+' : ''}${slPercent.toFixed(2)}% loss from entry price of $${t.entryPrice.toFixed(2)})
  ⚠️ CRITICAL: The Stop Loss value "$${t.stopLoss.toFixed(2)}" is a DOLLAR AMOUNT (price level), NOT a percentage.
- Current P&L: ${pnlText}
- Status: ${t.status}${newsText}${historicalText}
`;
}).join('\n')}

For each trade, provide:
1. Recommendation: HOLD, CLOSE, or ADJUST
2. Confidence: 0.0 to 1.0
3. Reason: Brief explanation
4. If ADJUST: provide newTakeProfit and/or newStopLoss and/or newDcaPrice (DCA level) (optional - only if adjustment needed)
   IMPORTANT: newTakeProfit and newStopLoss must be DOLLAR AMOUNTS (e.g., $1000.00), NOT percentages
   Example: If you want to adjust TP to $1000, use newTakeProfit: 1000.00 (not 1000%)
5. If CLOSE: consider DCA/addPosition first - if DCA is still available (dcaCount < 5), suggest DCA instead of closing

IMPORTANT RULES:
- Before recommending CLOSE on a losing trade, check if DCA is available (dcaCount < 5). DCA is often better than closing at a loss.
- For ADJUST: You can adjust Take Profit (newTakeProfit), Stop Loss (newStopLoss), and/or DCA Price (newDcaPrice). Only provide values you want to change. Leave null if no change needed.
- For DCA Price (newDcaPrice): This is the price level where we add to the position. For BUY trades, DCA should be BELOW current price (buy the dip). For SELL trades, DCA should be ABOVE current price (short the rally).
- For CLOSE: Only recommend if trade is profitable OR if all DCAs are exhausted (dcaCount >= 5) and loss is significant.

Return JSON array format:
[
  {
    "symbol": "BTC",
    "recommendation": "ADJUST",
    "confidence": 0.75,
    "reason": "Price approaching take profit, adjusting TP higher to capture more gains. Also adjusting DCA level to better support level.",
    "newTakeProfit": 101000.00,
    "newStopLoss": null,
    "newDcaPrice": 94500.00
  },
  {
    "symbol": "ETH",
    "recommendation": "CLOSE",
    "confidence": 0.85,
    "reason": "Take profit reached, closing position to lock in gains",
    "newTakeProfit": null,
    "newStopLoss": null,
    "newDcaPrice": null
  }
]`;

          // Call AI API directly
          console.log('🤖 Calling AI API for trade re-evaluation...');
          console.log(`📝 Prompt length: ${prompt.length} characters`);
          const axios = require('axios');
          const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
            model: config.AI_MODEL,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 4000, // Increased significantly for multiple trades (was 2000)
            temperature: 0.1,
          }, {
            headers: {
              Authorization: `Bearer ${apiKey}`, // Use the fallback apiKey variable
              'Content-Type': 'application/json',
              'HTTP-Referer': 'https://my-deepseek-bot-1.onrender.com',
              'X-Title': 'Technical Analysis Bot',
            },
            timeout: 30000,
          });

          // Parse AI response
          console.log('✅ AI API responded successfully');
        
          // Check if response was truncated
          const finishReason = response.data.choices[0].finish_reason;
          if (finishReason === 'length') {
            console.warn('⚠️ AI response was truncated (hit token limit)');
            addLogEntry('⚠️ AI response truncated - may be incomplete', 'warning');
          }
          
          let aiContent = response.data.choices[0].message.content;
          
          // Check if response is empty or too short
          if (!aiContent || aiContent.trim().length === 0) {
            console.error('❌ AI response is empty');
            throw new Error('AI response is empty - no content received');
          }
          
          console.log(`📝 AI response length: ${aiContent.length} characters`);
          console.log(`📝 AI response preview: ${aiContent.substring(0, 200)}`);
          console.log(`📝 Finish reason: ${finishReason}`);
          
          // Clean up markdown code blocks if present
          aiContent = aiContent.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
          
          // Try to find JSON array
          let jsonMatch = aiContent.match(/\[[\s\S]*\]/);
          
          // If no match, try to find JSON object and wrap it in array
          if (!jsonMatch) {
            const objectMatch = aiContent.match(/\{[\s\S]*\}/);
            if (objectMatch) {
              console.log('⚠️ Found JSON object instead of array, wrapping in array...');
              jsonMatch = [`[${objectMatch[0]}]`];
            }
          }
          
          if (jsonMatch) {
            console.log('✅ Found JSON in AI response');
            try {
              const recommendations = JSON.parse(jsonMatch[0]);
              console.log(`✅ Parsed ${recommendations.length} recommendations`);
              
              if (!Array.isArray(recommendations) || recommendations.length === 0) {
                throw new Error('Invalid recommendations format - expected non-empty array');
              }
              
              // Filter out null/undefined entries and validate structure
              const validRecommendations = recommendations.filter(rec => {
                if (!rec || typeof rec !== 'object') {
                  console.warn(`⚠️ Skipping invalid recommendation entry:`, rec);
                  return false;
                }
                if (!rec.symbol) {
                  console.warn(`⚠️ Skipping recommendation without symbol:`, rec);
                  return false;
                }
                return true;
              });
              
              // Add to all recommendations
              allRecommendations.push(...validRecommendations);
              
            } catch (parseError) {
              console.error('❌ Failed to parse AI response:', parseError.message);
              addLogEntry(`Failed to parse AI response for batch ${batchIdx + 1}: ${parseError.message}`, 'error');
            }
          } else {
            console.warn('⚠️ No JSON found in AI response');
            addLogEntry(`No JSON found in AI response for batch ${batchIdx + 1}`, 'warning');
          }
        } catch (batchError) {
          console.error(`❌ Error processing batch ${batchIdx + 1}:`, batchError.message);
          addLogEntry(`Error processing batch ${batchIdx + 1}: ${batchError.message}`, 'error');
        }
        
        // Small delay between batches
        if (batchIdx < tradeBatches.length - 1) {
          await sleep(1000); // 1 second between batches
        }
      }
    
    // Process all recommendations together
    if (allRecommendations.length === 0) {
      console.warn('⚠️ No recommendations received from AI');
      addLogEntry('⚠️ No recommendations received from AI', 'warning');
      return [];
    }
    
    // Filter out any null/undefined entries that might have slipped through
    allRecommendations = allRecommendations.filter(rec => rec != null && typeof rec === 'object' && rec.symbol);
    
    console.log(`✅ Total recommendations received: ${allRecommendations.length}`);
    
    if (allRecommendations.length === 0) {
      console.warn('⚠️ No valid recommendations after filtering');
      addLogEntry('⚠️ No valid recommendations received from AI', 'warning');
      return [];
    }
    
    // Build Telegram message
    let telegramMessage = `🤖 *AI Trade Re-evaluation*\n\n`;
    telegramMessage += `📊 *${openTrades.length} Open Trade${openTrades.length > 1 ? 's' : ''} Analyzed*\n\n`;
    
    for (const rec of allRecommendations) {
      // Safety check - skip if rec is null or invalid
      if (!rec || typeof rec !== 'object' || !rec.symbol) {
        console.warn(`⚠️ Skipping invalid recommendation entry:`, rec);
        continue;
      }
      
      const symbol = rec.symbol;
      const recommendation = rec.recommendation || 'HOLD';
      const confidence = (rec.confidence || 0) * 100;
      const reason = rec.reason || 'No reason provided';
      
      // Find the corresponding trade
      const trade = openTrades.find(t => t.symbol === symbol);
      const tradeData = tradesWithNews.find(t => t.symbol === symbol) || 
                      tradeBatches.flat().find(t => t.symbol === symbol);
      const pnlPercent = trade && typeof trade.pnlPercent === 'number' ? trade.pnlPercent : 0;
      const pnl = trade ? `${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%` : 'N/A';
      
      // Store evaluation in database
      if (trade) {
        // Store AI evaluation with limited context to prevent MongoDB size issues
        storeAIEvaluation({
          symbol: symbol,
          tradeId: trade.symbol, // Use symbol as trade identifier
          type: 'trade_evaluation',
          data: {
            recommendation: recommendation,
            confidence: rec.confidence || 0,
            reason: reason,
            pnlPercent: pnlPercent
          },
          model: config.AI_MODEL,
          context: {
            news: tradeData?.news?.articles?.slice(0, 5) || [], // Only last 5 articles
            // Don't include historicalData - it's too large
          }
        }).catch(err => {
          console.error(`⚠️ Failed to store trade evaluation for ${symbol}:`, err.message);
        });
      }
      
      // Add to log
      addLogEntry(
        `📊 ${symbol} AI Re-evaluation: ${recommendation} (${confidence.toFixed(0)}%) - ${reason}`,
        recommendation === 'CLOSE' ? 'warning' : 'info'
      );
      
      // Execute AI recommendations
      if (trade && recommendation !== 'HOLD') {
        try {
          if (recommendation === 'ADJUST') {
            // Adjust take profit, stop loss, and/or DCA price
            let adjusted = false;
            if (rec.newTakeProfit && typeof rec.newTakeProfit === 'number' && rec.newTakeProfit > 0) {
              const currentPrice = trade.currentPrice || trade.entryPrice;
              const avgEntry = trade.averageEntryPrice || trade.entryPrice;
              let newTP = rec.newTakeProfit;
              
              // Validate TP value based on trade action
              if (trade.action === 'BUY') {
                // For BUY: TP should be > entry price (profit target above entry)
                const minTP = avgEntry * 1.01; // At least 1% above entry
                const maxTP = avgEntry * 20; // Max 20x entry (suspiciously high)
                
                if (newTP < minTP) {
                  // Too low - likely a percentage or wrong value
                  console.warn(`⚠️ ${symbol}: AI provided suspiciously low TP value ($${newTP.toFixed(2)}) for BUY trade. Entry is $${avgEntry.toFixed(2)}. Rejecting adjustment.`);
                  addLogEntry(`⚠️ ${symbol}: AI TP value $${newTP.toFixed(2)} is too low for BUY trade (entry: $${avgEntry.toFixed(2)}). Rejecting adjustment.`, 'warning');
                  // Don't apply the adjustment - keep existing TP
                } else if (newTP > maxTP) {
                  // Too high - likely a percentage mistake
                  console.warn(`⚠️ ${symbol}: AI provided suspiciously high TP value (${newTP}). Treating as percentage and converting...`);
                  newTP = avgEntry * (1 + rec.newTakeProfit / 100);
                  addLogEntry(`⚠️ ${symbol}: AI TP value ${rec.newTakeProfit} was too high - converted from percentage to $${newTP.toFixed(2)}`, 'warning');
                  
              const oldTP = trade.takeProfit;
                  trade.takeProfit = newTP;
              adjusted = true;
                  addLogEntry(`🟡 ${symbol}: AI adjusted Take Profit from $${oldTP.toFixed(2)} to $${newTP.toFixed(2)}`, 'info');
                  telegramMessage += `   ⚙️ TP: $${oldTP.toFixed(2)} → $${newTP.toFixed(2)}\n`;
                } else {
                  // Valid TP value
                  const oldTP = trade.takeProfit;
                  trade.takeProfit = newTP;
                  adjusted = true;
                  addLogEntry(`🟡 ${symbol}: AI adjusted Take Profit from $${oldTP.toFixed(2)} to $${newTP.toFixed(2)}`, 'info');
                  telegramMessage += `   ⚙️ TP: $${oldTP.toFixed(2)} → $${newTP.toFixed(2)}\n`;
                }
              } else if (trade.action === 'SELL') {
                // For SELL (short): TP should be < entry price (profit when price goes down)
                const maxTP = avgEntry * 0.99; // At most 1% below entry
                const minTP = avgEntry * 0.05; // Min 5% of entry (suspiciously low)
                
                if (newTP > maxTP) {
                  // Too high for short - likely wrong
                  console.warn(`⚠️ ${symbol}: AI provided suspiciously high TP value ($${newTP.toFixed(2)}) for SELL trade. Entry is $${avgEntry.toFixed(2)}. Rejecting adjustment.`);
                  addLogEntry(`⚠️ ${symbol}: AI TP value $${newTP.toFixed(2)} is too high for SELL trade (entry: $${avgEntry.toFixed(2)}). Rejecting adjustment.`, 'warning');
                  // Don't apply the adjustment
                } else if (newTP < minTP) {
                  // Too low - likely a percentage mistake
                  console.warn(`⚠️ ${symbol}: AI provided suspiciously low TP value (${newTP}). Treating as percentage and converting...`);
                  newTP = avgEntry * (1 - rec.newTakeProfit / 100);
                  addLogEntry(`⚠️ ${symbol}: AI TP value ${rec.newTakeProfit} was too low - converted from percentage to $${newTP.toFixed(2)}`, 'warning');
                  
                  const oldTP = trade.takeProfit;
                  trade.takeProfit = newTP;
                  adjusted = true;
                  addLogEntry(`🟡 ${symbol}: AI adjusted Take Profit from $${oldTP.toFixed(2)} to $${newTP.toFixed(2)}`, 'info');
                  telegramMessage += `   ⚙️ TP: $${oldTP.toFixed(2)} → $${newTP.toFixed(2)}\n`;
                } else {
                  // Valid TP value
                  const oldTP = trade.takeProfit;
                  trade.takeProfit = newTP;
                  adjusted = true;
                  addLogEntry(`🟡 ${symbol}: AI adjusted Take Profit from $${oldTP.toFixed(2)} to $${newTP.toFixed(2)}`, 'info');
                  telegramMessage += `   ⚙️ TP: $${oldTP.toFixed(2)} → $${newTP.toFixed(2)}\n`;
                }
              }
            }
            if (rec.newStopLoss && typeof rec.newStopLoss === 'number' && rec.newStopLoss > 0) {
              const currentPrice = trade.currentPrice || trade.entryPrice;
              const avgEntry = trade.averageEntryPrice || trade.entryPrice;
              let newSL = rec.newStopLoss;
              
              // Validate SL value based on trade action
              if (trade.action === 'BUY') {
                // For BUY: SL should be < entry price (loss limit below entry)
                const maxSL = avgEntry * 0.99; // At most 1% below entry
                const minSL = avgEntry * 0.10; // Min 10% of entry (suspiciously low - would be 90% loss)
                
                if (newSL > maxSL) {
                  // Too high for BUY - likely wrong
                  console.warn(`⚠️ ${symbol}: AI provided suspiciously high SL value ($${newSL.toFixed(2)}) for BUY trade. Entry is $${avgEntry.toFixed(2)}. Rejecting adjustment.`);
                  addLogEntry(`⚠️ ${symbol}: AI SL value $${newSL.toFixed(2)} is too high for BUY trade (entry: $${avgEntry.toFixed(2)}). Rejecting adjustment.`, 'warning');
                  // Don't apply the adjustment - keep existing SL
                } else if (newSL < minSL) {
                  // Too low - likely a percentage mistake
                  console.warn(`⚠️ ${symbol}: AI provided suspiciously low SL value (${newSL}). Treating as percentage and converting...`);
                  newSL = avgEntry * (1 - rec.newStopLoss / 100);
                  addLogEntry(`⚠️ ${symbol}: AI SL value ${rec.newStopLoss} was too low - converted from percentage to $${newSL.toFixed(2)}`, 'warning');
                  
              const oldSL = trade.stopLoss;
                  trade.stopLoss = newSL;
              adjusted = true;
                  addLogEntry(`🟡 ${symbol}: AI adjusted Stop Loss from $${oldSL.toFixed(2)} to $${newSL.toFixed(2)}`, 'info');
                  telegramMessage += `   ⚙️ SL: $${oldSL.toFixed(2)} → $${newSL.toFixed(2)}\n`;
                } else {
                  // Valid SL value
                  const oldSL = trade.stopLoss;
                  trade.stopLoss = newSL;
                  adjusted = true;
                  addLogEntry(`🟡 ${symbol}: AI adjusted Stop Loss from $${oldSL.toFixed(2)} to $${newSL.toFixed(2)}`, 'info');
                  telegramMessage += `   ⚙️ SL: $${oldSL.toFixed(2)} → $${newSL.toFixed(2)}\n`;
                }
              } else if (trade.action === 'SELL') {
                // For SELL (short): SL should be > entry price (loss limit above entry)
                const minSL = avgEntry * 1.01; // At least 1% above entry
                const maxSL = avgEntry * 20; // Max 20x entry (suspiciously high)
                
                if (newSL < minSL) {
                  // Too low for short - likely wrong
                  console.warn(`⚠️ ${symbol}: AI provided suspiciously low SL value ($${newSL.toFixed(2)}) for SELL trade. Entry is $${avgEntry.toFixed(2)}. Rejecting adjustment.`);
                  addLogEntry(`⚠️ ${symbol}: AI SL value $${newSL.toFixed(2)} is too low for SELL trade (entry: $${avgEntry.toFixed(2)}). Rejecting adjustment.`, 'warning');
                  // Don't apply the adjustment
                } else if (newSL > maxSL) {
                  // Too high - likely a percentage mistake
                  console.warn(`⚠️ ${symbol}: AI provided suspiciously high SL value (${newSL}). Treating as percentage and converting...`);
                  newSL = avgEntry * (1 + rec.newStopLoss / 100);
                  addLogEntry(`⚠️ ${symbol}: AI SL value ${rec.newStopLoss} was too high - converted from percentage to $${newSL.toFixed(2)}`, 'warning');
                  
                  const oldSL = trade.stopLoss;
                  trade.stopLoss = newSL;
                  adjusted = true;
                  addLogEntry(`🟡 ${symbol}: AI adjusted Stop Loss from $${oldSL.toFixed(2)} to $${newSL.toFixed(2)}`, 'info');
                  telegramMessage += `   ⚙️ SL: $${oldSL.toFixed(2)} → $${newSL.toFixed(2)}\n`;
                } else {
                  // Valid SL value
                  const oldSL = trade.stopLoss;
                  trade.stopLoss = newSL;
                  adjusted = true;
                  addLogEntry(`🟡 ${symbol}: AI adjusted Stop Loss from $${oldSL.toFixed(2)} to $${newSL.toFixed(2)}`, 'info');
                  telegramMessage += `   ⚙️ SL: $${oldSL.toFixed(2)} → $${newSL.toFixed(2)}\n`;
                }
              }
            }
            // Handle both newDcaPrice (new field) and newAddPosition (legacy field) for backward compatibility
            const newDcaValue = rec.newDcaPrice || rec.newAddPosition;
            if (newDcaValue && typeof newDcaValue === 'number' && newDcaValue > 0) {
              const oldDca = trade.addPosition || trade.dcaPrice || trade.entryPrice;
              trade.addPosition = newDcaValue;
              trade.dcaPrice = newDcaValue; // Store in both fields for consistency
              adjusted = true;
              addLogEntry(`🟡 ${symbol}: AI adjusted DCA Price from $${oldDca.toFixed(2)} to $${newDcaValue.toFixed(2)}`, 'info');
              telegramMessage += `   ⚙️ DCA: $${oldDca.toFixed(2)} → $${newDcaValue.toFixed(2)}\n`;
            }
            if (adjusted) {
              await saveTrades(this.activeTrades);
              addLogEntry(`✅ ${symbol}: Trade parameters updated by AI`, 'success');
            }
          } else if (recommendation === 'CLOSE') {
            // Check if DCA is still available - warn AI if it should have suggested DCA
            if (trade.dcaCount < 5 && pnlPercent < 0) {
              addLogEntry(`⚠️ ${symbol}: AI recommended CLOSE but DCA still available (${5 - trade.dcaCount} remaining). Consider DCA instead.`, 'warning');
              telegramMessage += `   ⚠️ Note: DCA still available (${5 - trade.dcaCount} remaining)\n`;
            }
            
            // Close the trade
            const closeResult = await this.closeTradeByAI(trade, reason, confidence);
            if (closeResult.success) {
              addLogEntry(`🔴 ${symbol}: Trade closed by AI - ${reason}`, 'warning');
              telegramMessage += `   ✅ Trade closed at $${closeResult.closePrice.toFixed(2)}\n`;
            } else {
              addLogEntry(`⚠️ ${symbol}: AI close recommendation failed - ${closeResult.error}`, 'warning');
              telegramMessage += `   ⚠️ Close failed: ${closeResult.error}\n`;
            }
          }
        } catch (execError) {
          console.error(`❌ Error executing AI recommendation for ${symbol}:`, execError);
          addLogEntry(`❌ ${symbol}: Failed to execute AI recommendation - ${execError.message}`, 'error');
        }
      }
      
      // Add to Telegram message
      const emoji = recommendation === 'CLOSE' ? '🔴' : recommendation === 'ADJUST' ? '🟡' : '🟢';
      telegramMessage += `${emoji} *${symbol}* - ${recommendation}\n`;
      telegramMessage += `   P&L: ${pnl} | Confidence: ${confidence.toFixed(0)}%\n`;
      telegramMessage += `   ${reason}\n\n`;
    }
    
    // Send to Telegram with cooldown to avoid duplicate notifications
    const now = Date.now();
    const lastNotified = this.lastOpenTradesReevalNotifiedAt || 0;
    const elapsed = now - lastNotified;
    
    if (elapsed < this.openTradesReevalCooldownMs) {
      console.log(
        `⏱️ Skipping AI re-evaluation Telegram notification (cooldown ${
          this.openTradesReevalCooldownMs / 60000
        }min, elapsed ${(elapsed / 1000).toFixed(1)}s)`
      );
      addLogEntry(
        '⏱️ Skipped AI re-evaluation Telegram notification due to cooldown',
        'info'
      );
    } else {
    console.log('📤 Sending re-evaluation to Telegram...');
    console.log(`📝 Message length: ${telegramMessage.length} characters`);
    addLogEntry('📤 Sending re-evaluation results to Telegram...', 'info');
    try {
      const sent = await sendTelegramMessage(telegramMessage);
      if (sent) {
        console.log('✅ AI re-evaluation sent to Telegram successfully');
        addLogEntry('✅ AI re-evaluation sent to Telegram', 'success');
          this.lastOpenTradesReevalNotifiedAt = now;
      } else {
        console.log('⚠️ Failed to send re-evaluation to Telegram');
        addLogEntry('⚠️ Failed to send re-evaluation to Telegram', 'warning');
      }
    } catch (telegramError) {
      console.error('❌ Telegram error:', telegramError);
        addLogEntry(
          `⚠️ Failed to send re-evaluation to Telegram: ${telegramError.message}`,
          'warning'
        );
      }
    }
    
    return allRecommendations;
    
    } catch (error) {
      console.error('❌ AI re-evaluation error:', error.message);
      console.error('Error stack:', error.stack);
      addLogEntry(`⚠️ AI re-evaluation failed: ${error.message}`, 'warning');
      return [];
    }
  }

  // New method: Get active trades
  /**
   * Close a trade by AI recommendation
   * Moves trade from activeTrades to closedTrades
   */
  async closeTradeByAI(trade, reason, confidence) {
    try {
      const { executeTakeProfit, executeStopLoss } = require('../services/exchangeService');
      
      // Determine if this is a profit or loss close
      const pnlPercent = typeof trade.pnlPercent === 'number' ? trade.pnlPercent : 0;
      const isProfit = pnlPercent > 0;
      
      // Execute close order (use take profit for profit, stop loss for loss)
      let closeResult;
      if (isProfit) {
        closeResult = await executeTakeProfit(trade);
      } else {
        closeResult = await executeStopLoss(trade);
      }
      
      if (!closeResult.success && !closeResult.skipped) {
        return {
          success: false,
          error: closeResult.error || 'Close execution failed'
        };
      }
      
      // Create closed trade record
      const closedTrade = {
        ...trade,
        status: isProfit ? 'AI_CLOSED_PROFIT' : 'AI_CLOSED_LOSS',
        closedAt: new Date(),
        closePrice: trade.currentPrice,
        closeReason: reason,
        aiConfidence: confidence,
        finalPnl: trade.pnl,
        finalPnlPercent: pnlPercent,
        executionOrderId: closeResult.orderId,
        executionPrice: closeResult.price || trade.currentPrice,
        executedQty: closeResult.executedQty || trade.quantity
      };
      
      // Remove from active trades
      this.activeTrades = this.activeTrades.filter(t => t.symbol !== trade.symbol);
      
      // Add to closed trades
      this.closedTrades.push(closedTrade);
      
      // Keep only last 100 closed trades in memory
      if (this.closedTrades.length > 100) {
        this.closedTrades = this.closedTrades.slice(-100);
      }
      
      // Update portfolio with closed trade
      await closeTrade(
        trade.symbol,
        trade.pnl || 0,
        pnlPercent,
        trade.entryPrice,
        closedTrade.closePrice,
        closedTrade.executedQty || trade.quantity
      );
      
      // Save both active and closed trades
      await saveTrades(this.activeTrades);
      await this.saveClosedTrades();
      
      // Recalculate portfolio
      await recalculateFromTrades(this.activeTrades);
      
      console.log(`✅ ${trade.symbol}: Trade closed by AI - ${isProfit ? 'Profit' : 'Loss'}: ${pnlPercent.toFixed(2)}%`);
      
      return {
        success: true,
        closePrice: trade.currentPrice,
        pnl: pnlPercent,
        isProfit: isProfit
      };
    } catch (error) {
      console.error(`❌ Error closing trade ${trade.symbol} by AI:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Save closed trades to storage
   */
  async saveClosedTrades() {
    try {
      await saveClosedTrades(this.closedTrades);
    } catch (error) {
      console.error('❌ Error saving closed trades:', error);
    }
  }

  /**
   * Load closed trades from storage
   */
  async loadClosedTrades() {
    try {
      const closed = await loadClosedTrades();
      if (closed && closed.length > 0) {
        this.closedTrades = closed.slice(-100); // Keep last 100 in memory
        console.log(`✅ Loaded ${this.closedTrades.length} closed trades from storage`);
      }
    } catch (error) {
      console.error('❌ Error loading closed trades:', error);
      this.closedTrades = [];
    }
  }

  getActiveTrades() {
    return this.activeTrades.filter(trade => trade.status === 'OPEN' || trade.status === 'DCA_HIT'); // Only show open or DCA triggered trades in dashboard
  }

  /**
   * Get closed trades for display
   * @returns {Array} Array of closed trade objects
   */
  getClosedTrades() {
    return this.closedTrades || [];
  }

  applyScanFilters(analysis, options) {
    const cfg = options || {};
    if (cfg.minConfidence && analysis.confidence < cfg.minConfidence) return false;
    if (cfg.include) {
      if (!cfg.include.buy && analysis.action === 'BUY') return false;
      if (!cfg.include.sell && analysis.action === 'SELL') return false;
      if (!cfg.include.hold && analysis.action === 'HOLD') return false;
    }
    return true;
  }

  basicTechnicalAnalysis(coin, usesMockData = false) {
    return {
      symbol: coin.symbol,
      name: coin.name,
      action: 'HOLD',
      price: '$0.00',
      confidence: 0.1,
      signal: 'HOLD | Data Unavailable',
      reason: 'Technical analysis data not available',
      insights: ['Data fetch failed'],
      timestamp: new Date(),
      usesMockData,
      news: [],
      frames: {}, // Add top-level frames property (empty but defined)
      patterns: [], // Add empty patterns array
      indicators: {
        momentum: 'N/A',
        frames: {},
        daily: {
          rsi: 'N/A',
          bollingerPosition: 'N/A',
          trend: 'N/A',
          support: 'N/A',
          resistance: 'N/A',
        },
        hourly: {
          rsi: 'N/A',
          bollingerPosition: 'N/A',
          trend: 'N/A',
        },
        fourHour: {
          rsi: 'N/A',
          trend: 'N/A',
          momentum: 'N/A',
          bollingerPosition: 'N/A',
        },
        weekly: {
          rsi: 'N/A',
          trend: 'N/A',
          momentum: 'N/A',
          bollingerPosition: 'N/A',
        },
      },
      heatmapEntry: null,
    };
  }

  // Proxy methods to services
  async sendTelegramNotification(opportunity, options = {}) {
    return await sendTelegramNotification(opportunity, this.lastNotificationTime, this.stats, this.greedFearIndex, this.globalMetrics, options);
  }

  async sendTestNotification() {
    return await sendTestNotification(config);
  }

  getTradingRules() {
    return {
      ...this.tradingRules,
      confidenceThreshold: (this.tradingRules.minConfidence * 100).toFixed(0) + '%',
      patterns: {
        buy: {
          ...this.tradingRules.patterns.buy,
          description: this.getBuyPatternsDescription()
        },
        sell: {
          ...this.tradingRules.patterns.sell,
          description: this.getSellPatternsDescription()
        },
        hold: [
          'RSI between ' + this.tradingRules.rsi.neutralMin + '-' + this.tradingRules.rsi.neutralMax + ' (neutral zone)',
          'No clear trend direction',
          'Price consolidating between support/resistance',
          'Confidence below threshold',
          'Mixed signals across timeframes'
        ]
      },
      indicators: {
        rsi: {
          oversold: '< ' + this.tradingRules.rsi.oversold,
          neutral: this.tradingRules.rsi.neutralMin + '-' + this.tradingRules.rsi.neutralMax,
          overbought: '> ' + this.tradingRules.rsi.overbought
        },
        bollinger: {
          lower: 'Price near lower band (position < ' + (this.tradingRules.bollinger.lowerThreshold * 100) + '%)',
          middle: 'Price in middle (neutral)',
          upper: 'Price near upper band (position > ' + (this.tradingRules.bollinger.upperThreshold * 100) + '%)'
        },
        fibonacci: {
          levels: ['23.6%', '38.2%', '50.0%', '61.8%', '78.6%'],
          support: this.tradingRules.fibonacci.supportLevels.map(l => (l * 100).toFixed(1) + '%').join(' and ') + ' are key support levels',
          resistance: this.tradingRules.fibonacci.resistanceLevels.map(l => (l * 100).toFixed(1) + '%').join(' and ') + ' are key resistance levels'
        },
        supportResistance: {
          support: 'Lowest price in recent ' + this.tradingRules.supportResistance.lookbackPeriod + ' periods',
          resistance: 'Highest price in recent ' + this.tradingRules.supportResistance.lookbackPeriod + ' periods',
          breakout: 'Price breaking above resistance (bullish) or below support (bearish)'
        }
      },
      timeframes: ['10m', '1h', '4h', '1d', '1w'],
      cooldown: '30 minutes between notifications for same coin'
    };
  }

  getBuyPatternsDescription() {
    const patterns = [];
    if (this.tradingRules.patterns.buy.requireRSIOversold) {
      patterns.push(`RSI < ${this.tradingRules.rsi.oversold} (oversold)`);
    }
    if (this.tradingRules.patterns.buy.requireBollingerLower) {
      patterns.push('Bollinger Lower Band');
    }
    if (this.tradingRules.patterns.buy.requireSupportLevel) {
      patterns.push('Price at Support Level');
    }
    if (this.tradingRules.patterns.buy.requireFibonacciSupport) {
      patterns.push('Fibonacci Support Level');
    }
    if (this.tradingRules.patterns.buy.requireBullishTrend) {
      patterns.push('Bullish Trend');
    }
    if (this.tradingRules.patterns.buy.requirePattern) {
      patterns.push('Trading Pattern Required (Channels, H&S, etc.)');
    }
    if (this.tradingRules.patterns.buy.minTimeframeAlignment > 1) {
      patterns.push(`${this.tradingRules.patterns.buy.minTimeframeAlignment}+ timeframes aligned`);
    }
    return patterns.length > 0 ? patterns : ['Default buy patterns'];
  }

  getSellPatternsDescription() {
    const patterns = [];
    if (this.tradingRules.patterns.sell.requireRSIOverbought) {
      patterns.push(`RSI > ${this.tradingRules.rsi.overbought} (overbought)`);
    }
    if (this.tradingRules.patterns.sell.requireBollingerUpper) {
      patterns.push('Bollinger Upper Band');
    }
    if (this.tradingRules.patterns.sell.requireResistanceLevel) {
      patterns.push('Price at Resistance Level');
    }
    if (this.tradingRules.patterns.sell.requireFibonacciResistance) {
      patterns.push('Fibonacci Resistance Level');
    }
    if (this.tradingRules.patterns.sell.requireBearishTrend) {
      patterns.push('Bearish Trend');
    }
    if (this.tradingRules.patterns.sell.requirePattern) {
      patterns.push('Trading Pattern Required (Channels, H&S, etc.)');
    }
    if (this.tradingRules.patterns.sell.minTimeframeAlignment > 1) {
      patterns.push(`${this.tradingRules.patterns.sell.minTimeframeAlignment}+ timeframes aligned`);
    }
    return patterns.length > 0 ? patterns : ['Default sell patterns'];
  }

  setTradingRules(newRules) {
    // Merge new rules with existing, keeping defaults for missing values
    if (newRules.minConfidence !== undefined) {
      this.tradingRules.minConfidence = Math.max(0.1, Math.min(0.99, newRules.minConfidence));
    }
    if (newRules.enabledIndicators) {
      this.tradingRules.enabledIndicators = { ...this.tradingRules.enabledIndicators, ...newRules.enabledIndicators };
    }
    if (newRules.rsi) {
      this.tradingRules.rsi = { ...this.tradingRules.rsi, ...newRules.rsi };
    }
    if (newRules.bollinger) {
      this.tradingRules.bollinger = { ...this.tradingRules.bollinger, ...newRules.bollinger };
    }
    if (newRules.fibonacci) {
      this.tradingRules.fibonacci = { ...this.tradingRules.fibonacci, ...newRules.fibonacci };
    }
    if (newRules.supportResistance) {
      this.tradingRules.supportResistance = { ...this.tradingRules.supportResistance, ...newRules.supportResistance };
    }
    if (newRules.patterns) {
      if (newRules.patterns.buy) {
        this.tradingRules.patterns.buy = { ...this.tradingRules.patterns.buy, ...newRules.patterns.buy };
      }
      if (newRules.patterns.sell) {
        this.tradingRules.patterns.sell = { ...this.tradingRules.patterns.sell, ...newRules.patterns.sell };
      }
    }
    if (newRules.patternDetection) {
      this.tradingRules.patternDetection = { ...this.tradingRules.patternDetection, ...newRules.patternDetection };
    }
    if (newRules.multiTimeframeConsensus) {
      this.tradingRules.multiTimeframeConsensus = { ...this.tradingRules.multiTimeframeConsensus, ...newRules.multiTimeframeConsensus };
    }
    // Update minConfidence reference
    this.minConfidence = this.tradingRules.minConfidence;
    return this.tradingRules;
  }

  calculateRiskManagement(analysis) {
    const currentPrice = Number(analysis.price.replace(/[^0-9.]/g, '')) || 0;
    const indicators = analysis.indicators || {};
    const frames = indicators.frames || {};
    const action = analysis.action;
    
    // Get support and resistance levels
    const support = Number(indicators.daily?.support) || currentPrice * 0.95;
    const resistance = Number(indicators.daily?.resistance) || currentPrice * 1.05;
    
    // Calculate volatility-based stops (ATR-like)
    const volatility = currentPrice * 0.05; // 5% default volatility
    
    let entryPrice, takeProfit, stopLoss, addPosition, expectedGainPercent;
    
    if (action === 'BUY') {
      // BUY signal - Improved risk/reward ratio (target 3:1 or better)
      entryPrice = currentPrice;
      stopLoss = Math.max(support * 0.98, currentPrice * 0.97); // 2-3% below (tighter stop)
      // Target 3:1 risk/reward: if stop is 3%, take profit should be 9%+
      const riskPercent = ((entryPrice - stopLoss) / entryPrice) * 100;
      const targetReward = riskPercent * 3; // 3:1 risk/reward
      takeProfit = Math.min(resistance * 1.02, currentPrice * (1 + targetReward / 100)); // 9-12% above
      addPosition = currentPrice * 0.98; // 2% below for DCA
      expectedGainPercent = ((takeProfit - entryPrice) / entryPrice * 100).toFixed(2);
      
    } else if (action === 'SELL') {
      // SELL signal - Improved risk/reward ratio (target 3:1 or better)
      entryPrice = currentPrice;
      stopLoss = Math.min(resistance * 1.02, currentPrice * 1.03); // 2-3% above (tighter stop)
      // Target 3:1 risk/reward: if stop is 3%, take profit should be 9%+
      const riskPercent = ((stopLoss - entryPrice) / entryPrice) * 100;
      const targetReward = riskPercent * 3; // 3:1 risk/reward
      takeProfit = Math.max(support * 0.98, currentPrice * (1 - targetReward / 100)); // 9-12% below
      addPosition = currentPrice * 1.02; // 2% above for averaging
      expectedGainPercent = ((entryPrice - takeProfit) / entryPrice * 100).toFixed(2);
      
    } else {
      // HOLD or unknown
      entryPrice = currentPrice;
      takeProfit = currentPrice * 1.05;
      stopLoss = currentPrice * 0.95;
      addPosition = currentPrice;
      expectedGainPercent = 5;
    }
    
    return {
      entryPrice: Number(entryPrice.toFixed(2)),
      takeProfit: Number(takeProfit.toFixed(2)),
      stopLoss: Number(stopLoss.toFixed(2)),
      addPosition: Number(addPosition.toFixed(2)),
      expectedGainPercent: Number(expectedGainPercent)
    };
  }

  matchesTradingRules(analysis) {
    const rules = this.tradingRules;
    const indicators = analysis.indicators || {};
    const frames = indicators.frames || {};
    
    // Filter out HOLD signals - we only want actionable BUY/SELL opportunities
    if (analysis.action === 'HOLD') {
      return false;
    }
    
    // Check if action type is enabled
    if (analysis.action === 'BUY' && !rules.patterns.buy.enabled) return false;
    if (analysis.action === 'SELL' && !rules.patterns.sell.enabled) return false;
    
    if (analysis.action === 'BUY') {
      const buyRules = rules.patterns.buy;
      let matches = 0;
      
      // Check RSI requirement
      if (buyRules.requireRSIOversold) {
        const dailyRSI = Number(indicators.daily?.rsi) || 50;
        if (dailyRSI < rules.rsi.oversold) matches++;
      }
      
      // Check Bollinger requirement
      if (buyRules.requireBollingerLower) {
        if (indicators.daily?.bollingerPosition === 'LOWER') matches++;
      }
      
      // Check support level
      if (buyRules.requireSupportLevel) {
        // Would need price comparison logic here
        matches++; // Placeholder
      }
      
      // Check Fibonacci
      if (buyRules.requireFibonacciSupport) {
        // Would need Fibonacci position check
        matches++; // Placeholder
      }
      
      // Check trend alignment
      if (buyRules.requireBullishTrend) {
        const bullishFrames = Object.values(frames).filter(f => f.trend === 'BULLISH').length;
        if (bullishFrames >= buyRules.minTimeframeAlignment) matches++;
      }
      
      // Check pattern requirement
      if (buyRules.requirePattern) {
        const bullishPatterns = (analysis.patterns || []).filter(p => p.signal === 'BULLISH');
        if (bullishPatterns.length > 0) matches++;
      }
      
      // If no specific requirements, allow through
      if (!buyRules.requireRSIOversold && !buyRules.requireBollingerLower && 
          !buyRules.requireSupportLevel && !buyRules.requireFibonacciSupport && 
          !buyRules.requireBullishTrend && !buyRules.requirePattern) {
        return true;
      }
      
      // Require at least one match if any requirements are set
      return matches > 0;
    }
    
    if (analysis.action === 'SELL') {
      const sellRules = rules.patterns.sell;
      let matches = 0;
      
      if (sellRules.requireRSIOverbought) {
        const dailyRSI = Number(indicators.daily?.rsi) || 50;
        if (dailyRSI > rules.rsi.overbought) matches++;
      }
      
      if (sellRules.requireBollingerUpper) {
        if (indicators.daily?.bollingerPosition === 'UPPER') matches++;
      }
      
      if (sellRules.requireResistanceLevel) {
        matches++; // Placeholder
      }
      
      if (sellRules.requireFibonacciResistance) {
        matches++; // Placeholder
      }
      
      if (sellRules.requireBearishTrend) {
        const bearishFrames = Object.values(frames).filter(f => f.trend === 'BEARISH').length;
        if (bearishFrames >= sellRules.minTimeframeAlignment) matches++;
      }
      
      // Check pattern requirement
      if (sellRules.requirePattern) {
        const bearishPatterns = (analysis.patterns || []).filter(p => p.signal === 'BEARISH');
        if (bearishPatterns.length > 0) matches++;
      }
      
      if (!sellRules.requireRSIOverbought && !sellRules.requireBollingerUpper && 
          !sellRules.requireResistanceLevel && !sellRules.requireFibonacciResistance && 
          !sellRules.requireBearishTrend && !sellRules.requirePattern) {
        return true;
      }
      
      return matches > 0;
    }
    
    return true; // HOLD always passes
  }
}

module.exports = ProfessionalTradingBot;
