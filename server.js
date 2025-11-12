const express = require('express');
const axios = require('axios');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const TechnicalIndicators = require('technicalindicators');

const app = express();
const PORT = process.env.PORT || 10000;
app.use(express.json());
app.use(helmet());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 })); // Basic rate limiting

// Telegram Configuration
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const TELEGRAM_ENABLED = TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID;

// Configurable settings from env
const MIN_CONFIDENCE = parseFloat(process.env.MIN_CONFIDENCE) || 0.65;
const SCAN_INTERVAL_MS = parseInt(process.env.SCAN_INTERVAL_MS) || 60 * 60 * 1000; // 1 hour default
const COIN_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Enhanced Professional Trading Bot
class ProfessionalTradingBot {
  constructor() {
    this.isRunning = false;
    this.scanInterval = null;
    this.trackedCoins = [];
    this.minConfidence = MIN_CONFIDENCE;
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
    this.coinListLastUpdated = 0;
  }

  async getTop100Coins() {
    if (Date.now() - this.coinListLastUpdated < COIN_REFRESH_INTERVAL_MS && this.trackedCoins.length > 0) {
      console.log('Using cached top coins');
      return this.trackedCoins;
    }

    const url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1';
    try {
      const response = await axios.get(url, { timeout: 10000 });
      const coins = response.data.map(coin => ({
        symbol: coin.symbol.toUpperCase(),
        name: coin.name,
        id: coin.id
      }));
      this.trackedCoins = coins;
      this.coinListLastUpdated = Date.now();
      console.log(`Fetched ${coins.length} top coins`);
      return coins;
    } catch (error) {
      console.error('Error fetching top coins:', error.message);
      console.log('Using fallback hardcoded coins');
      return this.getFallbackCoins();
    }
  }

