/* eslint-disable no-console */
const express = require('express');
const path = require('path');

// Import configurations and services
const config = require('./config/config');
const apiRoutes = require('./routes/api');
const ProfessionalTradingBot = require('./bot/ProfessionalTradingBot');

// Initialize app
const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize trading bot
const tradingBot = new ProfessionalTradingBot();

// Make bot available to routes
app.locals.tradingBot = tradingBot;

// API routes
app.use('/api', apiRoutes);

// Serve main UI
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
  const { tradingBot } = app.locals;
  res.json({
    status: 'healthy',
    service: 'professional-scanner-v2',
    strategy: 'Technical Analysis (Enhanced)',
    autoScan: tradingBot.isRunning,
    telegramEnabled: config.TELEGRAM_ENABLED,
    newsEnabled: config.NEWS_ENABLED,
    coinmarketcapEnabled: config.COINMARKETCAP_ENABLED,
    coinpaprikaEnabled: config.COINPAPRIKA_ENABLED,
    scanInterval: tradingBot.selectedIntervalKey,
    coinsTracked: tradingBot.trackedCoins.length,
    lastSuccessfulScan: tradingBot.stats.lastSuccessfulScan,
    mockDataUsage: tradingBot.stats.mockDataUsage,
    time: new Date(),
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    message: error.message 
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎯 Professional Crypto Scanner V2 running on port ${PORT}`);
  console.log('📊 Strategy: RSI + Bollinger + Support/Resistance + Momentum + AI overlay');
  console.log('⏰ Auto-scan: 1 HOUR intervals');
  console.log('🎯 Coins:', tradingBot.trackedCoins.length);
  console.log(`🌐 APIs: CoinGecko ✅ | CoinPaprika ✅ | CoinMarketCap: ${config.COINMARKETCAP_ENABLED ? '✅' : '❌'}`);
  console.log(`📱 Telegram: ${config.TELEGRAM_ENABLED ? 'ENABLED ✅' : 'DISABLED ⚠️'}`);
  console.log('🔔 Test Telegram: POST /api/test-telegram');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  tradingBot.stopAutoScan();
  server.close(() => {
    console.log('Process terminated');
  });
});

module.exports = app;
