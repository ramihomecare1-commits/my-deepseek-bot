const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

// Advanced Trading Bot for Multiple Cryptocurrencies
class TradingBot {
  constructor() {
    this.isRunning = false;
    this.balance = 1000;
    this.priceHistories = new Map(); // Store history for each coin
    this.maxHistory = 50;
    this.topCoins = []; // Will store top 50 coins
  }

  async initialize() {
    try {
      console.log('🔄 Initializing top 50 cryptocurrencies...');
      
      // Get top 50 cryptocurrencies from CoinGecko
      const response = await axios.get(
        'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1&sparkline=false'
      );
      
      this.topCoins = response.data.map(coin => ({
        id: coin.id,
        symbol: coin.symbol.toUpperCase(),
        name: coin.name,
        current_price: coin.current_price,
        market_cap: coin.market_cap,
        price_change_24h: coin.price_change_24h,
        price_change_percentage_24h: coin.price_change_percentage_24h
      }));

      console.log(`✅ Loaded ${this.topCoins.length} top cryptocurrencies`);
      console.log('🏆 Top 10:', this.topCoins.slice(0, 10).map(c => c.symbol).join(', '));
      
      // Initialize price history for each coin
      await this.initializePriceHistories();
      
    } catch (error) {
      console.log('❌ Failed to load top coins, using major coins only');
      this.topCoins = this.getMajorCoins();
      await this.initializePriceHistories();
    }
  }

