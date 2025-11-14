const axios = require('axios');
const config = require('../config/config');
const { sendTelegramMessage } = require('./notificationService');
const { storeAIEvaluation } = require('./dataStorageService');

/**
 * Two-Tier AI Monitoring System
 * 
 * Tier 1 (Free): DeepSeek v3 - Continuous monitoring every minute
 * Tier 2 (Paid): DeepSeek R1 - Confirmation and final decisions
 * 
 * Flow:
 * 1. v3 monitors prices/volatility every minute
 * 2. If opportunity detected with high confidence → escalate to R1
 * 3. R1 confirms or rejects
 * 4. Send Telegram notification on escalation
 * 5. Store all evaluations for learning
 */

class MonitoringService {
  constructor() {
    this.lastPrices = new Map(); // Track price changes
    this.escalationHistory = []; // Track escalations
    this.isMonitoring = false;
    
    // Configuration
    this.FREE_MODEL = config.MONITORING_MODEL || 'deepseek/deepseek-chat';
    this.PREMIUM_MODEL = config.AI_MODEL || 'deepseek/deepseek-r1';
    this.ESCALATION_THRESHOLD = config.ESCALATION_THRESHOLD || 0.70; // 70% confidence
    this.VOLATILITY_THRESHOLD = config.VOLATILITY_THRESHOLD || 3.0; // 3% price change
    this.VOLUME_SPIKE_THRESHOLD = config.VOLUME_SPIKE_THRESHOLD || 2.0; // 2x average volume
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
      
      // Check if worth analyzing
      if (volatilityLevel === 'low') {
        return null; // Skip low volatility coins
      }

      // Create lightweight prompt for v3
      const prompt = this.createMonitoringPrompt(coinData);

      console.log(`🔍 v3 monitoring ${symbol} (${volatilityLevel} volatility: ${priceChangePercent.toFixed(2)}%)`);

      const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
        model: this.FREE_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 150,
        temperature: 0.3,
      }, {
        headers: {
          Authorization: `Bearer ${config.AI_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://my-deepseek-bot-1.onrender.com',
          'X-Title': 'Crypto Monitoring Bot',
        },
        timeout: 10000, // Quick timeout for monitoring
      });

      const analysis = this.parseMonitoringResponse(response.data.choices[0].message.content);
      
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
      console.log(`⚠️ v3 monitoring error for ${coinData.symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Escalate to premium R1 model for confirmation
   */
  async escalateToR1(coinData, v3Analysis) {
    try {
      const { symbol } = coinData;
      
      console.log(`🚨 ESCALATING ${symbol} to R1 for confirmation!`);
      console.log(`   v3 Confidence: ${(v3Analysis.confidence * 100).toFixed(0)}%`);
      console.log(`   v3 Reason: ${v3Analysis.reason}`);

      // Send Telegram notification about escalation
      await this.notifyEscalation(symbol, v3Analysis);

      // Create detailed prompt for R1
      const prompt = this.createConfirmationPrompt(coinData, v3Analysis);

      const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
        model: this.PREMIUM_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
        temperature: 0.1,
      }, {
        headers: {
          Authorization: `Bearer ${config.AI_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://my-deepseek-bot-1.onrender.com',
          'X-Title': 'Crypto Trading Bot - R1 Confirmation',
        },
        timeout: 30000,
      });

      const r1Decision = this.parseR1Response(response.data.choices[0].message.content);

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

      // Send result notification
      await this.notifyR1Decision(symbol, v3Analysis, r1Decision);

      return r1Decision;

    } catch (error) {
      console.log(`⚠️ R1 escalation error for ${coinData.symbol}:`, error.message);
      return {
        decision: 'ERROR',
        reason: `R1 escalation failed: ${error.message}`,
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
  async notifyEscalation(symbol, v3Analysis) {
    const message = `🚨 AI ESCALATION ALERT

📊 Coin: ${symbol}
🤖 Free AI (v3) detected opportunity
📈 Signal: ${v3Analysis.signal}
💪 Confidence: ${(v3Analysis.confidence * 100).toFixed(0)}%
📝 Reason: ${v3Analysis.reason}

⏳ Escalating to Premium AI (R1) for confirmation...`;

    await sendTelegramMessage(message);
  }

  /**
   * Send Telegram notification about R1 decision
   */
  async notifyR1Decision(symbol, v3Analysis, r1Decision) {
    const emoji = r1Decision.decision === 'CONFIRMED' ? '✅' : '❌';
    const action = r1Decision.decision === 'CONFIRMED' ? 'EXECUTING' : 'REJECTED';

    const message = `${emoji} R1 DECISION: ${r1Decision.decision}

📊 Coin: ${symbol}
🎯 Action: ${r1Decision.action}
💪 R1 Confidence: ${(r1Decision.confidence * 100).toFixed(0)}%
📝 R1 Analysis: ${r1Decision.reason}

${r1Decision.decision === 'CONFIRMED' ? `
🛡️ Stop Loss: ${r1Decision.stopLoss}%
🎯 Take Profit: ${r1Decision.takeProfit}%
` : ''}
---
🤖 v3 Initial: ${v3Analysis.signal} (${(v3Analysis.confidence * 100).toFixed(0)}%)
📝 v3 Reason: ${v3Analysis.reason}`;

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

