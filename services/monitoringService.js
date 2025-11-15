const axios = require('axios');
const config = require('../config/config');
const { sendTelegramMessage } = require('./notificationService');
const { storeAIEvaluation } = require('./dataStorageService');
const bulkIndicatorService = require('./bulkIndicatorService');

/**
 * Two-Tier AI Monitoring System
 * 
 * Supports both Gemini API (Google) and OpenRouter API
 * 
 * Tier 1 (Free): Gemini Flash OR DeepSeek v3 - Continuous monitoring every minute
 * Tier 2 (Premium): Gemini Pro OR DeepSeek R1 - Confirmation and final decisions
 * 
 * Flow:
 * 1. Free model monitors prices/volatility every minute
 * 2. If opportunity detected with high confidence → escalate to premium model
 * 3. Premium model confirms or rejects
 * 4. Send Telegram notification on escalation
 * 5. Store all evaluations for learning
 */

class MonitoringService {
  constructor() {
    this.lastPrices = new Map(); // Track price changes
    this.escalationHistory = []; // Track escalations
    this.isMonitoring = false;
    // Cache for rejected ideas to avoid re-escalating (saves costs)
    this.rejectedIdeasCache = new Map(); // key: symbol, value: { timestamp, reason }
    this.REJECTION_CACHE_DURATION = 4 * 60 * 60 * 1000; // 4 hours
    
    // Cooldown cache - prevent re-escalation for 30 minutes after ANY escalation (confirmed or rejected)
    this.escalationCooldownCache = new Map(); // key: symbol, value: { timestamp, decision }
    this.ESCALATION_COOLDOWN_DURATION = 30 * 60 * 1000; // 30 minutes
    
    // Track coins currently being escalated (to prevent duplicate escalations in same batch)
    this.escalationInProgress = new Set(); // Set of symbols currently being escalated
    
    // Configuration - Support HYBRID mode (different APIs for each tier)
    this.USE_HYBRID_MODE = config.USE_HYBRID_MODE || false;
    
    // Free monitoring tier
    this.FREE_MODEL = config.MONITORING_MODEL;
    this.FREE_API_KEY = config.MONITORING_API_KEY;
    this.FREE_API_TYPE = config.MONITORING_API_TYPE;
    
    // Premium confirmation tier
    this.PREMIUM_MODEL = config.AI_MODEL;
    this.PREMIUM_API_KEY = config.PREMIUM_API_KEY;
    this.PREMIUM_API_TYPE = config.PREMIUM_API_TYPE;
    
    // Thresholds
    this.ESCALATION_THRESHOLD = config.ESCALATION_THRESHOLD || 0.85; // 85% confidence
    this.VOLATILITY_THRESHOLD = config.VOLATILITY_THRESHOLD || 3.0; // 3% price change
    this.VOLUME_SPIKE_THRESHOLD = config.VOLUME_SPIKE_THRESHOLD || 2.0; // 2x average volume
    
    // Trigger tracking for algorithmic mode
    this.activeTriggers = new Map(); // symbol -> trigger data
    this.triggerSettings = this.loadTriggerSettings();
    
    if (this.USE_HYBRID_MODE) {
      console.log(`🤖 Monitoring Service initialized in HYBRID mode 🔥`);
      console.log(`   Free Tier: ${this.FREE_MODEL} (${this.FREE_API_TYPE.toUpperCase()})`);
      console.log(`   Premium Tier: ${this.PREMIUM_MODEL} (${this.PREMIUM_API_TYPE.toUpperCase()})`);
    } else {
      console.log(`🤖 Monitoring Service initialized with ${this.FREE_API_TYPE.toUpperCase()} API`);
    }
    console.log(`   Monitoring Mode: ${config.MONITORING_MODE.toUpperCase()}`);
  }
  
  /**
   * Load default trigger settings
   */
  loadTriggerSettings() {
    return {
      rsiOversold: 30,
      rsiOverbought: 70,
      enableBollinger: true,
      minPriceChange: 5,
      volumeMultiplier: 2,
      minTriggers: 2,
      requireVolume: false,
      monitoringMode: config.MONITORING_MODE || 'ai'
    };
  }
  
  /**
   * Save trigger settings
   */
  saveTriggerSettings(settings) {
    const oldMode = this.triggerSettings.monitoringMode;
    this.triggerSettings = { ...this.triggerSettings, ...settings };
    console.log(`💾 Trigger settings saved:`, this.triggerSettings);
    
    // If monitoring mode changed, log it
    if (settings.monitoringMode && settings.monitoringMode !== oldMode) {
      console.log(`🔄 Monitoring mode changed: ${oldMode} → ${settings.monitoringMode}`);
      console.log(`   ✅ Mode will take effect on next monitoring cycle (within 2 minutes)`);
    }
  }
  
  /**
   * Get trigger settings
   */
  getTriggerSettings() {
    return this.triggerSettings;
  }
  
  /**
   * Get active triggers for UI display
   */
  getActiveTriggers() {
    const now = Date.now();
    const activeList = [];
    
    // Clean up old entries (older than 5 minutes)
    for (const [symbol, data] of this.activeTriggers.entries()) {
      const age = now - new Date(data.lastUpdate).getTime();
      if (age > 5 * 60 * 1000) {
        this.activeTriggers.delete(symbol);
      } else {
        activeList.push(data);
      }
    }
    
    return activeList;
  }
  
  /**
   * Update active triggers (called after each monitoring cycle)
   */
  updateActiveTriggers(symbol, triggerData) {
    this.activeTriggers.set(symbol, {
      symbol,
      ...triggerData,
      lastUpdate: new Date().toISOString()
    });
  }

  /**
   * Call AI API (supports both Gemini and OpenRouter)
   * In HYBRID mode, uses different APIs for free vs premium
   */
  async callAI(prompt, model, maxTokens = 150, tier = 'free') {
    // Determine which API to use based on tier
    const apiType = tier === 'premium' ? this.PREMIUM_API_TYPE : this.FREE_API_TYPE;
    const apiKey = tier === 'premium' ? this.PREMIUM_API_KEY : this.FREE_API_KEY;
    
    console.log(`🔍 callAI: tier=${tier}, apiType=${apiType}, model=${model}, hasKey=${!!apiKey}`);
    
    if (!apiKey) {
      console.log(`⚠️ No API key for ${tier} tier`);
      throw new Error(`No API key configured for ${tier} tier`);
    }
    
    try {
      let result;
      if (apiType === 'gemini') {
        result = await this.callGeminiAPI(prompt, model, maxTokens, apiKey);
      } else {
        result = await this.callOpenRouterAPI(prompt, model, maxTokens, apiKey);
      }
      
      // Ensure result is a string
      if (result === null || result === undefined) {
        console.log(`⚠️ API returned null/undefined for ${tier} tier`);
        throw new Error(`API call returned null/undefined`);
      }
      
      if (typeof result !== 'string') {
        console.log(`⚠️ API returned non-string: ${typeof result}`);
        throw new Error(`API call returned non-string: ${typeof result}`);
      }
      
      return result;
      
    } catch (error) {
      console.log(`⚠️ callAI error for ${tier} tier: ${error.message}`);
      throw error;
    }
  }

  /**
   * Call Gemini API (Google)
   */
  async callGeminiAPI(prompt, model, maxTokens, apiKey) {
    // Use v1beta endpoint for Gemini API (v1 is not yet stable)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    
    const response = await axios.post(url, {
      contents: [{
        parts: [{
          text: prompt
        }]
      }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: maxTokens,
      }
    }, {
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });

    // Extract text from Gemini response
    const text = response.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return text;
  }

