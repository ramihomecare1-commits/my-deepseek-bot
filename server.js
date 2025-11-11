const express = require('express');
const { marked } = require('marked');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 10000;

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
    // Mock analysis for testing
    const mockPrice = 35000 + (Math.random() * 1000);
    const mockBalance = 1000;
    
    const randomSignal = Math.random();
    if (randomSignal > 0.6) {
      return { action: 'BUY', amount: 0.001, price: mockPrice, balance: mockBalance };
    } else if (randomSignal < 0.4) {
      return { action: 'SELL', amount: 0.001, price: mockPrice, balance: mockBalance };
    } else {
      return { action: 'HOLD', price: mockPrice, balance: mockBalance };
    }
  }

  async runSingleCheck() {
    console.log('🤖 Running market analysis...');
    const analysis = await this.analyzeMarket();
    console.log('📈 Analysis result:', analysis);
    return analysis;
  }

  startBot() {
    this.isRunning = true;
    console.log('🚀 Trading bot started (mock mode)');
    
    // Run every 2 minutes
    this.interval = setInterval(() => {
      this.runSingleCheck();
    }, 2 * 60 * 1000);
  }

  stopBot() {
    this.isRunning = false;
    if (this.interval) {
      clearInterval(this.interval);
    }
    console.log('🛑 Trading bot stopped');
  }
}

const tradingBot = new SimpleTradingBot();

// Trading Bot Routes
app.post('/start-bot', (req, res) => {
  tradingBot.startBot();
  res.json({ 
    status: 'Bot started', 
    time: new Date(),
    message: 'Bot running in MOCK mode - checking every 2 minutes'
  });
});

app.post('/stop-bot', (req, res) => {
  tradingBot.stopBot();
  res.json({ 
    status: 'Bot stopped', 
    time: new Date() 
  });
});

app.post('/check-market', async (req, res) => {
  try {
    const analysis = await tradingBot.runSingleCheck();
    res.json(analysis);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🤖 Trading bot ready - visit your Render URL`);
  console.log(`📝 Mode: MOCK DEMO - No real trading`);
});
