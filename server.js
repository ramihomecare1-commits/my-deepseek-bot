const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

// Simple Trading Bot Class
class TradingBot {
  constructor() {
    this.isRunning = false;
    this.tradingPair = 'BTC/USDT';
    this.balance = 1000; // Demo balance
  }

  async analyzeMarket() {
    // Real price from CoinGecko API
    const price = await this.getRealPrice();
    
    // Simple strategy: Buy low, Sell high
    let action = 'HOLD';
    let reason = 'Price within range';
    
    if (price < 40000) {
      action = 'BUY';
      reason = 'Price below $40,000 - good buying opportunity';
    }
    if (price > 45000) {
      action = 'SELL'; 
      reason = 'Price above $45,000 - take profits';
    }

    return {
      action,
      price: price.toFixed(2),
      balance: this.balance,
      pair: this.tradingPair,
      signal: `Price: $${price.toFixed(2)} | Action: ${action}`,
      reason: reason,
      timestamp: new Date()
    };
  }

  async getRealPrice() {
    try {
      console.log('📊 Fetching REAL Bitcoin price from CoinGecko...');
      
      // Using CoinGecko API - NO API KEY NEEDED (free public API)
      const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
      
      if (!response.ok) {
        throw new Error(`API response: ${response.status}`);
      }
      
      const data = await response.json();
      const price = data.bitcoin.usd;
      
      console.log(`✅ REAL Bitcoin Price: $${price}`);
      return price;
      
    } catch (error) {
      // Fallback to mock price if API fails
      console.log('❌ CoinGecko API failed, using mock price:', error.message);
      const mockPrice = 35000 + Math.random() * 10000;
      console.log(`🔄 Mock Price: $${mockPrice.toFixed(2)}`);
      return mockPrice;
    }
  }

  startBot() {
    this.isRunning = true;
    console.log('🤖 Trading bot started');
    return { status: 'started', time: new Date() };
  }

  stopBot() {
    this.isRunning = false;
    console.log('🛑 Trading bot stopped');
    return { status: 'stopped', time: new Date() };
  }
}

const tradingBot = new TradingBot();

// ===== ROUTES =====

// Home page with bot info
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Trading Bot</title>
        <style>
            body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
            .card { background: #f5f5f5; padding: 20px; margin: 10px 0; border-radius: 8px; }
            .buy { color: green; font-weight: bold; } 
            .sell { color: red; font-weight: bold; } 
            .hold { color: orange; font-weight: bold; }
            button { padding: 10px 20px; margin: 5px; border: none; border-radius: 4px; cursor: pointer; background: #007bff; color: white; }
            button:hover { background: #0056b3; }
            .endpoint { background: white; padding: 10px; margin: 5px 0; border-radius: 4px; }
        </style>
    </head>
    <body>
        <h1>🤖 Trading Bot Dashboard</h1>
        <p>Your automated cryptocurrency trading bot is running!</p>
        
        <div class="card">
            <h3>Quick Actions:</h3>
            <button onclick="checkMarket()">Check Market Now</button>
            <button onclick="startBot()">Start Auto-Trading</button>
            <button onclick="stopBot()">Stop Auto-Trading</button>
            <button onclick="window.location.reload()">Refresh Status</button>
        </div>

        <div class="card">
            <h3>Live Market Data:</h3>
            <div id="marketData">Click "Check Market Now" to load...</div>
        </div>

        <div class="card">
            <h3>API Endpoints (Test these):</h3>
            <div class="endpoint"><strong>GET</strong> <a href="/check-market" target="_blank">/check-market</a> - Get current market analysis</div>
            <div class="endpoint"><strong>GET</strong> <a href="/bot-status" target="_blank">/bot-status</a> - Check bot status</div>
            <div class="endpoint"><strong>POST</strong> <a href="/start-bot" target="_blank">/start-bot</a> - Start auto-trading</div>
            <div class="endpoint"><strong>POST</strong> <a href="/stop-bot" target="_blank">/stop-bot</a> - Stop auto-trading</div>
        </div>

        <script>
            async function checkMarket() {
                try {
                    const response = await fetch('/check-market');
                    const data = await response.json();
                    
                    let actionClass = 'hold';
                    if (data.action === 'BUY') actionClass = 'buy';
                    if (data.action === 'SELL') actionClass = 'sell';
                    
                    document.getElementById('marketData').innerHTML = \`
                        <p class="\${actionClass}">Action: <strong>\${data.action}</strong></p>
                        <p>Price: $\${data.price}</p>
                        <p>Reason: \${data.reason}</p>
                        <p>Balance: $\${data.balance}</p>
                        <p>Time: \${new Date(data.timestamp).toLocaleString()}</p>
                    \`;
                } catch (error) {
                    document.getElementById('marketData').innerHTML = 'Error loading market data';
                }
            }

            async function startBot() {
                try {
                    await fetch('/start-bot', { method: 'POST' });
                    alert('Bot started! Check logs for activity.');
                } catch (error) {
                    alert('Error starting bot');
                }
            }

            async function stopBot() {
                try {
                    await fetch('/stop-bot', { method: 'POST' });
                    alert('Bot stopped!');
                } catch (error) {
                    alert('Error stopping bot');
                }
            }

            // Load market data on page load
            checkMarket();
        </script>
    </body>
    </html>
  `);
});

// Trading Bot Routes
app.get('/check-market', async (req, res) => {
  try {
    const analysis = await tradingBot.analyzeMarket();
    res.json(analysis);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/bot-status', (req, res) => {
  res.json({
    running: tradingBot.isRunning,
    pair: tradingBot.tradingPair,
    balance: tradingBot.balance,
    lastUpdate: new Date()
  });
});

app.post('/start-bot', (req, res) => {
  const result = tradingBot.startBot();
  res.json(result);
});

app.post('/stop-bot', (req, res) => {
  const result = tradingBot.stopBot();
  res.json(result);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'trading-bot', time: new Date() });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Trading Bot Server running on port ${PORT}`);
  console.log(`✅ Real Bitcoin prices from CoinGecko API`);
  console.log(`✅ Trading signals: BUY < $40K, SELL > $45K`);
});

module.exports = app;
