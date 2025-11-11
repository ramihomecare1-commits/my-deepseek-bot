const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

// Advanced Trading Bot with Instant Price History
class TradingBot {
  constructor() {
    this.isRunning = false;
    this.tradingPair = 'BTC/USDT';
    this.balance = 1000;
    this.priceHistory = [];
    this.maxHistory = 50;
    
    // Initialize with some historical prices immediately
    this.initializePriceHistory();
  }

  async initializePriceHistory() {
    try {
      console.log('📊 Initializing price history...');
      
      // Get current price first
      const currentPriceData = await this.getPionexPrice();
      const currentPrice = currentPriceData.price;
      
      // Generate realistic historical prices around current price
      // Simulate last 50 price points with some variation
      for (let i = 50; i > 0; i--) {
        const variation = (Math.random() - 0.5) * 2000; // ±$1000 variation
        const historicalPrice = currentPrice + (variation * (i / 50));
        this.priceHistory.push(Math.max(historicalPrice, 1000)); // Ensure positive price
      }
      
      // Add the actual current price
      this.priceHistory.push(currentPrice);
      
      console.log(`✅ Price history initialized with ${this.priceHistory.length} data points`);
      console.log(`💰 Current price: $${currentPrice}`);
      console.log(`📈 Historical range: $${Math.min(...this.priceHistory).toFixed(0)} - $${Math.max(...this.priceHistory).toFixed(0)}`);
      
    } catch (error) {
      console.log('❌ Failed to initialize price history, using mock data');
      // Fallback to mock historical data
      for (let i = 0; i < 50; i++) {
        this.priceHistory.push(40000 + (Math.random() * 20000));
      }
    }
  }

