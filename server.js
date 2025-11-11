const express = require('express');
const { marked } = require('marked');
const OpenAI = require('openai');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// Serve static files from 'public' directory
app.use(express.static('public'));
app.use(express.json());

// Initialize APIs
const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.API_KEY
});

// SIMPLE TRADING BOT (without CCXT for now)
class SimpleTradingBot {
  constructor() {
    this.isRunning = false;
    this.tradingPair = 'BTC/USDT';
  }
async analyzeMarket() {
  // Get REAL Bitcoin price
  const priceService = new (require('./priceService'))();
  const btcData = await priceService.getBitcoinPrice();
  const currentPrice = btcData.price;
    
    const randomSignal = Math.random();
    if (randomSignal > 0.6) {
      return { 
        action: 'BUY', 
        amount: 0.001, 
        price: mockPrice, 
        balance: mockBalance,
        signal: `Price: $${mockPrice} | Random signal: ${randomSignal.toFixed(2)}`
      };
    } else if (randomSignal < 0.4) {
      return { 
        action: 'SELL', 
        amount: 0.001, 
        price: mockPrice, 
        balance: mockBalance,
        signal: `Price: $${mockPrice} | Random signal: ${randomSignal.toFixed(2)}`
      };
    } else {
      return { 
        action: 'HOLD', 
        price: mockPrice, 
        balance: mockBalance,
        signal: `Price: $${mockPrice} | Random signal: ${randomSignal.toFixed(2)}`
      };
    }
  }

  async runSingleCheck() {
    console.log('🤖 Running market analysis...');
    const analysis = await this.analyzeMarket();
    console.log('📈 Analysis result:', analysis);
    return analysis;
  }

  startBot() {
    if (this.isRunning) {
      return { status: 'already_running' };
    }
    
    this.isRunning = true;
    console.log('🚀 Trading bot started (mock mode)');
    
    // Run every 2 minutes
    this.interval = setInterval(() => {
      this.runSingleCheck().then(analysis => {
        console.log(`🔄 Auto-check: ${analysis.action} | Price: $${analysis.price}`);
      });
    }, 2 * 60 * 1000);
    
    return { status: 'started' };
  }

  stopBot() {
    this.isRunning = false;
    if (this.interval) {
      clearInterval(this.interval);
    }
    console.log('🛑 Trading bot stopped');
    return { status: 'stopped' };
  }
}

const tradingBot = new SimpleTradingBot();

// ROOT ROUTE - Simple welcome page
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>DeepSeek Trading Bot</title>
        <style>
            body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
            .endpoint { background: #f5f5f5; padding: 10px; margin: 10px 0; border-radius: 5px; }
            a { color: #007bff; text-decoration: none; }
            a:hover { text-decoration: underline; }
        </style>
    </head>
    <body>
        <h1>🤖 DeepSeek Trading Bot</h1>
        <p>Your trading bot is running successfully!</p>
        
        <h2>📊 Trading Endpoints:</h2>
        <div class="endpoint">
            <strong>GET</strong> <a href="/bot-status">/bot-status</a> - Check bot status
        </div>
        <div class="endpoint">
            <strong>GET</strong> <a href="/check-market">/check-market</a> - Single market analysis
        </div>
        <div class="endpoint">
            <strong>POST</strong> /start-bot - Start auto-trading (use curl/postman)
        </div>
        <div class="endpoint">
            <strong>POST</strong> /stop-bot - Stop auto-trading (use curl/postman)
        </div>
        
        <h2>💬 Chat Endpoints:</h2>
        <div class="endpoint">
            <strong>POST</strong> /chat - Talk to DeepSeek AI
        </div>
        
        <p><em>Use Postman or curl to test POST endpoints</em></p>
    </body>
    </html>
  `);
});

// Trading Bot Routes - FIXED: Added GET to /check-market
app.get('/check-market', async (req, res) => {
  try {
    console.log('🔍 Manual market check requested');
    const analysis = await tradingBot.runSingleCheck();
    res.json(analysis);
  } catch (error) {
    console.error('Market check error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/check-market', async (req, res) => {
  try {
    console.log('🔍 Manual market check requested (POST)');
    const analysis = await tradingBot.runSingleCheck();
    res.json(analysis);
  } catch (error) {
    console.error('Market check error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/start-bot', (req, res) => {
  const result = tradingBot.startBot();
  res.json({ 
    status: 'Bot started', 
    time: new Date(),
    details: result,
    message: 'Bot running in MOCK mode - checking every 2 minutes'
  });
});

app.post('/stop-bot', (req, res) => {
  const result = tradingBot.stopBot();
  res.json({ 
    status: 'Bot stopped', 
    time: new Date(),
    details: result
  });
});

app.get('/bot-status', (req, res) => {
  res.json({ 
    running: tradingBot.isRunning,
    pair: tradingBot.tradingPair,
    mode: 'MOCK DEMO',
    lastUpdate: new Date()
  });
});

// Your existing DeepSeek chat routes
app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    
    const completion = await openai.chat.completions.create({
      model: "deepseek/deepseek-r1:free",
      messages: [{ role: "user", content: message }],
    });

    const reply = completion.choices[0].message.content;
    const htmlReply = marked.parse(reply);
    
    res.json({ reply: htmlReply });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Sorry, I had an error. Try again!' });
  }
});

// Keep-alive endpoint
app.get('/ping', (req, res) => {
  res.json({ status: 'OK', time: new Date() });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🤖 Trading bot ready - visit your Render URL`);
  console.log(`📝 Mode: MOCK DEMO - No real trading`);
  console.log(`🏠 Root route: https://my-deepseek-bot-1.onrender.com/`);
});
const PriceService = require('./priceService');
const priceService = new PriceService();

// Update the analyzeMarket method
async analyzeMarket() {
  try {
    // Get REAL price data
    const btcData = await priceService.getPrice('bitcoin');
    const ethData = await priceService.getPrice('ethereum');
    
    const currentPrice = btcData.price;
    const mockBalance = 1000;
    
    // Simple strategy based on real price
    let action = 'HOLD';
    let amount = 0.001;
    
    // Example: Buy if price drops 2% from recent average, Sell if rises 3%
    if (currentPrice < 35000 * 0.98) {
      action = 'BUY';
    } else if (currentPrice > 35000 * 1.03) {
      action = 'SELL';
    }
    
    return {
      action,
      amount,
      price: currentPrice,
      balance: mockBalance,
      signal: `BTC: $${currentPrice} | ETH: $${ethData.price} | Action: ${action}`,
      timestamp: new Date()
    };
    
  } catch (error) {
    console.error('Analysis error:', error);
    return this.getMockAnalysis();
  }
}
