/* eslint-disable no-console */
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

// Ensure fetch exists (Node 18+/polyfill)
let fetchFn = global.fetch;
if (!fetchFn) {
  fetchFn = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
}
const fetch = fetchFn;

// Telegram configuration
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const TELEGRAM_ENABLED = Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID);

// News configuration (CryptoPanic)
const CRYPTOPANIC_API_KEY = process.env.CRYPTOPANIC_API_KEY || '';
const NEWS_ENABLED = Boolean(CRYPTOPANIC_API_KEY);

// Rate limiting helpers
const COINGECKO_DELAY = Number(process.env.CG_DELAY_MS || 1000); // ms between calls
const SCAN_INTERVAL_OPTIONS = {
  '10m': 10 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '1w': 7 * 24 * 60 * 60 * 1000,
};
const NOTIFICATION_COOLDOWN_MS = 30 * 60 * 1000; // 30 min

// Simple sleep util
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Enhanced Professional Trading Bot
class ProfessionalTradingBot {
  constructor() {
    this.isRunning = false;
    this.scanTimer = null;
    this.scanInProgress = false;

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
      notificationsSent: 0,
      lastSuccessfulScan: null,
      mockDataUsage: 0,
      apiErrors: 0,
      skippedDueToOverlap: 0,
    };