  getFallbackCoins() {
    return [
      { symbol: 'BTC', name: 'Bitcoin', id: 'bitcoin' },
      { symbol: 'ETH', name: 'Ethereum', id: 'ethereum' },
      { symbol: 'USDT', name: 'Tether', id: 'tether' },
      { symbol: 'XRP', name: 'XRP', id: 'xrp' },
      { symbol: 'BNB', name: 'BNB', id: 'bnb' },
      { symbol: 'SOL', name: 'Solana', id: 'solana' },
      { symbol: 'USDC', name: 'USDC', id: 'usdc' },
      { symbol: 'STETH', name: 'Lido Staked Ether', id: 'lido-staked-ether' },
      { symbol: 'TRX', name: 'TRON', id: 'tron' },
      { symbol: 'DOGE', name: 'Dogecoin', id: 'dogecoin' },
      { symbol: 'ADA', name: 'Cardano', id: 'cardano' },
      { symbol: 'FIGR_HELOC', name: 'Figure Heloc', id: 'figure-heloc' },
      { symbol: 'WSTETH', name: 'Wrapped stETH', id: 'wrapped-steth' },
      { symbol: 'WBTC', name: 'Wrapped Bitcoin', id: 'wrapped-bitcoin' },
      { symbol: 'WBETH', name: 'Wrapped Beacon ETH', id: 'wrapped-beacon-eth' },
      { symbol: 'WBT', name: 'WhiteBIT Coin', id: 'whitebit' },
      { symbol: 'HYPE', name: 'Hyperliquid', id: 'hyperliquid' },
      { symbol: 'LINK', name: 'Chainlink', id: 'chainlink' },
      { symbol: 'BCH', name: 'Bitcoin Cash', id: 'bitcoin-cash' },
      { symbol: 'USDS', name: 'USDS', id: 'usds' },
      { symbol: 'XLM', name: 'Stellar', id: 'stellar' },
      { symbol: 'BSC-USD', name: 'Binance Bridged USDT (BNB Smart Chain)', id: 'binance-bridged-usdt-bnb-smart-chain' },
      { symbol: 'WEETH', name: 'Wrapped eETH', id: 'wrapped-eeth' },
      { symbol: 'LEO', name: 'LEO Token', id: 'leo-token' },
      { symbol: 'USDE', name: 'Ethena USDe', id: 'ethena-usde' },
      { symbol: 'WETH', name: 'WETH', id: 'weth' },
      { symbol: 'LTC', name: 'Litecoin', id: 'litecoin' },
      { symbol: 'HBAR', name: 'Hedera', id: 'hedera' },
      { symbol: 'ZEC', name: 'Zcash', id: 'zcash' },
      { symbol: 'CBBTC', name: 'Coinbase Wrapped BTC', id: 'coinbase-wrapped-btc' },
      { symbol: 'SUI', name: 'Sui', id: 'sui' },
      { symbol: 'AVAX', name: 'Avalanche', id: 'avalanche' },
      { symbol: 'XMR', name: 'Monero', id: 'monero' },
      { symbol: 'SHIB', name: 'Shiba Inu', id: 'shiba-inu' },
      { symbol: 'UNI', name: 'Uniswap', id: 'uniswap' },
      { symbol: 'TON', name: 'Toncoin', id: 'toncoin' },
      { symbol: 'DOT', name: 'Polkadot', id: 'polkadot' },
      { symbol: 'CC', name: 'Canton', id: 'canton' },
      { symbol: 'CRO', name: 'Cronos', id: 'cronos' },
      { symbol: 'SUSDE', name: 'Ethena Staked USDe', id: 'ethena-staked-usde' },
      { symbol: 'DAI', name: 'Dai', id: 'dai' },
      { symbol: 'WLFI', name: 'World Liberty Financial', id: 'world-liberty-financial' },
      { symbol: 'MNT', name: 'Mantle', id: 'mantle' },
      { symbol: 'M', name: 'MemeCore', id: 'memecore' },
      { symbol: 'USDT0', name: 'USDT0', id: 'usdt0' },
      { symbol: 'SUSDS', name: 'sUSDS', id: 'susds' },
      { symbol: 'TAO', name: 'Bittensor', id: 'bittensor' },
      { symbol: 'ICP', name: 'Internet Computer', id: 'internet-computer' },
      { symbol: 'NEAR', name: 'NEAR Protocol', id: 'near' },
      { symbol: 'AAVE', name: 'Aave', id: 'aave' },
      { symbol: 'PYUSD', name: 'PayPal USD', id: 'paypal-usd' },
      { symbol: 'BGB', name: 'Bitget Token', id: 'bitget-token' },
      { symbol: 'USD1', name: 'USD1', id: 'usd1-wlfi' },
      { symbol: 'OKB', name: 'OKB', id: 'okb' },
      { symbol: 'C1USD', name: 'Currency One USD', id: 'c1usd' },
      { symbol: 'BUIDL', name: 'BlackRock USD Institutional Digital Liquidity Fund', id: 'blackrock-usd-institutional-digital-liquidity-fund' },
      { symbol: 'PUMP', name: 'Pump.fun', id: 'pump-fun' },
      { symbol: 'PEPE', name: 'Pepe', id: 'pepe' },
      { symbol: 'ETC', name: 'Ethereum Classic', id: 'ethereum-classic' },
      { symbol: 'ENA', name: 'Ethena', id: 'ethena' },
      { symbol: 'ASTER', name: 'Aster', id: 'aster-2' },
      { symbol: 'JITOSOL', name: 'Jito Staked SOL', id: 'jito-staked-sol' },
      { symbol: 'APT', name: 'Aptos', id: 'aptos' },
      { symbol: 'XAUT', name: 'Tether Gold', id: 'tether-gold' },
      { symbol: 'USDF', name: 'Falcon USD', id: 'falcon-usd' },
      { symbol: 'WETH', name: 'Binance-Peg WETH', id: 'binance-peg-weth' },
      { symbol: 'ONDO', name: 'Ondo', id: 'ondo' },
      { symbol: 'JLP', name: 'Jupiter Perpetuals Liquidity Provider Token', id: 'jupiter-perpetuals-liquidity-provider-token' },
      { symbol: 'SOL', name: 'Wrapped SOL', id: 'wrapped-sol-2' },
      { symbol: 'PI', name: 'Pi Network', id: 'pi-network' },
      { symbol: 'USDTB', name: 'USDtb', id: 'usdtb' },
      { symbol: 'POL', name: 'POL (ex-MATIC)', id: 'polygon' },
      { symbol: 'WLD', name: 'Worldcoin', id: 'worldcoin' },
      { symbol: 'HTX', name: 'HTX DAO', id: 'htx-dao' },
      { symbol: 'KCS', name: 'KuCoin', id: 'kucoin-shares' },
      { symbol: 'FIL', name: 'Filecoin', id: 'filecoin' },
      { symbol: 'HASH', name: 'Provenance Blockchain', id: 'hash-2' },
      { symbol: 'ALGO', name: 'Algorand', id: 'algorand' },
      { symbol: 'TRUMP', name: 'Official Trump', id: 'official-trump' },
      { symbol: 'ARB', name: 'Arbitrum', id: 'arbitrum' },
      { symbol: 'RETH', name: 'Rocket Pool ETH', id: 'rocket-pool-eth' },
      { symbol: 'VET', name: 'VeChain', id: 'vechain' },
      { symbol: 'BNSOL', name: 'Binance Staked SOL', id: 'binance-staked-sol' },
      { symbol: 'ATOM', name: 'Cosmos Hub', id: 'cosmos-hub' },
      { symbol: 'GT', name: 'Gate', id: 'gatetoken' },
      { symbol: 'PAXG', name: 'PAX Gold', id: 'pax-gold' },
      { symbol: 'KHYPE', name: 'Kinetiq Staked HYPE', id: 'kinetiq-staked-hype' },
      { symbol: 'BFUSD', name: 'BFUSD', id: 'bfusd' },
      { symbol: 'KAS', name: 'Kaspa', id: 'kaspa' },
      { symbol: 'USDC', name: 'Binance Bridged USDC (BNB Smart Chain)', id: 'binance-bridged-usdc-bnb-smart-chain' },
      { symbol: 'SYRUPUSDT', name: 'syrupUSDT', id: 'syrupusdt' },
      { symbol: 'WBNB', name: 'Wrapped BNB', id: 'wbnb' },
      { symbol: 'SKY', name: 'Sky', id: 'sky' },
      { symbol: 'RSETH', name: 'Kelp DAO Restaked ETH', id: 'kelp-dao-restaked-eth' },
      { symbol: 'RENDER', name: 'Render', id: 'render' },
      { symbol: 'FBTC', name: 'Function FBTC', id: 'function-fbtc' },
      { symbol: 'FLR', name: 'Flare', id: 'flare' },
      { symbol: 'SYRUPUSDC', name: 'syrupUSDC', id: 'syrup-usdc' },
      { symbol: 'LBTC', name: 'Lombard Staked BTC', id: 'lombard-staked-btc' },
      { symbol: 'QNT', name: 'Quant', id: 'quant' }
    ];
  }

