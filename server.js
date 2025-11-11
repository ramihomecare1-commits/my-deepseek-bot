const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

// Advanced Trading Bot with Technical Analysis
class TradingBot {
  constructor() {
    this.isRunning = false;
    this.tradingPair = 'BTC/USDT';
    this.balance = 1000;
    this.priceHistory = [];
    this.maxHistory = 50; // Store last 50 prices
  }

  async analyzeMarket() {
    try {
      // Get REAL price from Pionex
      const priceData = await this.getPionexPrice();
      const currentPrice = priceData.price;
      
      // Add to price history for technical analysis
      this.addToPriceHistory(currentPrice);
      
      // Perform technical analysis
      const analysis = await this.technicalAnalysis(currentPrice);
      
      return {
        action: analysis.action,
        price: currentPrice.toFixed(2),
        balance: this.balance,
        pair: this.tradingPair,
        signal: analysis.signal,
        reason: analysis.reason,
        indicators: analysis.indicators,
        timestamp: new Date(),
        source: priceData.source,
        confidence: analysis.confidence
      };
      
    } catch (error) {
      console.log('Analysis error:', error.message);
      return this.getMockAnalysis();
    }
  }

  addToPriceHistory(price) {
    this.priceHistory.push(price);
    if (this.priceHistory.length > this.maxHistory) {
      this.priceHistory.shift(); // Remove oldest price
    }
  }

  async technicalAnalysis(currentPrice) {
    if (this.priceHistory.length < 20) {
      return {
        action: 'HOLD',
        signal: 'Insufficient data for analysis',
        reason: 'Collecting price history...',
        confidence: 0.1,
        indicators: { status: 'Initializing' }
      };
    }

    // Calculate technical indicators
    const sma20 = this.calculateSMA(20);  // 20-period Simple Moving Average
    const sma10 = this.calculateSMA(10);  // 10-period SMA
    const rsi = this.calculateRSI(14);    // 14-period RSI
    const priceChange24h = this.calculatePriceChange(24); // 24h price change
    
    // Generate signals based on multiple indicators
    const signals = [];
    let confidence = 0;

    // 1. Moving Average Crossover Strategy
    if (sma10 > sma20 && this.priceHistory[this.priceHistory.length - 2] <= sma20) {
      signals.push('MA Crossover: Short-term MA crossed above long-term MA');
      confidence += 0.3;
    } else if (sma10 < sma20 && this.priceHistory[this.priceHistory.length - 2] >= sma20) {
      signals.push('MA Crossover: Short-term MA crossed below long-term MA');
      confidence += 0.3;
    }

    // 2. RSI Strategy
    if (rsi < 30) {
      signals.push(`RSI ${rsi.toFixed(1)}: Oversold condition - potential buy`);
      confidence += 0.25;
    } else if (rsi > 70) {
      signals.push(`RSI ${rsi.toFixed(1)}: Overbought condition - potential sell`);
      confidence += 0.25;
    }

    // 3. Price Momentum
    if (priceChange24h > 5) {
      signals.push(`Strong uptrend: +${priceChange24h.toFixed(1)}% in 24h`);
      confidence += 0.2;
    } else if (priceChange24h < -5) {
      signals.push(`Strong downtrend: ${priceChange24h.toFixed(1)}% in 24h`);
      confidence += 0.2;
    }

    // 4. Support/Resistance Levels
    const supportLevel = sma20 * 0.95; // 5% below SMA20 as support
    const resistanceLevel = sma20 * 1.05; // 5% above SMA20 as resistance
    
    if (currentPrice < supportLevel) {
      signals.push(`Price below support level ($${supportLevel.toFixed(0)})`);
      confidence += 0.15;
    } else if (currentPrice > resistanceLevel) {
      signals.push(`Price above resistance level ($${resistanceLevel.toFixed(0)})`);
      confidence += 0.15;
    }

    // Determine final action based on signals
    let action = 'HOLD';
    let reason = 'Market conditions neutral';

    if (signals.length > 0) {
      if (confidence >= 0.6) {
        // Strong bullish signals
        if (signals.some(s => s.includes('MA Crossover: Short-term MA crossed above') || 
                              (s.includes('Oversold') && priceChange24h > -2))) {
          action = 'BUY';
          reason = `Strong buy signals: ${signals.join('; ')}`;
        }
        // Strong bearish signals  
        else if (signals.some(s => s.includes('MA Crossover: Short-term MA crossed below') || 
                                (s.includes('Overbought') && priceChange24h < 2))) {
          action = 'SELL';
          reason = `Strong sell signals: ${signals.join('; ')}`;
        }
      } else if (confidence >= 0.4) {
        // Moderate signals
        action = 'HOLD';
        reason = `Monitoring: ${signals.join('; ')}`;
      }
    }

    return {
      action,
      signal: `${action} | Confidence: ${(confidence * 100).toFixed(0)}%`,
      reason,
      confidence,
      indicators: {
        sma10: sma10.toFixed(2),
        sma20: sma20.toFixed(2),
        rsi: rsi.toFixed(1),
        priceChange24h: `${priceChange24h.toFixed(2)}%`,
        support: `$${supportLevel.toFixed(0)}`,
        resistance: `$${resistanceLevel.toFixed(0)}`,
        signalsCount: signals.length
      }
    };
  }