  getMajorCoins() {
    // Fallback major coins if API fails
    return [
      { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', current_price: 40000 },
      { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', current_price: 2200 },
      { id: 'binancecoin', symbol: 'BNB', name: 'Binance Coin', current_price: 300 },
      { id: 'ripple', symbol: 'XRP', name: 'XRP', current_price: 0.6 },
      { id: 'cardano', symbol: 'ADA', name: 'Cardano', current_price: 0.4 },
      { id: 'solana', symbol: 'SOL', name: 'Solana', current_price: 100 },
      { id: 'polkadot', symbol: 'DOT', name: 'Polkadot', current_price: 7 },
      { id: 'dogecoin', symbol: 'DOGE', name: 'Dogecoin', current_price: 0.08 },
      { id: 'avalanche-2', symbol: 'AVAX', name: 'Avalanche', current_price: 35 },
      { id: 'chainlink', symbol: 'LINK', name: 'Chainlink', current_price: 14 }
    ];
  }

  async initializePriceHistories() {
    for (const coin of this.topCoins) {
      const history = [];
      const currentPrice = coin.current_price;
      
      // Generate realistic historical prices
      for (let i = this.maxHistory; i > 0; i--) {
        const variation = (Math.random() - 0.5) * (currentPrice * 0.1); // ±10% variation
        const historicalPrice = Math.max(currentPrice + (variation * (i / this.maxHistory)), 0.0001);
        history.push(historicalPrice);
      }
      
      // Add current price
      history.push(currentPrice);
      this.priceHistories.set(coin.symbol, history);
    }
    
    console.log(`✅ Price histories initialized for ${this.priceHistories.size} coins`);
  }

  async analyzeAllMarkets() {
    try {
      console.log('📊 Analyzing all 50 cryptocurrencies...');
      
      // Update all coin prices
      await this.updateAllPrices();
      
      const analyses = [];
      let buyOpportunities = [];
      let sellOpportunities = [];
      
      // Analyze each coin
      for (const coin of this.topCoins) {
        const analysis = await this.analyzeCoin(coin);
        analyses.push(analysis);
        
        if (analysis.action === 'BUY' && analysis.confidence > 0.6) {
          buyOpportunities.push(analysis);
        } else if (analysis.action === 'SELL' && analysis.confidence > 0.6) {
          sellOpportunities.push(analysis);
        }
      }
      
      // Sort by confidence
      buyOpportunities.sort((a, b) => b.confidence - a.confidence);
      sellOpportunities.sort((a, b) => b.confidence - a.confidence);
      
      return {
        summary: {
          totalCoins: analyses.length,
          buySignals: buyOpportunities.length,
          sellSignals: sellOpportunities.length,
          holdSignals: analyses.filter(a => a.action === 'HOLD').length,
          timestamp: new Date()
        },
        topBuys: buyOpportunities.slice(0, 5),
        topSells: sellOpportunities.slice(0, 5),
        allAnalyses: analyses
      };
      
    } catch (error) {
      console.log('Analysis error:', error.message);
      return this.getMockAnalysis();
    }
  }

  async analyzeCoin(coin) {
    const history = this.priceHistories.get(coin.symbol) || [];
    const currentPrice = history[history.length - 1] || coin.current_price;
    
    // Calculate technical indicators
    const sma20 = this.calculateSMA(history, 20);
    const sma10 = this.calculateSMA(history, 10);
    const rsi = this.calculateRSI(history, 14);
    const priceChange24h = this.calculatePriceChange(history, 24);
    const volatility = this.calculateVolatility(history);

    // Generate signals
    const signals = [];
    let confidence = 0;

    // Moving Average Crossover
    const maDiff = ((sma10 - sma20) / sma20) * 100;
    if (maDiff > 2) {
      signals.push(`Bullish MA crossover (+${maDiff.toFixed(1)}%)`);
      confidence += 0.3;
    } else if (maDiff < -2) {
      signals.push(`Bearish MA crossover (${maDiff.toFixed(1)}%)`);
      confidence += 0.3;
    }

    // RSI Analysis
    if (rsi < 30) {
      signals.push(`Oversold (RSI: ${rsi.toFixed(1)})`);
      confidence += 0.25;
    } else if (rsi > 70) {
      signals.push(`Overbought (RSI: ${rsi.toFixed(1)})`);
      confidence += 0.25;
    }

    // Price Momentum
    if (priceChange24h > 5) {
      signals.push(`Strong uptrend (+${priceChange24h.toFixed(1)}%)`);
      confidence += 0.2;
    } else if (priceChange24h < -5) {
      signals.push(`Strong downtrend (${priceChange24h.toFixed(1)}%)`);
      confidence += 0.2;
    }

    // Volatility
    if (volatility > 8) {
      signals.push(`High volatility (${volatility.toFixed(1)}%)`);
    }

    // Determine action
    let action = 'HOLD';
    let reason = 'Neutral market conditions';

    if (signals.length > 0) {
      const bullishCount = signals.filter(s => s.includes('Bullish') || s.includes('Oversold') || s.includes('uptrend')).length;
      const bearishCount = signals.filter(s => s.includes('Bearish') || s.includes('Overbought') || s.includes('downtrend')).length;

      if (bullishCount > bearishCount && confidence >= 0.5) {
        action = 'BUY';
        reason = `Bullish: ${signals.join(', ')}`;
      } else if (bearishCount > bullishCount && confidence >= 0.5) {
        action = 'SELL';
        reason = `Bearish: ${signals.join(', ')}`;
      } else {
        reason = `Mixed: ${signals.join(', ')}`;
      }
    }

    return {
      symbol: coin.symbol,
      name: coin.name,
      action,
      price: currentPrice.toFixed(coin.symbol === 'BTC' ? 2 : 4),
      priceChange24h: `${priceChange24h.toFixed(2)}%`,
      signal: `${action} | Confidence: ${(confidence * 100).toFixed(0)}%`,
      reason,
      confidence,
      indicators: {
        sma10: sma10.toFixed(4),
        sma20: sma20.toFixed(4),
        rsi: rsi.toFixed(1),
        volatility: `${volatility.toFixed(1)}%`
      }
    };
  }

  async updateAllPrices() {
    try {
      // Get all prices from CoinGecko in one API call
      const coinIds = this.topCoins.map(coin => coin.id).join(',');
      const response = await axios.get(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coinIds}&vs_currencies=usd&include_24hr_change=true`
      );

      for (const coin of this.topCoins) {
        if (response.data[coin.id] && response.data[coin.id].usd) {
          const newPrice = response.data[coin.id].usd;
          const history = this.priceHistories.get(coin.symbol) || [];
          
          // Update history
          history.push(newPrice);
          if (history.length > this.maxHistory) {
            history.shift();
          }
          this.priceHistories.set(coin.symbol, history);
        }
      }
      
    } catch (error) {
      console.log('Price update failed:', error.message);
      // Continue with existing prices
    }
  }

  // Technical indicator calculations (same as before but for array)
  calculateSMA(prices, period) {
    if (!prices || prices.length < period) return prices[prices.length - 1] || 0;
    const slice = prices.slice(-period);
    return slice.reduce((sum, price) => sum + price, 0) / slice.length;
  }

  calculateRSI(prices, period = 14) {
    if (!prices || prices.length < period + 1) return 50;

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
      const change = prices[prices.length - i] - prices[prices.length - i - 1];
      if (change > 0) gains += change;
      else losses -= change;
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  calculatePriceChange(prices, periods) {
    if (!prices || prices.length < periods) return 0;
    const oldPrice = prices[prices.length - periods];
    const newPrice = prices[prices.length - 1];
    return ((newPrice - oldPrice) / oldPrice) * 100;
  }

  calculateVolatility(prices) {
    if (!prices || prices.length < 2) return 0;
    
    const sma = this.calculateSMA(prices, prices.length);
    const variance = prices.reduce((sum, price) => sum + Math.pow(price - sma, 2), 0) / prices.length;
    return (Math.sqrt(variance) / sma) * 100;
  }

  startBot() {
    this.isRunning = true;
    console.log('🤖 Multi-Crypto Trading Bot started');
    return { status: 'started', time: new Date() };
  }

  stopBot() {
    this.isRunning = false;
    console.log('🛑 Trading bot stopped');
    return { status: 'stopped', time: new Date() };
  }
}

const tradingBot = new TradingBot();

// Initialize when server starts
tradingBot.initialize();

// ===== ROUTES =====

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Multi-Crypto Trading Bot</title>
        <style>
            body { font-family: Arial, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }
            .card { background: #f5f5f5; padding: 20px; margin: 10px 0; border-radius: 8px; }
            .buy { color: green; font-weight: bold; } 
            .sell { color: red; font-weight: bold; } 
            .hold { color: orange; font-weight: bold; }
            .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 15px 0; }
            .summary-item { background: white; padding: 15px; text-align: center; border-radius: 5px; }
            .opportunity { background: white; padding: 10px; margin: 5px 0; border-radius: 5px; border-left: 4px solid #007bff; }
            .buy-opp { border-left-color: green; }
            .sell-opp { border-left-color: red; }
            button { padding: 10px 20px; margin: 5px; border: none; border-radius: 4px; cursor: pointer; background: #007bff; color: white; }
            table { width: 100%; border-collapse: collapse; margin: 10px 0; }
            th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
            th { background: #e9ecef; }
        </style>
    </head>
    <body>
        <h1>🤖 Multi-Crypto Trading Bot</h1>
        <p>Tracking & Analyzing Top 50 Cryptocurrencies</p>
        
        <div class="card">
            <h3>Quick Actions:</h3>
            <button onclick="analyzeAll()">Analyze All 50 Coins</button>
            <button onclick="startBot()">Start Auto-Trading</button>
            <button onclick="stopBot()">Stop Auto-Trading</button>
        </div>

        <div class="card">
            <h3>Market Summary:</h3>
            <div id="summary">Click "Analyze All 50 Coins" to load...</div>
        </div>

        <div class="card">
            <h3>Top Trading Opportunities:</h3>
            <div id="opportunities">Waiting for analysis...</div>
        </div>

        <div class="card">
            <h3>All Coin Analysis:</h3>
            <div id="allAnalyses">Complete analysis will appear here...</div>
        </div>

        <script>
            async function analyzeAll() {
                try {
                    const response = await fetch('/analyze-all');
                    const data = await response.json();
                    
                    // Update summary
                    document.getElementById('summary').innerHTML = \`
                        <div class="summary-grid">
                            <div class="summary-item">
                                <h4>Total Coins</h4>
                                <p style="font-size: 1.5em;">\${data.summary.totalCoins}</p>
                            </div>
                            <div class="summary-item" style="background: #e8f5e8;">
                                <h4>Buy Signals</h4>
                                <p style="font-size: 1.5em; color: green;">\${data.summary.buySignals}</p>
                            </div>
                            <div class="summary-item" style="background: #f8d7da;">
                                <h4>Sell Signals</h4>
                                <p style="font-size: 1.5em; color: red;">\${data.summary.sellSignals}</p>
                            </div>
                            <div class="summary-item" style="background: #fff3cd;">
                                <h4>Hold Signals</h4>
                                <p style="font-size: 1.5em; color: orange;">\${data.summary.holdSignals}</p>
                            </div>
                        </div>
                        <p><em>Last updated: \${new Date(data.summary.timestamp).toLocaleString()}</em></p>
                    \`;
                    
                    // Update opportunities
                    let opportunitiesHTML = '<h4>Best Buy Opportunities:</h4>';
                    data.topBuys.forEach(opp => {
                        opportunitiesHTML += \`
                            <div class="opportunity buy-opp">
                                <strong>\${opp.symbol}</strong> - \${opp.name} | $\${opp.price}
                                <br><small>\${opp.reason}</small>
                                <br><small>Confidence: \${(opp.confidence * 100).toFixed(0)}% | 24h: \${opp.priceChange24h}</small>
                            </div>
                        \`;
                    });
                    
                    opportunitiesHTML += '<h4>Best Sell Opportunities:</h4>';
                    data.topSells.forEach(opp => {
                        opportunitiesHTML += \`
                            <div class="opportunity sell-opp">
                                <strong>\${opp.symbol}</strong> - \${opp.name} | $\${opp.price}
                                <br><small>\${opp.reason}</small>
                                <br><small>Confidence: \${(opp.confidence * 100).toFixed(0)}% | 24h: \${opp.priceChange24h}</small>
                            </div>
                        \`;
                    });
                    
                    document.getElementById('opportunities').innerHTML = opportunitiesHTML;
                    
                    // Update all analyses table
                    let tableHTML = \`
                        <table>
                            <thead>
                                <tr>
                                    <th>Coin</th>
                                    <th>Price</th>
                                    <th>Action</th>
                                    <th>Confidence</th>
                                    <th>24h Change</th>
                                    <th>RSI</th>
                                </tr>
                            </thead>
                            <tbody>
                    \`;
                    
                    data.allAnalyses.forEach(analysis => {
                        const actionClass = analysis.action.toLowerCase();
                        tableHTML += \`
                            <tr>
                                <td><strong>\${analysis.symbol}</strong> - \${analysis.name}</td>
                                <td>$\${analysis.price}</td>
                                <td class="\${actionClass}">\${analysis.action}</td>
                                <td>\${(analysis.confidence * 100).toFixed(0)}%</td>
                                <td>\${analysis.priceChange24h}</td>
                                <td>\${analysis.indicators.rsi}</td>
                            </tr>
                        \`;
                    });
                    
                    tableHTML += '</tbody></table>';
                    document.getElementById('allAnalyses').innerHTML = tableHTML;
                    
                } catch (error) {
                    document.getElementById('summary').innerHTML = 'Error loading analysis';
                }
            }

            async function startBot() {
                try {
                    await fetch('/start-bot', { method: 'POST' });
                    alert('Multi-crypto trading bot started!');
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

            // Auto-analyze on page load
            analyzeAll();
        </script>
    </body>
    </html>
  `);
});

// NEW ROUTE: Analyze all coins
app.get('/analyze-all', async (req, res) => {
  try {
    const analysis = await tradingBot.analyzeAllMarkets();
    res.json(analysis);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Keep existing routes
app.get('/bot-status', (req, res) => {
  res.json({
    running: tradingBot.isRunning,
    coinsTracked: tradingBot.topCoins.length,
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
  res.json({ status: 'healthy', service: 'multi-crypto-bot', time: new Date() });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Multi-Crypto Trading Bot running on port ${PORT}`);
  console.log(`✅ Tracking top 50 cryptocurrencies`);
});

module.exports = app;
