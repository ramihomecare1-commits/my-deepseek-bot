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

// Ensure fetch exists (Node 18+/polyfill)
let fetchFn = global.fetch;
if (!fetchFn) {
  fetchFn = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
}
const fetch = fetchFn;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize trading bot
const tradingBot = new ProfessionalTradingBot();

// Make bot available to routes
app.locals.tradingBot = tradingBot;

// API routes
app.use('/api', apiRoutes);

// Simple health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'crypto-scanner',
    time: new Date(),
  });
});

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

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎯 Crypto Trading Scanner running on port ${PORT}`);
  console.log('📊 Professional trading scanner initialized');
  console.log('🌐 Multi-API support enabled');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});

module.exports = app;
