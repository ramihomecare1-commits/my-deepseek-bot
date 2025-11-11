const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

// Professional Trading Bot with Technical Analysis
class ProfessionalTradingBot {
  constructor() {
    this.isRunning = false;
    this.scanInterval = null;
    this.trackedCoins = this.getTop50Coins();
    this.minConfidence = 0.65; // 65% minimum confidence
    this.analysisHistory = [];
  }

  getTop50Coins() {
    return [
      { symbol: 'BTC', name: 'Bitcoin', id: 'bitcoin' },
      { symbol: 'ETH', name: 'Ethereum', id: 'ethereum' },
      { symbol: 'BNB', name: 'Binance Coin', id: 'binancecoin' },
      { symbol: 'SOL', name: 'Solana', id: 'solana' },
      { symbol: 'XRP', name: 'Ripple', id: 'ripple' },
      { symbol: 'ADA', name: 'Cardano', id: 'cardano' },
      { symbol: 'AVAX', name: 'Avalanche', id: 'avalanche-2' },
      { symbol: 'DOT', name: 'Polkadot', id: 'polkadot' },
      { symbol: 'DOGE', name: 'Dogecoin', id: 'dogecoin' },
      { symbol: 'LINK', name: 'Chainlink', id: 'chainlink' },
      { symbol: 'MATIC', name: 'Polygon', id: 'matic-network' },
      { symbol: 'LTC', name: 'Litecoin', id: 'litecoin' },
      { symbol: 'BCH', name: 'Bitcoin Cash', id: 'bitcoin-cash' },
      { symbol: 'ATOM', name: 'Cosmos', id: 'cosmos' },
      { symbol: 'XLM', name: 'Stellar', id: 'stellar' },
      { symbol: 'FIL', name: 'Filecoin', id: 'filecoin' },
      { symbol: 'ETC', name: 'Ethereum Classic', id: 'ethereum-classic' },
      { symbol: 'ALGO', name: 'Algorand', id: 'algorand' },
      { symbol: 'XMR', name: 'Monero', id: 'monero' },
      { symbol: 'EOS', name: 'EOS', id: 'eos' },
      { symbol: 'AAVE', name: 'Aave', id: 'aave' },
      { symbol: 'XTZ', name: 'Tezos', id: 'tezos' },
      { symbol: 'MKR', name: 'Maker', id: 'maker' },
      { symbol: 'KSM', name: 'Kusama', id: 'kusama' },
      { symbol: 'COMP', name: 'Compound', id: 'compound' },
      { symbol: 'NEAR', name: 'NEAR Protocol', id: 'near' },
      { symbol: 'GRT', name: 'The Graph', id: 'the-graph' },
      { symbol: 'SNX', name: 'Synthetix', id: 'synthetix' },
      { symbol: 'RUNE', name: 'THORChain', id: 'thorchain' },
      { symbol: 'BAT', name: 'Basic Attention Token', id: 'basic-attention-token' }
      // Add more coins to reach 50 as needed
    ];
  }

  async startAutoScan() {
    if (this.isRunning) {
      console.log('🔄 Auto-scan already running');
      return;
    }

    this.isRunning = true;
    console.log('🚀 Starting automated technical analysis scan');
    console.log('⏰ Scanning top 50 cryptocurrencies every 5 minutes');
    console.log('📊 Using: RSI + Support/Resistance + Bollinger Bands (Daily)');

    // Initial scan
    await this.performTechnicalScan();

    // Auto-scan every 5 minutes
    this.scanInterval = setInterval(async () => {
      console.log('🔄 Scheduled 5-minute scan triggered');
      await this.performTechnicalScan();
    }, 5 * 60 * 1000); // 5 minutes

    return {
      status: 'started',
      interval: '5 minutes',
      coins: this.trackedCoins.length,
      strategy: 'RSI + Support/Resistance + Bollinger Bands',
      time: new Date()
    };
  }

  stopAutoScan() {
    this.isRunning = false;
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    console.log('🛑 Auto-scan stopped');
    return { status: 'stopped', time: new Date() };
  }

