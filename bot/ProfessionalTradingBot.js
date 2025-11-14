const axios = require('axios');
const config = require('../config/config');
const { sleep, getTop100Coins } = require('../utils/helpers');
const { 
  calculateRSI, 
  calculateBollingerBands, 
  identifyTrend, 
  calculateMomentum,
  getBollingerPosition,
  identifySupportResistance
} = require('./indicators');
const { 
  fetchEnhancedPriceData, 
  fetchHistoricalData,
  fetchGlobalMetrics: fetchGlobalMetricsService,
  ensureGreedFearIndex 
} = require('../services/dataFetcher');
const { 
  sendTelegramNotification,
  sendTestNotification 
} = require('../services/notificationService');
const { getAITechnicalAnalysis, getBatchAIAnalysis } = require('../services/aiService');
const { fetchCryptoNews } = require('../services/newsService');
const { detectTradingPatterns } = require('./patternDetection');
const {
  isExchangeTradingEnabled,
  executeTakeProfit,
  executeStopLoss,
  executeAddPosition
} = require('../services/exchangeService');
const { quickBacktest } = require('../services/backtestService');
const { loadTrades, saveTrades } = require('../services/tradePersistenceService');
const { loadPortfolio, recalculateFromTrades, getPortfolioStats } = require('../services/portfolioService');

// Helper function to add log entries (if available)
let addLogEntry = null;
try {
  const apiRoutes = require('../routes/api');
  addLogEntry = apiRoutes.addLogEntry;
} catch (e) {
  // Logging not available, use console fallback
  addLogEntry = (message, level = 'info') => {
    console.log(`[${level.toUpperCase()}] ${message}`);
  };
}

class ProfessionalTradingBot {
  constructor() {
    this.isRunning = false;
    this.scanTimer = null;
    this.scanInProgress = false;
    this.tradesUpdateTimer = null; // Separate timer for active trades updates

    this.trackedCoins = getTop100Coins();
    this.minConfidence = 0.65; // Will be synced with tradingRules.minConfidence

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
      coinmarketcapUsage: 0,
      coinpaprikaUsage: 0,
      aiCalls: 0,  // Track AI API calls
    };

    this.lastNotificationTime = {};
    this.selectedIntervalKey = '1h';
    this.scanIntervalMs = config.SCAN_INTERVAL_OPTIONS[this.selectedIntervalKey];
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
    this.priceCache = new Map();
    this.globalMetrics = {
      coinmarketcap: null,
      coinpaprika: null,
      lastUpdated: null
    };
    this.lastBatchAIResults = {
      results: {},
      timestamp: null,
      coinsAnalyzed: 0,
    };
    
    // Active trades management
    this.activeTrades = []; // Stores currently open or recently closed trades
    
    // Customizable trading rules
    this.tradingRules = {
      minConfidence: 0.65,
      enabledIndicators: {
        rsi: true,
        bollinger: true,
        supportResistance: true,
        fibonacci: true,
        momentum: true,
        trend: true
      },
      rsi: {
        oversold: 30,
        overbought: 70,
        neutralMin: 30,
        neutralMax: 70
      },
      bollinger: {
        lowerThreshold: 0.2,  // Position < 0.2 = lower band
        upperThreshold: 0.8   // Position > 0.8 = upper band
      },
      fibonacci: {
        enabled: true,
        supportLevels: [0.618, 0.786],  // 61.8% and 78.6%
        resistanceLevels: [0.236, 0.382] // 23.6% and 38.2%
      },
      supportResistance: {
        lookbackPeriod: 20,
        breakoutThreshold: 0.02  // 2% breakout
      },
      patterns: {
        buy: {
          enabled: true,
          requireRSIOversold: true,
          requireBollingerLower: false,
          requireSupportLevel: false,
          requireFibonacciSupport: false,
          requireBullishTrend: false,
          requirePattern: false,  // Require trading pattern (H&S, channels, etc.)
          minTimeframeAlignment: 2  // At least 2 timeframes must align
        },
        sell: {
          enabled: true,
          requireRSIOverbought: true,
          requireBollingerUpper: false,
          requireResistanceLevel: false,
          requireFibonacciResistance: false,
          requireBearishTrend: false,
          requirePattern: false,  // Require trading pattern
          minTimeframeAlignment: 2
        }
      },
      patternDetection: {
        enabled: true,
        parallelChannels: true,
        headAndShoulders: true,
        triangles: true,
        wedges: true,
        doubleTopBottom: true
      }
    };
    