  async startAutoScan() {
    if (this.isRunning) {
      console.log('🔄 Auto-scan already running');
      return { status: 'already_running' };
    }
    this.isRunning = true;
    console.log('🚀 Starting automated technical analysis scan');
    if (this.trackedCoins.length === 0) {
      this.trackedCoins = await this.getTop100Coins();
    }
    await this.performTechnicalScan();
    this.scanInterval = setInterval(async () => {
      console.log('🔄 Scheduled scan triggered');
      await this.performTechnicalScan();
    }, SCAN_INTERVAL_MS);
    return {
      status: 'started',
      interval: SCAN_INTERVAL_MS / (60 * 60 * 1000) + ' hours',
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
    // Rate limiting: Don't send notifications for same coin within 30 minutes
    const coinKey = opportunity.symbol;
    const now = Date.now();
    const cooldown = 30 * 60 * 1000; // 30 minutes
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
          this.currentlyAnalyzing = { stage: 'Analyzing technicals', symbol: coin.symbol, name: coin.name };
          const analysis = await this.analyzeWithTechnicalIndicators(coin);
          analyzedCount++;
          this.currentlyAnalyzing = null;
         
          if (analysis.confidence >= this.minConfidence) {
            opportunities.push(analysis);
            console.log(`✅ ${coin.symbol}: ${analysis.action} (${(analysis.confidence * 100).toFixed(0)}% confidence)`);
          }
          await new Promise(resolve => setTimeout(resolve, 800));
         
        } catch (error) {
          console.log(`❌ ${coin.symbol}: Analysis failed - ${error.message}`);
          this.currentlyAnalyzing = null;
        }
      }
      opportunities.sort((a, b) => b.confidence - a.confidence);
      this.stats.totalScans++;
      this.stats.totalOpportunities += opportunities.length;
      this.stats.lastScanDuration = Date.now() - startTime;
      if (opportunities.length > 0) {
        this.stats.avgConfidence = opportunities.reduce((sum, o) => sum + o.confidence, 0) / opportunities.length;
      }
      // Send Telegram notifications for high-confidence opportunities
      if (TELEGRAM_ENABLED && opportunities.length > 0) {
        console.log(`📱 Sending Telegram notifications for ${opportunities.length} opportunities...`);
        for (const opp of opportunities) {
          await this.sendTelegramNotification(opp);
          await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay between notifications
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
        nextScan: new Date(Date.now() + SCAN_INTERVAL_MS),
        duration: this.stats.lastScanDuration
      };
    } catch (error) {
      console.log('❌ Technical scan failed:', error.message);
      this.currentlyAnalyzing = null;
      return {
        scanTime: new Date(),
        error: error.message,
        opportunities: []
      };
    }
  }

  async analyzeWithTechnicalIndicators(coin) {
    try {
      // Fetch historical data: last 30 days for calculations (need at least 26 for EMA, etc.)
      const url = `https://api.coingecko.com/api/v3/coins/${coin.id}/market_chart?vs_currency=usd&days=30&interval=daily`;
      const response = await axios.get(url, { timeout: 10000 });
      const prices = response.data.prices.map(p => p[1]); // [timestamp, price]
      if (prices.length < 30) throw new Error('Insufficient historical data');

      const closingPrices = prices.slice(-30); // Last 30 days
      const currentPrice = closingPrices[closingPrices.length - 1];

      // Calculate RSI (14 period)
      const rsiInput = { values: closingPrices.slice(-15), period: 14 }; // Last 15 for RSI14
      const rsi = TechnicalIndicators.RSI.calculate(rsiInput)[0];

      // Calculate Bollinger Bands (20 period, 2 std)
      const bbInput = { values: closingPrices.slice(-20), period: 20, stdDev: 2 };
      const bb = TechnicalIndicators.BollingerBands.calculate(bbInput)[0];
      let bollingerPosition;
      if (currentPrice > bb.upper) bollingerPosition = 'UPPER';
      else if (currentPrice < bb.lower) bollingerPosition = 'LOWER';
      else bollingerPosition = 'MIDDLE';

      // Calculate MACD for momentum (12,26,9)
      const macdInput = { values: closingPrices, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false };
      const macd = TechnicalIndicators.MACD.calculate(macdInput);
      const lastMacd = macd[macd.length - 1];
      const momentum = lastMacd.MACD;

      // Simple trend: EMA12 vs EMA26
      const ema12 = TechnicalIndicators.EMA.calculate({ period: 12, values: closingPrices })[closingPrices.length - 1 - 12 + 1];
      const ema26 = TechnicalIndicators.EMA.calculate({ period: 26, values: closingPrices })[closingPrices.length - 1 - 26 + 1];
      const trend = ema12 > ema26 ? 'BULLISH' : 'BEARISH';

      // Support/Resistance: simple min/max over last 30 days
      const support = Math.min(...closingPrices).toFixed(2);
      const resistance = Math.max(...closingPrices).toFixed(2);

      // Insights and scoring
      const insights = [];
      let score = 0;

      if (rsi < 30) {
        insights.push('Oversold (RSI < 30) - Potential buy signal');
        score += 1;
      } else if (rsi > 70) {
        insights.push('Overbought (RSI > 70) - Potential sell signal');
        score -= 1;
      }

      if (bollingerPosition === 'LOWER') {
        insights.push('Below lower Bollinger Band - Potential buy');
        score += 1;
      } else if (bollingerPosition === 'UPPER') {
        insights.push('Above upper Bollinger Band - Potential sell');
        score -= 1;
      }

      if (trend === 'BULLISH') {
        insights.push('Bullish trend (EMA12 > EMA26)');
        score += 1;
      } else {
        insights.push('Bearish trend (EMA12 < EMA26)');
        score -= 1;
      }

      if (lastMacd.histogram > 0) {
        insights.push('Positive MACD histogram - Increasing momentum');
        score += 1;
      } else {
        insights.push('Negative MACD histogram - Decreasing momentum');
        score -= 1;
      }

      // Action and confidence
      let action = 'HOLD';
      if (score > 2) action = 'BUY';
      else if (score < -2) action = 'SELL';
      const confidence = Math.min(1, Math.max(0, (Math.abs(score) / 4) * this.minConfidence + 0.3)); // Normalized 0.3-1

      const reason = `${action} recommended based on ${insights.length} indicators. Score: ${score}`;

      return {
        symbol: coin.symbol,
        name: coin.name,
        price: `$${currentPrice.toFixed(2)}`,
        action,
        confidence,
        reason,
        insights,
        technicals: {
          rsi: rsi.toFixed(2),
          bollingerPosition,
          trend,
          momentum: momentum.toFixed(4),
          support: `$${support}`,
          resistance: `$${resistance}`
        },
        timestamp: new Date()
      };
    } catch (error) {
      throw new Error(`Analysis error for ${coin.symbol}: ${error.message}`);
    }
  }

  getLiveAnalysis() {
    return {
      currentlyAnalyzing: this.currentlyAnalyzing,
      liveAnalysis: this.liveAnalysis // If you want to track more, push to this array
    };
  }

  getScanHistory() {
    return this.analysisHistory;
  }

  getStats() {
    return this.stats;
  }
}

