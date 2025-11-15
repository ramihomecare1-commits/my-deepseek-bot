/* eslint-disable no-console */
// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const path = require('path');

// Import configurations and services
const config = require('./config/config');
const apiRoutes = require('./routes/api');
const ProfessionalTradingBot = require('./bot/ProfessionalTradingBot');
const keepAliveService = require('./services/keepAliveService');

// Initialize app
const app = express();
const PORT = process.env.PORT || 10000;

// Environment validation
function validateEnvironment() {
  const warnings = [];
  
  // Check for tier-specific API keys (new system)
  const hasFreeTierKey = !!process.env.FREE_TIER_API_KEY;
  const hasPremiumTierKey = !!process.env.PREMIUM_TIER_API_KEY;
  const hasLegacyKey = !!process.env.API_KEY || !!process.env.AI_API_KEY;
  const hasOpenRouterKey = !!process.env.OPENROUTER_API_KEY;
  
  // AI analysis warning (only if no keys at all)
  if (!hasFreeTierKey && !hasPremiumTierKey && !hasLegacyKey && !hasOpenRouterKey) {
    warnings.push('⚠️  No AI API keys found - AI analysis will use deterministic fallback');
    warnings.push('   Set FREE_TIER_API_KEY and/or PREMIUM_TIER_API_KEY for monitoring');
  } else {
    // Show which keys are set
    if (!hasFreeTierKey && !hasOpenRouterKey && !hasLegacyKey) {
      warnings.push('⚠️  FREE_TIER_API_KEY not set - free tier monitoring disabled');
    }
    if (!hasPremiumTierKey && !hasOpenRouterKey && !hasLegacyKey) {
      warnings.push('⚠️  PREMIUM_TIER_API_KEY not set - premium tier will use free tier key');
    }
  }
  
  if (!config.TELEGRAM_ENABLED) {
    warnings.push('⚠️  Telegram credentials not configured - notifications disabled');
  }
  if (!config.NEWS_ENABLED) {
    warnings.push('⚠️  CRYPTOPANIC_API_KEY not set - news features disabled (optional)');
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
    
    tradingBot = new ProfessionalTradingBot();
    app.locals.tradingBot = tradingBot;
    
    // Initialize bot: Load saved trades and portfolio state
    await tradingBot.initialize();
    
    // Start independent trades update timer (runs every 1 minute, regardless of scans)
    tradingBot.startTradesUpdateTimer();
    
    // Start two-tier AI monitoring - runs every minute with v3 + R1 escalation
    tradingBot.startMonitoringTimer();
    
    // Add log entry
    try {
      const { addLogEntry } = require('./routes/api');
      addLogEntry('Bot initialized (using JavaScript analysis)', 'success');
    } catch (e) {
      // Logging not available yet, ignore
    }
    
    console.log('✅ Trading bot initialized (using JavaScript analysis)');
  } catch (error) {
    console.error('❌ Bot initialization error:', error);
    // Create a minimal bot instance to prevent crashes
    tradingBot = { trackedCoins: [], isRunning: false, getStats: () => ({ trackedCoins: 0 }) };
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
  
  // Start keep-alive service to prevent Render from sleeping
  // Render free tier sleeps after 15 minutes, so we ping every 10 minutes
  try {
    // Set the URL for keep-alive (Render provides RENDER_EXTERNAL_URL automatically)
    if (process.env.RENDER_EXTERNAL_URL) {
      process.env.RENDER_URL = process.env.RENDER_EXTERNAL_URL;
    } else {
      // For local development, use localhost
      process.env.RENDER_URL = `http://localhost:${PORT}`;
    }
    keepAliveService.start();
  } catch (error) {
    console.log(`⚠️ Failed to start keep-alive service: ${error.message}`);
  }
  
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
      console.log(`🤖 AI: ${(config.MONITORING_API_KEY || config.PREMIUM_API_KEY || config.AI_API_KEY) ? 'ENABLED ✅' : 'DISABLED ⚠️'}`);
    }
    
    console.log('🔔 Test Telegram: POST /api/test-telegram');
    console.log('🌐 Web UI: http://localhost:' + PORT);
    console.log('');
  }, 100);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  keepAliveService.stop();
  server.close(() => {
    console.log('Process terminated');
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  keepAliveService.stop();
  server.close(() => {
    process.exit(0);
  });
});

module.exports = app;