  /**
   * Call OpenRouter API
   */
  async callOpenRouterAPI(prompt, model, maxTokens, apiKey) {
    try {
      // DeepSeek R1 is VERY slow - needs much longer timeout
      // Use 90s for batch requests with high token limits (R1 reasoning takes time), 15s for single
      const isR1Model = model.includes('deepseek-r1') || model.includes('r1');
      const timeout = maxTokens > 500 ? (isR1Model ? (maxTokens > 3000 ? 90000 : 60000) : 30000) : 15000;
      
      console.log(`📡 Calling OpenRouter API: ${model} (${maxTokens} tokens, ${timeout/1000}s timeout)`);
      if (isR1Model) {
        console.log(`   ⏱️ Using extended timeout for R1 reasoning model`);
      }
      
      const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
        model: model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature: 0.3,
        // Add extra parameters for better R1 performance
        ...(isR1Model && {
          top_p: 0.9,
          frequency_penalty: 0.0,
          presence_penalty: 0.0,
        })
      }, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://my-deepseek-bot-1.onrender.com',
          'X-Title': 'Crypto Monitoring Bot',
        },
        timeout: timeout,
      });

      // Validate response structure
      if (!response.data) {
        console.log('⚠️ OpenRouter API returned no data');
        console.log('   Response:', JSON.stringify(response).substring(0, 500));
        return '';
      }

      if (!response.data.choices || !Array.isArray(response.data.choices) || response.data.choices.length === 0) {
        console.log('⚠️ OpenRouter API returned no choices in response');
        console.log('   Response data:', JSON.stringify(response.data).substring(0, 500));
        return '';
      }

      const choice = response.data.choices[0];
      const content = choice?.message?.content;
      const finishReason = choice?.finish_reason;
      
      // Check finish_reason first - this tells us why the model stopped
      if (finishReason === 'length') {
        console.log('⚠️ OpenRouter API response was truncated due to token limit');
        console.log(`   finish_reason: ${finishReason}`);
        if (response.data.usage) {
          console.log(`   Usage: ${JSON.stringify(response.data.usage)}`);
          console.log(`   ⚠️ Model hit max_tokens limit (${response.data.usage.completion_tokens}/${maxTokens})`);
          console.log(`   💡 Consider increasing max_tokens for this model`);
        }
        // If content is empty or very short, this is a problem
        if (!content || content.trim().length === 0) {
          throw new Error(`Model response truncated at token limit (${response.data.usage?.completion_tokens || 'unknown'}/${maxTokens} tokens) - response was empty. Increase max_tokens.`);
        }
        // If content exists but was truncated, log a warning but continue
        console.log(`   ⚠️ Response was truncated but has content (${content.length} chars) - may be incomplete`);
      }
      
      // More strict validation - don't use default empty string
      if (content === null || content === undefined) {
        console.log('⚠️ OpenRouter API returned null/undefined content');
        console.log('   Full response:', JSON.stringify(response.data).substring(0, 500));
        console.log('   Choices structure:', JSON.stringify(choice).substring(0, 300));
        if (finishReason) {
          console.log(`   finish_reason: ${finishReason}`);
        }
        
        // Check if there's an error message in the response
        if (response.data.error) {
          console.log('   API Error:', JSON.stringify(response.data.error));
          throw new Error(`OpenRouter API error: ${response.data.error.message || JSON.stringify(response.data.error)}`);
        }
        
        // Return empty string as last resort (better than undefined)
        console.log('   Returning empty string as fallback');
        return '';
      }
      
      if (typeof content !== 'string') {
        console.log('⚠️ OpenRouter API returned non-string content');
        console.log(`   Content type: ${typeof content}`);
        console.log(`   Content value: ${JSON.stringify(content).substring(0, 200)}`);
        return String(content); // Try to convert to string
      }
      
      if (content.trim().length === 0) {
        console.log('⚠️ OpenRouter API returned empty string');
        console.log('   This might indicate:');
        console.log('   - Model timeout (R1 takes 30-60s to respond)');
        console.log('   - Content filtering (response blocked)');
        console.log('   - Rate limiting (check OpenRouter dashboard)');
        console.log('   - max_tokens too low (try increasing)');
        if (finishReason) {
          console.log(`   - finish_reason: ${finishReason} (model stopped due to ${finishReason === 'length' ? 'token limit' : finishReason})`);
        }
        
        // Check if there are any usage or error indicators in response
        if (response.data.usage) {
          console.log('   Usage:', JSON.stringify(response.data.usage));
          if (finishReason === 'length' && response.data.usage.completion_tokens >= maxTokens) {
            throw new Error(`Model hit max_tokens limit (${response.data.usage.completion_tokens}/${maxTokens}) - response was empty. Increase max_tokens.`);
          }
        }
        if (response.data.model) {
          console.log('   Model used:', response.data.model);
        }
      } else {
        console.log(`✅ OpenRouter API response received (${content.length} chars)`);
        if (finishReason === 'length') {
          console.log(`   ⚠️ Note: Response was truncated at token limit but has content`);
        }
      }
      
      return content;
      
    } catch (error) {
      // Enhanced error logging
      if (error.response) {
        const status = error.response.status;
        const statusText = error.response.statusText;
        const errorData = error.response.data;
        
        console.log('⚠️ OpenRouter API error:');
        console.log(`   Status: ${status} ${statusText}`);
        console.log(`   Error data: ${JSON.stringify(errorData).substring(0, 500)}`);
        
        // Check for rate limit
        if (status === 429) {
          const retryAfter = error.response.headers['retry-after'] || 'unknown';
          console.log(`   ⚠️ RATE LIMIT HIT - Too many requests to OpenRouter`);
          console.log(`   Retry after: ${retryAfter} seconds`);
          throw new Error(`Rate limit exceeded (429) - retry after ${retryAfter}s`);
        }
        
        // Check for authentication errors
        if (status === 401 || status === 403) {
          console.log(`   ⚠️ AUTHENTICATION ERROR - Check your API key`);
          throw new Error(`Authentication failed (${status}) - invalid API key`);
        }
        
        // Check for server errors
        if (status >= 500) {
          console.log(`   ⚠️ SERVER ERROR - OpenRouter service issue`);
          throw new Error(`OpenRouter server error (${status})`);
        }
        
        throw new Error(`OpenRouter API error: ${status} ${statusText}`);
        
      } else if (error.code === 'ECONNABORTED') {
        console.log('⚠️ OpenRouter API timeout - request took too long');
        console.log(`   Timeout was: ${error.config?.timeout || 'unknown'}ms`);
        throw new Error('API request timeout - request took too long');
        
      } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        console.log('⚠️ OpenRouter API network error:', error.message);
        console.log(`   Code: ${error.code}`);
        throw new Error(`Network error: ${error.message}`);
        
      } else {
        console.log('⚠️ OpenRouter API unexpected error:', error.message);
        console.log(`   Error type: ${error.constructor.name}`);
        if (error.stack) {
          console.log(`   Stack: ${error.stack.substring(0, 300)}`);
        }
        throw error;
      }
    }
  }

  /**
   * Quick volatility check using free v3 model (single coin)
   */
  async quickVolatilityCheck(coinData) {
    try {
      const { symbol, currentPrice, volume24h, priceChange24h } = coinData;
      
      // Calculate volatility
      const priceChangePercent = Math.abs(priceChange24h || 0);
      const volatilityLevel = this.calculateVolatilityLevel(priceChangePercent);
      
      // No volatility filter - monitor everything for real-time opportunities
      // (Since we're monitoring every 2 minutes, 24h volatility is not relevant)
      
      console.log(`🔍 Free model monitoring ${symbol} (${volatilityLevel} volatility: ${priceChangePercent.toFixed(2)}%)`);

      // Check for API key before making the call
      if (!this.FREE_API_KEY) {
        console.log(`⚠️ No free tier API key - skipping ${symbol}`);
        return null;
      }

      // Create lightweight prompt for v3
      const prompt = this.createMonitoringPrompt(coinData);
      
      const responseText = await this.callAI(prompt, this.FREE_MODEL, 150, 'free');
      const analysis = this.parseMonitoringResponse(responseText);
      
      // Store v3 evaluation
      await storeAIEvaluation({
        symbol,
        model: this.FREE_MODEL,
        analysis,
        timestamp: new Date(),
        type: 'monitoring'
      });

      return analysis;

    } catch (error) {
      console.log(`⚠️ Free model monitoring error for ${coinData.symbol}:`, error.message);
      if (error.response) {
        console.log(`   API Status: ${error.response.status}`);
        console.log(`   API Error: ${JSON.stringify(error.response.data).substring(0, 200)}`);
      } else {
        console.log(`   Error stack: ${error.stack?.substring(0, 200)}`);
      }
      return null;
    }
  }

  /**
   * Algorithmic trigger check (no AI, just technical indicators)
   * Fast, free, and deterministic
   */
  async algorithmicTriggerCheck(coinData) {
    const { symbol, currentPrice, priceChange24h, volume24h } = coinData;
    
    // Calculate volatility level
    const priceChangePercent = Math.abs(priceChange24h || 0);
    const volatilityLevel = this.calculateVolatilityLevel(priceChangePercent);
    
    // Initialize indicators
    let rsi = null;
    let bollingerPosition = 'MIDDLE';
    let trend = 'SIDEWAYS';
    
    // Try to calculate indicators if we have price history
    if (coinData.priceHistory && coinData.priceHistory.length >= 14) {
      const { calculateRSI, calculateBollingerBands, identifyTrend } = require('../bot/indicators');
      rsi = calculateRSI(coinData.priceHistory, 14);
      const bollinger = calculateBollingerBands(coinData.priceHistory, 20, 2);
      trend = identifyTrend(coinData.priceHistory);
      
      // Determine Bollinger position
      if (currentPrice >= bollinger.upper) bollingerPosition = 'UPPER';
      else if (currentPrice <= bollinger.lower) bollingerPosition = 'LOWER';
      else bollingerPosition = 'MIDDLE';
    }
    
    // Trigger conditions based on settings
    const settings = this.triggerSettings;
    const triggers = {
      rsiOversold: rsi !== null && rsi < settings.rsiOversold,
      rsiOverbought: rsi !== null && rsi > settings.rsiOverbought,
      bollingerLower: settings.enableBollinger !== false && bollingerPosition === 'LOWER',
      bollingerUpper: settings.enableBollinger !== false && bollingerPosition === 'UPPER',
      highVolatility: volatilityLevel === 'high',
      bigPriceMove: priceChangePercent > settings.minPriceChange,
      // volumeSpike: volume24h > (coinData.avgVolume || volume24h) * settings.volumeMultiplier
    };
    
    // Count active triggers
    const activeTriggers = Object.entries(triggers)
      .filter(([_, active]) => active)
      .map(([name]) => name);
    const triggerCount = activeTriggers.length;
    
    // Apply volume requirement if enabled
    const meetsVolumeReq = !settings.requireVolume || triggers.volumeSpike;
    
    // Escalation logic: meets min triggers AND volume requirement
    const shouldEscalate = triggerCount >= settings.minTriggers && meetsVolumeReq;
    const confidence = Math.min(0.95, 0.4 + (triggerCount * 0.15)); // Base 40% + 15% per trigger
    
    // Determine signal based on triggers
    let signal = 'HOLD';
    let reason = 'No significant triggers detected';
    
    if (shouldEscalate) {
      if (triggers.rsiOversold || triggers.bollingerLower) {
        signal = 'BUY';
        reason = `Buy signals detected: ${activeTriggers.join(', ')}`;
      } else if (triggers.rsiOverbought || triggers.bollingerUpper) {
        signal = 'SELL';
        reason = `Sell signals detected: ${activeTriggers.join(', ')}`;
      } else {
        signal = 'WATCH';
        reason = `High activity: ${activeTriggers.join(', ')}`;
      }
    }
    
    const analysis = {
      signal,
      confidence,
      reason,
      shouldEscalate,
      volatilityLevel,
      activeTriggers,
      indicators: { rsi, bollingerPosition, trend }
    };
    
    console.log(`📊 ${symbol} Algorithmic: ${signal} (${triggerCount} triggers, ${(confidence * 100).toFixed(0)}%)`);
    
    // Update active triggers for UI
    this.updateActiveTriggers(symbol, {
      ...analysis,
      currentPrice,
      priceChange24h: priceChangePercent
    });
    
    return {
      symbol,
      analysis
    };
  }

  /**
   * Bulk scan top 200 coins using TAAPI.IO for fast indicator analysis
   * Returns coins sorted by most oversold (RSI < threshold, below BB lower, etc.)
   */
  async bulkScanTop200Coins(options = {}) {
    try {
      if (!config.TAAPI_ENABLED) {
        console.log('⚠️ TAAPI.IO not enabled - skipping bulk scan');
        return [];
      }

      // Use trigger settings from UI (dynamically updated)
      const settings = this.triggerSettings;
      const {
        maxCoins = 200,
        rsiThreshold = settings.rsiOversold || 30,
        minTriggers = settings.minTriggers || 2,
        enableBollinger = settings.enableBollinger !== false, // Default true
        minPriceChange = settings.minPriceChange || 5,
        requireVolume = settings.requireVolume || false,
        volumeMultiplier = settings.volumeMultiplier || 2
      } = options;

      console.log(`🚀 Bulk scanning top ${maxCoins} coins with TAAPI.IO...`);
      console.log(`   Filters: RSI < ${rsiThreshold}, Min triggers: ${minTriggers}, BB: ${enableBollinger ? 'ON' : 'OFF'}, Min price change: ${minPriceChange}%`);

      // Use bulk indicator service to scan with all trigger settings
      const oversoldCoins = await bulkIndicatorService.scanBulkCoinsForOversold({
        maxCoins,
        rsiThreshold,
        minTriggers,
        enableBollinger,
        minPriceChange,
        requireVolume,
        volumeMultiplier
      });

      if (oversoldCoins.length === 0) {
        console.log(`✅ Bulk scan complete: No oversold opportunities found`);
        return [];
      }

      console.log(`✅ Bulk scan complete: Found ${oversoldCoins.length} oversold coins`);
      console.log(`   Top 10: ${oversoldCoins.slice(0, 10).map(c => `${c.symbol} (RSI: ${c.indicators.rsi?.toFixed(1) || 'N/A'}, ${c.triggerCount} triggers)`).join(', ')}`);

      // Convert to monitoring service format
      return oversoldCoins.map(coin => ({
        symbol: coin.symbol,
        name: coin.name,
        rank: coin.rank,
        price: coin.price,
        priceChange24h: coin.priceChange24h,
        marketCap: coin.marketCap,
        indicators: coin.indicators,
        triggerCount: coin.triggerCount,
        triggers: coin.triggers,
        confidence: coin.confidence,
        analysis: {
          recommendation: coin.confidence >= this.ESCALATION_THRESHOLD ? 'OPPORTUNITY' : 'CAUTION',
          confidence: coin.confidence,
          reason: `RSI: ${coin.indicators.rsi?.toFixed(1) || 'N/A'}, ${coin.triggers.join(', ')}`
        }
      }));

    } catch (error) {
      console.error('❌ Error in bulk scan:', error.message);
      return [];
    }
  }

  /**
   * Batch volatility check for multiple coins in one API call
   */
  async batchVolatilityCheck(coinsData) {
    try {
      if (!coinsData || coinsData.length === 0) {
        return [];
      }

      // Use saved settings mode (allows runtime switching), fallback to config
      const monitoringMode = this.triggerSettings.monitoringMode || config.MONITORING_MODE || 'ai';
      console.log(`📦 Batch monitoring ${coinsData.length} coins in ${monitoringMode.toUpperCase()} mode...`);

      // ALGORITHMIC MODE: Use triggers instead of AI (fast & free)
      if (monitoringMode === 'algorithmic') {
        const results = [];
        for (const coinData of coinsData) {
          const result = await this.algorithmicTriggerCheck(coinData);
          results.push(result);
        }
        return results;
      }

      // AI MODE: Use free AI (existing behavior)
      console.log(`🔍 Using AI for batch monitoring...`);
      
      // Check for API key
      if (!this.FREE_API_KEY) {
        console.log(`⚠️ No free tier API key - skipping batch monitoring`);
        return coinsData.map(c => ({ symbol: c.symbol, analysis: null }));
      }

      // Create batch prompt
      const batchPrompt = this.createBatchMonitoringPrompt(coinsData);
      
      // Call AI with larger token limit for batch
      const responseText = await this.callAI(batchPrompt, this.FREE_MODEL, 500, 'free');
      const batchAnalysis = this.parseBatchMonitoringResponse(responseText, coinsData);
      
      // Store evaluations and return results
      const results = [];
      for (let i = 0; i < coinsData.length; i++) {
        const coinData = coinsData[i];
        const analysis = batchAnalysis[i] || null;
        
        if (analysis) {
          // Store v3 evaluation
          await storeAIEvaluation({
            symbol: coinData.symbol,
            model: this.FREE_MODEL,
            analysis,
            timestamp: new Date(),
            type: 'monitoring'
          });
        }
        
        results.push({
          symbol: coinData.symbol,
          analysis
        });
      }

      console.log(`✅ Batch monitoring complete: ${results.filter(r => r.analysis).length}/${coinsData.length} analyzed`);
      return results;

    } catch (error) {
      console.log(`⚠️ Batch monitoring error:`, error.message);
      if (error.response) {
        console.log(`   API Status: ${error.response.status}`);
        console.log(`   API Error: ${JSON.stringify(error.response.data).substring(0, 200)}`);
      } else {
        console.log(`   Error stack: ${error.stack?.substring(0, 200)}`);
      }
      // Return null for all coins on error
      return coinsData.map(c => ({ symbol: c.symbol, analysis: null }));
    }
  }

  /**
   * Check if this idea was recently rejected to avoid unnecessary costs
   */
  isRecentlyRejected(symbol) {
    const cached = this.rejectedIdeasCache.get(symbol);
    if (!cached) return false;
    
    const age = Date.now() - cached.timestamp;
    if (age > this.REJECTION_CACHE_DURATION) {
      // Cache expired, remove it
      this.rejectedIdeasCache.delete(symbol);
      return false;
    }
    
    console.log(`⏭️ Skipping ${symbol} - recently rejected (${Math.floor(age / 60000)} min ago): ${cached.reason}`);
    return true;
  }

  /**
   * Check if coin is on cooldown (recently escalated - confirmed or rejected)
   */
  isOnCooldown(symbol) {
    const cached = this.escalationCooldownCache.get(symbol);
    if (!cached) return false;
    
    const age = Date.now() - cached.timestamp;
    if (age > this.ESCALATION_COOLDOWN_DURATION) {
      // Cooldown expired, remove it
      this.escalationCooldownCache.delete(symbol);
      return false;
    }
    
    const minutesLeft = Math.floor((this.ESCALATION_COOLDOWN_DURATION - age) / 60000);
    console.log(`⏭️ Skipping ${symbol} - on cooldown (${minutesLeft} min left, last decision: ${cached.decision})`);
    return true;
  }

  /**
   * Check if coin is currently being escalated (in progress)
   */
  isEscalationInProgress(symbol) {
    return this.escalationInProgress.has(symbol);
  }

  /**
   * Mark coin as being escalated
   */
  markEscalationInProgress(symbol) {
    this.escalationInProgress.add(symbol);
  }

  /**
   * Clear escalation in progress flag
   */
  clearEscalationInProgress(symbol) {
    this.escalationInProgress.delete(symbol);
  }

  /**
   * Add coin to cooldown cache (after any escalation - confirmed or rejected)
   */
  addToCooldown(symbol, decision) {
    this.escalationCooldownCache.set(symbol, {
      timestamp: Date.now(),
      decision: decision
    });
    console.log(`💾 Added ${symbol} to cooldown (30 min) - decision: ${decision}`);
  }

  /**
   * Batch escalate multiple coins to premium model in one API call
   */
  async batchEscalateToR1(escalations) {
    try {
      if (!escalations || escalations.length === 0) {
        return [];
      }

      // Deduplicate escalations - remove duplicates within the same batch
      const seenSymbols = new Set();
      const uniqueEscalations = escalations.filter(esc => {
        const { symbol } = esc.coinData;
        if (seenSymbols.has(symbol)) {
          console.log(`⏭️ Skipping duplicate ${symbol} in same batch`);
          return false;
        }
        seenSymbols.add(symbol);
        return true;
      });

      // Filter out coins on cooldown or recently rejected
      const validEscalations = uniqueEscalations.filter(esc => {
        const { symbol } = esc.coinData;
        
        // Check if currently being escalated (shouldn't happen, but safety check)
        if (this.isEscalationInProgress(symbol)) {
          console.log(`⏭️ Skipping ${symbol} - escalation already in progress`);
          return false;
        }
        
        // Check cooldown (30 min after any escalation)
        if (this.isOnCooldown(symbol)) {
          return false;
        }
        
        // Check if recently rejected (4 hour cache)
        if (this.isRecentlyRejected(symbol)) {
          console.log(`⏭️ Skipping ${symbol} - recently rejected, won't escalate (saves cost)`);
          return false;
        }
        
        return true;
      });

      if (validEscalations.length === 0) {
        console.log('⏭️ All escalations were recently rejected or on cooldown - skipping batch escalation');
        return escalations.map(esc => ({
          symbol: esc.coinData.symbol,
          coinData: esc.coinData,
          v3Analysis: esc.v3Analysis,
          r1Decision: {
            decision: 'SKIPPED',
            reason: 'On cooldown or recently rejected by Premium AI',
            confidence: 0,
            timestamp: Date.now()
          }
        }));
      }

      console.log(`🚨 BATCH ESCALATING ${validEscalations.length} coins to Premium Model in one API call!`);
      validEscalations.forEach(esc => {
        console.log(`   - ${esc.coinData.symbol}: ${esc.v3Analysis.signal} (${(esc.v3Analysis.confidence * 100).toFixed(0)}%)`);
        // Mark as in progress immediately
        this.markEscalationInProgress(esc.coinData.symbol);
      });

      // Check premium API key
      if (!this.PREMIUM_API_KEY) {
        console.log(`⚠️ No premium tier API key - cannot escalate`);
        return validEscalations.map(esc => ({
          symbol: esc.coinData.symbol,
          decision: 'ERROR',
          reason: 'Premium API key not configured',
          confidence: 0
        }));
      }

      // Create batch prompt
      const prompt = this.createBatchConfirmationPrompt(validEscalations);
      console.log(`📝 Batch prompt created (${prompt.length} chars) for ${validEscalations.length} coins`);

      // Call premium tier API with longer timeout for batch
      // Increase max_tokens for R1 reasoning model (needs more tokens for thinking)
      const isR1Model = this.PREMIUM_MODEL.includes('r1');
      const maxTokens = isR1Model ? 5000 : 1000; // R1 needs significantly more tokens for reasoning (increased from 2000 to 5000)
      
      let responseText;
      try {
        console.log(`🚀 Starting premium API call for ${validEscalations.length} coins...`);
        console.log(`   Model: ${this.PREMIUM_MODEL}, Max tokens: ${maxTokens}`);
        responseText = await this.callAI(prompt, this.PREMIUM_MODEL, maxTokens, 'premium');
        
        // Detailed validation of response
        console.log(`📥 Premium API call completed`);
        console.log(`   Response type: ${typeof responseText}`);
        console.log(`   Response is null: ${responseText === null}`);
        console.log(`   Response is undefined: ${responseText === undefined}`);
        console.log(`   Response length: ${responseText ? responseText.length : 'N/A'}`);
        
        if (responseText === null || responseText === undefined) {
          console.log('⚠️ Premium API returned null/undefined response');
          console.log(`   Exact value: ${responseText}`);
          throw new Error('Null/undefined response from premium API - check API key and rate limits');
        }
        
        if (typeof responseText !== 'string') {
          console.log(`⚠️ Premium API returned non-string response: ${typeof responseText}`);
          console.log(`   Value: ${JSON.stringify(responseText).substring(0, 200)}`);
          throw new Error(`Invalid response type: ${typeof responseText}`);
        }
        
        if (responseText.trim().length === 0) {
          console.log('⚠️ Premium API returned empty string (whitespace only)');
          console.log(`   Raw length: ${responseText.length}`);
          console.log(`   Raw content (JSON): ${JSON.stringify(responseText)}`);
          throw new Error('Empty string response from premium API - possible rate limit or API error');
        }
        
        console.log(`✅ Premium API response validated (${responseText.length} chars)`);
        console.log(`   First 300 chars: ${responseText.substring(0, 300)}`);
      } catch (error) {
        console.log(`⚠️ Premium API call failed: ${error.message}`);
        console.log(`   Error type: ${error.constructor.name}`);
        if (error.stack) {
          console.log(`   Stack: ${error.stack.substring(0, 400)}`);
        }
        // Return error responses for all escalations
        return validEscalations.map(esc => ({
          symbol: esc.coinData.symbol,
          coinData: esc.coinData,
          v3Analysis: esc.v3Analysis,
          r1Decision: {
            decision: 'ERROR',
            reason: `Premium API error: ${error.message}`,
            confidence: 0
          }
        }));
      }
      
      console.log(`🔍 Parsing batch R1 response...`);
      const batchR1Decisions = this.parseBatchR1Response(responseText, validEscalations);
      console.log(`✅ Parsed ${batchR1Decisions.length} decisions from batch response`);

      // Process results and store evaluations
      const results = [];
      for (let i = 0; i < validEscalations.length; i++) {
        const esc = validEscalations[i];
        const r1Decision = batchR1Decisions[i] || this.getDefaultR1Response('No response for this coin');
        
        // Store R1 evaluation
        await storeAIEvaluation({
          symbol: esc.coinData.symbol,
          model: this.PREMIUM_MODEL,
          analysis: r1Decision,
          v3Analysis: esc.v3Analysis,
          timestamp: new Date(),
          type: 'confirmation'
        });

        // Track escalation
        this.escalationHistory.push({
          symbol: esc.coinData.symbol,
          timestamp: new Date(),
          v3Analysis: esc.v3Analysis,
          r1Decision,
          executed: r1Decision.decision === 'CONFIRMED'
        });

        // Clear escalation in progress flag
        this.clearEscalationInProgress(esc.coinData.symbol);
        
        // Add to cooldown cache (30 min) for ANY decision (confirmed or rejected)
        this.addToCooldown(esc.coinData.symbol, r1Decision.decision);
        
        // If rejected, also add to rejection cache (4 hours)
        if (r1Decision.decision === 'REJECTED') {
          this.rejectedIdeasCache.set(esc.coinData.symbol, {
            timestamp: Date.now(),
            reason: r1Decision.reason.substring(0, 100)
          });
          console.log(`💾 Cached rejection for ${esc.coinData.symbol} - won't re-escalate for 4 hours`);
        }

        results.push({
          symbol: esc.coinData.symbol,
          coinData: esc.coinData,
          v3Analysis: esc.v3Analysis,
          r1Decision
        });
      }

      // Add skipped escalations to results (for coins that were filtered out)
      escalations.forEach(esc => {
        const symbol = esc.coinData.symbol;
        // Check if this coin was already in results
        const alreadyInResults = results.some(r => r.symbol === symbol);
        if (!alreadyInResults) {
          if (this.isOnCooldown(symbol)) {
            results.push({
              symbol: symbol,
              coinData: esc.coinData,
              v3Analysis: esc.v3Analysis,
              r1Decision: {
                decision: 'SKIPPED',
                reason: 'On cooldown (recently escalated)',
                timestamp: Date.now()
              }
            });
          } else if (this.isRecentlyRejected(symbol)) {
            results.push({
              symbol: symbol,
              coinData: esc.coinData,
              v3Analysis: esc.v3Analysis,
              r1Decision: {
                decision: 'SKIPPED',
                reason: 'Recently rejected by Premium AI',
                timestamp: Date.now()
              }
            });
          }
        }
      });

      console.log(`✅ Batch escalation complete: ${results.length} coins processed`);
      return results;

    } catch (error) {
      console.log(`⚠️ Batch escalation error:`, error.message);
      if (error.response) {
        console.log(`   API Status: ${error.response.status}`);
        console.log(`   API Error: ${JSON.stringify(error.response.data).substring(0, 200)}`);
      }
      
      // Return error for all escalations
      return escalations.map(esc => ({
        symbol: esc.coinData.symbol,
        coinData: esc.coinData,
        v3Analysis: esc.v3Analysis,
        r1Decision: {
          decision: 'ERROR',
          reason: `Premium model escalation failed: ${error.message}`,
          confidence: 0
        }
      }));
    }
  }

  /**
   * Parse batch R1 response (multiple coins)
   */
  parseBatchR1Response(content, escalations) {
    const results = [];
    
    // Enhanced logging for empty/invalid responses
    if (!content) {
      console.log('⚠️ Batch R1 response is null or undefined');
      console.log(`   Content type: ${typeof content}`);
      console.log(`   Content value: ${content}`);
      return escalations.map(() => this.getDefaultR1Response('Empty response'));
    }
    
    if (typeof content !== 'string') {
      console.log('⚠️ Batch R1 response is not a string');
      console.log(`   Content type: ${typeof content}`);
      console.log(`   Content value: ${JSON.stringify(content).substring(0, 200)}`);
      return escalations.map(() => this.getDefaultR1Response('Invalid response type'));
    }
    
    if (content.trim().length === 0) {
      console.log('⚠️ Batch R1 response is empty string (whitespace only)');
      console.log(`   Content length: ${content.length}`);
      console.log(`   Content (with escapes): ${JSON.stringify(content)}`);
      return escalations.map(() => this.getDefaultR1Response('Empty response'));
    }
    
    console.log(`📝 Parsing batch R1 response (${content.length} chars)`);
    console.log(`   First 200 chars: ${content.substring(0, 200)}`);

    try {
      // Strategy 1: Look for JSON array in markdown code blocks
      const codeBlockMatch = content.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
      if (codeBlockMatch) {
        const parsed = JSON.parse(codeBlockMatch[1]);
        if (Array.isArray(parsed)) {
          return this.mapBatchR1Results(parsed, escalations);
        }
      }
      
      // Strategy 2: Look for JSON array anywhere in text
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed)) {
          return this.mapBatchR1Results(parsed, escalations);
        }
      }
      
      // Strategy 3: Try parsing entire content as JSON array
      const parsed = JSON.parse(content.trim());
      if (Array.isArray(parsed)) {
        return this.mapBatchR1Results(parsed, escalations);
      }
      
    } catch (error) {
      console.log('⚠️ Failed to parse batch R1 response:', error.message);
      console.log('   Response preview (first 500 chars):', content.substring(0, 500));
    }

    // Fallback: return default for all
    return escalations.map(() => this.getDefaultR1Response('No valid JSON array found'));
  }

  /**
   * Map batch R1 results to escalations
   */
  mapBatchR1Results(parsedArray, escalations) {
    const results = [];
    
    for (let i = 0; i < escalations.length; i++) {
      const esc = escalations[i];
      const coinSymbol = esc.coinData.symbol;
      
      // Try to find by symbol, fallback to index
      const analysis = parsedArray.find(a => a.symbol === coinSymbol) || parsedArray[i] || null;
      
      if (analysis) {
        results.push(this.validateR1Response(analysis));
      } else {
        results.push(this.getDefaultR1Response(`No response for ${coinSymbol}`));
      }
    }
    
    return results;
  }

  /**
   * Escalate to premium model for confirmation (single coin - kept for backward compatibility)
   */
  async escalateToR1(coinData, v3Analysis) {
    try {
      const { symbol } = coinData;
      
      // Check if this was recently rejected to avoid unnecessary costs
      if (this.isRecentlyRejected(symbol)) {
        return {
          decision: 'SKIPPED',
          reason: 'Recently rejected by Premium AI',
          timestamp: Date.now()
        };
      }
      
      console.log(`🚨 ESCALATING ${symbol} to Premium Model for confirmation!`);
      console.log(`   Free Model Confidence: ${(v3Analysis.confidence * 100).toFixed(0)}%`);
      console.log(`   Free Model Reason: ${v3Analysis.reason}`);

      // Note: Telegram notification will be sent after premium response in batch mode

      // Create detailed prompt for premium model
      const prompt = this.createConfirmationPrompt(coinData, v3Analysis);

      // Check premium API key
      if (!this.PREMIUM_API_KEY) {
        console.log(`⚠️ No premium tier API key - cannot escalate ${symbol}`);
        return {
          decision: 'ERROR',
          reason: 'Premium API key not configured',
          confidence: 0
        };
      }

      // Call premium tier API with longer timeout
      const responseText = await this.callAI(prompt, this.PREMIUM_MODEL, 300, 'premium');
      const r1Decision = this.parseR1Response(responseText);

      // Store R1 evaluation
      await storeAIEvaluation({
        symbol,
        model: this.PREMIUM_MODEL,
        analysis: r1Decision,
        v3Analysis,
        timestamp: new Date(),
        type: 'confirmation'
      });

      // Track escalation
      this.escalationHistory.push({
        symbol,
        timestamp: new Date(),
        v3Analysis,
        r1Decision,
        executed: r1Decision.decision === 'CONFIRMED'
      });

      // If rejected, cache it to avoid re-escalating soon
      if (r1Decision.decision === 'REJECTED') {
        this.rejectedIdeasCache.set(symbol, {
          timestamp: Date.now(),
          reason: r1Decision.reason.substring(0, 100)
        });
        console.log(`💾 Cached rejection for ${symbol} - won't re-escalate for 4 hours`);
      }

      // Send result notification (only for single escalation, batch uses notifyR1DecisionBatch)
      await this.notifyR1Decision(symbol, v3Analysis, r1Decision, coinData);

      return r1Decision;

    } catch (error) {
      console.log(`⚠️ Premium model escalation error for ${coinData.symbol}:`, error.message);
      if (error.response) {
        console.log(`   API Status: ${error.response.status}`);
        console.log(`   API Error: ${JSON.stringify(error.response.data).substring(0, 200)}`);
      }
      return {
        decision: 'ERROR',
        reason: `Premium model escalation failed: ${error.message}`,
        confidence: 0
      };
    }
  }

  /**
   * Monitor a coin for opportunities
   */
  async monitorCoin(coinData) {
    try {
      const { symbol, currentPrice } = coinData;

      // Track price changes
      const lastPrice = this.lastPrices.get(symbol);
      if (lastPrice) {
        const priceChange = ((currentPrice - lastPrice) / lastPrice) * 100;
        coinData.minutePriceChange = priceChange;
      }
      this.lastPrices.set(symbol, currentPrice);

      // Quick check with v3
      const v3Analysis = await this.quickVolatilityCheck(coinData);

      if (!v3Analysis) {
        return null; // Nothing interesting
      }

      // Check if escalation is needed
      if (v3Analysis.shouldEscalate && v3Analysis.confidence >= this.ESCALATION_THRESHOLD) {
        const r1Decision = await this.escalateToR1(coinData, v3Analysis);
        return { v3Analysis, r1Decision };
      }

      // Just monitoring, no escalation needed
      return { v3Analysis, r1Decision: null };

    } catch (error) {
      console.log(`⚠️ Monitoring error for ${coinData.symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Create monitoring prompt for v3 (single coin)
   */
  createMonitoringPrompt(coinData) {
    const { symbol, name, currentPrice, priceChange24h, volume24h, minutePriceChange } = coinData;

    return `QUICK VOLATILITY CHECK - ${symbol}

Price: $${currentPrice}
24h Change: ${priceChange24h?.toFixed(2) || 'N/A'}%
${minutePriceChange ? `1min Change: ${minutePriceChange.toFixed(2)}%\n` : ''}
24h Volume: $${volume24h?.toLocaleString() || 'N/A'}

Task: Quick analysis to detect if this needs escalation to premium AI for trading decision.

Respond in JSON format:
{
  "shouldEscalate": true/false,
  "confidence": 0.0-1.0,
  "reason": "brief reason",
  "signal": "OPPORTUNITY/CAUTION/NORMAL"
}

Consider:
- Unusual volatility (>3% moves)
- Volume spikes
- Potential breakouts
- Risk signals

Keep it brief and actionable.`;
  }

  /**
   * Create batch monitoring prompt for multiple coins
   */
  createBatchMonitoringPrompt(coinsData) {
    let prompt = `BATCH VOLATILITY CHECK - Analyze ${coinsData.length} coins\n\n`;
    
    coinsData.forEach((coinData, index) => {
      const { symbol, name, currentPrice, priceChange24h, volume24h, minutePriceChange } = coinData;
      prompt += `[${index + 1}] ${symbol} - ${name}
Price: $${currentPrice}
24h Change: ${priceChange24h?.toFixed(2) || 'N/A'}%
${minutePriceChange ? `1min Change: ${minutePriceChange.toFixed(2)}%\n` : ''}
24h Volume: $${volume24h?.toLocaleString() || 'N/A'}

`;
    });

    prompt += `\nTask: Analyze each coin and detect if any need escalation to premium AI for trading decision.

Respond in JSON array format (one object per coin, in order):
[
  {
    "symbol": "SYMBOL",
    "shouldEscalate": true/false,
    "confidence": 0.0-1.0,
    "reason": "brief reason",
    "signal": "OPPORTUNITY/CAUTION/NORMAL"
  },
  ...
]

Consider for each:
- Unusual volatility (>3% moves)
- Volume spikes
- Potential breakouts
- Risk signals

Keep it brief and actionable.`;

    return prompt;
  }

  /**
   * Create confirmation prompt for R1 (single coin)
   */
  createConfirmationPrompt(coinData, v3Analysis) {
    const { symbol, name, currentPrice, priceChange24h, volume24h } = coinData;

    return `CONFIRMATION REQUEST FROM MONITORING AI

COIN: ${symbol} - ${name}
Current Price: $${currentPrice}
24h Change: ${priceChange24h?.toFixed(2)}%
24h Volume: $${volume24h?.toLocaleString()}

INITIAL DETECTION (v3):
- Signal: ${v3Analysis.signal}
- Confidence: ${(v3Analysis.confidence * 100).toFixed(0)}%
- Reason: ${v3Analysis.reason}

YOUR TASK:
Provide final trading decision. Confirm or reject this opportunity.

Respond in JSON format:
{
  "decision": "CONFIRMED/REJECTED",
  "action": "BUY/SELL/HOLD",
  "confidence": 0.0-1.0,
  "reason": "detailed reasoning",
  "stopLoss": percentage,
  "takeProfit": percentage
}

Be thorough and conservative. Only confirm high-probability setups.`;
  }

  /**
   * Create batch confirmation prompt for multiple coins
   */
  createBatchConfirmationPrompt(escalations) {
    let prompt = `BATCH CONFIRMATION REQUEST FROM MONITORING AI\n\n`;
    prompt += `Analyze ${escalations.length} coins that were flagged by the free monitoring AI.\n\n`;
    
    escalations.forEach((esc, index) => {
      const { coinData, v3Analysis } = esc;
      const { symbol, name, currentPrice, priceChange24h, volume24h } = coinData;
      
      prompt += `[${index + 1}] ${symbol} - ${name}
Current Price: $${currentPrice}
24h Change: ${priceChange24h?.toFixed(2)}%
24h Volume: $${volume24h?.toLocaleString()}

Free AI Detection:
- Signal: ${v3Analysis.signal}
- Confidence: ${(v3Analysis.confidence * 100).toFixed(0)}%
- Reason: ${v3Analysis.reason}

`;

    });

    prompt += `\nYOUR TASK:
For each coin above, provide a final trading decision. Confirm or reject each opportunity.

Respond in JSON array format (one object per coin, in order):
[
  {
    "symbol": "SYMBOL",
    "decision": "CONFIRMED/REJECTED",
    "action": "BUY/SELL/HOLD",
    "confidence": 0.0-1.0,
    "reason": "detailed reasoning",
    "stopLoss": percentage,
    "takeProfit": percentage
  },
  ...
]

Be thorough and conservative. Only confirm high-probability setups.`;

    return prompt;
  }

  /**
   * Parse v3 monitoring response (single coin)
   */
  parseMonitoringResponse(content) {
    try {
      // Try to extract JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          shouldEscalate: parsed.shouldEscalate || false,
          confidence: parsed.confidence || 0.5,
          reason: parsed.reason || 'No reason provided',
          signal: parsed.signal || 'NORMAL'
        };
      }
    } catch (error) {
      console.log('⚠️ Failed to parse v3 response:', error.message);
    }

    // Fallback parsing
    return {
      shouldEscalate: false,
      confidence: 0.3,
      reason: 'Failed to parse response',
      signal: 'NORMAL'
    };
  }

  /**
   * Parse batch monitoring response (multiple coins)
   */
  parseBatchMonitoringResponse(content, coinsData) {
    const results = [];
    
    try {
      // Try to extract JSON array
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        
        if (Array.isArray(parsed)) {
          // Map results to coins
          for (let i = 0; i < coinsData.length; i++) {
            const coinSymbol = coinsData[i].symbol;
            const analysis = parsed.find(a => a.symbol === coinSymbol) || parsed[i] || null;
            
            if (analysis) {
              results.push({
                shouldEscalate: analysis.shouldEscalate || false,
                confidence: analysis.confidence || 0.5,
                reason: analysis.reason || 'No reason provided',
                signal: analysis.signal || 'NORMAL'
              });
            } else {
              results.push(null);
            }
          }
          
          return results;
        }
      }
    } catch (error) {
      console.log('⚠️ Failed to parse batch response:', error.message);
      console.log('   Response preview:', content.substring(0, 200));
    }

    // Fallback: return null for all coins
    return coinsData.map(() => null);
  }

  /**
   * Parse R1 confirmation response
   */
  parseR1Response(content) {
    if (!content || typeof content !== 'string') {
      console.log('⚠️ R1 response is empty or not a string');
      return this.getDefaultR1Response('Empty response');
    }

    try {
      // Try multiple parsing strategies
      
      // Strategy 1: Look for JSON in markdown code blocks
      const codeBlockMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (codeBlockMatch) {
        const parsed = JSON.parse(codeBlockMatch[1]);
        return this.validateR1Response(parsed);
      }
      
      // Strategy 2: Look for JSON object anywhere in the text
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return this.validateR1Response(parsed);
      }
      
      // Strategy 3: Try parsing the entire content as JSON
      const parsed = JSON.parse(content.trim());
      return this.validateR1Response(parsed);
      
    } catch (error) {
      console.log('⚠️ Failed to parse R1 response:', error.message);
      console.log('   Response preview (first 500 chars):', content.substring(0, 500));
      console.log('   Full response length:', content.length);
      
      // Try to extract decision from text if JSON parsing fails
      const decisionMatch = content.match(/decision["\s:]+(CONFIRMED|REJECTED|SKIPPED)/i);
      const actionMatch = content.match(/action["\s:]+(BUY|SELL|HOLD)/i);
      const confidenceMatch = content.match(/confidence["\s:]+([0-9.]+)/i);
      
      if (decisionMatch || actionMatch || confidenceMatch) {
        console.log('   Attempting to extract fields from text...');
        return {
          decision: (decisionMatch && decisionMatch[1].toUpperCase()) || 'REJECTED',
          action: (actionMatch && actionMatch[1].toUpperCase()) || 'HOLD',
          confidence: confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.5,
          reason: content.substring(0, 200) || 'Failed to parse R1 response - extracted from text',
          stopLoss: 5,
          takeProfit: 10
        };
      }
    }

    return this.getDefaultR1Response('No valid JSON found in response');
  }

  /**
   * Validate and normalize R1 response
   */
  validateR1Response(parsed) {
    // Normalize decision to uppercase
    const decision = (parsed.decision || 'REJECTED').toUpperCase();
    
    // Ensure valid decision values
    if (!['CONFIRMED', 'REJECTED', 'SKIPPED'].includes(decision)) {
      console.log(`⚠️ Invalid decision value: ${decision}, defaulting to REJECTED`);
      return this.getDefaultR1Response(`Invalid decision: ${decision}`);
    }
    
    return {
      decision: decision,
      action: (parsed.action || 'HOLD').toUpperCase(),
      confidence: Math.max(0, Math.min(1, parseFloat(parsed.confidence) || 0.5)),
      reason: parsed.reason || 'No reason provided',
      stopLoss: Math.max(0, Math.min(50, parseFloat(parsed.stopLoss) || 5)),
      takeProfit: Math.max(0, Math.min(100, parseFloat(parsed.takeProfit) || 10))
    };
  }

  /**
   * Get default R1 response for errors
   */
  getDefaultR1Response(errorReason) {
    return {
      decision: 'REJECTED',
      action: 'HOLD',
      confidence: 0,
      reason: `Failed to parse R1 response: ${errorReason}`,
      stopLoss: 5,
      takeProfit: 10
    };
  }

  /**
   * Calculate volatility level
   */
  calculateVolatilityLevel(priceChangePercent) {
    if (priceChangePercent >= 5) return 'extreme';
    if (priceChangePercent >= 3) return 'high';
    if (priceChangePercent >= 1.5) return 'medium';
    return 'low';
  }

  /**
   * Send Telegram notification about escalation
   */
  async notifyEscalation(symbol, v3Analysis, coinData) {
    const message = `🚨 *Free AI Escalation*

📊 Coin: *${symbol}*
💰 Price: $${coinData?.currentPrice || 'N/A'}
📈 Change 24h: ${coinData?.priceChange24h?.toFixed(2) || 'N/A'}%
🤖 Free Model: ${this.FREE_MODEL}
📊 Signal: ${v3Analysis.signal}
💪 Confidence: ${(v3Analysis.confidence * 100).toFixed(0)}%
📝 Reason: ${v3Analysis.reason}

⏳ Escalating to Premium AI (${this.PREMIUM_MODEL}) for confirmation...`;

    await sendTelegramMessage(message);
  }

  /**
   * Truncate text at word boundaries to avoid cutting words in half
   * @param {string} text - Text to truncate
   * @param {number} maxLength - Maximum length
   * @returns {string} Truncated text
   */
  truncateAtWordBoundary(text, maxLength) {
    if (!text || text.length <= maxLength) {
      return text;
    }
    
    // Find the last space before maxLength
    const truncated = text.substring(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');
    
    // If we found a space, truncate there; otherwise truncate at maxLength
    if (lastSpace > maxLength * 0.7) { // Only use space if it's not too early
      return truncated.substring(0, lastSpace) + '...';
    }
    
    return truncated + '...';
  }

  /**
   * Send Telegram notification about R1 decision (single coin)
   */
  async notifyR1Decision(symbol, v3Analysis, r1Decision, coinData) {
    const emoji = r1Decision.decision === 'CONFIRMED' ? '✅' : '❌';
    const action = r1Decision.decision === 'CONFIRMED' ? 'EXECUTING' : 'REJECTED';

    // Filter out parsing error messages from reason
    let reason = r1Decision.reason || 'No reason provided';
    if (reason.includes('Failed to parse R1 response')) {
      reason = 'Premium AI analysis completed, but response format was unexpected. Decision: REJECTED for safety.';
    }

    // Truncate reasons at word boundaries to avoid incomplete words
    const freeReason = this.truncateAtWordBoundary(v3Analysis.reason || 'No reason provided', 300);
    const premiumReason = this.truncateAtWordBoundary(reason, 400);

    // Build message without truncation first
    let message = `${emoji} *AI Analysis: ${symbol}*

📊 Coin: *${symbol}*
💰 Price: $${coinData?.currentPrice || 'N/A'}

🤖 *Free AI (Monitoring):*
📊 Signal: ${v3Analysis.signal}
💪 Confidence: ${(v3Analysis.confidence * 100).toFixed(0)}%
📝 Reason: ${freeReason}

💎 *Premium AI (Decision):*
🎯 Decision: ${r1Decision.decision}
🎯 Action: ${r1Decision.action}
💪 Confidence: ${(r1Decision.confidence * 100).toFixed(0)}%
📝 Analysis: ${premiumReason}

${r1Decision.decision === 'CONFIRMED' ? `
🛡️ Stop Loss: ${r1Decision.stopLoss}%
🎯 Take Profit: ${r1Decision.takeProfit}%
` : ''}`;

    // Telegram has a 4096 character limit - truncate entire message if needed
    const TELEGRAM_MAX_LENGTH = 4096;
    if (message.length > TELEGRAM_MAX_LENGTH) {
      // Calculate how much we need to reduce
      const excess = message.length - TELEGRAM_MAX_LENGTH + 100; // Add buffer
      
      // Reduce premium reason first (it's usually longer)
      let finalPremiumReason = premiumReason;
      if (premiumReason.length > excess) {
        const newPremiumLength = Math.max(100, premiumReason.length - excess);
        finalPremiumReason = this.truncateAtWordBoundary(reason, newPremiumLength);
      }
      
      // Rebuild message with truncated premium reason
      message = `${emoji} *AI Analysis: ${symbol}*

📊 Coin: *${symbol}*
💰 Price: $${coinData?.currentPrice || 'N/A'}

🤖 *Free AI (Monitoring):*
📊 Signal: ${v3Analysis.signal}
💪 Confidence: ${(v3Analysis.confidence * 100).toFixed(0)}%
📝 Reason: ${freeReason}

💎 *Premium AI (Decision):*
🎯 Decision: ${r1Decision.decision}
🎯 Action: ${r1Decision.action}
💪 Confidence: ${(r1Decision.confidence * 100).toFixed(0)}%
📝 Analysis: ${finalPremiumReason}

${r1Decision.decision === 'CONFIRMED' ? `
🛡️ Stop Loss: ${r1Decision.stopLoss}%
🎯 Take Profit: ${r1Decision.takeProfit}%
` : ''}`;
      
      // If still too long, reduce free reason as well
      if (message.length > TELEGRAM_MAX_LENGTH) {
        const remainingExcess = message.length - TELEGRAM_MAX_LENGTH + 50;
        const newFreeLength = Math.max(50, freeReason.length - remainingExcess);
        const finalFreeReason = this.truncateAtWordBoundary(v3Analysis.reason || 'No reason provided', newFreeLength);
        
        message = `${emoji} *AI Analysis: ${symbol}*

📊 Coin: *${symbol}*
💰 Price: $${coinData?.currentPrice || 'N/A'}

🤖 *Free AI (Monitoring):*
📊 Signal: ${v3Analysis.signal}
💪 Confidence: ${(v3Analysis.confidence * 100).toFixed(0)}%
📝 Reason: ${finalFreeReason}

💎 *Premium AI (Decision):*
🎯 Decision: ${r1Decision.decision}
🎯 Action: ${r1Decision.action}
💪 Confidence: ${(r1Decision.confidence * 100).toFixed(0)}%
📝 Analysis: ${finalPremiumReason}

${r1Decision.decision === 'CONFIRMED' ? `
🛡️ Stop Loss: ${r1Decision.stopLoss}%
🎯 Take Profit: ${r1Decision.takeProfit}%
` : ''}`;
      }
    }

    await sendTelegramMessage(message);
  }

  /**
   * Send batch Telegram notifications (one per coin with both free and premium insights)
   */
  async notifyR1DecisionBatch(results) {
    for (const result of results) {
      const { symbol, coinData, v3Analysis, r1Decision } = result;
      
      // Skip notifications for skipped/error decisions
      if (r1Decision.decision === 'SKIPPED' || r1Decision.decision === 'ERROR') {
        continue;
      }
      
      await this.notifyR1Decision(symbol, v3Analysis, r1Decision, coinData);
      
      // Small delay between messages to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  /**
   * Get monitoring statistics
   */
  getStats() {
    const totalEscalations = this.escalationHistory.length;
    const confirmed = this.escalationHistory.filter(e => e.r1Decision.decision === 'CONFIRMED').length;
    const rejected = this.escalationHistory.filter(e => e.r1Decision.decision === 'REJECTED').length;

    return {
      totalEscalations,
      confirmed,
      rejected,
      confirmationRate: totalEscalations > 0 ? (confirmed / totalEscalations * 100).toFixed(1) : 0,
      recentEscalations: this.escalationHistory.slice(-10)
    };
  }
}

module.exports = new MonitoringService();

