const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

// Trading Bot Class with SMART STRATEGY
class TradingBot {
  constructor() {
    this.isRunning = false;
    this.tradingPair = 'BTC/USDT';
    this.balance = 1000;
    this.apiKey = process.env.PIONEX_API_KEY;
    this.apiSecret = process.env.PIONEX_API_SECRET;
    this.priceHistory = [];
  }

  async analyzeMarket() {
    try {
      // Get REAL price from Pionex
      const priceData = await this.getPionexPrice();
      const currentPrice = priceData.price;
      
      // Add current price to history (keep last 20 prices)
      this.priceHistory.push(currentPrice);
      if (this.priceHistory.length > 20) {
        this.priceHistory.shift();
      }
      
      // Calculate indicators
      const indicators = this.calculateIndicators(currentPrice);
      
      // Generate smart trading signal
      const signal = this.generateSmartSignal(currentPrice, indicators);
      
      return {
        action: signal.action,
        price: currentPrice.toFixed(2),
        balance: this.balance,
        pair: this.tradingPair,
        signal: signal.summary,
        reason: signal.reason,
        confidence: signal.confidence,
        indicators: indicators,
        timestamp: new Date(),
        source: priceData.source
      };
      
    } catch (error) {
      console.log('Analysis error:', error.message);
      return this.getMockAnalysis();
    }
  }

  calculateIndicators(currentPrice) {
    if (this.priceHistory.length < 5) {
      return {
        trend: 'UNKNOWN',
        momentum: '0.00',
        volatility: '0.00',
        sma5: currentPrice.toFixed(2),
        sma10: currentPrice.toFixed(2)
      };
    }
    
    // Simple Moving Averages
    const sma5 = this.priceHistory.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const sma10 = this.priceHistory.length >= 10 
      ? this.priceHistory.slice(-10).reduce((a, b) => a + b, 0) / 10 
      : sma5;
    
    // Price momentum (% change from 5 periods ago)
    const momentum = this.priceHistory.length >= 5
      ? ((currentPrice - this.priceHistory[this.priceHistory.length - 5]) / this.priceHistory[this.priceHistory.length - 5]) * 100
      : 0;
    
    // Volatility (standard deviation of last 10 prices)
    const volatility = this.calculateVolatility();
    
    // Trend detection
    let trend = 'NEUTRAL';
    if (sma5 > sma10 * 1.005) trend = 'UPTREND';
    if (sma5 < sma10 * 0.995) trend = 'DOWNTREND';
    
    return {
      trend,
      momentum: momentum.toFixed(2),
      volatility: volatility.toFixed(2),
      sma5: sma5.toFixed(2),
      sma10: sma10.toFixed(2)
    };
  }

  calculateVolatility() {
    if (this.priceHistory.length < 5) return 0;
    
    const prices = this.priceHistory.slice(-10);
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const variance = prices.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / prices.length;
    return Math.sqrt(variance);
  }

  generateSmartSignal(currentPrice, indicators) {
    let action = 'HOLD';
    let reason = '';
    let confidence = 0;
    let factors = [];
    
    // Factor 1: Price level analysis
    if (currentPrice < 85000) {
      factors.push('Price below $85K (historically good entry)');
      confidence += 20;
      if (action === 'HOLD') action = 'BUY';
    } else if (currentPrice > 95000) {
      factors.push('Price above $95K (consider taking profits)');
      confidence += 20;
      if (action === 'HOLD') action = 'SELL';
    } else {
      factors.push('Price in neutral zone ($85K-$95K)');
      confidence += 10;
    }
    
    // Factor 2: Trend analysis
    if (indicators.trend === 'UPTREND') {
      factors.push('Strong uptrend detected (5-MA > 10-MA)');
      confidence += 25;
      if (action === 'SELL') {
        action = 'HOLD'; // Don't sell in uptrend
        factors.push('⚠️ Override: Not selling in uptrend');
      } else if (action === 'HOLD') {
        action = 'BUY'; // Consider buying in uptrend
      }
    } else if (indicators.trend === 'DOWNTREND') {
      factors.push('Downtrend detected (5-MA < 10-MA)');
      confidence += 25;
      if (action === 'BUY') {
        action = 'HOLD'; // Don't buy in downtrend
        factors.push('⚠️ Override: Not buying in downtrend');
      } else if (action === 'HOLD') {
        action = 'SELL'; // Consider selling in downtrend
      }
    } else {
      factors.push('Neutral trend (no clear direction)');
      confidence += 15;
    }
    
    // Factor 3: Momentum analysis
    const mom = parseFloat(indicators.momentum);
    if (mom > 2) {
      factors.push(`Strong positive momentum (+${mom}%)`);
      confidence += 20;
      if (action === 'SELL' && mom > 5) {
        action = 'HOLD'; // Too much momentum to sell
        factors.push('⚠️ Override: Strong momentum - holding position');
      }
    } else if (mom < -2) {
      factors.push(`Negative momentum (${mom}% decline)`);
      confidence += 20;
      if (action === 'BUY' && mom < -5) {
        action = 'HOLD'; // Too much downward pressure
        factors.push('⚠️ Override: Strong downward pressure - waiting');
      }
    } else {
      factors.push('Weak momentum (consolidating)');
      confidence += 10;
    }
    
    // Factor 4: Volatility check
    const vol = parseFloat(indicators.volatility);
    if (vol > 2000) {
      factors.push('⚠️ HIGH VOLATILITY - Risky market');
      confidence -= 15; // Reduce confidence in volatile markets
    } else if (vol < 500) {
      factors.push('Low volatility - Stable market');
      confidence += 10;
    } else {
      factors.push('Normal volatility');
      confidence += 5;
    }
    
    // Ensure confidence is between 0-100
    confidence = Math.max(0, Math.min(100, confidence));
    
    // Generate final reason
    reason = `${action} (${confidence}% confidence): ${factors.join(' | ')}`;
    
    const summary = `${action} | Price: $${currentPrice.toFixed(2)} | Trend: ${indicators.trend} | Momentum: ${indicators.momentum}%`;
    
    return {
      action,
      reason,
      confidence,
      summary
    };
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
    const mockPrice = 85000 + Math.random() * 10000;
    return { price: mockPrice, source: 'Mock Data' };
  }