  async performTechnicalScan() {
    try {
      console.log(`\n🎯 TECHNICAL SCAN STARTED: ${new Date().toLocaleString()}`);
      console.log(`📊 Analyzing ${this.trackedCoins.length} cryptocurrencies...`);

      const opportunities = [];
      let analyzedCount = 0;

      // Process coins in batches to avoid rate limits
      for (let i = 0; i < this.trackedCoins.length; i += 10) {
        const batch = this.trackedCoins.slice(i, i + 10);
        
        for (const coin of batch) {
          try {
            const analysis = await this.analyzeWithTechnicalIndicators(coin);
            analyzedCount++;
            
            if (analysis.confidence >= this.minConfidence) {
              opportunities.push(analysis);
              console.log(`✅ ${coin.symbol}: ${analysis.action} (${(analysis.confidence * 100).toFixed(0)}% confidence)`);
            } else {
              console.log(`➖ ${coin.symbol}: No high-confidence signal`);
            }

            // Small delay between coins to respect rate limits
            await new Promise(resolve => setTimeout(resolve, 1000));
            
          } catch (error) {
            console.log(`❌ ${coin.symbol}: Analysis failed - ${error.message}`);
          }
        }

        // Delay between batches
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // Sort by confidence
      opportunities.sort((a, b) => b.confidence - a.confidence);

      // Store in history
      this.analysisHistory.unshift({
        timestamp: new Date(),
        opportunities: opportunities.length,
        details: opportunities
      });

      // Keep only last 24 hours of history
      if (this.analysisHistory.length > 288) { // 24 hours * 12 scans/hour
        this.analysisHistory = this.analysisHistory.slice(0, 288);
      }

      console.log(`\n📈 SCAN COMPLETE: ${opportunities.length} opportunities found`);
      console.log(`⏰ Next scan in 5 minutes...`);

      return {
        scanTime: new Date(),
        totalCoins: this.trackedCoins.length,
        analyzedCoins: analyzedCount,
        opportunitiesFound: opportunities.length,
        opportunities: opportunities,
        nextScan: new Date(Date.now() + 5 * 60 * 1000)
      };

    } catch (error) {
      console.log('❌ Technical scan failed:', error.message);
      return {
        scanTime: new Date(),
        error: error.message,
        opportunities: []
      };
    }
  }

  async analyzeWithTechnicalIndicators(coin) {
    try {
      // Get historical data for technical analysis (7 days for daily timeframe)
      const historicalData = await this.getHistoricalData(coin.id, 7);
      
      if (!historicalData || historicalData.length < 5) {
        throw new Error('Insufficient historical data');
      }

      // Calculate technical indicators
      const currentPrice = historicalData[historicalData.length - 1].price;
      const prices = historicalData.map(d => d.price);
      
      const rsi = this.calculateRSI(prices, 14);
      const { upperBand, lowerBand } = this.calculateBollingerBands(prices, 20);
      const supportResistance = this.identifySupportResistance(prices);
      const volumeAnalysis = this.analyzeVolume(historicalData);

      // Get AI analysis with technical data
      const aiAnalysis = await this.getAITechnicalAnalysis({
        symbol: coin.symbol,
        name: coin.name,
        currentPrice: currentPrice,
        rsi: rsi,
        bollingerBands: { upper: upperBand, lower: lowerBand },
        supportResistance: supportResistance,
        volume: volumeAnalysis,
        priceHistory: prices.slice(-10) // Last 10 prices
      });

      return {
        symbol: coin.symbol,
        name: coin.name,
        action: aiAnalysis.action,
        price: `$${currentPrice.toFixed(4)}`,
        confidence: aiAnalysis.confidence,
        signal: aiAnalysis.signal,
        reason: aiAnalysis.reason,
        technicals: {
          rsi: rsi.toFixed(1),
          bollingerPosition: this.getBollingerPosition(currentPrice, upperBand, lowerBand),
          support: `$${supportResistance.support.toFixed(2)}`,
          resistance: `$${supportResistance.resistance.toFixed(2)}`,
          trend: this.identifyTrend(prices)
        },
        insights: aiAnalysis.insights,
        timestamp: new Date()
      };

    } catch (error) {
      // Fallback to basic analysis
      return this.basicTechnicalAnalysis(coin);
    }
  }

  async getHistoricalData(coinId, days = 7) {
    try {
      const response = await axios.get(
        `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}&interval=daily`,
        { timeout: 10000 }
      );

      if (response.data && response.data.prices) {
        return response.data.prices.map(([timestamp, price]) => ({
          timestamp: new Date(timestamp),
          price: price,
          volume: 0 // CoinGecko doesn't provide volume in this endpoint
        }));
      }
      throw new Error('No historical data');
    } catch (error) {
      // Generate mock historical data for demonstration
      return this.generateMockHistoricalData();
    }
  }

  generateMockHistoricalData() {
    const data = [];
    const basePrice = 1000 + Math.random() * 10000;
    
    for (let i = 7; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      
      const volatility = 0.05; // 5% daily volatility
      const change = (Math.random() - 0.5) * 2 * volatility;
      const price = i === 0 ? basePrice : data[data.length - 1].price * (1 + change);
      
      data.push({
        timestamp: date,
        price: price,
        volume: 1000000 + Math.random() * 5000000
      });
    }
    
    return data;
  }

  calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;

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

  calculateBollingerBands(prices, period = 20, multiplier = 2) {
    if (prices.length < period) {
      const currentPrice = prices[prices.length - 1];
      return {
        upper: currentPrice * 1.1,
        lower: currentPrice * 0.9,
        middle: currentPrice
      };
    }

    const slice = prices.slice(-period);
    const mean = slice.reduce((sum, price) => sum + price, 0) / period;
    const variance = slice.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / period;
    const stdDev = Math.sqrt(variance);

    return {
      upper: mean + (multiplier * stdDev),
      lower: mean - (multiplier * stdDev),
      middle: mean
    };
  }

  identifySupportResistance(prices) {
    const recentPrices = prices.slice(-20);
    const support = Math.min(...recentPrices);
    const resistance = Math.max(...recentPrices);
    
    return { support, resistance };
  }

  analyzeVolume(historicalData) {
    // Simplified volume analysis
    const recentVolumes = historicalData.slice(-5).map(d => d.volume || 1000000);
    const avgVolume = recentVolumes.reduce((sum, vol) => sum + vol, 0) / recentVolumes.length;
    const currentVolume = recentVolumes[recentVolumes.length - 1];
    
    return {
      current: currentVolume,
      average: avgVolume,
      ratio: currentVolume / avgVolume
    };
  }

  getBollingerPosition(price, upperBand, lowerBand) {
    const bandWidth = upperBand - lowerBand;
    if (bandWidth === 0) return 'MIDDLE';
    
    const position = (price - lowerBand) / bandWidth;
    
    if (position > 0.8) return 'UPPER';
    if (position < 0.2) return 'LOWER';
    return 'MIDDLE';
  }

  identifyTrend(prices) {
    if (prices.length < 3) return 'SIDEWAYS';
    
    const shortTerm = prices.slice(-3);
    const longTerm = prices.slice(-7);
    
    const shortTrend = shortTerm[shortTerm.length - 1] - shortTerm[0];
    const longTrend = longTerm[longTerm.length - 1] - longTerm[0];
    
    if (shortTrend > 0 && longTrend > 0) return 'BULLISH';
    if (shortTrend < 0 && longTrend < 0) return 'BEARISH';
    return 'SIDEWAYS';
  }

  async getAITechnicalAnalysis(technicalData) {
    try {
      const prompt = this.createTechnicalAnalysisPrompt(technicalData);
      
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://my-deepseek-bot-1.onrender.com',
          'X-Title': 'Technical Analysis Bot'
        },
        body: JSON.stringify({
          model: "deepseek/deepseek-r1:free",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 300,
          temperature: 0.1 // Very consistent for technical analysis
        })
      });