    // Sync minConfidence
    this.minConfidence = this.tradingRules.minConfidence;
  }

  /**
   * Initialize bot: Load saved trades and portfolio state
   */
  async initialize() {
    try {
      console.log('🔄 Starting bot initialization...');
      
      // Load portfolio state
      await loadPortfolio();
      addLogEntry('Portfolio state loaded', 'success');
      console.log('✅ Portfolio state loaded');
      
      // Load saved trades
      console.log('📂 Attempting to load saved trades...');
      const savedTrades = await loadTrades();
      console.log(`📂 loadTrades() returned: ${savedTrades ? savedTrades.length : 0} trades`);
      
      if (savedTrades && savedTrades.length > 0) {
        this.activeTrades = savedTrades;
        console.log(`✅ Restored ${savedTrades.length} active trades from storage`);
        addLogEntry(`Restored ${savedTrades.length} active trades from storage`, 'success');
        
        // Log trade details
        savedTrades.forEach(trade => {
          console.log(`  - ${trade.symbol} (${trade.action}) - Entry: $${trade.entryPrice?.toFixed(2) || 'N/A'}, Status: ${trade.status}`);
        });
        
        // Immediately update trades with current prices (don't wait for timer)
        addLogEntry('Updating restored trades with current prices...', 'info');
        console.log('🔄 Updating restored trades with current prices...');
        await this.updateActiveTrades();
        addLogEntry('Trades updated with current market prices', 'success');
        console.log('✅ Trades updated with current market prices');
        
        // Recalculate portfolio metrics from restored trades
        await recalculateFromTrades(this.activeTrades);
        addLogEntry('Portfolio metrics recalculated from restored trades', 'info');
        console.log('✅ Portfolio metrics recalculated');
      } else {
        console.log('⚠️ No saved trades found or empty array returned');
        console.log(`   savedTrades value: ${JSON.stringify(savedTrades)}`);
        addLogEntry('No saved trades found, starting fresh', 'info');
      }
    } catch (error) {
      console.error('❌ Error initializing bot:', error);
      console.error('Error stack:', error.stack);
      addLogEntry(`Error initializing: ${error.message}`, 'error');
    }
  }

  setAutoScanInterval(key) {
    if (!config.SCAN_INTERVAL_OPTIONS[key]) {
      throw new Error(`Unsupported interval: ${key}`);
    }
    this.selectedIntervalKey = key;
    this.scanIntervalMs = config.SCAN_INTERVAL_OPTIONS[key];
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
    return await ensureGreedFearIndex(this.greedFearIndex);
  }

  async fetchGlobalMetrics() {
    const result = await fetchGlobalMetricsService(
      this.globalMetrics, 
      this.stats,
      config.COINMARKETCAP_ENABLED,
      config.COINMARKETCAP_API_KEY
    );
    this.globalMetrics = result;
    return result;
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

  // Start separate timer for active trades updates (every 1 minute)
  // This runs COMPLETELY INDEPENDENTLY of the scanner - starts when bot initializes
  startTradesUpdateTimer() {
    // Clear any existing timer
    if (this.tradesUpdateTimer) {
      clearInterval(this.tradesUpdateTimer);
    }

    // Update immediately on start
    this.updateActiveTrades().catch(err => {
      console.log(`⚠️ Initial trades update failed: ${err.message}`);
    });

    // Then update every 1 minute - runs independently of scans
    this.tradesUpdateTimer = setInterval(async () => {
      if (this.activeTrades.length > 0) {
        await this.updateActiveTrades();
      }
    }, 60000); // 1 minute

    console.log('⏰ Active trades update timer started (1min interval, independent of scans)');
  }

  // Stop the trades update timer (manual stop only - not called automatically)
  stopTradesUpdateTimer() {
    if (this.tradesUpdateTimer) {
      clearInterval(this.tradesUpdateTimer);
      this.tradesUpdateTimer = null;
      console.log('⏰ Active trades update timer stopped');
    }
  }

  // Main technical scan method
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
      // First, update any existing active trades
      await this.updateActiveTrades();
      
      // Fetch global metrics at the start of each scan
      await this.ensureGreedFearIndex();
      await this.fetchGlobalMetrics();
      
      console.log(`\n🎯 TECHNICAL SCAN STARTED: ${new Date().toLocaleString()}`);
      console.log(`🌐 Global Metrics: CoinPaprika ${this.globalMetrics.coinpaprika ? '✅' : '❌'}, CoinMarketCap ${this.globalMetrics.coinmarketcap ? '✅' : '❌'}`);
      
      addLogEntry('Technical scan started', 'info');
      addLogEntry(`Scanning ${this.trackedCoins.length} coins`, 'info');
      addLogEntry(`Analysis engine: JavaScript`, 'info');

      const opportunities = [];
      let analyzedCount = 0;
      let mockDataUsed = 0;
      const heatmapEntries = [];
      const allCoinsData = []; // Collect all coin data for batch AI
      const analysisResults = new Map(); // Store analysis results to avoid re-computation

      // Step 1: Collect all coin technical data
      console.log('📊 Step 1: Collecting technical data for all coins...');
      addLogEntry('Step 1: Collecting technical data for all coins...', 'info');
      for (const coin of this.trackedCoins) {
        try {
          const analysis = await this.analyzeWithTechnicalIndicators(coin, { 
            options,
            globalMetrics: this.globalMetrics 
          });
          analyzedCount += 1;

          // Store analysis result
          analysisResults.set(coin.symbol, analysis);

          if (analysis.usesMockData) {
            mockDataUsed += 1;
          }

          if (analysis.heatmapEntry) {
            heatmapEntries.push(analysis.heatmapEntry);
          }

          // Collect data for batch AI
          // Check if we have valid frame data
          const hasFrames = analysis.frames && typeof analysis.frames === 'object';
          const frameCount = hasFrames ? Object.keys(analysis.frames).length : 0;
          
          console.log(`🔍 ${coin.symbol} analysis check:`, {
            hasFrames: !!hasFrames,
            frameCount: frameCount,
            usesMockData: analysis.usesMockData,
            dataSource: analysis.dataSource,
            confidence: analysis.confidence
          });
          
          if (hasFrames && frameCount > 0) {
            const priceValue = typeof analysis.price === 'string' 
              ? parseFloat(analysis.price.replace('$', '').replace(/,/g, '')) 
              : analysis.price || currentPrice;
            
            allCoinsData.push({
              symbol: coin.symbol,
              name: coin.name,
              currentPrice: priceValue,
              frames: analysis.frames,
              dataSource: analysis.dataSource || 'CoinGecko',
            });
            console.log(`✅ Collected data for AI: ${coin.symbol} (${frameCount} timeframes, price: $${priceValue})`);
          } else {
            console.log(`⏭️ Skipping ${coin.symbol} for AI - reason:`, !hasFrames ? 'no frames object' : frameCount === 0 ? 'empty frames' : 'unknown');
          }

          this.scanProgress.processed += 1;
          this.scanProgress.percent = Math.min(
            Math.round((this.scanProgress.processed / this.trackedCoins.length) * 60), // 60% for data collection
            60,
          );
        } catch (error) {
          console.log(`❌ ${coin.symbol}: Data collection failed - ${error.message}`);
          this.stats.apiErrors += 1;
          this.scanProgress.processed += 1;
        }

        await sleep(config.API_DELAY);
      }

      // Step 2a: Fetch news for all coins before AI analysis
      if (allCoinsData.length > 0) {
        console.log('📰 Fetching news for coins...');
        addLogEntry('Fetching recent news for analysis...', 'info');
        const newsPromises = allCoinsData.map(async (coin, index) => {
          // Add small delay to avoid rate limits
          await sleep(index * 200); // 200ms between requests
          try {
            const news = await fetchCryptoNews(coin.symbol, 5);
            coin.news = news;
            return news;
          } catch (error) {
            console.log(`⚠️ News fetch failed for ${coin.symbol}: ${error.message}`);
            coin.news = { articles: [], total: 0 };
            return null;
          }
        });
        await Promise.all(newsPromises);
        const newsCount = allCoinsData.filter(c => c.news && c.news.articles && c.news.articles.length > 0).length;
        console.log(`✅ Fetched news for ${newsCount}/${allCoinsData.length} coins`);
      }
      
      // Step 2: Send all data to AI at once (batch analysis)
      console.log(`\n${'='.repeat(60)}`);
      console.log(`🤖 Step 2: AI BATCH ANALYSIS`);
      console.log(`${'='.repeat(60)}`);
      console.log(`📊 Analyzed ${analyzedCount} coins total`);
      console.log(`📊 Collected ${allCoinsData.length} coins with valid frame data for AI`);
      if (allCoinsData.length > 0) {
        const newsCount = allCoinsData.filter(c => c.news && c.news.articles && c.news.articles.length > 0).length;
        console.log(`📰 News fetched for ${newsCount} coins`);
      }
      console.log(`🔑 AI API Key configured: ${config.AI_API_KEY ? 'YES' : 'NO'}`);
      console.log(`🤖 AI Model: ${config.AI_MODEL}`);
      if (allCoinsData.length > 0) {
        console.log(`📋 Coins ready for AI: ${allCoinsData.map(c => c.symbol).join(', ')}`);
      }
      console.log(`${'='.repeat(60)}\n`);
      
      addLogEntry(`Step 2: AI batch analysis - ${allCoinsData.length} coins ready`, 'info');
      
      // Update progress to 70% for AI analysis
      this.scanProgress.percent = 70;
      this.scanProgress.stage = 'AI Analysis';
      
      this.currentlyAnalyzing = {
        symbol: 'BATCH',
        name: 'Batch AI Analysis',
        stage: `Analyzing ${allCoinsData.length} coins with AI...`,
        timestamp: new Date(),
        progress: 70,
      };
      this.updateLiveAnalysis();

      let batchAIResults = {};
      if (allCoinsData.length > 0 && config.AI_API_KEY) {
        try {
          console.log(`🤖 Calling AI API with ${allCoinsData.length} coins...`);
          console.log(`🔑 AI API Key present: ${config.AI_API_KEY ? 'YES' : 'NO'}`);
          console.log(`📊 Coins to analyze: ${allCoinsData.map(c => c.symbol).join(', ')}`);
          
          addLogEntry(`Calling AI API with ${allCoinsData.length} coins...`, 'info');
          
          // Update progress during AI call
          this.scanProgress.percent = 75;
          
          batchAIResults = await getBatchAIAnalysis(allCoinsData, this.globalMetrics, options);
          this.stats.aiCalls += 1; // Track AI API call
          console.log(`✅ Batch AI analysis completed for ${Object.keys(batchAIResults).length} coins`);
          console.log(`📊 AI API calls this session: ${this.stats.aiCalls}`);
          
          addLogEntry(`AI analysis completed for ${Object.keys(batchAIResults).length} coins`, 'success');
          
          this.currentlyAnalyzing.stage = `AI evaluation complete - ${Object.keys(batchAIResults).length} coins analyzed`;
          this.currentlyAnalyzing.progress = 85;
          this.scanProgress.percent = 85;
        } catch (error) {
          console.log(`⚠️ Batch AI failed: ${error.message}`);
          console.error('Full AI error:', error);
          console.error('Error stack:', error.stack);
          
          addLogEntry(`AI analysis failed: ${error.message}`, 'error');
          
          this.currentlyAnalyzing.stage = `AI analysis failed, using fallback`;
          this.scanProgress.percent = 80; // Still update progress even on error
        }
      } else {
        if (!config.AI_API_KEY) {
          console.log('⚠️ Skipping AI analysis - API_KEY not configured');
          console.log(`   Check environment variable: AI_API_KEY`);
          addLogEntry('Skipping AI analysis - API key not configured', 'warning');
        } else if (allCoinsData.length === 0) {
          console.log(`⚠️ Skipping AI analysis - no valid coin data collected`);
          console.log(`   Analyzed ${analyzedCount} coins, but none had frame data`);
          console.log(`   Check if coins are using mock data or if data collection is failing`);
          addLogEntry('Skipping AI analysis - no valid coin data', 'warning');
        }
        this.scanProgress.percent = 80; // Update progress even if skipping
      }

      // Step 3: Merge AI results with stored technical analysis
      console.log('🔄 Step 3: Merging AI results with technical analysis...');
      addLogEntry('Step 3: Merging AI results with technical analysis...', 'info');
      this.scanProgress.percent = 90;
      this.scanProgress.stage = 'Merging Results';
      for (const coin of this.trackedCoins) {
        try {
          const analysis = analysisResults.get(coin.symbol);
          if (!analysis) continue;

          // Merge AI results if available
          if (batchAIResults[coin.symbol]) {
            const aiResult = batchAIResults[coin.symbol];
            analysis.action = aiResult.action;
            analysis.confidence = aiResult.confidence;
            analysis.reason = aiResult.reason;
            analysis.insights = aiResult.insights;
            analysis.signal = aiResult.signal;
            analysis.aiEvaluated = aiResult.aiEvaluated || false;
            
            // Add risk management fields from AI
            if (aiResult.entryPrice) analysis.entryPrice = aiResult.entryPrice;
            if (aiResult.takeProfit) analysis.takeProfit = aiResult.takeProfit;
            if (aiResult.stopLoss) analysis.stopLoss = aiResult.stopLoss;
            if (aiResult.addPosition) analysis.addPosition = aiResult.addPosition;
            if (aiResult.expectedGainPercent) analysis.expectedGainPercent = aiResult.expectedGainPercent;
            
            // If AI didn't provide risk management, calculate it
            if (!aiResult.entryPrice || !aiResult.takeProfit || !aiResult.stopLoss) {
              const riskLevels = this.calculateRiskManagement(analysis);
              analysis.entryPrice = riskLevels.entryPrice;
              analysis.takeProfit = riskLevels.takeProfit;
              analysis.stopLoss = riskLevels.stopLoss;
              analysis.addPosition = riskLevels.addPosition;
              analysis.expectedGainPercent = riskLevels.expectedGainPercent;
            }
          }

          console.log(`🔍 ${coin.symbol}: ${analysis.action} (${(analysis.confidence * 100).toFixed(0)}%) - AI: ${analysis.aiEvaluated ? '✅' : '❌'}`);

          // Only add real opportunities with valid data
          if (analysis.confidence >= this.tradingRules.minConfidence && !analysis.usesMockData) {
            if (!this.applyScanFilters(analysis, options)) {
              console.log(`🚫 ${coin.symbol}: Filtered out by scan filters`);
              continue;
            }
            // Apply custom trading rules
            if (!this.matchesTradingRules(analysis)) {
              console.log(`🚫 ${coin.symbol}: Does not match custom trading rules`);
              continue;
            }
            
            // Run backtest on this opportunity
            try {
              addLogEntry(`Running backtest for ${coin.symbol}...`, 'info');
              const backtestResult = await quickBacktest(coin, {
                action: analysis.action,
                entryPrice: analysis.entryPrice,
                takeProfit: analysis.takeProfit,
                stopLoss: analysis.stopLoss
              });
              
              if (backtestResult.success) {
                analysis.backtest = {
                  winRate: backtestResult.winRate,
                  totalTrades: backtestResult.totalTrades,
                  avgReturn: backtestResult.avgReturn,
                  profitFactor: backtestResult.profitFactor,
                  maxDrawdown: backtestResult.maxDrawdown,
                  dataPoints: backtestResult.dataPoints
                };
                
                // Filter by profit factor: Only accept trades with profit factor > 1.5 OR win rate > 50%
                const minProfitFactor = 1.5;
                const minWinRate = 50;
                const isProfitable = backtestResult.profitFactor > minProfitFactor || backtestResult.winRate > minWinRate;
                
                if (!isProfitable) {
                  console.log(`🚫 ${coin.symbol}: Filtered out - Profit Factor: ${backtestResult.profitFactor.toFixed(2)}, Win Rate: ${backtestResult.winRate.toFixed(1)}%`);
                  addLogEntry(`🚫 ${coin.symbol}: Filtered (PF: ${backtestResult.profitFactor.toFixed(2)}, WR: ${backtestResult.winRate.toFixed(1)}%)`, 'warning');
                  continue; // Skip this opportunity
                }
                
                addLogEntry(`✅ ${coin.symbol}: Backtest complete - ${backtestResult.winRate.toFixed(1)}% win rate, PF: ${backtestResult.profitFactor.toFixed(2)} (${backtestResult.totalTrades} trades)`, 'success');
          } else {
                analysis.backtest = {
                  error: backtestResult.error || 'Backtest failed',
                  dataPoints: backtestResult.dataPoints || 0
                };
                addLogEntry(`⚠️ ${coin.symbol}: Backtest failed - ${backtestResult.error}`, 'warning');
              }
            } catch (backtestError) {
              console.log(`⚠️ ${coin.symbol}: Backtest error - ${backtestError.message}`);
              analysis.backtest = {
                error: backtestError.message
              };
            }
            
            opportunities.push(analysis);
            console.log(`✅ ${coin.symbol}: ${analysis.action} (${(analysis.confidence * 100).toFixed(0)}% confidence) - ADDED TO OPPORTUNITIES`);
            addLogEntry(`${coin.symbol}: ${analysis.action} signal detected (${(analysis.confidence * 100).toFixed(0)}% confidence)`, 'success');
          }
        } catch (error) {
          console.log(`❌ ${coin.symbol}: Merge failed - ${error.message}`);
          addLogEntry(`${coin.symbol}: Merge failed - ${error.message}`, 'error');
        }
      }

      this.scanProgress.percent = 100;
      addLogEntry(`Scan complete: ${opportunities.length} opportunities found`, opportunities.length > 0 ? 'success' : 'info');

      // Store batch AI results for UI display
      this.lastBatchAIResults = {
        results: batchAIResults,
        timestamp: new Date(),
        coinsAnalyzed: allCoinsData.length,
      };

      this.currentlyAnalyzing = null;
      this.updateLiveAnalysis();

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

      if (config.TELEGRAM_ENABLED && opportunities.length > 0) {
        console.log(`📱 Sending Telegram notifications for ${opportunities.length} opportunities...`);
        for (const opp of opportunities) {
          const allowMock = config.ALLOW_MOCK_NOTIFICATIONS;
          if (opp.usesMockData && !allowMock) {
            console.log(`⏭️ Skipping Telegram for ${opp.symbol} (mock data). Set ALLOW_MOCK_NOTIFICATIONS=true to send anyway.`);
            continue;
          }
          await sendTelegramNotification(
            opp,
            this.lastNotificationTime,
            this.stats,
            this.greedFearIndex,
            this.globalMetrics,
            { force: allowMock }
          );
          // Add the opportunity as an active trade if it's a BUY/SELL signal
          if (opp.action === 'BUY' || opp.action === 'SELL') {
            await this.addActiveTrade(opp);
          }
          await sleep(1500);
        }
      }

      this.analysisHistory.unshift({
        timestamp: new Date(),
        opportunities: opportunities.length,
        details: opportunities,
        duration: this.stats.lastScanDuration,
        analyzed: analyzedCount,
        globalMetrics: this.globalMetrics,
      });

      if (this.analysisHistory.length > 288) {
        this.analysisHistory = this.analysisHistory.slice(0, 288);
      }

      console.log(`\n📈 SCAN COMPLETE: ${opportunities.length} opportunities found`);
      console.log(`📊 API Usage: CoinGecko (primary), CoinPaprika: ${this.stats.coinpaprikaUsage}, CoinMarketCap: ${this.stats.coinmarketcapUsage}`);
      
      // Re-evaluate open trades with AI
      await this.reevaluateOpenTradesWithAI();
      
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
        globalMetrics: this.globalMetrics,
        apiUsage: {
          coinpaprika: this.stats.coinpaprikaUsage,
          coinmarketcap: this.stats.coinmarketcapUsage,
        },
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
        globalMetrics: this.globalMetrics,
      };
    }
  }

  // Individual coin analysis
  async analyzeWithTechnicalIndicators(coin, context = {}) {
    // This method would be implemented similarly to the original
    // but using the imported service functions
    // For brevity, showing the structure
    
    const scanOptions = context.options || {};
    const globalMetrics = context.globalMetrics || {};

    try {
      this.currentlyAnalyzing = {
        symbol: coin.symbol,
        name: coin.name,
        stage: 'Fetching enhanced price data…',
        timestamp: new Date(),
        progress: 10,
      };
      this.updateLiveAnalysis();

      // Get enhanced price data using service
      const priceResult = await fetchEnhancedPriceData(coin, this.priceCache, this.stats, config);
      const usesMockData = priceResult.usedMock;
      const dataSource = priceResult.data.source;
      const currentPrice = priceResult.data.price;

      // Fetch historical data for pattern detection
      this.currentlyAnalyzing.stage = 'Fetching historical data...';
      this.currentlyAnalyzing.progress = 30;
      this.updateLiveAnalysis();

      const historicalData = await fetchHistoricalData(coin.id, coin, this.stats, config);
      const { dailyData, hourlyData, minuteData, usedMock: historicalMock } = historicalData;

      // Detect trading patterns (if enabled)
      let patterns = [];
      let hourlyPatterns = [];
      
      if (this.tradingRules.patternDetection && this.tradingRules.patternDetection.enabled) {
        this.currentlyAnalyzing.stage = 'Detecting trading patterns...';
        this.currentlyAnalyzing.progress = 50;
        this.updateLiveAnalysis();

        // Detect all patterns once, then filter based on enabled types
        const allDailyPatterns = detectTradingPatterns(dailyData || []);
        const allHourlyPatterns = detectTradingPatterns(hourlyData || []);
        
        // Filter daily patterns based on enabled types
        if (this.tradingRules.patternDetection.parallelChannels) {
          patterns.push(...allDailyPatterns.filter(p => p.pattern === 'PARALLEL_CHANNEL'));
        }
        if (this.tradingRules.patternDetection.headAndShoulders) {
          patterns.push(...allDailyPatterns.filter(p => p.pattern.includes('HEAD_AND_SHOULDERS')));
        }
        if (this.tradingRules.patternDetection.triangles) {
          patterns.push(...allDailyPatterns.filter(p => p.pattern === 'TRIANGLE'));
        }
        if (this.tradingRules.patternDetection.wedges) {
          patterns.push(...allDailyPatterns.filter(p => p.pattern === 'WEDGE'));
        }
        if (this.tradingRules.patternDetection.doubleTopBottom) {
          patterns.push(...allDailyPatterns.filter(p => p.pattern.includes('DOUBLE')));
        }
        
        // Add hourly patterns (all types if pattern detection is enabled)
        hourlyPatterns = allHourlyPatterns;
      }

      // Combine patterns from different timeframes
      const allPatterns = [...patterns, ...hourlyPatterns];

      // Calculate technical indicators for all timeframes
      const frames = this.prepareTimeframeSeries(minuteData || [], hourlyData || [], dailyData || []);
      
      // Calculate indicators for each timeframe (format expected by AI)
      const framesWithIndicators = {};
      for (const [timeframe, series] of Object.entries(frames)) {
        if (series && series.length > 0) {
          // Extract close prices (TradingView RSI uses close prices)
          const prices = series.map(s => {
            // Handle different data formats
            if (typeof s === 'number') return s;
            if (s.price) return s.price;
            if (s.close) return s.close;
            return s;
          }).filter(p => p && !isNaN(p) && p > 0);
          
          if (prices.length < 15) {
            // Need at least 15 data points for RSI(14)
            framesWithIndicators[timeframe] = {
              rsi: 'N/A',
              bollingerPosition: 'MIDDLE',
              trend: 'SIDEWAYS',
              momentum: 'NEUTRAL',
              price: prices[prices.length - 1] || 0,
              support: prices.length > 0 ? Math.min(...prices) : 0,
              resistance: prices.length > 0 ? Math.max(...prices) : 0,
              series: series
            };
            continue;
          }
          
          // Calculate RSI using Wilder's method (matches TradingView standard)
          // Ensure we have enough data points (RSI(14) needs at least 15 prices)
          const rsi = prices.length >= 15 ? calculateRSI(prices, 14) : null;
          const bollinger = calculateBollingerBands(prices, 20, 2);
          const trend = identifyTrend(prices);
          const momentum = calculateMomentum(prices);
          
          // Calculate Bollinger position
          const currentPrice = prices[prices.length - 1];
          const bbPosition = bollinger ? 
            ((currentPrice - bollinger.lower) / (bollinger.upper - bollinger.lower) * 100) : null;
          const bollingerPosition = bbPosition < 20 ? 'LOWER' : bbPosition > 80 ? 'UPPER' : 'MIDDLE';
          
          framesWithIndicators[timeframe] = {
            rsi: (rsi !== null && rsi !== undefined) ? Number(rsi).toFixed(2) : 'N/A',
            bollingerPosition: bollingerPosition,
            trend: trend,
            momentum: momentum,
            price: currentPrice,
            support: Math.min(...prices.slice(-20)), // Support from last 20 periods
            resistance: Math.max(...prices.slice(-20)), // Resistance from last 20 periods
            series: series,
            dataPoints: prices.length // For debugging
          };
        }
      }
      
      // Build analysis result with patterns
      const analysis = {
        symbol: coin.symbol,
        name: coin.name,
        id: coin.id, // Store coin ID for price fetching
        coinmarketcap_id: coin.coinmarketcap_id,
        coinpaprika_id: coin.coinpaprika_id,
        action: 'HOLD',
        price: `$${currentPrice.toFixed(2)}`,
        confidence: 0.5,
        signal: 'HOLD | Technical Analysis',
        reason: 'Analysis completed',
        insights: [],
        timestamp: new Date(),
        usesMockData: usesMockData || historicalMock,
        dataSource: dataSource,
        patterns: allPatterns,
        frames: framesWithIndicators, // Add frames at top level for AI
        indicators: {
          frames: framesWithIndicators,
          daily: framesWithIndicators['1d'] || {},
          hourly: framesWithIndicators['1h'] || {},
          momentum: framesWithIndicators['1h']?.momentum || 'NEUTRAL'
        },
        heatmapEntry: null
      };

      // Add pattern insights and adjust confidence based on patterns
      if (allPatterns.length > 0) {
        allPatterns.forEach(pattern => {
          analysis.insights.push(`${pattern.pattern.replace(/_/g, ' ')} detected (${pattern.type}) - ${pattern.signal} signal`);
          
          // Boost confidence if pattern matches signal
          if (pattern.signal === 'BULLISH' && analysis.action === 'BUY') {
            analysis.confidence = Math.min(0.95, analysis.confidence + (pattern.confidence * 0.2));
          } else if (pattern.signal === 'BEARISH' && analysis.action === 'SELL') {
            analysis.confidence = Math.min(0.95, analysis.confidence + (pattern.confidence * 0.2));
          }
        });
        
        // If pattern detection is required, check if we have matching patterns
        if (this.tradingRules.patterns.buy.requirePattern && analysis.action === 'BUY') {
          const bullishPatterns = allPatterns.filter(p => p.signal === 'BULLISH');
          if (bullishPatterns.length === 0) {
            analysis.confidence = 0.3; // Lower confidence if pattern required but not found
          }
        }
        
        if (this.tradingRules.patterns.sell.requirePattern && analysis.action === 'SELL') {
          const bearishPatterns = allPatterns.filter(p => p.signal === 'BEARISH');
          if (bearishPatterns.length === 0) {
            analysis.confidence = 0.3; // Lower confidence if pattern required but not found
          }
        }
      }

      return analysis;
      
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

      return this.basicTechnicalAnalysis(coin, true);
    }
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

  getBatchAIResults() {
    return this.lastBatchAIResults || {
      results: {},
      timestamp: null,
      coinsAnalyzed: 0,
    };
  }

  getStats() {
    return {
      ...this.stats,
      running: this.isRunning,
      minConfidence: this.minConfidence,
      trackedCoins: this.trackedCoins.length,
      telegramEnabled: config.TELEGRAM_ENABLED,
      newsEnabled: config.NEWS_ENABLED,
      coinmarketcapEnabled: config.COINMARKETCAP_ENABLED,
      coinpaprikaEnabled: config.COINPAPRIKA_ENABLED,
      selectedInterval: this.selectedIntervalKey,
      scanProgress: this.getScanProgress(),
      greedFear: this.greedFearIndex,
      heatmap: this.latestHeatmap,
      globalMetrics: this.globalMetrics,
      apiUsage: {
        coinpaprika: this.stats.coinpaprikaUsage,
        coinmarketcap: this.stats.coinmarketcapUsage,
      },
    };
  }

  getScanHistory() {
    return this.analysisHistory.slice(0, 10);
  }

  // New method: Add a new opportunity as an active trade
  async addActiveTrade(opportunity) {
    if (opportunity.action === 'HOLD') {
      addLogEntry(`Attempted to add HOLD signal for ${opportunity.symbol} as active trade, skipping.`, 'warning');
      return;
    }

    // Check if trade already exists for this symbol (prevent duplicates)
    const existingTrade = this.activeTrades.find(t => 
      t.symbol === opportunity.symbol && 
      t.action === opportunity.action && 
      (t.status === 'OPEN' || t.status === 'DCA_HIT')
    );
    
    if (existingTrade) {
      addLogEntry(`Trade already exists for ${opportunity.symbol} (${opportunity.action}). Skipping duplicate.`, 'info');
      return;
    }

    const tradeId = `${opportunity.symbol}-${Date.now()}`; // Unique ID for the trade
    
    // Parse prices correctly (handle both string and number formats)
    const parsePrice = (price) => {
      if (typeof price === 'number') return price;
      if (typeof price === 'string') {
        return parseFloat(price.replace(/[^0-9.]/g, '')) || 0;
      }
      return 0;
    };
    
    const currentPrice = parsePrice(opportunity.price);
    const entryPrice = parsePrice(opportunity.entryPrice) || currentPrice;
    const takeProfit = parsePrice(opportunity.takeProfit) || currentPrice * 1.05;
    const stopLoss = parsePrice(opportunity.stopLoss) || currentPrice * 0.95;
    const addPosition = parsePrice(opportunity.addPosition) || currentPrice;
    
    // Calculate initial quantity based on position size from portfolio service
    const { calculateQuantity } = require('../services/exchangeService');
    const { getPositionSize, recordTrade } = require('../services/portfolioService');
    const positionSizeUSD = getPositionSize(); // $100 USD per position
    const initialQuantity = calculateQuantity(opportunity.symbol, entryPrice, positionSizeUSD);
    
    // Store coin data for proper price fetching
    const coinData = {
      symbol: opportunity.symbol,
      name: opportunity.name,
      id: opportunity.id || opportunity.name?.toLowerCase(),
      coinmarketcap_id: opportunity.coinmarketcap_id,
      coinpaprika_id: opportunity.coinpaprika_id
    };
    
    const newTrade = {
      tradeId: tradeId,
      symbol: opportunity.symbol,
      name: opportunity.name,
      action: opportunity.action,
      entryPrice: entryPrice,
      takeProfit: takeProfit,
      stopLoss: stopLoss,
      addPosition: addPosition,
      expectedGainPercent: opportunity.expectedGainPercent || 5,
      entryTime: new Date(),
      status: 'OPEN', // OPEN, TP_HIT, SL_HIT, DCA_HIT, CLOSED (manually)
      currentPrice: currentPrice,
      quantity: initialQuantity, // Track position size
      pnl: 0,
      pnlPercent: 0,
      insights: opportunity.insights || [],
      reason: opportunity.reason || '',
      dataSource: opportunity.dataSource || 'unknown',
      coinData: coinData, // Store full coin data for price fetching
      coinId: coinData.id,
      coinmarketcap_id: coinData.coinmarketcap_id,
      coinpaprika_id: coinData.coinpaprika_id
    };

    this.activeTrades.push(newTrade);
    
    // Record trade in portfolio
    await recordTrade(newTrade);
    
    // Save trades to disk
    await saveTrades(this.activeTrades);
    
    addLogEntry(`NEW TRADE: ${newTrade.action} ${newTrade.symbol} at $${newTrade.entryPrice.toFixed(2)} (TP: $${newTrade.takeProfit.toFixed(2)}, SL: $${newTrade.stopLoss.toFixed(2)})`, 'success');
    // TODO: Send Telegram notification for new trade opened
  }

  // New method: Update existing active trades
  async updateActiveTrades() {
    if (this.activeTrades.length === 0) {
      return;
    }

    addLogEntry(`Updating ${this.activeTrades.length} active trades...`, 'info');

    for (let i = 0; i < this.activeTrades.length; i++) {
      const trade = this.activeTrades[i];

      // Only update OPEN or DCA_HIT trades (DCA_HIT trades are still active)
      if (trade.status !== 'OPEN' && trade.status !== 'DCA_HIT') {
        continue;
      }

      try {
        // Fetch latest price for the trade's coin - use stored coin data if available
        const coinData = trade.coinData || { 
          symbol: trade.symbol, 
          name: trade.name,
          id: trade.coinId,
          coinmarketcap_id: trade.coinmarketcap_id,
          coinpaprika_id: trade.coinpaprika_id
        };
        const priceResult = await fetchEnhancedPriceData(coinData, this.priceCache, this.stats, config);
        
        // Handle different price formats
        let currentPrice = 0;
        if (priceResult && priceResult.data) {
          const priceValue = priceResult.data.price;
          if (typeof priceValue === 'number') {
            currentPrice = priceValue;
          } else if (typeof priceValue === 'string') {
            currentPrice = parseFloat(priceValue.replace(/[^0-9.]/g, '')) || 0;
          }
        }
        
        // Coin-specific price validation (prevent wrong coin data)
        const getPriceRange = (symbol) => {
          const ranges = {
            'BTC': { min: 1000, max: 200000 },
            'ETH': { min: 100, max: 10000 },
            'BNB': { min: 10, max: 2000 },
            'SOL': { min: 1, max: 500 },
            'XRP': { min: 0.01, max: 10 },
            'DOGE': { min: 0.001, max: 1 },
            'ADA': { min: 0.01, max: 10 },
            'AVAX': { min: 1, max: 200 },
            'LINK': { min: 1, max: 100 },
            'DOT': { min: 0.1, max: 100 }
          };
          return ranges[symbol] || { min: 0.0001, max: 1000000 };
        };
        
        const priceRange = getPriceRange(trade.symbol);
        if (currentPrice < priceRange.min || currentPrice > priceRange.max) {
          addLogEntry(`⚠️ ${trade.symbol}: Invalid price for coin ($${currentPrice.toFixed(2)}), expected range $${priceRange.min}-$${priceRange.max}. Using last known price $${trade.currentPrice.toFixed(2)}`, 'warning');
          continue; // Skip this trade update
        }
        
        // If price fetch failed, use last known price and skip update
        if (!currentPrice || currentPrice === 0) {
          addLogEntry(`⚠️ ${trade.symbol}: Price fetch failed, using last known price $${trade.currentPrice.toFixed(2)}`, 'warning');
          continue; // Skip this trade update but don't mark as error
        }
        
        // Additional validation: price shouldn't change by more than 30% in one update (likely wrong coin)
        if (trade.currentPrice && trade.currentPrice > 0) {
          const priceChangePercent = Math.abs((currentPrice - trade.currentPrice) / trade.currentPrice) * 100;
          if (priceChangePercent > 30) {
            addLogEntry(`⚠️ ${trade.symbol}: Suspicious price change (${priceChangePercent.toFixed(1)}%), using last known price $${trade.currentPrice.toFixed(2)}`, 'warning');
            continue; // Skip this update
          }
        }
        
        trade.currentPrice = currentPrice;

        // Calculate P&L based on position size (USD)
        // Position size is $100, so quantity = $100 / entryPrice
        const positionSizeUSD = 100; // $100 per position
        const quantity = trade.quantity || (positionSizeUSD / trade.entryPrice);
        
        if (trade.action === 'BUY') {
          // For BUY: (currentPrice - entryPrice) * quantity = USD gain/loss
          const priceDiff = currentPrice - trade.entryPrice;
          trade.pnl = priceDiff * quantity; // USD P&L
          trade.pnlPercent = ((priceDiff / trade.entryPrice) * 100).toFixed(2);
        } else if (trade.action === 'SELL') { // Short position
          // For SELL (short): (entryPrice - currentPrice) * quantity = USD gain/loss
          const priceDiff = trade.entryPrice - currentPrice;
          trade.pnl = priceDiff * quantity; // USD P&L
          trade.pnlPercent = ((priceDiff / trade.entryPrice) * 100).toFixed(2);
        }

        let notificationNeeded = false;
        let notificationMessage = '';
        let notificationLevel = 'info';

        if (trade.action === 'BUY') {
          // Check Take Profit for BUY
          if (currentPrice >= trade.takeProfit && trade.status === 'OPEN') {
            // Execute Take Profit order
            const tpResult = await executeTakeProfit(trade);
            if (tpResult.success) {
              trade.status = 'TP_HIT';
              trade.executedAt = new Date();
              trade.executionPrice = tpResult.price || currentPrice;
              trade.executionOrderId = tpResult.orderId;
              notificationMessage = `✅ TAKE PROFIT EXECUTED: ${trade.symbol} sold ${tpResult.executedQty} at $${trade.executionPrice.toFixed(2)} (Profit: ${trade.pnlPercent}%)`;
              notificationLevel = 'success';
              notificationNeeded = true;
              addLogEntry(`✅ TP EXECUTED: ${trade.symbol} - Order ID: ${tpResult.orderId}`, 'success');
            } else if (!tpResult.skipped) {
              // Only log if it's an actual error (not just disabled)
              trade.status = 'TP_HIT'; // Mark as hit even if execution failed
              notificationMessage = `✅ TAKE PROFIT HIT (Execution ${tpResult.error ? 'failed' : 'skipped'}): ${trade.symbol} at $${currentPrice.toFixed(2)} (Profit: ${trade.pnlPercent}%)`;
              notificationLevel = 'success';
              notificationNeeded = true;
              addLogEntry(`⚠️ TP hit but execution failed: ${trade.symbol} - ${tpResult.error}`, 'warning');
            }
          }
          // Check Stop Loss for BUY
          else if (currentPrice <= trade.stopLoss && trade.status === 'OPEN') {
            // Execute Stop Loss order
            const slResult = await executeStopLoss(trade);
            if (slResult.success) {
              trade.status = 'SL_HIT';
              trade.executedAt = new Date();
              trade.executionPrice = slResult.price || currentPrice;
              trade.executionOrderId = slResult.orderId;
              notificationMessage = `❌ STOP LOSS EXECUTED: ${trade.symbol} sold ${slResult.executedQty} at $${trade.executionPrice.toFixed(2)} (Loss: ${trade.pnlPercent}%)`;
              notificationLevel = 'error';
              notificationNeeded = true;
              addLogEntry(`🛑 SL EXECUTED: ${trade.symbol} - Order ID: ${slResult.orderId}`, 'error');
            } else if (!slResult.skipped) {
              trade.status = 'SL_HIT';
              notificationMessage = `❌ STOP LOSS HIT (Execution ${slResult.error ? 'failed' : 'skipped'}): ${trade.symbol} at $${currentPrice.toFixed(2)} (Loss: ${trade.pnlPercent}%)`;
              notificationLevel = 'error';
              notificationNeeded = true;
              addLogEntry(`⚠️ SL hit but execution failed: ${trade.symbol} - ${slResult.error}`, 'error');
            }
          }
          // Check Add Position for BUY
          else if (currentPrice <= trade.addPosition && trade.addPosition < trade.entryPrice && !trade.dcaNotified) {
            // Execute Add Position (DCA) order
            const dcaResult = await executeAddPosition(trade);
            if (dcaResult.success) {
              trade.status = 'DCA_HIT';
              trade.dcaExecutedAt = new Date();
              trade.dcaExecutionPrice = dcaResult.price || currentPrice;
              trade.dcaOrderId = dcaResult.orderId;
              trade.dcaQuantity = dcaResult.executedQty;
              // Update average entry price (weighted average)
              const totalQuantity = (trade.quantity || 1) + dcaResult.executedQty;
              trade.entryPrice = ((trade.entryPrice * (trade.quantity || 1)) + (dcaResult.price * dcaResult.executedQty)) / totalQuantity;
              trade.quantity = totalQuantity;
              notificationMessage = `💰 ADD POSITION EXECUTED: ${trade.symbol} bought ${dcaResult.executedQty} at $${dcaResult.price.toFixed(2)}. New avg entry: $${trade.entryPrice.toFixed(2)}`;
              notificationLevel = 'warning';
              notificationNeeded = true;
              trade.dcaNotified = true;
              addLogEntry(`💰 DCA EXECUTED: ${trade.symbol} - Order ID: ${dcaResult.orderId}`, 'info');
            } else if (!dcaResult.skipped) {
              trade.status = 'DCA_HIT';
              notificationMessage = `💰 ADD POSITION (Execution ${dcaResult.error ? 'failed' : 'skipped'}): ${trade.symbol} at $${currentPrice.toFixed(2)}. Consider averaging down.`;
              notificationLevel = 'warning';
              notificationNeeded = true;
              trade.dcaNotified = true;
              addLogEntry(`⚠️ DCA hit but execution failed: ${trade.symbol} - ${dcaResult.error}`, 'warning');
            }
          }
          // Reset DCA_HIT back to OPEN if price moves away from DCA level
          else if (trade.status === 'DCA_HIT' && currentPrice > trade.addPosition) {
            trade.status = 'OPEN';
            trade.dcaNotified = false; // Reset so it can trigger again if price drops back
          }
        } else if (trade.action === 'SELL') { // Short position logic
          // Check Take Profit for SELL (price drops)
          if (currentPrice <= trade.takeProfit && trade.status === 'OPEN') {
            // Execute Take Profit order (cover short)
            const tpResult = await executeTakeProfit(trade);
            if (tpResult.success) {
              trade.status = 'TP_HIT';
              trade.executedAt = new Date();
              trade.executionPrice = tpResult.price || currentPrice;
              trade.executionOrderId = tpResult.orderId;
              notificationMessage = `✅ TAKE PROFIT EXECUTED (SHORT): ${trade.symbol} covered ${tpResult.executedQty} at $${trade.executionPrice.toFixed(2)} (Profit: ${trade.pnlPercent}%)`;
              notificationLevel = 'success';
              notificationNeeded = true;
              addLogEntry(`✅ TP EXECUTED (SHORT): ${trade.symbol} - Order ID: ${tpResult.orderId}`, 'success');
            } else if (!tpResult.skipped) {
              trade.status = 'TP_HIT';
              notificationMessage = `✅ TAKE PROFIT HIT (SHORT, Execution ${tpResult.error ? 'failed' : 'skipped'}): ${trade.symbol} at $${currentPrice.toFixed(2)} (Profit: ${trade.pnlPercent}%)`;
              notificationLevel = 'success';
              notificationNeeded = true;
              addLogEntry(`⚠️ TP hit but execution failed (SHORT): ${trade.symbol} - ${tpResult.error}`, 'warning');
            }
          }
          // Check Stop Loss for SELL (price rises)
          else if (currentPrice >= trade.stopLoss && trade.status === 'OPEN') {
            // Execute Stop Loss order (cover short)
            const slResult = await executeStopLoss(trade);
            if (slResult.success) {
              trade.status = 'SL_HIT';
              trade.executedAt = new Date();
              trade.executionPrice = slResult.price || currentPrice;
              trade.executionOrderId = slResult.orderId;
              notificationMessage = `❌ STOP LOSS EXECUTED (SHORT): ${trade.symbol} covered ${slResult.executedQty} at $${trade.executionPrice.toFixed(2)} (Loss: ${trade.pnlPercent}%)`;
              notificationLevel = 'error';
              notificationNeeded = true;
              addLogEntry(`🛑 SL EXECUTED (SHORT): ${trade.symbol} - Order ID: ${slResult.orderId}`, 'error');
            } else if (!slResult.skipped) {
              trade.status = 'SL_HIT';
              notificationMessage = `❌ STOP LOSS HIT (SHORT, Execution ${slResult.error ? 'failed' : 'skipped'}): ${trade.symbol} at $${currentPrice.toFixed(2)} (Loss: ${trade.pnlPercent}%)`;
              notificationLevel = 'error';
              notificationNeeded = true;
              addLogEntry(`⚠️ SL hit but execution failed (SHORT): ${trade.symbol} - ${slResult.error}`, 'error');
            }
          }
          // Check Add Position for SELL (price rises)
          else if (currentPrice >= trade.addPosition && trade.addPosition > trade.entryPrice && !trade.dcaNotified) {
            // Execute Add Position (DCA) order (short more)
            const dcaResult = await executeAddPosition(trade);
            if (dcaResult.success) {
              trade.status = 'DCA_HIT';
              trade.dcaExecutedAt = new Date();
              trade.dcaExecutionPrice = dcaResult.price || currentPrice;
              trade.dcaOrderId = dcaResult.orderId;
              trade.dcaQuantity = dcaResult.executedQty;
              // Update average entry price (weighted average for short)
              const totalQuantity = (trade.quantity || 1) + dcaResult.executedQty;
              trade.entryPrice = ((trade.entryPrice * (trade.quantity || 1)) + (dcaResult.price * dcaResult.executedQty)) / totalQuantity;
              trade.quantity = totalQuantity;
              notificationMessage = `💰 ADD POSITION EXECUTED (SHORT): ${trade.symbol} shorted ${dcaResult.executedQty} more at $${dcaResult.price.toFixed(2)}. New avg entry: $${trade.entryPrice.toFixed(2)}`;
              notificationLevel = 'warning';
              notificationNeeded = true;
              trade.dcaNotified = true;
              addLogEntry(`💰 DCA EXECUTED (SHORT): ${trade.symbol} - Order ID: ${dcaResult.orderId}`, 'info');
            } else if (!dcaResult.skipped) {
              trade.status = 'DCA_HIT';
              notificationMessage = `💰 ADD POSITION (SHORT, Execution ${dcaResult.error ? 'failed' : 'skipped'}): ${trade.symbol} at $${currentPrice.toFixed(2)}. Consider averaging up.`;
              notificationLevel = 'warning';
              notificationNeeded = true;
              trade.dcaNotified = true;
              addLogEntry(`⚠️ DCA hit but execution failed (SHORT): ${trade.symbol} - ${dcaResult.error}`, 'warning');
            }
          }
          // Reset DCA_HIT back to OPEN if price moves away from DCA level (for SELL)
          else if (trade.status === 'DCA_HIT' && currentPrice < trade.addPosition) {
            trade.status = 'OPEN';
            trade.dcaNotified = false; // Reset so it can trigger again if price rises back
          }
        }

        addLogEntry(`${trade.symbol}: Current Price $${currentPrice.toFixed(2)}, P&L: ${trade.pnlPercent}% (Status: ${trade.status})`, 'info');

        if (notificationNeeded) {
          addLogEntry(notificationMessage, notificationLevel);
          // TODO: Send Telegram notification for status change
        }

      } catch (error) {
        addLogEntry(`⚠️ Failed to update trade for ${trade.symbol}: ${error.message}. Will retry on next scan.`, 'warning');
        // Don't mark as ERROR - just skip this update and retry next scan
        // This handles temporary API failures gracefully
      }
    }
    
    // Save trades to disk after updates
    await saveTrades(this.activeTrades);
    
    // Recalculate portfolio metrics from updated trades
    await recalculateFromTrades(this.activeTrades);
  }

  // Re-evaluate open trades with AI during scan
  async reevaluateOpenTradesWithAI() {
    const openTrades = this.activeTrades.filter(t => t.status === 'OPEN' || t.status === 'DCA_HIT');
    
    if (openTrades.length === 0 || !config.AI_API_KEY) {
      return;
    }

    addLogEntry(`🤖 Re-evaluating ${openTrades.length} open trades with AI...`, 'info');

    try {
      // Prepare trade data for AI analysis
      const tradesForAI = await Promise.all(openTrades.map(async (trade) => {
        const coinData = trade.coinData || {
          symbol: trade.symbol,
          name: trade.name,
          id: trade.coinId,
          coinmarketcap_id: trade.coinmarketcap_id,
          coinpaprika_id: trade.coinpaprika_id
        };

        // Fetch current price and data
        const priceResult = await fetchEnhancedPriceData(coinData, this.priceCache, this.stats, config);
        const currentPrice = priceResult?.data?.price || trade.currentPrice;

        // Fetch historical data for analysis
        const historicalData = await fetchHistoricalData(coinData, this.priceCache, this.stats, config);
        
        return {
          symbol: trade.symbol,
          name: trade.name,
          currentPrice: currentPrice,
          entryPrice: trade.entryPrice,
          takeProfit: trade.takeProfit,
          stopLoss: trade.stopLoss,
          action: trade.action,
          pnl: trade.pnl,
          pnlPercent: trade.pnlPercent,
          status: trade.status,
          historicalData: historicalData
        };
      }));

      // Fetch news for each trade (with timeout protection)
      const tradesWithNews = await Promise.all(tradesForAI.map(async (trade) => {
        try {
          // Add timeout wrapper to prevent hanging
          const newsPromise = fetchCryptoNews(trade.symbol, 3);
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('News fetch timeout')), 5000)
          );
          const news = await Promise.race([newsPromise, timeoutPromise]);
          return { ...trade, news };
        } catch (error) {
          // Silently fail - news is optional
          return { ...trade, news: { articles: [], total: 0 } };
        }
      }));

      // Create AI prompt for trade re-evaluation
      const prompt = `You are a professional crypto trading analyst. Re-evaluate these ${tradesWithNews.length} open trades and provide your recommendation for each.
IMPORTANT: Consider both technical analysis AND recent news sentiment when making recommendations.

${tradesWithNews.map((t, i) => {
  let newsText = '';
  if (t.news && t.news.articles && t.news.articles.length > 0) {
    const newsItems = t.news.articles.slice(0, 3).map(n => `    - ${n.title} (${n.source})`).join('\n');
    newsText = `\n- Recent News:\n${newsItems}`;
  } else {
    newsText = '\n- Recent News: No significant news found';
  }
  
  // Safely handle pnlPercent - might be undefined or not a number
  const pnlPercent = typeof t.pnlPercent === 'number' ? t.pnlPercent : 0;
  const pnlText = `${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%`;
  
  return `
Trade ${i + 1}: ${t.symbol} (${t.name})
- Action: ${t.action}
- Entry Price: $${t.entryPrice.toFixed(2)}
- Current Price: $${t.currentPrice.toFixed(2)}
- Take Profit: $${t.takeProfit.toFixed(2)}
- Stop Loss: $${t.stopLoss.toFixed(2)}
- Current P&L: ${pnlText}
- Status: ${t.status}${newsText}
`;
}).join('\n')}

For each trade, provide:
1. Recommendation: HOLD, CLOSE, or ADJUST
2. Confidence: 0.0 to 1.0
3. Reason: Brief explanation

Return JSON array format:
[
  {
    "symbol": "BTC",
    "recommendation": "HOLD",
    "confidence": 0.75,
    "reason": "Price approaching take profit, momentum still strong"
  }
]`;

      // Call AI API directly
      const axios = require('axios');
      const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
        model: config.AI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1000,
        temperature: 0.1,
      }, {
        headers: {
          Authorization: `Bearer ${config.AI_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://my-deepseek-bot-1.onrender.com',
          'X-Title': 'Technical Analysis Bot',
        },
        timeout: 30000,
      });

      // Parse AI response
      const aiContent = response.data.choices[0].message.content;
      const jsonMatch = aiContent.match(/\[[\s\S]*\]/);
      
      if (jsonMatch) {
        const recommendations = JSON.parse(jsonMatch[0]);
        
        // Build Telegram message
        let telegramMessage = `🤖 *AI Trade Re-evaluation*\n\n`;
        telegramMessage += `📊 *${openTrades.length} Open Trade${openTrades.length > 1 ? 's' : ''} Analyzed*\n\n`;
        
        recommendations.forEach((rec, index) => {
          const symbol = rec.symbol;
          const recommendation = rec.recommendation || 'HOLD';
          const confidence = (rec.confidence || 0) * 100;
          const reason = rec.reason || 'No reason provided';
          
          // Find the corresponding trade
          const trade = openTrades.find(t => t.symbol === symbol);
          const pnlPercent = trade && typeof trade.pnlPercent === 'number' ? trade.pnlPercent : 0;
          const pnl = trade ? `${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%` : 'N/A';
          
          // Add to log
          addLogEntry(
            `📊 ${symbol} AI Re-evaluation: ${recommendation} (${confidence.toFixed(0)}%) - ${reason}`,
            recommendation === 'CLOSE' ? 'warning' : 'info'
          );
          
          // Add to Telegram message
          const emoji = recommendation === 'CLOSE' ? '🔴' : recommendation === 'ADJUST' ? '🟡' : '🟢';
          telegramMessage += `${emoji} *${symbol}* - ${recommendation}\n`;
          telegramMessage += `   P&L: ${pnl} | Confidence: ${confidence.toFixed(0)}%\n`;
          telegramMessage += `   ${reason}\n\n`;
        });
        
        // Send to Telegram
        try {
          await sendTelegramNotification(telegramMessage);
          addLogEntry('✅ AI re-evaluation sent to Telegram', 'success');
        } catch (telegramError) {
          addLogEntry(`⚠️ Failed to send re-evaluation to Telegram: ${telegramError.message}`, 'warning');
        }
        
        return recommendations;
      }
    } catch (error) {
      addLogEntry(`⚠️ AI re-evaluation failed: ${error.message}`, 'warning');
      throw error;
    }
  }

  // New method: Get active trades
  getActiveTrades() {
    return this.activeTrades.filter(trade => trade.status === 'OPEN' || trade.status === 'DCA_HIT'); // Only show open or DCA triggered trades in dashboard
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

  basicTechnicalAnalysis(coin, usesMockData = false) {
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
      usesMockData,
      news: [],
      frames: {}, // Add top-level frames property (empty but defined)
      patterns: [], // Add empty patterns array
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

  // Proxy methods to services
  async sendTelegramNotification(opportunity, options = {}) {
    return await sendTelegramNotification(opportunity, this.lastNotificationTime, this.stats, this.greedFearIndex, this.globalMetrics, options);
  }

  async sendTestNotification() {
    return await sendTestNotification(config);
  }

  getTradingRules() {
    return {
      ...this.tradingRules,
      confidenceThreshold: (this.tradingRules.minConfidence * 100).toFixed(0) + '%',
      patterns: {
        buy: {
          ...this.tradingRules.patterns.buy,
          description: this.getBuyPatternsDescription()
        },
        sell: {
          ...this.tradingRules.patterns.sell,
          description: this.getSellPatternsDescription()
        },
        hold: [
          'RSI between ' + this.tradingRules.rsi.neutralMin + '-' + this.tradingRules.rsi.neutralMax + ' (neutral zone)',
          'No clear trend direction',
          'Price consolidating between support/resistance',
          'Confidence below threshold',
          'Mixed signals across timeframes'
        ]
      },
      indicators: {
        rsi: {
          oversold: '< ' + this.tradingRules.rsi.oversold,
          neutral: this.tradingRules.rsi.neutralMin + '-' + this.tradingRules.rsi.neutralMax,
          overbought: '> ' + this.tradingRules.rsi.overbought
        },
        bollinger: {
          lower: 'Price near lower band (position < ' + (this.tradingRules.bollinger.lowerThreshold * 100) + '%)',
          middle: 'Price in middle (neutral)',
          upper: 'Price near upper band (position > ' + (this.tradingRules.bollinger.upperThreshold * 100) + '%)'
        },
        fibonacci: {
          levels: ['23.6%', '38.2%', '50.0%', '61.8%', '78.6%'],
          support: this.tradingRules.fibonacci.supportLevels.map(l => (l * 100).toFixed(1) + '%').join(' and ') + ' are key support levels',
          resistance: this.tradingRules.fibonacci.resistanceLevels.map(l => (l * 100).toFixed(1) + '%').join(' and ') + ' are key resistance levels'
        },
        supportResistance: {
          support: 'Lowest price in recent ' + this.tradingRules.supportResistance.lookbackPeriod + ' periods',
          resistance: 'Highest price in recent ' + this.tradingRules.supportResistance.lookbackPeriod + ' periods',
          breakout: 'Price breaking above resistance (bullish) or below support (bearish)'
        }
      },
      timeframes: ['10m', '1h', '4h', '1d', '1w'],
      cooldown: '30 minutes between notifications for same coin'
    };
  }

  getBuyPatternsDescription() {
    const patterns = [];
    if (this.tradingRules.patterns.buy.requireRSIOversold) {
      patterns.push(`RSI < ${this.tradingRules.rsi.oversold} (oversold)`);
    }
    if (this.tradingRules.patterns.buy.requireBollingerLower) {
      patterns.push('Bollinger Lower Band');
    }
    if (this.tradingRules.patterns.buy.requireSupportLevel) {
      patterns.push('Price at Support Level');
    }
    if (this.tradingRules.patterns.buy.requireFibonacciSupport) {
      patterns.push('Fibonacci Support Level');
    }
    if (this.tradingRules.patterns.buy.requireBullishTrend) {
      patterns.push('Bullish Trend');
    }
    if (this.tradingRules.patterns.buy.requirePattern) {
      patterns.push('Trading Pattern Required (Channels, H&S, etc.)');
    }
    if (this.tradingRules.patterns.buy.minTimeframeAlignment > 1) {
      patterns.push(`${this.tradingRules.patterns.buy.minTimeframeAlignment}+ timeframes aligned`);
    }
    return patterns.length > 0 ? patterns : ['Default buy patterns'];
  }

  getSellPatternsDescription() {
    const patterns = [];
    if (this.tradingRules.patterns.sell.requireRSIOverbought) {
      patterns.push(`RSI > ${this.tradingRules.rsi.overbought} (overbought)`);
    }
    if (this.tradingRules.patterns.sell.requireBollingerUpper) {
      patterns.push('Bollinger Upper Band');
    }
    if (this.tradingRules.patterns.sell.requireResistanceLevel) {
      patterns.push('Price at Resistance Level');
    }
    if (this.tradingRules.patterns.sell.requireFibonacciResistance) {
      patterns.push('Fibonacci Resistance Level');
    }
    if (this.tradingRules.patterns.sell.requireBearishTrend) {
      patterns.push('Bearish Trend');
    }
    if (this.tradingRules.patterns.sell.requirePattern) {
      patterns.push('Trading Pattern Required (Channels, H&S, etc.)');
    }
    if (this.tradingRules.patterns.sell.minTimeframeAlignment > 1) {
      patterns.push(`${this.tradingRules.patterns.sell.minTimeframeAlignment}+ timeframes aligned`);
    }
    return patterns.length > 0 ? patterns : ['Default sell patterns'];
  }

  setTradingRules(newRules) {
    // Merge new rules with existing, keeping defaults for missing values
    if (newRules.minConfidence !== undefined) {
      this.tradingRules.minConfidence = Math.max(0.1, Math.min(0.99, newRules.minConfidence));
    }
    if (newRules.enabledIndicators) {
      this.tradingRules.enabledIndicators = { ...this.tradingRules.enabledIndicators, ...newRules.enabledIndicators };
    }
    if (newRules.rsi) {
      this.tradingRules.rsi = { ...this.tradingRules.rsi, ...newRules.rsi };
    }
    if (newRules.bollinger) {
      this.tradingRules.bollinger = { ...this.tradingRules.bollinger, ...newRules.bollinger };
    }
    if (newRules.fibonacci) {
      this.tradingRules.fibonacci = { ...this.tradingRules.fibonacci, ...newRules.fibonacci };
    }
    if (newRules.supportResistance) {
      this.tradingRules.supportResistance = { ...this.tradingRules.supportResistance, ...newRules.supportResistance };
    }
    if (newRules.patterns) {
      if (newRules.patterns.buy) {
        this.tradingRules.patterns.buy = { ...this.tradingRules.patterns.buy, ...newRules.patterns.buy };
      }
      if (newRules.patterns.sell) {
        this.tradingRules.patterns.sell = { ...this.tradingRules.patterns.sell, ...newRules.patterns.sell };
      }
    }
    if (newRules.patternDetection) {
      this.tradingRules.patternDetection = { ...this.tradingRules.patternDetection, ...newRules.patternDetection };
    }
    // Update minConfidence reference
    this.minConfidence = this.tradingRules.minConfidence;
    return this.tradingRules;
  }

  calculateRiskManagement(analysis) {
    const currentPrice = Number(analysis.price.replace(/[^0-9.]/g, '')) || 0;
    const indicators = analysis.indicators || {};
    const frames = indicators.frames || {};
    const action = analysis.action;
    
    // Get support and resistance levels
    const support = Number(indicators.daily?.support) || currentPrice * 0.95;
    const resistance = Number(indicators.daily?.resistance) || currentPrice * 1.05;
    
    // Calculate volatility-based stops (ATR-like)
    const volatility = currentPrice * 0.05; // 5% default volatility
    
    let entryPrice, takeProfit, stopLoss, addPosition, expectedGainPercent;
    
    if (action === 'BUY') {
      // BUY signal - Improved risk/reward ratio (target 3:1 or better)
      entryPrice = currentPrice;
      stopLoss = Math.max(support * 0.98, currentPrice * 0.97); // 2-3% below (tighter stop)
      // Target 3:1 risk/reward: if stop is 3%, take profit should be 9%+
      const riskPercent = ((entryPrice - stopLoss) / entryPrice) * 100;
      const targetReward = riskPercent * 3; // 3:1 risk/reward
      takeProfit = Math.min(resistance * 1.02, currentPrice * (1 + targetReward / 100)); // 9-12% above
      addPosition = currentPrice * 0.98; // 2% below for DCA
      expectedGainPercent = ((takeProfit - entryPrice) / entryPrice * 100).toFixed(2);
      
    } else if (action === 'SELL') {
      // SELL signal - Improved risk/reward ratio (target 3:1 or better)
      entryPrice = currentPrice;
      stopLoss = Math.min(resistance * 1.02, currentPrice * 1.03); // 2-3% above (tighter stop)
      // Target 3:1 risk/reward: if stop is 3%, take profit should be 9%+
      const riskPercent = ((stopLoss - entryPrice) / entryPrice) * 100;
      const targetReward = riskPercent * 3; // 3:1 risk/reward
      takeProfit = Math.max(support * 0.98, currentPrice * (1 - targetReward / 100)); // 9-12% below
      addPosition = currentPrice * 1.02; // 2% above for averaging
      expectedGainPercent = ((entryPrice - takeProfit) / entryPrice * 100).toFixed(2);
      
    } else {
      // HOLD or unknown
      entryPrice = currentPrice;
      takeProfit = currentPrice * 1.05;
      stopLoss = currentPrice * 0.95;
      addPosition = currentPrice;
      expectedGainPercent = 5;
    }
    
    return {
      entryPrice: Number(entryPrice.toFixed(2)),
      takeProfit: Number(takeProfit.toFixed(2)),
      stopLoss: Number(stopLoss.toFixed(2)),
      addPosition: Number(addPosition.toFixed(2)),
      expectedGainPercent: Number(expectedGainPercent)
    };
  }

  matchesTradingRules(analysis) {
    const rules = this.tradingRules;
    const indicators = analysis.indicators || {};
    const frames = indicators.frames || {};
    
    // Filter out HOLD signals - we only want actionable BUY/SELL opportunities
    if (analysis.action === 'HOLD') {
      return false;
    }
    
    // Check if action type is enabled
    if (analysis.action === 'BUY' && !rules.patterns.buy.enabled) return false;
    if (analysis.action === 'SELL' && !rules.patterns.sell.enabled) return false;
    
    if (analysis.action === 'BUY') {
      const buyRules = rules.patterns.buy;
      let matches = 0;
      
      // Check RSI requirement
      if (buyRules.requireRSIOversold) {
        const dailyRSI = Number(indicators.daily?.rsi) || 50;
        if (dailyRSI < rules.rsi.oversold) matches++;
      }
      
      // Check Bollinger requirement
      if (buyRules.requireBollingerLower) {
        if (indicators.daily?.bollingerPosition === 'LOWER') matches++;
      }
      
      // Check support level
      if (buyRules.requireSupportLevel) {
        // Would need price comparison logic here
        matches++; // Placeholder
      }
      
      // Check Fibonacci
      if (buyRules.requireFibonacciSupport) {
        // Would need Fibonacci position check
        matches++; // Placeholder
      }
      
      // Check trend alignment
      if (buyRules.requireBullishTrend) {
        const bullishFrames = Object.values(frames).filter(f => f.trend === 'BULLISH').length;
        if (bullishFrames >= buyRules.minTimeframeAlignment) matches++;
      }
      
      // Check pattern requirement
      if (buyRules.requirePattern) {
        const bullishPatterns = (analysis.patterns || []).filter(p => p.signal === 'BULLISH');
        if (bullishPatterns.length > 0) matches++;
      }
      
      // If no specific requirements, allow through
      if (!buyRules.requireRSIOversold && !buyRules.requireBollingerLower && 
          !buyRules.requireSupportLevel && !buyRules.requireFibonacciSupport && 
          !buyRules.requireBullishTrend && !buyRules.requirePattern) {
        return true;
      }
      
      // Require at least one match if any requirements are set
      return matches > 0;
    }
    
    if (analysis.action === 'SELL') {
      const sellRules = rules.patterns.sell;
      let matches = 0;
      
      if (sellRules.requireRSIOverbought) {
        const dailyRSI = Number(indicators.daily?.rsi) || 50;
        if (dailyRSI > rules.rsi.overbought) matches++;
      }
      
      if (sellRules.requireBollingerUpper) {
        if (indicators.daily?.bollingerPosition === 'UPPER') matches++;
      }
      
      if (sellRules.requireResistanceLevel) {
        matches++; // Placeholder
      }
      
      if (sellRules.requireFibonacciResistance) {
        matches++; // Placeholder
      }
      
      if (sellRules.requireBearishTrend) {
        const bearishFrames = Object.values(frames).filter(f => f.trend === 'BEARISH').length;
        if (bearishFrames >= sellRules.minTimeframeAlignment) matches++;
      }
      
      // Check pattern requirement
      if (sellRules.requirePattern) {
        const bearishPatterns = (analysis.patterns || []).filter(p => p.signal === 'BEARISH');
        if (bearishPatterns.length > 0) matches++;
      }
      
      if (!sellRules.requireRSIOverbought && !sellRules.requireBollingerUpper && 
          !sellRules.requireResistanceLevel && !sellRules.requireFibonacciResistance && 
          !sellRules.requireBearishTrend && !sellRules.requirePattern) {
        return true;
      }
      
      return matches > 0;
    }
    
    return true; // HOLD always passes
  }
}

module.exports = ProfessionalTradingBot;
