const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

// Trading Bot Class with DIRECT Pionex API
class TradingBot {
  constructor() {
    this.isRunning = false;
    this.tradingPair = 'BTC/USDT';
    this.balance = 1000;
    this.apiKey = process.env.PIONEX_API_KEY;
    this.apiSecret = process.env.PIONEX_API_SECRET;
  }

  async analyzeMarket() {
    try {
      // Get REAL price from Pionex
      const priceData = await this.getPionexPrice();
      
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

  async getPionexPrice() {
    try {
      console.log('📊 Fetching REAL Bitcoin price from Pionex API...');
      
      // Pionex API endpoint for market data (public - no auth needed)
      const response = await axios.get('https://api.pionex.com/api/v1/market/tickers');
      
      if (response.data && response.data.data && response.data.data.tickers) {
        const btcTicker = response.data.data.tickers.find(t => t.symbol === 'BTC_USDT');
        
        if (btcTicker && btcTicker.close) {
          const price = parseFloat(btcTicker.close);
          console.log(`✅ REAL Pionex Price: $${price}`);
          return { price, source: 'Pionex Live' };
        }
      }
      
      throw new Error('No BTC price found in Pionex response');
      
    } catch (error) {
      console.log('❌ Pionex API failed:', error.message);
      return await this.getCoinGeckoPrice();
    }
  }

  async getCoinGeckoPrice() {
    try {
      console.log('🔄 Trying CoinGecko as backup...');
      const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
      
      if (response.data && response.data.bitcoin && response.data.bitcoin.usd) {
        const price = response.data.bitcoin.usd;
        console.log(`✅ CoinGecko Price: $${price}`);
        return { price, source: 'CoinGecko Backup' };
      }
      
      throw new Error('No price from CoinGecko');
      
    } catch (error) {
      console.log('❌ CoinGecko failed:', error.message);
      return this.getMockPrice();
    }
  }

  getMockPrice() {
    console.log('❌ All APIs failed, using mock price');
    const mockPrice = 35000 + Math.random() * 10000;
    return { price: mockPrice, source: 'Mock Data' };
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
    console.log('🤖 Trading bot started');
    console.log(`🔑 Pionex API Key: ${this.apiKey ? 'Configured' : 'Missing'}`);
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
        <title>Trading Bot - Live Data</title>
        <style>
            body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
            .card { background: #f5f5f5; padding: 20px; margin: 10px 0; border-radius: 8px; }
            .buy { color: green; font-weight: bold; } 
            .sell { color: red; font-weight: bold; } 
            .hold { color: orange; font-weight: bold; }
            .live { color: blue; font-weight: bold; }
            .mock { color: gray; font-style: italic; }
            button { padding: 10px 20px; margin: 5px; border: none; border-radius: 4px; cursor: pointer; background: #007bff; color: white; }
            button:hover { background: #0056b3; }
        </style>
    </head>
    <body>
        <h1>🤖 Trading Bot - Live Market Data</h1>
        <p>Using Pionex API for real cryptocurrency prices</p>
        
        <div class="card">
            <h3>Quick Actions:</h3>
            <button onclick="checkMarket()">Get Live Market Data</button>
            <button onclick="startBot()">Start Auto-Trading</button>
            <button onclick="stopBot()">Stop Auto-Trading</button>
        </div>

        <div class="card">
            <h3>Live Market Data:</h3>
            <div id="marketData">Click "Get Live Market Data" to load...</div>
        </div>

        <script>
            async function checkMarket() {
                try {
                    const response = await fetch('/check-market');
                    const data = await response.json();
                    
                    let actionClass = 'hold';
                    if (data.action === 'BUY') actionClass = 'buy';
                    if (data.action === 'SELL') actionClass = 'sell';
                    
                    let sourceClass = 'live';
                    if (data.source.includes('Mock')) sourceClass = 'mock';
                    
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
                    alert('Bot started!');
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

            // Load on page start
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
  console.log(`✅ Using direct Pionex API calls`);
});

module.exports = app;
