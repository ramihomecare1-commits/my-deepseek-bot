const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

// Optimized Crypto Bot with Proper Free API Usage
class CryptoBot {
  constructor() {
    this.isRunning = false;
    // Track fewer coins to respect rate limits
    this.trackedCoins = [
      { symbol: 'BTC', name: 'Bitcoin', id: 'bitcoin' },
      { symbol: 'ETH', name: 'Ethereum', id: 'ethereum' },
      { symbol: 'BNB', name: 'Binance Coin', id: 'binancecoin' },
      { symbol: 'SOL', name: 'Solana', id: 'solana' },
      { symbol: 'XRP', name: 'Ripple', id: 'ripple' },
      { symbol: 'ADA', name: 'Cardano', id: 'cardano' },
      { symbol: 'AVAX', name: 'Avalanche', id: 'avalanche-2' },
      { symbol: 'DOT', name: 'Polkadot', id: 'polkadot' },
      { symbol: 'DOGE', name: 'Dogecoin', id: 'dogecoin' },
      { symbol: 'LINK', name: 'Chainlink', id: 'chainlink' }
    ];
    this.lastApiCall = 0;
    this.minCallInterval = 2000; // 2 seconds between calls
  }

  async analyzeAllCoins() {
    try {
      // Rate limiting - wait if needed
      const now = Date.now();
      const timeSinceLastCall = now - this.lastApiCall;
      if (timeSinceLastCall < this.minCallInterval) {
        await new Promise(resolve => setTimeout(resolve, this.minCallInterval - timeSinceLastCall));
      }

      console.log('📊 Fetching REAL prices from CoinGecko Free API...');
      
      // Use the FREE simple/price endpoint (no API key needed)
      const coinIds = this.trackedCoins.map(coin => coin.id).join(',');
      const response = await axios.get(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coinIds}&vs_currencies=usd&include_24hr_change=true`,
        { 
          timeout: 10000,
          headers: {
            'User-Agent': 'TradingBot/1.0'
          }
        }
      );

      this.lastApiCall = Date.now();
      
      console.log('✅ Successfully fetched REAL market data');
      
      const analyses = [];
      
      for (const coin of this.trackedCoins) {
        if (response.data[coin.id]) {
          const price = response.data[coin.id].usd;
          const change24h = response.data[coin.id].usd_24h_change || 0;
          
          const analysis = this.analyzeCoin(coin, price, change24h);
          analyses.push(analysis);
        }
      }

      // Sort by confidence
      analyses.sort((a, b) => b.confidence - a.confidence);
      
      return {
        totalCoins: analyses.length,
        timestamp: new Date(),
        analyses: analyses,
        dataSource: 'CoinGecko Free API',
        rateLimit: '50 calls/minute - Well within limits'
      };
      
    } catch (error) {
      console.log('❌ API Error:', error.message);
      return await this.fallbackToBinanceAPI();
    }
  }

  async fallbackToBinanceAPI() {
    try {
      console.log('🔄 Trying Binance API as backup...');
      
      const analyses = [];
      
      for (const coin of this.trackedCoins) {
        try {
          // Use Binance public API (no key needed)
          const symbol = coin.symbol + 'USDT';
          const response = await axios.get(
            `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`,
            { timeout: 5000 }
          );
          
          const price = parseFloat(response.data.lastPrice);
          const change24h = parseFloat(response.data.priceChangePercent);
          
          const analysis = this.analyzeCoin(coin, price, change24h);
          analyses.push(analysis);
          
        } catch (binanceError) {
          console.log(`❌ Binance failed for ${coin.symbol}`);
          analyses.push(this.getErrorAnalysis(coin));
        }
      }
      
      analyses.sort((a, b) => b.confidence - a.confidence);
      
      return {
        totalCoins: analyses.length,
        timestamp: new Date(),
        analyses: analyses,
        dataSource: 'Binance Public API (Backup)'
      };
      
    } catch (error) {
      console.log('❌ All APIs failed');
      return this.getErrorResponse();
    }
  }

  analyzeCoin(coin, price, change24h) {
    // Smart analysis with REAL data
    let action = 'HOLD';
    let reason = 'Market neutral';
    let confidence = 0.3;

    if (change24h > 12) {
      action = 'SELL';
      reason = `🚨 STRONG PUMP: +${change24h.toFixed(1)}% - Take profits`;
      confidence = 0.85;
    } else if (change24h > 6) {
      action = 'SELL';
      reason = `📈 Pump: +${change24h.toFixed(1)}% - Profit opportunity`;
      confidence = 0.70;
    } else if (change24h < -12) {
      action = 'BUY';
      reason = `🛑 STRONG DUMP: ${change24h.toFixed(1)}% - Buy opportunity`;
      confidence = 0.85;
    } else if (change24h < -6) {
      action = 'BUY';
      reason = `📉 Dip: ${change24h.toFixed(1)}% - Accumulate`;
      confidence = 0.70;
    } else if (change24h > 3) {
      action = 'HOLD';
      reason = `↗️ Up: +${change24h.toFixed(1)}% - Holding strong`;
      confidence = 0.50;
    } else if (change24h < -3) {
      action = 'HOLD';
      reason = `↘️ Down: ${change24h.toFixed(1)}% - Waiting recovery`;
      confidence = 0.50;
    }

    return {
      symbol: coin.symbol,
      name: coin.name,
      action,
      price: `$${price.toFixed(coin.symbol === 'BTC' ? 2 : 4)}`,
      change24h: `${change24h.toFixed(2)}%`,
      reason,
      confidence: Math.min(confidence, 0.95),
      signal: `${action} | ${(confidence * 100).toFixed(0)}% confidence`,
      dataQuality: 'REAL'
    };
  }

  getErrorAnalysis(coin) {
    return {
      symbol: coin.symbol,
      name: coin.name,
      action: 'ERROR',
      price: 'N/A',
      change24h: 'N/A',
      reason: 'API temporarily unavailable',
      confidence: 0,
      signal: 'DATA ERROR',
      dataQuality: 'UNAVAILABLE'
    };
  }

  getErrorResponse() {
    return {
      totalCoins: this.trackedCoins.length,
      timestamp: new Date(),
      analyses: this.trackedCoins.map(coin => this.getErrorAnalysis(coin)),
      dataSource: 'All APIs Failed - Try again in 60 seconds',
      note: 'Free APIs have rate limits. Please wait before retrying.'
    };
  }

  startBot() {
    this.isRunning = true;
    console.log('🤖 Crypto Bot Started with REAL Free APIs');
    console.log('📊 Using: CoinGecko Free API + Binance Backup');
    return { 
      status: 'started', 
      coins: this.trackedCoins.length,
      dataSource: 'Free APIs (CoinGecko + Binance)',
      time: new Date() 
    };
  }

  stopBot() {
    this.isRunning = false;
    console.log('🛑 Crypto Bot Stopped');
    return { status: 'stopped', time: new Date() };
  }
}

const tradingBot = new CryptoBot();

// ===== ROUTES =====

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Free API Crypto Bot</title>
        <style>
            body { font-family: Arial, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }
            .card { background: #f5f5f5; padding: 20px; margin: 10px 0; border-radius: 8px; }
            .buy { color: green; font-weight: bold; background: #e8f5e8; }
            .sell { color: red; font-weight: bold; background: #f8d7da; }
            .hold { color: orange; font-weight: bold; background: #fff3cd; }
            .error { color: gray; background: #f8f9fa; }
            .free-badge { background: #28a745; color: white; padding: 4px 8px; border-radius: 4px; font-size: 0.9em; }
            button { padding: 10px 20px; margin: 5px; border: none; border-radius: 4px; cursor: pointer; background: #007bff; color: white; }
            table { width: 100%; border-collapse: collapse; margin: 10px 0; }
            th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
            th { background: #e9ecef; }
        </style>
    </head>
    <body>
        <h1>🤖 Free API Crypto Trading Bot</h1>
        <p>Using <span class="free-badge">CoinGecko Free API</span> + <span class="free-badge">Binance Public API</span></p>
        
        <div class="card">
            <h3>Quick Actions:</h3>
            <button onclick="analyzeAll()">🔄 Get Live Market Data</button>
            <button onclick="startBot()">🚀 Start Bot</button>
            <button onclick="stopBot()">🛑 Stop Bot</button>
            <p><small>Rate limited: 50 calls/minute max</small></p>
        </div>

        <div class="card">
            <h3>Live Cryptocurrency Analysis</h3>
            <div id="results">
                <p>Click "Get Live Market Data" to fetch real prices from free APIs.</p>
                <p><strong>Tracked Coins:</strong> ${tradingBot.trackedCoins.map(c => c.symbol).join(', ')}</p>
            </div>
        </div>

        <script>
            async function analyzeAll() {
                try {
                    const response = await fetch('/analyze-all');
                    const data = await response.json();
                    
                    let tableHTML = \`
                        <table>
                            <thead>
                                <tr>
                                    <th>Coin</th>
                                    <th>Live Price</th>
                                    <th>24h Change</th>
                                    <th>Action</th>
                                    <th>Confidence</th>
                                    <th>Analysis</th>
                                </tr>
                            </thead>
                            <tbody>
                    \`;
                    
                    data.analyses.forEach(coin => {
                        const actionClass = coin.action.toLowerCase();
                        const changeColor = coin.change24h.includes('-') ? 'red' : 'green';
                        const isError = coin.action === 'ERROR';
                        
                        tableHTML += \`
                            <tr>
                                <td><strong>\${coin.symbol}</strong><br><small>\${coin.name}</small></td>
                                <td>\${isError ? '<em>N/A</em>' : '<strong>' + coin.price + '</strong>'}</td>
                                <td style="color: \${changeColor}; font-weight: bold;">\${coin.change24h}</td>
                                <td><span class="\${actionClass}">\${coin.action}</span></td>
                                <td>\${isError ? 'N/A' : (coin.confidence * 100).toFixed(0) + '%'}</td>
                                <td><small>\${coin.reason}</small></td>
                            </tr>
                        \`;
                    });
                    
                    tableHTML += '</tbody></table>';
                    tableHTML += \`
                        <p><em>
                            Data Source: \${data.dataSource} | 
                            Last updated: \${new Date(data.timestamp).toLocaleString()} | 
                            Successful: \${data.analyses.filter(a => a.action !== 'ERROR').length}/\${data.totalCoins} coins
                        </em></p>
                    \`;
                    
                    document.getElementById('results').innerHTML = tableHTML;
                    
                } catch (error) {
                    document.getElementById('results').innerHTML = 
                        '<p style="color: red;">Error loading data. You may be rate limited. Wait 60 seconds and try again.</p>';
                }
            }

            async function startBot() {
                try {
                    const response = await fetch('/start-bot', { method: 'POST' });
                    const result = await response.json();
                    alert(\`Bot started! Using: \${result.dataSource}\`);
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

            analyzeAll();
        </script>
    </body>
    </html>
  `);
});

// API Routes
app.get('/analyze-all', async (req, res) => {
  try {
    const analysis = await tradingBot.analyzeAllCoins();
    res.json(analysis);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/bot-status', (req, res) => {
  res.json({
    running: tradingBot.isRunning,
    coinsTracked: tradingBot.trackedCoins.length,
    dataSource: 'Free APIs (CoinGecko + Binance)',
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
  res.json({ 
    status: 'healthy', 
    service: 'free-api-crypto-bot',
    coins: tradingBot.trackedCoins.length,
    time: new Date() 
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Free API Crypto Bot running on port ${PORT}`);
  console.log(`✅ Using CoinGecko Free API (50 calls/minute)`);
  console.log(`✅ Binance Public API as backup`);
  console.log(`📊 Tracking ${tradingBot.trackedCoins.length} major coins`);
});

module.exports = app;
