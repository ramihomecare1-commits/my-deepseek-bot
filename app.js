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

// Serve main UI
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>🤖 AI Crypto Trading Scanner Pro</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          background: radial-gradient(circle at top left, #1f2937, #0f172a 55%, #020617 100%);
          min-height: 100vh;
          color: #1a202c;
        }
        .container {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 380px;
          gap: 24px;
          max-width: 1920px;
          margin: 0 auto;
          padding: 24px;
        }
        .main-content, .sidebar {
          background: rgba(255, 255, 255, 0.95);
          border-radius: 24px;
          padding: 32px;
          box-shadow: 0 24px 48px rgba(15, 23, 42, 0.35);
        }
        .header { text-align: center; margin-bottom: 32px; padding-bottom: 24px; border-bottom: 2px solid rgba(148, 163, 184, 0.2); }
        .header h1 {
          color: #0f172a;
          font-size: 2.75em;
          font-weight: 700;
          margin-bottom: 12px;
          background: linear-gradient(135deg, #6366f1, #22d3ee);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        }
        .subtitle {
          color: #334155;
          font-weight: 500;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }
        .api-status {
          display: flex;
          justify-content: center;
          gap: 20px;
          margin-top: 16px;
          flex-wrap: wrap;
        }
        .api-badge {
          padding: 8px 16px;
          border-radius: 20px;
          font-size: 0.85em;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .api-badge.coingecko { background: rgba(139, 69, 255, 0.15); color: #8b45ff; }
        .api-badge.coinpaprika { background: rgba(14, 165, 233, 0.15); color: #0ea5e9; }
        .api-badge.coinmarketcap { background: rgba(34, 197, 94, 0.15); color: #16a34a; }
        .api-badge.disabled { background: rgba(148, 163, 184, 0.15); color: #64748b; }
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 16px;
          margin-bottom: 28px;
        }
        .stat-card {
          background: linear-gradient(135deg, rgba(248, 250, 252, 0.95), rgba(226, 232, 240, 0.9));
          padding: 20px;
          border-radius: 16px;
          border: 1px solid rgba(148, 163, 184, 0.25);
          position: relative;
          overflow: hidden;
        }
        .stat-card::after {
          content: '';
          position: absolute;
          inset: 0;
          background: radial-gradient(circle at top right, rgba(99, 102, 241, 0.2), transparent);
          opacity: 0;
          transition: opacity 0.3s;
        }
        .stat-card:hover::after { opacity: 1; }
        .stat-label { color: #64748b; font-size: 0.75em; font-weight: 600; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.08em; }
        .stat-value { font-size: 2em; font-weight: 700; color: #0f172a; }
        .controls {
          background: linear-gradient(135deg, rgba(248, 250, 252, 0.95), rgba(226, 232, 240, 0.9));
          padding: 28px;
          border-radius: 20px;
          margin-bottom: 28px;
          border: 1px solid rgba(148, 163, 184, 0.2);
        }
        .button-group {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: 12px;
          margin-bottom: 20px;
        }
        button {
          padding: 14px 24px;
          border: none;
          border-radius: 12px;
          cursor: pointer;
          font-weight: 600;
          font-size: 14px;
          transition: all 0.3s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          color: white;
        }
        .btn-success { background: linear-gradient(135deg, #22c55e, #16a34a); }
        .btn-danger { background: linear-gradient(135deg, #ef4444, #dc2626); }
        .btn-primary { background: linear-gradient(135deg, #6366f1, #4338ca); }
        .btn-secondary { background: linear-gradient(135deg, #475569, #334155); }
        .btn-telegram { background: linear-gradient(135deg, #0088cc, #0369a1); }
        button:hover {
          transform: translateY(-3px);
          box-shadow: 0 12px 24px rgba(15, 23, 42, 0.25);
        }
        .status-card {
          background: linear-gradient(135deg, #0ea5e9, #6366f1);
          color: white;
          padding: 24px;
          border-radius: 16px;
          text-align: center;
        }
        .status-card h4 { margin-bottom: 8px; font-size: 1.2em; }
        .status-meta { font-size: 0.85em; opacity: 0.85; margin-top: 8px; }
        .opportunity {
          background: white;
          border-radius: 20px;
          padding: 24px;
          margin-bottom: 20px;
          border-left: 6px solid;
          box-shadow: 0 12px 32px rgba(15, 23, 42, 0.12);
        }
        .opportunity.buy { border-left-color: #22c55e; }
        .opportunity.sell { border-left-color: #ef4444; }
        .opportunity.hold { border-left-color: #f59e0b; }
        .coin-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }
        .coin-name { font-size: 1.4em; font-weight: 700; color: #0f172a; }
        .action-badge {
          padding: 8px 16px;
          border-radius: 999px;
          font-weight: 700;
          font-size: 0.9em;
        }
        .buy-badge { background: rgba(34, 197, 94, 0.15); color: #15803d; }
        .sell-badge { background: rgba(239, 68, 68, 0.15); color: #b91c1c; }
        .hold-badge { background: rgba(245, 158, 11, 0.15); color: #b45309; }
        .price-confidence {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap: 20px;
          margin: 20px 0;
        }
        .confidence-bar {
          height: 10px;
          background: rgba(226, 232, 240, 0.7);
          border-radius: 12px;
          margin: 16px 0;
          overflow: hidden;
        }
        .confidence-fill {
          height: 100%;
          border-radius: 12px;
        }
        .high-confidence { background: linear-gradient(90deg, #22c55e, #16a34a); }
        .no-opportunities {
          text-align: center;
          padding: 80px 20px;
          color: #64748b;
        }
        @media (max-width: 1400px) { .container { grid-template-columns: 1fr; } }
        @media (max-width: 768px) {
          .button-group { grid-template-columns: 1fr; }
          .main-content, .sidebar { padding: 20px; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="main-content">
          <div class="header">
            <h1>🤖 AI Crypto Trading Scanner Pro</h1>
            <div class="subtitle">Multi-API Technical Analysis • AI Validation • Real-time Data</div>
            <div class="api-status">
              <div class="api-badge coingecko">CoinGecko ✅</div>
              <div class="api-badge coinpaprika">CoinPaprika ✅</div>
              <div class="api-badge ${config.COINMARKETCAP_ENABLED ? 'coinmarketcap' : 'disabled'}">CoinMarketCap ${config.COINMARKETCAP_ENABLED ? '✅' : '❌'}</div>
            </div>
          </div>

          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-label">Total Scans</div>
              <div class="stat-value" id="totalScans">0</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Opportunities</div>
              <div class="stat-value" id="totalOpps">0</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">CoinPaprika Calls</div>
              <div class="stat-value" id="paprikaCalls">0</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">CoinMarketCap Calls</div>
              <div class="stat-value" id="cmcCalls">0</div>
            </div>
          </div>

          <div class="controls">
            <h3>🎯 Scanner Controls</h3>
            <div style="display:flex; gap:16px; flex-wrap:wrap; align-items:center; margin-bottom:16px;">
              <label for="intervalSelect" style="font-weight:600; color:#475569;">Auto-scan interval</label>
              <select id="intervalSelect" onchange="changeInterval(this.value)" style="padding:10px 14px; border-radius:10px; border:1px solid rgba(148,163,184,0.4); background:white; color:#0f172a;">
                <option value="10m">Every 10 minutes</option>
                <option value="1h" selected>Every 1 hour</option>
                <option value="4h">Every 4 hours</option>
                <option value="1d">Daily</option>
                <option value="1w">Weekly</option>
              </select>
            </div>
            <div class="button-group">
              <button class="btn-success" onclick="startAutoScan()">🚀 Start Auto-Scan</button>
              <button class="btn-danger" onclick="stopAutoScan()">🛑 Stop Auto-Scan</button>
              <button class="btn-primary" onclick="manualScan()">🔍 Scan Now</button>
              <button class="btn-telegram" onclick="testTelegram()">📱 Test Telegram</button>
            </div>
            <div class="status-card">
              <h4>Scanner Status</h4>
              <div id="statusText">🟢 Ready to start</div>
              <div id="nextScan">Next scan: Not scheduled</div>
              <div class="status-meta" id="telemetryStatus">
                Telegram: ${config.TELEGRAM_ENABLED ? '✅ Enabled' : '⚠️ Disabled'} | 
                CoinPaprika: ✅ | 
                CoinMarketCap: ${config.COINMARKETCAP_ENABLED ? '✅' : '❌'}
              </div>
            </div>
          </div>

          <div>
            <h3 style="margin-bottom: 24px; color: #0f172a; font-size: 1.5em; font-weight: 700;">📈 Trading Opportunities</h3>
            <div id="results">
              <div class="no-opportunities">
                <h3>🔍 Ready to Scan</h3>
                <p>Click "Scan Now" to start comprehensive technical analysis</p>
              </div>
            </div>
          </div>
        </div>

        <div class="sidebar">
          <div style="background: rgba(15, 23, 42, 0.92); color: white; border-radius: 24px; padding: 26px; box-shadow: 0 20px 40px rgba(15,23,42,0.45);">
            <h3 style="margin-bottom: 18px; font-size: 1.1em; letter-spacing: 0.08em; text-transform: uppercase; color: #22d3ee;">Live Analysis</h3>
            <div id="currentAnalysis" style="min-height: 200px; padding: 20px; background: rgba(15, 23, 42, 0.75); border-radius: 16px; border: 1px solid rgba(59,130,246,0.35);">
              <div style="color:#94a3b8; text-align:center;">Waiting for analysis...</div>
            </div>
          </div>
        </div>
      </div>

      <script>
        const API_BASE = '/api';
        
        async function testTelegram() {
          try {
            const response = await fetch(API_BASE + '/test-telegram', { method: 'POST' });
            const result = await response.json();
            alert(result.message);
          } catch (error) {
            alert('Error testing Telegram: ' + error.message);
          }
        }

        async function changeInterval(intervalKey) {
          try {
            const response = await fetch(API_BASE + '/auto-scan-settings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ interval: intervalKey }),
            });
            const result = await response.json();
            if (!result.success) {
              throw new Error(result.message || 'Unknown error');
            }
            document.getElementById('nextScan').textContent = 'Next scan: ' + getIntervalLabel(intervalKey);
          } catch (error) {
            alert('Unable to update interval: ' + error.message);
          }
        }

        function getIntervalLabel(key) {
          const labels = {
            '10m': 'Every 10 minutes',
            '1h': 'Every 1 hour', 
            '4h': 'Every 4 hours',
            '1d': 'Daily',
            '1w': 'Weekly'
          };
          return labels[key] || key;
        }

        async function startAutoScan() {
          try {
            const response = await fetch(API_BASE + '/start-scan', { method: 'POST' });
            const result = await response.json();
            if (result.status === 'already_running') {
              alert('Auto-scan is already running!');
              return;
            }
            document.getElementById('statusText').innerHTML = '🔄 Auto-Scanning Active';
            const intervalKey = document.getElementById('intervalSelect').value || '1h';
            document.getElementById('nextScan').textContent = 'Next scan: ' + getIntervalLabel(intervalKey);
            manualScan();
          } catch (error) {
            alert('Error starting auto-scan: ' + error.message);
          }
        }

        async function stopAutoScan() {
          try {
            await fetch(API_BASE + '/stop-scan', { method: 'POST' });
            document.getElementById('statusText').innerHTML = '🛑 Stopped';
            document.getElementById('nextScan').textContent = 'Next scan: Manual mode';
          } catch (error) {
            alert('Error stopping auto-scan: ' + error.message);
          }
        }

        async function manualScan() {
          try {
            document.getElementById('results').innerHTML = '<div class="no-opportunities"><div class="loading-spinner" style="width: 40px; height: 40px; border: 4px solid rgba(100, 116, 139, 0.2); border-top-color: #6366f1; border-radius: 999px; animation: spin 1s linear infinite; margin: 0 auto 20px;"></div><h3>🔍 Scanning...</h3></div>';
            
            const response = await fetch(API_BASE + '/scan-now', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' }
            });
            const data = await response.json();
            
            if (!data || !data.opportunities || data.opportunities.length === 0) {
              const msg = data.status === 'skipped' 
                ? 'Previous scan still running, waiting for completion…' 
                : 'Scanned ' + (data.analyzedCoins || 0) + ' coins';
              document.getElementById('results').innerHTML = '<div class="no-opportunities"><h3>📭 No High-Confidence Opportunities</h3><p>' + msg + '</p></div>';
              return;
            }

            let html = '';
            data.opportunities.forEach((opp) => {
              const confidencePercent = (opp.confidence * 100).toFixed(0);
              const confidenceLevel = confidencePercent >= 75 ? 'high-confidence' : 'medium-confidence';
              
              html += '<div class="opportunity ' + opp.action.toLowerCase() + '">' +
                '<div class="coin-header">' +
                  '<div class="coin-name">' + opp.name + ' (' + opp.symbol + ')</div>' +
                  '<div class="' + opp.action.toLowerCase() + '-badge action-badge">' + opp.action + '</div>' +
                '</div>' +
                '<div class="price-confidence">' +
                  '<div class="price-box"><div class="value">' + opp.price + '</div><div>Current Price</div></div>' +
                  '<div class="confidence-box"><div class="value">' + confidencePercent + '%</div><div>Confidence</div></div>' +
                '</div>' +
                '<div class="confidence-bar"><div class="confidence-fill ' + confidenceLevel + '" style="width: ' + confidencePercent + '%"></div></div>' +
                '<div style="margin: 16px 0; padding: 16px; background: rgba(148, 163, 184, 0.08); border-radius: 12px; border-left: 4px solid #6366f1;">' +
                  '<p>' + opp.reason + '</p>' +
                '</div>' +
                '<div>' +
                  '<h4>💡 Key Insights</h4>' +
                  '<ul style="list-style: none; padding: 0; margin-top: 12px;">' + 
                    opp.insights.map((i) => '<li style="padding: 8px 12px; margin-bottom: 6px; background: rgba(241, 245, 249, 0.85); border-radius: 8px; padding-left: 32px; position: relative;"><span style="position: absolute; left: 12px; color: #6366f1; font-weight: bold;">→</span>' + i + '</li>').join('') +
                  '</ul>' +
                '</div>' +
              '</div>';
            });

            document.getElementById('results').innerHTML = html;
          } catch (error) {
            console.error('Scan error:', error);
            document.getElementById('results').innerHTML = '<div class="no-opportunities" style="color: #ef4444;"><h3>❌ Scan Failed</h3><p>Please try again</p></div>';
          }
        }

        async function updateStats() {
          try {
            const response = await fetch(API_BASE + '/bot-status');
            const data = await response.json();
            if (data.stats) {
              document.getElementById('totalScans').textContent = data.stats.totalScans || 0;
              document.getElementById('totalOpps').textContent = data.stats.totalOpportunities || 0;
              document.getElementById('paprikaCalls').textContent = data.stats.apiUsage?.coinpaprika || 0;
              document.getElementById('cmcCalls').textContent = data.stats.apiUsage?.coinmarketcap || 0;
            }
          } catch (error) {
            console.log('Error updating stats:', error);
          }
        }

        // Initialize
        updateStats();
        setInterval(updateStats, 30000);
      </script>
    </body>
    </html>
  `);
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

// Start server only if not in test environment
if (process.env.NODE_ENV !== 'test') {
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
}

module.exports = app;