    this.lastNotificationTime = {};
    this.selectedIntervalKey = '1h';
    this.scanIntervalMs = SCAN_INTERVAL_OPTIONS[this.selectedIntervalKey];
    this.scanProgress = {
      running: false,
      processed: 0,
      total: this.trackedCoins.length,
      percent: 0,
    };
    this.greedFearIndex = {
      value: null,
      classification: null,
      timestamp: null,
    };
    this.latestHeatmap = [];
    this.newsCache = new Map();
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
      { symbol: 'DENT', name: 'Dent', id: 'dent' },
    ];
  }

  setAutoScanInterval(key) {
    if (!SCAN_INTERVAL_OPTIONS[key]) {
      throw new Error(`Unsupported interval: ${key}`);
    }
    this.selectedIntervalKey = key;
    this.scanIntervalMs = SCAN_INTERVAL_OPTIONS[key];
    if (this.isRunning) {
      if (this.scanTimer) {
        clearTimeout(this.scanTimer);
        this.scanTimer = null;
      }
      this.scheduleNextScan();
    }
  }

  getScanProgress() {
    return { ...this.scanProgress, interval: this.selectedIntervalKey };
  }

  async ensureGreedFearIndex() {
    const now = Date.now();
    if (this.greedFearIndex.timestamp && now - this.greedFearIndex.timestamp < 15 * 60 * 1000) {
      return this.greedFearIndex;
    }
    try {
      const response = await axios.get('https://api.alternative.me/fng/', {
        params: { limit: 1, format: 'json' },
        timeout: 10000,
      });
      if (response.data && Array.isArray(response.data.data) && response.data.data.length > 0) {
        const entry = response.data.data[0];
        this.greedFearIndex = {
          value: Number(entry.value),
          classification: entry.value_classification,
          timestamp: new Date(Number(entry.timestamp) * 1000),
        };
      }
    } catch (error) {
      console.log('⚠️ Failed to fetch fear & greed index:', error.message);
    }
    return this.greedFearIndex;
  }

  computeFrameScore(frameData) {
    if (!frameData) return 0;
    let score = 0;
    const rsi = Number(frameData.rsi);
    if (!Number.isNaN(rsi)) {
      if (rsi < 30) score += 1.5;
      else if (rsi < 45) score += 0.5;
      else if (rsi > 70) score -= 1.5;
      else if (rsi > 55) score -= 0.5;
    }
    if (frameData.trend === 'BULLISH') score += 1;
    else if (frameData.trend === 'BEARISH') score -= 1;
    if (frameData.momentum === 'STRONG_UP') score += 1;
    else if (frameData.momentum === 'UP') score += 0.5;
    else if (frameData.momentum === 'STRONG_DOWN') score -= 1;
    else if (frameData.momentum === 'DOWN') score -= 0.5;
    return score;
  }

  buildHeatmapEntry(coin, frames) {
    const frameSummaries = {};
    let totalScore = 0;
    let counted = 0;
    Object.entries(frames).forEach(([key, data]) => {
      const frameData = {
        rsi: data.rsi,
        trend: data.trend,
        momentum: data.momentum,
        bollinger: data.bollingerPosition,
        score: this.computeFrameScore(data),
      };
      frameSummaries[key] = frameData;
      if (frameData.score !== 0) {
        totalScore += frameData.score;
        counted += 1;
      }
    });
    return {
      symbol: coin.symbol,
      name: coin.name,
      frames: frameSummaries,
      overallScore: counted ? (totalScore / counted) : 0,
    };
  }

  aggregateSeries(data = [], chunkSize = 1, maxPoints = 120) {
    if (!Array.isArray(data) || data.length === 0) return [];
    const cleaned = data
      .filter((item) => item && typeof item.price === 'number' && Number.isFinite(item.price))
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    if (chunkSize <= 1) {
      return cleaned.slice(-maxPoints);
    }
    const aggregated = [];
    for (let i = chunkSize - 1; i < cleaned.length; i += chunkSize) {
      const slice = cleaned.slice(i - chunkSize + 1, i + 1);
      const avg =
        slice.reduce((sum, point) => sum + point.price, 0) / slice.length;
      aggregated.push({
        timestamp: cleaned[i].timestamp,
        price: avg,
      });
    }
    return aggregated.slice(-maxPoints);
  }

  prepareTimeframeSeries(minuteData, hourlyData, dailyData) {
    return {
      '10m': this.aggregateSeries(minuteData, 10, 120),
      '1h': this.aggregateSeries(hourlyData, 1, 168),
      '4h': this.aggregateSeries(hourlyData, 4, 84),
      '1d': this.aggregateSeries(dailyData, 1, 90),
      '1w': this.aggregateSeries(dailyData, 7, 52),
    };
  }

  async fetchCoinNews(symbol, name) {
    if (!NEWS_ENABLED) return [];
    const cacheKey = `${symbol}`.toUpperCase();
    const cached = this.newsCache.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.timestamp < 15 * 60 * 1000) {
      return cached.items;
    }
    try {
      const response = await axios.get('https://cryptopanic.com/api/v1/posts/', {
        params: {
          auth_token: CRYPTOPANIC_API_KEY,
          public: true,
          currencies: symbol ? symbol.toUpperCase() : undefined,
        },
        timeout: 10000,
      });
      if (response.data && Array.isArray(response.data.results)) {
        const items = response.data.results
          .filter((article) => article.title && article.url)
          .slice(0, 3)
          .map((article) => ({
            title: article.title,
            description: article.summary || article.body || '',
            url: article.url,
            publishedAt: article.published_at || article.created_at,
            source: article.source?.title || article.source?.domain || 'CryptoPanic',
          }));
        this.newsCache.set(cacheKey, { items, timestamp: now });
        return items;
      }
    } catch (error) {
      console.log(`⚠️ News fetch failed for ${symbol}:`, error.message);
    }
    return [];
  }

  scheduleNextScan() {
      if (!this.isRunning) return;
    const delay = Math.max(this.scanIntervalMs - this.stats.lastScanDuration, 5000);
      this.scanTimer = setTimeout(async () => {
        if (this.scanInProgress) {
          console.log('⏳ Previous scan still running, skipping scheduled scan');
          this.stats.skippedDueToOverlap += 1;
        this.scheduleNextScan();
          return;
        }
        await this.performTechnicalScan();
      this.scheduleNextScan();
      }, delay);
  }

  async startAutoScan() {
    if (this.isRunning) {
      console.log('🔄 Auto-scan already running');
      return { status: 'already_running' };
    }

    this.isRunning = true;
    console.log('🚀 Starting automated technical analysis scan');

    await this.performTechnicalScan();
    this.scheduleNextScan();

    return {
      status: 'started',
      interval: this.selectedIntervalKey,
      coins: this.trackedCoins.length,
      time: new Date(),
    };
  }

  stopAutoScan() {
    this.isRunning = false;
    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
    console.log('🛑 Auto-scan stopped');
    return { status: 'stopped', time: new Date() };
  }

  async sendTelegramNotification(opportunity, options = {}) {
    const { force = false } = options;
    if (!TELEGRAM_ENABLED) {
      console.log('⚠️ Telegram notifications disabled (missing credentials)');
      return false;
    }

    const coinKey = opportunity.symbol;
    const now = Date.now();

    if (
      !force &&
      this.lastNotificationTime[coinKey] &&
      now - this.lastNotificationTime[coinKey] < NOTIFICATION_COOLDOWN_MS
    ) {
      console.log(`⏳ Skipping notification for ${coinKey} (cooldown active)`);
      return false;
    }

    try {
      const actionEmoji =
        opportunity.action === 'BUY'
          ? '🟢'
          : opportunity.action === 'SELL'
            ? '🔴'
            : '🟡';
      const confidencePercent = (opportunity.confidence * 100).toFixed(0);

      const indicators = opportunity.indicators;
      const frames = indicators.frames || {};
      const frame10m = frames['10m'] || {};
      const frame4h = frames['4h'] || {};
      const frame1w = frames['1w'] || {};
      const sentiment =
        this.greedFearIndex && this.greedFearIndex.value != null
          ? `${this.greedFearIndex.value} (${this.greedFearIndex.classification})`
          : 'N/A';

      const message = `${actionEmoji} *${opportunity.action} SIGNAL DETECTED*

*Coin:* ${opportunity.name} (${opportunity.symbol})
*Price:* ${opportunity.price}
*Confidence:* ${confidencePercent}%
*Market Sentiment:* ${sentiment}

📊 *Technical Snapshot:*
• Daily RSI: ${indicators.daily.rsi}
• Hourly RSI: ${indicators.hourly.rsi}
• 10m RSI: ${frame10m.rsi || 'N/A'}
• Daily Bollinger: ${indicators.daily.bollingerPosition}
• Hourly Bollinger: ${indicators.hourly.bollingerPosition}
• 4H Bollinger: ${frame4h.bollingerPosition || 'N/A'}
• Daily Trend: ${indicators.daily.trend}
• Hourly Trend: ${indicators.hourly.trend}
• 4H Trend: ${frame4h.trend || 'N/A'}
• Weekly Trend: ${frame1w.trend || 'N/A'}
• Momentum (10m): ${frame10m.momentum || indicators.momentum}

💡 *Key Insights:*
${opportunity.insights.map((insight) => `→ ${insight}`).join('\n')}

📝 *Reason:* ${opportunity.reason}

⏰ Detected: ${new Date(opportunity.timestamp).toLocaleString()}`;

      const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

      const response = await axios.post(
        telegramUrl,
        {
          chat_id: TELEGRAM_CHAT_ID,
          text: message,
          parse_mode: 'Markdown',
        },
        {
          timeout: 10000,
        },
      );

      if (response.data.ok) {
        console.log(`✅ Telegram notification sent for ${opportunity.symbol}`);
        this.lastNotificationTime[coinKey] = now;
        this.stats.notificationsSent += 1;
        return true;
      }

      console.log(`❌ Telegram API error: ${response.data.description}`);
      return false;
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
        reason: 'This is a test notification to verify Telegram integration is working correctly.',
        insights: [
          '✅ Telegram integration test successful',
          '✅ Bot is properly configured',
          '✅ Notifications will be sent for trading opportunities',
        ],
        timestamp: new Date(),
        indicators: {
          momentum: 'UP',
          daily: {
            rsi: '45.2',
            bollingerPosition: 'MIDDLE',
            trend: 'BULLISH',
            support: '$1,200.00',
            resistance: '$1,300.00',
          },
          hourly: {
            rsi: '50.1',
            bollingerPosition: 'MIDDLE',
            trend: 'BULLISH',
          },
        },
      };

      const success = await this.sendTelegramNotification(testOpportunity, { force: true });

      if (success) {
        return {
          success: true,
          message: '✅ Test notification sent successfully! Check your Telegram.',
        };
      }

      return {
        success: false,
        message: '❌ Failed to send test notification. Check console for details.',
      };
    } catch (error) {
      return {
        success: false,
        message: `❌ Error sending test: ${error.message}`,
      };
    }
  }

  async performTechnicalScan(options = {}) {
    if (this.scanInProgress) {
      console.log('⏳ Scan skipped; previous scan still running');
      this.stats.skippedDueToOverlap += 1;
      return {
        scanTime: new Date(),
        status: 'skipped',
        reason: 'previous_scan_in_progress',
      };
    }

    const startTime = Date.now();
    this.scanInProgress = true;
    this.scanProgress = {
      running: true,
      processed: 0,
      total: this.trackedCoins.length,
      percent: 0,
      interval: this.selectedIntervalKey,
      startedAt: new Date(),
      params: options,
    };

    try {
      await this.ensureGreedFearIndex();
      console.log(`\n🎯 TECHNICAL SCAN STARTED: ${new Date().toLocaleString()}`);

      const opportunities = [];
      let analyzedCount = 0;
      let mockDataUsed = 0;
      const heatmapEntries = [];

// Replace lines ~485-510 with this:
for (const coin of this.trackedCoins) {
    try {
        const analysis = await this.analyzeWithTechnicalIndicators(coin, { options });
        analyzedCount += 1;

        // DEBUG: Log every analysis
        console.log(`🔍 ${coin.symbol}: ${analysis.action} (${(analysis.confidence * 100).toFixed(0)}%) - Mock: ${analysis.usesMockData}`);

        if (analysis.usesMockData) {
            mockDataUsed += 1;
        }

        if (analysis.heatmapEntry) {
            heatmapEntries.push(analysis.heatmapEntry);
        }

        // FIXED LINE: Remove mock data restriction - allow both real and mock data
        if (analysis.confidence >= this.minConfidence) {
            if (!this.applyScanFilters(analysis, options)) {
                console.log(`🚫 ${coin.symbol}: Filtered out by scan filters`);
                continue;
            }
            opportunities.push(analysis);
            console.log(`✅ ${coin.symbol}: ${analysis.action} (${(analysis.confidence * 100).toFixed(0)}% confidence) - ADDED TO OPPORTUNITIES`);
        } else {
            console.log(`❌ ${coin.symbol}: Confidence too low (${(analysis.confidence * 100).toFixed(0)}% < ${(this.minConfidence * 100).toFixed(0)}%)`);
        }
    } catch (error) {
        console.log(`❌ ${coin.symbol}: Analysis failed - ${error.message}`);
        this.stats.apiErrors += 1;
    } finally {
        this.scanProgress.processed += 1;
        this.scanProgress.percent = Math.min(
            Math.round((this.scanProgress.processed / this.scanProgress.total) * 100),
            100,
        );
    }

    await sleep(COINGECKO_DELAY);
}

      opportunities.sort((a, b) => b.confidence - a.confidence);

      this.stats.totalScans += 1;
      this.stats.totalOpportunities += opportunities.length;
      this.stats.lastScanDuration = Date.now() - startTime;
      this.stats.mockDataUsage += mockDataUsed;
      this.stats.lastSuccessfulScan = new Date();
      this.latestHeatmap = heatmapEntries.sort((a, b) => (b.overallScore || 0) - (a.overallScore || 0));

      if (opportunities.length > 0) {
        this.stats.avgConfidence =
          opportunities.reduce((sum, o) => sum + o.confidence, 0) / opportunities.length;
      }

      if (TELEGRAM_ENABLED && opportunities.length > 0) {
        console.log(`📱 Sending Telegram notifications for ${opportunities.length} opportunities...`);
        for (const opp of opportunities) {
          await this.sendTelegramNotification(opp);
          await sleep(1500);
        }
      }

      this.analysisHistory.unshift({
        timestamp: new Date(),
        opportunities: opportunities.length,
        details: opportunities,
        duration: this.stats.lastScanDuration,
        analyzed: analyzedCount,
      });

      if (this.analysisHistory.length > 288) {
        this.analysisHistory = this.analysisHistory.slice(0, 288);
      }

      console.log(`\n📈 SCAN COMPLETE: ${opportunities.length} opportunities found`);
      this.scanInProgress = false;
      this.scanProgress = {
        running: false,
        processed: this.trackedCoins.length,
        total: this.trackedCoins.length,
        percent: 100,
        interval: this.selectedIntervalKey,
        completedAt: new Date(),
      };

      return {
        scanTime: new Date(),
        totalCoins: this.trackedCoins.length,
        analyzedCoins: analyzedCount,
        opportunitiesFound: opportunities.length,
        opportunities,
        nextScan: this.isRunning ? new Date(Date.now() + this.scanIntervalMs) : null,
        duration: this.stats.lastScanDuration,
        mockDataUsed,
        greedFear: this.greedFearIndex,
        heatmap: heatmapEntries,
      };
    } catch (error) {
      console.log('❌ Technical scan failed:', error.message);
      this.scanInProgress = false;
      this.scanProgress = {
        running: false,
        processed: this.scanProgress.processed,
        total: this.trackedCoins.length,
        percent: Math.min(
          Math.round((this.scanProgress.processed / this.trackedCoins.length) * 100),
          100,
        ),
        interval: this.selectedIntervalKey,
        error: error.message,
        completedAt: new Date(),
      };
      return {
        scanTime: new Date(),
        error: error.message,
        opportunities: [],
        greedFear: this.greedFearIndex,
      };
    }
  }

  async analyzeWithTechnicalIndicators(coin, context = {}) {
    let usesMockData = false;
    const scanOptions = context.options || {};

    try {
      this.currentlyAnalyzing = {
        symbol: coin.symbol,
        name: coin.name,
        stage: 'Fetching historical data…',
        timestamp: new Date(),
        progress: 10,
      };
      this.updateLiveAnalysis();

      const {
        minuteData,
        hourlyData,
        dailyData,
        usedMock,
      } = await this.fetchHistoricalData(coin.id);
      usesMockData = usedMock;

      const timeframeSeries = this.prepareTimeframeSeries(minuteData, hourlyData, dailyData);
      const hasEnoughData = Object.values(timeframeSeries).some(
        (series) => Array.isArray(series) && series.length >= 3,
      );
      if (!hasEnoughData) {
        throw new Error('Insufficient valid price data');
      }

      this.currentlyAnalyzing.stage = 'Calculating technical indicators…';
      this.currentlyAnalyzing.progress = 40;
      this.updateLiveAnalysis();

      let currentPrice = null;
      const frameIndicators = {};
      Object.entries(timeframeSeries).forEach(([frameKey, series]) => {
        if (!Array.isArray(series) || series.length < 3) return;
        const prices = series
          .map((d) => d.price)
          .filter((price) => typeof price === 'number' && Number.isFinite(price));
        if (prices.length < 3) return;
        currentPrice = currentPrice ?? prices[prices.length - 1];

        const basePrice = prices[prices.length - 1];
        const rsiPeriod = Math.min(14, prices.length - 1);
        const bbPeriod = Math.min(20, prices.length);
        const rsiValue = rsiPeriod > 0 ? this.calculateRSI(prices, rsiPeriod) : 50;
        const bollingerRaw =
          bbPeriod >= 5
            ? this.calculateBollingerBands(prices, bbPeriod)
            : this.placeholderBollinger(basePrice);
        const bollingerPosition = this.getBollingerPosition(
          basePrice,
          bollingerRaw.upper,
          bollingerRaw.lower,
        );
        const sr = this.identifySupportResistance(prices);
        const trend = this.identifyTrend(prices);
        const momentum = this.calculateMomentum(prices);

        frameIndicators[frameKey] = {
          rsi: rsiValue.toFixed(1),
          trend,
          momentum,
          bollinger: bollingerRaw,
          bollingerPosition,
          support: sr.support,
          resistance: sr.resistance,
          points: prices.length,
        };
      });

      if (!currentPrice) {
        throw new Error('No historical data available');
      }

      this.currentlyAnalyzing.stage = 'Analyzing multi-timeframes…';
      this.currentlyAnalyzing.progress = 60;
      this.updateLiveAnalysis();

      const indicatorSnapshot = {
        symbol: coin.symbol,
        name: coin.name,
        currentPrice,
        frames: frameIndicators,
      };

      const newsHeadlines = await this.fetchCoinNews(coin.symbol, coin.name);
      indicatorSnapshot.news = newsHeadlines;

      this.currentlyAnalyzing.news = newsHeadlines;

      this.currentlyAnalyzing.stage = 'DeepSeek AI is evaluating…';
      this.currentlyAnalyzing.progress = 70;
      this.currentlyAnalyzing.technicals = {
        frameSnapshot: ['10m', '1h', '4h', '1d', '1w']
          .map((key) => `${key.toUpperCase()}: ${frameIndicators[key]?.trend || 'N/A'}`)
          .join(' | '),
      };
      this.updateLiveAnalysis();

      const aiAnalysis = await this.getAITechnicalAnalysis(indicatorSnapshot, scanOptions);

      this.currentlyAnalyzing.stage = 'Analysis complete';
      this.currentlyAnalyzing.progress = 100;
      this.currentlyAnalyzing.result = {
        action: aiAnalysis.action,
        confidence: `${(aiAnalysis.confidence * 100).toFixed(0)}%`,
        reason: aiAnalysis.reason,
      };
      this.updateLiveAnalysis();

      setTimeout(() => {
        this.currentlyAnalyzing = null;
        this.updateLiveAnalysis();
      }, 2500);

      // Extract frame indicators for easier reference
      const dailyFrame = frameIndicators['1d'] || {};
      const hourlyFrame = frameIndicators['1h'] || {};
      const fastFrame = frameIndicators['10m'] || {};
      const fourHourFrame = frameIndicators['4h'] || {};
      const weeklyFrame = frameIndicators['1w'] || {};

      const dailyRsi = Number(dailyFrame.rsi) || 50;
      const dailyBB = dailyFrame.bollingerPosition || 'MIDDLE';
      const dailyTrend = dailyFrame.trend || 'SIDEWAYS';
      const hourlyRsi = Number(hourlyFrame.rsi) || 50;
      const hourlyTrend = hourlyFrame.trend || 'SIDEWAYS';
      const momentum10m = fastFrame.momentum || 'NEUTRAL';
      const weeklyTrend = weeklyFrame.trend || 'SIDEWAYS';

      let action = aiAnalysis.action;
      let confidence = aiAnalysis.confidence;
      let reason = aiAnalysis.reason;
      let insights = aiAnalysis.insights;

      if (dailyRsi < 30 && dailyBB === 'LOWER' && dailyTrend === 'BEARISH') {
        action = 'BUY';
        confidence = 0.75;
        reason = 'Daily oversold with Bollinger support and potential bearish exhaustion';
        insights = [
          'Strong mean-reversion potential',
          'Risk: Trend continuation',
          `Weekly trend backdrop: ${weeklyTrend}`,
        ];
      } else if (dailyRsi > 70 && dailyBB === 'UPPER' && dailyTrend === 'BULLISH') {
        action = 'SELL';
        confidence = 0.75;
        reason = 'Daily overbought at Bollinger resistance';
        insights = [
          'Profit-taking opportunity',
          'Risk: Trend continuation',
          `Weekly trend backdrop: ${weeklyTrend}`,
        ];
      } else if (dailyRsi < 35 && dailyTrend === 'BULLISH' && hourlyTrend === 'BULLISH') {
        action = 'BUY';
        confidence = 0.7;
        reason = 'Both timeframes bullish with daily oversold signal';
        insights = ['Trend alignment positive', 'Watch for confirmation', 'Stop below recent low'];
      } else if (hourlyRsi < 30 && hourlyTrend === 'BULLISH') {
        action = 'BUY';
        confidence = 0.65;
        reason = 'Hourly oversold in bullish hourly trend';
        insights = ['Short-term mean reversion opportunity', 'Confirm with volume', 'Tight stop loss'];
      } else if (momentum10m === 'STRONG_DOWN' && dailyTrend === 'BEARISH') {
        action = 'SELL';
        confidence = 0.6;
        reason = 'Short-term momentum and daily trend both bearish';
        insights = ['Potential continuation move', 'Watch for support breaks', 'Consider partial position sizing'];
      } else if (
        weeklyFrame.trend === 'BULLISH' &&
        dailyFrame.trend === 'BULLISH' &&
        fourHourFrame.trend === 'BULLISH'
      ) {
        action = 'BUY';
        confidence = 0.62;
        reason = 'Weekly, daily, and 4H trends aligned to the upside';
        insights = ['Momentum building across timeframes', 'Look for pullback entries', 'Maintain disciplined stop'];
      }

      if (scanOptions.news && scanOptions.news.length > 0) {
        insights = [...insights, `News to watch: ${scanOptions.news[0].title}`];
      }

      const momentumHeadline =
        fastFrame.momentum ||
        hourlyFrame.momentum ||
        dailyFrame.momentum ||
        fourHourFrame.momentum ||
        'NEUTRAL';

      return {
        symbol: coin.symbol,
        name: coin.name,
        action,
        price: `$${currentPrice.toFixed(4)}`,
        confidence,
        signal: aiAnalysis.signal,
        reason,
        insights,
        timestamp: new Date(),
        usesMockData,
        news: newsHeadlines,
        indicators: {
          momentum: momentumHeadline,
          frames: Object.fromEntries(
            Object.entries(frameIndicators).map(([key, data]) => [
              key,
              {
                rsi: data.rsi,
                trend: data.trend,
                momentum: data.momentum,
                bollingerPosition: data.bollingerPosition,
                support:
                  data.support != null && Number.isFinite(data.support)
                    ? data.support.toFixed(2)
                    : 'N/A',
                resistance:
                  data.resistance != null && Number.isFinite(data.resistance)
                    ? data.resistance.toFixed(2)
                    : 'N/A',
                score: this.computeFrameScore(data).toFixed(2),
              },
            ]),
          ),
          daily: {
            rsi: dailyFrame.rsi || 'N/A',
            bollingerPosition: dailyFrame.bollingerPosition || 'N/A',
            trend: dailyFrame.trend || 'N/A',
            support:
              dailyFrame.support != null && Number.isFinite(dailyFrame.support)
                ? dailyFrame.support.toFixed(2)
                : 'N/A',
            resistance:
              dailyFrame.resistance != null && Number.isFinite(dailyFrame.resistance)
                ? dailyFrame.resistance.toFixed(2)
                : 'N/A',
          },
          hourly: {
            rsi: hourlyFrame.rsi || 'N/A',
            bollingerPosition: hourlyFrame.bollingerPosition || 'N/A',
            trend: hourlyFrame.trend || 'N/A',
            support:
              hourlyFrame.support != null && Number.isFinite(hourlyFrame.support)
                ? hourlyFrame.support.toFixed(2)
                : 'N/A',
            resistance:
              hourlyFrame.resistance != null && Number.isFinite(hourlyFrame.resistance)
                ? hourlyFrame.resistance.toFixed(2)
                : 'N/A',
          },
          fourHour: {
            rsi: fourHourFrame.rsi || 'N/A',
            trend: fourHourFrame.trend || 'N/A',
            momentum: fourHourFrame.momentum || 'N/A',
            bollingerPosition: fourHourFrame.bollingerPosition || 'N/A',
          },
          weekly: {
            rsi: weeklyFrame.rsi || 'N/A',
            trend: weeklyFrame.trend || 'N/A',
            momentum: weeklyFrame.momentum || 'N/A',
            bollingerPosition: weeklyFrame.bollingerPosition || 'N/A',
          },
        },
        heatmapEntry: this.buildHeatmapEntry(coin, frameIndicators),
      };
    } catch (error) {
      console.log(`❌ Technical analysis failed for ${coin.symbol}:`, error.message);

      this.currentlyAnalyzing = {
        symbol: coin.symbol,
        name: coin.name,
        stage: `Analysis failed: ${error.message}`,
        timestamp: new Date(),
        error: true,
      };
      this.updateLiveAnalysis();

      setTimeout(() => {
        this.currentlyAnalyzing = null;
        this.updateLiveAnalysis();
      }, 3000);

      return this.basicTechnicalAnalysis(coin);
    }
  }

  async fetchHistoricalData(coinId) {
    let usedMock = false;

    const fetchData = async (days, interval) => {
      try {
        const response = await axios.get(
          `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart`,
          {
            params: interval
              ? { vs_currency: 'usd', days, interval }
              : { vs_currency: 'usd', days },
            timeout: 15000,
            headers: { 'User-Agent': 'ProfessionalTradingBot/2.0' },
          },
        );

        if (response.data && Array.isArray(response.data.prices)) {
          return response.data.prices
            .map(([timestamp, price]) => ({
              timestamp: new Date(timestamp),
              price: typeof price === 'number' ? price : Number(price),
            }))
            .filter((item) => Number.isFinite(item.price) && item.price > 0);
        }

        throw new Error('Invalid API response structure');
      } catch (error) {
        throw error;
      }
    };

    try {
      const [minuteRaw, hourlyData, dailyData] = await Promise.all([
        fetchData(1, null),
        fetchData(7, 'hourly'),
        fetchData(30, 'daily'),
      ]);
      const minuteData = minuteRaw.slice(-720); // last 12 hours (~720 minutes at 1-min granularity)
      return { minuteData, hourlyData, dailyData, usedMock };
    } catch (primaryError) {
      console.log(`⚠️ ${coinId}: Falling back to mock data (${primaryError.message})`);
      usedMock = true;
      const mockData = await this.generateRealisticMockData(coinId);
      return {
        minuteData: mockData.minuteData,
        hourlyData: mockData.hourlyData,
        dailyData: mockData.dailyData,
        usedMock,
      };
    }
  }

  async generateRealisticMockData(coinId) {
    try {
      const currentPriceResponse = await axios.get(
        `https://api.coingecko.com/api/v3/simple/price`,
        {
          params: { ids: coinId, vs_currencies: 'usd' },
          timeout: 10000,
        },
      );

      let basePrice = 100;
      if (currentPriceResponse.data && currentPriceResponse.data[coinId]) {
        basePrice = currentPriceResponse.data[coinId].usd;
      }

      const daily = [];
      const hourly = [];
      const minute = [];

      const now = new Date();

      const generate = (points, granularityMinutes, list) => {
        let previousPrice = basePrice;
        for (let i = points - 1; i >= 0; i -= 1) {
          const timestamp = new Date(now);
          timestamp.setMinutes(timestamp.getMinutes() - i * granularityMinutes);
          const volatility = 0.01 + Math.random() * 0.03;
          const change = (Math.random() - 0.5) * 2 * volatility;
          const price = Math.max(previousPrice * (1 + change), 0.0001);
          list.push({ timestamp, price });
          previousPrice = price;
        }
      };

      generate(7, 24 * 60, daily);
      generate(24, 60, hourly);

      const generateMinute = (points, list) => {
        let previousPrice = basePrice;
        for (let i = points - 1; i >= 0; i -= 1) {
          const timestamp = new Date(now);
          timestamp.setMinutes(timestamp.getMinutes() - i);
          const volatility = 0.005 + Math.random() * 0.015;
          const change = (Math.random() - 0.5) * 2 * volatility;
          const price = Math.max(previousPrice * (1 + change), 0.0001);
          list.push({ timestamp, price });
          previousPrice = price;
        }
      };

      generateMinute(720, minute);

      return { minuteData: minute, hourlyData: hourly, dailyData: daily };
    } catch (mockError) {
      return this.generateBasicMockData();
    }
  }

  generateBasicMockData() {
    const now = new Date();
    const basePrice = 100 + Math.random() * 1000;

    const daily = [];
    const hourly = [];
    const minute = [];

    const generate = (points, granularityMinutes, list) => {
      let previousPrice = basePrice;
      for (let i = points - 1; i >= 0; i -= 1) {
        const timestamp = new Date(now);
        timestamp.setMinutes(timestamp.getMinutes() - i * granularityMinutes);
        const volatility = 0.05;
        const change = (Math.random() - 0.5) * 2 * volatility;
        const price = Math.max(previousPrice * (1 + change), 0.0001);
        list.push({ timestamp, price });
        previousPrice = price;
      }
    };

    generate(7, 24 * 60, daily);
    generate(24, 60, hourly);

    const generateMinute = (points) => {
      let previousPrice = basePrice;
      for (let i = points - 1; i >= 0; i -= 1) {
        const timestamp = new Date(now);
        timestamp.setMinutes(timestamp.getMinutes() - i);
        const volatility = 0.008;
        const change = (Math.random() - 0.5) * 2 * volatility;
        const price = Math.max(previousPrice * (1 + change), 0.0001);
        minute.push({ timestamp, price });
        previousPrice = price;
      }
    };

    generateMinute(720);

    return { minuteData: minute, hourlyData: hourly, dailyData: daily };
  }

  updateLiveAnalysis() {
    if (this.currentlyAnalyzing) {
      this.liveAnalysis.unshift({ ...this.currentlyAnalyzing });
      if (this.liveAnalysis.length > 25) {
        this.liveAnalysis = this.liveAnalysis.slice(0, 25);
      }
    }
  }

  getLiveAnalysis() {
    return {
      currentlyAnalyzing: this.currentlyAnalyzing,
      recentAnalysis: this.liveAnalysis.slice(0, 10),
      timestamp: new Date(),
    };
  }

  getStats() {
    return {
      ...this.stats,
      running: this.isRunning,
      minConfidence: this.minConfidence,
      trackedCoins: this.trackedCoins.length,
      telegramEnabled: TELEGRAM_ENABLED,
      newsEnabled: NEWS_ENABLED,
      selectedInterval: this.selectedIntervalKey,
      scanProgress: this.getScanProgress(),
      greedFear: this.greedFearIndex,
      heatmap: this.latestHeatmap,
    };
  }

  calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;

    let gains = 0;
    let losses = 0;
    for (let i = 1; i <= period; i += 1) {
      const change = prices[prices.length - i] - prices[prices.length - i - 1];
      if (change > 0) gains += change;
      else losses -= change;
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;

    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  calculateBollingerBands(prices, period = 20, multiplier = 2) {
    if (prices.length < period) {
      return this.placeholderBollinger(prices[prices.length - 1]);
    }
    const slice = prices.slice(-period);
    const mean = slice.reduce((sum, price) => sum + price, 0) / period;
    const variance = slice.reduce((sum, price) => sum + (price - mean) ** 2, 0) / period;
    const stdDev = Math.sqrt(variance);

    return {
      upper: mean + multiplier * stdDev,
      lower: mean - multiplier * stdDev,
      middle: mean,
    };
  }

  placeholderBollinger(currentPrice) {
    return {
      upper: currentPrice * 1.1,
      lower: currentPrice * 0.9,
      middle: currentPrice,
    };
  }

  identifySupportResistance(prices) {
    const recentPrices = prices.slice(-20);
    return {
      support: Math.min(...recentPrices),
      resistance: Math.max(...recentPrices),
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

  calculateMomentum(prices) {
    if (prices.length < 2) return 'NEUTRAL';
    const recentChange = ((prices[prices.length - 1] - prices[prices.length - 2]) / prices[prices.length - 2]) * 100;

    if (recentChange > 2) return 'STRONG_UP';
    if (recentChange > 0.5) return 'UP';
    if (recentChange < -2) return 'STRONG_DOWN';
    if (recentChange < -0.5) return 'DOWN';
    return 'NEUTRAL';
  }

  async getAITechnicalAnalysis(technicalData, options = {}) {
    try {
      const prompt = this.createTechnicalAnalysisPrompt(technicalData, options);

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://my-deepseek-bot-1.onrender.com',
          'X-Title': 'Technical Analysis Bot',
        },
        body: JSON.stringify({
          model: 'deepseek/deepseek-r1:free',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 300,
          temperature: 0.1,
        }),
      });

      if (!response.ok) throw new Error('AI API failed');
      const data = await response.json();
      return this.parseTechnicalAIResponse(data.choices[0].message.content, technicalData);
    } catch (error) {
      console.log('⚠️ AI analysis failed, using deterministic fallback:', error.message);
      return this.generateTechnicalAnalysis(technicalData);
    }
  }

  createTechnicalAnalysisPrompt(technicalData, options = {}) {
    const frames = technicalData.frames || {};
    const frameToText = (key, label) => {
      const frame = frames[key] || {};
      const rsi = frame.rsi || 'N/A';
      const trend = frame.trend || 'N/A';
      const momentum = frame.momentum || 'N/A';
      const bollinger = frame.bollingerPosition || 'N/A';
      const support =
        frame.support != null && Number.isFinite(frame.support)
          ? frame.support.toFixed(2)
          : frame.support || 'N/A';
      const resistance =
        frame.resistance != null && Number.isFinite(frame.resistance)
          ? frame.resistance.toFixed(2)
          : frame.resistance || 'N/A';
      return `${label}:
- RSI: ${rsi} ${this.getRSILevel(Number(rsi))}
- Bollinger: ${bollinger}
- Trend: ${trend}
- Momentum: ${momentum}
- Support: ${support}
- Resistance: ${resistance}`;
    };
    const newsLines = (technicalData.news || [])
      .map((news) => `- (${news.source}) ${news.title}`)
      .join('\n') || '- No significant headlines in the last few hours';
    const patternText = options.pattern
      ? `Preferred pattern: ${options.pattern}`
      : 'Preferred pattern: balanced';
    const indicatorPrefs = options.indicators
      ? Object.entries(options.indicators)
          .filter(([, enabled]) => enabled)
          .map(([key]) => key.toUpperCase())
          .join(', ')
      : 'All indicators';
    return `PROFESSIONAL TECHNICAL ANALYSIS REQUEST:

CRYPTO: ${technicalData.symbol} - ${technicalData.name}
CURRENT PRICE: ${technicalData.currentPrice}

${frameToText('10m', '10 Minute')}

${frameToText('1h', '1 Hour')}

${frameToText('4h', '4 Hour')}

${frameToText('1d', '1 Day')}

${frameToText('1w', '1 Week')}

${patternText}
Indicators selected: ${indicatorPrefs}

RECENT NEWS:
${newsLines}

Respond with JSON:
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
          signal: `${parsed.action} | Technical Analysis`,
        };
      }
      throw new Error('Invalid AI response format');
    } catch (error) {
      return this.generateTechnicalAnalysis(technicalData);
    }
  }

  generateTechnicalAnalysis(technicalData) {
    let action = 'HOLD';
    let confidence = 0.3;
    let reason = 'No clear technical setup';
    let insights = ['Wait for clearer signals', 'Monitor key levels', 'Low conviction'];

    const frames = technicalData.frames || {};
    const frame10m = frames['10m'] || {};
    const frame1h = frames['1h'] || {};
    const frame4h = frames['4h'] || {};
    const frame1d = frames['1d'] || {};
    const frame1w = frames['1w'] || {};

    const dailyRsi = Number(frame1d.rsi) || 50;
    const dailyBB = frame1d.bollingerPosition || 'MIDDLE';
    const dailyTrend = frame1d.trend || 'SIDEWAYS';

    const hourlyRsi = Number(frame1h.rsi) || 50;
    const hourlyTrend = frame1h.trend || 'SIDEWAYS';

    const momentum10m = frame10m.momentum || 'NEUTRAL';
    const weeklyTrend = frame1w.trend || 'SIDEWAYS';

    if (dailyRsi < 30 && dailyBB === 'LOWER' && dailyTrend === 'BEARISH') {
      action = 'BUY';
      confidence = 0.75;
      reason = 'Daily oversold with Bollinger support and potential bearish exhaustion';
      insights = [
        'Strong mean-reversion potential',
        'Risk: Trend continuation',
        `Weekly trend backdrop: ${weeklyTrend}`,
      ];
    } else if (dailyRsi > 70 && dailyBB === 'UPPER' && dailyTrend === 'BULLISH') {
      action = 'SELL';
      confidence = 0.75;
      reason = 'Daily overbought at Bollinger resistance';
      insights = [
        'Profit-taking opportunity',
        'Risk: Trend continuation',
        `Weekly trend backdrop: ${weeklyTrend}`,
      ];
    } else if (dailyRsi < 35 && dailyTrend === 'BULLISH' && hourlyTrend === 'BULLISH') {
      action = 'BUY';
      confidence = 0.7;
      reason = 'Both timeframes bullish with daily oversold signal';
      insights = ['Trend alignment positive', 'Watch for confirmation', 'Stop below recent low'];
    } else if (hourlyRsi < 30 && hourlyTrend === 'BULLISH') {
      action = 'BUY';
      confidence = 0.65;
      reason = 'Hourly oversold in bullish hourly trend';
      insights = ['Short-term mean reversion opportunity', 'Confirm with volume', 'Tight stop loss'];
    } else if (momentum10m === 'STRONG_DOWN' && dailyTrend === 'BEARISH') {
      action = 'SELL';
      confidence = 0.6;
      reason = 'Short-term momentum and daily trend both bearish';
      insights = ['Potential continuation move', 'Watch for support breaks', 'Consider partial position sizing'];
    } else if (
      frame1w.trend === 'BULLISH' &&
      frame1d.trend === 'BULLISH' &&
      frame4h.trend === 'BULLISH'
    ) {
      action = 'BUY';
      confidence = 0.62;
      reason = 'Weekly, daily, and 4H trends aligned to the upside';
      insights = ['Momentum building across timeframes', 'Look for pullback entries', 'Maintain disciplined stop'];
    }

    if (technicalData.news && technicalData.news.length > 0) {
      insights = [...insights, `News to watch: ${technicalData.news[0].title}`];
    }

    return {
      action,
      confidence,
      reason,
      insights,
      signal: `${action} | Multi-Timeframe Analysis`,
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
      insights: ['Data fetch failed'],
      timestamp: new Date(),
      usesMockData: true,
      news: [],
      indicators: {
        momentum: 'N/A',
        frames: {},
        daily: {
          rsi: 'N/A',
          bollingerPosition: 'N/A',
          trend: 'N/A',
          support: 'N/A',
          resistance: 'N/A',
        },
        hourly: {
          rsi: 'N/A',
          bollingerPosition: 'N/A',
          trend: 'N/A',
        },
        fourHour: {
          rsi: 'N/A',
          trend: 'N/A',
          momentum: 'N/A',
          bollingerPosition: 'N/A',
        },
        weekly: {
          rsi: 'N/A',
          trend: 'N/A',
          momentum: 'N/A',
          bollingerPosition: 'N/A',
        },
      },
      heatmapEntry: null,
    };
  }

  getScanHistory() {
    return this.analysisHistory.slice(0, 10);
  }

  applyScanFilters(analysis, options) {
    const cfg = options || {};
    if (cfg.minConfidence && analysis.confidence < cfg.minConfidence) return false;
    if (cfg.include) {
      if (!cfg.include.buy && analysis.action === 'BUY') return false;
      if (!cfg.include.sell && analysis.action === 'SELL') return false;
      if (!cfg.include.hold && analysis.action === 'HOLD') return false;
    }
    return true;
  }
}

const tradingBot = new ProfessionalTradingBot();

// API routes
app.post('/start-scan', async (req, res) => {
  const result = await tradingBot.startAutoScan();
  res.json(result);
});

app.post('/stop-scan', (req, res) => {
  const result = tradingBot.stopAutoScan();
  res.json(result);
});

app.post('/scan-now', async (req, res) => {
  try {
    const options = req.body || {};
    const result = await tradingBot.performTechnicalScan(options);
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
      message: `Error: ${error.message}`,
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

app.post('/auto-scan-settings', (req, res) => {
  try {
    const { interval } = req.body || {};
    if (!interval) {
      throw new Error('Interval is required');
    }
    tradingBot.setAutoScanInterval(interval);
    res.json({
      success: true,
      interval,
      humanReadable: interval,
      running: tradingBot.isRunning,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
});

app.get('/scan-progress', (req, res) => {
  res.json(tradingBot.getScanProgress());
});

app.get('/bot-status', (req, res) => {
  res.json({
    running: tradingBot.isRunning,
    coinsTracked: tradingBot.trackedCoins.length,
    strategy: 'RSI + Bollinger Bands + Support/Resistance + Momentum + AI overlay',
    interval: tradingBot.selectedIntervalKey,
    minConfidence: tradingBot.minConfidence,
    stats: tradingBot.getStats(),
    telegramEnabled: TELEGRAM_ENABLED,
    newsEnabled: NEWS_ENABLED,
    lastUpdate: new Date(),
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'professional-scanner-v2',
    strategy: 'Technical Analysis (Enhanced)',
    autoScan: tradingBot.isRunning,
    telegramEnabled: TELEGRAM_ENABLED,
    newsEnabled: NEWS_ENABLED,
    scanInterval: tradingBot.selectedIntervalKey,
    coinsTracked: tradingBot.trackedCoins.length,
    lastSuccessfulScan: tradingBot.stats.lastSuccessfulScan,
    mockDataUsage: tradingBot.stats.mockDataUsage,
    time: new Date(),
  });
});

// Main UI route
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
          background: radial-gradient(circle at top left, #1f2937, #0f172a 55%, #020617 100%);
          min-height: 100vh;
          color: #1a202c;
        }
        .container {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 380px;
          gap: 24px;
          max-width: 1920px;
          margin: 0 auto;
          padding: 24px;
        }
        .main-content, .sidebar {
          background: rgba(255, 255, 255, 0.95);
          border-radius: 24px;
          padding: 32px;
          box-shadow: 0 24px 48px rgba(15, 23, 42, 0.35);
        }
        .header { text-align: center; margin-bottom: 32px; padding-bottom: 24px; border-bottom: 2px solid rgba(148, 163, 184, 0.2); }
        .header h1 {
          color: #0f172a;
          font-size: 2.75em;
          font-weight: 700;
          margin-bottom: 12px;
          background: linear-gradient(135deg, #6366f1, #22d3ee);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        }
        .subtitle {
          color: #334155;
          font-weight: 500;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 16px;
          margin-bottom: 28px;
        }
        .sentiment-card {
          margin-bottom: 28px;
          background: linear-gradient(135deg, rgba(14, 165, 233, 0.12), rgba(129, 140, 248, 0.2));
          border: 1px solid rgba(129, 140, 248, 0.35);
          border-radius: 20px;
          padding: 24px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 24px;
        }
        .sentiment-indicator {
          flex: 0 0 140px;
          height: 140px;
          background: conic-gradient(#22c55e 0deg, #22c55e var(--sentiment-angle, 180deg), rgba(148, 163, 184, 0.25) var(--sentiment-angle, 180deg));
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          box-shadow: 0 12px 30px rgba(14, 165, 233, 0.25);
        }
        .sentiment-indicator::after {
          content: '';
          position: absolute;
          width: 110px;
          height: 110px;
          background: rgba(15, 23, 42, 0.85);
          border-radius: 50%;
        }
        .sentiment-value {
          position: relative;
          z-index: 2;
          font-size: 2.2em;
          font-weight: 700;
          color: #e0f2fe;
        }
        .sentiment-details {
          flex: 1;
          color: #0f172a;
        }
        .sentiment-label {
          font-size: 0.75em;
          text-transform: uppercase;
          letter-spacing: 0.16em;
          font-weight: 700;
          color: #475569;
          margin-bottom: 8px;
        }
        .sentiment-status {
          font-size: 1.6em;
          font-weight: 700;
          margin-bottom: 8px;
          color: #0f172a;
        }
        .sentiment-meta {
          font-size: 0.85em;
          color: #475569;
        }
        .stat-card {
          background: linear-gradient(135deg, rgba(248, 250, 252, 0.95), rgba(226, 232, 240, 0.9));
          padding: 20px;
          border-radius: 16px;
          border: 1px solid rgba(148, 163, 184, 0.25);
          position: relative;
          overflow: hidden;
        }
        .stat-card::after {
          content: '';
          position: absolute;
          inset: 0;
          background: radial-gradient(circle at top right, rgba(99, 102, 241, 0.2), transparent);
          opacity: 0;
          transition: opacity 0.3s;
        }
        .stat-card:hover::after { opacity: 1; }
        .stat-label { color: #64748b; font-size: 0.75em; font-weight: 600; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.08em; }
        .stat-value { font-size: 2em; font-weight: 700; color: #0f172a; }
        .controls {
          background: linear-gradient(135deg, rgba(248, 250, 252, 0.95), rgba(226, 232, 240, 0.9));
          padding: 28px;
          border-radius: 20px;
          margin-bottom: 28px;
          border: 1px solid rgba(148, 163, 184, 0.2);
        }
        .heatmap-section {
          background: linear-gradient(135deg, rgba(15, 23, 42, 0.05), rgba(59, 130, 246, 0.08));
          border-radius: 20px;
          padding: 24px;
          border: 1px solid rgba(148, 163, 184, 0.2);
          margin-bottom: 28px;
        }
        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          margin-bottom: 16px;
          color: #0f172a;
        }
        .section-header small {
          color: #475569;
          font-size: 0.8em;
          text-transform: uppercase;
          letter-spacing: 0.1em;
        }
        .heatmap-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap: 12px;
        }
        .heatmap-empty {
          grid-column: 1 / -1;
          text-align: center;
          padding: 24px;
          color: #475569;
          background: rgba(241, 245, 249, 0.7);
          border-radius: 14px;
          border: 1px dashed rgba(148, 163, 184, 0.4);
        }
        .heatmap-cell {
          padding: 16px;
          border-radius: 14px;
          background: rgba(248, 250, 252, 0.9);
          border: 1px solid rgba(148, 163, 184, 0.25);
          transition: transform 0.2s ease;
        }
        .heatmap-cell:hover {
          transform: translateY(-2px);
          box-shadow: 0 18px 32px rgba(15, 23, 42, 0.12);
        }
        .heatmap-coin {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
          font-weight: 600;
          color: #0f172a;
        }
        .heatmap-score {
          font-size: 1.4em;
          font-weight: 700;
        }
        .heatmap-frames {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 6px;
          font-size: 0.7em;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .heatmap-frame {
          padding: 6px;
          border-radius: 8px;
          background: rgba(15, 23, 42, 0.06);
          text-align: center;
          font-weight: 600;
        }
        .button-group {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: 12px;
          margin-bottom: 20px;
        }
        button {
          padding: 14px 24px;
          border: none;
          border-radius: 12px;
          cursor: pointer;
          font-weight: 600;
          font-size: 14px;
          transition: all 0.3s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          color: white;
        }
        .btn-success { background: linear-gradient(135deg, #22c55e, #16a34a); }
        .btn-danger { background: linear-gradient(135deg, #ef4444, #dc2626); }
        .btn-primary { background: linear-gradient(135deg, #6366f1, #4338ca); }
        .btn-secondary { background: linear-gradient(135deg, #475569, #334155); }
        .btn-telegram { background: linear-gradient(135deg, #0088cc, #0369a1); }
        button:hover {
          transform: translateY(-3px);
          box-shadow: 0 12px 24px rgba(15, 23, 42, 0.25);
        }
        .status-card {
          background: linear-gradient(135deg, #0ea5e9, #6366f1);
          color: white;
          padding: 24px;
          border-radius: 16px;
          text-align: center;
        }
        .status-card h4 { margin-bottom: 8px; font-size: 1.2em; }
        .status-meta { font-size: 0.85em; opacity: 0.85; margin-top: 8px; }
        .opportunity {
          background: white;
          border-radius: 20px;
          padding: 24px;
          margin-bottom: 20px;
          border-left: 6px solid;
          box-shadow: 0 12px 32px rgba(15, 23, 42, 0.12);
          transition: transform 0.3s ease, box-shadow 0.3s ease;
          position: relative;
        }
        .opportunity::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: 20px;
          background: radial-gradient(circle at top right, rgba(14, 165, 233, 0.15), transparent);
          opacity: 0;
          transition: opacity 0.3s ease;
        }
        .opportunity:hover {
          transform: translateY(-4px);
          box-shadow: 0 20px 40px rgba(15, 23, 42, 0.18);
        }
        .opportunity:hover::before { opacity: 1; }
        .opportunity.buy { border-left-color: #22c55e; }
        .opportunity.sell { border-left-color: #ef4444; }
        .opportunity.hold { border-left-color: #f59e0b; }
        .coin-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }
        .coin-name { font-size: 1.4em; font-weight: 700; color: #0f172a; }
        .action-badge {
          padding: 8px 16px;
          border-radius: 999px;
          font-weight: 700;
          font-size: 0.9em;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .buy-badge { background: rgba(34, 197, 94, 0.15); color: #15803d; }
        .sell-badge { background: rgba(239, 68, 68, 0.15); color: #b91c1c; }
        .hold-badge { background: rgba(245, 158, 11, 0.15); color: #b45309; }
        .price-confidence {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap: 20px;
          margin: 20px 0;
          padding: 20px;
          background: rgba(148, 163, 184, 0.08);
          border-radius: 12px;
        }
        .price-box .value, .confidence-box .value {
          font-size: 1.6em;
          font-weight: 700;
          color: #0f172a;
          margin-bottom: 4px;
        }
        .confidence-bar {
          height: 10px;
          background: rgba(226, 232, 240, 0.7);
          border-radius: 12px;
          margin: 16px 0;
          overflow: hidden;
        }
        .confidence-fill {
          height: 100%;
          border-radius: 12px;
          transition: width 0.8s;
        }
        .high-confidence { background: linear-gradient(90deg, #22c55e, #16a34a); }
        .medium-confidence { background: linear-gradient(90deg, #f59e0b, #d97706); }
        .low-confidence { background: linear-gradient(90deg, #ef4444, #b91c1c); }
        .technical-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
          gap: 12px;
          margin: 20px 0;
        }
        .technical-item {
          background: rgba(241, 245, 249, 0.85);
          padding: 14px;
          border-radius: 12px;
          text-align: center;
          border: 1px solid rgba(148, 163, 184, 0.25);
        }
        .timeframe-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
          gap: 10px;
          margin: 16px 0;
        }
        .timeframe-card {
          border-radius: 12px;
          padding: 12px;
          background: rgba(15, 23, 42, 0.05);
          border: 1px solid rgba(148, 163, 184, 0.2);
        }
        .timeframe-card h5 {
          font-size: 0.75em;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #475569;
          margin-bottom: 8px;
        }
        .timeframe-card .metric {
          font-size: 0.9em;
          color: #0f172a;
          margin-bottom: 4px;
        }
        .technical-item strong {
          display: block;
          color: #475569;
          font-size: 0.75em;
          text-transform: uppercase;
          margin-bottom: 6px;
        }
        .reason-box {
          margin: 16px 0;
          padding: 16px;
          background: rgba(148, 163, 184, 0.08);
          border-radius: 12px;
          border-left: 4px solid #6366f1;
        }
        .insights-list ul { list-style: none; padding: 0; }
        .insights-list li {
          padding: 10px 12px;
          margin-bottom: 8px;
          background: rgba(241, 245, 249, 0.85);
          border-radius: 8px;
          padding-left: 32px;
          position: relative;
        }
        .insights-list li::before {
          content: '→';
          position: absolute;
          left: 12px;
          color: #6366f1;
          font-weight: bold;
        }
        .no-opportunities {
          text-align: center;
          padding: 80px 20px;
          color: #64748b;
        }
        .ai-visual {
          margin-top: 20px;
          background: rgba(14, 116, 144, 0.15);
          border-radius: 16px;
          padding: 18px;
          border: 1px solid rgba(125, 211, 252, 0.3);
        }
        .ai-visual h4 { color: #bae6fd; font-size: 1.1em; margin-bottom: 12px; }
        .ai-list { list-style: none; color: #bae6fd; font-size: 0.95em; }
        .ai-list li { margin-bottom: 8px; display: flex; align-items: center; gap: 8px; }
        .ai-tag {
          padding: 2px 10px;
          border-radius: 999px;
          font-size: 0.75em;
          background: rgba(125, 211, 252, 0.2);
          color: #0ea5e9;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .live-progress {
          margin-top: 16px;
          background: rgba(15, 23, 42, 0.6);
          padding: 14px;
          border-radius: 12px;
          border: 1px solid rgba(148, 163, 184, 0.2);
        }
        .progress-bar {
          height: 6px;
          background: rgba(148, 163, 184, 0.3);
          border-radius: 999px;
          overflow: hidden;
          margin-top: 8px;
        }
        .progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #38bdf8, #6366f1);
          width: 0;
          transition: width 0.3s ease;
        }
        .ai-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 0.75em;
          text-transform: uppercase;
          color: #94a3b8;
          letter-spacing: 0.12em;
          background: rgba(148, 163, 184, 0.12);
          padding: 4px 10px;
          border-radius: 999px;
          margin-right: 8px;
        }
        .history-card {
          margin-top: 20px;
          padding: 16px;
          background: rgba(15, 23, 42, 0.55);
          border-radius: 12px;
          border: 1px solid rgba(100, 116, 139, 0.35);
        }
        .history-item {
          display: flex;
          justify-content: space-between;
          color: #e2e8f0;
          font-size: 0.85em;
          padding: 10px 0;
          border-bottom: 1px solid rgba(148, 163, 184, 0.15);
        }
        .history-item:last-child { border-bottom: none; }
        @media (max-width: 1400px) { .container { grid-template-columns: 1fr; } }
        @media (max-width: 768px) {
          .button-group { grid-template-columns: 1fr; }
          .main-content, .sidebar { padding: 20px; }
        }
        .insights-list li::before {
          content: '→';
          position: absolute;
          left: 12px;
          color: #6366f1;
          font-weight: bold;
        }
        .news-section {
          margin-top: 20px;
          padding: 16px;
          background: rgba(15, 23, 42, 0.04);
          border-radius: 12px;
          border: 1px solid rgba(148, 163, 184, 0.2);
        }
        .news-section h4 {
          margin-bottom: 10px;
          font-size: 1em;
          color: #0f172a;
        }
        .news-section ul {
          list-style: none;
          padding: 0;
          margin: 0;
        }
        .news-section li {
          padding: 8px 0;
          border-bottom: 1px solid rgba(148, 163, 184, 0.2);
        }
        .news-section li:last-child {
          border-bottom: none;
        }
        .news-section a {
          color: #2563eb;
          text-decoration: none;
        }
        .news-section a:hover {
          text-decoration: underline;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="main-content">
          <div class="header">
            <h1>🤖 AI Crypto Trading Scanner Pro</h1>
            <div class="subtitle">Advanced Technical Analysis • AI Validation • Hourly Updates</div>
          </div>

          <div id="scanProgressContainer" style="display:none; margin-bottom: 20px;">
            <div style="display:flex; justify-content:space-between; color:#475569; font-weight:600; margin-bottom:6px;">
              <span>Current scan progress</span>
              <span id="scanProgressText">0%</span>
            </div>
            <div style="height:10px; background:rgba(226,232,240,0.7); border-radius:12px; overflow:hidden;">
              <div id="scanProgressFill" style="height:100%; width:0%; background:linear-gradient(90deg,#38bdf8,#6366f1); transition:width 0.4s;"></div>
            </div>
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
              <div class="stat-label">Notifications Sent</div>
              <div class="stat-value" id="notifications">0</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Avg Confidence</div>
              <div class="stat-value" id="avgConf">0%</div>
            </div>
          </div>

          <div class="sentiment-card" id="sentimentCard">
            <div class="sentiment-indicator" id="sentimentGauge">
              <div class="sentiment-value" id="sentimentValue">--</div>
            </div>
            <div class="sentiment-details">
              <div class="sentiment-label">Fear & Greed Index</div>
              <div class="sentiment-status" id="sentimentStatus">Fetching sentiment…</div>
              <div class="sentiment-meta" id="sentimentMeta">Last updated: --</div>
            </div>
          </div>

          <div class="controls">
            <h3>🎯 Scanner Controls</h3>
            <div style="display:flex; gap:16px; flex-wrap:wrap; align-items:center; margin-bottom:16px;">
              <label for="intervalSelect" style="font-weight:600; color:#475569;">Auto-scan interval</label>
              <select id="intervalSelect" onchange="changeInterval(this.value)" style="padding:10px 14px; border-radius:10px; border:1px solid rgba(148,163,184,0.4); background:white; color:#0f172a;">
                <option value="10m">Every 10 minutes</option>
                <option value="1h" selected>Every 1 hour</option>
                <option value="4h">Every 4 hours</option>
                <option value="1d">Daily</option>
                <option value="1w">Weekly</option>
              </select>
            </div>
            <div class="button-group">
              <button class="btn-success" onclick="startAutoScan()">🚀 Start Auto-Scan</button>
              <button class="btn-danger" onclick="stopAutoScan()">🛑 Stop Auto-Scan</button>
              <button class="btn-primary" onclick="manualScan()">🔍 Scan Now</button>
              <button class="btn-telegram" onclick="testTelegram()">📱 Test Telegram</button>
              <button class="btn-secondary" onclick="viewHistory()">📊 View History</button>
            </div>
            <div style="margin-top:16px; background: rgba(241, 245, 249, 0.9); border-radius: 16px; padding: 18px; border:1px solid rgba(148,163,184,0.2);">
              <h4 style="margin-bottom:12px; color:#0f172a;">Advanced Scan Settings</h4>
              <div style="display:flex; flex-wrap:wrap; gap:16px;">
                <div style="flex:1 1 220px;">
                  <label style="font-size:0.8em; font-weight:600; color:#475569;">Confidence threshold</label>
                  <input type="range" id="confidenceSlider" min="50" max="90" value="65" oninput="updateConfidenceLabel(this.value)" style="width:100%;">
                  <div style="font-size:0.85em; color:#0f172a;"><span id="confidenceLabel">65</span>%</div>
                </div>
                <div style="flex:1 1 220px;">
                  <label style="font-size:0.8em; font-weight:600; color:#475569;">Include signals</label>
                  <div style="display:flex; gap:8px; margin-top:6px;">
                    <label style="display:flex; align-items:center; gap:4px;"><input type="checkbox" id="filterBuy" checked> BUY</label>
                    <label style="display:flex; align-items:center; gap:4px;"><input type="checkbox" id="filterSell" checked> SELL</label>
                    <label style="display:flex; align-items:center; gap:4px;"><input type="checkbox" id="filterHold"> HOLD</label>
                  </div>
                </div>
                <div style="flex:1 1 220px;">
                  <label style="font-size:0.8em; font-weight:600; color:#475569;">Indicators</label>
                  <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:6px;">
                    <label style="display:flex; align-items:center; gap:4px;"><input type="checkbox" id="useRSI" checked> RSI</label>
                    <label style="display:flex; align-items:center; gap:4px;"><input type="checkbox" id="useBollinger" checked> Bollinger</label>
                    <label style="display:flex; align-items:center; gap:4px;"><input type="checkbox" id="useTrend" checked> Trend</label>
                    <label style="display:flex; align-items:center; gap:4px;"><input type="checkbox" id="useMomentum" checked> Momentum</label>
                    <label style="display:flex; align-items:center; gap:4px;"><input type="checkbox" id="useNews" checked> News</label>
                  </div>
                </div>
                <div style="flex:1 1 220px;">
                  <label style="font-size:0.8em; font-weight:600; color:#475569;">Pattern focus</label>
                  <select id="patternSelect" style="width:100%; padding:8px 12px; border-radius:10px; border:1px solid rgba(148,163,184,0.4);">
                    <option value="balanced">Balanced (default)</option>
                    <option value="meanReversion">Mean Reversion (RSI/Bollinger)</option>
                    <option value="trendFollowing">Trend Following (Trend/Momentum)</option>
                    <option value="newsDriven">News Driven</option>
                    <option value="custom">Custom mix</option>
                  </select>
                </div>
              </div>
            </div>
            <div class="status-card">
              <h4>Scanner Status</h4>
              <div id="statusText">🟢 Ready to start</div>
              <div id="nextScan">Next scan: Not scheduled</div>
              <div class="status-meta" id="telemetryStatus">
                Telegram: ${TELEGRAM_ENABLED ? '✅ Enabled' : '⚠️ Disabled'}
              </div>
            </div>
          </div>

          <div>
            <h3 style="margin-bottom: 24px; color: #0f172a; font-size: 1.5em; font-weight: 700;">📈 Trading Opportunities</h3>
            <div id="results">
              <div class="no-opportunities">
                <h3>🔍 Ready to Scan</h3>
                <p>Click "Scan Now" to start comprehensive technical analysis</p>
              </div>
            </div>
          </div>
        </div>

        <div class="sidebar">
          <div style="background: rgba(15, 23, 42, 0.92); color: white; border-radius: 24px; padding: 26px; box-shadow: 0 20px 40px rgba(15,23,42,0.45);">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px;">
              <h3 style="margin-bottom: 0; font-size: 1.1em; letter-spacing: 0.08em; text-transform: uppercase; color: #22d3ee;">Live AI Reasoning</h3>
              <span class="ai-chip">Thinking</span>
            </div>
            <div id="currentAnalysis" style="min-height: 240px; padding: 20px; background: rgba(15, 23, 42, 0.75); border-radius: 16px; border: 1px solid rgba(59,130,246,0.35);">
              <div style="color:#94a3b8; text-align:center;">Waiting for analysis...</div>
            </div>

            <div style="margin-top:20px;">
              <h4 style="margin-bottom:10px; letter-spacing:0.08em; font-size:0.8em; text-transform:uppercase; color:#38bdf8;">Session Stats</h4>
              <div class="history-card" id="recentHistory">
                <div class="history-item">
                  <span>Scans completed</span>
                  <span id="historyScans">0</span>
                </div>
                <div class="history-item">
                  <span>Signals delivered</span>
                  <span id="historySignals">0</span>
                </div>
                <div class="history-item">
                  <span>Mock data usage</span>
                  <span id="historyMock">0</span>
                </div>
                <div class="history-item">
                  <span>Skipped scans</span>
                  <span id="historySkipped">0</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <script>
        let analysisUpdateInterval = null;
        let scanInFlight = false;
        let progressPollInterval = null;
        const intervalLabels = {
          '10m': 'Every 10 minutes',
          '1h': 'Every 1 hour',
          '4h': 'Every 4 hours',
          '1d': 'Every 1 day',
          '1w': 'Every 1 week',
        };
        const patternLabels = {
          balanced: 'Balanced weighting',
          meanReversion: 'Favor RSI/Bollinger reversals',
          trendFollowing: 'Favor trend & momentum continuation',
          newsDriven: 'Prefer coins with fresh headlines',
          custom: 'Custom mix',
        };

        function formatIntervalLabel(key) {
          return intervalLabels[key] || key;
        }

        async function testTelegram() {
          try {
            const response = await fetch('/test-telegram', { method: 'POST' });
            const result = await response.json();
            alert(result.message);
          } catch (error) {
            alert('Error testing Telegram: ' + error.message);
          }
        }

        function renderAiInsightList(analysis) {
          if (!analysis || !analysis.details) return '';
          const items = analysis.details.slice(0, 3).map((item) => {
            return '<li><span class="ai-tag">' + item.label + '</span>' + item.value + '</li>';
          }).join('');
          return '<div class="ai-visual"><h4>🔎 Why the AI chose this</h4><ul class="ai-list">' + items + '</ul></div>';
        }

        function heatmapColor(score) {
          const numericScore = Number(score);
          if (score == null || !Number.isFinite(numericScore)) {
            return {
              background: 'rgba(148, 163, 184, 0.18)',
              border: 'rgba(148, 163, 184, 0.4)',
              text: '#0f172a',
            };
          }
          const clamped = Math.max(-2.5, Math.min(2.5, numericScore));
          const normalized = (clamped + 2.5) / 5; // 0..1
          const hue = normalized * 120;
          return {
            background: 'hsla(' + hue + ', 85%, 88%, 0.95)',
            border: 'hsla(' + hue + ', 75%, 55%, 0.7)',
            text: 'hsla(' + hue + ', 80%, 25%, 1)',
          };
        }

        function renderHeatmap(entries) {
          const grid = document.getElementById('heatmapGrid');
          if (!grid) return;
          if (!entries || entries.length === 0) {
            grid.innerHTML = '<div class="heatmap-empty">No heatmap data yet. Run a scan to populate insights.</div>';
            return;
          }
          const topEntries = entries.slice(0, 12);
          grid.innerHTML = topEntries.map((entry) => {
            const score = Number(entry.overallScore ?? 0);
            const styles = heatmapColor(score);
            const frames = entry.frames || {};
            const frameOrder = [
              { key: '10m', label: '10m' },
              { key: '1h', label: '1h' },
              { key: '4h', label: '4h' },
              { key: '1d', label: '1d' },
              { key: '1w', label: '1w' },
            ];
            const framesHtml = frameOrder.map(({ key, label }) => {
              const frame = frames[key] || {};
              const frameColor = heatmapColor(frame.score);
              return '<div class="heatmap-frame" style="background:' + frameColor.background + '; color:' + frameColor.text + ';">' + label + '</div>';
            }).join('');
            return '<div class="heatmap-cell" style="background:' + styles.background + '; border-color:' + styles.border + '; color:' + styles.text + ';">' +
              '<div class="heatmap-coin"><span>' + entry.symbol + '</span><span class="heatmap-score">' + score.toFixed(2) + '</span></div>' +
              '<div class="heatmap-frames">' + framesHtml + '</div>' +
              '</div>';
          }).join('');
        }

        function updateSentimentCard(sentiment) {
          const gauge = document.getElementById('sentimentGauge');
          const valueEl = document.getElementById('sentimentValue');
          const statusEl = document.getElementById('sentimentStatus');
          const metaEl = document.getElementById('sentimentMeta');
          if (!gauge || !valueEl || !statusEl || !metaEl) return;

          if (!sentiment || sentiment.value == null) {
            valueEl.textContent = '--';
            statusEl.textContent = 'No data';
            metaEl.textContent = 'Last updated: --';
            gauge.style.setProperty('--sentiment-angle', '180deg');
            return;
          }

          const value = Number(sentiment.value);
          valueEl.textContent = value.toFixed(0);
          statusEl.textContent = sentiment.classification || 'Neutral';
          const updatedAt = sentiment.timestamp ? new Date(sentiment.timestamp) : new Date();
          metaEl.textContent = 'Last updated: ' + updatedAt.toLocaleString();

          const angle = Math.min(Math.max((value / 100) * 360, 0), 360);
          gauge.style.setProperty('--sentiment-angle', angle + 'deg');
          const colorStyles = heatmapColor((value / 100) * 2 - 1);
          gauge.style.boxShadow = '0 12px 30px ' + colorStyles.border;
        }

        async function changeInterval(intervalKey) {
          try {
            const response = await fetch('/auto-scan-settings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ interval: intervalKey }),
            });
            const result = await response.json();
            if (!result.success) {
              throw new Error(result.message || 'Unknown error');
            }
            document.getElementById('nextScan').textContent = 'Next scan: ' + formatIntervalLabel(intervalKey);
          } catch (error) {
            alert('Unable to update interval: ' + error.message);
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
              document.getElementById('avgConf').textContent = data.stats.avgConfidence
                ? (data.stats.avgConfidence * 100).toFixed(0) + '%'
                : '0%';

              document.getElementById('historyScans').textContent = data.stats.totalScans || 0;
              document.getElementById('historySignals').textContent = data.stats.totalOpportunities || 0;
              document.getElementById('historyMock').textContent = data.stats.mockDataUsage || 0;
              document.getElementById('historySkipped').textContent = data.stats.skippedDueToOverlap || 0;

              const statusMeta = 'Telegram: ' + (data.telegramEnabled ? '✅ Enabled' : '⚠️ Disabled') +
                ' • News: ' + (data.newsEnabled ? '✅ Enabled' : '⚠️ Disabled') +
                ' • Pattern: ' + (patternLabels[data.stats.pattern || 'balanced'] || 'Balanced');
              document.getElementById('telemetryStatus').textContent = statusMeta;

              updateSentimentCard(data.stats.greedFear);
              renderHeatmap(data.stats.heatmap);

              const intervalKey = data.stats.selectedInterval || data.interval;
              if (intervalKey) {
                const select = document.getElementById('intervalSelect');
                if (select && select.value !== intervalKey) {
                  select.value = intervalKey;
                }
                const nextScanEl = document.getElementById('nextScan');
                if (nextScanEl) {
                  nextScanEl.textContent = 'Next scan: ' + (data.running ? formatIntervalLabel(intervalKey) : 'Manual mode');
                }
              }
            }
          } catch (error) {
            console.log('Error updating stats:', error);
          }
        }

        async function pollScanProgress() {
          try {
            const response = await fetch('/scan-progress');
            const progress = await response.json();
            const container = document.getElementById('scanProgressContainer');
            const fill = document.getElementById('scanProgressFill');
            const text = document.getElementById('scanProgressText');
            if (!container || !fill || !text) return;

            if (progress.running || scanInFlight) {
              container.style.display = 'block';
              const pct = typeof progress.percent === 'number' ? progress.percent : 0;
              fill.style.width = pct + '%';
              text.textContent = pct + '% (' + (progress.processed || 0) + '/' + (progress.total || 0) + ')';
              
              // Keep polling while running
              if (!progressPollInterval) {
                progressPollInterval = setInterval(pollScanProgress, 2000);
              }
            } else if (progress.percent === 100) {
              container.style.display = 'block';
              fill.style.width = '100%';
              text.textContent = '100% (' + progress.total + '/' + progress.total + ')';
              
              // Stop polling and hide after delay
              if (progressPollInterval) {
                clearInterval(progressPollInterval);
                progressPollInterval = null;
              }
              
              setTimeout(() => {
                container.style.display = 'none';
                fill.style.width = '0%';
              }, 3000);
            } else {
              container.style.display = 'none';
              fill.style.width = '0%';
              text.textContent = '0%';
              
              // Stop polling when not running
              if (progressPollInterval) {
                clearInterval(progressPollInterval);
                progressPollInterval = null;
              }
            }
          } catch (error) {
            console.log('Progress poll failed:', error);
          }
        }

        async function updateLiveAnalysis() {
          try {
            const response = await fetch('/live-analysis');
            const data = await response.json();
            const currentDiv = document.getElementById('currentAnalysis');
            if (data.currentlyAnalyzing) {
              const analysis = data.currentlyAnalyzing;
              const progress = analysis.progress || 0;

              const insightDetails = [
                {
                  label: 'Stage',
                  value: analysis.stage || 'Collecting data…'
                },
              ];

              if (analysis.technicals) {
                insightDetails.push({ label: 'Frames', value: analysis.technicals.frameSnapshot || '—' });
                if (analysis.technicals.momentum) {
                  insightDetails.push({ label: 'Momentum', value: analysis.technicals.momentum });
                }
              }

              if (analysis.result) {
                insightDetails.push({ label: 'AI Verdict', value: analysis.result.action + ' • ' + analysis.result.confidence });
                insightDetails.push({ label: 'Rationale', value: analysis.result.reason });
              }

              if (analysis.news && analysis.news.length > 0) {
                insightDetails.push({ label: 'News', value: analysis.news[0].title });
              }

              const insightList = insightDetails.map((item) => {
                return '<div style="margin-bottom:10px;"><div style="font-size:0.7em; letter-spacing:0.1em; text-transform:uppercase; color:#38bdf8;">' + item.label + '</div><div style="color:#e2e8f0;">' + item.value + '</div></div>';
              }).join('');

              currentDiv.innerHTML = '<div style="display:flex; flex-direction:column; gap:12px;">' +
                '<div style="display:flex; justify-content:space-between; align-items:center;"><div style="color:#38bdf8; font-weight:600;">' + (analysis.symbol || '') + ' • ' + (analysis.name || '') + '</div><div style="font-size:0.75em; color:#94a3b8;">' + new Date(analysis.timestamp || Date.now()).toLocaleTimeString() + '</div></div>' +
                '<div class="live-progress">' +
                  '<div style="display: flex; justify-content: space-between; align-items: center; color: #cbd5f5; font-size: 0.85em; text-transform:uppercase; letter-spacing:0.08em;">' +
                    '<span>Pipeline</span>' +
                    '<span>' + progress + '%</span>' +
                  '</div>' +
                  '<div class="progress-bar"><div class="progress-fill" style="width: ' + progress + '%"></div></div>' +
                '</div>' +
                '<div style="background: rgba(15,23,42,0.65); border-radius:14px; padding:16px; border:1px solid rgba(59,130,246,0.3);">' + insightList + '</div>' +
              '</div>';
            } else {
              currentDiv.innerHTML = '<div style="color: #94a3b8; text-align: center;">No active analysis</div>';
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
            const selectEl = document.getElementById('intervalSelect');
            const intervalKey = (selectEl && selectEl.value) || '1h';
            document.getElementById('nextScan').textContent = 'Next scan: ' + formatIntervalLabel(intervalKey);
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
            if (progressPollInterval) {
              clearInterval(progressPollInterval);
              progressPollInterval = null;
            }
            const container = document.getElementById('scanProgressContainer');
            const fill = document.getElementById('scanProgressFill');
            const text = document.getElementById('scanProgressText');
            if (container && fill && text) {
              container.style.display = 'none';
              fill.style.width = '0%';
              text.textContent = '0%';
            }
          } catch (error) {
            alert('Error stopping auto-scan: ' + error.message);
          }
        }

        async function manualScan() {
          try {
            document.getElementById('results').innerHTML = '<div class="no-opportunities"><div class="loading-spinner" style="width: 40px; height: 40px; border: 4px solid rgba(100, 116, 139, 0.2); border-top-color: #6366f1; border-radius: 999px; animation: spin 1s linear infinite; margin: 0 auto 20px;"></div><h3>🔍 Scanning...</h3></div>';
            if (analysisUpdateInterval) clearInterval(analysisUpdateInterval);
            analysisUpdateInterval = setInterval(updateLiveAnalysis, 2000);
            updateLiveAnalysis();
            scanInFlight = true;
            
            // Start progress polling
            if (!progressPollInterval) {
              progressPollInterval = setInterval(pollScanProgress, 2000);
            }
            pollScanProgress();

            const scanOptions = {
              minConfidence: (Number(document.getElementById('confidenceSlider').value) || 65) / 100,
              include: {
                buy: document.getElementById('filterBuy').checked,
                sell: document.getElementById('filterSell').checked,
                hold: document.getElementById('filterHold').checked,
              },
              indicators: {
                rsi: document.getElementById('useRSI').checked,
                bollinger: document.getElementById('useBollinger').checked,
                trend: document.getElementById('useTrend').checked,
                momentum: document.getElementById('useMomentum').checked,
                news: document.getElementById('useNews').checked,
              },
              pattern: document.getElementById('patternSelect').value,
            };

            const response = await fetch('/scan-now', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(scanOptions),
            });
            const data = await response.json();
            updateStats();
            if (data.greedFear) updateSentimentCard(data.greedFear);
            scanInFlight = false;
            
            // Stop polling after scan completes
            if (progressPollInterval) {
              clearInterval(progressPollInterval);
              progressPollInterval = null;
            }

            if (!data || !data.opportunities || data.opportunities.length === 0) {
              const msg = data.status === 'skipped'
                ? 'Previous scan still running, waiting for completion…'
                : \`Scanned \${data.analyzedCoins || 0} coins\`;
              document.getElementById('results').innerHTML = '<div class="no-opportunities"><h3>📭 No High-Confidence Opportunities</h3><p>' + msg + '</p></div>';
              return;
            }

            let html = '';
            data.opportunities.forEach((opp) => {
              const actionClass = opp.action.toLowerCase();
              const confidencePercent = (opp.confidence * 100).toFixed(0);
              const confidenceLevel =
                confidencePercent >= 75 ? 'high-confidence' :
                confidencePercent >= 60 ? 'medium-confidence' :
                'low-confidence';

              const daily = opp.indicators.daily;
              const hourly = opp.indicators.hourly;
              const frames = opp.indicators.frames || {};

              const timeframeOrder = [
                { key: '10m', label: '10 Min' },
                { key: '1h', label: '1 Hour' },
                { key: '4h', label: '4 Hour' },
                { key: '1d', label: '1 Day' },
                { key: '1w', label: '1 Week' },
              ];

              const timeframeCards = timeframeOrder.map(({ key, label }) => {
                const frame = frames[key] || {};
                const styles = heatmapColor(frame.score);
                return '<div class="timeframe-card" style="background:' + styles.background + '; border-color:' + styles.border + '; color:' + styles.text + ';">' +
                  '<h5>' + label + '</h5>' +
                  '<div class="metric"><strong>RSI:</strong> ' + (frame.rsi || 'N/A') + '</div>' +
                  '<div class="metric"><strong>Trend:</strong> ' + (frame.trend || 'N/A') + '</div>' +
                  '<div class="metric"><strong>Momentum:</strong> ' + (frame.momentum || 'N/A') + '</div>' +
                '</div>';
              }).join('');

              const aiInsights = [
                { label: 'Daily RSI', value: daily.rsi },
                { label: 'Hourly RSI', value: hourly.rsi },
                { label: 'Headline Momentum', value: opp.indicators.momentum },
                { label: 'Daily Trend', value: daily.trend },
                { label: 'Hourly Trend', value: hourly.trend },
                { label: 'Daily S/R', value: (daily.support || 'N/A') + ' / ' + (daily.resistance || 'N/A') },
              ];

              const aiList = aiInsights
                .map((item) => '<li><span class="ai-tag">' + item.label + '</span>' + item.value + '</li>')
                .join('');

              const newsItems = Array.isArray(opp.news) ? opp.news : [];
              const newsHtml = newsItems.length > 0
                ? '<div class="news-section"><h4>📰 Latest Headlines</h4><ul>' +
                  newsItems.map((article) => {
                    const published = article.publishedAt ? new Date(article.publishedAt).toLocaleString() : '';
                    return '<li><a href="' + article.url + '" target="_blank" rel="noopener noreferrer">' + article.title + '</a>' +
                      (article.source ? ' <em>(' + article.source + ')</em>' : '') +
                      (published ? '<div style="font-size:0.75em;color:#475569;margin-top:4px;">' + published + '</div>' : '') +
                      (article.description ? '<div style="font-size:0.85em;color:#475569;margin-top:4px;">' + article.description + '</div>' : '') +
                      '</li>';
                  }).join('') +
                  '</ul></div>'
                : '';

              html += '<div class="opportunity ' + actionClass + '">' +
                '<div class="coin-header">' +
                  '<div class="coin-name">' + opp.name + ' (' + opp.symbol + ')</div>' +
                  '<div class="' + actionClass + '-badge action-badge">' + opp.action + '</div>' +
                '</div>' +
                '<div class="price-confidence">' +
                  '<div class="price-box">' +
                    '<div class="value">' + opp.price + '</div>' +
                    '<div>Current Price</div>' +
                  '</div>' +
                  '<div class="confidence-box">' +
                    '<div class="value">' + confidencePercent + '%</div>' +
                    '<div>Confidence</div>' +
                  '</div>' +
                '</div>' +
                '<div class="confidence-bar"><div class="confidence-fill ' + confidenceLevel + '" style="width: ' + confidencePercent + '%"></div></div>' +
                '<div class="reason-box"><p>' + opp.reason + '</p></div>' +
                '<div class="timeframe-grid">' + timeframeCards + '</div>' +
                '<div class="ai-visual">' +
                  '<h4>🧠 DeepSeek Evaluation</h4>' +
                  '<ul class="ai-list">' + aiList + '</ul>' +
                '</div>' +
                '<div class="insights-list">' +
                  '<h4>💡 Key Insights</h4>' +
                  '<ul>' + opp.insights.map((i) => '<li>' + i + '</li>').join('') + '</ul>' +
                '</div>' +
                newsHtml +
              '</div>';
            });

            document.getElementById('results').innerHTML = html;
          } catch (error) {
            console.error('Scan error:', error);
            document.getElementById('results').innerHTML = '<div class="no-opportunities" style="color: #ef4444;"><h3>❌ Scan Failed</h3><p>Please try again</p></div>';
            scanInFlight = false;
            if (progressPollInterval) {
              clearInterval(progressPollInterval);
              progressPollInterval = null;
            }
          }
        }

        async function viewHistory() {
          try {
            const response = await fetch('/scan-history');
            const history = await response.json();
            if (!history || history.length === 0) {
              alert('No scan history available yet.');
              return;
            }
            const historyText = history.slice(0, 5).map((scan, index) =>
              \`Scan #\${index + 1}: \${new Date(scan.timestamp).toLocaleString()}\\n   - Opportunities: \${scan.opportunities}\n   - Duration: \${Math.round(scan.duration / 1000)}s\n   - Analyzed coins: \${scan.analyzed}\`
            ).join('\\n\\n');
            alert('Recent Scan History:\\n\\n' + historyText);
          } catch (error) {
            alert('Error loading history: ' + error.message);
          }
        }

        updateStats();
        manualScan();

        setInterval(updateStats, 20000);
        pollScanProgress();

        function updateConfidenceLabel(value) {
          document.getElementById('confidenceLabel').textContent = value;
        }
      </script>
    </body>
    </html>
  `);
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎯 Professional Crypto Scanner V2 running on port ${PORT}`);
  console.log('📊 Strategy: RSI + Bollinger + Support/Resistance + Momentum + AI overlay');
  console.log('⏰ Auto-scan: 1 HOUR intervals');
  console.log('🎯 Coins:', tradingBot.trackedCoins.length);
  console.log(`📱 Telegram: ${TELEGRAM_ENABLED ? 'ENABLED ✅' : 'DISABLED ⚠️'}`);
  console.log('🔔 Test Telegram: POST /test-telegram');
});

module.exports = app;