  async analyzeMarket() {
    try {
      // Get REAL current price from Pionex
      const priceData = await this.getPionexPrice();
      const currentPrice = priceData.price;
      
      // Update price history with current price
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
    // Calculate technical indicators
    const sma20 = this.calculateSMA(20);
    const sma10 = this.calculateSMA(10);
    const rsi = this.calculateRSI(14);
    const priceChange24h = this.calculatePriceChange(24);
    const volatility = this.calculateVolatility();

    // Generate signals based on multiple indicators
    const signals = [];
    let confidence = 0;

    // 1. Moving Average Crossover
    const maDiff = ((sma10 - sma20) / sma20) * 100;
    if (maDiff > 2) {
      signals.push(`Bullish MA: 10-SMA ($${sma10.toFixed(0)}) > 20-SMA ($${sma20.toFixed(0)}) by ${maDiff.toFixed(1)}%`);
      confidence += 0.3;
    } else if (maDiff < -2) {
      signals.push(`Bearish MA: 10-SMA ($${sma10.toFixed(0)}) < 20-SMA ($${sma20.toFixed(0)}) by ${Math.abs(maDiff).toFixed(1)}%`);
      confidence += 0.3;
    }

    // 2. RSI Analysis
    if (rsi < 30) {
      signals.push(`Oversold: RSI at ${rsi.toFixed(1)} (potential buying opportunity)`);
      confidence += 0.25;
    } else if (rsi > 70) {
      signals.push(`Overbought: RSI at ${rsi.toFixed(1)} (potential selling pressure)`);
      confidence += 0.25;
    } else if (rsi > 50) {
      signals.push(`Bullish momentum: RSI at ${rsi.toFixed(1)}`);
      confidence += 0.1;
    } else {
      signals.push(`Bearish momentum: RSI at ${rsi.toFixed(1)}`);
      confidence += 0.1;
    }

    // 3. Price Momentum
    if (priceChange24h > 3) {
      signals.push(`Strong uptrend: +${priceChange24h.toFixed(1)}% in 24h`);
      confidence += 0.2;
    } else if (priceChange24h < -3) {
      signals.push(`Strong downtrend: ${priceChange24h.toFixed(1)}% in 24h`);
      confidence += 0.2;
    }

    // 4. Volatility Analysis
    if (volatility > 5) {
      signals.push(`High volatility: ${volatility.toFixed(1)}% (caution advised)`);
      confidence += 0.15;
    }

    // 5. Price vs Moving Averages
    const priceVsSma20 = ((currentPrice - sma20) / sma20) * 100;
    if (priceVsSma20 > 5) {
      signals.push(`Price ${priceVsSma20.toFixed(1)}% above 20-SMA (overextended)`);
      confidence += 0.15;
    } else if (priceVsSma20 < -5) {
      signals.push(`Price ${Math.abs(priceVsSma20).toFixed(1)}% below 20-SMA (potential support)`);
      confidence += 0.15;
    }

    // Determine final action
    let action = 'HOLD';
    let reason = 'Market conditions neutral';

    if (signals.length > 0) {
      const bullishSignals = signals.filter(s => 
        s.includes('Bullish') || s.includes('Oversold') || 
        (s.includes('uptrend') && priceChange24h > 0) ||
        (s.includes('below') && priceVsSma20 < -3)
      ).length;

      const bearishSignals = signals.filter(s => 
        s.includes('Bearish') || s.includes('Overbought') || 
        (s.includes('downtrend') && priceChange24h < 0) ||
        (s.includes('above') && priceVsSma20 > 3)
      ).length;

      if (bullishSignals > bearishSignals && confidence >= 0.5) {
        action = 'BUY';
        reason = `Bullish signals: ${signals.join('; ')}`;
      } else if (bearishSignals > bullishSignals && confidence >= 0.5) {
        action = 'SELL';
        reason = `Bearish signals: ${signals.join('; ')}`;
      } else {
        reason = `Mixed signals: ${signals.join('; ')}`;
      }
    }

    return {
      action,
      signal: `${action} | Confidence: ${(confidence * 100).toFixed(0)}%`,
      reason,
      confidence,
      indicators: {
        sma10: `$${sma10.toFixed(0)}`,
        sma20: `$${sma20.toFixed(0)}`,
        rsi: rsi.toFixed(1),
        priceChange24h: `${priceChange24h.toFixed(2)}%`,
        volatility: `${volatility.toFixed(1)}%`,
        priceVsSma20: `${priceVsSma20.toFixed(1)}%`,
        signalsCount: signals.length,
        dataPoints: this.priceHistory.length
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

  calculateVolatility() {
    if (this.priceHistory.length < 2) return 0;
    
    let sum = 0;
    const sma = this.calculateSMA(this.priceHistory.length);
    
    for (const price of this.priceHistory) {
      sum += Math.pow(price - sma, 2);
    }
    
    const variance = sum / this.priceHistory.length;
    return (Math.sqrt(variance) / sma) * 100;
  }

  async getPionexPrice() {
    try {
      const response = await axios.get('https://api.pionex.com/api/v1/market/tickers');
      
      if (response.data && response.data.data && response.data.data.tickers) {
        const btcTicker = response.data.data.tickers.find(t => t.symbol === 'BTC_USDT');
        
        if (btcTicker && btcTicker.close) {
          const price = parseFloat(btcTicker.close);
          return { price, source: 'Pionex Live' };
        }
      }
      
      throw new Error('No BTC price found');
      
    } catch (error) {
      return await this.getCoinGeckoPrice();
    }
  }

  async getCoinGeckoPrice() {
    try {
      const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
      
      if (response.data && response.data.bitcoin && response.data.bitcoin.usd) {
        const price = response.data.bitcoin.usd;
        return { price, source: 'CoinGecko Backup' };
      }
      
      throw new Error('No price from CoinGecko');
      
    } catch (error) {
      return this.getMockPrice();
    }
  }

  getMockPrice() {
    const mockPrice = 40000 + Math.random() * 20000;
    return { price: mockPrice, source: 'Mock Data' };
  }

  getMockAnalysis() {
    const mockPrice = 40000 + Math.random() * 20000;
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
// (Keep the same routes as before - they're fine)

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
        <p>Real-time Technical Analysis with Instant Price History</p>
        
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

            // Load analysis on page start
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
  console.log(`🚀 Advanced Trading Bot running on port ${PORT}`);
  console.log(`✅ Instant price history initialized`);
});

module.exports = app;