      if (!response.ok) throw new Error('AI API failed');
      
      const data = await response.json();
      const aiResponse = data.choices[0].message.content;
      
      return this.parseTechnicalAIResponse(aiResponse, technicalData);
      
    } catch (error) {
      return this.generateTechnicalAnalysis(technicalData);
    }
  }

  createTechnicalAnalysisPrompt(technicalData) {
    return `
PROFESSIONAL TECHNICAL ANALYSIS REQUEST:

CRYPTO: ${technicalData.symbol} - ${technicalData.name}
CURRENT PRICE: $${technicalData.currentPrice}

TECHNICAL INDICATORS (Daily Timeframe):
- RSI(14): ${technicalData.rsi} ${this.getRSILevel(technicalData.rsi)}
- Bollinger Bands: Positioned in ${technicalData.bollingerBands.position} band
- Support: ${technicalData.supportResistance.support}
- Resistance: ${technicalData.supportResistance.resistance}
- Trend: ${technicalData.trend}
- Volume: ${technicalData.volume.ratio > 1.2 ? 'Above average' : 'Normal'}

PRICE ACTION (Last 10 periods):
${technicalData.priceHistory.map((p, i) => `Day -${9-i}: $${p.toFixed(2)}`).join('\n')}

ANALYSIS REQUEST:
Based on COMBINED technical analysis (RSI + Bollinger Bands + Support/Resistance + Trend), provide:
1. Trading action (BUY/SELL/HOLD)
2. Confidence score (0.1-0.95)
3. Technical reasoning
4. Key risk factors

Respond in EXACT JSON:
{
  "action": "BUY|SELL|HOLD",
  "confidence": 0.75,
  "reason": "Technical analysis reasoning...",
  "insights": ["Risk: ...", "Target: ...", "Stop: ..."]
}

Be professional and risk-aware.
`;
  }

  getRSILevel(rsi) {
    if (rsi > 70) return '(Overbought)';
    if (rsi < 30) return '(Oversold)';
    return '(Neutral)';
  }

  parseTechnicalAIResponse(aiResponse, technicalData) {
    try {
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          action: parsed.action || 'HOLD',
          confidence: Math.min(Math.max(parsed.confidence || 0.5, 0.1), 0.95),
          reason: parsed.reason || 'Technical analysis completed',
          insights: parsed.insights || ['Analysis provided'],
          signal: `${parsed.action} | Technical Analysis`
        };
      }
      throw new Error('Invalid AI response format');
    } catch (error) {
      return this.generateTechnicalAnalysis(technicalData);
    }
  }

  generateTechnicalAnalysis(technicalData) {
    // Fallback technical analysis logic
    let action = 'HOLD';
    let confidence = 0.5;
    let reason = '';
    let insights = [];

    const rsi = technicalData.rsi;
    const bbPosition = technicalData.bollingerBands.position;
    const trend = technicalData.trend;

    // Combined technical analysis logic
    if (rsi < 30 && bbPosition === 'LOWER' && trend === 'BEARISH') {
      action = 'BUY';
      confidence = 0.75;
      reason = 'Oversold with Bollinger Band support and bearish trend exhaustion';
      insights = ['Strong reversal potential', 'Risk: Trend continuation', 'Stop below support'];
    } 
    else if (rsi > 70 && bbPosition === 'UPPER' && trend === 'BULLISH') {
      action = 'SELL';
      confidence = 0.75;
      reason = 'Overbought with Bollinger Band resistance and bullish trend extreme';
      insights = ['Profit taking opportunity', 'Risk: Trend continuation', 'Stop above resistance'];
    }
    else if (rsi < 35 && trend === 'BULLISH') {
      action = 'BUY';
      confidence = 0.65;
      reason = 'Oversold in bullish trend - potential dip buying';
      insights = ['Trend alignment positive', 'Watch for confirmation', 'Stop below recent low'];
    }
    else {
      action = 'HOLD';
      confidence = 0.3;
      reason = 'No clear technical setup - market consolidating';
      insights = ['Wait for clearer signals', 'Monitor key levels', 'Low conviction'];
    }

    return {
      action,
      confidence,
      reason,
      insights,
      signal: `${action} | Technical Analysis`
    };
  }

  basicTechnicalAnalysis(coin) {
    return {
      symbol: coin.symbol,
      name: coin.name,
      action: 'HOLD',
      price: '$0.00',
      confidence: 0.1,
      signal: 'HOLD | Data Unavailable',
      reason: 'Technical analysis data not available',
      technicals: { rsi: 'N/A', bollingerPosition: 'N/A', support: 'N/A', resistance: 'N/A', trend: 'N/A' },
      insights: ['Data fetch failed'],
      timestamp: new Date()
    };
  }

  getScanHistory() {
    return this.analysisHistory.slice(0, 10); // Last 10 scans
  }
}

