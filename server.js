const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

// Simple Multi-Crypto Trading Bot
class MultiCryptoBot {
  constructor() {
    this.isRunning = false;
    this.trackedCoins = [
      { symbol: 'BTC', name: 'Bitcoin', id: 'bitcoin' },
      { symbol: 'ETH', name: 'Ethereum', id: 'ethereum' },
      { symbol: 'BNB', name: 'Binance Coin', id: 'binancecoin' },
      { symbol: 'XRP', name: 'Ripple', id: 'ripple' },
      { symbol: 'ADA', name: 'Cardano', id: 'cardano' },
      { symbol: 'SOL', name: 'Solana', id: 'solana' },
      { symbol: 'DOT', name: 'Polkadot', id: 'polkadot' },
      { symbol: 'DOGE', name: 'Dogecoin', id: 'dogecoin' },
      { symbol: 'AVAX', name: 'Avalanche', id: 'avalanche-2' },
      { symbol: 'LINK', name: 'Chainlink', id: 'chainlink' }
    ];
    this.priceHistory = new Map();
  }

  async analyzeAllCoins() {
    try {
      console.log('📊 Analyzing multiple cryptocurrencies...');
      
      // Get all prices at once
      const coinIds = this.trackedCoins.map(coin => coin.id).join(',');
      const response = await axios.get(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coinIds}&vs_currencies=usd&include_24hr_change=true`
      );

      const analyses = [];
      
      for (const coin of this.trackedCoins) {
        if (response.data[coin.id]) {
          const price = response.data[coin.id].usd;
          const change24h = response.data[coin.id].usd_24h_change || 0;
          
          const analysis = this.analyzeCoin(coin, price, change24h);
          analyses.push(analysis);
        }
      }

      // Sort by confidence (highest first)
      analyses.sort((a, b) => b.confidence - a.confidence);
      
      return {
        totalCoins: analyses.length,
        timestamp: new Date(),
        analyses: analyses
      };
      
    } catch (error) {
      console.log('Analysis error:', error.message);
      return this.getMockAnalysis();
    }
  }

  analyzeCoin(coin, price, change24h) {
    // Simple analysis logic
    let action = 'HOLD';
    let reason = 'Neutral market conditions';
    let confidence = 0.1;

    // Price change based signals
    if (change24h > 10) {
      action = 'SELL';
      reason = `Strong pump: +${change24h.toFixed(1)}% in 24h - take profits`;
      confidence = 0.7;
    } else if (change24h > 5) {
      action = 'HOLD';
      reason = `Uptrend: +${change24h.toFixed(1)}% in 24h - monitor closely`;
      confidence = 0.4;
    } else if (change24h < -10) {
      action = 'BUY';
      reason = `Strong dump: ${change24h.toFixed(1)}% in 24h - buying opportunity`;
      confidence = 0.7;
    } else if (change24h < -5) {
      action = 'BUY';
      reason = `Downtrend: ${change24h.toFixed(1)}% in 24h - consider buying`;
      confidence = 0.5;
    } else if (change24h > 2) {
      action = 'HOLD';
      reason = `Slight uptrend: +${change24h.toFixed(1)}% in 24h`;
      confidence = 0.3;
    } else if (change24h < -2) {
      action = 'HOLD';
      reason = `Slight downtrend: ${change24h.toFixed(1)}% in 24h`;
      confidence = 0.3;
    }

    // Add volatility consideration
    if (Math.abs(change24h) > 15) {
      reason += ' | High volatility - be cautious';
      confidence *= 0.8; // Reduce confidence for high volatility
    }

    return {
      symbol: coin.symbol,
      name: coin.name,
      action,
      price: price.toFixed(coin.symbol === 'BTC' ? 2 : 4),
      change24h: `${change24h.toFixed(2)}%`,
      reason,
      confidence: Math.min(confidence, 0.95), // Cap at 95%
      signal: `${action} (${(confidence * 100).toFixed(0)}% confidence)`
    };
  }

  getMockAnalysis() {
    const mockAnalyses = this.trackedCoins.map(coin => ({
      symbol: coin.symbol,
      name: coin.name,
      action: 'HOLD',
      price: (Math.random() * 1000).toFixed(4),
      change24h: `${(Math.random() * 20 - 10).toFixed(2)}%`,
      reason: 'Using mock data - API unavailable',
      confidence: 0.1,
      signal: 'HOLD (10% confidence)'
    }));
    
    return {
      totalCoins: mockAnalyses.length,
      timestamp: new Date(),
      analyses: mockAnalyses
    };
  }

  startBot() {
    this.isRunning = true;
    console.log('🤖 Multi-Crypto Bot Started');
    console.log(`📈 Tracking ${this.trackedCoins.length} cryptocurrencies`);
    return { status: 'started', coins: this.trackedCoins.length, time: new Date() };
  }

  stopBot() {
    this.isRunning = false;
    console.log('🛑 Multi-Crypto Bot Stopped');
    return { status: 'stopped', time: new Date() };
  }
}

const tradingBot = new MultiCryptoBot();

// ===== ROUTES =====

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Multi-Crypto Trading Bot</title>
        <style>
            body { font-family: Arial, sans-serif; max-width: 1000px; margin: 0 auto; padding: 20px; }
            .card { background: #f5f5f5; padding: 20px; margin: 10px 0; border-radius: 8px; }
            .buy { color: green; font-weight: bold; background: #e8f5e8; padding: 2px 6px; border-radius: 3px; }
            .sell { color: red; font-weight: bold; background: #f8d7da; padding: 2px 6px; border-radius: 3px; }
            .hold { color: orange; font-weight: bold; background: #fff3cd; padding: 2px 6px; border-radius: 3px; }
            button { padding: 10px 20px; margin: 5px; border: none; border-radius: 4px; cursor: pointer; background: #007bff; color: white; }
            button:hover { background: #0056b3; }
            table { width: 100%; border-collapse: collapse; margin: 10px 0; }
            th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
            th { background: #e9ecef; }
            .high-confidence { opacity: 1; }
            .medium-confidence { opacity: 0.8; }
            .low-confidence { opacity: 0.6; }
        </style>
    </head>
    <body>
        <h1>🤖 Multi-Crypto Trading Bot</h1>
        <p>Simple & Effective Cryptocurrency Analysis</p>
        
        <div class="card">
            <h3>Quick Actions:</h3>
            <button onclick="analyzeAll()">Analyze All Coins</button>
            <button onclick="startBot()">Start Auto-Trading</button>
            <button onclick="stopBot()">Stop Auto-Trading</button>
        </div>

        <div class="card">
            <h3>Cryptocurrency Analysis:</h3>
            <div id="results">
                <p>Click "Analyze All Coins" to see trading signals for all tracked cryptocurrencies.</p>
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
                                    <th>Price (USD)</th>
                                    <th>24h Change</th>
                                    <th>Action</th>
                                    <th>Confidence</th>
                                    <th>Reason</th>
                                </tr>
                            </thead>
                            <tbody>
                    \`;
                    
                    data.analyses.forEach(coin => {
                        const actionClass = coin.action.toLowerCase();
                        let confidenceClass = 'low-confidence';
                        if (coin.confidence > 0.6) confidenceClass = 'high-confidence';
                        else if (coin.confidence > 0.3) confidenceClass = 'medium-confidence';
                        
                        tableHTML += \`
                            <tr class="\${confidenceClass}">
                                <td><strong>\${coin.symbol}</strong><br><small>\${coin.name}</small></td>
                                <td>$\${coin.price}</td>
                                <td style="color: \${coin.change24h.includes('-') ? 'red' : 'green'};">\${coin.change24h}</td>
                                <td><span class="\${actionClass}">\${coin.action}</span></td>
                                <td>\${(coin.confidence * 100).toFixed(0)}%</td>
                                <td><small>\${coin.reason}</small></td>
                            </tr>
                        \`;
                    });
                    
                    tableHTML += '</tbody></table>';
                    tableHTML += \`<p><em>Last updated: \${new Date(data.timestamp).toLocaleString()} | Total coins: \${data.totalCoins}</em></p>\`;
                    
                    document.getElementById('results').innerHTML = tableHTML;
                    
                } catch (error) {
                    document.getElementById('results').innerHTML = '<p style="color: red;">Error loading analysis. Please try again.</p>';
                }
            }

            async function startBot() {
                try {
                    const response = await fetch('/start-bot', { method: 'POST' });
                    const result = await response.json();
                    alert(\`Bot started! Tracking \${result.coins} cryptocurrencies.\`);
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
    coinList: tradingBot.trackedCoins.map(c => c.symbol),
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
    service: 'multi-crypto-bot', 
    coins: tradingBot.trackedCoins.length,
    time: new Date() 
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Multi-Crypto Trading Bot running on port ${PORT}`);
  console.log(`✅ Tracking ${tradingBot.trackedCoins.length} major cryptocurrencies`);
  console.log(`🏆 Coins: ${tradingBot.trackedCoins.map(c => c.symbol).join(', ')}`);
});

module.exports = app;
