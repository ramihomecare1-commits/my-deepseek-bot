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
    
    // Calculate next scan time
    let nextScan = null;
    if (tradingBot.isRunning && tradingBot.scanIntervalMs) {
      // Get the last scan time from stats
      const lastScanTime = tradingBot.stats.lastScanTime;
      if (lastScanTime) {
        // Next scan is last scan time + interval
        nextScan = new Date(lastScanTime + tradingBot.scanIntervalMs);
        // If next scan is in the past (scan is overdue), calculate from now
        if (nextScan < new Date()) {
          nextScan = new Date(Date.now() + tradingBot.scanIntervalMs);
        }
      } else {
        // No scan has run yet, next scan is interval from now
        nextScan = new Date(Date.now() + tradingBot.scanIntervalMs);
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
router.get('/active-trades', (req, res) => {
  try {
    const { tradingBot } = req.app.locals;
    const activeTrades = tradingBot.getActiveTrades();
    res.json(activeTrades);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Portfolio stats endpoint
router.get('/portfolio', (req, res) => {
  try {
    const { getPortfolioStats } = require('../services/portfolioService');
    const portfolio = getPortfolioStats();
    res.json(portfolio);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Exchange trading status endpoint
router.get('/exchange-status', (req, res) => {
  try {
    const { isExchangeTradingEnabled, getVirtualTradingState } = require('../services/exchangeService');
    const status = isExchangeTradingEnabled();
    const virtualState = status.virtualTrading ? getVirtualTradingState() : null;
    
    res.json({
      ...status,
      virtualState: virtualState,
      message: status.mode === 'REAL'
        ? 'Real trading is ENABLED - orders will be executed on Binance with real money'
        : status.mode === 'VIRTUAL'
        ? `Virtual trading is ENABLED - orders are simulated (no real money). Balance: $${virtualState?.balance.toFixed(2) || '0'}`
        : 'Trading is DISABLED - set ENABLE_VIRTUAL_TRADING=true (default) or ENABLE_AUTO_TRADING=true with API keys'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
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

module.exports = router;
module.exports.addLogEntry = addLogEntry;
