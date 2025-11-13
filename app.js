/* eslint-disable no-console */
const express = require('express');
const path = require('path');

// Import configurations and services
const config = require('./config/config');
const apiRoutes = require('./routes/api');
const ProfessionalTradingBot = require('./bot/ProfessionalTradingBot');
const { testPythonSetup } = require('./services/pythonService');

// Initialize app
const app = express();
const PORT = process.env.PORT || 10000;

// Environment validation
function validateEnvironment() {
  const warnings = [];
  if (!process.env.API_KEY) {
    warnings.push('⚠️  API_KEY not set - AI analysis will use deterministic fallback');
  }
  if (!config.TELEGRAM_ENABLED) {
    warnings.push('⚠️  Telegram credentials not configured - notifications disabled');
  }
  if (!config.NEWS_ENABLED) {
    warnings.push('⚠️  CRYPTOPANIC_API_KEY not set - news features disabled');
  }
  if (warnings.length > 0) {
    console.log('\n📋 Environment Configuration:');
    warnings.forEach((w) => console.log(w));
    console.log('');
  }
}
validateEnvironment();

// Simple rate limiter
const rateLimitStore = new Map();
function createRateLimiter(windowMs = 60000, maxRequests = 100) {
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const windowStart = now - windowMs;

    if (!rateLimitStore.has(ip)) {
      rateLimitStore.set(ip, []);
    }

    const requests = rateLimitStore.get(ip);
    const validRequests = requests.filter((time) => time > windowStart);
    rateLimitStore.set(ip, validRequests);

    if (validRequests.length >= maxRequests) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    validRequests.push(now);
    next();
  };
}

// Ensure fetch exists (Node 18+/polyfill)
let fetchFn = global.fetch;
if (!fetchFn) {
  fetchFn = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
}
const fetch = fetchFn;

// Health check FIRST - before any middleware (critical for Render)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'crypto-scanner',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting (skip for health check and root)
app.use((req, res, next) => {
  if (req.path === '/health' || req.path === '/api/health' || req.path === '/') {
    return next();
  }
  return createRateLimiter(60000, 100)(req, res, next);
});

// Initialize trading bot AFTER server starts (non-blocking for ultra-fast startup)
let tradingBot = null;
app.locals.tradingBot = null;

async function initializeBotAsync() {
  try {
    console.log('🔄 Initializing trading bot...');
    
    // Test Python setup (non-blocking, optional)
    const pythonAvailable = await testPythonSetup();
    
    tradingBot = new ProfessionalTradingBot();
    tradingBot.pythonAvailable = pythonAvailable;
    app.locals.tradingBot = tradingBot;
    console.log('✅ Trading bot initialized');
  } catch (error) {
    console.error('❌ Bot initialization error:', error);
    // Create a minimal bot instance to prevent crashes
    tradingBot = { trackedCoins: [], isRunning: false, pythonAvailable: false, getStats: () => ({ trackedCoins: 0 }) };
    app.locals.tradingBot = tradingBot;
  }
}

// API routes
app.use('/api', apiRoutes);

// Simple root route
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>🤖 Crypto Trading Scanner</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          margin: 0;
          padding: 0;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          color: white;
        }
        .container {
          text-align: center;
          background: rgba(255,255,255,0.1);
          padding: 40px;
          border-radius: 20px;
          backdrop-filter: blur(10px);
        }
        h1 {
          font-size: 2.5em;
          margin-bottom: 20px;
        }
        .status {
          background: rgba(255,255,255,0.2);
          padding: 20px;
          border-radius: 10px;
          margin: 20px 0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🤖 Crypto Trading Scanner</h1>
        <div class="status">
          <p>🚀 Server is running</p>
          <p>📊 Professional trading scanner</p>
          <p>🔧 Multi-API support</p>
          <p>⏰ Real-time analysis</p>
        </div>
        <p>API endpoints are available at <code>/api/*</code></p>
        <p><a href="/health" style="color: #fff;">Check Health</a></p>
      </div>
    </body>
    </html>
  `);
});

// Error handling
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

// Start server IMMEDIATELY - this must happen fast for Render
const server = app.listen(PORT, '0.0.0.0', () => {
  // Log immediately - don't wait for anything
  console.log(`\n✅ Server listening on port ${PORT}`);
  console.log(`✅ Health check: http://localhost:${PORT}/health`);
  console.log(`✅ Server ready for health checks`);
  
  // Initialize bot AFTER server is listening (non-blocking)
  setImmediate(() => {
    initializeBotAsync();
  });
  
  // Log additional info asynchronously (non-blocking)
  setTimeout(() => {
    console.log(`\n🚀 Professional Crypto Scanner`);
    console.log(`📡 Server running on port ${PORT}`);
    
    if (tradingBot && tradingBot.trackedCoins && tradingBot.trackedCoins.length) {
      console.log('📊 Strategy: RSI + Bollinger + Support/Resistance + Momentum + AI overlay');
      console.log(`⏰ Auto-scan: ${tradingBot.selectedIntervalKey || '1h'} intervals`);
      console.log(`🎯 Coins: ${tradingBot.trackedCoins.length}`);
      console.log(`📱 Telegram: ${config.TELEGRAM_ENABLED ? 'ENABLED ✅' : 'DISABLED ⚠️'}`);
      console.log(`📰 News: ${config.NEWS_ENABLED ? 'ENABLED ✅' : 'DISABLED ⚠️'}`);
      console.log(`🤖 AI: ${config.AI_API_KEY ? 'ENABLED ✅' : 'DISABLED ⚠️'}`);
    }
    
    console.log('🔔 Test Telegram: POST /api/test-telegram');
    console.log('🌐 Web UI: http://localhost:' + PORT);
    console.log('');
  }, 100);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});

module.exports = app;
