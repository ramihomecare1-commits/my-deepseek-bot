const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

// Telegram Configuration
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const TELEGRAM_ENABLED = TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID;

// Enhanced Professional Trading Bot
class ProfessionalTradingBot {
  constructor() {
    this.isRunning = false;
    this.scanInterval = null;
    this.trackedCoins = this.getTop100Coins();
    this.minConfidence = 0.65;
    this.analysisHistory = [];
    this.liveAnalysis = [];
    this.currentlyAnalyzing = null;
    this.stats = {
      totalScans: 0,
      totalOpportunities: 0,
      avgConfidence: 0,
      lastScanDuration: 0,
      notificationsSent: 0
    };
    this.lastNotificationTime = {};
  }

  getTop100Coins() {
    return [
      { symbol: 'BTC', name: 'Bitcoin', id: 'bitcoin' },
      { symbol: 'ETH', name: 'Ethereum', id: 'ethereum' },
      { symbol: 'USDT', name: 'Tether', id: 'tether' },
      { symbol: 'BNB', name: 'Binance Coin', id: 'binancecoin' },
      { symbol: 'SOL', name: 'Solana', id: 'solana' },
      { symbol: 'USDC', name: 'USD Coin', id: 'usd-coin' },
      { symbol: 'XRP', name: 'Ripple', id: 'ripple' },
      { symbol: 'DOGE', name: 'Dogecoin', id: 'dogecoin' },
      { symbol: 'ADA', name: 'Cardano', id: 'cardano' },
      { symbol: 'TRX', name: 'TRON', id: 'tron' },
      { symbol: 'AVAX', name: 'Avalanche', id: 'avalanche-2' },
      { symbol: 'SHIB', name: 'Shiba Inu', id: 'shiba-inu' },
      { symbol: 'TON', name: 'Toncoin', id: 'the-open-network' },
      { symbol: 'LINK', name: 'Chainlink', id: 'chainlink' },
      { symbol: 'DOT', name: 'Polkadot', id: 'polkadot' },
      { symbol: 'BCH', name: 'Bitcoin Cash', id: 'bitcoin-cash' },
      { symbol: 'MATIC', name: 'Polygon', id: 'matic-network' },
      { symbol: 'DAI', name: 'Dai', id: 'dai' },
      { symbol: 'LTC', name: 'Litecoin', id: 'litecoin' },
      { symbol: 'UNI', name: 'Uniswap', id: 'uniswap' },
      { symbol: 'NEAR', name: 'NEAR Protocol', id: 'near' },
      { symbol: 'ICP', name: 'Internet Computer', id: 'internet-computer' },
      { symbol: 'LEO', name: 'LEO Token', id: 'leo-token' },
      { symbol: 'ETC', name: 'Ethereum Classic', id: 'ethereum-classic' },
      { symbol: 'APT', name: 'Aptos', id: 'aptos' },
      { symbol: 'ATOM', name: 'Cosmos', id: 'cosmos' },
      { symbol: 'FIL', name: 'Filecoin', id: 'filecoin' },
      { symbol: 'CRO', name: 'Cronos', id: 'crypto-com-chain' },
      { symbol: 'ARB', name: 'Arbitrum', id: 'arbitrum' },
      { symbol: 'XLM', name: 'Stellar', id: 'stellar' },
      { symbol: 'VET', name: 'VeChain', id: 'vechain' },
      { symbol: 'OKB', name: 'OKB', id: 'okb' },
      { symbol: 'XMR', name: 'Monero', id: 'monero' },
      { symbol: 'ALGO', name: 'Algorand', id: 'algorand' },
      { symbol: 'HBAR', name: 'Hedera', id: 'hedera-hashgraph' },
      { symbol: 'INJ', name: 'Injective', id: 'injective-protocol' },
      { symbol: 'OP', name: 'Optimism', id: 'optimism' },
      { symbol: 'QNT', name: 'Quant', id: 'quant-network' },
      { symbol: 'AAVE', name: 'Aave', id: 'aave' },
      { symbol: 'GRT', name: 'The Graph', id: 'the-graph' },
      { symbol: 'RUNE', name: 'THORChain', id: 'thorchain' },
      { symbol: 'STX', name: 'Stacks', id: 'blockstack' },
      { symbol: 'MKR', name: 'Maker', id: 'maker' },
      { symbol: 'SAND', name: 'The Sandbox', id: 'the-sandbox' },
      { symbol: 'MANA', name: 'Decentraland', id: 'decentraland' },
      { symbol: 'FTM', name: 'Fantom', id: 'fantom' },
      { symbol: 'AXS', name: 'Axie Infinity', id: 'axie-infinity' },
      { symbol: 'THETA', name: 'Theta Network', id: 'theta-token' },
      { symbol: 'EGLD', name: 'MultiversX', id: 'elrond-erd-2' },
      { symbol: 'XTZ', name: 'Tezos', id: 'tezos' },
      { symbol: 'FLOW', name: 'Flow', id: 'flow' },
      { symbol: 'EOS', name: 'EOS', id: 'eos' },
      { symbol: 'KCS', name: 'KuCoin Token', id: 'kucoin-shares' },
      { symbol: 'CHZ', name: 'Chiliz', id: 'chiliz' },
      { symbol: 'BSV', name: 'Bitcoin SV', id: 'bitcoin-cash-sv' },
      { symbol: 'ZEC', name: 'Zcash', id: 'zcash' },
      { symbol: 'KLAY', name: 'Klaytn', id: 'klay-token' },
      { symbol: 'CAKE', name: 'PancakeSwap', id: 'pancakeswap-token' },
      { symbol: 'NEO', name: 'Neo', id: 'neo' },
      { symbol: 'DASH', name: 'Dash', id: 'dash' },
      { symbol: 'IOTA', name: 'IOTA', id: 'iota' },
      { symbol: 'LDO', name: 'Lido DAO', id: 'lido-dao' },
      { symbol: 'CFX', name: 'Conflux', id: 'conflux-token' },
      { symbol: 'GALA', name: 'Gala', id: 'gala' },
      { symbol: 'BAT', name: 'Basic Attention Token', id: 'basic-attention-token' },
      { symbol: 'ZIL', name: 'Zilliqa', id: 'zilliqa' },
      { symbol: 'ENJ', name: 'Enjin Coin', id: 'enjincoin' },
      { symbol: 'CRV', name: 'Curve DAO', id: 'curve-dao-token' },
      { symbol: 'SNX', name: 'Synthetix', id: 'havven' },
      { symbol: 'MINA', name: 'Mina', id: 'mina-protocol' },
      { symbol: '1INCH', name: '1inch', id: '1inch' },
      { symbol: 'FXS', name: 'Frax Share', id: 'frax-share' },
      { symbol: 'COMP', name: 'Compound', id: 'compound-governance-token' },
      { symbol: 'HNT', name: 'Helium', id: 'helium' },
      { symbol: 'ZRX', name: '0x', id: '0x' },
      { symbol: 'LRC', name: 'Loopring', id: 'loopring' },
      { symbol: 'IMX', name: 'Immutable X', id: 'immutable-x' },
      { symbol: 'ONE', name: 'Harmony', id: 'harmony' },
      { symbol: 'GMX', name: 'GMX', id: 'gmx' },
      { symbol: 'ROSE', name: 'Oasis Network', id: 'oasis-network' },
      { symbol: 'WAVES', name: 'Waves', id: 'waves' },
      { symbol: 'CVX', name: 'Convex Finance', id: 'convex-finance' },
      { symbol: 'NEXO', name: 'Nexo', id: 'nexo' },
      { symbol: 'JST', name: 'JUST', id: 'just' },
      { symbol: 'ZEN', name: 'Horizen', id: 'zencash' },
      { symbol: 'WOO', name: 'WOO Network', id: 'woo-network' },
      { symbol: 'YFI', name: 'yearn.finance', id: 'yearn-finance' },
      { symbol: 'AUDIO', name: 'Audius', id: 'audius' },
      { symbol: 'SXP', name: 'Solar', id: 'swipe' },
      { symbol: 'DYDX', name: 'dYdX', id: 'dydx' },
      { symbol: 'HOT', name: 'Holo', id: 'holotoken' },
      { symbol: 'ANKR', name: 'Ankr', id: 'ankr' },
      { symbol: 'CELO', name: 'Celo', id: 'celo' },
      { symbol: 'BAL', name: 'Balancer', id: 'balancer' },
      { symbol: 'SKL', name: 'SKALE', id: 'skale' },
      { symbol: 'QTUM', name: 'Qtum', id: 'qtum' },
      { symbol: 'SUSHI', name: 'SushiSwap', id: 'sushi' },
      { symbol: 'OMG', name: 'OMG Network', id: 'omisego' },
      { symbol: 'RNDR', name: 'Render Token', id: 'render-token' },
      { symbol: 'FET', name: 'Fetch.ai', id: 'fetch-ai' },
      { symbol: 'AGIX', name: 'SingularityNET', id: 'singularitynet' },
      { symbol: 'OCEAN', name: 'Ocean Protocol', id: 'ocean-protocol' },
      { symbol: 'NMR', name: 'Numeraire', id: 'numeraire' },
      { symbol: 'UMA', name: 'UMA', id: 'uma' },
      { symbol: 'BAND', name: 'Band Protocol', id: 'band-protocol' },
      { symbol: 'OXT', name: 'Orchid', id: 'orchid' },
      { symbol: 'CVC', name: 'Civic', id: 'civic' },
      { symbol: 'REP', name: 'Augur', id: 'augur' },
      { symbol: 'STORJ', name: 'Storj', id: 'storj' },
      { symbol: 'LOOM', name: 'Loom Network', id: 'loom-network' },
      { symbol: 'POWR', name: 'Power Ledger', id: 'power-ledger' },
      { symbol: 'COTI', name: 'COTI', id: 'coti' },
      { symbol: 'DENT', name: 'Dent', id: 'dent' }
    ];
  }