  calculateSMA(period) {
    const prices = this.priceHistory.slice(-period);
    return prices.reduce((sum, price) => sum + price, 0) / prices.length;
  }

  calculateRSI(period = 14) {
    if (this.priceHistory.length < period + 1) return 50;

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
      const change = this.priceHistory[this.priceHistory.length - i] - 
                    this.priceHistory[this.priceHistory.length - i - 1];
      if (change > 0) gains += change;
      else losses -= change;
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  calculatePriceChange(hours) {
    if (this.priceHistory.length < hours) return 0;
    const oldPrice = this.priceHistory[this.priceHistory.length - hours];
    const newPrice = this.priceHistory[this.priceHistory.length - 1];
    return ((newPrice - oldPrice) / oldPrice) * 100;
  }

  async getPionexPrice() {
    try {
      console.log('📊 Fetching REAL Bitcoin price from Pionex API...');
      
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
      signal: 'HOLD | Confidence: 0%',
      reason: 'API Error - Using mock data',
      indicators: { status: 'Error' },
      timestamp: new Date(),
      source: 'Mock Data',
      confidence: 0
    };
  }

  startBot() {
    this.isRunning = true;
    console.log('🤖 Advanced Trading Bot started');
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
        <title>Advanced Trading Bot</title>
        <style>
            body { font-family: Arial, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; }
            .card { background: #f5f5f5; padding: 20px; margin: 10px 0; border-radius: 8px; }
            .buy { color: green; font-weight: bold; } 
            .sell { color: red; font-weight: bold; } 
            .hold { color: orange; font-weight: bold; }
            .indicators { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 10px 0; }
            .indicator { background: white; padding: 8px; border-radius: 4px; }
            .high-confidence { background: #e8f5e8; }
            .medium-confidence { background: #fff3cd; }
            .low-confidence { background: #f8d7da; }
            button { padding: 10px 20px; margin: 5px; border: none; border-radius: 4px; cursor: pointer; background: #007bff; color: white; }
        </style>
    </head>
    <body>
        <h1>🤖 Advanced Trading Bot</h1>
        <p>Using Technical Analysis: Moving Averages, RSI, Price Momentum</p>
        
        <div class="card">
            <h3>Quick Actions:</h3>
            <button onclick="checkMarket()">Run Technical Analysis</button>
            <button onclick="startBot()">Start Auto-Trading</button>
            <button onclick="stopBot()">Stop Auto-Trading</button>
        </div>

        <div class="card">
            <h3>Technical Analysis Results:</h3>
            <div id="marketData">Click "Run Technical Analysis" to load...</div>
        </div>

        <script>
            async function checkMarket() {
                try {
                    const response = await fetch('/check-market');
                    const data = await response.json();
                    
                    let actionClass = 'hold';
                    if (data.action === 'BUY') actionClass = 'buy';
                    if (data.action === 'SELL') actionClass = 'sell';
                    
                    let confidenceClass = 'low-confidence';
                    if (data.confidence > 0.6) confidenceClass = 'high-confidence';
                    else if (data.confidence > 0.3) confidenceClass = 'medium-confidence';
                    
                    let indicatorsHTML = '';
                    if (data.indicators) {
                        for (const [key, value] of Object.entries(data.indicators)) {
                            indicatorsHTML += \`<div class="indicator"><strong>\${key}:</strong> \${value}</div>\`;
                        }
                    }
                    
                    document.getElementById('marketData').innerHTML = \`
                        <div class="\${confidenceClass}" style="padding: 15px; border-radius: 5px;">
                            <p class="\${actionClass}" style="font-size: 1.2em;">Action: <strong>\${data.action}</strong></p>
                            <p><strong>Confidence:</strong> \${(data.confidence * 100).toFixed(0)}%</p>
                            <p><strong>Price:</strong> $\${data.price}</p>
                            <p><strong>Reason:</strong> \${data.reason}</p>
                            <p><strong>Data Source:</strong> \${data.source}</p>
                            <p><strong>Time:</strong> \${new Date(data.timestamp).toLocaleString()}</p>
                        </div>
                        <div class="indicators">
                            \${indicatorsHTML}
                        </div>
                    \`;
                } catch (error) {
                    document.getElementById('marketData').innerHTML = 'Error loading market analysis';
                }
            }

            async function startBot() {
                try {
                    await fetch('/start-bot', { method: 'POST' });
                    alert('Advanced trading bot started!');
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

// API Routes (same as before)
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
  console.log(`🚀 Advanced Trading Bot running on port ${PORT}`);
  console.log(`✅ Using real technical analysis`);
});

module.exports = app;
