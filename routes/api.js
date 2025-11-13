const express = require('express');
const router = express.Router();

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
    
    res.json({
      running: tradingBot.isRunning,
      coinsTracked: tradingBot.trackedCoins.length,
      strategy: 'RSI + Bollinger Bands + Support/Resistance + Momentum + AI overlay',
      interval: tradingBot.selectedIntervalKey,
      minConfidence: tradingBot.minConfidence,
      stats: tradingBot.getStats(),
      telegramEnabled: config.TELEGRAM_ENABLED,
      newsEnabled: config.NEWS_ENABLED,
      coinmarketcapEnabled: config.COINMARKETCAP_ENABLED,
      coinpaprikaEnabled: config.COINPAPRIKA_ENABLED,
      lastUpdate: new Date(),
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

module.exports = router;
