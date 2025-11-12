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
    const result = await tradingBot.sendTestNotification();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: `Error: ${error.message}`,
    });
  }
});

router.get('/live-analysis', (req, res) => {
  try {
    const { tradingBot } = req.app.locals;
    const liveAnalysis = tradingBot.getLiveAnalysis();
    res.json(liveAnalysis);
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

module.exports = router;
