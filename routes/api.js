const express = require('express');
const router = express.Router();
const axios = require('axios');

// In-memory log store (for real-time activity display)
let activityLogs = [];
let logIdCounter = 0;
const MAX_LOGS = 1000; // Keep last 1000 log entries

// Function to add log entry (can be called from bot)
function addLogEntry(message, level = 'info') {
  const logEntry = {
    id: ++logIdCounter,
    timestamp: new Date().toISOString(),
    message: message,
    level: level
  };

  activityLogs.push(logEntry);

  // Keep only last MAX_LOGS entries
  if (activityLogs.length > MAX_LOGS) {
    activityLogs = activityLogs.slice(-MAX_LOGS);
  }

  return logEntry;
}

// Import shared monitoring store (ensures same instance everywhere)
const { getMonitoringData, addMonitoringActivity, setMonitoringActive } = require('../services/monitoringStore');

// Export for use in bot (before module.exports = router)
// These will be attached to the router export

// Health check endpoint (for Render deployment)
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Diagnostics endpoint
router.get('/diagnostics', async (req, res) => {
  const config = require('../config/config');

  const diagnostics = {
    timestamp: new Date().toISOString(),
    environment: {
      API_KEY: !!process.env.API_KEY,
      AI_API_KEY: !!process.env.AI_API_KEY,
      OPENROUTER_API_KEY: !!process.env.OPENROUTER_API_KEY,
      TELEGRAM_BOT_TOKEN: !!process.env.TELEGRAM_BOT_TOKEN,
      TELEGRAM_CHAT_ID: !!process.env.TELEGRAM_CHAT_ID,
      ALLOW_MOCK_NOTIFICATIONS: process.env.ALLOW_MOCK_NOTIFICATIONS || 'false'
    },
    config: {
      AI_API_KEY_PRESENT: !!config.AI_API_KEY,
      AI_API_KEY_LENGTH: config.AI_API_KEY ? config.AI_API_KEY.length : 0,
      AI_MODEL: config.AI_MODEL,
      TELEGRAM_ENABLED: config.TELEGRAM_ENABLED,
      ALLOW_MOCK_NOTIFICATIONS: config.ALLOW_MOCK_NOTIFICATIONS
    },
    tests: {}
  };

  // Test AI API
  if (config.AI_API_KEY) {
    try {
      const aiResponse = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
        model: config.AI_MODEL,
        messages: [{ role: 'user', content: 'Say "test successful"' }],
        max_tokens: 20,
        temperature: 0.1,
      }, {
        headers: {
          Authorization: `Bearer ${config.AI_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://my-deepseek-bot-1.onrender.com',
          'X-Title': 'Technical Analysis Bot',
        },
        timeout: 10000,
      });

      diagnostics.tests.ai = {
        status: 'success',
        responseStatus: aiResponse.status,
        message: 'AI API is working correctly'
      };
    } catch (error) {
      diagnostics.tests.ai = {
        status: 'failed',
        error: error.message,
        responseStatus: error.response?.status,
        responseData: error.response?.data ? JSON.stringify(error.response.data).substring(0, 200) : null
      };
    }
  } else {
    diagnostics.tests.ai = {
      status: 'skipped',
      message: 'AI_API_KEY not configured'
    };
  }

  // Test Telegram
  if (config.TELEGRAM_ENABLED) {
    try {
      const telegramUrl = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/getMe`;
      const telegramResponse = await axios.get(telegramUrl, { timeout: 5000 });

      diagnostics.tests.telegram = {
        status: 'success',
        botUsername: telegramResponse.data.result?.username,
        message: 'Telegram bot is configured correctly'
      };
    } catch (error) {
      diagnostics.tests.telegram = {
        status: 'failed',
        error: error.message,
        responseStatus: error.response?.status
      };
    }
  } else {
    diagnostics.tests.telegram = {
      status: 'skipped',
      message: 'Telegram credentials not configured'
    };
  }

  res.json(diagnostics);
});

// API routes
router.post('/start-scan', async (req, res) => {
  try {
    const { tradingBot } = req.app.locals;
    const result = await tradingBot.startAutoScan();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/stop-scan', (req, res) => {
  try {
    const { tradingBot } = req.app.locals;
    const result = tradingBot.stopAutoScan();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/scan-now', async (req, res) => {
  try {
    const { tradingBot } = req.app.locals;
    const options = req.body || {};
    const result = await tradingBot.performTechnicalScan(options);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/test-telegram', async (req, res) => {
  try {
    const { tradingBot } = req.app.locals;
    const config = require('../config/config');

    // Check if Telegram is configured
    if (!config.TELEGRAM_ENABLED) {
      return res.json({
        success: false,
        message: 'Telegram is not configured. Please set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID environment variables.',
        configStatus: {
          hasBotToken: Boolean(config.TELEGRAM_BOT_TOKEN),
          hasChatId: Boolean(config.TELEGRAM_CHAT_ID),
          bothConfigured: config.TELEGRAM_ENABLED
        }
      });
    }

    const result = await tradingBot.sendTestNotification();
    res.json(result);
  } catch (error) {
    console.error('Telegram test error:', error);
    res.status(500).json({
      success: false,
      message: `Error testing Telegram: ${error.message}`,
    });
  }
});

// Trigger news filter job manually
router.post('/trigger-news-filter', async (req, res) => {
  try {
    const newsFilterJob = require('../jobs/newsFilterJob');

    // Check if feature is enabled
    if (process.env.NEWS_FILTER_ENABLED !== 'true') {
      return res.json({
        success: false,
        message: 'News filter is disabled. Set NEWS_FILTER_ENABLED=true to enable.',
        enabled: false
      });
    }

    // Trigger the filter job
    console.log('🔄 Manual news filter trigger requested via API');
    await newsFilterJob.filterNews();

    res.json({
      success: true,
      message: 'News filter job completed successfully. Check logs for details.',
      enabled: true
    });
  } catch (error) {
    console.error('News filter error:', error);
    res.status(500).json({
      success: false,
      message: `Error running news filter: ${error.message}`,
    });
  }
});

// Add a new endpoint to check Telegram configuration
router.get('/telegram-status', (req, res) => {
  const config = require('../config/config');
  res.json({
    telegramEnabled: config.TELEGRAM_ENABLED,
    hasBotToken: Boolean(config.TELEGRAM_BOT_TOKEN),
    hasChatId: Boolean(config.TELEGRAM_CHAT_ID),
    botTokenPreview: config.TELEGRAM_BOT_TOKEN ?
      `${config.TELEGRAM_BOT_TOKEN.substring(0, 10)}...` : 'Not set',
    chatId: config.TELEGRAM_CHAT_ID || 'Not set',
    environment: process.env.NODE_ENV || 'development'
  });
});

router.get('/live-analysis', (req, res) => {
  try {
    const { tradingBot } = req.app.locals;
    const liveAnalysis = tradingBot.getLiveAnalysis();
    const batchAIResults = tradingBot.getBatchAIResults();
    res.json({
      ...liveAnalysis,
      batchAI: batchAIResults,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/scan-history', (req, res) => {
  try {
    const { tradingBot } = req.app.locals;
    const history = tradingBot.getScanHistory();
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/auto-scan-settings', (req, res) => {
  try {
    const { tradingBot } = req.app.locals;
    const { interval } = req.body || {};

    if (!interval) {
      return res.status(400).json({
        success: false,
        message: 'Interval is required',
      });
    }

    tradingBot.setAutoScanInterval(interval);
    res.json({
      success: true,
      interval,
      humanReadable: interval,
      running: tradingBot.isRunning,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
});

router.get('/scan-progress', (req, res) => {
  try {
    const { tradingBot } = req.app.locals;
    res.json(tradingBot.getScanProgress());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/global-metrics', async (req, res) => {
  try {
    const { tradingBot } = req.app.locals;
    const metrics = await tradingBot.fetchGlobalMetrics();
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/bot-status', (req, res) => {
  try {
    const { tradingBot } = req.app.locals;
    const config = require('../config/config');

    // Use the actual scheduled next scan time if available (prevents reset on page refresh)
    let nextScan = null;
    if (tradingBot.isRunning) {
      if (tradingBot.nextScanTime) {
        // Use the stored scheduled time (most accurate - doesn't reset on refresh)
        nextScan = tradingBot.nextScanTime;
      } else if (tradingBot.scanIntervalMs) {
        // Fallback: calculate from last scan time (only if nextScanTime not set)
        const lastScanTime = tradingBot.stats.lastScanTime;
        if (lastScanTime) {
          nextScan = new Date(lastScanTime + tradingBot.scanIntervalMs);
          // If next scan is in the past, calculate from now
          if (nextScan < new Date()) {
            nextScan = new Date(Date.now() + tradingBot.scanIntervalMs);
          }
        } else {
          // No scan has run yet, next scan is interval from now
          nextScan = new Date(Date.now() + tradingBot.scanIntervalMs);
        }
      }
    }

    res.json({
      running: tradingBot.isRunning,
      coinsTracked: tradingBot.trackedCoins.length,
      strategy: 'RSI + Bollinger Bands + Support/Resistance + Momentum + AI overlay',
      interval: tradingBot.selectedIntervalKey,
      minConfidence: tradingBot.minConfidence,
      stats: tradingBot.getStats(),
      batchAI: tradingBot.getBatchAIResults(), // Include batch AI results for coins analyzed count
      analysisEngine: 'JavaScript',
      telegramEnabled: config.TELEGRAM_ENABLED,
      newsEnabled: config.NEWS_ENABLED,
      coinmarketcapEnabled: config.COINMARKETCAP_ENABLED,
      coinpaprikaEnabled: config.COINPAPRIKA_ENABLED,
      lastUpdate: new Date(),
      nextScan: nextScan, // Include next scan time
      scanIntervalMs: tradingBot.scanIntervalMs,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add environment check endpoint
router.get('/environment', (req, res) => {
  res.json({
    nodeVersion: process.version,
    environment: process.env.NODE_ENV || 'development',
    port: process.env.PORT,
    // Don't expose actual tokens, just show if they're set
    telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
    coinmarketcapConfigured: Boolean(process.env.COINMARKETCAP_API_KEY),
    cryptopanicConfigured: Boolean(process.env.CRYPTOPANIC_API_KEY),
    aiConfigured: Boolean(process.env.API_KEY)
  });
});

router.get('/trading-rules', (req, res) => {
  try {
    const { tradingBot } = req.app.locals;
    const rules = tradingBot.getTradingRules();
    res.json(rules);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/trading-rules', (req, res) => {
  try {
    const { tradingBot } = req.app.locals;
    const newRules = req.body;
    const updatedRules = tradingBot.setTradingRules(newRules);
    res.json({
      success: true,
      message: 'Trading rules updated successfully',
      rules: updatedRules
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Logs endpoint for real-time activity display
router.get('/logs', (req, res) => {
  try {
    const sinceId = parseInt(req.query.since || 0);
    const logs = activityLogs.filter(log => log.id > sinceId);
    res.json({
      logs: logs,
      total: activityLogs.length,
      lastId: logIdCounter
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Active trades endpoint
// NOTE: OKX is the source of truth for positions. Trade data is kept in memory only for trigger monitoring (DCA, SL, TP proximity).
router.get('/active-trades', (req, res) => {
  try {
    // Return empty array - OKX is source of truth, trade data kept only for triggers
    res.json([]);
    // Original code kept for reference:
    // const { tradingBot } = req.app.locals;
    // const activeTrades = tradingBot.getActiveTrades();
    // res.json(activeTrades);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Closed trades endpoint
router.get('/closed-trades', (req, res) => {
  try {
    const { tradingBot } = req.app.locals;
    const closedTrades = tradingBot.getClosedTrades();
    res.json(closedTrades);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Portfolio stats endpoint
// NOTE: OKX is the source of truth for balance and positions. Portfolio data is kept only for trigger monitoring.
router.get('/portfolio', (req, res) => {
  try {
    // Return empty/minimal data - OKX is source of truth
    res.json({
      message: 'OKX is the source of truth for balance and positions. Check OKX dashboard for accurate data.',
      source: 'OKX',
      note: 'Portfolio data kept in memory only for trigger monitoring (DCA, SL, TP proximity detection)'
    });
    // Original code kept for reference:
    // const { getPortfolioStats } = require('../services/portfolioService');
    // const portfolio = getPortfolioStats();
    // res.json(portfolio);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Trade Monitoring Service Endpoints
// Get trade monitoring settings
router.get('/trade-monitoring/settings', (req, res) => {
  try {
    // Lazy load to avoid startup issues
    const tradeMonitoringService = require('../services/tradeMonitoringService');
    const settings = tradeMonitoringService.getSettings();
    res.json(settings);
  } catch (error) {
    console.error('Error getting trade monitoring settings:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update proximity threshold
router.post('/trade-monitoring/proximity', (req, res) => {
  try {
    const { threshold } = req.body;
    if (!threshold || isNaN(threshold)) {
      return res.status(400).json({ error: 'Invalid threshold value' });
    }

    // Lazy load to avoid startup issues
    const tradeMonitoringService = require('../services/tradeMonitoringService');
    const newThreshold = tradeMonitoringService.updateProximityThreshold(parseFloat(threshold));
    res.json({
      success: true,
      proximityThreshold: newThreshold,
      message: `Proximity threshold updated to ${newThreshold}%`
    });
  } catch (error) {
    console.error('Error updating proximity threshold:', error);
    res.status(500).json({ error: error.message });
  }
});

// Exchange trading status endpoint
router.get('/exchange-status', (req, res) => {
  try {
    const { isExchangeTradingEnabled, getPreferredExchange } = require('../services/exchangeService');
    const status = isExchangeTradingEnabled();
    const exchange = getPreferredExchange();

    let message = '';
    if (status.mode === 'BYBIT_DEMO') {
      message = `✅ Bybit Demo Trading ENABLED - Orders execute on Bybit testnet (risk-free demo funds)`;
    } else if (status.mode === 'BYBIT_MAINNET') {
      message = `⚠️ Bybit Mainnet Trading ENABLED - Orders execute on Bybit with REAL MONEY`;
    } else {
      message = `❌ Trading DISABLED - Configure BYBIT_API_KEY and BYBIT_API_SECRET for demo trading`;
    }

    res.json({
      ...status,
      exchange: exchange.exchange,
      baseUrl: exchange.baseUrl,
      testnet: exchange.testnet,
      message: message
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Test OKX Connection endpoint
router.get('/test-okx-connection', async (req, res) => {
  try {
    const { isExchangeTradingEnabled, getPreferredExchange, getOkxBalance, getOkxOpenPositions } = require('../services/exchangeService');
    const status = isExchangeTradingEnabled();

    if (!status.enabled) {
      return res.json({
        success: false,
        error: 'OKX is not configured',
        message: 'Please set OKX_API_KEY, OKX_API_SECRET, and OKX_PASSPHRASE in your environment variables'
      });
    }

    const exchange = getPreferredExchange();
    const results = {
      success: true,
      config: {
        enabled: status.enabled,
        mode: status.mode,
        exchange: exchange.exchange,
        baseUrl: exchange.baseUrl,
        testnet: exchange.testnet
      },
      tests: {}
    };

    // Test 1: Balance retrieval
    try {
      const balance = await getOkxBalance('USDT', exchange.apiKey, exchange.apiSecret, exchange.passphrase, exchange.baseUrl);
      results.tests.balance = {
        success: true,
        usdtBalance: balance,
        message: balance > 0 ? `Balance: ${balance} USDT` : 'Balance: 0 USDT (normal for fresh demo account)'
      };
    } catch (error) {
      results.tests.balance = {
        success: false,
        error: error.message,
        details: error.response?.data || null
      };
    }

    // Test 2: Positions retrieval
    try {
      const positions = await getOkxOpenPositions(exchange.apiKey, exchange.apiSecret, exchange.passphrase, exchange.baseUrl);
      results.tests.positions = {
        success: true,
        count: positions.length,
        positions: positions,
        message: `Found ${positions.length} open position(s)`
      };
    } catch (error) {
      results.tests.positions = {
        success: false,
        error: error.message,
        details: error.response?.data || null
      };
    }

    // Overall success if config is enabled (balance/positions may fail due to API issues)
    results.overallSuccess = status.enabled && (
      results.tests.balance.success ||
      results.tests.positions.success ||
      (results.tests.balance.error && !results.tests.balance.error.includes('403'))
    );

    res.json(results);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Test OKX Account Mode endpoint
router.get('/test-okx-account-mode', async (req, res) => {
  try {
    const { getPreferredExchange, verifyOkxAccountMode } = require('../services/exchangeService');
    const exchange = getPreferredExchange();

    if (exchange.exchange !== 'OKX') {
      return res.json({
        success: false,
        error: 'OKX is not configured',
        message: 'Please set OKX_API_KEY, OKX_API_SECRET, and OKX_PASSPHRASE in your environment variables'
      });
    }

    const result = await verifyOkxAccountMode(
      exchange.apiKey,
      exchange.apiSecret,
      exchange.passphrase,
      exchange.baseUrl
    );

    res.json({
      ...result,
      config: {
        exchange: exchange.exchange,
        baseUrl: exchange.baseUrl,
        testnet: exchange.testnet
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// AI Trade Re-evaluation endpoint
router.post('/evaluate-trades', async (req, res) => {
  try {
    const { tradingBot } = req.app.locals;

    if (!tradingBot) {
      return res.status(500).json({
        success: false,
        error: 'Trading bot not initialized'
      });
    }

    const openTrades = tradingBot.getActiveTrades();

    if (!openTrades || openTrades.length === 0) {
      return res.json({
        success: false,
        error: 'No open trades to evaluate',
        message: 'No active trades found'
      });
    }

    // Trigger AI re-evaluation (this will send to Telegram)
    const recommendations = await tradingBot.reevaluateOpenTradesWithAI();

    res.json({
      success: true,
      message: `Re-evaluated ${openTrades.length} trade(s). Results sent to Telegram.`,
      recommendations: recommendations || []
    });
  } catch (error) {
    console.error('Evaluation error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to evaluate trades'
    });
  }
});

// Performance Analytics endpoint
router.get('/analytics', (req, res) => {
  try {
    const { tradingBot } = req.app.locals;
    const { getPerformanceAnalytics } = require('../services/analyticsService');

    if (!tradingBot) {
      return res.status(500).json({ error: 'Trading bot not initialized' });
    }

    const closedTrades = tradingBot.getClosedTrades() || [];
    const activeTrades = tradingBot.activeTrades || [];

    const analytics = getPerformanceAnalytics(closedTrades, activeTrades);
    res.json(analytics);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Market Regime endpoint
router.get('/market-regime', async (req, res) => {
  try {
    const { tradingBot } = req.app.locals;
    const { detectMarketRegime } = require('../services/marketRegimeService');

    if (!tradingBot) {
      return res.status(500).json({ error: 'Trading bot not initialized' });
    }

    // Get current coin data from last scan
    const lastScan = tradingBot.analysisHistory?.[0];
    if (!lastScan || !lastScan.details) {
      return res.json({ regimes: {}, message: 'No recent scan data available' });
    }

    // Simplified - would need full price data for accurate detection
    res.json({
      regimes: {},
      message: 'Market regime detection requires price data from recent scan',
      note: 'This feature will be enhanced with real-time price data'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Portfolio Rebalancing endpoints
router.get('/rebalancing', (req, res) => {
  try {
    const { tradingBot } = req.app.locals;
    const { getRebalancingStrategy } = require('../services/rebalancingService');

    if (!tradingBot) {
      return res.status(500).json({ error: 'Trading bot not initialized' });
    }

    const activeTrades = tradingBot.activeTrades || [];
    const targetAllocation = req.query.targets ? JSON.parse(req.query.targets) : {};
    const deviationThreshold = parseFloat(req.query.deviation || '5');

    const strategy = getRebalancingStrategy(activeTrades, targetAllocation, {
      deviationThreshold,
      maxPositions: 10,
      minPositionSize: 50
    });

    res.json(strategy);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/rebalancing/execute', async (req, res) => {
  try {
    const { tradingBot } = req.app.locals;
    const { getRebalancingStrategy } = require('../services/rebalancingService');
    const { executeMarketOrder } = require('../services/exchangeService');

    if (!tradingBot) {
      return res.status(500).json({ error: 'Trading bot not initialized' });
    }

    const { targetAllocation, deviationThreshold = 5, dryRun = false } = req.body;
    const activeTrades = tradingBot.activeTrades || [];

    const strategy = getRebalancingStrategy(activeTrades, targetAllocation || {}, {
      deviationThreshold,
      maxPositions: 10,
      minPositionSize: 50
    });

    if (!strategy.needsRebalancing) {
      return res.json({
        success: true,
        message: 'Portfolio is already balanced',
        actions: []
      });
    }

    if (dryRun) {
      return res.json({
        success: true,
        dryRun: true,
        actions: strategy.actions,
        message: 'Dry run - no trades executed'
      });
    }

    // Execute rebalancing actions
    const executedActions = [];
    for (const action of strategy.actions) {
      try {
        // This would execute actual trades - simplified for now
        executedActions.push({
          ...action,
          status: 'pending',
          message: 'Rebalancing execution requires exchange API integration'
        });
      } catch (error) {
        executedActions.push({
          ...action,
          status: 'failed',
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      actions: executedActions,
      message: `Rebalancing initiated for ${executedActions.length} positions`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API endpoint for monitoring activity
router.get('/monitoring-activity', (req, res) => {
  const data = getMonitoringData();
  // Only log when monitoring becomes active or has activities (reduce log noise)
  if (data.isActive && data.activity.length > 0) {
    console.log(`📊 Monitoring: ${data.activity.length} coins monitored`);
  }
  res.json(data);
});

// API endpoint for active triggers (algorithmic mode)
router.get('/active-triggers', (req, res) => {
  try {
    const monitoringService = require('../services/monitoringService');
    const triggers = monitoringService.getActiveTriggers();
    // Only log when there are active triggers (reduce log noise)
    if (triggers.length > 0) {
      console.log(`🔔 Active Triggers: ${triggers.length}`);
    }
    res.json(triggers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Backtesting endpoint
router.post('/backtest', async (req, res) => {
  try {
    const { coin, strategy } = req.body;
    const { quickBacktest } = require('../services/backtestService');

    if (!coin || !strategy) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: coin and strategy'
      });
    }

    // Run quick backtest (5 years, sampled)
    const result = await quickBacktest(coin, strategy);

    res.json(result);
  } catch (error) {
    console.error('Backtest error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// API endpoint to get trigger settings
router.get('/trigger-settings', (req, res) => {
  try {
    const monitoringService = require('../services/monitoringService');
    const settings = monitoringService.getTriggerSettings();
    res.json(settings);
  } catch (error) {
    console.error('❌ Error fetching trigger settings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API endpoint to save trigger settings
router.post('/trigger-settings', (req, res) => {
  try {
    const monitoringService = require('../services/monitoringService');
    monitoringService.saveTriggerSettings(req.body);
    res.json({ success: true, message: 'Settings saved successfully' });
  } catch (error) {
    console.error('❌ Error saving trigger settings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Performance Analytics Endpoints
router.get('/performance-report', async (req, res) => {
  try {
    const { generatePerformanceReport, calculatePerformanceScore, getImprovementRecommendations } = require('../services/performanceAnalyticsService');
    const { loadClosedTrades } = require('../services/tradePersistenceService');
    const { getPortfolioStats } = require('../services/portfolioService');

    const closedTrades = await loadClosedTrades();
    const portfolio = await getPortfolioStats();
    const accountBalance = portfolio.totalValue || 1000;

    const report = generatePerformanceReport(closedTrades, accountBalance);
    const score = calculatePerformanceScore(report.overview);
    const recommendations = getImprovementRecommendations(report.overview);

    res.json({
      ...report,
      performanceScore: score,
      recommendations: recommendations
    });
  } catch (error) {
    console.error('Error generating performance report:', error);
    res.status(500).json({ error: error.message });
  }
});

// Market Regime Detection Endpoint
router.get('/market-regime', async (req, res) => {
  try {
    const { detectMarketRegime } = require('../services/marketRegimeService');
    const { fetchHistoricalData, fetchGlobalMetrics } = require('../services/dataFetcher');

    const symbol = req.query.symbol || 'BTC';
    const coin = { symbol: symbol, id: 'bitcoin', name: 'Bitcoin' };

    const priceHistory = await fetchHistoricalData(coin, 30);
    const globalMetrics = await fetchGlobalMetrics();

    const regime = detectMarketRegime(priceHistory, globalMetrics);

    res.json(regime);
  } catch (error) {
    console.error('Error detecting market regime:', error);
    res.status(500).json({ error: error.message });
  }
});

// Sentiment Analysis Endpoint
router.post('/sentiment-analysis', async (req, res) => {
  try {
    const { analyzeNewsSentiment } = require('../services/sentimentService');
    const { articles } = req.body;

    if (!articles || !Array.isArray(articles)) {
      return res.status(400).json({ error: 'Articles array required' });
    }

    const sentiment = analyzeNewsSentiment(articles);
    res.json(sentiment);
  } catch (error) {
    console.error('Error analyzing sentiment:', error);
    res.status(500).json({ error: error.message });
  }
});

// Strategy Management Endpoints
router.get('/strategies', (req, res) => {
  try {
    const strategyManager = require('../strategies/strategyManager');
    const strategies = strategyManager.listStrategies();
    res.json(strategies);
  } catch (error) {
    console.error('Error listing strategies:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/strategies/set-active', (req, res) => {
  try {
    const strategyManager = require('../strategies/strategyManager');
    const { strategyId } = req.body;

    if (!strategyId) {
      return res.status(400).json({ error: 'Strategy ID required' });
    }

    const success = strategyManager.setActiveStrategy(strategyId);

    if (success) {
      res.json({
        success: true,
        message: `Active strategy set to ${strategyId}`,
        activeStrategy: strategyManager.getActiveStrategy().name
      });
    } else {
      res.status(404).json({ error: 'Strategy not found' });
    }
  } catch (error) {
    console.error('Error setting active strategy:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/strategies/toggle', (req, res) => {
  try {
    const strategyManager = require('../strategies/strategyManager');
    const { strategyId, enabled } = req.body;

    if (!strategyId) {
      return res.status(400).json({ error: 'Strategy ID required' });
    }

    const success = strategyManager.setStrategyEnabled(strategyId, enabled);

    if (success) {
      res.json({
        success: true,
        message: `Strategy ${strategyId} ${enabled ? 'enabled' : 'disabled'}`
      });
    } else {
      res.status(404).json({ error: 'Strategy not found' });
    }
  } catch (error) {
    console.error('Error toggling strategy:', error);
    res.status(500).json({ error: error.message });
  }
});

// Risk Management Validation Endpoint
router.post('/validate-trade', (req, res) => {
  try {
    const { validateTradeSetup, calculateOptimalPositionSize } = require('../utils/riskManagement');
    const { getPortfolioStats } = require('../services/portfolioService');

    const trade = req.body;

    // Validate trade setup
    const validation = validateTradeSetup(trade);

    // Calculate optimal position size
    const portfolio = getPortfolioStats();
    const positionSizing = calculateOptimalPositionSize({
      accountBalance: portfolio.totalValue || 1000,
      entryPrice: trade.entryPrice,
      stopLoss: trade.stopLoss,
      volatility: trade.volatility || 0,
      openTradesCount: portfolio.openTradesCount || 0,
      totalExposure: portfolio.exposure || 0
    });

    res.json({
      validation: validation,
      positionSizing: positionSizing
    });
  } catch (error) {
    console.error('Error validating trade:', error);
    res.status(500).json({ error: error.message });
  }
});

// Pattern Scanner endpoint
router.post('/scanner/run', async (req, res) => {
  try {
    const { symbol, timeframe } = req.body;

    if (!symbol || !timeframe) {
      return res.status(400).json({
        success: false,
        error: 'Symbol and timeframe are required'
      });
    }

    console.log(`📊 Running pattern scanner for ${symbol} (${timeframe})...`);

    // Import services
    const { fetchMexcCandlesBatch } = require('../services/mexcDataService');
    const { findSupportResistance, addVolumeConfirmation, checkProximity } = require('../utils/patternDetector');

    // Symbol mapping for rebranded/different naming on MEXC
    const symbolMap = {
      'MATIC': 'POL',  // Polygon rebranded from MATIC to POL
      // Add more mappings as needed
    };

    // Apply symbol mapping if exists
    const mappedSymbol = symbolMap[symbol] || symbol;
    const mexcSymbol = `${mappedSymbol}USDT`; // Convert BTC -> BTCUSDT

    console.log(`   Symbol mapping: ${symbol} -> ${mappedSymbol} -> ${mexcSymbol}`);

    // Fetch 2000 candles from MEXC with error handling
    let candles;
    try {
      candles = await fetchMexcCandlesBatch(mexcSymbol, timeframe, 2000);
    } catch (fetchError) {
      console.error(`❌ Error fetching candles for ${mexcSymbol}:`, fetchError.message);
      return res.json({
        success: false,
        error: `Symbol ${mexcSymbol} not available on MEXC or API error: ${fetchError.message}`,
        symbol,
        timeframe,
        suggestion: 'Try a different symbol or timeframe'
      });
    }

    if (!candles || candles.length === 0) {
      return res.json({
        success: false,
        error: `No candle data available for ${mexcSymbol}`,
        symbol,
        timeframe,
        suggestion: 'This symbol may not be supported on MEXC'
      });
    }

    // Detect support/resistance using multiple methods
    const levels = findSupportResistance(candles);

    // Get current price
    const currentPrice = candles[candles.length - 1].close;

    // Format results
    const results = {
      success: true,
      symbol,
      timeframe,
      candleCount: candles.length,
      currentPrice,
      timestamp: new Date(),
      levels: {
        support: [
          ...levels.swingLevels.support.map(l => ({
            ...l,
            method: 'Swing Lows',
            distance: ((currentPrice - l.price) / currentPrice * 100).toFixed(2) + '%'
          })),
          ...levels.psychological.filter(l => l.type === 'support').map(l => ({
            ...l,
            method: 'Psychological',
            distance: ((currentPrice - l.price) / currentPrice * 100).toFixed(2) + '%'
          })),
          ...levels.movingAverages.filter(l => l.type === 'support').map(l => ({
            ...l,
            method: l.reason,
            distance: ((currentPrice - l.price) / currentPrice * 100).toFixed(2) + '%'
          }))
        ]
          .filter(l => l.price < currentPrice) // Only include levels BELOW current price
          .map(l => addVolumeConfirmation(l, candles)) // Add volume confirmation
          .map(l => checkProximity(l, currentPrice)) // Add proximity check
          .sort((a, b) => b.price - a.price) // Sort from highest to lowest (closest to current price first)
          .slice(0, 5), // Top 5 support levels

        resistance: [
          ...levels.swingLevels.resistance.map(l => ({
            ...l,
            method: 'Swing Highs',
            distance: ((l.price - currentPrice) / currentPrice * 100).toFixed(2) + '%'
          })),
          ...levels.psychological.filter(l => l.type === 'resistance').map(l => ({
            ...l,
            method: 'Psychological',
            distance: ((l.price - currentPrice) / currentPrice * 100).toFixed(2) + '%'
          })),
          ...levels.movingAverages.filter(l => l.type === 'resistance').map(l => ({
            ...l,
            method: l.reason,
            distance: ((l.price - currentPrice) / currentPrice * 100).toFixed(2) + '%'
          }))
        ]
          .filter(l => l.price > currentPrice) // Only include levels ABOVE current price
          .map(l => addVolumeConfirmation(l, candles)) // Add volume confirmation
          .map(l => checkProximity(l, currentPrice)) // Add proximity check
          .sort((a, b) => a.price - b.price) // Sort from lowest to highest (closest to current price first)
          .slice(0, 5), // Top 5 resistance levels

        volumeProfile: levels.volumeProfile.slice(0, 5).map(node => ({
          price: node.price.toFixed(2),
          volume: node.volume.toFixed(2),
          strength: (node.strength * 100).toFixed(0) + '%',
          method: 'Volume Profile'
        }))
      }
    };

    console.log(`✅ Pattern scanner completed for ${symbol}`);
    res.json(results);

  } catch (error) {
    console.error('Pattern scanner error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
module.exports.addLogEntry = addLogEntry;
module.exports.addMonitoringActivity = addMonitoringActivity;
module.exports.setMonitoringActive = setMonitoringActive;
