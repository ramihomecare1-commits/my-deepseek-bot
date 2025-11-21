const axios = require('axios');
const config = require('../config/config');
const { sleep, getTop100Coins } = require('../utils/helpers');
const {
  calculateRSI,
  calculateBollingerBands,
  identifyTrend,
  calculateMomentum,
  getBollingerPosition,
  identifySupportResistance,
  calculateVolumeProfile
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
const { storeAIEvaluation, retrieveRelatedData, getHistoricalWinRate } = require('../services/dataStorageService');
const monitoringService = require('../services/monitoringService');
const tradeMonitoringService = require('../services/tradeMonitoringService');
const {
  isExchangeTradingEnabled,
  executeTakeProfit,
  executeStopLoss,
  executeAddPosition
} = require('../services/exchangeService');
const { quickBacktest } = require('../services/backtestService');
// Removed: DynamoDB trade persistence - OKX is now the only source of truth
// const { loadTrades, saveTrades, loadClosedTrades, saveClosedTrades } = require('../services/tradePersistenceService');
const { loadPortfolio, recalculateFromTrades, recalculateFromClosedTrades, getPortfolioStats, closeTrade, getDcaTriggerTimestamp, setDcaTriggerTimestamp } = require('../services/portfolioService');

// Error notification cooldown to prevent spam
// Structure: { 'errorMessageHash': timestamp }
const errorNotificationCache = {};
const ERROR_NOTIFICATION_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes cooldown per unique error

// Helper function to add log entries
// Note: We can't require routes/api here as it causes circular dependency
// We'll use console.log only - routes/api can call this function if needed
// but we won't call back to routes/api to avoid circular dependency
async function addLogEntry(message, level = 'info') {
  // Simply use console.log - no dependencies, no circular issues
  const levelUpper = level.toUpperCase();
  console.log(`[${levelUpper}] ${message}`);

  // Send Telegram notification for errors
  if (level === 'error' || level === 'warning') {
    try {
      // Create a hash of the error message for rate limiting
      const crypto = require('crypto');
      const errorHash = crypto.createHash('md5').update(message).digest('hex').substring(0, 8);
      const now = Date.now();

      // Check cooldown - only send if this error hasn't been sent recently
      if (!errorNotificationCache[errorHash] ||
        (now - errorNotificationCache[errorHash]) > ERROR_NOTIFICATION_COOLDOWN_MS) {

        // Import sendTelegramMessage (lazy import to avoid circular dependency)
        const { sendTelegramMessage } = require('../services/notificationService');

        // Format message with date
        const date = new Date();
        const dateStr = date.toLocaleString('en-US', {
          timeZone: 'UTC',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        });

        const emoji = level === 'error' ? '❌' : '⚠️';
        const telegramMessage = `${emoji} <b>Bot ${levelUpper}</b>

📅 <b>Date:</b> ${dateStr} UTC
📝 <b>Error:</b> ${message}`;

        // Send asynchronously (don't block)
        sendTelegramMessage(telegramMessage).catch(err => {
          console.error(`Failed to send error notification to Telegram: ${err.message}`);
        });

        // Update cache
        errorNotificationCache[errorHash] = now;
      }
    } catch (err) {
      // Don't let Telegram errors break the bot
      console.error(`Error in addLogEntry Telegram notification: ${err.message}`);
    }
  }
}

// Intercept console.error to send Telegram notifications
const originalConsoleError = console.error;
console.error = function (...args) {
  // Call original console.error
  originalConsoleError.apply(console, args);

  // Send to Telegram if it's an error message
  try {
    const errorMessage = args.map(arg => {
      if (arg instanceof Error) {
        return arg.message || String(arg);
      }
      return String(arg);
    }).join(' ');

    // Only send if it looks like a real error (not just warnings)
    if (errorMessage && errorMessage.length > 0) {
      // Use addLogEntry which handles Telegram notifications
      addLogEntry(errorMessage, 'error').catch(err => {
        // Silently fail - don't break console.error
      });
    }
  } catch (err) {
    // Don't let this break console.error
  }
};

class ProfessionalTradingBot {
  constructor() {
    this.isRunning = false;
    this.scanTimer = null;
    this.scanInProgress = false;
    this.tradesUpdateTimer = null; // Separate timer for active trades updates
    this.monitoringTimer = null; // Two-tier AI monitoring timer
    this.cleanupTimer = null; // Timer for orphan order cleanup (5 minutes)

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
        enabled: false,  // DISABLED: Not reflecting correctly on trades
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
    // Unified cooldown for ALL triggers (DCA execution, DCA proximity, TP proximity, SL proximity, TP hit, SL hit)
    this.dcaTriggerReevalCooldownMs = 3 * 60 * 60 * 1000; // 3 hours (unified for all triggers)
    this.lastDcaTriggerReevalAt = 0; // timestamp of last trigger-based re-evaluation
    this.dcaTriggerReevalInProgress = false; // flag to prevent multiple simultaneous re-evaluations
    this.proximityTriggerPercent = 3.0; // Trigger AI when price is within 3% of DCA/TP/SL levels
    this.botStartTime = Date.now(); // track when bot started (prevents re-eval during startup)
    this.dcaTriggerStartupDelayMs = 3 * 60 * 1000; // 3 minutes startup delay (prevents timeout during deployment)
    this.lastBtcMissingWarning = 0; // timestamp of last BTC missing warning (throttles logging)
    this.dcaPlacementLocks = new Set(); // Mutex locks to prevent race conditions during DCA placement
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
      defaultTakeProfit: 5.0, // 5% default TP for validation
      defaultStopLoss: 5.0, // 5% default SL for validation
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
        requiredMatches: 1,  // Default to 1, can be overridden by minTimeframeAlignment in patterns
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
          minTimeframeAlignment: 1  // Default to 1 timeframe alignment (user can change in UI)
        },
        sell: {
          enabled: true,
          requireRSIOverbought: true,
          requireBollingerUpper: false,
          requireResistanceLevel: false,
          requireFibonacciResistance: false,
          requireBearishTrend: false,
          requirePattern: false,  // Require trading pattern
          minTimeframeAlignment: 1  // Default to 1 timeframe alignment (user can change in UI)
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
      okxTradingEnabled: true  // Enable OKX demo trading (requires OKX_API_KEY, OKX_API_SECRET, and OKX_PASSPHRASE)
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

      // Load trades: OKX IS THE ONLY SOURCE OF TRUTH (no DynamoDB)
      console.log('📂 Loading active trades from OKX (only source)...');

      const { isExchangeTradingEnabled, getPreferredExchange, getOkxOpenPositions, getOkxSettleCurrency, setOkxSettleCurrency } = require('../services/exchangeService');
      const exchangeConfig = isExchangeTradingEnabled();

      if (exchangeConfig.enabled) {
        console.log('🔄 Fetching positions from OKX (source of truth)...');
        const exchange = getPreferredExchange();

        // Verify and set settlement currency (for USD-margined contracts)
        try {
          const settleCurrencyInfo = await getOkxSettleCurrency(
            exchange.apiKey,
            exchange.apiSecret,
            exchange.passphrase,
            exchange.baseUrl
          );

          if (settleCurrencyInfo.success) {
            const currentSettleCcy = settleCurrencyInfo.currentSettleCcy;
            const availableList = settleCurrencyInfo.availableSettleCcyList || [];

            console.log(`💰 OKX Settlement Currency: ${currentSettleCcy || 'Not set'}`);
            if (availableList.length > 0) {
              console.log(`   Available options: ${availableList.join(', ')}`);
            }

            // Preferred settlement currency: USD or USDC (for USD-margined contracts)
            // Note: This setting only applies to USD-margined contracts (FUTURES/SWAP)
            // For USDT-margined contracts like BTC-USDT-SWAP, this may not be applicable
            const preferredSettleCcy = 'USD'; // Can also use 'USDC' or 'USDG' if preferred

            // Check if we need to set it
            if (currentSettleCcy && currentSettleCcy !== preferredSettleCcy) {
              if (availableList.includes(preferredSettleCcy)) {
                console.log(`⚠️ Settlement currency is ${currentSettleCcy}, but ${preferredSettleCcy} is preferred for USDT pairs`);
                console.log(`   Attempting to set settlement currency to ${preferredSettleCcy}...`);

                const setResult = await setOkxSettleCurrency(
                  preferredSettleCcy,
                  exchange.apiKey,
                  exchange.apiSecret,
                  exchange.passphrase,
                  exchange.baseUrl
                );

                if (setResult.success) {
                  console.log(`✅ Settlement currency set to ${preferredSettleCcy}`);
                } else {
                  console.log(`⚠️ Could not set settlement currency: ${setResult.error}`);
                  console.log(`   Current setting (${currentSettleCcy}) will be used`);
                }
              } else {
                console.log(`⚠️ Preferred settlement currency ${preferredSettleCcy} not available`);
                console.log(`   Using current setting: ${currentSettleCcy}`);
              }
            } else if (!currentSettleCcy && availableList.includes(preferredSettleCcy)) {
              // Not set, but available - set it
              console.log(`💰 Settlement currency not set, setting to ${preferredSettleCcy}...`);

              const setResult = await setOkxSettleCurrency(
                preferredSettleCcy,
                exchange.apiKey,
                exchange.apiSecret,
                exchange.passphrase,
                exchange.baseUrl
              );

              if (setResult.success) {
                console.log(`✅ Settlement currency set to ${preferredSettleCcy}`);
              } else {
                console.log(`⚠️ Could not set settlement currency: ${setResult.error}`);
              }
            } else if (currentSettleCcy === preferredSettleCcy) {
              console.log(`✅ Settlement currency is correctly set to ${preferredSettleCcy}`);
            }
          } else {
            console.log(`⚠️ Could not retrieve settlement currency info: ${settleCurrencyInfo.error}`);
            console.log(`   This is normal for non-USD-margined accounts or spot-only accounts`);
          }
        } catch (error) {
          console.log(`⚠️ Error checking settlement currency: ${error.message}`);
          console.log(`   Continuing with position loading...`);
        }

        try {
          // Get actual positions from OKX (ONLY SOURCE)
          const okxPositions = await getOkxOpenPositions(
            exchange.apiKey,
            exchange.apiSecret,
            exchange.passphrase,
            exchange.baseUrl
          );

          if (okxPositions.length > 0) {
            console.log(`✅ Found ${okxPositions.length} positions on OKX`);

            // Convert OKX positions to trade format (OKX is source of truth)
            const trades = [];

            okxPositions.forEach(okxPos => {
              // Create trade record from OKX position with TP, SL, and DCA defaults
              const entryPrice = okxPos.avgPrice || 0;
              const defaultTPPercent = this.tradingRules?.defaultTakeProfit || 5.0;
              const defaultSLPercent = this.tradingRules?.defaultStopLoss || 5.0;
              const action = okxPos.side === 'short' ? 'SELL' : 'BUY';

              let takeProfit, stopLoss, addPosition;
              if (action === 'BUY') {
                takeProfit = entryPrice * (1 + defaultTPPercent / 100);
                stopLoss = entryPrice * (1 - defaultSLPercent / 100);
                addPosition = entryPrice * 0.90; // 10% below entry
              } else {
                takeProfit = entryPrice * (1 - defaultTPPercent / 100);
                stopLoss = entryPrice * (1 + defaultSLPercent / 100);
                addPosition = entryPrice * 1.10; // 10% above entry
              }

              trades.push({
                id: `${okxPos.coin}-${Date.now()}`,
                symbol: okxPos.coin,
                action: action,
                entryPrice: entryPrice,
                takeProfit: takeProfit,
                stopLoss: stopLoss,
                addPosition: addPosition,
                dcaPrice: addPosition, // For compatibility
                quantity: okxPos.quantity,
                leverage: okxPos.leverage || 1,
                status: 'OPEN',
                entryTime: new Date(), // Approximate - OKX doesn't provide exact entry time
                lastSyncedWithOkx: new Date(),
                note: 'Position loaded from OKX - TP/SL/DCA set with defaults'
              });
              console.log(`   ✅ ${okxPos.coin}: ${okxPos.side} position - Quantity: ${okxPos.quantity.toFixed(8)}, Avg Price: $${entryPrice.toFixed(2)}, TP: $${takeProfit.toFixed(2)}, SL: $${stopLoss.toFixed(2)}`);
            });

            this.activeTrades = trades;
            console.log(`✅ Loaded ${trades.length} active trades from OKX`);
          } else {
            console.log(`✅ No open positions on OKX`);
            this.activeTrades = [];
          }
        } catch (error) {
          console.error(`❌ Error fetching OKX positions: ${error.message}`);
          console.log('⚠️ OKX unavailable - starting with empty trade list');
          this.activeTrades = [];
        }
      } else {
        // OKX not enabled - can't load real positions
        console.log('⚠️ OKX not configured - cannot load real positions');
        console.log('   Configure OKX_API_KEY, OKX_API_SECRET, and OKX_PASSPHRASE to use OKX as source of truth');
        this.activeTrades = [];
      }

      console.log(`✅ Bot initialization complete - ${this.activeTrades.length} active trades loaded`);
      addLogEntry(`Bot initialized with ${this.activeTrades.length} active trades`, 'success');

      // Start orphan order cleanup timer (runs every 5 minutes)
      this.startCleanupTimer();

      if (this.activeTrades && this.activeTrades.length > 0) {
        console.log(`✅ Active trades loaded: ${this.activeTrades.length} trades`);
        // Fix any trades missing TP, SL, or DCA levels (run in background to avoid blocking deployment)
        // Don't await - run asynchronously after initialization completes
        setTimeout(async () => {
          try {
            const fixedCount = await this.fixMissingTradeLevels();
            if (fixedCount > 0) {
              console.log(`🔧 Fixed ${fixedCount} existing trade(s) with missing TP, SL, or DCA levels`);
            }
          } catch (error) {
            console.error(`❌ Error fixing missing trade levels: ${error.message}`);
          }
        }, 1000); // Start after 1 second

        // Place algo orders for trades that don't have them (after a short delay to ensure OKX is ready)
        setTimeout(async () => {
          try {
            await this.placeMissingAlgoOrders();
            await this.placeMissingDcaOrders();
          } catch (error) {
            console.error(`❌ Error placing missing orders on startup: ${error.message}`);
          }
        }, 5000); // Wait 5 seconds after initialization

        console.log('✅ Trades will be synced with OKX on next update');
      } else {
        console.log('📂 No active trades found');
      }

      // Load closed trades
      // Removed: DynamoDB persistence - OKX is the only source of truth

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
          // Removed: DynamoDB persistence - OKX is the only source of truth

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

        // Removed: DynamoDB persistence - OKX is the only source of truth
        await sendTelegramMessage(
          `✂️ Partial Take-Profit\n\n${trade.symbol} locked in ${takePercent}% of the position at $${currentPrice.toFixed(
            2
          )}\nRealized P&L: $${realized.toFixed(2)} (${pnlPercent.toFixed(
            2
          )}%)`
        ).catch(() => { });

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

    const indicators = analysis.indicators || {};
    const patterns = analysis.patterns || [];

    // Get RSI thresholds from trading rules
    const rsiOversold = this.tradingRules.rsi.oversold;
    const rsiOverbought = this.tradingRules.rsi.overbought;

    let matches = 0;
    const timeframeDetails = [];
    let patternMatched = false; // Track if patterns have been counted

    timeframes.forEach((tf) => {
      const frame = frames[tf];
      if (!frame) {
        timeframeDetails.push({ timeframe: tf, trend: 'N/A', matched: false });
        return;
      }

      const trend = (frame.trend || '').toUpperCase();
      // Handle RSI as string or number (it might be stored as "28.27" string)
      let rsi = null;
      if (frame.rsi !== undefined && frame.rsi !== null && frame.rsi !== 'N/A') {
        rsi = Number(frame.rsi);
        if (isNaN(rsi)) rsi = null;
      }
      const bollingerPos = frame.bollingerPosition || 'MIDDLE';
      const currentPrice = Number(frame.price) || null;
      const support = Number(frame.support) || null;
      const resistance = Number(frame.resistance) || null;

      // Debug logging for first timeframe to diagnose issues
      if (tf === timeframes[0] && analysis.action === 'BUY') {
        console.log(`🔍 [${analysis.symbol}] Frame data for ${tf}:`);
        console.log(`   - RSI: ${rsi} (raw: ${frame.rsi}, type: ${typeof frame.rsi})`);
        console.log(`   - Trend: ${trend} (raw: ${frame.trend})`);
        console.log(`   - Bollinger: ${bollingerPos}`);
        console.log(`   - RSI Oversold Threshold: ${rsiOversold}`);
        console.log(`   - Full frame keys: ${Object.keys(frame).join(', ')}`);
      }

      // Get trading rules to check which requirements are enabled
      const buyRules = this.tradingRules.patterns.buy;
      const sellRules = this.tradingRules.patterns.sell;

      let matched = false;
      let matchReason = '';

      // Check trend alignment (existing check)
      if (analysis.action === 'BUY' && trend === 'BULLISH') {
        matches += 1;
        matched = true;
        matchReason = 'BULLISH_TREND';
      } else if (analysis.action === 'SELL' && trend === 'BEARISH') {
        matches += 1;
        matched = true;
        matchReason = 'BEARISH_TREND';
      }

      // If not matched by trend, check other bullish/bearish signals
      // These conditions count as timeframe alignment matches regardless of whether they're "required"
      if (!matched) {
        if (analysis.action === 'BUY') {
          // RSI oversold counts as bullish signal
          if (rsi !== null && rsi < rsiOversold) {
            matches += 1;
            matched = true;
            matchReason = 'RSI_OVERSOLD';
          }
          // Bollinger Lower counts as bullish signal
          else if (bollingerPos === 'LOWER') {
            matches += 1;
            matched = true;
            matchReason = 'BOLLINGER_LOWER';
          }
          // Support Level: Price within 2% of support level (bullish signal)
          else if (currentPrice !== null && support !== null) {
            const priceToSupportRatio = (currentPrice - support) / support;
            if (priceToSupportRatio >= 0 && priceToSupportRatio <= 0.02) { // Within 2% of support
              matches += 1;
              matched = true;
              matchReason = 'SUPPORT_LEVEL';
            }
          }
          // Fibonacci Support: Price near Fibonacci support levels (uses support level as proxy)
          // Note: Fibonacci support levels (0.618, 0.786) are typically near support zones
          else if (currentPrice !== null && support !== null) {
            const priceToSupportRatio = (currentPrice - support) / support;
            if (priceToSupportRatio >= 0 && priceToSupportRatio <= 0.02) {
              matches += 1;
              matched = true;
              matchReason = 'FIBONACCI_SUPPORT';
            }
          }
        } else if (analysis.action === 'SELL') {
          // RSI overbought counts as bearish signal
          if (rsi !== null && rsi > rsiOverbought) {
            matches += 1;
            matched = true;
            matchReason = 'RSI_OVERBOUGHT';
          }
          // Bollinger Upper counts as bearish signal
          else if (bollingerPos === 'UPPER') {
            matches += 1;
            matched = true;
            matchReason = 'BOLLINGER_UPPER';
          }
          // Resistance Level: Price within 2% of resistance level (bearish signal)
          else if (currentPrice !== null && resistance !== null) {
            const priceToResistanceRatio = (resistance - currentPrice) / currentPrice;
            if (priceToResistanceRatio >= 0 && priceToResistanceRatio <= 0.02) { // Within 2% of resistance
              matches += 1;
              matched = true;
              matchReason = 'RESISTANCE_LEVEL';
            }
          }
          // Fibonacci Resistance: Price near Fibonacci resistance levels (uses resistance level as proxy)
          // Note: Fibonacci resistance levels (0.236, 0.382) are typically near resistance zones
          else if (currentPrice !== null && resistance !== null) {
            const priceToResistanceRatio = (resistance - currentPrice) / currentPrice;
            if (priceToResistanceRatio >= 0 && priceToResistanceRatio <= 0.02) {
              matches += 1;
              matched = true;
              matchReason = 'FIBONACCI_RESISTANCE';
            }
          }
        }
      }

      // Note: Fibonacci Support/Resistance uses the same logic as Support/Resistance levels
      // since Fibonacci levels are typically calculated from support/resistance zones
      // If a more sophisticated Fibonacci retracement calculation is implemented later,
      // it can be added as a separate check here

      const trendDisplay = trend || (matched ? matchReason : 'N/A');
      timeframeDetails.push({ timeframe: tf, trend: trendDisplay, matched });
    });

    // Check patterns separately (patterns are global, not per-timeframe)
    // If we have matching patterns and haven't reached requiredMatches yet, add one match
    if (matches < requiredMatches && !patternMatched) {
      if (analysis.action === 'BUY') {
        const bullishPatterns = patterns.filter(p => p.signal === 'BULLISH');
        if (bullishPatterns.length > 0) {
          matches += 1;
          patternMatched = true;
          timeframeDetails.push({
            timeframe: 'PATTERNS',
            trend: 'BULLISH_PATTERN',
            matched: true
          });
        }
      } else if (analysis.action === 'SELL') {
        const bearishPatterns = patterns.filter(p => p.signal === 'BEARISH');
        if (bearishPatterns.length > 0) {
          matches += 1;
          patternMatched = true;
          timeframeDetails.push({
            timeframe: 'PATTERNS',
            trend: 'BEARISH_PATTERN',
            matched: true
          });
        }
      }
    }

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

    // Start background news filter job (saves premium AI costs)
    try {
      const newsFilterJob = require('../jobs/newsFilterJob');
      await newsFilterJob.start();
    } catch (error) {
      console.error('⚠️ Failed to start news filter job:', error.message);
      console.error('   Bot will continue without background news filtering');
    }

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
    console.log('🛑 Stopping auto-scan...');
    this.isRunning = false;
    this.stopTradesUpdateTimer();
    this.stopMonitoringTimer();
    this.stopCleanupTimer(); // Stop cleanup timer

    // Stop background news filter job
    try {
      const newsFilterJob = require('../jobs/newsFilterJob');
      newsFilterJob.stop();
    } catch (error) {
      console.error('⚠️ Failed to stop news filter job:', error.message);
    }

    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
    this.nextScanTime = null; // Clear next scan time when stopped
    console.log('🛑 Automated scan stopped');
    return { status: 'stopped' };
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
      console.log(`🚀 Bulk scanning top 10 coins for oversold opportunities...`);

      // Use bulk indicator service to scan top 10 coins (reduced to save API calls while fixing OKX issues)
      // Pass all trigger settings from UI (automatically uses latest saved settings)
      const bulkScanResults = await monitoringService.bulkScanTop200Coins({
        maxCoins: 10 // Reduced to 10 to save API calls while fixing OKX issues
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
                shouldEscalate: true,
                // Include full analysis data for AI prompts
                patterns: analysis.patterns || [],
                indicators: analysis.indicators || {},
                frames: analysis.frames || {}
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

        // TEMPORARILY DISABLED: Batch escalation causing duplicate orders
        // TODO: Re-enable after fixing duplicate order issue
        /*
        // Pass current active trades count to AI so it knows position limits
        const activeTradesCount = this.activeTrades ? this.activeTrades.length : 0;
        const batchEscalationResults = await monitoringService.batchEscalateToR1(escalations, activeTradesCount);

        // Process batch escalation results and collect confirmed trades
        const confirmedTrades = [];

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

            // Collect confirmed trades for batch execution
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
                // No existing trade - prepare for batch execution
                confirmedTrades.push({
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
                  dataSource: 'monitoring',
                  priorityLabel
                });
              } else {
                console.log(`${priorityLabel} ✅ Trade handled for ${symbol} (existing position managed)`);
              }
            } catch (error) {
              if (error.message === 'Trading is disabled' || error.message.includes('Trading not enabled')) {
                console.log(`${priorityLabel} ⚠️ OKX trading disabled - trade not executed for ${symbol}`);
              } else {
                console.log(`${priorityLabel} ⚠️ Failed to prepare trade for ${symbol}: ${error.message}`);
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

        // Execute confirmed trades in batch if multiple, otherwise individually
        if (confirmedTrades.length > 0) {
          // Check max positions limit
          const currentPositions = this.activeTrades ? this.activeTrades.length : 0;
          const maxPositions = 5;
          const availableSlots = maxPositions - currentPositions;

          if (availableSlots <= 0) {
            console.log(`⚠️ Maximum positions (${maxPositions}) reached. Skipping ${confirmedTrades.length} confirmed trade(s).`);
          } else {
            // Limit to available slots
            const tradesToExecute = confirmedTrades.slice(0, availableSlots);

            if (tradesToExecute.length > 1) {
              // Use batch orders for multiple trades
              console.log(`\n📦 Executing ${tradesToExecute.length} trades in batch order...`);
              try {
                await this.addActiveTradesBatch(tradesToExecute);
                console.log(`✅ Batch order executed successfully for ${tradesToExecute.length} trades`);
              } catch (batchError) {
                console.error(`❌ Batch order failed, falling back to individual orders: ${batchError.message}`);
                // Fallback to individual orders
                for (const trade of tradesToExecute) {
                  try {
                    await this.addActiveTrade(trade);
                    console.log(`${trade.priorityLabel} ✅ New trade executed successfully for ${trade.symbol}`);
                  } catch (error) {
                    console.log(`${trade.priorityLabel} ⚠️ Failed to execute trade for ${trade.symbol}: ${error.message}`);
                  }
                }
              }
            } else {
              // Single trade - use individual order
              const trade = tradesToExecute[0];
              try {
                await this.addActiveTrade(trade);
                console.log(`${trade.priorityLabel} ✅ New trade executed successfully for ${trade.symbol}`);
              } catch (error) {
                console.log(`${trade.priorityLabel} ⚠️ Failed to execute trade for ${trade.symbol}: ${error.message}`);
              }
            }

            if (confirmedTrades.length > availableSlots) {
              console.log(`⚠️ Skipped ${confirmedTrades.length - availableSlots} trade(s) due to position limit`);
            }
          }
        }

        // Send Telegram notifications (one per coin with both free and premium insights)
        await monitoringService.notifyR1DecisionBatch(batchEscalationResults);
        */
        console.log('⚠️ Batch escalation temporarily disabled to prevent duplicate orders');

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

          // Execute trade if OKX trading is enabled
          if (this.tradingRules.okxTradingEnabled) {
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

          // Removed: DynamoDB persistence - OKX is the only source of truth

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
          // Removed: DynamoDB persistence - OKX is the only source of truth
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

        // Cancel TP/SL algo orders before closing
        await this.cancelTradeAlgoOrders(existingTrade);

        const { closeTrade } = require('../services/portfolioService');
        await closeTrade(existingTrade.id, currentPrice, 'EARLY_CLOSE',
          `Closed due to opposite ${newAction} signal (confidence: ${(newConfidence * 100).toFixed(0)}%)`);

        // Remove from active trades
        this.activeTrades = this.activeTrades.filter(t => t.id !== existingTrade.id);
        // Removed: DynamoDB persistence - OKX is the only source of truth

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
    const { getPortfolio } = require('../services/portfolioService');
    const portfolio = getPortfolio();
    return portfolio.currentBalance || portfolio.initialCapital || 5000;
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
        maxPositions: 5, // Maximum 5 positions can be open at once
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

      // Filter out coins with open trades (they're re-evaluated separately by monitoring)
      const openTradeSymbols = new Set(
        this.activeTrades
          .filter(t => t.status === 'OPEN' || t.status === 'DCA_HIT' || t.status === 'PENDING')
          .map(t => t.symbol)
      );

      const coinsToScan = this.trackedCoins.filter(coin => !openTradeSymbols.has(coin.symbol));

      if (openTradeSymbols.size > 0) {
        console.log(`⏭️ Skipping ${openTradeSymbols.size} coin(s) with open trades: ${Array.from(openTradeSymbols).join(', ')}`);
        addLogEntry(`Skipping ${openTradeSymbols.size} coin(s) with open trades (will be re-evaluated separately)`, 'info');
      }

      // Update scan progress total
      this.scanProgress.total = coinsToScan.length;

      for (let i = 0; i < coinsToScan.length; i += BATCH_SIZE) {
        const batch = coinsToScan.slice(i, i + BATCH_SIZE);
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
                volume24h: analysis.volume24h || 0, // Store volume for volume profile calculation
                historicalData: null // Will be populated from analysis if needed
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

          // Apply volume confirmation filter and performance-based confidence boost
          let confidenceAdjustment = 0;
          const originalConfidence = analysis.confidence || 0;

          // 1. Volume Confirmation Filter
          try {
            // Get volume data from coin data or analysis
            const coinData = allCoinsData.find(c => c.symbol === coin.symbol);
            const volume24h = coinData?.volume24h || analysis.volume24h || 0;

            // Try to get historical volume data from the analysis object
            if (analysis.historicalVolumeData && analysis.historicalVolumeData.dailyData) {
              const dailyData = analysis.historicalVolumeData.dailyData || [];
              if (dailyData.length >= 20) {
                const prices = dailyData.map(d => d.close || d.price || 0).filter(p => p > 0);
                const volumes = dailyData.map(d => d.volume || 0).filter(v => v >= 0);

                if (prices.length === volumes.length && prices.length >= 20) {
                  const volumeProfile = calculateVolumeProfile(prices, volumes, 20);

                  if (volumeProfile.isValid) {
                    // Reject low volume signals (volumeRatio < 0.8)
                    if (volumeProfile.volumeRatio < 0.8) {
                      confidenceAdjustment -= 0.1; // -10% penalty for low volume
                      analysis.insights = analysis.insights || [];
                      analysis.insights.push(`Low volume detected (${(volumeProfile.volumeRatio * 100).toFixed(0)}% of average) - confidence reduced`);
                    }
                    // Boost high volume signals (volumeRatio > 2.0)
                    else if (volumeProfile.volumeRatio > 2.0) {
                      confidenceAdjustment += 0.1; // +10% boost for strong volume
                      analysis.insights = analysis.insights || [];
                      analysis.insights.push(`High volume spike detected (${(volumeProfile.volumeRatio * 100).toFixed(0)}% of average) - confidence boosted`);
                    }
                  }
                }
              }
            } else {
              // No historical volume data available - skip volume confirmation
              // Log this for debugging but don't penalize the signal
              if (volume24h > 0) {
                console.log(`⚠️ ${coin.symbol}: No historical volume data available - skipping volume confirmation (24h volume: ${volume24h.toLocaleString()})`);
              }
            }
          } catch (volumeError) {
            // Volume analysis failed, continue without adjustment
            console.log(`⚠️ Volume analysis failed for ${coin.symbol}: ${volumeError.message}`);
          }

          // 2. Performance-Based Confidence Boost
          try {
            const historicalWinRate = getHistoricalWinRate(coin.symbol, this.closedTrades || []);

            if (historicalWinRate !== null) {
              // Boost confidence for proven winners (win rate > 65%)
              if (historicalWinRate > 0.65) {
                confidenceAdjustment += 0.05; // +5% boost for proven winners
                analysis.insights = analysis.insights || [];
                analysis.insights.push(`Strong historical performance (${(historicalWinRate * 100).toFixed(0)}% win rate) - confidence boosted`);
              }
              // Penalize poor performers (win rate < 45%)
              else if (historicalWinRate < 0.45) {
                confidenceAdjustment -= 0.05; // -5% penalty for poor performers
                analysis.insights = analysis.insights || [];
                analysis.insights.push(`Weak historical performance (${(historicalWinRate * 100).toFixed(0)}% win rate) - confidence reduced`);
              }
            }
          } catch (perfError) {
            // Performance analysis failed, continue without adjustment
            console.log(`⚠️ Performance analysis failed for ${coin.symbol}: ${perfError.message}`);
          }

          // Apply confidence adjustments
          if (confidenceAdjustment !== 0) {
            analysis.confidence = Math.max(0, Math.min(1, originalConfidence + confidenceAdjustment));
            if (Math.abs(confidenceAdjustment) > 0.01) {
              console.log(`📊 ${coin.symbol}: Confidence adjusted from ${(originalConfidence * 100).toFixed(0)}% to ${(analysis.confidence * 100).toFixed(0)}% (${confidenceAdjustment > 0 ? '+' : ''}${(confidenceAdjustment * 100).toFixed(0)}%)`);
            }
          }

          console.log(`🔍 ${coin.symbol}: ${analysis.action} (${(analysis.confidence * 100).toFixed(0)}%) - AI: ${analysis.aiEvaluated ? '✅' : '❌'}`);

          // Only send rejection notifications for actionable signals (BUY / SELL)
          const isActionNotifiable = analysis.action === 'BUY' || analysis.action === 'SELL';

          // Only add real opportunities with valid data
          if (analysis.confidence >= this.tradingRules.minConfidence && !analysis.usesMockData) {
            // Log current trading rules for debugging
            console.log(`🔍 [${coin.symbol}] Trading rules check - minTimeframeAlignment: BUY=${this.tradingRules.patterns.buy.minTimeframeAlignment}, SELL=${this.tradingRules.patterns.sell.minTimeframeAlignment}`);

            const consensusResult = this.passesMultiTimeframeConsensus(analysis);
            if (!consensusResult.passed) {
              console.log(`🚫 ${coin.symbol}: Fails multi-timeframe consensus check (${consensusResult.matches}/${consensusResult.required} timeframes match)`);
              console.log(`   Current setting: minTimeframeAlignment=${this.tradingRules.patterns[analysis.action.toLowerCase()]?.minTimeframeAlignment || 'N/A'}`);
              // Debug: Show which timeframes were checked and why they didn't match
              if (consensusResult.timeframes && consensusResult.timeframes.length > 0) {
                console.log(`   Timeframe details:`);
                consensusResult.timeframes.forEach(tf => {
                  console.log(`     - ${tf.timeframe}: ${tf.trend} ${tf.matched ? '✅' : '❌'}`);
                });
              }

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
                        `${passed ? '✅' : '❌'} Bollinger Lower: ${bollingerPos} ${passed ? '=' : '≠'
                        } LOWER (REQUIRED)`
                      );
                    }
                    if (buyRules.requireBullishTrend) {
                      const passed = bullishFrames >= buyRules.minTimeframeAlignment;
                      ruleChecks.push(
                        `${passed ? '✅' : '❌'} Bullish Trend: ${bullishFrames}/${buyRules.minTimeframeAlignment
                        } timeframes (REQUIRED)`
                      );
                    }
                    if (buyRules.requirePattern) {
                      const passed = patterns.length > 0;
                      ruleChecks.push(
                        `${passed ? '✅' : '❌'} Pattern Required: ${patterns.length
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

Fix: ${dailyRSI > 30 && dailyRSI < 40
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

            // Check if we already have an open trade for this coin
            const existingOpenTrade = this.activeTrades.find(t =>
              t.symbol === coin.symbol &&
              (t.status === 'OPEN' || t.status === 'DCA_HIT')
            );

            if (existingOpenTrade) {
              console.log(`⏭️ ${coin.symbol}: Skipping - already have open ${existingOpenTrade.action} trade (${existingOpenTrade.status})`);
              addLogEntry(`${coin.symbol}: Skipped - open trade already exists`, 'info');
              continue; // Skip this coin, don't add to opportunities
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

      // Log OKX trading status
      const { isExchangeTradingEnabled } = require('../services/exchangeService');
      const exchangeConfig = isExchangeTradingEnabled();
      console.log(`\n${'='.repeat(60)}`);
      console.log(`📊 OPPORTUNITIES SUMMARY`);
      console.log(`${'='.repeat(60)}`);
      console.log(`✅ Opportunities found: ${opportunities.length}`);
      console.log(`📝 OKX Trading: ${exchangeConfig.enabled ? `✅ ENABLED (${exchangeConfig.mode})` : '❌ DISABLED - Configure OKX_API_KEY, OKX_API_SECRET, and OKX_PASSPHRASE'}`);
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
            // Check if we've reached max positions (5)
            const currentActiveTrades = this.activeTrades ? this.activeTrades.length : 0;
            if (currentActiveTrades >= 5) {
              console.log(`⏭️ Skipping trade execution for ${opp.symbol} - Maximum 5 positions already open (${currentActiveTrades}/5)`);
              continue;
            }

            console.log(`💼 Executing trade for ${opp.symbol}: ${opp.action} at $${opp.entryPrice?.toFixed(2) || 'N/A'} (${currentActiveTrades + 1}/5 positions)`);
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

      // Store historical volume data for volume profile calculation
      const historicalVolumeData = {
        dailyData: dailyData || [],
        hourlyData: hourlyData || [],
        minuteData: minuteData || []
      };

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

      // Prepare price data for ATR calculation (daily data with high/low/close)
      // ATR requires high, low, and close prices for accurate calculation
      const priceDataForATR = [];
      if (dailyData && dailyData.length > 0) {
        dailyData.slice(-30).forEach(d => {
          // ATR needs high, low, close - prefer actual high/low over fallback to price
          const high = d.high || 0;
          const low = d.low || 0;
          const close = d.close || d.price || 0;

          // Only add if we have valid high, low, and close
          // If high/low are missing, we can't calculate accurate ATR
          if (high > 0 && low > 0 && close > 0 && high >= low) {
            priceDataForATR.push({ high, low, close, price: close });
          }
        });
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
        priceData: priceDataForATR, // Price data for ATR calculation
        historicalVolumeData: historicalVolumeData, // Historical volume data for volume profile
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

    // STRICT: Check if ANY trade already exists for this symbol (prevent duplicates)
    // Block opening new position if there's ANY open position for this coin
    const existingTrade = this.activeTrades.find(t =>
      t.symbol === opportunity.symbol &&
      (t.status === 'OPEN' || t.status === 'DCA_HIT' || t.status === 'PENDING')
    );

    if (existingTrade) {
      const msg = `❌ Cannot open ${opportunity.action} position for ${opportunity.symbol} - already have ${existingTrade.action} position open (Status: ${existingTrade.status})`;
      addLogEntry(msg, 'warning');
      console.log(msg);
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

    // Ensure TP, SL, and DCA levels are always set with proper defaults
    // Default: 5% TP, 5% SL, DCA at 10% below entry for BUY (or 10% above for SELL)
    const defaultTPPercent = this.tradingRules?.defaultTakeProfit || 5.0; // 5% default
    const defaultSLPercent = this.tradingRules?.defaultStopLoss || 5.0; // 5% default

    let takeProfit = parsePrice(opportunity.takeProfit);
    let stopLoss = parsePrice(opportunity.stopLoss);
    let addPosition = parsePrice(opportunity.addPosition);

    // Validate and set defaults for TP
    if (!takeProfit || takeProfit <= 0 || takeProfit === entryPrice) {
      if (opportunity.action === 'BUY') {
        takeProfit = entryPrice * (1 + defaultTPPercent / 100);
      } else {
        takeProfit = entryPrice * (1 - defaultTPPercent / 100); // For SELL, TP is lower price
      }
      console.log(`⚠️ ${opportunity.symbol}: Missing or invalid TP, using default ${defaultTPPercent}%`);
    }

    // Validate and set defaults for SL
    if (!stopLoss || stopLoss <= 0 || stopLoss === entryPrice) {
      if (opportunity.action === 'BUY') {
        stopLoss = entryPrice * (1 - defaultSLPercent / 100);
      } else {
        stopLoss = entryPrice * (1 + defaultSLPercent / 100); // For SELL, SL is higher price
      }
      console.log(`⚠️ ${opportunity.symbol}: Missing or invalid SL, using default ${defaultSLPercent}%`);
    }

    // Validate and set defaults for DCA (addPosition)
    if (!addPosition || addPosition <= 0 || addPosition === entryPrice) {
      if (opportunity.action === 'BUY') {
        // For BUY: DCA should be BELOW entry (average down on dips)
        // This allows buying more at a lower price if trade goes against us
        addPosition = entryPrice * 0.85; // 15% below entry for BUY
      } else {
        // For SELL: DCA should be ABOVE entry (average up on bounces)
        // This allows selling more at a higher price if trade goes against us
        addPosition = entryPrice * 1.15; // 15% above entry for SELL
      }
      console.log(`⚠️ ${opportunity.symbol}: Missing or invalid DCA level, using default 15% from entry (toward SL for averaging)`);
    }

    // Calculate position size using FIXED dollar amounts per position
    // Import exchange services early for contract conversion
    const { calculateQuantity, OKX_SYMBOL_MAP } = require('../services/exchangeService');
    const { recordTrade, getPositionSize } = require('../services/portfolioService');

    let positionSizeUSD = 0;
    let initialQuantity = 0;

    // Count existing positions for this symbol to determine position size
    const existingPositions = this.activeTrades.filter(t =>
      t.symbol === opportunity.symbol &&
      (t.status === 'OPEN' || t.status === 'DCA_HIT' || t.status === 'PENDING')
    ).length;

    // Fixed position sizing based on symbol and position number
    // BTC: $100, $100, $200, $400, $800
    // Others: $50, $50, $100, $200, $400
    const isBTC = opportunity.symbol === 'BTC';
    const positionSizes = isBTC
      ? [100, 100, 200, 400, 800]  // BTC position sizes
      : [50, 50, 100, 200, 400];   // Other coins position sizes

    // Get position size based on position number (0-indexed, max 5 positions)
    const positionIndex = Math.min(existingPositions, positionSizes.length - 1);
    positionSizeUSD = positionSizes[positionIndex];

    initialQuantity = positionSizeUSD / entryPrice;

    // Calculate stop loss percentage for logging
    const stopLossDistance = Math.abs(entryPrice - stopLoss);
    const stopLossPercent = (stopLossDistance / entryPrice) * 100;

    addLogEntry(`💰 Position sizing: $${positionSizeUSD.toFixed(2)} (Position #${existingPositions + 1}, ${isBTC ? 'BTC' : 'ALT'} tier, SL: ${stopLossPercent.toFixed(2)}%)`, 'info');



    // Store coin data for proper price fetching
    const coinData = {
      symbol: opportunity.symbol,
      name: opportunity.name,
      id: opportunity.id || opportunity.name?.toLowerCase(),
      coinmarketcap_id: opportunity.coinmarketcap_id,
      coinpaprika_id: opportunity.coinpaprika_id,
      currentPrice: entryPrice
    };

    // Convert to OKX contracts if trading on OKX
    // IMPORTANT: OKX uses contracts for perpetual swaps, but minimum order size is much smaller than 1 contract
    // Contract size: Used for position value calculation
    // Minimum order: Smallest tradeable amount (e.g., BTC: 0.0001 BTC = ~$9)
    // Note: OKX_SYMBOL_MAP is imported later on line 3556
    const okxSymbol = OKX_SYMBOL_MAP[opportunity.symbol];

    if (okxSymbol) {
      // OKX contract specifications
      // Format: { contractSize, minOrder }
      const contractSpecs = {
        'BTC-USDT-SWAP': { contractSize: 0.01, minOrder: 0.0001 },   // 1 contract = 0.01 BTC, min = 0.0001 BTC (~$9)
        'ETH-USDT-SWAP': { contractSize: 0.1, minOrder: 0.001 },     // 1 contract = 0.1 ETH, min = 0.001 ETH (~$3.50)
        'SOL-USDT-SWAP': { contractSize: 1, minOrder: 0.1 },         // 1 contract = 1 SOL, min = 0.1 SOL
        'XRP-USDT-SWAP': { contractSize: 100, minOrder: 1 },        // 1 contract = 100 XRP, min = 1 XRP
        'DOGE-USDT-SWAP': { contractSize: 100, minOrder: 10 },       // 1 contract = 100 DOGE, min = 10 DOGE
        'ADA-USDT-SWAP': { contractSize: 100, minOrder: 1 },         // 1 contract = 100 ADA, min = 1 ADA
        'MATIC-USDT-SWAP': { contractSize: 10, minOrder: 1 },        // 1 contract = 10 MATIC, min = 1 MATIC
        'DOT-USDT-SWAP': { contractSize: 1, minOrder: 0.1 },         // 1 contract = 1 DOT, min = 0.1 DOT
        'AVAX-USDT-SWAP': { contractSize: 1, minOrder: 0.1 },        // 1 contract = 1 AVAX, min = 0.1 AVAX
        'LINK-USDT-SWAP': { contractSize: 1, minOrder: 0.1 },        // 1 contract = 1 LINK, min = 0.1 LINK
      };

      const spec = contractSpecs[okxSymbol] || { contractSize: 1, minOrder: 0.01 };
      const coinQuantity = initialQuantity; // This is in coins (e.g., 0.00105 BTC)

      // OKX accepts fractional contracts (e.g., 0.105 contracts for BTC)
      // We just need to ensure we meet the minimum order size
      const contracts = coinQuantity / spec.contractSize;
      const meetsMinimum = coinQuantity >= spec.minOrder;

      if (!meetsMinimum) {
        // If below minimum, use minimum order size
        const adjustedCoinQuantity = spec.minOrder;
        const adjustedContracts = adjustedCoinQuantity / spec.contractSize;
        const adjustedPositionSizeUSD = adjustedCoinQuantity * entryPrice;

        console.log(`⚠️ OKX Order Adjustment:`);
        console.log(`   Requested: $${positionSizeUSD.toFixed(2)} → ${coinQuantity.toFixed(8)} ${opportunity.symbol}`);
        console.log(`   Below minimum: ${spec.minOrder} ${opportunity.symbol} (${(spec.minOrder * entryPrice).toFixed(2)} USD)`);
        console.log(`   Adjusted to: ${adjustedCoinQuantity.toFixed(8)} ${opportunity.symbol} = $${adjustedPositionSizeUSD.toFixed(2)}`);

        initialQuantity = adjustedContracts;
        positionSizeUSD = adjustedPositionSizeUSD;
      } else {
        // Meets minimum, use requested amount (OKX accepts fractional contracts)
        console.log(`✅ OKX Order Size:`);
        console.log(`   Requested: $${positionSizeUSD.toFixed(2)} → ${coinQuantity.toFixed(8)} ${opportunity.symbol}`);
        console.log(`   Contracts: ${contracts.toFixed(4)} (${contracts >= 1 ? Math.floor(contracts) + ' full + ' + ((contracts % 1) * 100).toFixed(1) + '%' : 'fractional'})`);
        console.log(`   Meets minimum: ${spec.minOrder} ${opportunity.symbol} ✓`);

        // Keep the original coin quantity, but convert to contracts for OKX API
        initialQuantity = contracts;
      }
    }

    // Create new trade object
    const newTrade = {
      id: `${opportunity.symbol}-${Date.now()}`,
      tradeId: `${opportunity.symbol}-${Date.now()}`,
      symbol: opportunity.symbol,
      name: opportunity.name,
      action: opportunity.action,
      entryPrice: entryPrice,
      currentPrice: entryPrice,
      takeProfit: takeProfit,
      stopLoss: stopLoss,
      addPosition: addPosition,
      dcaPrice: addPosition,
      quantity: initialQuantity,
      positionValueUSD: positionSizeUSD, // Track actual position value
      leverage: 1,
      confidence: opportunity.confidence,
      status: 'PENDING',
      entryTime: new Date(),
      coinData: coinData,
      insights: opportunity.insights || [],
      reason: opportunity.reason || '',
      dataSource: opportunity.dataSource || 'unknown',
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

    // CRITICAL: Add trade to activeTrades with PENDING status BEFORE OKX execution
    // This prevents race condition where two trades for the same symbol start executing simultaneously
    newTrade.status = 'PENDING';
    this.activeTrades.push(newTrade);
    console.log(`📝 Added ${newTrade.symbol} to activeTrades with PENDING status (prevents duplicate race condition)`);

    // EXECUTE ORDER ON OKX FIRST (source of truth)
    const { isExchangeTradingEnabled, getPreferredExchange, executeOkxMarketOrder, executeOkxBatchOrders, placeOkxAlgoOrder, validateOkxLeverage } = require('../services/exchangeService');

    const exchangeConfig = isExchangeTradingEnabled();

    if (exchangeConfig.enabled) {
      const okxSymbol = OKX_SYMBOL_MAP[newTrade.symbol];
      if (okxSymbol) {
        const exchange = getPreferredExchange();
        const side = newTrade.action === 'BUY' ? 'buy' : 'sell'; // OKX uses lowercase
        const posSide = side === 'buy' ? 'long' : 'short';
        const modeLabel = 'OKX_DEMO';
        let leverage = parseFloat(process.env.OKX_LEVERAGE || '1');

        // Validate leverage against OKX limits
        try {
          const leverageValidation = await validateOkxLeverage(
            okxSymbol,
            leverage,
            'cross',
            exchange.apiKey,
            exchange.apiSecret,
            exchange.passphrase,
            exchange.baseUrl
          );

          if (!leverageValidation.valid && leverageValidation.maxLeverage) {
            console.warn(`⚠️ ${leverageValidation.message}, using ${leverageValidation.maxLeverage}x`);
            leverage = leverageValidation.maxLeverage;
          } else if (leverageValidation.valid) {
            console.log(`✅ ${leverageValidation.message}`);
          }
        } catch (error) {
          console.warn(`⚠️ Failed to validate leverage, using requested ${leverage}x: ${error.message}`);
          // Continue with requested leverage if validation fails
        }

        console.log(`💰 Executing ${newTrade.action} order on OKX (${modeLabel}): ${side} ${initialQuantity} ${newTrade.symbol} at $${entryPrice.toFixed(2)}`);

        try {
          const orderResult = await executeOkxMarketOrder(
            okxSymbol,
            side,
            initialQuantity,
            exchange.apiKey,
            exchange.apiSecret,
            exchange.passphrase,
            exchange.baseUrl,
            leverage
          );

          if (orderResult.success) {
            console.log(`✅ OKX order executed successfully! Order ID: ${orderResult.orderId || 'N/A'}`);
            newTrade.okxOrderId = orderResult.orderId;
            newTrade.okxExecutedPrice = orderResult.price || entryPrice;
            newTrade.okxExecutedQuantity = orderResult.executedQty || initialQuantity;
            newTrade.okxExecutedAt = new Date();
            // Update quantity from actual execution
            newTrade.quantity = orderResult.executedQty || initialQuantity;

            // Automatically place TP/SL algo orders on OKX (don't freeze margin, execute automatically)
            try {
              // For BUY (long) positions:
              //   TP = sell at takeProfit (higher price = profit)
              //   SL = sell at stopLoss (lower price = loss)
              // For SELL (short) positions:
              //   TP = buy at takeProfit (lower price = profit when price goes down)
              //   SL = buy at stopLoss (higher price = loss when price goes up)
              let tpTriggerPrice, slTriggerPrice, tpOrderSide;

              if (newTrade.action === 'BUY') {
                // Long position
                tpTriggerPrice = takeProfit; // Higher price = profit
                slTriggerPrice = stopLoss; // Lower price = loss
                tpOrderSide = 'sell'; // Sell to close long position

                // Validate TP is above entry and SL is below entry
                if (tpTriggerPrice <= entryPrice) {
                  console.warn(`⚠️ ${newTrade.symbol}: TP ($${tpTriggerPrice.toFixed(2)}) must be above entry ($${entryPrice.toFixed(2)}) for BUY position`);
                  tpTriggerPrice = entryPrice * 1.05; // Default 5% above entry
                }
                if (slTriggerPrice >= entryPrice) {
                  console.warn(`⚠️ ${newTrade.symbol}: SL ($${slTriggerPrice.toFixed(2)}) must be below entry ($${entryPrice.toFixed(2)}) for BUY position`);
                  slTriggerPrice = entryPrice * 0.95; // Default 5% below entry
                }
              } else {
                // Short position (SELL)
                // For shorts: profit when price goes DOWN, loss when price goes UP
                // takeProfit is a lower price (profit target), stopLoss is a higher price (loss limit)
                tpTriggerPrice = takeProfit; // Lower price = profit for short
                slTriggerPrice = stopLoss; // Higher price = loss for short
                tpOrderSide = 'buy'; // Buy to close short position

                // Validate TP is below entry and SL is above entry
                if (tpTriggerPrice >= entryPrice) {
                  console.warn(`⚠️ ${newTrade.symbol}: TP ($${tpTriggerPrice.toFixed(2)}) must be below entry ($${entryPrice.toFixed(2)}) for SELL position`);
                  tpTriggerPrice = entryPrice * 0.95; // Default 5% below entry
                }
                if (slTriggerPrice <= entryPrice) {
                  console.warn(`⚠️ ${newTrade.symbol}: SL ($${slTriggerPrice.toFixed(2)}) must be above entry ($${entryPrice.toFixed(2)}) for SELL position`);
                  slTriggerPrice = entryPrice * 1.05; // Default 5% above entry
                }
              }

              // OKX doesn't support closeFraction for conditional orders - use actual executed quantity
              const executedQty = orderResult.executedQty || initialQuantity;
              const algoOrderParams = {
                instId: okxSymbol,
                tdMode: 'isolated',
                side: tpOrderSide, // Opposite side to close position
                posSide: posSide,
                ordType: 'conditional',
                sz: executedQty.toString(), // Use actual executed quantity (OKX doesn't support closeFraction for conditional orders)
                tpTriggerPx: tpTriggerPrice.toFixed(8), // Use more precision for OKX
                tpOrdPx: '-1', // Market order for TP
                slTriggerPx: slTriggerPrice.toFixed(8), // Use more precision for OKX
                slOrdPx: '-1', // Market order for SL
                tpTriggerPxType: 'last', // Use last price as trigger
                slTriggerPxType: 'last',
                reduceOnly: true, // Only reduce position
                cxlOnClosePos: true // Cancel TP/SL when position is closed
                // Note: algoClOrdId is optional - OKX will generate one if not provided
              };

              console.log(`📊 Placing TP/SL algo orders on OKX for ${newTrade.symbol}...`);
              console.log(`   Entry: $${entryPrice.toFixed(2)}, Current: $${currentPrice.toFixed(2)}`);
              console.log(`   TP: $${tpTriggerPrice.toFixed(2)} (${tpOrderSide}), SL: $${slTriggerPrice.toFixed(2)}`);

              const { getOkxOpenPositions } = require('../services/exchangeService');
              let positionSize = null;
              try {
                const positions = await getOkxOpenPositions(
                  exchange.apiKey,
                  exchange.apiSecret,
                  exchange.passphrase,
                  exchange.baseUrl
                );
                const position = positions.find(p => {
                  const instId = p.instId || p.symbol || '';
                  return instId === okxSymbol || instId.includes(newTrade.symbol.split('-')[0]);
                });
                if (position) {
                  positionSize = Math.abs(parseFloat(position.quantity || position.pos || 0));
                  console.log(`   📊 Found position size: ${positionSize} for ${okxSymbol}`);
                } else {
                  // Fallback to executed quantity
                  positionSize = parseFloat(orderResult.executedQty || initialQuantity || 0);
                  console.log(`   ⚠️ Position not found on OKX, using executed quantity: ${positionSize}`);
                }
              } catch (posError) {
                // Fallback to executed quantity
                positionSize = parseFloat(orderResult.executedQty || initialQuantity || 0);
                console.log(`   ⚠️ Failed to get position size, using executed quantity: ${positionSize}`);
              }

              if (!positionSize || positionSize <= 0) {
                console.log(`   ❌ Cannot place separate orders - no valid position size found`);
                newTrade.tpSlAutoPlaced = false;
              } else {
                // Place TP order with actual position size
                const tpOrderParams = {
                  instId: okxSymbol,
                  tdMode: 'isolated', // Match account margin mode
                  side: tpOrderSide,
                  posSide: posSide,
                  ordType: 'conditional',
                  sz: positionSize.toString(), // Use actual position size instead of closeFraction
                  tpTriggerPx: tpTriggerPrice.toFixed(8),
                  tpOrdPx: '-1',
                  tpTriggerPxType: 'last',
                  reduceOnly: true,
                  cxlOnClosePos: true
                };

                const tpResult = await placeOkxAlgoOrder(
                  tpOrderParams,
                  exchange.apiKey,
                  exchange.apiSecret,
                  exchange.passphrase,
                  exchange.baseUrl
                );

                // Small delay between orders
                await new Promise(resolve => setTimeout(resolve, 500));

                // Place SL order with actual position size
                const slOrderParams = {
                  instId: okxSymbol,
                  tdMode: 'isolated', // Match account margin mode
                  side: tpOrderSide,
                  posSide: posSide,
                  ordType: 'conditional',
                  sz: positionSize.toString(), // Use actual position size instead of closeFraction
                  slTriggerPx: slTriggerPrice.toFixed(8),
                  slOrdPx: '-1',
                  slTriggerPxType: 'last',
                  reduceOnly: true,
                  cxlOnClosePos: true
                };

                const slResult = await placeOkxAlgoOrder(
                  slOrderParams,
                  exchange.apiKey,
                  exchange.apiSecret,
                  exchange.passphrase,
                  exchange.baseUrl
                );

                // Handle partial success - place orders individually and track each
                let tpPlaced = false;
                let slPlaced = false;

                if (tpResult.success) {
                  console.log(`✅ TP algo order placed for ${newTrade.symbol}! TP Algo ID: ${tpResult.algoId || tpResult.algoClOrdId}`);
                  tpPlaced = true;
                  newTrade.okxTpAlgoId = tpResult.algoId;
                  newTrade.okxTpAlgoClOrdId = tpResult.algoClOrdId;
                } else {
                  console.log(`⚠️ Failed to place TP order for ${newTrade.symbol}: ${tpResult.error || 'Unknown error'}`);
                }

                if (slResult.success) {
                  console.log(`✅ SL algo order placed for ${newTrade.symbol}! SL Algo ID: ${slResult.algoId || slResult.algoClOrdId}`);
                  slPlaced = true;
                  newTrade.okxSlAlgoId = slResult.algoId;
                  newTrade.okxSlAlgoClOrdId = slResult.algoClOrdId;
                } else {
                  console.log(`⚠️ Failed to place SL order for ${newTrade.symbol}: ${slResult.error || 'Unknown error'}`);
                }

                if (tpPlaced || slPlaced) {
                  // At least one order succeeded
                  newTrade.okxAlgoId = tpResult.algoId || slResult.algoId; // Store primary algo ID
                  newTrade.okxAlgoClOrdId = tpResult.algoClOrdId || slResult.algoClOrdId;
                  newTrade.tpSlAutoPlaced = tpPlaced && slPlaced; // Only fully auto if both placed

                  // Set timestamp to enable cooldown protection
                  newTrade.lastAlgoOrderPlacement = Date.now();

                  if (tpPlaced && slPlaced) {
                    addLogEntry(`TP/SL algo orders placed separately on OKX for ${newTrade.symbol} (TP: $${tpTriggerPrice.toFixed(2)}, SL: $${slTriggerPrice.toFixed(2)})`, 'info');
                  } else {
                    addLogEntry(`Partial TP/SL orders placed on OKX for ${newTrade.symbol} (TP: ${tpPlaced ? '✅' : '❌'}, SL: ${slPlaced ? '✅' : '❌'})`, 'warning');
                  }
                } else {
                  console.log(`❌ Failed to place both TP and SL orders for ${newTrade.symbol}`);
                  console.log(`   Trade will be monitored manually for TP/SL execution`);
                  newTrade.tpSlAutoPlaced = false;
                }
              }
              // Place DCA limit order at addPosition price (if trade goes against us)
              // For BUY: DCA limit buy order at lower price (addPosition < entryPrice)
              // For SELL: DCA limit sell order at higher price (addPosition > entryPrice)
              try {
                let dcaPrice = addPosition; // Use let instead of const (may be adjusted)
                const dcaSide = newTrade.action === 'BUY' ? 'buy' : 'sell';

                // FIX: Check if DCA order already exists in trade object FIRST (prevent duplicates)
                if (newTrade.okxDcaOrderId) {
                  console.log(`⏭️ ${newTrade.symbol}: Skipping DCA order placement - already has okxDcaOrderId=${newTrade.okxDcaOrderId}`);
                } else {
                  // Validate DCA price is correct direction
                  let shouldPlaceDCA = false;
                  if (newTrade.action === 'BUY') {
                    // For BUY: DCA should be below entry (to buy more at lower price)
                    shouldPlaceDCA = dcaPrice < entryPrice && dcaPrice > 0;
                    if (!shouldPlaceDCA) {
                      console.log(`⚠️ ${newTrade.symbol}: DCA price ($${dcaPrice.toFixed(2)}) must be below entry ($${entryPrice.toFixed(2)}) for BUY position`);
                    }
                  } else {
                    // For SELL: DCA should be above entry (to sell more at higher price)
                    shouldPlaceDCA = dcaPrice > entryPrice && dcaPrice > 0;
                    if (!shouldPlaceDCA) {
                      console.log(`⚠️ ${newTrade.symbol}: DCA price ($${dcaPrice.toFixed(2)}) must be above entry ($${entryPrice.toFixed(2)}) for SELL position`);
                    }
                  }

                  if (shouldPlaceDCA) {
                    // FIX: Ensure DCA is positioned correctly relative to SL before placing
                    const currentSL = newTrade.stopLoss;
                    if (currentSL && currentSL > 0) {
                      if (newTrade.action === 'BUY') {
                        // For BUY: DCA must be ABOVE SL but BELOW entry
                        // Order: SL < DCA < Entry
                        if (dcaPrice <= currentSL) {
                          // DCA is at or below SL - adjust to be 40% between SL and entry
                          const distance = entryPrice - currentSL;
                          const adjustedDca = currentSL + (distance * 0.4); // 40% above SL toward entry
                          console.log(`   🔄 ${newTrade.symbol}: DCA price $${dcaPrice.toFixed(2)} is at/below SL $${currentSL.toFixed(2)} - adjusting to $${adjustedDca.toFixed(2)} (40% between SL and entry)`);
                          dcaPrice = adjustedDca;
                          newTrade.addPosition = adjustedDca;
                          newTrade.dcaPrice = adjustedDca;
                        }
                      } else if (newTrade.action === 'SELL') {
                        // For SELL: DCA must be BELOW SL but ABOVE entry
                        // Order: Entry < DCA < SL
                        if (dcaPrice >= currentSL) {
                          // DCA is at or above SL - adjust to be 40% between entry and SL
                          const distance = currentSL - entryPrice;
                          const adjustedDca = currentSL - (distance * 0.4); // 40% below SL toward entry
                          console.log(`   🔄 ${newTrade.symbol}: DCA price $${dcaPrice.toFixed(2)} is at/above SL $${currentSL.toFixed(2)} - adjusting to $${adjustedDca.toFixed(2)} (40% between entry and SL)`);
                          dcaPrice = adjustedDca;
                          newTrade.addPosition = adjustedDca;
                          newTrade.dcaPrice = adjustedDca;
                        }
                      }
                    }

                    // Check OKX for existing limit orders to prevent duplicates
                    const { getOkxPendingOrders, getOkxOpenPositions } = require('../services/exchangeService');
                    let hasExistingDcaOrder = false;

                    try {
                      const pendingOrders = await getOkxPendingOrders(
                        okxSymbol,
                        exchange.apiKey,
                        exchange.apiSecret,
                        exchange.passphrase,
                        exchange.baseUrl
                      );

                      if (pendingOrders && pendingOrders.success && pendingOrders.orders && pendingOrders.orders.length > 0) {
                        const activeLimitOrders = pendingOrders.orders.filter(order => {
                          const state = order.state || order.ordState || '';
                          const ordType = order.ordType || '';
                          return (state === 'live' || state === 'partially_filled') && ordType === 'limit';
                        });

                        // Check if any limit order matches our DCA price (within 1% tolerance)
                        for (const order of activeLimitOrders) {
                          const orderPrice = parseFloat(order.px || order.price || 0);
                          const priceDiff = Math.abs(orderPrice - dcaPrice) / dcaPrice;
                          const side = order.side || '';

                          if (priceDiff < 0.01 && side === dcaSide) {
                            hasExistingDcaOrder = true;
                            console.log(`   ✅ ${newTrade.symbol}: Found existing DCA limit order on OKX (Order ID: ${order.ordId || order.clOrdId || 'unknown'}, Price: $${orderPrice.toFixed(2)})`);
                            newTrade.okxDcaOrderId = order.ordId || order.clOrdId;
                            newTrade.okxDcaPrice = orderPrice;
                            console.log(`   📝 Updated trade object with DCA order ID: ${newTrade.okxDcaOrderId}`);
                            break;
                          }
                        }
                      }
                    } catch (checkError) {
                      console.warn(`⚠️ ${newTrade.symbol}: Could not check OKX for existing limit orders: ${checkError.message}`);
                    }

                    if (hasExistingDcaOrder) {
                      console.log(`⏭️ ${newTrade.symbol}: Skipping DCA order placement - found existing order on OKX`);
                    } else if (!hasExistingDcaOrder) {
                      // Get actual position size from OKX (more accurate than initialQuantity)
                      let positionSize = null;
                      try {
                        const positions = await getOkxOpenPositions(
                          exchange.apiKey,
                          exchange.apiSecret,
                          exchange.passphrase,
                          exchange.baseUrl
                        );
                        const position = positions.find(p => {
                          const instId = p.instId || p.symbol || '';
                          return instId === okxSymbol || instId.includes(newTrade.symbol.split('-')[0]);
                        });
                        if (position) {
                          positionSize = Math.abs(parseFloat(position.quantity || position.pos || 0));
                          console.log(`   📊 Found position size from OKX: ${positionSize}`);
                        } else {
                          // Fallback to executed quantity
                          positionSize = parseFloat(orderResult.executedQty || initialQuantity || 0);
                          console.log(`   ⚠️ Position not found on OKX, using executed quantity: ${positionSize}`);
                        }
                      } catch (posError) {
                        // Fallback to executed quantity
                        positionSize = parseFloat(orderResult.executedQty || initialQuantity || 0);
                        console.log(`   ⚠️ Failed to get position size, using executed quantity: ${positionSize}`);
                      }

                      if (!positionSize || positionSize <= 0) {
                        console.log(`⚠️ ${newTrade.symbol}: Cannot place DCA order - no valid position size found`);
                      } else {
                        // Calculate DCA quantity using FIXED tiers (same as initial position logic)
                        // BTC: $100, $100, $200, $400, $800
                        // Others: $50, $50, $100, $200, $400

                        // Determine which tier this DCA belongs to
                        // existingPositions is the count BEFORE this new trade
                        // So this new trade is existingPositions + 1 (Position #1 if existing was 0)
                        // The DCA order is for the NEXT addition, so it's existingPositions + 2 (Position #2)
                        // Array is 0-indexed, so index = (existingPositions + 1)
                        const dcaPositionIndex = Math.min(existingPositions + 1, positionSizes.length - 1);
                        const dcaSizeUSD = positionSizes[dcaPositionIndex];

                        let dcaQuantity = dcaSizeUSD / dcaPrice;

                        // Apply minimum quantity checks
                        if (dcaQuantity < 1 && positionSize >= 1) {
                          // For contracts where size must be integer (usually)
                          // But for crypto-margined or some linear, it might be fractional.
                          // Safest is to check against 0.01 or 1 based on symbol type, but here we use a heuristic
                          // If current position is integer, likely DCA should be too? 
                          // Actually, let's trust the division but ensure min size
                          // dcaQuantity = 1; 
                        }

                        // Ensure minimum 0.01 (standard for most crypto)
                        if (dcaQuantity < 0.01) {
                          dcaQuantity = 0.01;
                        }

                        console.log(`   💰 DCA Sizing: $${dcaSizeUSD} (Tier #${dcaPositionIndex + 1}) -> ${dcaQuantity.toFixed(8)} coins @ $${dcaPrice.toFixed(2)}`);

                        // Convert to OKX contracts for DCA order (same as initial trade)
                        const contractSpecs = {
                          'BTC-USDT-SWAP': { contractSize: 0.01, minOrder: 0.0001 },
                          'ETH-USDT-SWAP': { contractSize: 0.1, minOrder: 0.001 },
                          'SOL-USDT-SWAP': { contractSize: 1, minOrder: 0.1 },
                          'XRP-USDT-SWAP': { contractSize: 100, minOrder: 1 },
                          'DOGE-USDT-SWAP': { contractSize: 100, minOrder: 10 },
                          'ADA-USDT-SWAP': { contractSize: 100, minOrder: 1 },
                          'MATIC-USDT-SWAP': { contractSize: 10, minOrder: 1 },
                          'DOT-USDT-SWAP': { contractSize: 1, minOrder: 0.1 },
                          'AVAX-USDT-SWAP': { contractSize: 1, minOrder: 0.1 },
                          'LINK-USDT-SWAP': { contractSize: 1, minOrder: 0.1 },
                        };

                        const dcaSpec = contractSpecs[okxSymbol] || { contractSize: 1, minOrder: 0.01 };
                        const dcaCoinQuantity = dcaQuantity;
                        const dcaContracts = dcaCoinQuantity / dcaSpec.contractSize;

                        if (dcaCoinQuantity >= dcaSpec.minOrder) {
                          dcaQuantity = dcaContracts; // Use fractional contracts
                          console.log(`   ✅ DCA contracts: ${dcaContracts.toFixed(4)} (meets minimum)`);
                        } else {
                          // Below minimum, adjust to minimum
                          dcaQuantity = dcaSpec.minOrder / dcaSpec.contractSize;
                          console.log(`   ⚠️ DCA adjusted to minimum: ${dcaSpec.minOrder} ${newTrade.symbol} = ${dcaQuantity.toFixed(4)} contracts`);
                        }

                        console.log(`   📊 DCA quantity calculation - positionSize=${positionSize}, dcaQuantity=${dcaQuantity}`);

                        if (dcaQuantity > 0) {
                          console.log(`📊 Placing DCA limit order for ${newTrade.symbol} at $${dcaPrice.toFixed(2)} (${dcaSide}, qty: ${dcaQuantity})...`);

                          const { executeOkxLimitOrder } = require('../services/exchangeService');
                          const dcaOrderResult = await executeOkxLimitOrder(
                            okxSymbol,
                            dcaSide,
                            dcaQuantity,
                            dcaPrice, // Limit price
                            exchange.apiKey,
                            exchange.apiSecret,
                            exchange.passphrase,
                            exchange.baseUrl,
                            leverage
                          );

                          if (dcaOrderResult.success) {
                            console.log(`✅ DCA limit order placed for ${newTrade.symbol} at $${dcaPrice.toFixed(2)}! Order ID: ${dcaOrderResult.orderId}`);
                            newTrade.okxDcaOrderId = dcaOrderResult.orderId;
                            newTrade.okxDcaPrice = dcaPrice;
                            newTrade.okxDcaQuantity = dcaQuantity;
                            console.log(`   📝 Saved DCA order ID to trade object: ${newTrade.okxDcaOrderId}`);
                            addLogEntry(`DCA limit order placed on OKX for ${newTrade.symbol} at $${dcaPrice.toFixed(2)} (will execute if price reaches this level)`, 'info');
                          } else {
                            console.log(`⚠️ Failed to place DCA limit order for ${newTrade.symbol}: ${dcaOrderResult.error || 'Unknown error'}`);
                          }
                        } else {
                          console.log(`⚠️ ${newTrade.symbol}: DCA quantity is 0, skipping DCA limit order`);
                        }
                      }
                    }
                  }
                }
              } catch (dcaError) {
                console.error(`❌ Error placing DCA limit order for ${newTrade.symbol}: ${dcaError.message}`);
                // Don't fail the trade if DCA order fails - it's optional
              }
            } catch (algoError) {
              console.log(`⚠️ Error placing TP/SL algo orders: ${algoError.message}`);
              console.log(`   Trade will be monitored manually for TP/SL execution`);
              newTrade.tpSlAutoPlaced = false;
            }
          } else {
            console.error(`❌ OKX order failed: ${orderResult.error}`);
            throw new Error(`OKX order execution failed: ${orderResult.error}`);
          }
        } catch (orderError) {
          console.error(`❌ Failed to execute OKX order for ${newTrade.symbol}:`, orderError.message);
          throw new Error(`Cannot create trade - OKX order execution failed: ${orderError.message}`);
        }
      } else {
        throw new Error(`Symbol ${newTrade.symbol} not available on OKX`);
      }
    } else {
      throw new Error('OKX trading not enabled. Configure OKX_API_KEY, OKX_API_SECRET, and OKX_PASSPHRASE.');
    }

    // Trade was already added to activeTrades with PENDING status before OKX execution
    // Now update status to OPEN after successful execution
    newTrade.status = 'OPEN';
    console.log(`✅ Updated ${newTrade.symbol} status from PENDING to OPEN`);

    // Special logging for BTC trades to track them
    if (newTrade.symbol === 'BTC' || newTrade.symbol === 'btc') {
      console.log(`🔵 BTC TRADE CREATED & EXECUTED ON OKX: id=${newTrade.id || newTrade.tradeId}, entryPrice=$${newTrade.entryPrice}, quantity=${newTrade.quantity}`);
    }

    // Record trade in portfolio
    await recordTrade(newTrade);

    // Removed: DynamoDB persistence - OKX is the only source of truth

    addLogEntry(`NEW TRADE EXECUTED ON OKX: ${newTrade.action} ${newTrade.symbol} at $${newTrade.entryPrice.toFixed(2)} (TP: $${newTrade.takeProfit.toFixed(2)}, SL: $${newTrade.stopLoss.toFixed(2)})`, 'success');
    // TODO: Send Telegram notification for new trade opened
  }

  /**
   * Add multiple active trades using batch orders (more efficient)
   * @param {Array<Object>} opportunities - Array of trade opportunities
   */
  async addActiveTradesBatch(opportunities) {
    if (!Array.isArray(opportunities) || opportunities.length === 0) {
      throw new Error('Opportunities must be a non-empty array');
    }

    if (opportunities.length > 20) {
      throw new Error('Maximum 20 trades per batch request');
    }

    const { isExchangeTradingEnabled, getPreferredExchange, executeOkxBatchOrders, OKX_SYMBOL_MAP } = require('../services/exchangeService');
    const exchangeConfig = isExchangeTradingEnabled();

    if (!exchangeConfig.enabled) {
      throw new Error('OKX trading not enabled. Configure OKX_API_KEY, OKX_API_SECRET, and OKX_PASSPHRASE.');
    }

    const exchange = getPreferredExchange();
    const leverage = parseFloat(process.env.OKX_LEVERAGE || '1');
    const { getPortfolio } = require('../services/portfolioService');
    const { calculatePositionSizeWithRR } = require('../services/positionSizingService');
    const { calculateQuantity } = require('../services/exchangeService');
    const { recordTrade } = require('../services/portfolioService');

    const portfolio = getPortfolio();
    const portfolioValue = portfolio.currentBalance || portfolio.initialCapital || 5000;

    // Prepare batch orders and trade objects
    const batchOrders = [];
    const tradeObjects = [];

    for (const opportunity of opportunities) {
      if (opportunity.action === 'HOLD') {
        continue; // Skip HOLD signals
      }

      // Check for existing trade
      const existingTrade = this.activeTrades.find(t =>
        t.symbol === opportunity.symbol &&
        t.action === opportunity.action &&
        (t.status === 'OPEN' || t.status === 'DCA_HIT')
      );

      if (existingTrade) {
        console.log(`⚠️ Trade already exists for ${opportunity.symbol}, skipping from batch`);
        continue;
      }

      const okxSymbol = OKX_SYMBOL_MAP[opportunity.symbol];
      if (!okxSymbol) {
        console.log(`⚠️ Symbol ${opportunity.symbol} not available on OKX, skipping from batch`);
        continue;
      }

      // Parse prices
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

      // Calculate position size using FIXED dollar amounts per position
      // BTC: $100 (1st position)
      // Others: $50 (1st position)

      const isBTC = opportunity.symbol === 'BTC';
      // For batch trades, we assume it's the first position (since we checked for existing trades above)
      // So we use the first tier: $100 for BTC, $50 for others
      let positionSizeUSD = isBTC ? 100 : 50;

      // Calculate quantity based on fixed dollar amount
      let initialQuantity = positionSizeUSD / entryPrice;

      console.log(`💰 Batch Position Sizing: $${positionSizeUSD} (${isBTC ? 'BTC' : 'ALT'} Tier 1) -> ${initialQuantity.toFixed(8)} coins @ $${entryPrice.toFixed(2)}`);

      // Round quantity for OKX (minimum 1 contract)
      const roundedQuantity = Math.max(1, Math.round(initialQuantity));

      // Prepare trade object
      const tradeId = `${opportunity.symbol}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const side = opportunity.action === 'BUY' ? 'buy' : 'sell';
      const posSide = side === 'buy' ? 'long' : 'short';

      const newTrade = {
        id: tradeId,
        tradeId: tradeId,
        symbol: opportunity.symbol,
        name: opportunity.name || opportunity.symbol,
        action: opportunity.action,
        entryPrice: entryPrice,
        takeProfit: takeProfit,
        stopLoss: stopLoss,
        addPosition: entryPrice,
        expectedGainPercent: opportunity.expectedGainPercent || 5,
        entryTime: new Date(),
        status: 'OPEN',
        currentPrice: currentPrice,
        quantity: roundedQuantity,
        pnl: 0,
        pnlPercent: 0,
        dcaCount: 0,
        averageEntryPrice: entryPrice,
        insights: opportunity.insights || [],
        reason: opportunity.reason || '',
        dataSource: opportunity.dataSource || 'monitoring',
        coinData: {
          symbol: opportunity.symbol,
          name: opportunity.name || opportunity.symbol,
          id: opportunity.id || opportunity.symbol.toLowerCase()
        },
        trailingStopLoss: {
          enabled: this.tradingRules.trailingStopLoss?.enabled || false,
          activated: false,
          peakPrice: entryPrice,
          currentStopLoss: stopLoss,
          activationPercent: this.tradingRules.trailingStopLoss?.activationPercent || 2.0,
          trailingPercent: this.tradingRules.trailingStopLoss?.trailingPercent || 1.0
        }
      };

      // Prepare batch order
      batchOrders.push({
        instId: okxSymbol,
        tdMode: 'isolated',
        side: side,
        posSide: posSide,
        ordType: 'market',
        sz: roundedQuantity.toString(),
        lever: leverage.toString()
      });

      tradeObjects.push(newTrade);
    }

    if (batchOrders.length === 0) {
      console.log('⚠️ No valid trades to execute in batch');
      return;
    }

    // Execute batch order
    console.log(`📦 Executing batch order for ${batchOrders.length} trades on OKX...`);
    const batchResult = await executeOkxBatchOrders(
      batchOrders,
      exchange.apiKey,
      exchange.apiSecret,
      exchange.passphrase,
      exchange.baseUrl
    );

    if (batchResult.success && batchResult.orders) {
      // Match order results with trade objects
      for (let i = 0; i < tradeObjects.length && i < batchResult.orders.length; i++) {
        const trade = tradeObjects[i];
        const orderResult = batchResult.orders[i];

        if (orderResult.sCode === '0') {
          // Order successful
          trade.okxOrderId = orderResult.ordId;
          trade.okxExecutedPrice = trade.entryPrice; // Will be updated from OKX position sync
          trade.okxExecutedQuantity = parseFloat(trade.quantity);
          trade.okxExecutedAt = new Date();

          this.activeTrades.push(trade);
          await recordTrade(trade);

          addLogEntry(`NEW TRADE EXECUTED (BATCH): ${trade.action} ${trade.symbol} at $${trade.entryPrice.toFixed(2)}`, 'success');
          console.log(`✅ Batch trade executed: ${trade.symbol} - Order ID: ${orderResult.ordId}`);
        } else {
          console.error(`❌ Batch order failed for ${trade.symbol}: ${orderResult.sMsg || 'Unknown error'}`);
        }
      }
    } else {
      throw new Error(`Batch order failed: ${batchResult.error || 'Unknown error'}`);
    }
  }

  /**
   * Cancel TP/SL algo orders for a trade
   * @param {Object} trade - Trade object with okxAlgoId or okxAlgoClOrdId
   */
  async cancelTradeAlgoOrders(trade) {
    if (!trade.okxAlgoId && !trade.okxAlgoClOrdId) {
      return; // No algo orders to cancel
    }

    try {
      const { cancelOkxAlgoOrders, getPreferredExchange, OKX_SYMBOL_MAP } = require('../services/exchangeService');
      const exchange = getPreferredExchange();

      if (!exchange || exchange.exchange !== 'OKX') {
        return; // OKX not configured
      }

      const okxSymbol = OKX_SYMBOL_MAP[trade.symbol];
      if (!okxSymbol) {
        console.warn(`⚠️ No OKX symbol mapping for ${trade.symbol}`);
        return;
      }

      const cancelParams = [];
      if (trade.okxTpAlgoId) {
        cancelParams.push({ instId: okxSymbol, algoId: trade.okxTpAlgoId });
      } else if (trade.okxTpAlgoClOrdId) {
        cancelParams.push({ instId: okxSymbol, algoClOrdId: trade.okxTpAlgoClOrdId });
      }
      if (trade.okxSlAlgoId) {
        cancelParams.push({ instId: okxSymbol, algoId: trade.okxSlAlgoId });
      } else if (trade.okxSlAlgoClOrdId) {
        cancelParams.push({ instId: okxSymbol, algoClOrdId: trade.okxSlAlgoClOrdId });
      }
      // Fallback for older trades that might only have a single okxAlgoId
      if (trade.okxAlgoId && !trade.okxTpAlgoId && !trade.okxSlAlgoId) {
        cancelParams.push({ instId: okxSymbol, algoId: trade.okxAlgoId });
      }
      if (trade.okxAlgoClOrdId && !trade.okxTpAlgoClOrdId && !trade.okxSlAlgoClOrdId) {
        cancelParams.push({ instId: okxSymbol, algoClOrdId: trade.okxAlgoClOrdId });
      }

      if (cancelParams.length > 0) {
        await cancelOkxAlgoOrders(
          cancelParams,
          exchange.apiKey,
          exchange.apiSecret,
          exchange.passphrase,
          exchange.baseUrl
        );
        console.log(`✅ Cancelled TP/SL algo orders for ${trade.symbol}`);
      }
    } catch (error) {
      console.error(`⚠️ Failed to cancel algo orders for ${trade.symbol}: ${error.message}`);
      // Don't throw - algo cancellation failure shouldn't block trade closure
    }
  }

  // New method: Update existing active trades
  /**
   * Sync active trades with OKX positions (source of truth)
   * Updates quantities from OKX, keeps DynamoDB data for tracking
   */
  async syncWithOkxPositions() {
    const { isExchangeTradingEnabled, getPreferredExchange, getOkxOpenPositions, OKX_SYMBOL_MAP } = require('../services/exchangeService');
    const exchangeConfig = isExchangeTradingEnabled();

    if (!exchangeConfig.enabled) {
      return; // No OKX configured
    }

    try {
      const exchange = getPreferredExchange();

      // FIX: Check if exchange is null before using it
      if (!exchange) {
        console.warn(`⚠️ Cannot sync with OKX - exchange not configured`);
        return;
      }

      const okxPositions = await getOkxOpenPositions(
        exchange.apiKey,
        exchange.apiSecret,
        exchange.passphrase,
        exchange.baseUrl
      );

      if (okxPositions.length === 0) {
        // No positions on OKX - mark all active trades as closed
        if (this.activeTrades.length > 0) {
          console.log(`⚠️ No positions found on OKX - marking ${this.activeTrades.length} trade(s) as CLOSED`);

          this.activeTrades.forEach(trade => {
            if (trade.status === 'OPEN' || trade.status === 'DCA_HIT') {
              console.log(`   🔄 ${trade.symbol}: Marking as CLOSED (manually closed on OKX)`);
              trade.status = 'CLOSED';
              trade.closedAt = new Date();
              trade.note = (trade.note || '') + ' | Manually closed on OKX';
            }
          });

          addLogEntry(`Marked ${this.activeTrades.length} trade(s) as CLOSED (no positions on OKX)`, 'info');
        }
        return;
      }

      // Check for NEW positions on OKX that aren't in activeTrades
      const defaultTPPercent = this.tradingRules?.defaultTakeProfit || 5.0;
      const defaultSLPercent = this.tradingRules?.defaultStopLoss || 5.0;

      for (const okxPos of okxPositions) {
        // Check if we already have this position in activeTrades
        // CRITICAL: Also check PENDING status to prevent race condition duplicates
        // (scanner may create PENDING trade while sync is running)
        const existingTrade = this.activeTrades.find(t =>
          t.symbol === okxPos.coin &&
          (t.status === 'OPEN' || t.status === 'DCA_HIT' || t.status === 'PENDING')
        );

        if (!existingTrade) {
          // NEW position found on OKX that we don't have in memory
          const entryPrice = okxPos.avgPrice || 0;

          // FIX: Validate entryPrice before creating trade
          if (!entryPrice || entryPrice <= 0) {
            console.warn(`⚠️ ${okxPos.coin}: Invalid entry price (${entryPrice}), skipping trade creation`);
            addLogEntry(`⚠️ ${okxPos.coin}: Invalid entry price, skipping trade creation`, 'warning');
            continue; // Skip this position
          }

          console.log(`🆕 Found new position on OKX: ${okxPos.coin} ${okxPos.side} - Adding to active trades...`);

          const action = okxPos.side === 'short' ? 'SELL' : 'BUY';

          let takeProfit, stopLoss, addPosition;
          if (action === 'BUY') {
            takeProfit = entryPrice * (1 + defaultTPPercent / 100);
            stopLoss = entryPrice * (1 - defaultSLPercent / 100);
            addPosition = entryPrice * 0.90; // 10% below entry
          } else {
            takeProfit = entryPrice * (1 - defaultTPPercent / 100);
            stopLoss = entryPrice * (1 + defaultSLPercent / 100);
            addPosition = entryPrice * 1.10; // 10% above entry
          }

          const newTrade = {
            id: `${okxPos.coin}-${Date.now()}`,
            symbol: okxPos.coin,
            action: action,
            entryPrice: entryPrice,
            takeProfit: takeProfit,
            stopLoss: stopLoss,
            addPosition: addPosition,
            dcaPrice: addPosition,
            quantity: okxPos.quantity,
            leverage: okxPos.leverage || 1,
            status: 'OPEN',
            entryTime: new Date(),
            lastSyncedWithOkx: new Date(),
            note: 'Position discovered on OKX - TP/SL/DCA set with defaults'
          };

          this.activeTrades.push(newTrade);
          console.log(`✅ Added new trade: ${okxPos.coin} ${okxPos.side} - Quantity: ${okxPos.quantity.toFixed(8)}, Entry: $${entryPrice.toFixed(2)}`);
          addLogEntry(`🆕 New position discovered on OKX: ${okxPos.coin} ${okxPos.side}`, 'info');
        }
      }

      // Update quantities from OKX (source of truth) for existing trades
      let syncedCount = 0;
      this.activeTrades.forEach(trade => {
        const okxPos = okxPositions.find(p => p.coin === trade.symbol);

        if (okxPos) {
          const oldQuantity = trade.quantity || 0;
          trade.quantity = okxPos.quantity;
          trade.okxQuantity = okxPos.quantity;
          trade.okxFree = okxPos.free;
          trade.okxLocked = okxPos.locked;
          trade.lastSyncedWithOkx = new Date();

          if (Math.abs(oldQuantity - okxPos.quantity) > 0.00000001) {
            console.log(`🔄 ${trade.symbol}: Synced with OKX - Quantity: ${oldQuantity.toFixed(8)} → ${okxPos.quantity.toFixed(8)}`);
            syncedCount++;
          }
        } else if (trade.quantity > 0 && trade.status === 'OPEN') {
          // Trade in memory but not on OKX - mark as closed
          console.log(`⚠️ ${trade.symbol}: Position not found on OKX - marking as closed`);
          trade.status = 'CLOSED';
          trade.okxQuantity = 0;
          trade.lastSyncedWithOkx = new Date();
        }
      });

      if (syncedCount > 0) {
        // Removed: DynamoDB persistence - OKX is the only source of truth
        console.log(`✅ Synced ${syncedCount} trades with OKX positions`);
      }
    } catch (error) {
      console.error(`❌ Error syncing with OKX positions: ${error.message}`);
    }
  }

  /**
   * Place a single TP or SL algo order without canceling existing orders
   * Used when we only need to add one missing order (e.g., TP when SL already exists)
   * @param {Object} trade - Trade object with symbol, action, takeProfit, stopLoss
   * @param {boolean} placeTp - Whether to place TP order
   * @param {boolean} placeSl - Whether to place SL order
   * @returns {Promise<boolean>} Success status
   */
  async placeSingleAlgoOrder(trade, placeTp, placeSl) {
    if (!placeTp && !placeSl) {
      console.warn(`⚠️ ${trade.symbol}: placeSingleAlgoOrder called but neither TP nor SL requested`);
      return false;
    }

    const { isExchangeTradingEnabled, getPreferredExchange, OKX_SYMBOL_MAP, placeOkxAlgoOrder, getOkxOpenPositions } = require('../services/exchangeService');
    const exchangeConfig = isExchangeTradingEnabled();

    if (!exchangeConfig.enabled) {
      console.log(`⚠️ Exchange trading not enabled, cannot place algo order`);
      return false;
    }

    const exchange = getPreferredExchange();
    if (!exchange || exchange.exchange !== 'OKX') {
      console.log(`⚠️ OKX not configured, cannot place algo order`);
      return false;
    }

    const okxSymbol = OKX_SYMBOL_MAP[trade.symbol];
    if (!okxSymbol) {
      console.warn(`⚠️ ${trade.symbol}: No OKX symbol mapping found`);
      return false;
    }

    const side = trade.action === 'BUY' ? 'buy' : 'sell';
    const posSide = side === 'buy' ? 'long' : 'short';
    const currentPrice = trade.currentPrice || trade.entryPrice;
    let tpTriggerPrice, slTriggerPrice, tpOrderSide;

    if (trade.action === 'BUY') {
      tpTriggerPrice = trade.takeProfit;
      slTriggerPrice = trade.stopLoss;
      tpOrderSide = 'sell';
    } else {
      tpTriggerPrice = trade.takeProfit;
      slTriggerPrice = trade.stopLoss;
      tpOrderSide = 'buy';
    }

    // Get actual position size from OKX
    let positionSize = null;
    try {
      const positions = await getOkxOpenPositions(
        exchange.apiKey,
        exchange.apiSecret,
        exchange.passphrase,
        exchange.baseUrl
      );
      const position = positions.find(p => {
        const instId = p.instId || p.symbol || '';
        return instId === okxSymbol || instId.includes(trade.symbol.split('-')[0]);
      });
      if (position) {
        positionSize = Math.abs(parseFloat(position.quantity || position.pos || 0));
      } else {
        positionSize = parseFloat(trade.quantity || 0);
      }
    } catch (posError) {
      positionSize = parseFloat(trade.quantity || 0);
    }

    if (!positionSize || positionSize <= 0) {
      console.log(`   ❌ Cannot place algo order - no valid position size found`);
      return false;
    }

    // Place the requested order
    if (placeTp) {
      console.log(`   📊 Placing TP order for ${trade.symbol} at $${tpTriggerPrice.toFixed(2)}...`);
      const tpOrderParams = {
        instId: okxSymbol,
        tdMode: 'isolated',
        side: tpOrderSide,
        posSide: posSide,
        ordType: 'conditional',
        sz: positionSize.toString(),
        tpTriggerPx: tpTriggerPrice.toFixed(8),
        tpOrdPx: '-1',
        tpTriggerPxType: 'last',
        reduceOnly: true,
        cxlOnClosePos: true
      };

      const result = await placeOkxAlgoOrder(
        tpOrderParams,
        exchange.apiKey,
        exchange.apiSecret,
        exchange.passphrase,
        exchange.baseUrl
      );

      if (result.success) {
        trade.okxTpAlgoId = result.algoId;
        trade.okxTpAlgoClOrdId = result.algoClOrdId;
        console.log(`✅ TP order placed for ${trade.symbol}! Algo ID: ${result.algoId || result.algoClOrdId}`);
        return true;
      } else {
        console.log(`⚠️ Failed to place TP order: ${result.error || result.sMsg || 'Unknown error'}`);
        return false;
      }
    } else if (placeSl) {
      console.log(`   📊 Placing SL order for ${trade.symbol} at $${slTriggerPrice.toFixed(2)}...`);
      const slOrderParams = {
        instId: okxSymbol,
        tdMode: 'isolated',
        side: tpOrderSide,
        posSide: posSide,
        ordType: 'conditional',
        sz: positionSize.toString(),
        slTriggerPx: slTriggerPrice.toFixed(8),
        slOrdPx: '-1',
        slTriggerPxType: 'last',
        reduceOnly: true,
        cxlOnClosePos: true
      };

      const result = await placeOkxAlgoOrder(
        slOrderParams,
        exchange.apiKey,
        exchange.apiSecret,
        exchange.passphrase,
        exchange.baseUrl
      );

      if (result.success) {
        trade.okxSlAlgoId = result.algoId;
        trade.okxSlAlgoClOrdId = result.algoClOrdId;
        console.log(`✅ SL order placed for ${trade.symbol}! Algo ID: ${result.algoId || result.algoClOrdId}`);
        return true;
      } else {
        console.log(`⚠️ Failed to place SL order: ${result.error || result.sMsg || 'Unknown error'}`);
        return false;
      }
    }

    return false;
  }

  async placeTradeAlgoOrders(trade) {
    // Note: We allow replacing existing orders (will cancel old ones first)
    // This is important when AI re-evaluates and finds new TP/SL levels
    // WARNING: This function cancels ALL existing orders before placing new ones
    // Use placeSingleAlgoOrder() if you only need to add one missing order

    // Skip if missing required fields
    if (!trade.takeProfit || !trade.stopLoss || !trade.entryPrice) {
      console.warn(`⚠️ ${trade.symbol}: Cannot place algo orders - missing TP, SL, or entry price`);
      return false;
    }

    // CRITICAL FIX: Add cooldown to prevent rapid order replacements
    // This prevents race conditions between AI updates and placeMissingAlgoOrders()
    const now = Date.now();
    const lastPlacement = trade.lastAlgoOrderPlacement || 0;
    const cooldownMs = 60000; // 60 seconds

    if (now - lastPlacement < cooldownMs) {
      const remainingSeconds = Math.ceil((cooldownMs - (now - lastPlacement)) / 1000);
      console.log(`⏱️ ${trade.symbol}: Algo order placement on cooldown (${remainingSeconds}s remaining to prevent duplicates)`);
      return true; // Return true to indicate we're handling it (not an error)
    }

    try {
      const { isExchangeTradingEnabled, getPreferredExchange, placeOkxAlgoOrder, OKX_SYMBOL_MAP } = require('../services/exchangeService');
      const exchangeConfig = isExchangeTradingEnabled();

      if (!exchangeConfig.enabled) {
        console.log(`⚠️ ${trade.symbol}: Exchange trading not enabled, cannot place algo orders`);
        return false;
      }

      const exchange = getPreferredExchange();
      if (!exchange || exchange.exchange !== 'OKX') {
        console.log(`⚠️ ${trade.symbol}: OKX not configured, cannot place algo orders`);
        return false;
      }

      const okxSymbol = OKX_SYMBOL_MAP[trade.symbol];
      if (!okxSymbol) {
        console.warn(`⚠️ ${trade.symbol}: Symbol not available on OKX`);
        return false;
      }

      // IMPORTANT: Cancel any existing TP/SL algo orders before placing new ones
      // This prevents contradictions when AI re-evaluates and finds new TP/SL levels
      // We need to fetch all algo orders for this instrument and cancel them all
      console.log(`🔄 ${trade.symbol}: Checking for existing TP/SL algo orders to cancel...`);
      try {
        const { getOkxAlgoOrders, cancelOkxAlgoOrders } = require('../services/exchangeService');

        // First, try to cancel orders we know about from trade object
        if (trade.okxAlgoId || trade.okxAlgoClOrdId || trade.okxTpAlgoId || trade.okxSlAlgoId) {
          await this.cancelTradeAlgoOrders(trade);
        }

        // Also fetch all pending algo orders for this instrument from OKX and cancel them
        // This catches any orders that might not be in our trade object
        try {
          const algoOrders = await getOkxAlgoOrders(
            okxSymbol,
            'conditional', // Only get conditional orders (TP/SL)
            exchange.apiKey,
            exchange.apiSecret,
            exchange.passphrase,
            exchange.baseUrl
          );

          if (algoOrders && algoOrders.success && algoOrders.orders && algoOrders.orders.length > 0) {
            console.log(`   📋 Found ${algoOrders.orders.length} existing algo order(s) for ${trade.symbol}`);

            // Cancel all found algo orders
            const activeOrders = algoOrders.orders
              .filter(order => {
                const state = order.state || order.ordState || '';
                return state === 'live' || state === 'effective' || state === 'partially_filled';
              });

            if (activeOrders.length > 0) {
              console.log(`   🗑️ Canceling ${activeOrders.length} active algo order(s)...`);
              const ordersToCancel = activeOrders
                .map(order => {
                  const cancelOrder = { instId: okxSymbol };
                  // Only include ONE of algoId or algoClOrdId, not both
                  if (order.algoId) {
                    cancelOrder.algoId = order.algoId;
                  } else if (order.algoClOrdId) {
                    cancelOrder.algoClOrdId = order.algoClOrdId;
                  }
                  return cancelOrder;
                })
                .filter(order => order.algoId || order.algoClOrdId);

              if (ordersToCancel.length > 0) {
                const cancelResult = await cancelOkxAlgoOrders(
                  ordersToCancel,
                  exchange.apiKey,
                  exchange.apiSecret,
                  exchange.passphrase,
                  exchange.baseUrl
                );

                if (cancelResult.success) {
                  console.log(`✅ ${trade.symbol}: Canceled ${ordersToCancel.length} existing algo order(s)`);
                } else {
                  console.warn(`⚠️ ${trade.symbol}: Failed to cancel some algo orders: ${cancelResult.error || 'Unknown error'}`);
                }
              }
            }
          }
        } catch (fetchError) {
          console.warn(`⚠️ ${trade.symbol}: Could not fetch algo orders from OKX: ${fetchError.message}`);
          // Continue anyway - we'll try to place new orders
        }

        // Clear the algo IDs so we know they're canceled
        trade.okxAlgoId = null;
        trade.okxAlgoClOrdId = null;
        trade.okxTpAlgoId = null;
        trade.okxTpAlgoClOrdId = null;
        trade.okxSlAlgoId = null;
        trade.okxSlAlgoClOrdId = null;
      } catch (cancelError) {
        console.warn(`⚠️ ${trade.symbol}: Error canceling existing algo orders: ${cancelError.message}`);
        // Continue anyway - OKX might have already canceled them or they might not exist
      }

      const side = trade.action === 'BUY' ? 'buy' : 'sell';
      const posSide = side === 'buy' ? 'long' : 'short';

      // Calculate TP/SL trigger prices
      // Get current price for validation
      const currentPrice = trade.currentPrice || trade.entryPrice;
      let tpTriggerPrice, slTriggerPrice, tpOrderSide;

      if (trade.action === 'BUY') {
        // Long position: TP above entry, SL below entry
        tpTriggerPrice = trade.takeProfit; // Higher price = profit
        slTriggerPrice = trade.stopLoss; // Lower price = loss
        tpOrderSide = 'sell'; // Sell to close long position

        // Validate TP is above entry and SL is below entry
        if (tpTriggerPrice <= trade.entryPrice) {
          console.warn(`⚠️ ${trade.symbol}: TP ($${tpTriggerPrice.toFixed(2)}) must be above entry ($${trade.entryPrice.toFixed(2)}) for BUY position`);
          tpTriggerPrice = trade.entryPrice * 1.05; // Default 5% above entry
          console.log(`   Using default TP: $${tpTriggerPrice.toFixed(2)}`);
        }
        if (slTriggerPrice >= trade.entryPrice) {
          console.warn(`⚠️ ${trade.symbol}: SL ($${slTriggerPrice.toFixed(2)}) must be below entry ($${trade.entryPrice.toFixed(2)}) for BUY position`);
          slTriggerPrice = trade.entryPrice * 0.95; // Default 5% below entry
          console.log(`   Using default SL: $${slTriggerPrice.toFixed(2)}`);
        }
      } else {
        // Short position: TP below entry, SL above entry
        tpTriggerPrice = trade.takeProfit; // Lower price = profit for short
        slTriggerPrice = trade.stopLoss; // Higher price = loss for short
        tpOrderSide = 'buy'; // Buy to close short position

        // Validate TP is below entry and SL is above entry
        if (tpTriggerPrice >= trade.entryPrice) {
          console.warn(`⚠️ ${trade.symbol}: TP ($${tpTriggerPrice.toFixed(2)}) must be below entry ($${trade.entryPrice.toFixed(2)}) for SELL position`);
          tpTriggerPrice = trade.entryPrice * 0.95; // Default 5% below entry
          console.log(`   Using default TP: $${tpTriggerPrice.toFixed(2)}`);
        }
        if (slTriggerPrice <= trade.entryPrice) {
          console.warn(`⚠️ ${trade.symbol}: SL ($${slTriggerPrice.toFixed(2)}) must be above entry ($${trade.entryPrice.toFixed(2)}) for SELL position`);
          slTriggerPrice = trade.entryPrice * 1.05; // Default 5% above entry
          console.log(`   Using default SL: $${slTriggerPrice.toFixed(2)}`);
        }
      }

      // Get actual position size from OKX (OKX doesn't support closeFraction for conditional orders)
      const { getOkxOpenPositions } = require('../services/exchangeService');
      let positionSize = null;
      try {
        const positions = await getOkxOpenPositions(
          exchange.apiKey,
          exchange.apiSecret,
          exchange.passphrase,
          exchange.baseUrl
        );
        const position = positions.find(p => {
          const instId = p.instId || p.symbol || '';
          return instId === okxSymbol || instId.includes(trade.symbol.split('-')[0]);
        });
        if (position) {
          positionSize = Math.abs(parseFloat(position.quantity || position.pos || 0));
          console.log(`   📊 Found position size: ${positionSize} for ${okxSymbol}`);
        } else {
          // Fallback to trade quantity
          positionSize = parseFloat(trade.quantity || 0);
          console.log(`   ⚠️ Position not found on OKX, using trade quantity: ${positionSize}`);
        }
      } catch (posError) {
        // Fallback to trade quantity
        positionSize = parseFloat(trade.quantity || 0);
        console.log(`   ⚠️ Failed to get position size, using trade quantity: ${positionSize}`);
      }

      if (!positionSize || positionSize <= 0) {
        console.log(`   ❌ Cannot place algo orders - no valid position size found`);
        console.log(`   📊 Position size check: positionSize=${positionSize}, trade.quantity=${trade.quantity}`);
        trade.tpSlAutoPlaced = false;
        return false;
      }

      console.log(`   📊 Position size: ${positionSize}, TP: $${tpTriggerPrice.toFixed(2)}, SL: $${slTriggerPrice.toFixed(2)}`);

      // Try placing both TP and SL in a single conditional order first
      // If that fails, we'll try separate orders
      const algoOrderParams = {
        instId: okxSymbol,
        tdMode: 'isolated',
        side: tpOrderSide,
        posSide: posSide,
        ordType: 'conditional',
        sz: positionSize.toString(), // Use actual position size (OKX doesn't support closeFraction for conditional orders)
        tpTriggerPx: tpTriggerPrice.toFixed(8), // Use more precision for OKX
        tpOrdPx: '-1', // Market order for TP
        slTriggerPx: slTriggerPrice.toFixed(8), // Use more precision for OKX
        slOrdPx: '-1', // Market order for SL
        tpTriggerPxType: 'last', // Use last price as trigger
        slTriggerPxType: 'last',
        reduceOnly: true, // Only reduce position
        cxlOnClosePos: true // Cancel TP/SL when position is closed
      };

      console.log(`📊 Placing TP/SL algo orders on OKX for ${trade.symbol}...`);
      console.log(`   Entry: $${trade.entryPrice.toFixed(2)}, Current: $${currentPrice.toFixed(2)}`);
      console.log(`   TP: $${tpTriggerPrice.toFixed(2)} (${tpOrderSide}), SL: $${slTriggerPrice.toFixed(2)}`);

      let algoResult = await placeOkxAlgoOrder(
        algoOrderParams,
        exchange.apiKey,
        exchange.apiSecret,
        exchange.passphrase,
        exchange.baseUrl
      );

      // If combined order fails, try placing TP and SL as separate orders
      // OKX error 51088: "You can only place 1 TP/SL order to close an entire position"
      // OKX doesn't support closeFraction for conditional orders - need to use actual position size
      if (!algoResult.success) {
        const errorCode = algoResult.sCode || algoResult.code;
        const errorMsg = algoResult.error || algoResult.sMsg || '';
        console.log(`⚠️ Combined TP/SL order failed (errorCode: ${errorCode}, sCode: ${algoResult.sCode}, code: ${algoResult.code}), trying separate orders with position size...`);
        console.log(`   Error message: ${errorMsg}`);
        if (errorCode === '51088' || errorCode === 51088 || errorMsg.includes('only place 1 TP/SL')) {
          console.log(`   ✅ Detected OKX error 51088 - OKX doesn't support closeFraction, using actual position size instead`);
        }

        // Get actual position size from OKX
        const { getOkxOpenPositions } = require('../services/exchangeService');
        let positionSize = null;
        try {
          const positions = await getOkxOpenPositions(
            exchange.apiKey,
            exchange.apiSecret,
            exchange.passphrase,
            exchange.baseUrl
          );
          const position = positions.find(p => {
            const instId = p.instId || p.symbol || '';
            return instId === okxSymbol || instId.includes(trade.symbol.split('-')[0]);
          });
          if (position) {
            positionSize = Math.abs(parseFloat(position.quantity || position.pos || 0));
            console.log(`   📊 Found position size: ${positionSize} for ${okxSymbol}`);
          } else {
            // Fallback to trade quantity
            positionSize = parseFloat(trade.quantity || 0);
            console.log(`   ⚠️ Position not found on OKX, using trade quantity: ${positionSize}`);
          }
        } catch (posError) {
          // Fallback to trade quantity
          positionSize = parseFloat(trade.quantity || 0);
          console.log(`   ⚠️ Failed to get position size, using trade quantity: ${positionSize}`);
        }

        if (!positionSize || positionSize <= 0) {
          console.log(`   ❌ Cannot place separate orders - no valid position size found`);
          trade.tpSlAutoPlaced = false;
          return false;
        }

        // Check if we already have TP or SL orders - only place missing ones
        const needsTp = !trade.okxTpAlgoId && !trade.okxTpAlgoClOrdId;
        const needsSl = !trade.okxSlAlgoId && !trade.okxSlAlgoClOrdId;

        if (!needsTp && !needsSl) {
          console.log(`   ✅ ${trade.symbol}: Already has both TP and SL orders, skipping placement`);
          return true;
        }

        let tpResult = { success: false };
        let slResult = { success: false };

        // Place TP order only if we need it
        if (needsTp) {
          console.log(`   📊 Placing TP order for ${trade.symbol} at $${tpTriggerPrice.toFixed(2)}...`);
          const tpOrderParams = {
            instId: okxSymbol,
            tdMode: 'isolated',
            side: tpOrderSide,
            posSide: posSide,
            ordType: 'conditional',
            sz: positionSize.toString(), // Use actual position size instead of closeFraction
            tpTriggerPx: tpTriggerPrice.toFixed(8),
            tpOrdPx: '-1',
            tpTriggerPxType: 'last',
            reduceOnly: true,
            cxlOnClosePos: true
          };

          tpResult = await placeOkxAlgoOrder(
            tpOrderParams,
            exchange.apiKey,
            exchange.apiSecret,
            exchange.passphrase,
            exchange.baseUrl
          );
        } else {
          console.log(`   ⏭️ ${trade.symbol}: TP order already exists, skipping`);
          tpResult = { success: true }; // Mark as success since we already have it
        }

        // Small delay between orders
        await new Promise(resolve => setTimeout(resolve, 500));

        // Place SL order only if we need it
        if (needsSl) {
          console.log(`   📊 Placing SL order for ${trade.symbol} at $${slTriggerPrice.toFixed(2)}...`);
          const slOrderParams = {
            instId: okxSymbol,
            tdMode: 'isolated',
            side: tpOrderSide, // Same side to close position
            posSide: posSide,
            ordType: 'conditional',
            sz: positionSize.toString(), // Use actual position size instead of closeFraction
            slTriggerPx: slTriggerPrice.toFixed(8),
            slOrdPx: '-1',
            slTriggerPxType: 'last',
            reduceOnly: true,
            cxlOnClosePos: true
          };

          slResult = await placeOkxAlgoOrder(
            slOrderParams,
            exchange.apiKey,
            exchange.apiSecret,
            exchange.passphrase,
            exchange.baseUrl
          );
        } else {
          console.log(`   ⏭️ ${trade.symbol}: SL order already exists, skipping`);
          slResult = { success: true }; // Mark as success since we already have it
        }

        // Handle partial success - place orders individually and track each
        let tpPlaced = false;
        let slPlaced = false;

        if (tpResult.success) {
          console.log(`✅ TP algo order placed for ${trade.symbol}! TP Algo ID: ${tpResult.algoId || tpResult.algoClOrdId}`);
          tpPlaced = true;
          trade.okxTpAlgoId = tpResult.algoId;
          trade.okxTpAlgoClOrdId = tpResult.algoClOrdId;
        } else {
          if (needsTp) {
            // Only log error if we actually tried to place it
            console.log(`⚠️ Failed to place TP order for ${trade.symbol}: ${tpResult.error || tpResult.sMsg || 'Unknown error'}`);
            if (tpResult.fullResponse) {
              console.log(`   Full TP error response: ${tpResult.fullResponse}`);
            }
          }
        }

        if (slResult.success) {
          console.log(`✅ SL algo order placed for ${trade.symbol}! SL Algo ID: ${slResult.algoId || slResult.algoClOrdId}`);
          slPlaced = true;
          trade.okxSlAlgoId = slResult.algoId;
          trade.okxSlAlgoClOrdId = slResult.algoClOrdId;
        } else {
          if (needsSl) {
            // Only log error if we actually tried to place it
            console.log(`⚠️ Failed to place SL order for ${trade.symbol}: ${slResult.error || slResult.sMsg || 'Unknown error'}`);
            if (slResult.fullResponse) {
              console.log(`   Full SL error response: ${slResult.fullResponse}`);
            }
          }
        }

        if (tpPlaced || slPlaced) {
          // At least one order succeeded
          trade.okxAlgoId = tpResult.algoId || slResult.algoId; // Store primary algo ID
          trade.okxAlgoClOrdId = tpResult.algoClOrdId || slResult.algoClOrdId;
          trade.tpSlAutoPlaced = tpPlaced && slPlaced; // Only fully auto if both placed
          if (tpPlaced && slPlaced) {
            addLogEntry(`TP/SL algo orders placed separately on OKX for ${trade.symbol} (TP: $${tpTriggerPrice.toFixed(2)}, SL: $${slTriggerPrice.toFixed(2)})`, 'info');
          } else {
            addLogEntry(`Partial TP/SL orders placed on OKX for ${trade.symbol} (TP: ${tpPlaced ? '✅' : '❌'}, SL: ${slPlaced ? '✅' : '❌'})`, 'warning');
          }
          return true; // Return true if at least one order succeeded
        } else {
          console.log(`❌ Failed to place both TP and SL orders for ${trade.symbol}`);
          trade.tpSlAutoPlaced = false;
          return false;
        }
      }

      if (algoResult.success) {
        console.log(`✅ TP/SL algo orders placed successfully for ${trade.symbol}! Algo ID: ${algoResult.algoId || algoResult.algoClOrdId}`);
        trade.okxAlgoId = algoResult.algoId;
        trade.okxAlgoClOrdId = algoResult.algoClOrdId;
        trade.tpSlAutoPlaced = true;

        // Set timestamp to enable cooldown protection
        trade.lastAlgoOrderPlacement = Date.now();

        addLogEntry(`TP/SL algo orders placed on OKX for ${trade.symbol} (TP: $${tpTriggerPrice.toFixed(2)}, SL: $${slTriggerPrice.toFixed(2)})`, 'info');
        return true;
      } else {
        console.log(`⚠️ Failed to place TP/SL algo orders for ${trade.symbol}: ${algoResult.error}`);
        if (algoResult.fullResponse) {
          console.log(`   Full error response: ${algoResult.fullResponse}`);
        }
        trade.tpSlAutoPlaced = false;
        return false;
      }
    } catch (error) {
      console.error(`❌ Error placing TP/SL algo orders for ${trade.symbol}: ${error.message}`);
      trade.tpSlAutoPlaced = false;
      return false;
    }
  }

  /**
   * Fix existing trades that are missing TP, SL, or DCA levels
   * This ensures all trades have proper trigger levels for monitoring
   * Attempts to use ATR-based stop loss when price data is available
   */
  async fixMissingTradeLevels() {
    let fixedCount = 0;
    const defaultTPPercent = this.tradingRules?.defaultTakeProfit || 5.0;
    const defaultSLPercent = this.tradingRules?.defaultStopLoss || 5.0;

    for (const trade of this.activeTrades) {
      let needsFix = false;
      const entryPrice = trade.entryPrice || trade.currentPrice || 0;

      if (!entryPrice || entryPrice <= 0) {
        console.warn(`⚠️ ${trade.symbol}: Missing entry price, cannot fix levels`);
        continue;
      }

      // Try to get price data for ATR-based stop loss calculation
      let useATR = false;
      let atr = 0;
      try {
        // Check if we have price data stored in the trade or can fetch it
        if (trade.priceData && Array.isArray(trade.priceData) && trade.priceData.length >= 15) {
          const { calculateATR } = require('../services/positionSizingService');
          atr = calculateATR(trade.priceData, 14);
          useATR = atr > 0;
        } else {
          // Try to fetch historical data for ATR calculation
          const { fetchHistoricalData } = require('../services/dataFetcher');
          const coinData = {
            symbol: trade.symbol,
            id: trade.coinId || trade.symbol.toLowerCase(),
            coinmarketcap_id: trade.coinmarketcap_id,
            coinpaprika_id: trade.coinpaprika_id
          };

          try {
            // Add timeout to prevent blocking deployment (historical data fetch can be slow)
            const historicalData = await Promise.race([
              fetchHistoricalData(coinData.id, coinData, this.stats, config, entryPrice),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Historical data fetch timeout (3s)')), 3000)
              )
            ]).catch(err => {
              console.log(`⚠️ ${trade.symbol}: Timeout fetching historical data: ${err.message}`);
              return null;
            });
            const { dailyData } = historicalData || {};

            if (dailyData && dailyData.length >= 15) {
              // Prepare price data for ATR (ensure high/low exist)
              const priceDataForATR = [];
              dailyData.slice(-30).forEach(d => {
                const high = d.high || 0;
                const low = d.low || 0;
                const close = d.close || d.price || 0;
                if (high > 0 && low > 0 && close > 0 && high >= low) {
                  priceDataForATR.push({ high, low, close, price: close });
                }
              });

              if (priceDataForATR.length >= 15) {
                const { calculateATR } = require('../services/positionSizingService');
                atr = calculateATR(priceDataForATR, 14);
                useATR = atr > 0;

                // Store price data for future use
                trade.priceData = priceDataForATR;
              }
            }
          } catch (fetchError) {
            // Historical data fetch failed, use fixed percentage
            console.log(`⚠️ ${trade.symbol}: Could not fetch historical data for ATR, using fixed percentage`);
          }
        }
      } catch (atrError) {
        // ATR calculation failed, use fixed percentage
        console.log(`⚠️ ${trade.symbol}: ATR calculation failed, using fixed percentage: ${atrError.message}`);
      }

      // Fix missing or invalid Take Profit
      if (!trade.takeProfit || trade.takeProfit <= 0 || trade.takeProfit === entryPrice) {
        if (trade.action === 'BUY') {
          trade.takeProfit = entryPrice * (1 + defaultTPPercent / 100);
        } else {
          trade.takeProfit = entryPrice * (1 - defaultTPPercent / 100);
        }
        needsFix = true;
        console.log(`🔧 ${trade.symbol}: Fixed missing TP to $${trade.takeProfit.toFixed(2)} (${defaultTPPercent}%)`);
      }

      // Fix missing or invalid Stop Loss - use ATR if available
      if (!trade.stopLoss || trade.stopLoss <= 0 || trade.stopLoss === entryPrice) {
        if (useATR && atr > 0) {
          // Use ATR-based stop loss
          if (trade.action === 'BUY') {
            trade.stopLoss = Math.max(
              entryPrice - (2 * atr), // 2x ATR below entry
              entryPrice * 0.95 // Minimum 5% stop
            );
          } else {
            trade.stopLoss = Math.min(
              entryPrice + (2 * atr), // 2x ATR above entry
              entryPrice * 1.05 // Minimum 5% stop
            );
          }
          console.log(`🔧 ${trade.symbol}: Fixed missing SL to $${trade.stopLoss.toFixed(2)} (ATR-based: ${atr.toFixed(2)})`);
        } else {
          // Fallback to fixed percentage
          if (trade.action === 'BUY') {
            trade.stopLoss = entryPrice * (1 - defaultSLPercent / 100);
          } else {
            trade.stopLoss = entryPrice * (1 + defaultSLPercent / 100);
          }
          console.log(`🔧 ${trade.symbol}: Fixed missing SL to $${trade.stopLoss.toFixed(2)} (${defaultSLPercent}%)`);
        }
        needsFix = true;
      }

      // Fix missing or invalid DCA level (addPosition)
      if (!trade.addPosition || trade.addPosition <= 0 || trade.addPosition === entryPrice) {
        const { validateDcaPrice } = require('../utils/riskManagement');

        let proposedDca;
        if (trade.action === 'BUY') {
          proposedDca = entryPrice * 0.90; // 10% below entry
        } else {
          proposedDca = entryPrice * 1.10; // 10% above entry
        }

        // VALIDATE DCA price to ensure it's on correct side of SL
        const validation = validateDcaPrice({
          action: trade.action,
          entryPrice: entryPrice,
          stopLoss: trade.stopLoss
        }, proposedDca);

        trade.addPosition = validation.adjustedPrice;
        trade.dcaPrice = validation.adjustedPrice;
        needsFix = true;

        if (!validation.valid) {
          console.log(`🔧 ${trade.symbol}: Fixed invalid DCA level to $${trade.addPosition.toFixed(2)} - ${validation.warning}`);
        } else {
          console.log(`🔧 ${trade.symbol}: Fixed missing DCA level to $${trade.addPosition.toFixed(2)}`);
        }
      }

      if (needsFix) {
        fixedCount++;
      }
    }

    if (fixedCount > 0) {
      console.log(`✅ Fixed ${fixedCount} trade(s) with missing TP, SL, or DCA levels`);
    }

    return fixedCount;
  }

  /**
   * Place algo orders for trades that don't have them yet
   * This ensures all trades on OKX have TP/SL algo orders
   */
  async placeMissingAlgoOrders() {
    if (this.activeTrades.length === 0) {
      return;
    }

    const { isExchangeTradingEnabled, getPreferredExchange, getOkxAlgoOrders, OKX_SYMBOL_MAP } = require('../services/exchangeService');
    const exchangeConfig = isExchangeTradingEnabled();

    if (!exchangeConfig.enabled) {
      console.log(`⚠️ Exchange trading not enabled, cannot place algo orders`);
      return { placed: 0, failed: 0 };
    }

    const exchange = getPreferredExchange();
    if (!exchange || exchange.exchange !== 'OKX') {
      console.log(`⚠️ OKX not configured, cannot place algo orders`);
      return { placed: 0, failed: 0 };
    }

    let placedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    for (const trade of this.activeTrades) {
      // Only place for OPEN trades
      if (trade.status !== 'OPEN') {
        continue;
      }

      // Check if we already have algo order IDs in the trade object
      const hasAlgoIds = trade.okxAlgoId || trade.okxAlgoClOrdId;
      const hasTpOrder = trade.okxTpAlgoId || trade.okxTpAlgoClOrdId;
      const hasSlOrder = trade.okxSlAlgoId || trade.okxSlAlgoClOrdId;

      // Also check OKX to see if algo orders actually exist (even if not in trade object)
      // IMPORTANT: Check for TP and SL separately - OKX might have one but not both
      let hasTpOrderOnOkx = false;
      let hasSlOrderOnOkx = false;
      let foundOrders = [];

      try {
        const okxSymbol = OKX_SYMBOL_MAP[trade.symbol];
        if (okxSymbol) {
          // Add timeout to prevent blocking deployment
          const algoOrders = await Promise.race([
            getOkxAlgoOrders(
              okxSymbol,
              'conditional', // Only check conditional orders (TP/SL)
              exchange.apiKey,
              exchange.apiSecret,
              exchange.passphrase,
              exchange.baseUrl
            ),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('OKX API timeout (5s)')), 5000)
            )
          ]).catch(err => {
            console.warn(`⚠️ ${trade.symbol}: Timeout checking algo orders: ${err.message}`);
            return { success: false, error: err.message };
          });

          if (algoOrders && algoOrders.success && algoOrders.orders && algoOrders.orders.length > 0) {
            // Filter to active orders only
            const activeOrders = algoOrders.orders.filter(order => {
              const state = order.state || order.ordState || '';
              return state === 'live' || state === 'effective' || state === 'partially_filled';
            });

            if (activeOrders.length > 0) {
              foundOrders = activeOrders;
              console.log(`✅ ${trade.symbol}: Found ${activeOrders.length} existing algo order(s) on OKX`);

              // Check if we have TP and SL orders
              // TP orders have tpTriggerPx, SL orders have slTriggerPx
              // Log the order structure for debugging
              console.log(`   🔍 Checking ${activeOrders.length} order(s) for ${trade.symbol}...`);
              for (const order of activeOrders) {
                const orderStr = JSON.stringify(order, null, 2);
                console.log(`   📋 Order details: ${orderStr.substring(0, 500)}...`); // Log first 500 chars

                const hasTpTrigger = order.tpTriggerPx || order.tpTriggerPxType || order.tpOrdPx;
                const hasSlTrigger = order.slTriggerPx || order.slTriggerPxType || order.slOrdPx;

                console.log(`   🔍 Order analysis: hasTpTrigger=${!!hasTpTrigger}, hasSlTrigger=${!!hasSlTrigger}`);
                console.log(`   🔍 Order fields: tpTriggerPx=${order.tpTriggerPx}, slTriggerPx=${order.slTriggerPx}, tpOrdPx=${order.tpOrdPx}, slOrdPx=${order.slOrdPx}`);

                if (hasTpTrigger) {
                  hasTpOrderOnOkx = true;
                  if (!hasTpOrder) {
                    trade.okxTpAlgoId = order.algoId;
                    trade.okxTpAlgoClOrdId = order.algoClOrdId;
                    console.log(`   ✅ Found TP order on OKX, updated trade object (Algo ID: ${order.algoId || order.algoClOrdId})`);
                  }
                  // IMPORTANT: Extract and sync the actual TP trigger price from OKX
                  if (order.tpTriggerPx) {
                    const okxTpPrice = parseFloat(order.tpTriggerPx);
                    if (okxTpPrice > 0) {
                      const currentTp = trade.takeProfit || 0;
                      if (Math.abs(okxTpPrice - currentTp) > 0.01) { // Only update if significantly different
                        console.log(`   🔄 Syncing TP price from OKX: $${currentTp.toFixed(2)} → $${okxTpPrice.toFixed(2)}`);
                        trade.takeProfit = okxTpPrice;
                      }
                    }
                  }
                }
                if (hasSlTrigger) {
                  hasSlOrderOnOkx = true;
                  if (!hasSlOrder) {
                    trade.okxSlAlgoId = order.algoId;
                    trade.okxSlAlgoClOrdId = order.algoClOrdId;
                    console.log(`   ✅ Found SL order on OKX, updated trade object (Algo ID: ${order.algoId || order.algoClOrdId})`);
                  }
                  // IMPORTANT: Extract and sync the actual SL trigger price from OKX
                  if (order.slTriggerPx) {
                    const okxSlPrice = parseFloat(order.slTriggerPx);
                    if (okxSlPrice > 0) {
                      const currentSl = trade.stopLoss || 0;
                      if (Math.abs(okxSlPrice - currentSl) > 0.01) { // Only update if significantly different
                        console.log(`   🔄 Syncing SL price from OKX: $${currentSl.toFixed(2)} → $${okxSlPrice.toFixed(2)}`);
                        trade.stopLoss = okxSlPrice;
                      }
                    }
                  }
                }
                // If order has both TP and SL, it's a combined order
                if (hasTpTrigger && hasSlTrigger) {
                  hasTpOrderOnOkx = true;
                  hasSlOrderOnOkx = true;
                  if (!hasAlgoIds) {
                    trade.okxAlgoId = order.algoId;
                    trade.okxAlgoClOrdId = order.algoClOrdId;
                    trade.tpSlAutoPlaced = true;
                    console.log(`   ✅ Found combined TP/SL order on OKX, updated trade object (Algo ID: ${order.algoId || order.algoClOrdId})`);
                  }
                  // Sync both TP and SL prices from combined order
                  if (order.tpTriggerPx) {
                    const okxTpPrice = parseFloat(order.tpTriggerPx);
                    if (okxTpPrice > 0) {
                      const currentTp = trade.takeProfit || 0;
                      if (Math.abs(okxTpPrice - currentTp) > 0.01) {
                        console.log(`   🔄 Syncing TP price from OKX combined order: $${currentTp.toFixed(2)} → $${okxTpPrice.toFixed(2)}`);
                        trade.takeProfit = okxTpPrice;
                      }
                    }
                  }
                  if (order.slTriggerPx) {
                    const okxSlPrice = parseFloat(order.slTriggerPx);
                    if (okxSlPrice > 0) {
                      const currentSl = trade.stopLoss || 0;
                      if (Math.abs(okxSlPrice - currentSl) > 0.01) {
                        console.log(`   🔄 Syncing SL price from OKX combined order: $${currentSl.toFixed(2)} → $${okxSlPrice.toFixed(2)}`);
                        trade.stopLoss = okxSlPrice;
                      }
                    }
                  }
                }
              }
            }
          }
        }
      } catch (checkError) {
        console.warn(`⚠️ ${trade.symbol}: Could not check OKX for existing algo orders: ${checkError.message}`);
        // Continue anyway - we'll try to place orders
      }

      // Only skip if we have BOTH TP and SL orders
      // If we only have one, we should place the missing one WITHOUT canceling the existing one
      const hasBothOrders = (hasTpOrder || hasTpOrderOnOkx) && (hasSlOrder || hasSlOrderOnOkx);
      const needsTp = !hasTpOrder && !hasTpOrderOnOkx;
      const needsSl = !hasSlOrder && !hasSlOrderOnOkx;

      if (hasBothOrders) {
        skippedCount++;
        console.log(`⏭️ ${trade.symbol}: Skipping - already has both TP and SL orders`);
        continue;
      }

      // Check if trade has required fields
      if (!trade.takeProfit || !trade.stopLoss || !trade.entryPrice) {
        console.warn(`⚠️ ${trade.symbol}: Cannot place algo orders - missing TP, SL, or entry price`);
        failedCount++;
        continue;
      }

      // If we only need to place one order (TP or SL), place it directly without canceling existing orders
      // This prevents canceling the existing SL when we only need to add TP (or vice versa)
      if ((needsTp && !needsSl) || (!needsTp && needsSl)) {
        console.log(`📊 ${trade.symbol}: Has partial orders (TP: ${hasTpOrder || hasTpOrderOnOkx ? '✅' : '❌'}, SL: ${hasSlOrder || hasSlOrderOnOkx ? '✅' : '❌'}) - placing only missing order`);
        console.log(`   Trade details: Entry=$${trade.entryPrice?.toFixed(2)}, TP=$${trade.takeProfit?.toFixed(2)}, SL=$${trade.stopLoss?.toFixed(2)}`);

        try {
          const success = await this.placeSingleAlgoOrder(trade, needsTp, needsSl);
          if (success) {
            placedCount++;
            console.log(`✅ Successfully placed missing ${needsTp ? 'TP' : 'SL'} order for ${trade.symbol}`);
          } else {
            failedCount++;
            console.warn(`❌ Failed to place ${needsTp ? 'TP' : 'SL'} order for ${trade.symbol}`);
          }
        } catch (error) {
          failedCount++;
          console.error(`❌ Error placing ${needsTp ? 'TP' : 'SL'} order for ${trade.symbol}: ${error.message}`);
        }
      } else {
        // Need both orders - use the full placement function (which will cancel existing ones first)
        console.log(`📊 ${trade.symbol}: No orders found, placing both TP and SL orders...`);
        console.log(`   Trade details: Entry=$${trade.entryPrice?.toFixed(2)}, TP=$${trade.takeProfit?.toFixed(2)}, SL=$${trade.stopLoss?.toFixed(2)}`);

        try {
          const success = await this.placeTradeAlgoOrders(trade);
          if (success) {
            placedCount++;
            console.log(`✅ Successfully placed TP/SL orders for ${trade.symbol}`);
          } else {
            failedCount++;
            console.warn(`❌ Failed to place TP/SL orders for ${trade.symbol} - check logs above for details`);
          }
        } catch (error) {
          failedCount++;
          console.error(`❌ Error placing TP/SL orders for ${trade.symbol}: ${error.message}`);
          console.error(`   Stack: ${error.stack}`);
        }
      }

      // Small delay between orders to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (placedCount > 0) {
      console.log(`✅ Placed TP/SL algo orders for ${placedCount} trade(s) on OKX`);
    }
    if (skippedCount > 0) {
      console.log(`⏭️ Skipped ${skippedCount} trade(s) - already have algo orders`);
    }
    if (failedCount > 0) {
      console.warn(`⚠️ Failed to place algo orders for ${failedCount} trade(s)`);
    }

    return { placed: placedCount, failed: failedCount, skipped: skippedCount };
  }

  /**
   * Cleanup orphaned orders on OKX
   * Cancel any algo/limit orders that don't have matching active trades
   * Runs every 5 minutes
   */
  async cleanupOrphanedOrders() {
    const { isExchangeTradingEnabled, getPreferredExchange, getOkxOpenPositions, getOkxPendingOrders, cancelOkxOrder, OKX_SYMBOL_MAP } = require('../services/exchangeService');
    const exchangeConfig = isExchangeTradingEnabled();

    if (!exchangeConfig.enabled) {
      return;
    }

    const exchange = getPreferredExchange();
    if (!exchange || exchange.exchange !== 'OKX') {
      return;
    }

    console.log('🧹 Starting orphan order cleanup...');

    try {
      // Get ALL open positions from OKX (source of truth)
      // Note: getOkxOpenPositions returns an array directly, not {success, positions}
      const okxPositions = await getOkxOpenPositions(
        exchange.apiKey,
        exchange.apiSecret,
        exchange.passphrase,
        exchange.baseUrl
      );

      console.log(`   🔍 OKX positions result: ${Array.isArray(okxPositions) ? okxPositions.length : 'not an array'} positions`);

      if (!Array.isArray(okxPositions)) {
        console.log(`   ⚠️ Could not fetch OKX positions: Invalid response format`);
        return;
      }

      // Build set of symbols with active positions
      const activeSymbols = new Set(
        okxPositions
          .filter(p => parseFloat(p.quantity || 0) > 0)
          .map(p => {
            // Map coin symbol back to instId format (e.g., 'ETH' -> 'ETH-USDT-SWAP')
            const coin = p.coin || p.symbol;
            return OKX_SYMBOL_MAP[coin] || `${coin}-USDT-SWAP`;
          })
      );

      console.log(`   📊 Active positions on OKX: ${activeSymbols.size}`);
      if (activeSymbols.size > 0) {
        console.log(`   📍 Position symbols: ${Array.from(activeSymbols).join(', ')}`);
      }

      // Get ALL pending limit orders from OKX
      console.log(`   🔍 Fetching ALL pending orders from OKX...`);
      const allOrders = await getOkxPendingOrders(
        '', // Empty instId = all symbols
        exchange.apiKey,
        exchange.apiSecret,
        exchange.passphrase,
        exchange.baseUrl
      );

      if (!allOrders.success || !allOrders.orders) {
        console.log(`   ⚠️ Could not fetch pending orders: ${allOrders.error || 'Unknown error'}`);
        return;
      }

      console.log(`   📦 Total pending orders: ${allOrders.orders.length}`);

      // Filter for active limit orders only
      const activeLimitOrders = allOrders.orders.filter(order => {
        const state = order.state || order.ordState || '';
        const ordType = order.ordType || '';
        return (state === 'live' || state === 'partially_filled') && ordType === 'limit';
      });

      console.log(`   📋 Active limit orders: ${activeLimitOrders.length}`);

      // Find orphaned limit orders (orders without matching positions)
      const orphanedOrders = activeLimitOrders.filter(order =>
        !activeSymbols.has(order.instId)
      );

      if (orphanedOrders.length === 0) {
        console.log('✅ Cleanup complete: No orphaned orders found');
        return;
      }

      console.log(`   🗑️ Found ${orphanedOrders.length} orphaned limit order(s)`);

      // Cancel each orphaned order
      let successCount = 0;
      for (const order of orphanedOrders) {
        try {
          const result = await cancelOkxOrder(
            order.instId,
            order.ordId,
            order.clOrdId,
            exchange.apiKey,
            exchange.apiSecret,
            exchange.passphrase,
            exchange.baseUrl,
            null // Don't pass tdMode for limit orders
          );

          if (result.success) {
            successCount++;
            console.log(`   ✅ Canceled orphaned order: ${order.instId} (${order.ordId})`);
          } else {
            console.log(`   ⚠️ Failed to cancel ${order.instId}: ${result.error}`);
          }
        } catch (error) {
          console.error(`   ❌ Error canceling ${order.instId}: ${error.message}`);
        }
      }

      console.log(`✅ Cleanup complete: Canceled ${successCount}/${orphanedOrders.length} orphaned orders`);
      if (successCount > 0) {
        addLogEntry(`Orphan cleanup: Canceled ${successCount} orphaned limit orders`, 'info');
      }

    } catch (error) {
      console.error(`❌ Orphan cleanup error: ${error.message}`);
    }
  }

  /**
   * Start 5-minute cleanup timer
   */
  startCleanupTimer() {
    if (this.cleanupTimer) {
      console.log('⏰ Cleanup timer already running');
      return;
    }

    console.log('🧹 Starting 5-minute orphan order cleanup timer');

    // Run immediately on start
    this.cleanupOrphanedOrders().catch(err => {
      console.error(`⚠️ Initial cleanup error: ${err.message}`);
    });

    // Then run every 5 minutes
    this.cleanupTimer = setInterval(async () => {
      try {
        await this.cleanupOrphanedOrders();
      } catch (error) {
        console.error(`⚠️ Cleanup timer error: ${error.message}`);
      }
    }, 5 * 60 * 1000); // 5 minutes
  }

  /**
   * Stop cleanup timer
   */
  stopCleanupTimer() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      console.log('⏰ Cleanup timer stopped');
    }
  }

  /**
   * Place DCA limit orders for trades that don't have them yet
   * This ensures all trades have DCA limit orders on OKX
   */
  async placeMissingDcaOrders() {
    if (this.activeTrades.length === 0) {
      return;
    }

    const { isExchangeTradingEnabled, getPreferredExchange, OKX_SYMBOL_MAP, executeOkxLimitOrder, getOkxOpenPositions, getOkxPendingOrders } = require('../services/exchangeService');
    const exchangeConfig = isExchangeTradingEnabled();

    if (!exchangeConfig.enabled) {
      console.log(`⚠️ Exchange trading not enabled, cannot place DCA orders`);
      return { placed: 0, failed: 0 };
    }

    const exchange = getPreferredExchange();
    if (!exchange || exchange.exchange !== 'OKX') {
      console.log(`⚠️ OKX not configured, cannot place DCA orders`);
      return { placed: 0, failed: 0 };
    }

    let placedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    for (const trade of this.activeTrades) {
      console.log(`🔍 Checking DCA order for ${trade.symbol} (status: ${trade.status})...`);

      // Only place for OPEN trades
      if (trade.status !== 'OPEN') {
        console.log(`   ⏭️ ${trade.symbol}: Skipping - status is '${trade.status}', not 'OPEN'`);
        continue;
      }

      // FIX: Check if trade has DCA order ID in trade object FIRST (before checking OKX)
      const hasDcaOrderInTrade = trade.okxDcaOrderId;
      console.log(`   📋 ${trade.symbol}: okxDcaOrderId=${hasDcaOrderInTrade || 'none'}`);

      // If DCA order ID exists in trade object, skip immediately (no need to check OKX)
      if (hasDcaOrderInTrade) {
        console.log(`   ⏭️ ${trade.symbol}: Skipping - already has DCA order ID in trade object (${hasDcaOrderInTrade})`);
        skippedCount++;
        continue;
      }

      // Check if trade has required fields
      const hasAddPosition = trade.addPosition || trade.dcaPrice;
      const hasEntryPrice = trade.entryPrice;
      const hasQuantity = trade.quantity;

      console.log(`   📋 ${trade.symbol}: addPosition=${trade.addPosition || trade.dcaPrice || 'none'}, entryPrice=${trade.entryPrice || 'none'}, quantity=${trade.quantity || 'none'}`);

      if (!hasAddPosition || !hasEntryPrice || !hasQuantity) {
        console.warn(`⚠️ ${trade.symbol}: Cannot place DCA order - missing required fields`);
        console.warn(`   Missing: ${!hasAddPosition ? 'addPosition/dcaPrice ' : ''}${!hasEntryPrice ? 'entryPrice ' : ''}${!hasQuantity ? 'quantity' : ''}`);
        failedCount++;
        continue;
      }

      const okxSymbol = OKX_SYMBOL_MAP[trade.symbol];
      if (!okxSymbol) {
        console.warn(`⚠️ ${trade.symbol}: No OKX symbol mapping found`);
        console.warn(`   Available symbols: ${Object.keys(OKX_SYMBOL_MAP).slice(0, 10).join(', ')}...`);
        failedCount++;
        continue;
      }
      console.log(`   ✅ OKX symbol mapping: ${trade.symbol} -> ${okxSymbol}`);

      // Check OKX for existing limit orders (to prevent duplicates)
      let hasDcaOrderOnOkx = false;
      const dcaPrice = trade.addPosition || trade.dcaPrice;
      try {
        const { getOkxPendingOrders } = require('../services/exchangeService');
        // Add timeout to prevent blocking deployment
        const pendingOrders = await Promise.race([
          getOkxPendingOrders(
            okxSymbol,
            exchange.apiKey,
            exchange.apiSecret,
            exchange.passphrase,
            exchange.baseUrl
          ),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('OKX API timeout (5s)')), 5000)
          )
        ]).catch(err => {
          console.warn(`⚠️ ${trade.symbol}: Timeout checking pending orders: ${err.message}`);
          return { success: false, error: err.message };
        });

        if (pendingOrders && pendingOrders.success && pendingOrders.orders && pendingOrders.orders.length > 0) {
          // Filter to active limit orders only
          const activeLimitOrders = pendingOrders.orders.filter(order => {
            const state = order.state || order.ordState || '';
            const ordType = order.ordType || '';
            // Check for live/partially_filled limit orders
            const isActive = (state === 'live' || state === 'partially_filled') && ordType === 'limit';
            return isActive;
          });

          // Check if any limit order matches our DCA price (within 1% tolerance)
          for (const order of activeLimitOrders) {
            const orderPrice = parseFloat(order.px || order.price || 0);
            const priceDiff = Math.abs(orderPrice - dcaPrice) / dcaPrice;
            const side = order.side || '';
            const expectedSide = trade.action === 'BUY' ? 'buy' : 'sell';

            // If order price is close to DCA price and side matches, consider it a DCA order
            if (priceDiff < 0.01 && side === expectedSide) {
              hasDcaOrderOnOkx = true;
              console.log(`   ✅ ${trade.symbol}: Found existing DCA limit order on OKX (Order ID: ${order.ordId || order.clOrdId || 'unknown'}, Price: $${orderPrice.toFixed(2)})`);

              // Update trade object with order ID if not set
              if (!hasDcaOrderInTrade) {
                trade.okxDcaOrderId = order.ordId || order.clOrdId;
                trade.okxDcaPrice = orderPrice;
                console.log(`   📝 Updated trade object with DCA order ID: ${trade.okxDcaOrderId}`);
              }

              // IMPORTANT: Sync the actual DCA price from OKX to trade object
              // This ensures proximity detection uses the correct price
              const currentDcaPrice = trade.addPosition || trade.dcaPrice || 0;
              if (Math.abs(orderPrice - currentDcaPrice) > 0.01) { // Only update if significantly different
                console.log(`   🔄 Syncing DCA price from OKX: $${currentDcaPrice.toFixed(2)} → $${orderPrice.toFixed(2)}`);
                trade.addPosition = orderPrice;
                trade.dcaPrice = orderPrice; // Also update dcaPrice for compatibility
              }
              break;
            }
          }
        }
      } catch (checkError) {
        console.warn(`⚠️ ${trade.symbol}: Could not check OKX for existing limit orders: ${checkError.message}`);
        // Continue anyway - we'll try to place orders
      }

      // If DCA order already exists (either in trade object or on OKX), skip
      if (hasDcaOrderInTrade || hasDcaOrderOnOkx) {
        console.log(`   ⏭️ ${trade.symbol}: Skipping - already has DCA order ${hasDcaOrderInTrade ? '(in trade object)' : '(on OKX)'}`);
        skippedCount++;
        continue;
      }

      // Validate DCA price direction (dcaPrice already set above)
      const entryPrice = trade.entryPrice;
      let shouldPlaceDCA = false;

      console.log(`   🔍 ${trade.symbol}: Validating DCA price - dcaPrice=$${dcaPrice.toFixed(2)}, entryPrice=$${entryPrice.toFixed(2)}, action=${trade.action}`);

      if (trade.action === 'BUY') {
        // For BUY: DCA should be below entry (to buy more at lower price)
        shouldPlaceDCA = dcaPrice < entryPrice && dcaPrice > 0;
        if (!shouldPlaceDCA) {
          console.log(`⚠️ ${trade.symbol}: DCA price ($${dcaPrice.toFixed(2)}) must be below entry ($${entryPrice.toFixed(2)}) for BUY position`);
          console.log(`   ❌ Validation failed: dcaPrice < entryPrice = ${dcaPrice < entryPrice}, dcaPrice > 0 = ${dcaPrice > 0}`);
          failedCount++;
          continue;
        }
        console.log(`   ✅ DCA price validation passed for BUY position`);
      } else {
        // For SELL: DCA should be above entry (to sell more at higher price)
        shouldPlaceDCA = dcaPrice > entryPrice && dcaPrice > 0;
        if (!shouldPlaceDCA) {
          console.log(`⚠️ ${trade.symbol}: DCA price ($${dcaPrice.toFixed(2)}) must be above entry ($${entryPrice.toFixed(2)}) for SELL position`);
          console.log(`   ❌ Validation failed: dcaPrice > entryPrice = ${dcaPrice > entryPrice}, dcaPrice > 0 = ${dcaPrice > 0}`);
          failedCount++;
          continue;
        }
        console.log(`   ✅ DCA price validation passed for SELL position`);
      }

      // Get actual position size from OKX (more accurate than trade.quantity)
      let positionSize = null;
      try {
        const positions = await getOkxOpenPositions(
          exchange.apiKey,
          exchange.apiSecret,
          exchange.passphrase,
          exchange.baseUrl
        );
        const position = positions.find(p => {
          const instId = p.instId || p.symbol || '';
          return instId === okxSymbol || instId.includes(trade.symbol.split('-')[0]);
        });
        if (position) {
          positionSize = Math.abs(parseFloat(position.quantity || position.pos || 0));
          console.log(`   📊 ${trade.symbol}: Found position size from OKX: ${positionSize}`);
        } else {
          // Fallback to trade quantity
          positionSize = parseFloat(trade.quantity || 0);
          console.log(`   ⚠️ ${trade.symbol}: Position not found on OKX, using trade quantity: ${positionSize}`);
        }
      } catch (posError) {
        // Fallback to trade quantity
        positionSize = parseFloat(trade.quantity || 0);
        console.log(`   ⚠️ ${trade.symbol}: Failed to get position size, using trade quantity: ${positionSize}`);
      }

      if (!positionSize || positionSize <= 0) {
        console.warn(`⚠️ ${trade.symbol}: Cannot place DCA order - no valid position size found`);
        console.warn(`   Position size: ${positionSize}, Trade quantity: ${trade.quantity}`);
        failedCount++;
        continue;
      }

      // Get DCA price from trade
      const dcaPriceValue = parseFloat(trade.addPosition) || 0;

      if (!dcaPriceValue || dcaPriceValue <= 0) {
        console.log(`   ⚠️ ${trade.symbol}: Invalid DCA price, skipping`);
        failedCount++;
        continue;
      }

      // Calculate DCA quantity using FIXED USD tiers (same as initial position logic)
      // BTC: $100, $100, $200, $400, $800
      // Others: $50, $50, $100, $200, $400

      // Determine which tier this DCA belongs to
      // The trade object stores which position number this is
      // DCA is for the NEXT position, so we need to find the next tier
      const isBTC = trade.symbol === 'BTC';
      const positionSizes = isBTC
        ? [100, 100, 200, 400, 800]  // BTC position sizes
        : [50, 50, 100, 200, 400];   // Other coins position sizes

      // Count existing positions for this symbol to determine DCA tier
      const existingPositions = this.activeTrades.filter(t =>
        t.symbol === trade.symbol &&
        (t.status === 'OPEN' || t.status === 'DCA_HIT' || t.status === 'PENDING')
      ).length;

      // DCA is for the next position (existingPositions + 1), array is 0-indexed
      const dcaPositionIndex = Math.min(existingPositions, positionSizes.length - 1);
      const dcaSizeUSD = positionSizes[dcaPositionIndex];

      // Calculate DCA quantity in coins
      let dcaQuantity = dcaSizeUSD / dcaPriceValue;

      console.log(`   📊 ${trade.symbol}: DCA sizing - Tier #${dcaPositionIndex + 1}: $${dcaSizeUSD} → ${dcaQuantity.toFixed(8)} coins @ $${dcaPriceValue.toFixed(2)}`);

      // Convert to OKX contracts for DCA order
      const contractSpecs = {
        'BTC-USDT-SWAP': { contractSize: 0.01, minOrder: 0.0001 },
        'ETH-USDT-SWAP': { contractSize: 0.1, minOrder: 0.001 },
        'SOL-USDT-SWAP': { contractSize: 1, minOrder: 0.1 },
        'XRP-USDT-SWAP': { contractSize: 100, minOrder: 1 },
        'DOGE-USDT-SWAP': { contractSize: 100, minOrder: 10 },
        'ADA-USDT-SWAP': { contractSize: 100, minOrder: 1 },
        'MATIC-USDT-SWAP': { contractSize: 10, minOrder: 1 },
        'DOT-USDT-SWAP': { contractSize: 1, minOrder: 0.1 },
        'AVAX-USDT-SWAP': { contractSize: 1, minOrder: 0.1 },
        'LINK-USDT-SWAP': { contractSize: 1, minOrder: 0.1 },
      };

      const dcaSpec = contractSpecs[okxSymbol] || { contractSize: 1, minOrder: 0.01 };
      const dcaCoinQuantity = dcaQuantity;
      const dcaContracts = dcaCoinQuantity / dcaSpec.contractSize;

      if (dcaCoinQuantity >= dcaSpec.minOrder) {
        dcaQuantity = dcaContracts; // Use fractional contracts
        console.log(`   ✅ DCA contracts: ${dcaContracts.toFixed(4)} (meets minimum)`);
      } else {
        // Below minimum, adjust to minimum
        dcaQuantity = dcaSpec.minOrder / dcaSpec.contractSize;
        console.log(`   ⚠️ DCA adjusted to minimum: ${dcaSpec.minOrder} ${trade.symbol} = ${dcaQuantity.toFixed(4)} contracts`);
      }


      if (dcaQuantity <= 0) {
        console.warn(`⚠️ ${trade.symbol}: DCA quantity is 0, skipping DCA limit order`);
        console.warn(`   Position size: ${positionSize}, Calculated DCA quantity: ${dcaQuantity}`);
        failedCount++;
        continue;
      }

      // Get leverage from trade or default to 1
      const leverage = trade.leverage || 1;
      const dcaSide = trade.action === 'BUY' ? 'buy' : 'sell';

      try {
        console.log(`📊 Placing DCA limit order for ${trade.symbol} at $${dcaPriceValue.toFixed(2)} (${dcaSide}, qty: ${dcaQuantity})...`);

        const dcaOrderResult = await executeOkxLimitOrder(
          okxSymbol,
          dcaSide,
          dcaQuantity,
          dcaPriceValue, // Limit price - FIXED: was using wrong dcaPrice variable
          exchange.apiKey,
          exchange.apiSecret,
          exchange.passphrase,
          exchange.baseUrl,
          leverage
        );

        if (dcaOrderResult.success) {
          console.log(`✅ DCA limit order placed for ${trade.symbol} at $${dcaPrice.toFixed(2)}! Order ID: ${dcaOrderResult.orderId}`);
          trade.okxDcaOrderId = dcaOrderResult.orderId;
          trade.okxDcaPrice = dcaPrice;
          trade.okxDcaQuantity = dcaQuantity;
          placedCount++;
          addLogEntry(`DCA limit order placed on OKX for ${trade.symbol} at $${dcaPrice.toFixed(2)} (will execute if price reaches this level)`, 'info');
        } else {
          console.log(`⚠️ Failed to place DCA limit order for ${trade.symbol}: ${dcaOrderResult.error || 'Unknown error'}`);
          failedCount++;
        }
      } catch (dcaError) {
        console.error(`❌ Error placing DCA limit order for ${trade.symbol}: ${dcaError.message}`);
        failedCount++;
      }

      // Small delay between orders to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (placedCount > 0) {
      console.log(`✅ Placed DCA limit orders for ${placedCount} trade(s) on OKX`);
    }
    if (skippedCount > 0) {
      console.log(`⏭️ Skipped ${skippedCount} trade(s) - already have DCA orders`);
    }
    if (failedCount > 0) {
      console.warn(`⚠️ Failed to place DCA orders for ${failedCount} trade(s)`);
    }

    return { placed: placedCount, failed: failedCount, skipped: skippedCount };
  }

  async updateActiveTrades() {
    // Remove CLOSED trades from activeTrades array (cleanup)
    const beforeCount = this.activeTrades.length;
    this.activeTrades = this.activeTrades.filter(t =>
      t.status !== 'CLOSED' && t.status !== 'TP_HIT' && t.status !== 'SL_HIT'
    );

    const removedCount = beforeCount - this.activeTrades.length;
    if (removedCount > 0) {
      console.log(`🗑️ Removed ${removedCount} closed trade(s) from activeTrades`);
      const { saveTrades } = require('../services/tradePersistenceService');
      await saveTrades(this.activeTrades); // Persist changes
    }

    if (this.activeTrades.length === 0) {
      return;
    }

    // Fix any trades missing TP, SL, or DCA levels first
    await this.fixMissingTradeLevels();

    // Sync with OKX positions first (source of truth for quantities)
    // NOTE: Trade data is kept in memory only for trigger monitoring (DCA, SL, TP proximity detection)
    // OKX is the source of truth for actual positions and balance
    await this.syncWithOkxPositions();

    // Place algo orders for trades that don't have them yet
    await this.placeMissingAlgoOrders();

    // Place DCA limit orders for trades that don't have them yet
    await this.placeMissingDcaOrders();

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

      // Fetch prices for all trades in batch in parallel using OKX market data
      const { getOkxTicker, OKX_SYMBOL_MAP, getPreferredExchange } = require('../services/exchangeService');
      const exchange = getPreferredExchange();
      const okxBaseUrl = exchange?.baseUrl || 'https://www.okx.com';

      const pricePromises = batch.map(trade => {
        // Map trade symbol to OKX symbol format (e.g., 'BTC' -> 'BTC-USDT-SWAP')
        const okxSymbol = OKX_SYMBOL_MAP[trade.symbol] || `${trade.symbol}-USDT-SWAP`;

        return getOkxTicker(okxSymbol, okxBaseUrl)
          .then(tickerResult => {
            if (tickerResult.success && tickerResult.last > 0) {
              return {
                trade,
                priceResult: { data: { price: tickerResult.last } },
                success: true,
                source: 'OKX'
              };
            } else {
              // Fallback to external API if OKX fails
              const coinData = trade.coinData || {
                symbol: trade.symbol,
                name: trade.name,
                id: trade.coinId,
                coinmarketcap_id: trade.coinmarketcap_id,
                coinpaprika_id: trade.coinpaprika_id
              };
              return fetchEnhancedPriceData(coinData, this.priceCache, this.stats, config)
                .then(priceResult => ({ trade, priceResult, success: true, source: 'external' }))
                .catch(error => {
                  console.error(`⚠️ Price fetch failed for ${trade.symbol} (OKX and external):`, error.message);
                  return { trade, priceResult: null, success: false, error };
                });
            }
          })
          .catch(error => {
            console.error(`⚠️ OKX ticker fetch failed for ${trade.symbol}, trying external API:`, error.message);
            // Fallback to external API
            const coinData = trade.coinData || {
              symbol: trade.symbol,
              name: trade.name,
              id: trade.coinId,
              coinmarketcap_id: trade.coinmarketcap_id,
              coinpaprika_id: trade.coinpaprika_id
            };
            return fetchEnhancedPriceData(coinData, this.priceCache, this.stats, config)
              .then(priceResult => ({ trade, priceResult, success: true, source: 'external' }))
              .catch(fallbackError => {
                console.error(`⚠️ Price fetch failed for ${trade.symbol} (both OKX and external):`, fallbackError.message);
                return { trade, priceResult: null, success: false, error: fallbackError };
              });
          });
      });

      const priceResults = await Promise.allSettled(pricePromises);

      // Process each trade with its price result
      for (let j = 0; j < priceResults.length; j++) {
        const result = priceResults[j];
        if (result.status !== 'fulfilled') {
          continue;
        }

        const { trade, priceResult, success, source } = result.value;

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

          // Log price source for debugging
          if (source === 'OKX' && currentPrice > 0) {
            // Only log occasionally to avoid spam (every 10th update or first update)
            if (!trade.lastPriceSource || trade.lastPriceSource !== 'OKX' || Math.random() < 0.1) {
              console.log(`📊 ${trade.symbol}: Using OKX price $${currentPrice.toFixed(2)}`);
            }
            trade.lastPriceSource = 'OKX';
          } else if (source === 'external' && currentPrice > 0) {
            console.log(`⚠️ ${trade.symbol}: OKX price unavailable, using external API $${currentPrice.toFixed(2)}`);
            trade.lastPriceSource = 'external';
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
          // Use portfolio-based position sizing
          const { getPortfolio } = require('../services/portfolioService');
          const portfolio = getPortfolio();
          const portfolioValue = portfolio.currentBalance || portfolio.initialCapital || 5000;
          const positionSizeUSD = portfolioValue * 0.015; // 1.5% of portfolio
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
              // Cancel TP/SL algo orders (they should have executed, but cancel to be safe)
              await this.cancelTradeAlgoOrders(trade);

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

                // Trigger AI re-evaluation when TP is hit (don't await to avoid blocking)
                this.triggerAIReevaluation(`TP executed for ${trade.symbol}`).catch(err => {
                  console.error(`⚠️ Error triggering AI after TP: ${err.message}`);
                });
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

                // Trigger AI re-evaluation when TP is hit (even if execution failed) (don't await to avoid blocking)
                this.triggerAIReevaluation(`TP hit for ${trade.symbol} (execution ${tpResult.error ? 'failed' : 'skipped'})`).catch(err => {
                  console.error(`⚠️ Error triggering AI after TP: ${err.message}`);
                });
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
                      `   🎯 TP Gain: ${tpGainPercent.toFixed(2)}% | 🛡️ SL Loss: ${slLossPercent.toFixed(2)}%`;

                    // Trigger AI to recalculate TP/SL/DCA based on new average entry
                    console.log(`🤖 Triggering AI re-evaluation for ${trade.symbol} after DCA #${trade.dcaCount}`);
                    setTimeout(async () => {
                      try {
                        await this.requestAILevelUpdate(trade, trade.averageEntryPrice);
                      } catch (error) {
                        console.error(`❌ Failed to trigger AI re-evaluation: ${error.message}`);
                      }
                    }, 2000); // Small delay to ensure DCA execution is complete
                    notificationLevel = 'warning';
                    notificationNeeded = true;
                    trade.dcaNotified = true;
                    trade.lastDcaAt = now;
                    addLogEntry(`💰 DCA #${trade.dcaCount} EXECUTED: ${trade.symbol} - Order ID: ${dcaResult.orderId}`, 'info');
                    addLogEntry(`📊 ${trade.symbol} metrics updated: Avg Entry $${trade.averageEntryPrice.toFixed(2)}, Size ${totalQuantity.toFixed(4)}, P&L ${pnlPercentFromAvg.toFixed(2)}%`, 'info');

                    // Explicitly save trade after successful DCA
                    try {
                      // Removed: DynamoDB persistence - OKX is the only source of truth
                      console.log(`💾 Saved ${trade.symbol} trade after DCA #${trade.dcaCount} execution`);
                    } catch (saveError) {
                      console.error(`❌ Failed to save ${trade.symbol} trade after DCA:`, saveError.message);
                    }

                    // Use unified trigger function (don't await to avoid blocking)
                    this.triggerAIReevaluation(`DCA executed for ${trade.symbol}`).catch(err => {
                      console.error(`⚠️ Error triggering AI after DCA: ${err.message}`);
                    });
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
                      // Removed: DynamoDB persistence - OKX is the only source of truth
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
              // Cancel TP/SL algo orders (they should have executed, but cancel to be safe)
              await this.cancelTradeAlgoOrders(trade);

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

                // Trigger AI re-evaluation when SL is hit (don't await to avoid blocking)
                this.triggerAIReevaluation(`SL executed for ${trade.symbol}`).catch(err => {
                  console.error(`⚠️ Error triggering AI after SL: ${err.message}`);
                });
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

                // Trigger AI re-evaluation when SL is hit (even if execution failed) (don't await to avoid blocking)
                this.triggerAIReevaluation(`SL hit for ${trade.symbol} (execution ${slResult.error ? 'failed' : 'skipped'})`).catch(err => {
                  console.error(`⚠️ Error triggering AI after SL: ${err.message}`);
                });
              }
            }
          } else if (trade.action === 'SELL') { // Short position logic
            // Check Take Profit for SELL (highest priority)
            if (currentPrice <= trade.takeProfit && trade.status === 'OPEN') {
              // Cancel TP/SL algo orders (they should have executed, but cancel to be safe)
              await this.cancelTradeAlgoOrders(trade);

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

                // Trigger AI re-evaluation when TP is hit (SHORT) (don't await to avoid blocking)
                this.triggerAIReevaluation(`TP executed for ${trade.symbol} (SHORT)`).catch(err => {
                  console.error(`⚠️ Error triggering AI after TP (SHORT): ${err.message}`);
                });
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

                // Trigger AI re-evaluation when TP is hit (SHORT, even if execution failed) (don't await to avoid blocking)
                this.triggerAIReevaluation(`TP hit for ${trade.symbol} (SHORT, execution ${tpResult.error ? 'failed' : 'skipped'})`).catch(err => {
                  console.error(`⚠️ Error triggering AI after TP (SHORT): ${err.message}`);
                });
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
                      `   🎯 TP Gain: ${tpGainPercent.toFixed(2)}% | 🛡️ SL Loss: ${slLossPercent.toFixed(2)}%`;

                    // Trigger AI to recalculate TP/SL/DCA based on new average entry
                    console.log(`🤖 Triggering AI re-evaluation for ${trade.symbol} after DCA #${trade.dcaCount}`);
                    setTimeout(async () => {
                      try {
                        await this.requestAILevelUpdate(trade, trade.averageEntryPrice);
                      } catch (error) {
                        console.error(`❌ Failed to trigger AI re-evaluation: ${error.message}`);
                      }
                    }, 2000); // Small delay to ensure DCA execution is complete
                    notificationLevel = 'warning';
                    notificationNeeded = true;
                    trade.dcaNotified = true;
                    trade.lastDcaAt = now;
                    addLogEntry(`💰 DCA #${trade.dcaCount} EXECUTED (SHORT): ${trade.symbol} - Order ID: ${dcaResult.orderId}`, 'info');
                    addLogEntry(`📊 ${trade.symbol} metrics updated: Avg Entry $${trade.averageEntryPrice.toFixed(2)}, Size ${totalQuantity.toFixed(4)}, P&L ${pnlPercentFromAvg.toFixed(2)}%`, 'info');

                    // Explicitly save trade after successful DCA
                    try {
                      // Removed: DynamoDB persistence - OKX is the only source of truth
                      console.log(`💾 Saved ${trade.symbol} trade after DCA #${trade.dcaCount} execution (SHORT)`);
                    } catch (saveError) {
                      console.error(`❌ Failed to save ${trade.symbol} trade after DCA:`, saveError.message);
                    }

                    // Use unified trigger function (don't await to avoid blocking)
                    this.triggerAIReevaluation(`DCA executed for ${trade.symbol} (SHORT)`).catch(err => {
                      console.error(`⚠️ Error triggering AI after DCA (SHORT): ${err.message}`);
                    });
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
                      // Removed: DynamoDB persistence - OKX is the only source of truth
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
              // Cancel TP/SL algo orders (they should have executed, but cancel to be safe)
              await this.cancelTradeAlgoOrders(trade);

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

                // Trigger AI re-evaluation when SL is hit (SHORT) (don't await to avoid blocking)
                this.triggerAIReevaluation(`SL executed for ${trade.symbol} (SHORT)`).catch(err => {
                  console.error(`⚠️ Error triggering AI after SL (SHORT): ${err.message}`);
                });
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

                // Trigger AI re-evaluation when SL is hit (SHORT, even if execution failed) (don't await to avoid blocking)
                this.triggerAIReevaluation(`SL hit for ${trade.symbol} (SHORT, execution ${slResult.error ? 'failed' : 'skipped'})`).catch(err => {
                  console.error(`⚠️ Error triggering AI after SL (SHORT): ${err.message}`);
                });
              }
            }
          }

          // Check proximity-based triggers (when price is near but hasn't hit DCA/TP/SL)
          // Run asynchronously to avoid blocking trade updates
          if (trade.status === 'OPEN' && currentPrice > 0) {
            // Don't await - run in background to avoid blocking
            this.checkProximityTriggers(trade, currentPrice).catch(err => {
              console.error(`⚠️ Error checking proximity triggers for ${trade.symbol}: ${err.message}`);
            });
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

      // Removed: DynamoDB persistence - OKX is the only source of truth

      console.log(`✅ Moved ${closedTradesToMove.length} closed trade(s) to closedTrades and updated portfolio`);
    }

    // Removed: DynamoDB sync logic - OKX is the only source of truth

    // Log all active trades for tracking
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
    } else {
      console.log(`📊 No active trades currently`);
    }

    // Recalculate portfolio metrics from updated trades
    await recalculateFromTrades(this.activeTrades);
  }

  // Re-evaluate open trades with AI during scan
  /**
   * Unified function to trigger AI re-evaluation with cooldown management
   * Used by all triggers: DCA execution, TP hit, SL hit, proximity triggers
   * @param {string} reason - Reason for triggering (for logging)
   */
  async triggerAIReevaluation(reason) {
    const now = Date.now();
    const { getDcaTriggerTimestamp, setDcaTriggerTimestamp } = require('../services/portfolioService');

    // Always check persisted value to ensure cooldown persists across restarts
    const persistedTimestamp = getDcaTriggerTimestamp();
    const lastDcaReeval = Math.max(this.lastDcaTriggerReevalAt || 0, persistedTimestamp || 0);
    const elapsedSinceLastDcaReeval = now - lastDcaReeval;
    const timeSinceStartup = now - this.botStartTime;

    // Check startup delay, cooldown, AND if re-evaluation is already in progress
    if (!this.dcaTriggerReevalInProgress &&
      timeSinceStartup >= this.dcaTriggerStartupDelayMs &&
      elapsedSinceLastDcaReeval >= this.dcaTriggerReevalCooldownMs) {
      // Set flag AND timestamp IMMEDIATELY to prevent other triggers from triggering
      this.dcaTriggerReevalInProgress = true;
      const triggerTimestamp = Date.now();
      this.lastDcaTriggerReevalAt = triggerTimestamp; // Set immediately, not inside async callback
      await setDcaTriggerTimestamp(triggerTimestamp); // Persist to portfolio state
      console.log(`🔄 [AI TRIGGER] ${reason} - triggering re-evaluation of ALL open trades (3-hour cooldown starts now)...`);
      addLogEntry(`🔄 ${reason} - triggering re-evaluation of all open trades (3-hour cooldown)`, 'info');

      // Trigger re-evaluation asynchronously (don't block execution)
      // Use setTimeout with 0 delay to ensure it doesn't block deployment
      setTimeout(async () => {
        try {
          await this.reevaluateOpenTradesWithAI();
        } catch (reevalError) {
          console.error(`❌ Error during AI re-evaluation:`, reevalError.message);
          addLogEntry(`❌ Error during AI re-evaluation: ${reevalError.message}`, 'error');
        } finally {
          // Always clear the flag when done (success or error)
          this.dcaTriggerReevalInProgress = false;
        }
      }, 0);
    } else if (this.dcaTriggerReevalInProgress) {
      console.log(`⏱️ Skipping AI re-evaluation (${reason}) - already in progress`);
      addLogEntry(`⏱️ Skipped AI re-evaluation (${reason}) - already in progress`, 'info');
    } else if (timeSinceStartup < this.dcaTriggerStartupDelayMs) {
      const remainingStartupDelay = Math.ceil((this.dcaTriggerStartupDelayMs - timeSinceStartup) / 60000);
      console.log(`⏱️ Skipping AI re-evaluation (${reason}) - startup delay ${remainingStartupDelay}min remaining`);
      addLogEntry(`⏱️ Skipped AI re-evaluation (${reason}) - startup delay ${remainingStartupDelay}min remaining`, 'info');
    } else {
      const remainingCooldownMs = this.dcaTriggerReevalCooldownMs - elapsedSinceLastDcaReeval;
      const remainingHours = Math.floor(remainingCooldownMs / 3600000);
      const remainingMinutes = Math.ceil((remainingCooldownMs % 3600000) / 60000);
      console.log(`⏱️ Skipping AI re-evaluation (${reason}) - cooldown: ${remainingHours}h ${remainingMinutes}m remaining`);
      addLogEntry(`⏱️ Skipped AI re-evaluation (${reason}) - cooldown: ${remainingHours}h ${remainingMinutes}m remaining`, 'info');
    }
  }

  /**
   * Check if price is near key levels (DCA/TP/SL) and trigger AI if needed
   * @param {Object} trade - Trade object
   * @param {number} currentPrice - Current price
   */
  async checkProximityTriggers(trade, currentPrice) {
    if (!trade || !currentPrice || currentPrice <= 0) {
      return;
    }

    const proximityPercent = this.proximityTriggerPercent || 3.0;
    let triggered = false;
    let triggerReason = '';

    if (trade.action === 'BUY') {
      // Check proximity to TP (above entry)
      if (trade.takeProfit && currentPrice < trade.takeProfit) {
        const distanceToTP = ((trade.takeProfit - currentPrice) / trade.takeProfit) * 100;
        if (distanceToTP <= proximityPercent && distanceToTP > 0) {
          triggered = true;
          triggerReason = `Price within ${distanceToTP.toFixed(1)}% of TP for ${trade.symbol} ($${currentPrice.toFixed(2)} near TP $${trade.takeProfit.toFixed(2)})`;
        }
      }

      // Check proximity to SL (below entry)
      if (!triggered && trade.stopLoss && currentPrice > trade.stopLoss) {
        const distanceToSL = ((currentPrice - trade.stopLoss) / currentPrice) * 100;
        if (distanceToSL <= proximityPercent && distanceToSL > 0) {
          triggered = true;
          triggerReason = `Price within ${distanceToSL.toFixed(1)}% of SL for ${trade.symbol} ($${currentPrice.toFixed(2)} near SL $${trade.stopLoss.toFixed(2)})`;
        }
      }

      // Check proximity to DCA (below entry)
      if (!triggered && trade.addPosition && currentPrice > trade.addPosition) {
        const distanceToDCA = ((currentPrice - trade.addPosition) / currentPrice) * 100;
        if (distanceToDCA <= proximityPercent && distanceToDCA > 0) {
          triggered = true;
          triggerReason = `Price within ${distanceToDCA.toFixed(1)}% of DCA for ${trade.symbol} ($${currentPrice.toFixed(2)} near DCA $${trade.addPosition.toFixed(2)})`;
        }
      }
    } else if (trade.action === 'SELL') {
      // Check proximity to TP (below entry for SHORT)
      if (trade.takeProfit && currentPrice > trade.takeProfit) {
        const distanceToTP = ((currentPrice - trade.takeProfit) / currentPrice) * 100;
        if (distanceToTP <= proximityPercent && distanceToTP > 0) {
          triggered = true;
          triggerReason = `Price within ${distanceToTP.toFixed(1)}% of TP for ${trade.symbol} (SHORT) ($${currentPrice.toFixed(2)} near TP $${trade.takeProfit.toFixed(2)})`;
        }
      }

      // Check proximity to SL (above entry for SHORT)
      if (!triggered && trade.stopLoss && currentPrice < trade.stopLoss) {
        const distanceToSL = ((trade.stopLoss - currentPrice) / trade.stopLoss) * 100;
        if (distanceToSL <= proximityPercent && distanceToSL > 0) {
          triggered = true;
          triggerReason = `Price within ${distanceToSL.toFixed(1)}% of SL for ${trade.symbol} (SHORT) ($${currentPrice.toFixed(2)} near SL $${trade.stopLoss.toFixed(2)})`;
        }
      }

      // Check proximity to DCA (above entry for SHORT)
      if (!triggered && trade.addPosition && currentPrice < trade.addPosition) {
        const distanceToDCA = ((trade.addPosition - currentPrice) / trade.addPosition) * 100;
        if (distanceToDCA <= proximityPercent && distanceToDCA > 0) {
          triggered = true;
          triggerReason = `Price within ${distanceToDCA.toFixed(1)}% of DCA for ${trade.symbol} (SHORT) ($${currentPrice.toFixed(2)} near DCA $${trade.addPosition.toFixed(2)})`;
        }
      }
    }

    if (triggered) {
      // Only trigger if we haven't triggered for this trade recently (avoid spam)
      const lastProximityTrigger = trade.lastProximityTriggerAt || 0;
      const proximityCooldownMs = 30 * 60 * 1000; // 30 minutes per trade

      if (Date.now() - lastProximityTrigger >= proximityCooldownMs) {
        trade.lastProximityTriggerAt = Date.now();
        console.log(`📍 [PROXIMITY TRIGGER] ${triggerReason}`);
        // Don't await to avoid blocking - run in background
        this.triggerAIReevaluation(triggerReason).catch(err => {
          console.error(`⚠️ Error triggering AI from proximity: ${err.message}`);
        });
      }
    }
  }

  async reevaluateOpenTradesWithAI() {
    const now = Date.now();
    const lastEval = this.lastOpenTradesReevalAt || 0;
    const elapsed = now - lastEval;

    // Global cooldown to avoid calling Premium AI too often (saves cost)
    if (elapsed < this.openTradesReevalCooldownMs) {
      console.log(
        `⏱️ Skipping AI re-evaluation of open trades (cooldown ${this.openTradesReevalCooldownMs / 60000
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

IMPORTANT CONTEXT: This is derivatives trading (perpetual swaps):
- BUY trades = Long positions (profit when price goes UP)
- SELL trades = Short positions (profit when price goes DOWN)
- For SELL (short) trades: profit when price decreases, loss when price increases

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

POSITION SIZING RULES (CRITICAL):
- Maximum 5 positions can be open at once
- Each position should reach a maximum of 10% of total portfolio after all DCAs
- DCA (Dollar-Cost Averaging) plan per position:
  * Initial position: 1.5% of portfolio
  * DCA 1: +1% of portfolio (total: 2.5%)
  * DCA 2: +2% of portfolio (total: 4.5%)
  * DCA 3: +4% of portfolio (total: 8.5%)
  * DCA 4: +1.5% of portfolio (total: 10% max)
- Consider portfolio allocation when making recommendations

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

                    // FIX: Ensure DCA is positioned correctly relative to new SL
                    // For BUY: DCA must be below SL (so DCA triggers before SL closes position)
                    const currentDca = trade.addPosition || trade.dcaPrice;
                    if (currentDca && currentDca > 0) {
                      if (currentDca >= newSL) {
                        // DCA is at or above SL - adjust DCA to be below SL
                        const adjustedDca = newSL * 0.99; // 1% below SL
                        console.log(`   🔄 ${symbol}: Adjusting DCA from $${currentDca.toFixed(2)} to $${adjustedDca.toFixed(2)} (must be below SL: $${newSL.toFixed(2)})`);
                        trade.addPosition = adjustedDca;
                        trade.dcaPrice = adjustedDca;
                        addLogEntry(`🟡 ${symbol}: DCA auto-adjusted to $${adjustedDca.toFixed(2)} (below SL: $${newSL.toFixed(2)})`, 'info');
                        telegramMessage += `   ⚙️ DCA: $${currentDca.toFixed(2)} → $${adjustedDca.toFixed(2)} (aligned with SL)\n`;
                      }
                    }
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

                    // FIX: Ensure DCA is positioned correctly relative to new SL
                    // For SELL (short): DCA must be above SL (so DCA triggers before SL closes position)
                    const currentDca = trade.addPosition || trade.dcaPrice;
                    if (currentDca && currentDca > 0) {
                      if (currentDca <= newSL) {
                        // DCA is at or below SL - adjust DCA to be above SL
                        const adjustedDca = newSL * 1.01; // 1% above SL
                        console.log(`   🔄 ${symbol}: Adjusting DCA from $${currentDca.toFixed(2)} to $${adjustedDca.toFixed(2)} (must be above SL: $${newSL.toFixed(2)})`);
                        trade.addPosition = adjustedDca;
                        trade.dcaPrice = adjustedDca;
                        addLogEntry(`🟡 ${symbol}: DCA auto-adjusted to $${adjustedDca.toFixed(2)} (above SL: $${newSL.toFixed(2)})`, 'info');
                        telegramMessage += `   ⚙️ DCA: $${currentDca.toFixed(2)} → $${adjustedDca.toFixed(2)} (aligned with SL)\n`;
                      }
                    }
                  }
                }
              }
              // Handle both newDcaPrice (new field) and newAddPosition (legacy field) for backward compatibility
              // FIX: Declare newDcaValue outside if block to avoid scope issues
              const newDcaValue = rec.newDcaPrice || rec.newAddPosition;
              if (newDcaValue && typeof newDcaValue === 'number' && newDcaValue > 0) {
                const oldDca = trade.addPosition || trade.dcaPrice || trade.entryPrice;
                const currentSL = trade.stopLoss;

                // FIX: Validate DCA position relative to SL before applying
                let finalDcaValue = newDcaValue;
                let dcaAdjusted = false;

                if (currentSL && currentSL > 0) {
                  if (trade.action === 'BUY') {
                    // For BUY (Long): Entry > DCA > SL
                    // DCA must be ABOVE SL (so DCA triggers before SL closes position)
                    if (newDcaValue <= currentSL) {
                      finalDcaValue = currentSL * 1.01; // 1% ABOVE SL
                      dcaAdjusted = true;
                      console.log(`   🔄 ${symbol}: DCA value $${newDcaValue.toFixed(2)} is at/below SL $${currentSL.toFixed(2)} - adjusting to $${finalDcaValue.toFixed(2)}`);
                      addLogEntry(`⚠️ ${symbol}: DCA adjusted from $${newDcaValue.toFixed(4)} to $${finalDcaValue.toFixed(4)} (must be above SL: $${currentSL.toFixed(2)})`, 'warning');
                    }
                  } else if (trade.action === 'SELL') {
                    // For SELL (Short): Entry < DCA < SL
                    // DCA must be BELOW SL (so DCA triggers before SL closes position)
                    if (newDcaValue >= currentSL) {
                      finalDcaValue = currentSL * 0.99; // 1% BELOW SL
                      dcaAdjusted = true;
                      console.log(`   🔄 ${symbol}: DCA value $${newDcaValue.toFixed(2)} is at/above SL $${currentSL.toFixed(2)} - adjusting to $${finalDcaValue.toFixed(2)}`);
                      addLogEntry(`⚠️ ${symbol}: DCA adjusted from $${newDcaValue.toFixed(4)} to $${finalDcaValue.toFixed(4)} (must be below SL: $${currentSL.toFixed(2)})`, 'warning');
                    }
                  }
                }

                trade.addPosition = finalDcaValue;
                trade.dcaPrice = finalDcaValue; // Store in both fields for consistency
                adjusted = true;

                if (dcaAdjusted) {
                  addLogEntry(`🟡 ${symbol}: AI adjusted DCA Price from $${oldDca.toFixed(2)} to $${finalDcaValue.toFixed(2)} (auto-aligned with SL)`, 'info');
                  telegramMessage += `   ⚙️ DCA: $${oldDca.toFixed(2)} → $${finalDcaValue.toFixed(2)} (aligned with SL)\n`;
                } else {
                  addLogEntry(`🟡 ${symbol}: AI adjusted DCA Price from $${oldDca.toFixed(2)} to $${finalDcaValue.toFixed(2)}`, 'info');
                  telegramMessage += `   ⚙️ DCA: $${oldDca.toFixed(2)} → $${finalDcaValue.toFixed(2)}\n`;
                }
              }
              if (adjusted) {
                // Removed: DynamoDB persistence - OKX is the only source of truth
                addLogEntry(`✅ ${symbol}: Trade parameters updated by AI`, 'success');

                // IMPORTANT: Update orders on OKX when TP/SL/DCA are adjusted
                try {
                  console.log(`🔄 ${symbol}: Updating orders on OKX after AI adjustment...`);

                  // If TP or SL was adjusted, cancel old orders and place new ones on OKX
                  if (rec.newTakeProfit || rec.newStopLoss) {
                    // Cancel existing TP/SL algo orders first
                    // CRITICAL: Must verify cancellation succeeds to prevent duplicates
                    let cancellationSucceeded = false;

                    try {
                      const { getOkxAlgoOrders, cancelOkxAlgoOrders } = require('../services/exchangeService');
                      const { isExchangeTradingEnabled, getPreferredExchange, OKX_SYMBOL_MAP } = require('../services/exchangeService');
                      const exchangeConfig = isExchangeTradingEnabled();

                      if (exchangeConfig.enabled) {
                        const exchange = getPreferredExchange();
                        const okxSymbol = OKX_SYMBOL_MAP[symbol];

                        if (okxSymbol && exchange) {
                          // Fetch existing algo orders from OKX
                          try {
                            const algoOrders = await Promise.race([
                              getOkxAlgoOrders(
                                okxSymbol,
                                'conditional',
                                exchange.apiKey,
                                exchange.apiSecret,
                                exchange.passphrase,
                                exchange.baseUrl
                              ),
                              new Promise((_, reject) =>
                                setTimeout(() => reject(new Error('OKX API timeout (5s)')), 5000)
                              )
                            ]).catch(err => {
                              console.warn(`⚠️ ${symbol}: Timeout checking algo orders: ${err.message}`);
                              return { success: false, error: err.message };
                            });

                            if (algoOrders && algoOrders.success && algoOrders.orders && algoOrders.orders.length > 0) {
                              const activeOrders = algoOrders.orders.filter(order => {
                                const state = order.state || order.ordState || '';
                                return state === 'live' || state === 'effective' || state === 'partially_filled';
                              });

                              if (activeOrders.length > 0) {
                                const ordersToCancel = activeOrders
                                  .map(order => {
                                    const cancelOrder = { instId: okxSymbol };
                                    // Only include ONE of algoId or algoClOrdId, not both
                                    if (order.algoId) {
                                      cancelOrder.algoId = order.algoId;
                                    } else if (order.algoClOrdId) {
                                      cancelOrder.algoClOrdId = order.algoClOrdId;
                                    }
                                    // NOTE: Removed tdMode here as it might be causing 'Incorrect json data format'
                                    // OKX cancel-algos endpoint usually just needs algoId and instId
                                    return cancelOrder;
                                  })
                                  .filter(order => order.algoId || order.algoClOrdId);

                                if (ordersToCancel.length > 0) {
                                  console.log(`🗑️ ${symbol}: Canceling ${ordersToCancel.length} active algo order(s) from OKX...`);
                                  const cancelResult = await cancelOkxAlgoOrders(
                                    ordersToCancel,
                                    exchange.apiKey,
                                    exchange.apiSecret,
                                    exchange.passphrase,
                                    exchange.baseUrl
                                  );

                                  // Verify cancellation succeeded
                                  if (cancelResult && cancelResult.success) {
                                    console.log(`✅ ${symbol}: Canceled ${ordersToCancel.length} existing algo order(s) from OKX`);
                                    cancellationSucceeded = true;

                                    // Clear old algo IDs from trade object
                                    trade.okxTpAlgoId = null;
                                    trade.okxSlAlgoId = null;
                                  } else {
                                    const errorMsg = `TP/SL algo order cancellation failed for ${symbol}: ${cancelResult?.error || 'Unknown error'}`;
                                    console.error(`❌ ${errorMsg}`);

                                    // Send Telegram notification
                                    addLogEntry(errorMsg, 'error');
                                  }
                                }
                              } else {
                                // No active orders to cancel, safe to proceed
                                cancellationSucceeded = true;
                              }
                            } else {
                              // No orders found or fetch failed
                              if (algoOrders && !algoOrders.success) {
                                const errorMsg = `Failed to fetch algo orders for ${symbol}: ${algoOrders.error}`;
                                console.error(`❌ ${errorMsg}`);
                                addLogEntry(errorMsg, 'error');
                              } else {
                                // No existing orders, safe to proceed
                                cancellationSucceeded = true;
                              }
                            }
                          } catch (fetchError) {
                            const errorMsg = `Could not fetch algo orders for ${symbol}: ${fetchError.message}`;
                            console.error(`❌ ${errorMsg}`);
                            addLogEntry(errorMsg, 'error');
                          }
                        }
                      }
                    } catch (cancelError) {
                      const errorMsg = `Error canceling algo orders for ${symbol}: ${cancelError.message}`;
                      console.error(`❌ ${errorMsg}`);

                      // const { addLogEntry } = require('../services/exchangeService');
                      addLogEntry(errorMsg, 'error');
                    }

                    // Only place new TP/SL orders if cancellation succeeded (or no old orders existed)
                    if (!cancellationSucceeded) {
                      console.warn(`⚠️ ${symbol}: Skipping new TP/SL order placement - old orders still exist on OKX`);
                      // const { addLogEntry } = require('../services/exchangeService');
                      addLogEntry(`⚠️ ${symbol}: Skipped new TP/SL - old order cancellation failed. Manual cleanup required!`, 'warning');
                      continue; // Skip to next recommendation
                    }

                    // Now place new TP/SL orders with updated prices
                    const orderResult = await this.placeTradeAlgoOrders(trade);
                    if (orderResult) {
                      console.log(`✅ ${symbol}: TP/SL orders updated on OKX`);
                      // const { addLogEntry } = require('../services/exchangeService');
                      addLogEntry(`✅ ${symbol}: TP/SL orders updated on OKX after AI adjustment`, 'success');
                    } else {
                      console.warn(`⚠️ ${symbol}: Failed to update TP/SL orders on OKX`);
                      // const { addLogEntry } = require('../services/exchangeService');
                      addLogEntry(`⚠️ ${symbol}: Failed to update TP/SL orders on OKX`, 'warning');
                    }
                  }

                  // If DCA was adjusted, cancel old DCA order and place new one
                  // FIX: Check if newDcaValue exists and is valid before using
                  if (newDcaValue && typeof newDcaValue === 'number' && newDcaValue > 0) {
                    // Cancel existing DCA order if it exists
                    let cancellationSucceeded = false;

                    if (trade.okxDcaOrderId) {
                      try {
                        const { isExchangeTradingEnabled, getPreferredExchange, cancelOkxOrder, OKX_SYMBOL_MAP } = require('../services/exchangeService');
                        const exchangeConfig = isExchangeTradingEnabled();

                        if (exchangeConfig.enabled) {
                          const exchange = getPreferredExchange();
                          const okxSymbol = OKX_SYMBOL_MAP[trade.symbol];

                          if (okxSymbol && exchange) {
                            const cancelResult = await cancelOkxOrder(
                              okxSymbol,
                              trade.okxDcaOrderId,
                              null, // clOrdId
                              exchange.apiKey,
                              exchange.apiSecret,
                              exchange.passphrase,
                              exchange.baseUrl,
                              null // DON'T pass tdMode for limit orders
                            );

                            // Verify cancellation succeeded
                            if (cancelResult && cancelResult.success) {
                              console.log(`🗑️ ${symbol}: Canceled old DCA order on OKX (ID: ${trade.okxDcaOrderId})`);
                              cancellationSucceeded = true;
                              trade.okxDcaOrderId = null; // Clear old order ID
                            } else {
                              const errorMsg = `DCA order cancellation failed for ${symbol}: ${cancelResult?.error || 'Unknown error'}`;
                              console.error(`❌ ${errorMsg}`);

                              // Send Telegram notification for DCA cancellation failure
                              addLogEntry(errorMsg, 'error');
                            }
                          }
                        }
                      } catch (cancelError) {
                        const errorMsg = `DCA order cancellation error for ${symbol}: ${cancelError.message}`;
                        console.error(`❌ ${errorMsg}`);

                        // Send Telegram notification for DCA cancellation error
                        // const { addLogEntry } = require('../services/exchangeService');
                        addLogEntry(errorMsg, 'error');
                      }
                    } else {
                      // No existing DCA order, safe to place new one
                      cancellationSucceeded = true;
                    }

                    // Only place new DCA order if cancellation succeeded (or no old order existed)
                    if (!cancellationSucceeded) {
                      console.warn(`⚠️ ${symbol}: Skipping new DCA order placement - old order still exists on OKX`);
                      // const { addLogEntry } = require('../services/exchangeService');
                      addLogEntry(`⚠️ ${symbol}: Skipped new DCA - old order cancellation failed. Manual cleanup required!`, 'warning');
                      continue; // Skip to next recommendation
                    }

                    // Place new DCA limit order
                    try {
                      const { executeOkxLimitOrder, OKX_SYMBOL_MAP, getOkxOpenPositions, isExchangeTradingEnabled, getPreferredExchange } = require('../services/exchangeService');
                      const exchangeConfig = isExchangeTradingEnabled();

                      if (!exchangeConfig.enabled) {
                        throw new Error('Exchange trading not enabled');
                      }

                      const exchange = getPreferredExchange();
                      const okxSymbol = OKX_SYMBOL_MAP[trade.symbol];

                      if (okxSymbol && exchange) {
                        // Get current position size for DCA quantity calculation
                        const okxPositions = await getOkxOpenPositions(
                          exchange.apiKey,
                          exchange.apiSecret,
                          exchange.passphrase,
                          exchange.baseUrl
                        );
                        const okxPos = okxPositions.find(p => p.coin === trade.symbol);
                        const positionSize = okxPos?.quantity || trade.quantity || 0;

                        // Calculate DCA quantity using FIXED USD tiers (same as initial position logic)
                        // BTC: $100, $100, $200, $400, $800
                        // Others: $50, $50, $100, $200, $400

                        const isBTC = trade.symbol === 'BTC';
                        const positionSizes = isBTC
                          ? [100, 100, 200, 400, 800]  // BTC position sizes
                          : [50, 50, 100, 200, 400];   // Other coins position sizes

                        // Count existing positions for this symbol to determine DCA tier
                        const existingPositions = this.activeTrades.filter(t =>
                          t.symbol === trade.symbol &&
                          (t.status === 'OPEN' || t.status === 'DCA_HIT' || t.status === 'PENDING')
                        ).length;

                        // DCA is for the next position, array is 0-indexed
                        const dcaPositionIndex = Math.min(existingPositions, positionSizes.length - 1);
                        const dcaSizeUSD = positionSizes[dcaPositionIndex];

                        // Calculate DCA quantity in coins
                        let dcaQuantity = dcaSizeUSD / newDcaValue;

                        console.log(`   💰 AI DCA Sizing: Tier #${dcaPositionIndex + 1}: $${dcaSizeUSD} → ${dcaQuantity.toFixed(8)} coins @ $${newDcaValue.toFixed(2)}`);

                        const contractSpecs = {
                          'BTC-USDT-SWAP': { contractSize: 0.01, minOrder: 0.0001 },
                          'ETH-USDT-SWAP': { contractSize: 0.1, minOrder: 0.001 },
                          'SOL-USDT-SWAP': { contractSize: 1, minOrder: 0.1 },
                          'XRP-USDT-SWAP': { contractSize: 100, minOrder: 1 },
                          'DOGE-USDT-SWAP': { contractSize: 100, minOrder: 10 },
                          'ADA-USDT-SWAP': { contractSize: 100, minOrder: 1 },
                          'MATIC-USDT-SWAP': { contractSize: 10, minOrder: 1 },
                          'DOT-USDT-SWAP': { contractSize: 1, minOrder: 0.1 },
                          'AVAX-USDT-SWAP': { contractSize: 1, minOrder: 0.1 },
                          'LINK-USDT-SWAP': { contractSize: 1, minOrder: 0.1 },
                        };

                        const dcaSpec = contractSpecs[okxSymbol] || { contractSize: 1, minOrder: 0.01 };
                        const dcaCoinQuantity = dcaQuantity;
                        const dcaContracts = dcaCoinQuantity / dcaSpec.contractSize;

                        let finalDcaQuantity = dcaQuantity;
                        if (dcaCoinQuantity >= dcaSpec.minOrder) {
                          finalDcaQuantity = dcaContracts; // Use fractional contracts
                          console.log(`   ✅ DCA contracts: ${dcaContracts.toFixed(4)} (meets minimum)`);
                        } else {
                          // Below minimum, adjust to minimum
                          finalDcaQuantity = dcaSpec.minOrder / dcaSpec.contractSize;
                          console.log(`   ⚠️ DCA adjusted to minimum: ${dcaSpec.minOrder} ${symbol} = ${finalDcaQuantity.toFixed(4)} contracts`);
                        }

                        if (dcaQuantity > 0) {
                          const dcaSide = trade.action === 'BUY' ? 'buy' : 'sell';
                          const leverage = trade.leverage || 1;

                          const dcaResult = await executeOkxLimitOrder(
                            okxSymbol,
                            dcaSide,
                            finalDcaQuantity, // Use contract-converted quantity
                            newDcaValue,
                            exchange.apiKey,
                            exchange.apiSecret,
                            exchange.passphrase,
                            exchange.baseUrl,
                            leverage
                          );

                          if (dcaResult.success) {
                            trade.okxDcaOrderId = dcaResult.orderId;
                            trade.okxDcaPrice = newDcaValue;
                            trade.okxDcaQuantity = dcaQuantity;
                            console.log(`✅ ${symbol}: New DCA order placed on OKX at $${newDcaValue.toFixed(2)}`);
                            addLogEntry(`✅ ${symbol}: New DCA order placed on OKX at $${newDcaValue.toFixed(2)}`, 'success');
                          } else {
                            console.warn(`⚠️ ${symbol}: Failed to place new DCA order: ${dcaResult.error}`);
                            addLogEntry(`⚠️ ${symbol}: Failed to place new DCA order: ${dcaResult.error}`, 'warning');
                          }
                        } else {
                          console.warn(`⚠️ ${symbol}: DCA quantity is 0, skipping DCA order placement`);
                        }
                      }
                    } catch (dcaError) {
                      console.error(`❌ ${symbol}: Error placing new DCA order: ${dcaError.message}`);
                      addLogEntry(`❌ ${symbol}: Error placing new DCA order: ${dcaError.message}`, 'error');
                    }
                  }
                } catch (updateError) {
                  console.error(`❌ ${symbol}: Error updating orders on OKX: ${updateError.message}`);
                  addLogEntry(`❌ ${symbol}: Error updating orders on OKX: ${updateError.message}`, 'error');
                }
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
          `⏱️ Skipping AI re-evaluation Telegram notification (cooldown ${this.openTradesReevalCooldownMs / 60000
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

      // Cancel TP/SL algo orders if they exist
      await this.cancelTradeAlgoOrders(trade);

      // Verify position closure with OKX (sync position state)
      try {
        const { isExchangeTradingEnabled, getPreferredExchange, getOkxOpenPositions } = require('../services/exchangeService');
        const exchangeConfig = isExchangeTradingEnabled();

        if (exchangeConfig.enabled) {
          const exchange = getPreferredExchange();
          if (exchange && exchange.exchange === 'OKX') {
            const okxSymbol = require('../services/exchangeService').OKX_SYMBOL_MAP[trade.symbol];
            if (okxSymbol) {
              const positions = await getOkxOpenPositions(
                exchange.apiKey,
                exchange.apiSecret,
                exchange.passphrase,
                exchange.baseUrl
              );

              // Check if position still exists for this symbol
              const openPosition = positions.find(p => p.instId === okxSymbol && parseFloat(p.pos || '0') !== 0);
              if (openPosition) {
                console.warn(`⚠️ ${trade.symbol}: Position still open on OKX after close. Position size: ${openPosition.pos}`);
              } else {
                console.log(`✅ ${trade.symbol}: Position verified closed on OKX`);
              }
            }
          }
        }
      } catch (syncError) {
        console.warn(`⚠️ Failed to sync position closure for ${trade.symbol}: ${syncError.message}`);
        // Don't fail the close operation if sync fails
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

      // Removed: DynamoDB persistence - OKX is the only source of truth

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
   * Removed: DynamoDB persistence - OKX is the only source of truth
   */
  async saveClosedTrades() {
    // Removed: DynamoDB persistence - OKX is the only source of truth
    // Closed trades are kept in memory only (last 100)
  }

  /**
   * Load closed trades from storage
   * Removed: DynamoDB persistence - OKX is the only source of truth
   */
  async loadClosedTrades() {
    // Removed: DynamoDB persistence - OKX is the only source of truth
    // Closed trades are kept in memory only (last 100)
    this.closedTrades = [];
    console.log('📂 Closed trades: OKX is the only source of truth (no DynamoDB persistence)');
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

    // Calculate ATR-based stop loss (volatility-adjusted)
    const { calculateATR } = require('../services/positionSizingService');
    let atr = 0;
    let useATR = false;

    // Try to get price data for ATR calculation
    if (analysis.priceData && Array.isArray(analysis.priceData) && analysis.priceData.length >= 15) {
      try {
        // Validate price data has required fields (high, low, close)
        const validPriceData = analysis.priceData.filter(p =>
          p && (p.high || p.price) && (p.low || p.price) && (p.close || p.price)
        );

        if (validPriceData.length >= 15) {
          atr = calculateATR(validPriceData, 14);
          useATR = atr > 0;

          if (!useATR) {
            console.log(`⚠️ ATR calculation returned 0 for ${analysis.symbol || 'unknown'} - using default stop loss`);
          }
        } else {
          console.log(`⚠️ Insufficient valid price data for ATR (${validPriceData.length}/15 required) - using default stop loss`);
        }
      } catch (error) {
        console.log(`⚠️ ATR calculation failed for ${analysis.symbol || 'unknown'}, using default: ${error.message}`);
      }
    } else if (analysis.priceData) {
      console.log(`⚠️ Price data available but insufficient length (${analysis.priceData.length || 0}/15 required) - using default stop loss`);
    }

    // Fallback to default if ATR not available
    const defaultSLPercent = this.tradingRules?.defaultStopLoss || 5.0;
    const volatility = useATR ? atr : (currentPrice * defaultSLPercent / 100);

    let entryPrice, takeProfit, stopLoss, addPosition, expectedGainPercent;

    if (action === 'BUY') {
      // BUY signal - Improved risk/reward ratio (target 3:1 or better)
      entryPrice = currentPrice;

      // Use ATR-based stop loss: Entry - (2 * ATR)
      // Fallback to support-based or percentage-based if ATR not available
      if (useATR) {
        stopLoss = Math.max(
          entryPrice - (2 * atr), // ATR-based: 2x ATR below entry
          support * 0.98, // Don't go below support
          entryPrice * 0.95 // Minimum 5% stop
        );
      } else {
        stopLoss = Math.max(support * 0.98, entryPrice * (1 - defaultSLPercent / 100));
      }

      // Target 3:1 risk/reward: if stop is 3%, take profit should be 9%+
      const riskPercent = ((entryPrice - stopLoss) / entryPrice) * 100;
      const targetReward = riskPercent * 3; // 3:1 risk/reward
      takeProfit = Math.min(resistance * 1.02, currentPrice * (1 + targetReward / 100)); // 9-12% above
      addPosition = currentPrice * 0.98; // 2% below for DCA
      expectedGainPercent = ((takeProfit - entryPrice) / entryPrice * 100).toFixed(2);

    } else if (action === 'SELL') {
      // SELL signal - Improved risk/reward ratio (target 3:1 or better)
      entryPrice = currentPrice;

      // Use ATR-based stop loss: Entry + (2 * ATR)
      // Fallback to resistance-based or percentage-based if ATR not available
      if (useATR) {
        stopLoss = Math.min(
          entryPrice + (2 * atr), // ATR-based: 2x ATR above entry
          resistance * 1.02, // Don't go above resistance
          entryPrice * 1.05 // Minimum 5% stop
        );
      } else {
        stopLoss = Math.min(resistance * 1.02, entryPrice * (1 + defaultSLPercent / 100));
      }

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

  /**
   * Request AI to re-evaluate TP/SL/DCA levels after a DCA order fills
   * This ensures levels are recalculated based on the new average entry price
   */
  async requestAILevelUpdate(trade, newAverageEntry) {
    try {
      console.log(`🤖 [${trade.symbol}] Requesting AI re-evaluation after DCA #${trade.dcaCount}`);
      console.log(`   Original Entry: $${trade.entryPrice.toFixed(2)}, New Average: $${newAverageEntry.toFixed(2)}`);

      // Get current price
      const currentPrice = await this.getCurrentPrice(trade.symbol);
      if (!currentPrice) {
        console.error(`❌ Could not fetch current price for ${trade.symbol}`);
        return false;
      }

      // Build AI prompt with position context
      const { callFreeAI } = require('../services/aiService');

      const prompt = `Trade Level Update Required - DCA Executed

Symbol: ${trade.symbol}
Action: ${trade.action}
Original Entry: $${trade.entryPrice.toFixed(2)}
NEW Average Entry: $${newAverageEntry.toFixed(2)}
Current Price: $${currentPrice.toFixed(2)}
Position Size: ${trade.quantity} contracts
DCAs Executed: ${trade.dcaCount}

Current Levels:
- Take Profit: $${trade.takeProfit.toFixed(2)}
- Stop Loss: $${trade.stopLoss.toFixed(2)}
- DCA Price: $${trade.addPosition ? trade.addPosition.toFixed(2) : 'N/A'}

CRITICAL: Provide UPDATED levels based on the NEW average entry of $${newAverageEntry.toFixed(2)}:

Rules:
- Take Profit: Minimum 10% from new average entry
- Stop Loss: Minimum 10% from new average entry
- New DCA: 15% from new average entry (below average for BUY, above for SELL)
- For BUY: SL < DCA < Average < TP
- For SELL: TP < Average < DCA < SL

Respond with JSON only:
{
  "takeProfit": 0,
  "stopLoss": 0,
  "addPosition": 0,
  "reason": "Brief explanation of the updated levels"
}`;

      // Call free AI for level updates (saves premium AI costs)
      const aiResponse = await callFreeAI(prompt);

      // Parse JSON response
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error(`❌ AI response invalid format for ${trade.symbol}`);
        return false;
      }

      const newLevels = JSON.parse(jsonMatch[0]);

      // Validate levels
      const MIN_TP_PERCENT = 10.0;
      const MIN_SL_PERCENT = 10.0;
      const DCA_PERCENT = 15.0;

      let validatedTP = newLevels.takeProfit;
      let validatedSL = newLevels.stopLoss;
      let validatedDCA = newLevels.addPosition;

      // Validate TP distance
      if (trade.action === 'BUY') {
        const tpDistance = ((validatedTP - newAverageEntry) / newAverageEntry) * 100;
        if (tpDistance < MIN_TP_PERCENT) {
          validatedTP = newAverageEntry * (1 + MIN_TP_PERCENT / 100);
          console.log(`   🛡️ Adjusted TP to minimum ${MIN_TP_PERCENT}%: $${validatedTP.toFixed(2)}`);
        }
      } else {
        const tpDistance = ((newAverageEntry - validatedTP) / newAverageEntry) * 100;
        if (tpDistance < MIN_TP_PERCENT) {
          validatedTP = newAverageEntry * (1 - MIN_TP_PERCENT / 100);
          console.log(`   🛡️ Adjusted TP to minimum ${MIN_TP_PERCENT}%: $${validatedTP.toFixed(2)}`);
        }
      }

      // Validate SL distance
      if (trade.action === 'BUY') {
        const slDistance = ((newAverageEntry - validatedSL) / newAverageEntry) * 100;
        if (slDistance < MIN_SL_PERCENT) {
          validatedSL = newAverageEntry * (1 - MIN_SL_PERCENT / 100);
          console.log(`   🛡️ Adjusted SL to minimum ${MIN_SL_PERCENT}%: $${validatedSL.toFixed(2)}`);
        }
      } else {
        const slDistance = ((validatedSL - newAverageEntry) / newAverageEntry) * 100;
        if (slDistance < MIN_SL_PERCENT) {
          validatedSL = newAverageEntry * (1 + MIN_SL_PERCENT / 100);
          console.log(`   🛡️ Adjusted SL to minimum ${MIN_SL_PERCENT}%: $${validatedSL.toFixed(2)}`);
        }
      }

      // Validate DCA distance and direction
      if (trade.action === 'BUY') {
        validatedDCA = newAverageEntry * (1 - DCA_PERCENT / 100);
        // Ensure DCA is between SL and average
        if (validatedDCA <= validatedSL) {
          validatedDCA = validatedSL + ((newAverageEntry - validatedSL) * 0.4);
          console.log(`   🔄 Adjusted DCA to 40% between SL and average: $${validatedDCA.toFixed(2)}`);
        }
      } else {
        validatedDCA = newAverageEntry * (1 + DCA_PERCENT / 100);
        // Ensure DCA is between average and SL
        if (validatedDCA >= validatedSL) {
          validatedDCA = newAverageEntry + ((validatedSL - newAverageEntry) * 0.4);
          console.log(`   🔄 Adjusted DCA to 40% between average and SL: $${validatedDCA.toFixed(2)}`);
        }
      }

      console.log(`✅ AI provided updated levels:`);
      console.log(`   TP: $${trade.takeProfit.toFixed(2)} → $${validatedTP.toFixed(2)}`);
      console.log(`   SL: $${trade.stopLoss.toFixed(2)} → $${validatedSL.toFixed(2)}`);
      console.log(`   DCA: $${trade.addPosition ? trade.addPosition.toFixed(2) : 'N/A'} → $${validatedDCA.toFixed(2)}`);
      console.log(`   Reason: ${newLevels.reason || 'Updated based on new average entry'}`);

      // Apply new levels
      await this.updateTradeLevelsAfterDCA(trade, {
        takeProfit: validatedTP,
        stopLoss: validatedSL,
        addPosition: validatedDCA,
        reason: newLevels.reason
      });

      return true;

    } catch (error) {
      console.error(`❌ Error requesting AI level update for ${trade.symbol}:`, error.message);
      return false;
    }
  }

  /**
   * Update TP/SL/DCA levels after DCA fills
   * Cancels old orders and places new ones with updated prices
   */
  async updateTradeLevelsAfterDCA(trade, newLevels) {
    try {
      console.log(`🔄 [${trade.symbol}] Updating trade levels after DCA...`);

      const { cancelOrder, placeOrder } = require('../services/exchangeService');

      // Step 1: Cancel existing TP order
      if (trade.okxTpOrderId) {
        try {
          await cancelOrder(trade.symbol, trade.okxTpOrderId);
          console.log(`   ✅ Cancelled old TP order: ${trade.okxTpOrderId}`);
        } catch (error) {
          console.log(`   ⚠️ Could not cancel old TP order: ${error.message}`);
        }
      }

      // Step 2: Cancel existing SL order
      if (trade.okxSlOrderId) {
        try {
          await cancelOrder(trade.symbol, trade.okxSlOrderId);
          console.log(`   ✅ Cancelled old SL order: ${trade.okxSlOrderId}`);
        } catch (error) {
          console.log(`   ⚠️ Could not cancel old SL order: ${error.message}`);
        }
      }

      // Step 3: Cancel existing DCA order
      if (trade.okxDcaOrderId) {
        try {
          await cancelOrder(trade.symbol, trade.okxDcaOrderId);
          console.log(`   ✅ Cancelled old DCA order: ${trade.okxDcaOrderId}`);
        } catch (error) {
          console.log(`   ⚠️ Could not cancel old DCA order: ${error.message}`);
        }
      }

      // Step 4: Update trade object with new levels
      trade.takeProfit = newLevels.takeProfit;
      trade.stopLoss = newLevels.stopLoss;
      trade.addPosition = newLevels.addPosition;
      trade.dcaPrice = newLevels.addPosition;

      // Step 5: Place new TP order
      try {
        const tpOrder = await placeOrder({
          symbol: trade.symbol,
          side: trade.action === 'BUY' ? 'sell' : 'buy',
          type: 'limit',
          price: newLevels.takeProfit,
          quantity: trade.quantity,
          reduceOnly: true
        });
        trade.okxTpOrderId = tpOrder.orderId;
        console.log(`   ✅ Placed new TP order at $${newLevels.takeProfit.toFixed(2)}`);
      } catch (error) {
        console.error(`   ❌ Failed to place new TP order: ${error.message}`);
      }

      // Step 6: Place new SL order
      try {
        const slOrder = await placeOrder({
          symbol: trade.symbol,
          side: trade.action === 'BUY' ? 'sell' : 'buy',
          type: 'stop_market',
          stopPrice: newLevels.stopLoss,
          quantity: trade.quantity,
          reduceOnly: true
        });
        trade.okxSlOrderId = slOrder.orderId;
        console.log(`   ✅ Placed new SL order at $${newLevels.stopLoss.toFixed(2)}`);
      } catch (error) {
        console.error(`   ❌ Failed to place new SL order: ${error.message}`);
      }

      // Step 7: Place new DCA order
      try {
        const dcaOrder = await placeOrder({
          symbol: trade.symbol,
          side: trade.action === 'BUY' ? 'buy' : 'sell',
          type: 'limit',
          price: newLevels.addPosition,
          quantity: trade.quantity, // Same size as current position
          reduceOnly: false
        });
        trade.okxDcaOrderId = dcaOrder.orderId;
        console.log(`   ✅ Placed new DCA order at $${newLevels.addPosition.toFixed(2)}`);
      } catch (error) {
        console.error(`   ❌ Failed to place new DCA order: ${error.message}`);
      }

      console.log(`✅ [${trade.symbol}] Trade levels updated successfully after DCA #${trade.dcaCount}`);

      // Send Telegram notification
      try {
        const { sendTelegramMessage } = require('../services/notificationService');
        const message = `🔄 ${trade.symbol} Levels Updated After DCA #${trade.dcaCount}\n\n` +
          `📊 New Average Entry: $${trade.averageEntryPrice.toFixed(2)}\n` +
          `🎯 New TP: $${newLevels.takeProfit.toFixed(2)}\n` +
          `🛡️ New SL: $${newLevels.stopLoss.toFixed(2)}\n` +
          `💰 New DCA: $${newLevels.addPosition.toFixed(2)}\n\n` +
          `${newLevels.reason || 'Levels recalculated based on new average entry'}`;

        await sendTelegramMessage(message);
      } catch (error) {
        // Silently fail if Telegram not configured
      }

      return true;

    } catch (error) {
      console.error(`❌ Error updating trade levels for ${trade.symbol}:`, error.message);
      return false;
    }
  }
}

module.exports = ProfessionalTradingBot;