  async startAutoScan() {
    if (this.isRunning) {
      console.log('🔄 Auto-scan already running');
      return { status: 'already_running' };
    }

    this.isRunning = true;
    console.log('🚀 Starting automated technical analysis scan');

    await this.performTechnicalScan();

    this.scanInterval = setInterval(async () => {
      console.log('🔄 Scheduled 1-hour scan triggered');
      await this.performTechnicalScan();
    }, 60 * 60 * 1000);

    return {
      status: 'started',
      interval: '1 hour',
      coins: this.trackedCoins.length,
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

  async sendTelegramNotification(opportunity) {
    if (!TELEGRAM_ENABLED) {
      console.log('⚠️ Telegram notifications disabled (missing credentials)');
      return false;
    }

    const coinKey = opportunity.symbol;
    const now = Date.now();
    const cooldown = 30 * 60 * 1000;

    if (this.lastNotificationTime[coinKey] && (now - this.lastNotificationTime[coinKey]) < cooldown) {
      console.log(`⏳ Skipping notification for ${coinKey} (cooldown active)`);
      return false;
    }

    try {
      const actionEmoji = opportunity.action === 'BUY' ? '🟢' : opportunity.action === 'SELL' ? '🔴' : '🟡';
      const confidencePercent = (opportunity.confidence * 100).toFixed(0);
      
      const message = `${actionEmoji} *${opportunity.action} SIGNAL DETECTED*

*Coin:* ${opportunity.name} (${opportunity.symbol})
*Price:* ${opportunity.price}
*Confidence:* ${confidencePercent}%

📊 *Technical Analysis:*
• RSI: ${opportunity.technicals.rsi}
• Bollinger: ${opportunity.technicals.bollingerPosition}
• Trend: ${opportunity.technicals.trend}
• Momentum: ${opportunity.technicals.momentum || 'N/A'}
• Support: ${opportunity.technicals.support}
• Resistance: ${opportunity.technicals.resistance}

💡 *Key Insights:*
${opportunity.insights.map(insight => `→ ${insight}`).join('\n')}

📝 *Reason:* ${opportunity.reason}

⏰ Detected: ${new Date(opportunity.timestamp).toLocaleString()}`;

      const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
      
      const response = await axios.post(telegramUrl, {
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown'
      }, {
        timeout: 10000
      });

      if (response.data.ok) {
        console.log(`✅ Telegram notification sent for ${opportunity.symbol}`);
        this.lastNotificationTime[coinKey] = now;
        this.stats.notificationsSent++;
        return true;
      } else {
        console.log(`❌ Telegram API error: ${response.data.description}`);
        return false;
      }
      
    } catch (error) {
      console.log(`❌ Failed to send Telegram notification: ${error.message}`);
      return false;
    }
  }

  async sendTestNotification() {
    if (!TELEGRAM_ENABLED) {
      return { success: false, message: 'Telegram credentials not configured' };
    }

    try {
      const testOpportunity = {
        symbol: 'TEST',
        name: 'Test Coin',
        action: 'BUY',
        price: '$1,234.56',
        confidence: 0.85,
        signal: 'TEST | System Check',
        reason: 'This is a test notification to verify Telegram integration is working correctly.',
        technicals: {
          rsi: '45.2',
          bollingerPosition: 'MIDDLE',
          trend: 'BULLISH',
          momentum: 'UP',
          support: '$1,200.00',
          resistance: '$1,300.00'
        },
        insights: [
          '✅ Telegram integration test successful',
          '✅ Bot is properly configured',
          '✅ Notifications will be sent for trading opportunities'
        ],
        timestamp: new Date()
      };

      const success = await this.sendTelegramNotification(testOpportunity);
      
      if (success) {
        return { 
          success: true, 
          message: '✅ Test notification sent successfully! Check your Telegram.' 
        };
      } else {
        return { 
          success: false, 
          message: '❌ Failed to send test notification. Check console for details.' 
        };
      }
    } catch (error) {
      return { 
        success: false, 
        message: `❌ Error sending test: ${error.message}` 
      };
    }
  }

  async performTechnicalScan() {
    const startTime = Date.now();
    try {
      console.log(`\n🎯 TECHNICAL SCAN STARTED: ${new Date().toLocaleString()}`);

      const opportunities = [];
      let analyzedCount = 0;

      for (const coin of this.trackedCoins) {
        try {
          const analysis = await this.analyzeWithTechnicalIndicators(coin);
          analyzedCount++;
          
          if (analysis.confidence >= this.minConfidence) {
            opportunities.push(analysis);
            console.log(`✅ ${coin.symbol}: ${analysis.action} (${(analysis.confidence * 100).toFixed(0)}% confidence)`);
          }

          await new Promise(resolve => setTimeout(resolve, 800));
          
        } catch (error) {
          console.log(`❌ ${coin.symbol}: Analysis failed - ${error.message}`);
        }
      }

      opportunities.sort((a, b) => b.confidence - a.confidence);

      this.stats.totalScans++;
      this.stats.totalOpportunities += opportunities.length;
      this.stats.lastScanDuration = Date.now() - startTime;
      if (opportunities.length > 0) {
        this.stats.avgConfidence = opportunities.reduce((sum, o) => sum + o.confidence, 0) / opportunities.length;
      }

      if (TELEGRAM_ENABLED && opportunities.length > 0) {
        console.log(`📱 Sending Telegram notifications for ${opportunities.length} opportunities...`);
        for (const opp of opportunities) {
          await this.sendTelegramNotification(opp);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      this.analysisHistory.unshift({
        timestamp: new Date(),
        opportunities: opportunities.length,
        details: opportunities,
        duration: this.stats.lastScanDuration
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
        nextScan: new Date(Date.now() + 60 * 60 * 1000),
        duration: this.stats.lastScanDuration
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
        timestamp: new Date(),
        progress: 10
      };
      this.updateLiveAnalysis();

      const dailyData = await this.getHistoricalData(coin.id, 7, 'daily');
      const hourlyData = await this.getHistoricalData(coin.id, 1, 'hourly');
      
      if ((!dailyData || dailyData.length === 0) && (!hourlyData || hourlyData.length === 0)) {
        throw new Error('No historical data available');
      }

      const validDailyData = dailyData ? dailyData.filter(item => item && typeof item.price === 'number' && item.price > 0) : [];
      const validHourlyData = hourlyData ? hourlyData.filter(item => item && typeof item.price === 'number' && item.price > 0) : [];
      
      if (validDailyData.length < 3 && validHourlyData.length < 3) {
        throw new Error('Insufficient valid price data');
      }

      this.currentlyAnalyzing.stage = 'Calculating technical indicators...';
      this.currentlyAnalyzing.progress = 40;
      this.updateLiveAnalysis();

      const currentPrice = validHourlyData.length > 0 ? 
        validHourlyData[validHourlyData.length - 1].price : 
        validDailyData[validDailyData.length - 1].price;

      const dailyPrices = validDailyData.map(d => d.price);
      const hourlyPrices = validHourlyData.map(d => d.price);

      this.currentlyAnalyzing.stage = 'Analyzing multiple timeframes...';
      this.currentlyAnalyzing.progress = 60;
      this.updateLiveAnalysis();
      
      const dailyRsi = dailyPrices.length >= 14 ? this.calculateRSI(dailyPrices, 14) : 50;
      const dailyBB = dailyPrices.length >= 20 ? this.calculateBollingerBands(dailyPrices, 20) : { upper: currentPrice * 1.1, lower: currentPrice * 0.9 };
      const dailySR = this.identifySupportResistance(dailyPrices);
      const dailyTrend = this.identifyTrend(dailyPrices);

      const hourlyRsi = hourlyPrices.length >= 14 ? this.calculateRSI(hourlyPrices, 14) : 50;
      const hourlyBB = hourlyPrices.length >= 20 ? this.calculateBollingerBands(hourlyPrices, 20) : { upper: currentPrice * 1.1, lower: currentPrice * 0.9 };
      const hourlyTrend = this.identifyTrend(hourlyPrices);
      const momentum = this.calculateMomentum(hourlyPrices.length > 0 ? hourlyPrices : dailyPrices);

      const technicalData = {
        symbol: coin.symbol,
        name: coin.name,
        currentPrice: currentPrice,
        daily: {
          rsi: dailyRsi,
          bollingerBands: { 
            upper: dailyBB.upper, 
            lower: dailyBB.lower,
            position: this.getBollingerPosition(currentPrice, dailyBB.upper, dailyBB.lower)
          },
          supportResistance: dailySR,
          trend: dailyTrend
        },
        hourly: {
          rsi: hourlyRsi,
          bollingerBands: { 
            upper: hourlyBB.upper, 
            lower: hourlyBB.lower,
            position: this.getBollingerPosition(currentPrice, hourlyBB.upper, hourlyBB.lower)
          },
          trend: hourlyTrend
        },
        momentum: momentum,
        priceHistory: dailyPrices.slice(-10)
      };

      this.currentlyAnalyzing.stage = 'DeepSeek AI analyzing...';
      this.currentlyAnalyzing.progress = 80;
      this.currentlyAnalyzing.technicals = {
        dailyRsi: dailyRsi.toFixed(1),
        hourlyRsi: hourlyRsi.toFixed(1),
        dailyBB: technicalData.daily.bollingerBands.position,
        hourlyBB: technicalData.hourly.bollingerBands.position,
        dailyTrend: dailyTrend,
        hourlyTrend: hourlyTrend,
        momentum: momentum
      };
      this.updateLiveAnalysis();

      const aiAnalysis = await this.getAITechnicalAnalysis(technicalData);

      this.currentlyAnalyzing.stage = 'Analysis complete';
      this.currentlyAnalyzing.progress = 100;
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
        price: `${currentPrice.toFixed(4)}`,
        confidence: aiAnalysis.confidence,
        signal: aiAnalysis.signal,
        reason: aiAnalysis.reason,
        technicals: {
          dailyRsi: dailyRsi.toFixed(1),
          hourlyRsi: hourlyRsi.toFixed(1),
          dailyBollinger: technicalData.daily.bollingerBands.position,
          hourlyBollinger: technicalData.hourly.bollingerBands.position,
          support: `${dailySR.support.toFixed(2)}`,
          resistance: `${dailySR.resistance.toFixed(2)}`,
          dailyTrend: dailyTrend,
          hourlyTrend: hourlyTrend,
          momentum: momentum
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

  calculateMomentum(prices) {
    if (prices.length < 2) return 'NEUTRAL';
    const recentChange = ((prices[prices.length - 1] - prices[prices.length - 2]) / prices[prices.length - 2]) * 100;
    if (recentChange > 2) return 'STRONG_UP';
    if (recentChange > 0.5) return 'UP';
    if (recentChange < -2) return 'STRONG_DOWN';
    if (recentChange < -0.5) return 'DOWN';
    return 'NEUTRAL';
  }

  async getHistoricalData(coinId, days = 7, interval = 'daily') {
    try {
      const response = await axios.get(
        `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}&interval=${interval}`,
        { 
          timeout: 15000,
          headers: { 'User-Agent': 'TradingBot/1.0' }
        }
      );

      if (response.data && response.data.prices && Array.isArray(response.data.prices)) {
        return response.data.prices.map(([timestamp, price]) => ({
          timestamp: new Date(timestamp),
          price: price
        }));
      }
      throw new Error('Invalid API response structure');
      
    } catch (error) {
      return await this.generateRealisticMockData(coinId);
    }
  }

  async generateRealisticMockData(coinId) {
    try {
      const currentPriceResponse = await axios.get(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`,
        { timeout: 10000 }
      );

      let basePrice = 100;
      if (currentPriceResponse.data && currentPriceResponse.data[coinId]) {
        basePrice = currentPriceResponse.data[coinId].usd;
      }

      const data = [];
      const now = new Date();
      
      for (let i = 6; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        const volatility = 0.02 + (Math.random() * 0.06);
        const change = (Math.random() - 0.5) * 2 * volatility;
        const previousPrice = data.length > 0 ? data[data.length - 1].price : basePrice;
        data.push({
          timestamp: date,
          price: previousPrice * (1 + change)
        });
      }
      return data;
    } catch (mockError) {
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
      data.push({ timestamp: date, price: Math.max(price, 0.0001) });
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

  getStats() {
    return this.stats;
  }

  calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    let gains = 0, losses = 0;
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
      return { upper: currentPrice * 1.1, lower: currentPrice * 0.9, middle: currentPrice };
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
    return { 
      support: Math.min(...recentPrices), 
      resistance: Math.max(...recentPrices) 
    };
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
      return this.parseTechnicalAIResponse(data.choices[0].message.content, technicalData);
    } catch (error) {
      return this.generateTechnicalAnalysis(technicalData);
    }
  }

  createTechnicalAnalysisPrompt(technicalData) {
    return `PROFESSIONAL TECHNICAL ANALYSIS REQUEST:

CRYPTO: ${technicalData.symbol} - ${technicalData.name}
CURRENT PRICE: ${technicalData.currentPrice}

DAILY TIMEFRAME INDICATORS:
- RSI(14): ${technicalData.daily.rsi} ${this.getRSILevel(technicalData.daily.rsi)}
- Bollinger: ${technicalData.daily.bollingerBands.position}
- Support: ${technicalData.daily.supportResistance.support}
- Resistance: ${technicalData.daily.supportResistance.resistance}
- Trend: ${technicalData.daily.trend}

HOURLY TIMEFRAME INDICATORS:
- RSI(14): ${technicalData.hourly.rsi} ${this.getRSILevel(technicalData.hourly.rsi)}
- Bollinger: ${technicalData.hourly.bollingerBands.position}
- Trend: ${technicalData.hourly.trend}

MOMENTUM: ${technicalData.momentum}

Analyze both timeframes and provide JSON:
{
  "action": "BUY|SELL|HOLD",
  "confidence": 0.75,
  "reason": "...",
  "insights": ["...", "...", "..."]
}`;
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
    let action = 'HOLD', confidence = 0.5, reason = '', insights = [];
    
    const dailyRsi = technicalData.daily ? technicalData.daily.rsi : 50;
    const dailyBBPosition = technicalData.daily ? technicalData.daily.bollingerBands.position : 'MIDDLE';
    const dailyTrend = technicalData.daily ? technicalData.daily.trend : 'SIDEWAYS';
    
    const hourlyRsi = technicalData.hourly ? technicalData.hourly.rsi : 50;
    const hourlyTrend = technicalData.hourly ? technicalData.hourly.trend : 'SIDEWAYS';

    if (dailyRsi < 30 && dailyBBPosition === 'LOWER' && dailyTrend === 'BEARISH') {
      action = 'BUY';
      confidence = 0.75;
      reason = 'Daily oversold with Bollinger support and bearish exhaustion';
      insights = ['Strong reversal potential', 'Risk: Trend continuation', 'Stop below support'];
    } else if (dailyRsi > 70 && dailyBBPosition === 'UPPER' && dailyTrend === 'BULLISH') {
      action = 'SELL';
      confidence = 0.75;
      reason = 'Daily overbought at Bollinger resistance';
      insights = ['Profit taking opportunity', 'Risk: Trend continuation', 'Stop above resistance'];
    } else if (dailyRsi < 35 && dailyTrend === 'BULLISH' && hourlyTrend === 'BULLISH') {
      action = 'BUY';
      confidence = 0.70;
      reason = 'Both timeframes bullish with daily oversold';
      insights = ['Trend alignment positive', 'Watch for confirmation', 'Stop below recent low'];
    } else if (hourlyRsi < 30 && hourlyTrend === 'BULLISH') {
      action = 'BUY';
      confidence = 0.65;
      reason = 'Hourly oversold in bullish trend';
      insights = ['Short-term opportunity', 'Confirm with volume', 'Tight stop loss'];
    } else {
      action = 'HOLD';
      confidence = 0.3;
      reason = 'No clear technical setup on either timeframe';
      insights = ['Wait for clearer signals', 'Monitor key levels', 'Low conviction'];
    }

    return { action, confidence, reason, insights, signal: `${action} | Multi-Timeframe Analysis` };
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
      technicals: { 
        dailyRsi: 'N/A', 
        hourlyRsi: 'N/A',
        dailyBollinger: 'N/A',
        hourlyBollinger: 'N/A', 
        support: 'N/A', 
        resistance: 'N/A', 
        dailyTrend: 'N/A',
        hourlyTrend: 'N/A',
        momentum: 'N/A' 
      },
      insights: ['Data fetch failed'],
      timestamp: new Date()
    };
  }

  getScanHistory() {
    return this.analysisHistory.slice(0, 10);
  }
}

const tradingBot = new ProfessionalTradingBot();

// API Routes
app.post('/start-scan', async (req, res) => {
  const result = await tradingBot.startAutoScan();
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

app.post('/test-telegram', async (req, res) => {
  try {
    const result = await tradingBot.sendTestNotification();
    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: `Error: ${error.message}` 
    });
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
    strategy: 'RSI + Bollinger Bands + Support/Resistance + Momentum',
    interval: '1 hour',
    minConfidence: tradingBot.minConfidence,
    stats: tradingBot.getStats(),
    telegramEnabled: TELEGRAM_ENABLED,
    lastUpdate: new Date()
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'professional-scanner-v2',
    strategy: 'Technical Analysis (Enhanced)',
    autoScan: tradingBot.isRunning,
    telegramEnabled: TELEGRAM_ENABLED,
    scanInterval: '1 hour',
    coinsTracked: tradingBot.trackedCoins.length,
    time: new Date() 
  });
});

// Main UI Route with complete HTML
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>🤖 AI Crypto Trading Scanner Pro</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            
            body {
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                color: #1a202c;
            }
            
            .container {
                display: grid;
                grid-template-columns: 1fr 420px;
                gap: 24px;
                max-width: 1920px;
                margin: 0 auto;
                padding: 24px;
            }
            
            .main-content, .sidebar {
                background: rgba(255, 255, 255, 0.97);
                border-radius: 24px;
                padding: 32px;
                box-shadow: 0 24px 48px rgba(0,0,0,0.12);
            }
            
            .header { text-align: center; margin-bottom: 32px; padding-bottom: 24px; border-bottom: 2px solid #e2e8f0; }
            .header h1 {
                color: #1a202c;
                font-size: 2.75em;
                font-weight: 700;
                margin-bottom: 12px;
                background: linear-gradient(135deg, #667eea, #764ba2);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            
            .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 28px; }
            .stat-card { background: linear-gradient(135deg, #f7fafc, #edf2f7); padding: 20px; border-radius: 16px; border: 1px solid #e2e8f0; }
            .stat-label { color: #718096; font-size: 0.85em; font-weight: 600; text-transform: uppercase; margin-bottom: 8px; }
            .stat-value { font-size: 2em; font-weight: 700; background: linear-gradient(135deg, #667eea, #764ba2); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
            
            .controls { background: linear-gradient(135deg, #f7fafc, #edf2f7); padding: 28px; border-radius: 20px; margin-bottom: 28px; }
            .button-group { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; }
            button { padding: 14px 24px; border: none; border-radius: 12px; cursor: pointer; font-weight: 600; font-size: 14px; transition: all 0.3s; display: flex; align-items: center; justify-content: center; gap: 8px; }
            .btn-success { background: linear-gradient(135deg, #10b981, #059669); color: white; }
            .btn-danger { background: linear-gradient(135deg, #ef4444, #dc2626); color: white; }
            .btn-primary { background: linear-gradient(135deg, #667eea, #764ba2); color: white; }
            .btn-secondary { background: linear-gradient(135deg, #64748b, #475569); color: white; }
            .btn-telegram { background: linear-gradient(135deg, #0088cc, #005c8a); color: white; }
            button:hover { transform: translateY(-3px); box-shadow: 0 8px 20px rgba(0,0,0,0.2); }
            
            .status-card { background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 24px; border-radius: 16px; text-align: center; }
            
            .opportunity { background: white; border-radius: 20px; padding: 24px; margin-bottom: 20px; border-left: 6px solid; box-shadow: 0 8px 24px rgba(0,0,0,0.06); transition: all 0.3s; }
            .opportunity:hover { transform: translateY(-4px); box-shadow: 0 16px 40px rgba(0,0,0,0.12); }
            .opportunity.buy { border-left-color: #10b981; background: linear-gradient(135deg, #fff, #f0fdf4); }
            .opportunity.sell { border-left-color: #ef4444; background: linear-gradient(135deg, #fff, #fef2f2); }
            .opportunity.hold { border-left-color: #f59e0b; background: linear-gradient(135deg, #fff, #fffbeb); }
            
            .coin-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
            .coin-name { font-size: 1.4em; font-weight: 700; color: #1a202c; }
            .action-badge { padding: 8px 16px; border-radius: 24px; font-weight: 700; font-size: 0.9em; }
            .buy-badge { background: #10b981; color: white; }
            .sell-badge { background: #ef4444; color: white; }
            .hold-badge { background: #f59e0b; color: white; }
            
            .price-confidence { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 20px 0; padding: 20px; background: rgba(0,0,0,0.02); border-radius: 12px; }
            .price-box .value, .confidence-box .value { font-size: 1.6em; font-weight: 700; color: #1a202c; margin-bottom: 4px; }
            
            .technical-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 20px 0; }
            .technical-item { background: rgba(255,255,255,0.8); padding: 14px; border-radius: 12px; text-align: center; border: 1px solid rgba(0,0,0,0.05); }
            .technical-item strong { display: block; color: #718096; font-size: 0.75em; font-weight: 700; text-transform: uppercase; margin-bottom: 6px; }
            
            .confidence-bar { height: 10px; background: #e2e8f0; border-radius: 12px; margin: 16px 0; overflow: hidden; }
            .confidence-fill { height: 100%; border-radius: 12px; transition: width 0.8s; }
            .high-confidence { background: linear-gradient(90deg, #10b981, #34d399); }
            .medium-confidence { background: linear-gradient(90deg, #f59e0b, #fbbf24); }
            .low-confidence { background: linear-gradient(90deg, #ef4444, #f87171); }
            
            .reason-box { margin: 20px 0; padding: 16px; background: rgba(0,0,0,0.02); border-radius: 12px; border-left: 4px solid #667eea; }
            .insights-list { margin-top: 20px; padding-top: 20px; border-top: 1px solid #e2e8f0; }
            .insights-list ul { list-style: none; padding: 0; }
            .insights-list li { padding: 10px 12px; margin-bottom: 8px; background: rgba(255,255,255,0.6); border-radius: 8px; padding-left: 32px; position: relative; }
            .insights-list li::before { content: '→'; position: absolute; left: 12px; color: #667eea; font-weight: bold; }
            
            .no-opportunities { text-align: center; padding: 80px 20px; color: #718096; }
            .loading-spinner { display: inline-block; width: 20px; height: 20px; border: 3px solid rgba(255,255,255,0.3); border-radius: 50%; border-top-color: white; animation: spin 1s linear infinite; }
            @keyframes spin { to { transform: rotate(360deg); } }
            
            @media (max-width: 1400px) { .container { grid-template-columns: 1fr; } }
            @media (max-width: 768px) { .button-group { grid-template-columns: 1fr; } }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="main-content">
                <div class="header">
                    <h1>🤖 AI Crypto Trading Scanner Pro</h1>
                    <p>Advanced Technical Analysis • Real-Time Market Intelligence • 1-Hour Intervals</p>
                </div>
                
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-label">Total Scans</div>
                        <div class="stat-value" id="totalScans">0</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Opportunities</div>
                        <div class="stat-value" id="totalOpps">0</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Notifications</div>
                        <div class="stat-value" id="notifications">0</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Avg Confidence</div>
                        <div class="stat-value" id="avgConf">0%</div>
                    </div>
                </div>
                
                <div class="controls">
                    <h3>🎯 Scanner Controls</h3>
                    <div class="button-group">
                        <button class="btn-success" onclick="startAutoScan()">🚀 Start Auto-Scan</button>
                        <button class="btn-danger" onclick="stopAutoScan()">🛑 Stop Auto-Scan</button>
                        <button class="btn-primary" onclick="manualScan()">🔍 Scan Now</button>
                        <button class="btn-telegram" onclick="testTelegram()">📱 Test Telegram</button>
                        <button class="btn-secondary" onclick="viewHistory()">📊 View History</button>
                    </div>
                    <div class="status-card">
                        <h4>Scanner Status</h4>
                        <div id="statusText">🟢 Ready to start</div>
                        <div id="nextScan">Next scan: Not scheduled</div>
                        <div id="telegramStatus" style="margin-top: 10px; font-size: 0.9em;">
                            ${TELEGRAM_ENABLED ? '✅ Telegram: ENABLED' : '⚠️ Telegram: DISABLED'}
                        </div>
                    </div>
                </div>
                
                <div>
                    <h3 style="margin-bottom: 24px; color: #1a202c; font-size: 1.5em; font-weight: 700;">📈 Trading Opportunities</h3>
                    <div id="results">
                        <div class="no-opportunities">
                            <h3>🔍 Ready to Scan</h3>
                            <p>Click "Scan Now" to start comprehensive technical analysis</p>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="sidebar">
                <div style="background: linear-gradient(135deg, #1e293b, #0f172a); color: white; border-radius: 20px; padding: 24px;">
                    <h3 style="text-align: center; margin-bottom: 16px;">🧠 DeepSeek AI Analysis</h3>
                    <div id="currentAnalysis" style="min-height: 200px; padding: 20px; background: #1e293b; border-radius: 12px;">
                        <p style="color: #94a3b8; text-align: center;">Waiting for analysis...</p>
                    </div>
                </div>
            </div>
        </div>

        <script>
            let analysisUpdateInterval = null;

            async function testTelegram() {
                try {
                    const response = await fetch('/test-telegram', { method: 'POST' });
                    const result = await response.json();
                    alert(result.message);
                } catch (error) {
                    alert('Error testing Telegram: ' + error.message);
                }
            }

            async function updateStats() {
                try {
                    const response = await fetch('/bot-status');
                    const data = await response.json();
                    if (data.stats) {
                        document.getElementById('totalScans').textContent = data.stats.totalScans || 0;
                        document.getElementById('totalOpps').textContent = data.stats.totalOpportunities || 0;
                        document.getElementById('notifications').textContent = data.stats.notificationsSent || 0;
                        document.getElementById('avgConf').textContent = data.stats.avgConfidence ? (data.stats.avgConfidence * 100).toFixed(0) + '%' : '0%';
                    }
                } catch (error) {
                    console.log('Error updating stats:', error);
                }
            }

            async function updateLiveAnalysis() {
                try {
                    const response = await fetch('/live-analysis');
                    const data = await response.json();
                    const currentDiv = document.getElementById('currentAnalysis');
                    if (data.currentlyAnalyzing) {
                        const analysis = data.currentlyAnalyzing;
                        currentDiv.innerHTML = \`<div style="color: #60a5fa; font-weight: 600; margin-bottom: 12px;">\${analysis.stage}</div>
                            <div style="color: #e2e8f0;"><strong>\${analysis.symbol}</strong> - \${analysis.name}</div>\`;
                    } else {
                        currentDiv.innerHTML = '<p style="color: #94a3b8; text-align: center;">No active analysis</p>';
                    }
                } catch (error) {
                    console.log('Error updating live analysis:', error);
                }
            }

            async function startAutoScan() {
                try {
                    const response = await fetch('/start-scan', { method: 'POST' });
                    const result = await response.json();
                    if (result.status === 'already_running') {
                        alert('Auto-scan is already running!');
                        return;
                    }
                    document.getElementById('statusText').innerHTML = '🔄 Auto-Scanning Active';
                    document.getElementById('nextScan').textContent = 'Next scan: Every 1 hour';
                    if (analysisUpdateInterval) clearInterval(analysisUpdateInterval);
                    analysisUpdateInterval = setInterval(updateLiveAnalysis, 2000);
                    manualScan();
                } catch (error) {
                    alert('Error starting auto-scan: ' + error.message);
                }
            }

            async function stopAutoScan() {
                try {
                    await fetch('/stop-scan', { method: 'POST' });
                    document.getElementById('statusText').innerHTML = '🛑 Stopped';
                    document.getElementById('nextScan').textContent = 'Next scan: Manual mode';
                    if (analysisUpdateInterval) clearInterval(analysisUpdateInterval);
                } catch (error) {
                    alert('Error stopping auto-scan: ' + error.message);
                }
            }

            async function manualScan() {
                try {
                    document.getElementById('results').innerHTML = '<div class="no-opportunities"><div class="loading-spinner" style="width: 40px; height: 40px; margin: 0 auto 20px;"></div><h3>🔍 Scanning...</h3></div>';
                    if (analysisUpdateInterval) clearInterval(analysisUpdateInterval);
                    analysisUpdateInterval = setInterval(updateLiveAnalysis, 2000);
                    updateLiveAnalysis();
                    
                    const response = await fetch('/scan-now');
                    const data = await response.json();
                    updateStats();
                    
                    if (data.opportunities.length === 0) {
                        document.getElementById('results').innerHTML = \`<div class="no-opportunities"><h3>📭 No High-Confidence Opportunities</h3><p>Scanned \${data.analyzedCoins} coins</p></div>\`;
                        return;
                    }
                    
                    let html = '';
                    data.opportunities.forEach(opp => {
                        const actionClass = opp.action.toLowerCase();
                        const confidencePercent = (opp.confidence * 100).toFixed(0);
                        const confidenceLevel = confidencePercent >= 75 ? 'high-confidence' : confidencePercent >= 60 ? 'medium-confidence' : 'low-confidence';
                        
                        html += \`<div class="opportunity \${actionClass}">
                            <div class="coin-header">
                                <div class="coin-name">\${opp.name} (\${opp.symbol})</div>
                                <div class="\${actionClass}-badge action-badge">\${opp.action}</div>
                            </div>
                            <div class="price-confidence">
                                <div class="price-box"><div class="value">\${opp.price}</div><div>Current Price</div></div>
                                <div class="confidence-box"><div class="value">\${confidencePercent}%</div><div>Confidence</div></div>
                            </div>
                            <div class="confidence-bar"><div class="confidence-fill \${confidenceLevel}" style="width: \${confidencePercent}%"></div></div>
                            <div class="reason-box"><p>\${opp.reason}</p></div>
                            <div class="technical-grid">
                                <div class="technical-item"><strong>RSI</strong><div>\${opp.technicals.rsi}</div></div>
                                <div class="technical-item"><strong>Bollinger</strong><div>\${opp.technicals.bollingerPosition}</div></div>
                                <div class="technical-item"><strong>Trend</strong><div>\${opp.technicals.trend}</div></div>
                            </div>
                            <div class="insights-list"><h4>💡 Key Insights</h4><ul>\${opp.insights.map(i => \`<li>\${i}</li>\`).join('')}</ul></div>
                        </div>\`;
                    });
                    
                    document.getElementById('results').innerHTML = html;
                } catch (error) {
                    console.error('Scan error:', error);
                    document.getElementById('results').innerHTML = '<div class="no-opportunities" style="color: #ef4444;"><h3>❌ Scan Failed</h3><p>Please try again</p></div>';
                }
            }

            async function viewHistory() {
                try {
                    const response = await fetch('/scan-history');
                    const history = await response.json();
                    if (history.length === 0) {
                        alert('No scan history available yet.');
                        return;
                    }
                    const historyText = history.slice(0, 5).map((scan, index) => 
                        \`Scan #\${index + 1}: \${new Date(scan.timestamp).toLocaleString()}\\n   - Opportunities: \${scan.opportunities}\`
                    ).join('\\n\\n');
                    alert('Recent Scan History:\\n\\n' + historyText);
                } catch (error) {
                    alert('Error loading history: ' + error.message);
                }
            }

            updateStats();
            manualScan();
        </script>
    </body>
    </html>
  `);
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎯 Professional Crypto Scanner V2 running on port ${PORT}`);
  console.log(`📊 Strategy: RSI + Bollinger + Support/Resistance + Momentum`);
  console.log(`⏰ Auto-scan: 1 HOUR intervals`);
  console.log(`🎯 Coins: 100 cryptocurrencies`);
  console.log(`📱 Telegram: ${TELEGRAM_ENABLED ? 'ENABLED ✅' : 'DISABLED ⚠️'}`);
  console.log(`🔔 Test Telegram: POST /test-telegram`);
});

module.exports = app;