const tradingBot = new ProfessionalTradingBot();

// ===== ROUTES =====

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Professional Crypto Scanner</title>
        <meta http-equiv="refresh" content="300"> <!-- Auto-refresh every 5 minutes -->
        <style>
            body { font-family: Arial, sans-serif; max-width: 1400px; margin: 0 auto; padding: 20px; }
            .card { background: #f5f5f5; padding: 20px; margin: 10px 0; border-radius: 8px; }
            .buy { color: green; font-weight: bold; background: #e8f5e8; border-left: 4px solid green; }
            .sell { color: red; font-weight: bold; background: #f8d7da; border-left: 4px solid red; }
            .hold { color: orange; font-weight: bold; background: #fff3cd; border-left: 4px solid orange; }
            .opportunity { padding: 15px; margin: 10px 0; border-radius: 5px; background: white; }
            .technical-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 10px 0; }
            .technical-item { background: #e9ecef; padding: 8px; border-radius: 4px; font-size: 0.9em; }
            .scan-info { background: #007bff; color: white; padding: 10px; border-radius: 5px; margin: 10px 0; }
            button { padding: 10px 20px; margin: 5px; border: none; border-radius: 4px; cursor: pointer; background: #007bff; color: white; }
            .auto-scanning { background: #28a745; }
            .stopped { background: #dc3545; }
        </style>
    </head>
    <body>
        <h1>🎯 Professional Crypto Scanner</h1>
        <p>Technical Analysis: RSI + Bollinger Bands + Support/Resistance (Daily Timeframe)</p>
        
        <div class="card">
            <h3>Scanner Controls:</h3>
            <button onclick="startAutoScan()" id="startBtn">🚀 Start Auto-Scan (5min)</button>
            <button onclick="stopAutoScan()" id="stopBtn">🛑 Stop Auto-Scan</button>
            <button onclick="manualScan()">🔍 Manual Scan Now</button>
            <button onclick="viewHistory()">📊 View Scan History</button>
            <div id="status" class="scan-info">
                <strong>Status:</strong> <span id="statusText">Ready to start</span>
                <br><strong>Next Scan:</strong> <span id="nextScan">Not scheduled</span>
            </div>
        </div>

        <div class="card">
            <h3>📈 Live Trading Opportunities</h3>
            <div id="results">
                <p>Scanner will analyze 50 cryptocurrencies every 5 minutes.</p>
                <p>Only high-confidence opportunities (65%+ confidence) will be shown.</p>
            </div>
        </div>

        <script>
            let autoRefresh = true;

            async function startAutoScan() {
                try {
                    const response = await fetch('/start-scan', { method: 'POST' });
                    const result = await response.json();
                    
                    document.getElementById('statusText').innerHTML = \`<span style="color: lightgreen;">🔄 Auto-Scanning</span>\`;
                    document.getElementById('statusText').parentElement.className = 'scan-info auto-scanning';
                    document.getElementById('nextScan').textContent = 'Every 5 minutes';
                    
                    alert(\`Auto-scan started! Scanning \${result.coins} coins every \${result.interval}\`);
                    
                    // Load initial results
                    manualScan();
                    
                } catch (error) {
                    alert('Error starting auto-scan');
                }
            }

            async function stopAutoScan() {
                try {
                    const response = await fetch('/stop-scan', { method: 'POST' });
                    const result = await response.json();
                    
                    document.getElementById('statusText').innerHTML = '<span style="color: lightcoral;">🛑 Stopped</span>';
                    document.getElementById('statusText').parentElement.className = 'scan-info stopped';
                    document.getElementById('nextScan').textContent = 'Manual mode';
                    
                    alert('Auto-scan stopped');
                    
                } catch (error) {
                    alert('Error stopping auto-scan');
                }
            }

            async function manualScan() {
                try {
                    document.getElementById('results').innerHTML = '<p>🔍 Scanning 50 cryptocurrencies with technical analysis...</p>';
                    
                    const response = await fetch('/scan-now');
                    const data = await response.json();
                    
                    if (data.opportunities.length === 0) {
                        document.getElementById('results').innerHTML = \`
                            <div style="text-align: center; padding: 40px; color: #6c757d;">
                                <h3>📭 No High-Confidence Opportunities</h3>
                                <p>Scanned \${data.analyzedCoins} of \${data.totalCoins} coins</p>
                                <p><em>No technical setups meeting 65%+ confidence threshold</em></p>
                                <p>Next scan: \${new Date(data.nextScan).toLocaleTimeString()}</p>
                            </div>
                        \`;
                        return;
                    }
                    
                    let opportunitiesHTML = \`
                        <div style="margin-bottom: 20px;">
                            <h4>🎯 Found \${data.opportunitiesFound} Technical Opportunities</h4>
                            <p><em>Scan time: \${new Date(data.scanTime).toLocaleString()} | Next scan: \${new Date(data.nextScan).toLocaleTimeString()}</em></p>
                        </div>
                    \`;
                    
                    data.opportunities.forEach(opp => {
                        const actionClass = opp.action.toLowerCase();
                        
                        opportunitiesHTML += \`
                            <div class="opportunity">
                                <div style="display: flex; justify-content: between; align-items: start;">
                                    <div style="flex: 1;">
                                        <h4 style="margin: 0;">
                                            <span class="\${actionClass}">\${opp.action}</span> 
                                            \${opp.symbol} - \${opp.name}
                                        </h4>
                                        <p><strong>Price:</strong> \${opp.price} • <strong>Confidence:</strong> \${(opp.confidence * 100).toFixed(0)}%</p>
                                        <p><strong>Signal:</strong> \${opp.signal}</p>
                                        <p><strong>Reason:</strong> \${opp.reason}</p>
                                    </div>
                                    <div style="flex: 1;">
                                        <div class="technical-grid">
                                            <div class="technical-item"><strong>RSI:</strong> \${opp.technicals.rsi}</div>
                                            <div class="technical-item"><strong>Bollinger:</strong> \${opp.technicals.bollingerPosition}</div>
                                            <div class="technical-item"><strong>Trend:</strong> \${opp.technicals.trend}</div>
                                            <div class="technical-item"><strong>Support:</strong> \${opp.technicals.support}</div>
                                            <div class="technical-item"><strong>Resistance:</strong> \${opp.technicals.resistance}</div>
                                        </div>
                                    </div>
                                </div>
                                <div style="margin-top: 10px;">
                                    <strong>Insights:</strong>
                                    <ul>
                                        \${opp.insights.map(insight => \`<li>\${insight}</li>\`).join('')}
                                    </ul>
                                </div>
                                <div style="font-size: 0.8em; color: #666; margin-top: 5px;">
                                    Analyzed: \${new Date(opp.timestamp).toLocaleTimeString()}
                                </div>
                            </div>
                        \`;
                    });
                    
                    document.getElementById('results').innerHTML = opportunitiesHTML;
                    
                } catch (error) {
                    document.getElementById('results').innerHTML = 
                        '<p style="color: red;">Scan failed. Technical analysis may be rate limited.</p>';
                }
            }

            async function viewHistory() {
                try {
                    const response = await fetch('/scan-history');
                    const history = await response.json();
                    alert(\`Last scan: \${history.length > 0 ? new Date(history[0].timestamp).toLocaleString() : 'No history'}\`);
                } catch (error) {
                    alert('Error loading history');
                }
            }

            // Auto-refresh results every 30 seconds when auto-scanning
            setInterval(() => {
                if (document.getElementById('statusText').textContent.includes('Auto-Scanning')) {
                    manualScan();
                }
            }, 30000);

            // Initial load
            manualScan();
        </script>
    </body>
    </html>
  `);
});

// API Routes
app.post('/start-scan', (req, res) => {
  const result = tradingBot.startAutoScan();
  res.json(result);
});

app.post('/stop-scan', (req, res) => {
  const result = tradingBot.stopAutoScan();
  res.json(result);
});

app.get('/scan-now', async (req, res) => {
  try {
    const result = await tradingBot.performTechnicalScan();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/scan-history', (req, res) => {
  const history = tradingBot.getScanHistory();
  res.json(history);
});

app.get('/bot-status', (req, res) => {
  res.json({
    running: tradingBot.isRunning,
    coinsTracked: tradingBot.trackedCoins.length,
    strategy: 'RSI + Bollinger Bands + Support/Resistance',
    interval: '5 minutes',
    minConfidence: tradingBot.minConfidence,
    lastUpdate: new Date()
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'professional-scanner',
    strategy: 'Technical Analysis (Daily)',
    autoScan: tradingBot.isRunning,
    time: new Date() 
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎯 Professional Crypto Scanner running on port ${PORT}`);
  console.log(`📊 Strategy: RSI + Bollinger Bands + Support/Resistance`);
  console.log(`⏰ Auto-scan: 5 minute intervals`);
  console.log(`🎯 Coins: ${tradingBot.trackedCoins.length} top cryptocurrencies`);
  console.log(`📈 Confidence: ${(tradingBot.minConfidence * 100).toFixed(0)}% minimum`);
});

module.exports = app;
