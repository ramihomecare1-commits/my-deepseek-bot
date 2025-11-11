const express = require('express');
const { marked } = require('marked');
const OpenAI = require('openai');
const TradingBot = require('./tradingEngine');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.static('public'));
app.use(express.json());

// Initialize APIs
const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.API_KEY
});

const tradingBot = new TradingBot();

// Trading Bot Routes
app.post('/start-bot', (req, res) => {
  tradingBot.startBot();
  res.json({ 
    status: 'Bot started', 
    time: new Date(),
    message: 'Bot will check market every 2 minutes'
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
});
