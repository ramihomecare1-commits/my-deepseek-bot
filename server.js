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
    if (price < 40000) action = 'BUY';
    if (price > 45000) action = 'SELL';

    return {
      action,
      price,
      balance: this.balance,
      pair: this.tradingPair,
      signal: `Price: $${price} | Action: ${action}`,
      timestamp: new Date()
    };
  }

  async getRealPrice() {
    try {
      // Using CoinGecko API for real Bitcoin price
      const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
      const data = await response.json();
      return data.bitcoin.usd;
    } catch (error) {
      // Fallback to mock price if API fails
      console.log('API failed, using mock price');
      return 35000 + Math.random() * 10000;
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
            .buy { color: green; } .sell { color: red; } .hold { color: orange; }
            button { padding: 10px 20px; margin: 5px; border: none; border-radius: 4px; cursor: pointer; }
        </style>
    </head>
    <body>
        <h1>🤖 Trading Bot Dashboard</h1>
        
        <div class="card">
            <h3>Quick Actions:</h3>
            <button onclick="window.open('/check-market', '_blank')">Check Market</button>
            <button onclick="window.open('/bot-status', '_blank')">Bot Status</button>
            <button onclick="fetch('/start-bot', {method: 'POST'}).then(() => alert('Bot started'))">Start Bot</button>
            <button onclick="fetch('/stop-bot', {method: 'POST'}).then(() => alert('Bot stopped'))">Stop Bot</button>
        </div>

        <div class="card">
            <h3>API Endpoints:</h3>
            <ul>
                <li><a href="/check-market" target="_blank">/check-market</a> - Market analysis</li>
                <li><a href="/bot-status" target="_blank">/bot-status</a> - Bot status</li>
                <li><a href="/start-bot" target="_blank">/start-bot</a> - Start bot (POST)</li>
                <li><a href="/stop-bot" target="_blank">/stop-bot</a> - Stop bot (POST)</li>
            </ul>
        </div>
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
  console.log(`✅ Ready for trading!`);
});

module.exports = app;
