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
    this.minConfidence = 0.65;
    this.analysisHistory = [];
    this.liveAnalysis = [];
    this.currentlyAnalyzing = null;
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
      { symbol: 'LINK', name: 'Chainlink', id: 'chainlink' }
    ];
  }

  async startAutoScan() {
    if (this.isRunning) {
      console.log('🔄 Auto-scan already running');
      return;
    }

    this.isRunning = true;
    console.log('🚀 Starting automated technical analysis scan');
    console.log('⏰ Scanning top cryptocurrencies every 5 minutes');
    console.log('📊 Using: RSI + Support/Resistance + Bollinger Bands (Daily)');

    await this.performTechnicalScan();

    this.scanInterval = setInterval(async () => {
      console.log('🔄 Scheduled 5-minute scan triggered');
      await this.performTechnicalScan();
    }, 5 * 60 * 1000);

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

      for (const coin of this.trackedCoins) {
        try {
          const analysis = await this.analyzeWithTechnicalIndicators(coin);
          analyzedCount++;
          
          if (analysis.confidence >= this.minConfidence) {
            opportunities.push(analysis);
            console.log(`✅ ${coin.symbol}: ${analysis.action} (${(analysis.confidence * 100).toFixed(0)}% confidence)`);
          } else {
            console.log(`➖ ${coin.symbol}: No high-confidence signal`);
          }

          await new Promise(resolve => setTimeout(resolve, 1000));
          
        } catch (error) {
          console.log(`❌ ${coin.symbol}: Analysis failed - ${error.message}`);
        }
      }

      opportunities.sort((a, b) => b.confidence - a.confidence);

      this.analysisHistory.unshift({
        timestamp: new Date(),
        opportunities: opportunities.length,
        details: opportunities
      });

      if (this.analysisHistory.length > 288) {
        this.analysisHistory = this.analysisHistory.slice(0, 288);
      }

      console.log(`\n📈 SCAN COMPLETE: ${opportunities.length} opportunities found`);

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
      this.currentlyAnalyzing = {
        symbol: coin.symbol,
        name: coin.name,
        stage: 'Fetching historical data...',
        timestamp: new Date()
      };
      this.updateLiveAnalysis();

      const historicalData = await this.getHistoricalData(coin.id, 7);
      
      if (!historicalData || historicalData.length === 0) {
        throw new Error('No historical data available');
      }

      const validData = historicalData.filter(item => item && typeof item.price === 'number' && item.price > 0);
      if (validData.length < 3) {
        throw new Error('Insufficient valid price data');
      }

      this.currentlyAnalyzing.stage = 'Calculating technical indicators...';
      this.updateLiveAnalysis();

      const currentPrice = validData[validData.length - 1].price;
      const prices = validData.map(d => d.price);
      
      console.log(`📊 ${coin.symbol}: Analyzing ${prices.length} price points, current: $${currentPrice}`);

      this.currentlyAnalyzing.stage = 'Calculating RSI...';
      this.updateLiveAnalysis();
      const rsi = this.calculateRSI(prices, 14);
      
      this.currentlyAnalyzing.stage = 'Calculating Bollinger Bands...';
      this.updateLiveAnalysis();
      const { upperBand, lowerBand } = this.calculateBollingerBands(prices, 20);
      
      this.currentlyAnalyzing.stage = 'Identifying support/resistance...';
      this.updateLiveAnalysis();
      const supportResistance = this.identifySupportResistance(prices);
      
      const trend = this.identifyTrend(prices);

      const technicalData = {
        symbol: coin.symbol,
        name: coin.name,
        currentPrice: currentPrice,
        rsi: rsi,
        bollingerBands: { 
          upper: upperBand, 
          lower: lowerBand,
          position: this.getBollingerPosition(currentPrice, upperBand, lowerBand)
        },
        supportResistance: supportResistance,
        trend: trend,
        priceHistory: prices.slice(-10)
      };

      this.currentlyAnalyzing.stage = 'DeepSeek AI analyzing...';
      this.currentlyAnalyzing.technicals = {
        rsi: rsi.toFixed(1),
        bollingerPosition: technicalData.bollingerBands.position,
        support: supportResistance.support.toFixed(2),
        resistance: supportResistance.resistance.toFixed(2),
        trend: trend
      };
      this.updateLiveAnalysis();

      const aiAnalysis = await this.getAITechnicalAnalysis(technicalData);

      this.currentlyAnalyzing.stage = 'Analysis complete';
      this.currentlyAnalyzing.result = {
        action: aiAnalysis.action,
        confidence: (aiAnalysis.confidence * 100).toFixed(0) + '%',
        reason: aiAnalysis.reason
      };
      this.updateLiveAnalysis();

      setTimeout(() => {
        this.currentlyAnalyzing = null;
        this.updateLiveAnalysis();
      }, 2000);

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
          bollingerPosition: technicalData.bollingerBands.position,
          support: `$${supportResistance.support.toFixed(2)}`,
          resistance: `$${supportResistance.resistance.toFixed(2)}`,
          trend: trend
        },
        insights: aiAnalysis.insights,
        timestamp: new Date()
      };

    } catch (error) {
      console.log(`❌ Technical analysis failed for ${coin.symbol}:`, error.message);
      
      this.currentlyAnalyzing = {
        symbol: coin.symbol,
        name: coin.name,
        stage: 'Analysis failed: ' + error.message,
        timestamp: new Date(),
        error: true
      };
      this.updateLiveAnalysis();

      setTimeout(() => {
        this.currentlyAnalyzing = null;
        this.updateLiveAnalysis();
      }, 3000);

      return this.basicTechnicalAnalysis(coin);
    }
  }

  async getHistoricalData(coinId, days = 7) {
    try {
      console.log(`📊 Fetching historical data for ${coinId}...`);
      
      const response = await axios.get(
        `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}&interval=daily`,
        { 
          timeout: 15000,
          headers: {
            'User-Agent': 'TradingBot/1.0'
          }
        }
      );

      console.log(`✅ Historical data received for ${coinId}`);

      if (response.data && response.data.prices && Array.isArray(response.data.prices)) {
        const historicalData = response.data.prices.map(([timestamp, price]) => ({
          timestamp: new Date(timestamp),
          price: price
        }));
        
        console.log(`📈 ${coinId}: Got ${historicalData.length} data points`);
        return historicalData;
      } else {
        console.log(`❌ ${coinId}: Invalid data structure from API`);
        throw new Error('Invalid API response structure');
      }
      
    } catch (error) {
      console.log(`❌ Historical data fetch failed for ${coinId}:`, error.message);
      return await this.generateRealisticMockData(coinId);
    }
  }

  async generateRealisticMockData(coinId) {
    try {
      console.log(`🔄 Generating realistic mock data for ${coinId}...`);
      
      const currentPriceResponse = await axios.get(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`,
        { timeout: 10000 }
      );

      let basePrice = 100;
      
      if (currentPriceResponse.data && currentPriceResponse.data[coinId]) {
        basePrice = currentPriceResponse.data[coinId].usd;
        console.log(`✅ Using real current price for ${coinId}: $${basePrice}`);
      } else {
        console.log(`⚠️ Using default price for ${coinId}: $${basePrice}`);
      }

      const data = [];
      const now = new Date();
      
      for (let i = 6; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        
        const volatility = 0.02 + (Math.random() * 0.06);
        const change = (Math.random() - 0.5) * 2 * volatility;
        
        const previousPrice = data.length > 0 ? data[data.length - 1].price : basePrice;
        const price = previousPrice * (1 + change);
        
        data.push({
          timestamp: date,
          price: price
        });
      }
      
      console.log(`✅ Generated realistic mock data for ${coinId} (7 days)`);
      return data;
      
    } catch (mockError) {
      console.log(`❌ Mock data generation failed for ${coinId}, using basic fallback`);
      return this.generateBasicMockData();
    }
  }

  generateBasicMockData() {
    const data = [];
    const basePrice = 100 + Math.random() * 1000;
    const now = new Date();
    
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      
      const volatility = 0.05;
      const change = (Math.random() - 0.5) * 2 * volatility;
      const price = i === 6 ? basePrice : data[data.length - 1].price * (1 + change);
      
      data.push({
        timestamp: date,
        price: Math.max(price, 0.0001)
      });
    }
    
    return data;
  }

  updateLiveAnalysis() {
    if (this.currentlyAnalyzing) {
      this.liveAnalysis.unshift({ ...this.currentlyAnalyzing });
      if (this.liveAnalysis.length > 20) {
        this.liveAnalysis = this.liveAnalysis.slice(0, 20);
      }
    }
  }

  getLiveAnalysis() {
    return {
      currentlyAnalyzing: this.currentlyAnalyzing,
      recentAnalysis: this.liveAnalysis.slice(0, 10),
      timestamp: new Date()
    };
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

  getBollingerPosition(price, upperBand, lowerBand) {
    const bandWidth = upperBand - lowerBand;
    if (bandWidth === 0) return 'MIDDLE';
    
    const position = (price - lowerBand) / bandWidth;
    
    if (position > 0.8) return 'UPPER';
    if (position < 0.2) return 'LOWER';
    return 'MIDDLE';
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
          temperature: 0.1
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
- Support: $${technicalData.supportResistance.support}
- Resistance: $${technicalData.supportResistance.resistance}
- Trend: ${technicalData.trend}

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
    let action = 'HOLD';
    let confidence = 0.5;
    let reason = '';
    let insights = [];

    const rsi = technicalData.rsi;
    const bbPosition = technicalData.bollingerBands.position;
    const trend = technicalData.trend;

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
    return this.analysisHistory.slice(0, 10);
  }
}

const tradingBot = new ProfessionalTradingBot();

// ===== ROUTES =====

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>🤖 AI Crypto Trading Scanner</title>
        <meta http-equiv="refresh" content="300">
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }
            
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                color: #333;
            }
            
            .container {
                display: grid;
                grid-template-columns: 1fr 400px;
                gap: 20px;
                max-width: 1800px;
                margin: 0 auto;
                padding: 20px;
                min-height: 100vh;
            }
            
            .main-content {
                background: rgba(255, 255, 255, 0.95);
                border-radius: 20px;
                padding: 30px;
                box-shadow: 0 20px 40px rgba(0,0,0,0.1);
                backdrop-filter: blur(10px);
            }
            
            .sidebar {
                background: rgba(255, 255, 255, 0.95);
                border-radius: 20px;
                padding: 25px;
                box-shadow: 0 20px 40px rgba(0,0,0,0.1);
                backdrop-filter: blur(10px);
                display: flex;
                flex-direction: column;
                gap: 20px;
            }
            
            .header {
                text-align: center;
                margin-bottom: 30px;
                padding-bottom: 20px;
                border-bottom: 2px solid #e9ecef;
            }
            
            .header h1 {
                color: #2c3e50;
                font-size: 2.5em;
                margin-bottom: 10px;
                background: linear-gradient(135deg, #667eea, #764ba2);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            
            .header p {
                color: #6c757d;
                font-size: 1.1em;
            }
            
            .controls {
                background: #f8f9fa;
                padding: 25px;
                border-radius: 15px;
                margin-bottom: 25px;
                border: 1px solid #e9ecef;
            }
            
            .controls h3 {
                color: #2c3e50;
                margin-bottom: 15px;
                display: flex;
                align-items: center;
                gap: 10px;
            }
            
            .button-group {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 10px;
                margin-bottom: 15px;
            }
            
            button {
                padding: 12px 20px;
                border: none;
                border-radius: 10px;
                cursor: pointer;
                font-weight: 600;
                font-size: 14px;
                transition: all 0.3s ease;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
            }
            
            .btn-primary {
                background: linear-gradient(135deg, #667eea, #764ba2);
                color: white;
            }
            
            .btn-success {
                background: linear-gradient(135deg, #56ab2f, #a8e6cf);
                color: white;
            }
            
            .btn-danger {
                background: linear-gradient(135deg, #ff6b6b, #ff8e8e);
                color: white;
            }
            
            .btn-secondary {
                background: #6c757d;
                color: white;
            }
            
            button:hover {
                transform: translateY(-2px);
                box-shadow: 0 5px 15px rgba(0,0,0,0.2);
            }
            
            .status-card {
                background: linear-gradient(135deg, #74b9ff, #0984e3);
                color: white;
                padding: 20px;
                border-radius: 15px;
                text-align: center;
            }
            
            .status-card h4 {
                margin-bottom: 10px;
                font-size: 1.1em;
            }
            
            .opportunity {
                background: white;
                border-radius: 15px;
                padding: 20px;
                margin-bottom: 15px;
                border-left: 5px solid;
                box-shadow: 0 5px 15px rgba(0,0,0,0.08);
                transition: transform 0.3s ease;
            }
            
            .opportunity:hover {
                transform: translateY(-3px);
            }
            
            .opportunity.buy {
                border-left-color: #00b894;
                background: linear-gradient(135deg, #fff, #e8f5e8);
            }
            
            .opportunity.sell {
                border-left-color: #ff7675;
                background: linear-gradient(135deg, #fff, #f8d7da);
            }
            
            .opportunity.hold {
                border-left-color: #fdcb6e;
                background: linear-gradient(135deg, #fff, #fff3cd);
            }
            
            .coin-header {
                display: flex;
                justify-content: between;
                align-items: center;
                margin-bottom: 15px;
            }
            
            .coin-name {
                font-size: 1.3em;
                font-weight: bold;
                color: #2c3e50;
            }
            
            .action-badge {
                padding: 6px 12px;
                border-radius: 20px;
                font-weight: bold;
                font-size: 0.9em;
            }
            
            .buy-badge {
                background: #00b894;
                color: white;
            }
            
            .sell-badge {
                background: #ff7675;
                color: white;
            }
            
            .hold-badge {
                background: #fdcb6e;
                color: white;
            }
            
            .technical-grid {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 10px;
                margin: 15px 0;
            }
            
            .technical-item {
                background: #f8f9fa;
                padding: 10px;
                border-radius: 8px;
                text-align: center;
                font-size: 0.9em;
            }
            
            .technical-item strong {
                display: block;
                color: #6c757d;
                font-size: 0.8em;
                margin-bottom: 5px;
            }
            
            .confidence-bar {
                height: 8px;
                background: #e9ecef;
                border-radius: 10px;
                margin: 10px 0;
                overflow: hidden;
            }
            
            .confidence-fill {
                height: 100%;
                border-radius: 10px;
                transition: width 0.5s ease;
            }
            
            .high-confidence { background: linear-gradient(90deg, #00b894, #55efc4); }
            .medium-confidence { background: linear-gradient(90deg, #fdcb6e, #ffeaa7); }
            .low-confidence { background: linear-gradient(90deg, #ff7675, #ff9a9e); }
            
            .ai-panel {
                background: #2c3e50;
                color: white;
                border-radius: 15px;
                padding: 0;
                overflow: hidden;
            }
            
            .ai-header {
                background: linear-gradient(135deg, #34495e, #2c3e50);
                padding: 20px;
                text-align: center;
                border-bottom: 1px solid #34495e;
            }
            
            .ai-header h3 {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 10px;
                font-size: 1.2em;
            }
            
            .current-analysis {
                padding: 20px;
                background: #34495e;
                margin: 15px;
                border-radius: 10px;
                min-height: 200px;
            }
            
            .analysis-stage {
                font-size: 1.1em;
                margin-bottom: 15px;
                color: #74b9ff;
                font-weight: 600;
            }
            
            .analysis-technicals {
                background: #2c3e50;
                padding: 15px;
                border-radius: 8px;
                margin: 15px 0;
            }
            
            .technical-row {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 10px;
                margin-bottom: 8px;
            }
            
            .recent-analysis {
                max-height: 300px;
                overflow-y: auto;
                padding: 15px;
            }
            
            .recent-item {
                background: #34495e;
                padding: 12px;
                margin-bottom: 8px;
                border-radius: 8px;
                border-left: 3px solid #74b9ff;
                font-size: 0.9em;
            }
            
            .no-opportunities {
                text-align: center;
                padding: 60px 20px;
                color: #6c757d;
            }
            
            .no-opportunities h3 {
                margin-bottom: 15px;
                color: #95a5a6;
            }
            
            .scan-info {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 15px;
                margin-top: 15px;
            }
            
            .info-item {
                background: #f8f9fa;
                padding: 15px;
                border-radius: 10px;
                text-align: center;
            }
            
            .info-value {
                font-size: 1.5em;
                font-weight: bold;
                color: #2c3e50;
                margin-top: 5px;
            }
            
            @media (max-width: 1200px) {
                .container {
                    grid-template-columns: 1fr;
                }
                
                .sidebar {
                    order: -1;
                }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <!-- Main Content -->
            <div class="main-content">
                <div class="header">
                    <h1>🤖 AI Crypto Trading Scanner</h1>
                    <p>Professional Technical Analysis • RSI + Bollinger Bands + Support/Resistance</p>
                </div>
                
                <div class="controls">
                    <h3>🎯 Scanner Controls</h3>
                    <div class="button-group">
                        <button class="btn-success" onclick="startAutoScan()">
                            🚀 Start Auto-Scan
                        </button>
                        <button class="btn-danger" onclick="stopAutoScan()">
                            🛑 Stop Auto-Scan
                        </button>
                        <button class="btn-primary" onclick="manualScan()">
                            🔍 Scan Now
                        </button>
                        <button class="btn-secondary" onclick="viewHistory()">
                            📊 History
                        </button>
                    </div>
                    
                    <div class="status-card">
                        <h4>Scanner Status</h4>
                        <div id="statusText">🟢 Ready to start</div>
                        <div id="nextScan">Next scan: Not scheduled</div>
                    </div>
                </div>
                
                <div>
                    <h3 style="margin-bottom: 20px; color: #2c3e50;">📈 Trading Opportunities</h3>
                    <div id="results">
                        <div class="no-opportunities">
                            <h3>🔍 Ready to Scan</h3>
                            <p>Click "Scan Now" to start technical analysis</p>
                            <p>Only high-confidence opportunities (65%+) will be shown</p>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- AI Analysis Sidebar -->
            <div class="sidebar">
                <div class="ai-panel">
                    <div class="ai-header">
                        <h3>🧠 DeepSeek AI Analysis</h3>
                        <p>Live Technical Analysis</p>
                    </div>
                    
                    <div class="current-analysis">
                        <h4 style="margin-bottom: 15px; color: #74b9ff;">Current Analysis</h4>
                        <div id="currentAnalysis">
                            <div class="analysis-stage">Waiting for analysis to start...</div>
                            <p style="color: #bdc3c7; text-align: center; margin-top: 20px;">
                                Start a scan to see live AI analysis
                            </p>
                        </div>
                    </div>
                    
                    <div style="padding: 0 20px;">
                        <h4 style="margin-bottom: 15px; color: white;">Recent Analysis</h4>
                        <div class="recent-analysis" id="recentAnalysis">
                            <div style="color: #bdc3c7; text-align: center; padding: 20px;">
                                No recent analysis
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="scan-info">
                    <div class="info-item">
                        <div>Coins Tracked</div>
                        <div class="info-value" id="coinsTracked">10</div>
                    </div>
                    <div class="info-item">
                        <div>Confidence Min</div>
                        <div class="info-value" id="confidenceMin">65%</div>
                    </div>
                </div>
            </div>
        </div>

        <script>
            let analysisUpdateInterval = null;

            async function updateLiveAnalysis() {
                try {
                    const response = await fetch('/live-analysis');
                    const data = await response.json();
                    
                    const currentDiv = document.getElementById('currentAnalysis');
                    if (data.currentlyAnalyzing) {
                        const analysis = data.currentlyAnalyzing;
                        currentDiv.innerHTML = \`
                            <div class="analysis-stage">\${analysis.stage}</div>
                            <div style="margin: 10px 0; padding: 10px; background: #2c3e50; border-radius: 8px;">
                                <strong style="color: #74b9ff;">\${analysis.symbol}</strong> - \${analysis.name}
                                <br><small style="color: #bdc3c7;">\${new Date(analysis.timestamp).toLocaleTimeString()}</small>
                            </div>
                            \${analysis.technicals ? \`
                            <div class="analysis-technicals">
                                <div style="color: #ecf0f1; margin-bottom: 10px;">Technical Indicators:</div>
                                <div class="technical-row">
                                    <div>RSI: <span style="color: #74b9ff;">\${analysis.technicals.rsi}</span></div>
                                    <div>Bollinger: <span style="color: #74b9ff;">\${analysis.technicals.bollingerPosition}</span></div>
                                </div>
                                <div class="technical-row">
                                    <div>Support: <span style="color: #74b9ff;">$\${analysis.technicals.support}</span></div>
                                    <div>Resistance: <span style="color: #74b9ff;">$\${analysis.technicals.resistance}</span></div>
                                </div>
                                <div class="technical-row">
                                    <div>Trend: <span style="color: #74b9ff;">\${analysis.technicals.trend}</span></div>
                                </div>
                            </div>
                            \` : ''}
                            \${analysis.result ? \`
                            <div style="background: \${analysis.result.action === 'BUY' ? '#00b894' : analysis.result.action === 'SELL' ? '#ff7675' : '#fdcb6e'}; 
                                        padding: 15px; border-radius: 10px; margin-top: 15px; text-align: center;">
                                <div style="font-size: 1.2em; font-weight: bold; margin-bottom: 5px;">
                                    \${analysis.result.action} (\${analysis.result.confidence})
                                </div>
                                <div style="font-size: 0.9em;">
                                    \${analysis.result.reason}
                                </div>
                            </div>
                            \` : ''}
                            \${analysis.error ? \`
                            <div style="background: #e74c3c; color: white; padding: 15px; border-radius: 10px; margin-top: 15px; text-align: center;">
                                ❌ \${analysis.stage}
                            </div>
                            \` : ''}
                        \`;
                    } else {
                        currentDiv.innerHTML = \`
                            <div class="analysis-stage">No Active Analysis</div>
                            <p style="color: #bdc3c7; text-align: center; margin-top: 20px;">
                                The scanner is currently not analyzing any coins.<br>
                                Start a scan to see live AI analysis.
                            </p>
                        \`;
                    }
                    
                    const recentDiv = document.getElementById('recentAnalysis');
                    if (data.recentAnalysis && data.recentAnalysis.length > 0) {
                        recentDiv.innerHTML = data.recentAnalysis.map(analysis => \`
                            <div class="recent-item">
                                <strong>\${analysis.symbol}</strong>: \${analysis.stage}
                                <br><small style="color: #bdc3c7;">\${new Date(analysis.timestamp).toLocaleTimeString()}</small>
                                \${analysis.result ? \`
                                <br><small style="color: \${analysis.result.action === 'BUY' ? '#00b894' : analysis.result.action === 'SELL' ? '#ff7675' : '#fdcb6e'}">
                                    → \${analysis.result.action} (\${analysis.result.confidence})
                                </small>\` : ''}
                            </div>
                        \`).join('');
                    } else {
                        recentDiv.innerHTML = '<div style="color: #bdc3c7; text-align: center; padding: 20px;">No recent analysis</div>';
                    }
                    
                } catch (error) {
                    console.log('Error updating live analysis:', error);
                }
            }

            async function startAutoScan() {
                try {
                    const response = await fetch('/start-scan', { method: 'POST' });
                    const result = await response.json();
                    
                    document.getElementById('statusText').innerHTML = '🔄 Auto-Scanning';
                    document.getElementById('nextScan').textContent = 'Next scan: Every 5 minutes';
                    
                    manualScan();
                    
                } catch (error) {
                    alert('Error starting auto-scan');
                }
            }

            async function stopAutoScan() {
                try {
                    const response = await fetch('/stop-scan', { method: 'POST' });
                    const result = await response.json();
                    
                    document.getElementById('statusText').innerHTML = '🛑 Stopped';
                    document.getElementById('nextScan').textContent = 'Next scan: Manual mode';
                    
                } catch (error) {
                    alert('Error stopping auto-scan');
                }
            }

            async function manualScan() {
                try {
                    document.getElementById('results').innerHTML = '<div class="no-opportunities"><h3>🔍 Scanning...</h3><p>Analyzing cryptocurrencies with technical analysis</p></div>';
                    
                    // Start live analysis updates
                    if (analysisUpdateInterval) clearInterval(analysisUpdateInterval);
                    analysisUpdateInterval = setInterval(updateLiveAnalysis, 2000);
                    updateLiveAnalysis();
                    
                    const response = await fetch('/scan-now');
                    const data = await response.json();
                    
                    if (data.opportunities.length === 0) {
                        document.getElementById('results').innerHTML = \`
                            <div class="no-opportunities">
                                <h3>📭 No High-Confidence Opportunities</h3>
                                <p>Scanned \${data.analyzedCoins} of \${data.totalCoins} coins</p>
                                <p><em>No technical setups meeting 65%+ confidence threshold</em></p>
                                <p>Next scan: \${new Date(data.nextScan).toLocaleTimeString()}</p>
                            </div>
                        \`;
                        return;
                    }
                    
                    let opportunitiesHTML = \`
                        <div style="margin-bottom: 25px;">
                            <div style="background: linear-gradient(135deg, #74b9ff, #0984e3); color: white; padding: 20px; border-radius: 15px; text-align: center;">
                                <h3 style="margin-bottom: 10px;">🎯 Found \${data.opportunitiesFound} Opportunities</h3>
                                <p>Scan: \${new Date(data.scanTime).toLocaleString()} | Next: \${new Date(data.nextScan).toLocaleTimeString()}</p>
                            </div>
                        </div>
                    \`;
                    
                    data.opportunities.forEach(opp => {
                        const actionClass = opp.action.toLowerCase();
                        const confidencePercent = (opp.confidence * 100).toFixed(0);
                        const confidenceLevel = confidencePercent >= 75 ? 'high-confidence' : confidencePercent >= 60 ? 'medium-confidence' : 'low-confidence';
                        
                        opportunitiesHTML += \`
                            <div class="opportunity \${actionClass}">
                                <div class="coin-header">
                                    <div class="coin-name">\${opp.symbol} - \${opp.name}</div>
                                    <div class="\${actionClass}-badge action-badge">\${opp.action}</div>
                                </div>
                                
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin: 15px 0;">
                                    <div>
                                        <div style="font-size: 1.4em; font-weight: bold; color: #2c3e50;">\${opp.price}</div>
                                        <div style="color: #6c757d; font-size: 0.9em;">Current Price</div>
                                    </div>
                                    <div>
                                        <div style="font-size: 1.4em; font-weight: bold; color: #2c3e50;">\${confidencePercent}%</div>
                                        <div style="color: #6c757d; font-size: 0.9em;">Confidence</div>
                                    </div>
                                </div>
                                
                                <div class="confidence-bar">
                                    <div class="confidence-fill \${confidenceLevel}" style="width: \${confidencePercent}%"></div>
                                </div>
                                
                                <div style="margin: 15px 0; color: #5a6268; line-height: 1.5;">
                                    \${opp.reason}
                                </div>
                                
                                <div class="technical-grid">
                                    <div class="technical-item">
                                        <strong>RSI</strong>
                                        \${opp.technicals.rsi}
                                    </div>
                                    <div class="technical-item">
                                        <strong>Bollinger</strong>
                                        \${opp.technicals.bollingerPosition}
                                    </div>
                                    <div class="technical-item">
                                        <strong>Support</strong>
                                        \${opp.technicals.support}
                                    </div>
                                    <div class="technical-item">
                                        <strong>Resistance</strong>
                                        \${opp.technicals.resistance}
                                    </div>
                                    <div class="technical-item">
                                        <strong>Trend</strong>
                                        \${opp.technicals.trend}
                                    </div>
                                </div>
                                
                                <div style="margin-top: 15px;">
                                    <strong style="color: #6c757d;">Insights:</strong>
                                    <ul style="margin-top: 8px; padding-left: 20px; color: #5a6268;">
                                        \${opp.insights.map(insight => \`<li>\${insight}</li>\`).join('')}
                                    </ul>
                                </div>
                                
                                <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #e9ecef; color: #6c757d; font-size: 0.8em;">
                                    Analyzed: \${new Date(opp.timestamp).toLocaleString()}
                                </div>
                            </div>
                        \`;
                    });
                    
                    document.getElementById('results').innerHTML = opportunitiesHTML;
                    
                } catch (error) {
                    document.getElementById('results').innerHTML = 
                        '<div class="no-opportunities" style="color: #e74c3c;"><h3>❌ Scan Failed</h3><p>Technical analysis may be rate limited. Try again in 60 seconds.</p></div>';
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

            // Auto-refresh every 30 seconds when auto-scanning
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

app.get('/live-analysis', (req, res) => {
  const liveAnalysis = tradingBot.getLiveAnalysis();
  res.json(liveAnalysis);
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
  console.log(`🎯 Coins: ${tradingBot.trackedCoins.length} cryptocurrencies`);
});

module.exports = app;
