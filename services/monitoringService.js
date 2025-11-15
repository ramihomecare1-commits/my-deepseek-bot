const axios = require('axios');
const config = require('../config/config');
const { sendTelegramMessage } = require('./notificationService');
const { storeAIEvaluation } = require('./dataStorageService');

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
    this.ESCALATION_THRESHOLD = config.ESCALATION_THRESHOLD || 0.70; // 70% confidence
    this.VOLATILITY_THRESHOLD = config.VOLATILITY_THRESHOLD || 3.0; // 3% price change
    this.VOLUME_SPIKE_THRESHOLD = config.VOLUME_SPIKE_THRESHOLD || 2.0; // 2x average volume
    
    if (this.USE_HYBRID_MODE) {
      console.log(`🤖 Monitoring Service initialized in HYBRID mode 🔥`);
      console.log(`   Free Tier: ${this.FREE_MODEL} (${this.FREE_API_TYPE.toUpperCase()})`);
      console.log(`   Premium Tier: ${this.PREMIUM_MODEL} (${this.PREMIUM_API_TYPE.toUpperCase()})`);
    } else {
      console.log(`🤖 Monitoring Service initialized with ${this.FREE_API_TYPE.toUpperCase()} API`);
    }
  }

  /**
   * Call AI API (supports both Gemini and OpenRouter)
   * In HYBRID mode, uses different APIs for free vs premium
   */
  async callAI(prompt, model, maxTokens = 150, tier = 'free') {
    // Determine which API to use based on tier
    const apiType = tier === 'premium' ? this.PREMIUM_API_TYPE : this.FREE_API_TYPE;
    const apiKey = tier === 'premium' ? this.PREMIUM_API_KEY : this.FREE_API_KEY;
    
    if (apiType === 'gemini') {
      return await this.callGeminiAPI(prompt, model, maxTokens, apiKey);
    } else {
      return await this.callOpenRouterAPI(prompt, model, maxTokens, apiKey);
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
    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.3,
    }, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://my-deepseek-bot-1.onrender.com',
        'X-Title': 'Crypto Monitoring Bot',
      },
      timeout: 10000,
    });

    return response.data.choices[0].message.content;
  }

  /**
   * Quick volatility check using free v3 model
   */
  async quickVolatilityCheck(coinData) {
    try {
      const { symbol, currentPrice, volume24h, priceChange24h } = coinData;
      
      // Calculate volatility
      const priceChangePercent = Math.abs(priceChange24h || 0);
      const volatilityLevel = this.calculateVolatilityLevel(priceChangePercent);
      
      // No volatility filter - monitor everything for real-time opportunities
      // (Since we're monitoring every minute, 24h volatility is not relevant)
      
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
      }
      return null;
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
   * Escalate to premium model for confirmation
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

      // Send Telegram notification about escalation
      await this.notifyEscalation(symbol, v3Analysis, coinData);

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

      // Send result notification
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
   * Create monitoring prompt for v3
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
   * Create confirmation prompt for R1
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
   * Parse v3 monitoring response
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
   * Parse R1 confirmation response
   */
  parseR1Response(content) {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          decision: parsed.decision || 'REJECTED',
          action: parsed.action || 'HOLD',
          confidence: parsed.confidence || 0.5,
          reason: parsed.reason || 'No reason provided',
          stopLoss: parsed.stopLoss || 5,
          takeProfit: parsed.takeProfit || 10
        };
      }
    } catch (error) {
      console.log('⚠️ Failed to parse R1 response:', error.message);
    }

    return {
      decision: 'REJECTED',
      action: 'HOLD',
      confidence: 0,
      reason: 'Failed to parse R1 response',
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
   * Send Telegram notification about R1 decision
   */
  async notifyR1Decision(symbol, v3Analysis, r1Decision, coinData) {
    const emoji = r1Decision.decision === 'CONFIRMED' ? '✅' : '❌';
    const action = r1Decision.decision === 'CONFIRMED' ? 'EXECUTING' : 'REJECTED';

    const message = `${emoji} *Premium AI Decision: ${r1Decision.decision}*

📊 Coin: *${symbol}*
💰 Price: $${coinData?.currentPrice || 'N/A'}
🎯 Action: ${r1Decision.action}
💪 Premium Confidence: ${(r1Decision.confidence * 100).toFixed(0)}%
🤖 Model: ${this.PREMIUM_MODEL}

📝 Analysis:
${r1Decision.reason.substring(0, 400)}${r1Decision.reason.length > 400 ? '...' : ''}

${r1Decision.decision === 'CONFIRMED' ? `
🛡️ Stop Loss: ${r1Decision.stopLoss}%
🎯 Take Profit: ${r1Decision.takeProfit}%
` : ''}
---
🤖 Free AI Initial: ${v3Analysis.signal} (${(v3Analysis.confidence * 100).toFixed(0)}%)`;

    await sendTelegramMessage(message);
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