const tradingBot = new ProfessionalTradingBot();

// Test Telegram Notification Endpoint
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
    interval: SCAN_INTERVAL_MS / (60 * 60 * 1000) + ' hours',
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
    scanInterval: SCAN_INTERVAL_MS / (60 * 60 * 1000) + ' hours',
    coinsTracked: tradingBot.trackedCoins.length,
    time: new Date()
  });
});

// Main UI Route with Test Telegram Button
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
            .button-group { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; } /* ✅ Updated to 3 columns */
            button { padding: 14px 24px; border: none; border-radius: 12px; cursor: pointer; font-weight: 600; font-size: 14px; transition: all 0.3s; display: flex; align-items: center; justify-content: center; gap: 8px; }
            .btn-success { background: linear-gradient(135deg, #10b981, #059669); color: white; }
            .btn-danger { background: linear-gradient(135deg, #ef4444, #dc2626); color: white; }
            .btn-primary { background: linear-gradient(135deg, #667eea, #764ba2); color: white; }
            .btn-secondary { background: linear-gradient(135deg, #64748b, #475569); color: white; }
            .btn-telegram { background: linear-gradient(135deg, #0088cc, #005c8a); color: white; } /* ✅ New Telegram button style */
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
                    <p>Advanced Technical Analysis • Real-Time Market Intelligence • Configurable Intervals</p>
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
                    document.getElementById('nextScan').textContent = \`Next scan: Every \${result.interval}\`;
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
                        \`Scan #\${index + 1}: \${new Date(scan.timestamp).toLocaleString()}\\n - Opportunities: \${scan.opportunities}\`
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
  console.log(`⏰ Auto-scan: ${SCAN_INTERVAL_MS / (60 * 60 * 1000)} hour intervals`);
  console.log(`🎯 Coins: Dynamic top 100 (fallback to ${tradingBot.getFallbackCoins().length})`);
  console.log(`📱 Telegram: ${TELEGRAM_ENABLED ? 'ENABLED ✅' : 'DISABLED ⚠️'}`);
  console.log(`🔔 Test Telegram: POST /test-telegram ✅`);
});
module.exports = app;
