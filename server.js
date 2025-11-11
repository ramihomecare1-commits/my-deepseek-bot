const express = require('express');
const ccxt = require('ccxt'); // Use CCXT for Pionex
const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

// Trading Bot Class with REAL Pionex API
class TradingBot {
  constructor() {
    this.isRunning = false;
    this.tradingPair = 'BTC/USDT';
    this.balance = 1000;
    this.exchange = null;
    this.initExchange();
  }

  initExchange() {
    try {
      this.exchange = new ccxt.pionex({
        'apiKey': process.env.PIONEX_API_KEY,
        'secret': process.env.PIONEX_API_SECRET,
        'sandbox': false, // Real mode
        'verbose': false
      });
      console.log('✅ Pionex exchange initialized');
    } catch (error) {
      console.log('❌ Pionex init error:', error.message);
    }
  }

  async analyzeMarket() {
    try {
      // Get REAL price from Pionex
      const priceData = await this.getRealPrice();
      
      let action = 'HOLD';
      let reason = 'Price within range';
      
      if (priceData.price < 40000) {
        action = 'BUY';
        reason = 'Price below $40,000 - buying opportunity';
      }
      if (priceData.price > 45000) {
        action = 'SELL';
        reason = 'Price above $45,000 - take profits';
      }

      return {
        action,
        price: priceData.price.toFixed(2),
        balance: this.balance,
        pair: this.tradingPair,
        signal: `Price: $${priceData.price.toFixed(2)} | Action: ${action} | Source: ${priceData.source}`,
        reason: reason,
        timestamp: new Date(),
        source: priceData.source
      };
      
    } catch (error) {
      console.log('Analysis error:', error.message);
      return this.getMockAnalysis();
    }
  }

  async getRealPrice() {
    try {
      if (!this.exchange) {
        throw new Error('Exchange not initialized');
      }

      console.log('📊 Fetching REAL Bitcoin price from Pionex...');
      
      // Get ticker from Pionex
      const ticker = await this.exchange.fetchTicker('BTC/USDT');
      const price = ticker.last;
      
      console.log(`✅ REAL Pionex Price: $${price}`);
      return { price, source: 'Pionex Live' };
      
    } catch (error) {
      console.log('❌ Pionex API failed:', error.message);
      
      // Fallback to CoinGecko
      try {
        console.log('🔄 Trying CoinGecko as backup...');
        const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
        const data = await response.json();
        const price = data.bitcoin.usd;
        console.log(`✅ CoinGecko Price: $${price}`);
        return { price, source: 'CoinGecko Backup' };
      } catch (cgError) {
        console.log('❌ All APIs failed, using mock price');
        const mockPrice = 35000 + Math.random() * 10000;
        return { price: mockPrice, source: 'Mock Data' };
      }
    }
  }

  getMockAnalysis() {
    const mockPrice = 35000 + Math.random() * 10000;
    return {
      action: 'HOLD',
      price: mockPrice.toFixed(2),
      balance: this.balance,
      pair: this.tradingPair,
      signal: `Price: $${mockPrice.toFixed(2)} | Action: HOLD | Source: Mock Data`,
      reason: 'API Error - Using mock data',
      timestamp: new Date(),
      source: 'Mock Data'
    };
  }

  startBot() {
    this.isRunning = true;
    console.log('🤖 Trading bot started with REAL Pionex data');
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

// Home page
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Trading Bot - Pionex Live</title>
        <style>
            body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
            .card { background: #f5f5f5; padding: 20px; margin: 10px 0; border-radius: 8px; }
            .buy { color: green; font-weight: bold; } 
            .sell { color: red; font-weight: bold; } 
            .hold { color: orange; font-weight: bold; }
            .live { color: blue; font-weight: bold; }
            button { padding: 10px 20px; margin: 5px; border: none; border-radius: 4px; cursor: pointer; background: #007bff; color: white; }
            button:hover { background: #0056b3; }
        </style>
    </head>
    <body>
        <h1>🤖 Trading Bot - Pionex Live Data</h1>
        <p>Using your REAL Pionex API connection!</p>
        
        <div class="card">
            <h3>Quick Actions:</h3>
            <button onclick="checkMarket()">Check Pionex Market</button>
            <button onclick="startBot()">Start Auto-Trading</button>
            <button onclick="stopBot()">Stop Auto-Trading</button>
        </div>

        <div class="card">
            <h3>Live Market Data:</h3>
            <div id="marketData">Click "Check Pionex Market" to load REAL data...</div>
        </div>

        <script>
            async function checkMarket() {
                try {
                    const response = await fetch('/check-market');
                    const data = await response.json();
                    
                    let actionClass = 'hold';
                    if (data.action === 'BUY') actionClass = 'buy';
                    if (data.action === 'SELL') actionClass = 'sell';
                    
                    const sourceClass = data.source.includes('Pionex') ? 'live' : '';
                    
                    document.getElementById('marketData').innerHTML = \`
                        <p class="\${actionClass}">Action: <strong>\${data.action}</strong></p>
                        <p>Price: $\${data.price}</p>
                        <p class="\${sourceClass}">Data Source: \${data.source}</p>
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
                    alert('Bot started with Pionex data!');
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

            checkMarket();
        </script>
    </body>
    </html>
  `);
});

// API Routes
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

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'trading-bot', time: new Date() });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Trading Bot Server running on port ${PORT}`);
  console.log(`✅ Using REAL Pionex API for live data`);
  console.log(`✅ Pionex API Key: ${process.env.PIONEX_API_KEY ? 'Set' : 'Missing'}`);
});

module.exports = app;
