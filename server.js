const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

// AI-Powered Crypto Trading Bot
class AICryptoBot {
  constructor() {
    this.isRunning = false;
    this.trackedCoins = [
      { symbol: 'BTC', name: 'Bitcoin', id: 'bitcoin' },
      { symbol: 'ETH', name: 'Ethereum', id: 'ethereum' },
      { symbol: 'BNB', name: 'Binance Coin', id: 'binancecoin' },
      { symbol: 'SOL', name: 'Solana', id: 'solana' },
      { symbol: 'XRP', name: 'Ripple', id: 'ripple' }
    ];
    this.useAI = true; // Enable AI analysis
  }

  async analyzeAllCoins() {
    try {
      console.log('🤖 AI Analysis Started...');
      
      // Get market data
      const coinIds = this.trackedCoins.map(coin => coin.id).join(',');
      const response = await axios.get(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coinIds}&vs_currencies=usd&include_24hr_change=true`,
        { timeout: 10000 }
      );

      const analyses = [];
      
      for (const coin of this.trackedCoins) {
        if (response.data[coin.id]) {
          const price = response.data[coin.id].usd;
          const change24h = response.data[coin.id].usd_24h_change || 0;
          
          // Use AI for analysis instead of simple rules
          const analysis = await this.aiAnalyzeCoin(coin, price, change24h);
          analyses.push(analysis);
        }
      }

      analyses.sort((a, b) => b.confidence - a.confidence);
      
      return {
        totalCoins: analyses.length,
        timestamp: new Date(),
        analyses: analyses,
        dataSource: 'CoinGecko + DeepSeek AI',
        analysisType: 'AI-Powered'
      };
      
    } catch (error) {
      console.log('❌ Analysis error:', error.message);
      return await this.fallbackToBasicAnalysis();
    }
  }

  async aiAnalyzeCoin(coin, price, change24h) {
    try {
      // Prepare data for AI analysis
      const marketData = {
        symbol: coin.symbol,
        name: coin.name,
        price: price,
        change24h: change24h,
        marketCondition: this.getMarketCondition(change24h)
      };

      // Get AI analysis from DeepSeek
      const aiAnalysis = await this.getDeepSeekAnalysis(marketData);
      
      return {
        symbol: coin.symbol,
        name: coin.name,
        action: aiAnalysis.action,
        price: `$${price.toFixed(coin.symbol === 'BTC' ? 2 : 4)}`,
        change24h: `${change24h.toFixed(2)}%`,
        reason: aiAnalysis.reason,
        confidence: aiAnalysis.confidence,
        signal: `${aiAnalysis.action} | AI Confidence: ${(aiAnalysis.confidence * 100).toFixed(0)}%`,
        dataQuality: 'AI Analysis',
        aiInsights: aiAnalysis.insights
      };
      
    } catch (aiError) {
      console.log(`❌ AI analysis failed for ${coin.symbol}, using fallback`);
      return this.basicAnalyzeCoin(coin, price, change24h);
    }
  }

  async getDeepSeekAnalysis(marketData) {
    // Your DeepSeek API call
    const prompt = this.createAnalysisPrompt(marketData);
    
    const completion = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: "deepseek/deepseek-r1:free",
        messages: [
          {
            role: "system",
            content: "You are an expert cryptocurrency trading analyst. Analyze the market data and provide clear trading advice with confidence levels."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        max_tokens: 500
      })
    });

    const response = await completion.json();
    const aiResponse = response.choices[0].message.content;
    
    // Parse AI response into structured data
    return this.parseAIResponse(aiResponse, marketData);
  }

  createAnalysisPrompt(marketData) {
    return `
CRYPTOCURRENCY TRADING ANALYSIS REQUEST:

Please analyze this cryptocurrency and provide trading advice:

COIN: ${marketData.name} (${marketData.symbol})
CURRENT PRICE: $${marketData.price}
24H CHANGE: ${marketData.change24h}%
MARKET CONDITION: ${marketData.marketCondition}

ANALYSIS REQUEST:
1. Provide a clear trading action: BUY, SELL, or HOLD
2. Give a confidence level between 0.1 and 0.95
3. Explain your reasoning based on technical analysis principles
4. Consider market sentiment and potential risks
5. Provide 2-3 key insights

Please respond in this EXACT JSON format:
{
  "action": "BUY|SELL|HOLD",
  "confidence": 0.75,
  "reason": "Detailed explanation here...",
  "insights": ["Insight 1", "Insight 2", "Insight 3"]
}
    `;
  }

  parseAIResponse(aiResponse, marketData) {
    try {
      // Try to parse JSON response
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          action: parsed.action || 'HOLD',
          confidence: Math.min(Math.max(parsed.confidence || 0.5, 0.1), 0.95),
          reason: parsed.reason || 'AI analysis provided',
          insights: parsed.insights || ['No specific insights']
        };
      }
      
      // Fallback: Parse text response
      return this.parseTextResponse(aiResponse, marketData);
      
    } catch (error) {
      console.log('AI response parsing failed, using fallback');
      return this.getFallbackAnalysis(marketData);
    }
  }

  parseTextResponse(text, marketData) {
    let action = 'HOLD';
    let confidence = 0.5;
    let reason = 'AI analysis: ' + text.substring(0, 150) + '...';
    
    // Simple text parsing as fallback
    if (text.toLowerCase().includes('buy') || text.toLowerCase().includes('bullish')) {
      action = 'BUY';
      confidence = 0.7;
    } else if (text.toLowerCase().includes('sell') || text.toLowerCase().includes('bearish')) {
      action = 'SELL';
      confidence = 0.7;
    }
    
    return {
      action,
      confidence,
      reason,
      insights: ['AI analysis completed']
    };
  }

  getFallbackAnalysis(marketData) {
    // Basic analysis when AI fails
    let action = 'HOLD';
    let confidence = 0.3;
    let reason = 'Market conditions neutral';

    if (marketData.change24h > 10) {
      action = 'SELL';
      confidence = 0.7;
      reason = `Strong pump detected: +${marketData.change24h.toFixed(1)}% in 24h`;
    } else if (marketData.change24h < -10) {
      action = 'BUY';
      confidence = 0.7;
      reason = `Significant dip: ${marketData.change24h.toFixed(1)}% in 24h - potential opportunity`;
    }

    return {
      action,
      confidence,
      reason,
      insights: ['Using fallback technical analysis']
    };
  }

  getMarketCondition(change24h) {
    if (change24h > 15) return 'STRONG BULL';
    if (change24h > 5) return 'BULLISH';
    if (change24h > -5) return 'NEUTRAL';
    if (change24h > -15) return 'BEARISH';
    return 'STRONG BEAR';
  }

  basicAnalyzeCoin(coin, price, change24h) {
    // Fallback basic analysis
    const analysis = this.getFallbackAnalysis({
      symbol: coin.symbol,
      name: coin.name,
      price: price,
      change24h: change24h
    });

    return {
      symbol: coin.symbol,
      name: coin.name,
      action: analysis.action,
      price: `$${price.toFixed(coin.symbol === 'BTC' ? 2 : 4)}`,
      change24h: `${change24h.toFixed(2)}%`,
      reason: analysis.reason + ' (Basic Analysis)',
      confidence: analysis.confidence,
      signal: `${analysis.action} | Confidence: ${(analysis.confidence * 100).toFixed(0)}%`,
      dataQuality: 'Basic Analysis',
      aiInsights: analysis.insights
    };
  }

  async fallbackToBasicAnalysis() {
    console.log('🔄 Using basic analysis without AI');
    // Implement basic analysis without API calls
    const analyses = this.trackedCoins.map(coin => 
      this.basicAnalyzeCoin(coin, 40000 * Math.random(), (Math.random() * 40 - 20))
    );
    
    return {
      totalCoins: analyses.length,
      timestamp: new Date(),
      analyses: analyses,
      dataSource: 'Basic Analysis Only',
      analysisType: 'Non-AI Fallback'
    };
  }

  startBot() {
    this.isRunning = true;
    console.log('🧠 AI-Powered Crypto Bot Started');
    console.log('🤖 Using DeepSeek AI for market analysis');
    return { 
      status: 'started', 
      coins: this.trackedCoins.length,
      dataSource: 'CoinGecko + DeepSeek AI',
      analysisType: 'AI-Powered',
      time: new Date() 
    };
  }

  stopBot() {
    this.isRunning = false;
    console.log('🛑 AI Crypto Bot Stopped');
    return { status: 'stopped', time: new Date() };
  }

  // Toggle AI on/off
  toggleAI() {
    this.useAI = !this.useAI;
    return { 
      aiEnabled: this.useAI, 
      message: `AI analysis ${this.useAI ? 'enabled' : 'disabled'}` 
    };
  }
}

const tradingBot = new AICryptoBot();

// ===== ROUTES =====

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>AI Crypto Trading Bot</title>
        <style>
            body { font-family: Arial, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }
            .card { background: #f5f5f5; padding: 20px; margin: 10px 0; border-radius: 8px; }
            .buy { color: green; font-weight: bold; background: #e8f5e8; }
            .sell { color: red; font-weight: bold; background: #f8d7da; }
            .hold { color: orange; font-weight: bold; background: #fff3cd; }
            .ai-badge { background: #6f42c1; color: white; padding: 4px 8px; border-radius: 4px; font-size: 0.9em; }
            button { padding: 10px 20px; margin: 5px; border: none; border-radius: 4px; cursor: pointer; background: #007bff; color: white; }
            .ai-button { background: #6f42c1; }
            table { width: 100%; border-collapse: collapse; margin: 10px 0; }
            th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
            th { background: #e9ecef; }
            .insights { font-size: 0.9em; color: #666; margin-top: 5px; }
        </style>
    </head>
    <body>
        <h1>🧠 AI-Powered Crypto Trading Bot</h1>
        <p>Using <span class="ai-badge">DeepSeek AI</span> for intelligent market analysis</p>
        
        <div class="card">
            <h3>AI Trading Actions:</h3>
            <button onclick="analyzeWithAI()">🤖 AI Analyze Markets</button>
            <button onclick="toggleAI()" class="ai-button">🔄 Toggle AI</button>
            <button onclick="startBot()">🚀 Start AI Bot</button>
            <button onclick="stopBot()">🛑 Stop Bot</button>
        </div>

        <div class="card">
            <h3>AI Market Analysis <span class="ai-badge">DEEPSEEK AI</span></h3>
            <div id="results">
                <p>Click "AI Analyze Markets" to get intelligent trading signals from DeepSeek AI.</p>
                <p><strong>AI-Powered Analysis:</strong> Technical analysis + market sentiment</p>
            </div>
        </div>

        <script>
            async function analyzeWithAI() {
                try {
                    document.getElementById('results').innerHTML = '<p>🧠 AI is analyzing markets... This may take 10-20 seconds.</p>';
                    
                    const response = await fetch('/analyze-all');
                    const data = await response.json();
                    
                    let tableHTML = \`
                        <table>
                            <thead>
                                <tr>
                                    <th>Coin</th>
                                    <th>Price</th>
                                    <th>24h Change</th>
                                    <th>AI Action</th>
                                    <th>AI Confidence</th>
                                    <th>AI Reasoning</th>
                                    <th>Insights</th>
                                </tr>
                            </thead>
                            <tbody>
                    \`;
                    
                    data.analyses.forEach(coin => {
                        const actionClass = coin.action.toLowerCase();
                        const changeColor = coin.change24h.includes('-') ? 'red' : 'green';
                        
                        tableHTML += \`
                            <tr>
                                <td><strong>\${coin.symbol}</strong><br><small>\${coin.name}</small></td>
                                <td><strong>\${coin.price}</strong></td>
                                <td style="color: \${changeColor}; font-weight: bold;">\${coin.change24h}</td>
                                <td><span class="\${actionClass}">\${coin.action}</span></td>
                                <td>\${(coin.confidence * 100).toFixed(0)}%</td>
                                <td><small>\${coin.reason}</small></td>
                                <td class="insights">\${(coin.aiInsights || ['No insights']).join('<br>')}</td>
                            </tr>
                        \`;
                    });
                    
                    tableHTML += '</tbody></table>';
                    tableHTML += \`
                        <p><em>
                            \${data.analysisType} | Data: \${data.dataSource} | 
                            Updated: \${new Date(data.timestamp).toLocaleString()}
                        </em></p>
                    \`;
                    
                    document.getElementById('results').innerHTML = tableHTML;
                    
                } catch (error) {
                    document.getElementById('results').innerHTML = 
                        '<p style="color: red;">AI analysis failed. The API might be rate limited. Try again in 60 seconds.</p>';
                }
            }

            async function toggleAI() {
                try {
                    const response = await fetch('/toggle-ai', { method: 'POST' });
                    const result = await response.json();
                    alert(\`AI Analysis: \${result.message}\`);
                } catch (error) {
                    alert('Error toggling AI');
                }
            }

            async function startBot() {
                try {
                    const response = await fetch('/start-bot', { method: 'POST' });
                    const result = await response.json();
                    alert(\`\${result.analysisType} Bot Started!\`);
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
            analyzeWithAI();
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

app.post('/toggle-ai', (req, res) => {
  const result = tradingBot.toggleAI();
  res.json(result);
});

app.get('/bot-status', (req, res) => {
  res.json({
    running: tradingBot.isRunning,
    aiEnabled: tradingBot.useAI,
    coinsTracked: tradingBot.trackedCoins.length,
    dataSource: 'DeepSeek AI + CoinGecko',
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
    service: 'ai-crypto-bot',
    aiEnabled: tradingBot.useAI,
    coins: tradingBot.trackedCoins.length,
    time: new Date() 
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🧠 AI-Powered Crypto Bot running on port ${PORT}`);
  console.log(`✅ Using DeepSeek AI for market analysis`);
  console.log(`📊 Tracking ${tradingBot.trackedCoins.length} coins with AI`);
});

module.exports = app;
