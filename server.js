const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

// Opportunity-Focused Crypto Trading Bot
class OpportunityBot {
  constructor() {
    this.isRunning = false;
    this.trackedCoins = [
      { symbol: 'BTC', name: 'Bitcoin', id: 'bitcoin' },
      { symbol: 'ETH', name: 'Ethereum', id: 'ethereum' },
      { symbol: 'SOL', name: 'Solana', id: 'solana' },
      { symbol: 'BNB', name: 'Binance Coin', id: 'binancecoin' },
      { symbol: 'XRP', name: 'Ripple', id: 'ripple' },
      { symbol: 'ADA', name: 'Cardano', id: 'cardano' },
      { symbol: 'AVAX', name: 'Avalanche', id: 'avalanche-2' },
      { symbol: 'DOT', name: 'Polkadot', id: 'polkadot' },
      { symbol: 'DOGE', name: 'Dogecoin', id: 'dogecoin' },
      { symbol: 'LINK', name: 'Chainlink', id: 'chainlink' }
    ];
    this.minConfidence = 0.6; // Only show trades with 60%+ confidence
    this.useAI = true;
  }

  async findTradingOpportunities() {
    try {
      console.log('🎯 Scanning for HIGH-CONFIDENCE trading opportunities...');
      
      // Get all market data first
      const coinIds = this.trackedCoins.map(coin => coin.id).join(',');
      const response = await axios.get(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coinIds}&vs_currencies=usd&include_24hr_change=true`,
        { timeout: 10000 }
      );

      const allAnalyses = [];
      const potentialOpportunities = [];
      
      // First pass: Quick filter for potential opportunities
      for (const coin of this.trackedCoins) {
        if (response.data[coin.id]) {
          const price = response.data[coin.id].usd;
          const change24h = response.data[coin.id].usd_24h_change || 0;
          
          // Quick filter: Only analyze coins with significant movement
          if (Math.abs(change24h) > 3) {
            potentialOpportunities.push({ coin, price, change24h });
          }
        }
      }

      console.log(`📊 Found ${potentialOpportunities.length} coins with significant price movement`);

      // Second pass: AI analysis only on potential opportunities
      for (const opportunity of potentialOpportunities) {
        try {
          const analysis = await this.aiAnalyzeOpportunity(opportunity.coin, opportunity.price, opportunity.change24h);
          
          // Only include if confidence meets threshold
          if (analysis.confidence >= this.minConfidence) {
            allAnalyses.push(analysis);
            console.log(`✅ HIGH-CONFIDENCE: ${opportunity.coin.symbol} - ${analysis.action} (${(analysis.confidence * 100).toFixed(0)}%)`);
          }
        } catch (error) {
          console.log(`❌ AI skipped ${opportunity.coin.symbol}`);
        }
      }

      // Sort by confidence (highest first)
      allAnalyses.sort((a, b) => b.confidence - a.confidence);
      
      return {
        opportunitiesFound: allAnalyses.length,
        totalScanned: this.trackedCoins.length,
        minConfidence: this.minConfidence,
        timestamp: new Date(),
        opportunities: allAnalyses,
        message: allAnalyses.length === 0 ? 
          'No high-confidence trading opportunities found. Market may be stable.' : 
          `Found ${allAnalyses.length} high-confidence opportunities`
      };
      
    } catch (error) {
      console.log('❌ Opportunity scan failed:', error.message);
      return {
        opportunitiesFound: 0,
        totalScanned: this.trackedCoins.length,
        timestamp: new Date(),
        opportunities: [],
        message: 'Scan failed - try again later'
      };
    }
  }

  async aiAnalyzeOpportunity(coin, price, change24h) {
    // Only use AI for high-potential opportunities
    try {
      console.log(`🤖 AI Analyzing opportunity: ${coin.symbol} (${change24h.toFixed(1)}% change)`);
      
      const marketData = {
        symbol: coin.symbol,
        name: coin.name,
        price: price,
        change24h: change24h,
        condition: this.getMarketCondition(change24h)
      };

      const aiAnalysis = await this.getDeepSeekAnalysis(marketData);
      
      return {
        symbol: coin.symbol,
        name: coin.name,
        action: aiAnalysis.action,
        price: `$${price.toFixed(coin.symbol === 'BTC' ? 2 : 4)}`,
        change24h: `${change24h.toFixed(2)}%`,
        reason: aiAnalysis.reason,
        confidence: aiAnalysis.confidence,
        signal: `${aiAnalysis.action} | ${(aiAnalysis.confidence * 100).toFixed(0)}% Confidence`,
        insights: aiAnalysis.insights,
        priority: this.getPriorityLevel(aiAnalysis.confidence, Math.abs(change24h))
      };
      
    } catch (aiError) {
      // If AI fails, use smart analysis but still apply confidence filter
      const smartAnalysis = this.smartAnalyzeOpportunity(coin, price, change24h);
      if (smartAnalysis.confidence >= this.minConfidence) {
        return smartAnalysis;
      }
      throw new Error('Below confidence threshold');
    }
  }

  smartAnalyzeOpportunity(coin, price, change24h) {
    // Conservative smart analysis - only high-confidence signals
    let action = 'HOLD';
    let confidence = 0.3;
    let reason = '';
    let insights = [];

    // Only trigger on significant movements
    if (change24h > 12) {
      action = 'SELL';
      confidence = 0.75;
      reason = `STRONG PUMP: +${change24h.toFixed(1)}% - High probability profit taking`;
      insights = ['Take partial profits', 'Set trailing stop loss', 'Monitor for reversal'];
    } 
    else if (change24h < -12) {
      action = 'BUY';
      confidence = 0.75;
      reason = `STRONG DUMP: ${change24h.toFixed(1)}% - High probability accumulation`;
      insights = ['Dollar-cost average entry', 'Strong historical support', 'High risk/reward'];
    }
    else if (change24h > 8) {
      action = 'SELL';
      confidence = 0.65;
      reason = `Significant pump: +${change24h.toFixed(1)}% - Consider profit taking`;
      insights = ['Evaluate profit targets', 'Partial position reduction'];
    }
    else if (change24h < -8) {
      action = 'BUY';
      confidence = 0.65;
      reason = `Significant dip: ${change24h.toFixed(1)}% - Potential entry zone`;
      insights = ['Good accumulation level', 'Watch for bounce confirmation'];
    }
    else {
      // Not significant enough - don't show
      action = 'HOLD';
      confidence = 0.3;
      reason = `Insufficient movement: ${change24h.toFixed(1)}% - No clear opportunity`;
    }

    return {
      symbol: coin.symbol,
      name: coin.name,
      action,
      price: `$${price.toFixed(coin.symbol === 'BTC' ? 2 : 4)}`,
      change24h: `${change24h.toFixed(2)}%`,
      reason,
      confidence,
      signal: `${action} | ${(confidence * 100).toFixed(0)}% Confidence`,
      insights,
      priority: this.getPriorityLevel(confidence, Math.abs(change24h))
    };
  }

  getPriorityLevel(confidence, volatility) {
    if (confidence >= 0.8 && volatility >= 10) return 'HIGH';
    if (confidence >= 0.7 && volatility >= 6) return 'MEDIUM';
    if (confidence >= 0.6) return 'LOW';
    return 'NONE';
  }

  async getDeepSeekAnalysis(marketData) {
    try {
      const prompt = `
CRYPTO TRADING OPPORTUNITY ASSESSMENT:

SYMBOL: ${marketData.symbol}
PRICE: $${marketData.price}
24H CHANGE: ${marketData.change24h}%
CONDITION: ${marketData.condition}

ONLY recommend BUY/SELL if this is a HIGH-CONFIDENCE opportunity.
If uncertain, recommend HOLD with low confidence.

Respond in EXACT JSON format:
{
  "action": "BUY|SELL|HOLD",
  "confidence": 0.0-1.0,
  "reason": "Brief explanation - be decisive",
  "insights": ["key factor 1", "key factor 2"]
}

Be risk-aware and decisive. Only high-confidence recommendations.
`;

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://my-deepseek-bot-1.onrender.com',
          'X-Title': 'Crypto Opportunity Bot'
        },
        body: JSON.stringify({
          model: "deepseek/deepseek-r1:free",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 200,
          temperature: 0.2 // Very focused
        })
      });

      if (!response.ok) throw new Error('API failed');
      
      const data = await response.json();
      const aiResponse = data.choices[0].message.content;
      
      return this.parseAIResponse(aiResponse, marketData);
      
    } catch (error) {
      throw error;
    }
  }

  parseAIResponse(aiResponse, marketData) {
    try {
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          action: parsed.action || 'HOLD',
          confidence: Math.min(Math.max(parsed.confidence || 0.3, 0.1), 0.95),
          reason: parsed.reason || 'AI analysis completed',
          insights: parsed.insights || ['Market analysis provided']
        };
      }
      return {
        action: 'HOLD',
        confidence: 0.3,
        reason: 'AI response unclear',
        insights: ['Analysis incomplete']
      };
    } catch (error) {
      return {
        action: 'HOLD',
        confidence: 0.3,
        reason: 'AI parsing failed',
        insights: ['Technical error']
      };
    }
  }

  getMarketCondition(change24h) {
    if (change24h > 10) return 'STRONG BULL';
    if (change24h > 5) return 'BULLISH';
    if (change24h > -5) return 'NEUTRAL';
    if (change24h > -10) return 'BEARISH';
    return 'STRONG BEAR';
  }

  startBot() {
    this.isRunning = true;
    console.log('🎯 Opportunity Bot Started');
    console.log('📈 Only showing HIGH-CONFIDENCE trading opportunities');
    return { 
      status: 'started', 
      strategy: 'Opportunity-Focused',
      minConfidence: this.minConfidence,
      time: new Date() 
    };
  }

  stopBot() {
    this.isRunning = false;
    console.log('🛑 Opportunity Bot Stopped');
    return { status: 'stopped', time: new Date() };
  }

  // Adjust confidence threshold
  setConfidenceThreshold(threshold) {
    this.minConfidence = Math.min(Math.max(threshold, 0.1), 0.95);
    return { 
      newThreshold: this.minConfidence,
      message: `Only showing opportunities with ${(this.minConfidence * 100).toFixed(0)}%+ confidence`
    };
  }
}

const tradingBot = new OpportunityBot();

// ===== ROUTES =====

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Opportunity Trading Bot</title>
        <style>
            body { font-family: Arial, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }
            .card { background: #f5f5f5; padding: 20px; margin: 10px 0; border-radius: 8px; }
            .buy { color: green; font-weight: bold; background: #e8f5e8; border-left: 4px solid green; }
            .sell { color: red; font-weight: bold; background: #f8d7da; border-left: 4px solid red; }
            .opportunity { padding: 15px; margin: 10px 0; border-radius: 5px; }
            .high-priority { background: #fff3cd; border: 2px solid #ffc107; }
            .medium-priority { background: #e8f5e8; border: 1px solid #28a745; }
            .low-priority { background: #f8f9fa; border: 1px solid #6c757d; }
            .priority-badge { padding: 2px 8px; border-radius: 3px; font-size: 0.8em; font-weight: bold; }
            .high-badge { background: #dc3545; color: white; }
            .medium-badge { background: #fd7e14; color: white; }
            .low-badge { background: #20c997; color: white; }
            button { padding: 10px 20px; margin: 5px; border: none; border-radius: 4px; cursor: pointer; background: #007bff; color: white; }
            .no-opportunities { text-align: center; padding: 40px; color: #6c757d; }
        </style>
    </head>
    <body>
        <h1>🎯 Opportunity Trading Bot</h1>
        <p>Only shows HIGH-CONFIDENCE trading opportunities (${(tradingBot.minConfidence * 100).toFixed(0)}%+ confidence required)</p>
        
        <div class="card">
            <h3>Opportunity Scanner:</h3>
            <button onclick="scanOpportunities()">🔍 Scan for Opportunities</button>
            <button onclick="setHighConfidence()">🎯 High Confidence (70%+)</button>
            <button onclick="setMediumConfidence()">📊 Medium Confidence (60%+)</button>
            <button onclick="startBot()">🚀 Start Scanner</button>
            <button onclick="stopBot()">🛑 Stop Scanner</button>
        </div>

        <div class="card">
            <h3>Trading Opportunities:</h3>
            <div id="results">
                <p>Click "Scan for Opportunities" to find high-confidence trades.</p>
                <p><em>Only coins with clear BUY/SELL signals will be shown.</em></p>
            </div>
        </div>

        <script>
            async function scanOpportunities() {
                try {
                    document.getElementById('results').innerHTML = '<p>🔍 Scanning 10 cryptocurrencies for high-confidence opportunities...</p>';
                    
                    const response = await fetch('/opportunities');
                    const data = await response.json();
                    
                    if (data.opportunities.length === 0) {
                        document.getElementById('results').innerHTML = \`
                            <div class="no-opportunities">
                                <h3>📭 No High-Confidence Opportunities</h3>
                                <p>Scanned \${data.totalScanned} coins • Minimum \${(data.minConfidence * 100).toFixed(0)}% confidence</p>
                                <p><em>\${data.message}</em></p>
                                <p>Try again later or adjust confidence threshold.</p>
                            </div>
                        \`;
                        return;
                    }
                    
                    let opportunitiesHTML = \`
                        <div style="margin-bottom: 20px;">
                            <h4>🎯 Found \${data.opportunitiesFound} High-Confidence Opportunities</h4>
                            <p><em>\${data.message} • Scanned \${data.totalScanned} coins</em></p>
                        </div>
                    \`;
                    
                    data.opportunities.forEach(opp => {
                        const actionClass = opp.action.toLowerCase();
                        const priorityClass = opp.priority ? opp.priority.toLowerCase() + '-priority' : '';
                        const priorityBadge = opp.priority ? \`<span class="priority-badge \${opp.priority.toLowerCase()}-badge">\${opp.priority} PRIORITY</span>\` : '';
                        
                        opportunitiesHTML += \`
                            <div class="opportunity \${priorityClass}">
                                <div style="display: flex; justify-content: between; align-items: center;">
                                    <h4 style="margin: 0;">
                                        <span class="\${actionClass}">\${opp.action}</span> 
                                        \${opp.symbol} - \${opp.name}
                                    </h4>
                                    \${priorityBadge}
                                </div>
                                <p><strong>Price:</strong> \${opp.price} • <strong>24h Change:</strong> \${opp.change24h}</p>
                                <p><strong>Confidence:</strong> \${(opp.confidence * 100).toFixed(0)}% • \${opp.signal}</p>
                                <p><strong>Reason:</strong> \${opp.reason}</p>
                                <div>
                                    <strong>Insights:</strong>
                                    <ul>
                                        \${opp.insights.map(insight => \`<li>\${insight}</li>\`).join('')}
                                    </ul>
                                </div>
                            </div>
                        \`;
                    });
                    
                    opportunitiesHTML += \`<p><em>Last scan: \${new Date(data.timestamp).toLocaleString()}</em></p>\`;
                    
                    document.getElementById('results').innerHTML = opportunitiesHTML;
                    
                } catch (error) {
                    document.getElementById('results').innerHTML = 
                        '<p style="color: red;">Scan failed. API may be rate limited. Wait 60 seconds.</p>';
                }
            }

            async function setHighConfidence() {
                try {
                    const response = await fetch('/set-confidence/0.7', { method: 'POST' });
                    const result = await response.json();
                    alert(\`\${result.message}\`);
                    scanOpportunities();
                } catch (error) {
                    alert('Error setting confidence');
                }
            }

            async function setMediumConfidence() {
                try {
                    const response = await fetch('/set-confidence/0.6', { method: 'POST' });
                    const result = await response.json();
                    alert(\`\${result.message}\`);
                    scanOpportunities();
                } catch (error) {
                    alert('Error setting confidence');
                }
            }

            async function startBot() {
                try {
                    const response = await fetch('/start-bot', { method: 'POST' });
                    const result = await response.json();
                    alert(\`\${result.strategy} Bot Started!\`);
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

            scanOpportunities();
        </script>
    </body>
    </html>
  `);
});

// API Routes
app.get('/opportunities', async (req, res) => {
  try {
    const opportunities = await tradingBot.findTradingOpportunities();
    res.json(opportunities);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/set-confidence/:threshold', (req, res) => {
  const threshold = parseFloat(req.params.threshold);
  const result = tradingBot.setConfidenceThreshold(threshold);
  res.json(result);
});

app.get('/bot-status', (req, res) => {
  res.json({
    running: tradingBot.isRunning,
    minConfidence: tradingBot.minConfidence,
    coinsTracked: tradingBot.trackedCoins.length,
    strategy: 'Opportunity-Focused',
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
    service: 'opportunity-bot',
    minConfidence: tradingBot.minConfidence,
    strategy: 'High-confidence opportunities only',
    time: new Date() 
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎯 Opportunity Trading Bot running on port ${PORT}`);
  console.log(`✅ Only showing ${(tradingBot.minConfidence * 100).toFixed(0)}%+ confidence opportunities`);
  console.log(`📊 Scanning ${tradingBot.trackedCoins.length} coins for high-potential trades`);
});

module.exports = app;