  getMockAnalysis() {
    const mockPrice = 85000 + Math.random() * 10000;
    return {
      action: 'HOLD',
      price: mockPrice.toFixed(2),
      balance: this.balance,
      pair: this.tradingPair,
      signal: `HOLD | Price: $${mockPrice.toFixed(2)} | Source: Mock Data`,
      reason: 'API Error - Using mock data for demonstration',
      confidence: 0,
      indicators: {
        trend: 'UNKNOWN',
        momentum: '0.00',
        volatility: '0.00',
        sma5: mockPrice.toFixed(2),
        sma10: mockPrice.toFixed(2)
      },
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

// Home page with enhanced dashboard
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Smart Trading Bot</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                padding: 20px;
            }
            .container { max-width: 1200px; margin: 0 auto; }
            .header {
                background: white;
                padding: 30px;
                border-radius: 15px;
                margin-bottom: 20px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.2);
                text-align: center;
            }
            .header h1 { color: #333; margin-bottom: 10px; }
            .header p { color: #666; }
            .grid { 
                display: grid; 
                grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); 
                gap: 20px; 
                margin-bottom: 20px;
            }
            .card { 
                background: white; 
                padding: 25px; 
                border-radius: 15px; 
                box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            }
            .card h3 { 
                color: #333; 
                margin-bottom: 15px; 
                padding-bottom: 10px;
                border-bottom: 2px solid #f0f0f0;
            }
            .buy { color: #22c55e; font-weight: bold; font-size: 24px; } 
            .sell { color: #ef4444; font-weight: bold; font-size: 24px; } 
            .hold { color: #f59e0b; font-weight: bold; font-size: 24px; }
            .live { color: #3b82f6; font-weight: bold; }
            .mock { color: #9ca3af; font-style: italic; }
            .stat { 
                display: flex; 
                justify-content: space-between; 
                padding: 10px 0; 
                border-bottom: 1px solid #f0f0f0;
            }
            .stat:last-child { border-bottom: none; }
            .stat-label { color: #666; }
            .stat-value { font-weight: bold; color: #333; }
            button { 
                width: 100%;
                padding: 12px 20px; 
                margin: 5px 0; 
                border: none; 
                border-radius: 8px; 
                cursor: pointer; 
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                font-weight: bold;
                font-size: 14px;
                transition: transform 0.2s, box-shadow 0.2s;
            }
            button:hover { 
                transform: translateY(-2px);
                box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4);
            }
            button:active { transform: translateY(0); }
            .confidence-bar {
                width: 100%;
                height: 20px;
                background: #f0f0f0;
                border-radius: 10px;
                overflow: hidden;
                margin-top: 10px;
            }
            .confidence-fill {
                height: 100%;
                background: linear-gradient(90deg, #ef4444, #f59e0b, #22c55e);
                transition: width 0.5s ease;
            }
            .indicator-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 10px;
                margin-top: 10px;
            }
            .indicator {
                background: #f8f9fa;
                padding: 10px;
                border-radius: 8px;
                text-align: center;
            }
            .indicator-label {
                font-size: 12px;
                color: #666;
                margin-bottom: 5px;
            }
            .indicator-value {
                font-size: 16px;
                font-weight: bold;
                color: #333;
            }
            .uptrend { color: #22c55e; }
            .downtrend { color: #ef4444; }
            .neutral { color: #f59e0b; }
            @media (max-width: 768px) {
                .grid { grid-template-columns: 1fr; }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🤖 Smart Trading Bot</h1>
                <p>AI-powered cryptocurrency trading with multi-factor analysis</p>
            </div>

            <div class="grid">
                <!-- Market Analysis Card -->
                <div class="card">
                    <h3>📊 Market Analysis</h3>
                    <div id="marketData">
                        <p style="text-align: center; color: #999;">Loading market data...</p>
                    </div>
                </div>

                <!-- Technical Indicators Card -->
                <div class="card">
                    <h3>📈 Technical Indicators</h3>
                    <div id="indicators">
                        <p style="text-align: center; color: #999;">Loading indicators...</p>
                    </div>
                </div>

                <!-- Bot Control Card -->
                <div class="card">
                    <h3>🎮 Bot Controls</h3>
                    <button onclick="checkMarket()">🔄 Refresh Market Data</button>
                    <button onclick="startBot()">▶️ Start Auto-Trading</button>
                    <button onclick="stopBot()">⏹️ Stop Auto-Trading</button>
                    <button onclick="window.open('/bot-status', '_blank')">📊 View Status JSON</button>
                </div>
            </div>
        </div>

        <script>
            async function checkMarket() {
                try {
                    const response = await fetch('/check-market');
                    const data = await response.json();
                    
                    let actionClass = 'hold';
                    if (data.action === 'BUY') actionClass = 'buy';
                    if (data.action === 'SELL') actionClass = 'sell';
                    
                    let sourceClass = data.source.includes('Mock') ? 'mock' : 'live';
                    
                    // Update market analysis
                    document.getElementById('marketData').innerHTML = \`
                        <div class="stat">
                            <span class="stat-label">Signal:</span>
                            <span class="\${actionClass}">\${data.action}</span>
                        </div>
                        <div class="stat">
                            <span class="stat-label">Price:</span>
                            <span class="stat-value">$\${data.price}</span>
                        </div>
                        <div class="stat">
                            <span class="stat-label">Source:</span>
                            <span class="\${sourceClass}">\${data.source}</span>
                        </div>
                        <div class="stat">
                            <span class="stat-label">Balance:</span>
                            <span class="stat-value">$\${data.balance}</span>
                        </div>
                        <div style="margin-top: 15px;">
                            <div class="stat-label">Confidence: \${data.confidence}%</div>
                            <div class="confidence-bar">
                                <div class="confidence-fill" style="width: \${data.confidence}%"></div>
                            </div>
                        </div>
                        <div style="margin-top: 15px; padding: 15px; background: #f8f9fa; border-radius: 8px;">
                            <div class="stat-label" style="margin-bottom: 8px;">Analysis:</div>
                            <div style="font-size: 13px; line-height: 1.6; color: #555;">\${data.reason}</div>
                        </div>
                    \`;
                    
                    // Update indicators
                    if (data.indicators) {
                        let trendClass = 'neutral';
                        if (data.indicators.trend === 'UPTREND') trendClass = 'uptrend';
                        if (data.indicators.trend === 'DOWNTREND') trendClass = 'downtrend';
                        
                        document.getElementById('indicators').innerHTML = \`
                            <div class="indicator-grid">
                                <div class="indicator">
                                    <div class="indicator-label">Trend</div>
                                    <div class="indicator-value \${trendClass}">\${data.indicators.trend}</div>
                                </div>
                                <div class="indicator">
                                    <div class="indicator-label">Momentum</div>
                                    <div class="indicator-value">\${data.indicators.momentum}%</div>
                                </div>
                                <div class="indicator">
                                    <div class="indicator-label">5-Period MA</div>
                                    <div class="indicator-value">$\${data.indicators.sma5}</div>
                                </div>
                                <div class="indicator">
                                    <div class="indicator-label">10-Period MA</div>
                                    <div class="indicator-value">$\${data.indicators.sma10}</div>
                                </div>
                            </div>
                            <div style="margin-top: 15px; padding: 10px; background: #f8f9fa; border-radius: 8px; text-align: center;">
                                <div class="indicator-label">Volatility</div>
                                <div class="indicator-value">$\${data.indicators.volatility}</div>
                            </div>
                        \`;
                    }
                } catch (error) {
                    document.getElementById('marketData').innerHTML = '<p style="color: red;">Error loading market data</p>';
                    console.error('Error:', error);
                }
            }

            async function startBot() {
                try {
                    await fetch('/start-bot', { method: 'POST' });
                    alert('✅ Bot started! It will analyze the market automatically.');
                } catch (error) {
                    alert('❌ Error starting bot');
                }
            }

            async function stopBot() {
                try {
                    await fetch('/stop-bot', { method: 'POST' });
                    alert('⏹️ Bot stopped!');
                } catch (error) {
                    alert('❌ Error stopping bot');
                }
            }

            // Auto-refresh every 30 seconds
            checkMarket();
            setInterval(checkMarket, 30000);
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
    priceHistoryLength: tradingBot.priceHistory.length,
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
  res.json({ status: 'healthy', service: 'smart-trading-bot', time: new Date() });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Smart Trading Bot Server running on port ${PORT}`);
  console.log(`✅ Using advanced multi-factor analysis`);
  console.log(`✅ Real-time data from Pionex API`);
});

module.exports = app;
