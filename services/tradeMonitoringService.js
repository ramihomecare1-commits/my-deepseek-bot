const config = require('../config/config');
const { fetchEnhancedPriceData } = require('./dataFetcher');
const { sendTelegramMessage } = require('./notificationService');

/**
 * Trade Monitoring Service
 * Monitors open trades and triggers Premium AI evaluation when price approaches key levels
 * (DCA, Stop Loss, Take Profit)
 */
class TradeMonitoringService {
  constructor() {
    this.isRunning = false;
    this.monitorTimer = null;
    this.lastEvaluations = new Map(); // Track last evaluation time for each trade
    this.proximityThreshold = config.TRADE_PROXIMITY_THRESHOLD || 1.0; // Default 1%
    this.checkInterval = config.TRADE_CHECK_INTERVAL || 30000; // Default 30 seconds
    this.evaluationCooldown = config.AI_EVALUATION_COOLDOWN || 300000; // Default 5 minutes
  }

  /**
   * Start monitoring open trades
   */
  start(bot) {
    if (this.isRunning) {
      console.log('⚠️ Trade monitoring already running');
      return;
    }

    this.bot = bot;
    this.isRunning = true;
    
    console.log('🔍 Trade monitoring service started');
    console.log(`   Proximity threshold: ${this.proximityThreshold}%`);
    console.log(`   Check interval: ${this.checkInterval / 1000}s`);
    console.log(`   AI evaluation cooldown: ${this.evaluationCooldown / 1000}s`);

    // Check immediately
    this.checkTrades();

    // Then check at intervals
    this.monitorTimer = setInterval(() => {
      this.checkTrades();
    }, this.checkInterval);
  }

  /**
   * Stop monitoring
   */
  stop() {
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
      this.isRunning = false;
      console.log('🛑 Trade monitoring service stopped');
    }
  }

  /**
   * Update proximity threshold (from UI)
   */
  updateProximityThreshold(newThreshold) {
    this.proximityThreshold = Math.max(0.1, Math.min(10, newThreshold)); // Between 0.1% and 10%
    console.log(`📊 Proximity threshold updated to ${this.proximityThreshold}%`);
    return this.proximityThreshold;
  }

  /**
   * Get current settings
   */
  getSettings() {
    return {
      proximityThreshold: this.proximityThreshold,
      checkInterval: this.checkInterval,
      evaluationCooldown: this.evaluationCooldown,
      isRunning: this.isRunning
    };
  }

  /**
   * Check all open trades for proximity to key levels
   */
  async checkTrades() {
    if (!this.bot || !this.bot.activeTrades || this.bot.activeTrades.length === 0) {
      return;
    }

    try {
      for (const trade of this.bot.activeTrades) {
        await this.checkTrade(trade);
      }
    } catch (error) {
      console.error('❌ Error checking trades:', error.message);
    }
  }

  /**
   * Check a single trade for proximity to key levels
   */
  async checkTrade(trade) {
    try {
      // Get current price
      const priceData = await fetchEnhancedPriceData(trade.symbol);
      if (!priceData || !priceData.price) {
        return;
      }

      const currentPrice = priceData.price;
      const entryPrice = trade.entryPrice;

      // Calculate distances to key levels
      const distances = {
        stopLoss: null,
        takeProfit: null,
        dcaPrice: null
      };

      let triggeredLevel = null;
      let closestDistance = Infinity;

      // Check Stop Loss
      if (trade.stopLoss) {
        const slPrice = entryPrice * (1 - trade.stopLoss / 100);
        const distancePercent = Math.abs(((currentPrice - slPrice) / slPrice) * 100);
        distances.stopLoss = distancePercent;

        if (distancePercent <= this.proximityThreshold && distancePercent < closestDistance) {
          closestDistance = distancePercent;
          triggeredLevel = {
            type: 'STOP_LOSS',
            distance: distancePercent,
            targetPrice: slPrice,
            currentPrice: currentPrice
          };
        }
      }

      // Check Take Profit
      if (trade.takeProfit) {
        const tpPrice = entryPrice * (1 + trade.takeProfit / 100);
        const distancePercent = Math.abs(((currentPrice - tpPrice) / tpPrice) * 100);
        distances.takeProfit = distancePercent;

        if (distancePercent <= this.proximityThreshold && distancePercent < closestDistance) {
          closestDistance = distancePercent;
          triggeredLevel = {
            type: 'TAKE_PROFIT',
            distance: distancePercent,
            targetPrice: tpPrice,
            currentPrice: currentPrice
          };
        }
      }

      // Check DCA Price
      if (trade.dcaPrice) {
        const distancePercent = Math.abs(((currentPrice - trade.dcaPrice) / trade.dcaPrice) * 100);
        distances.dcaPrice = distancePercent;

        if (distancePercent <= this.proximityThreshold && distancePercent < closestDistance) {
          closestDistance = distancePercent;
          triggeredLevel = {
            type: 'DCA',
            distance: distancePercent,
            targetPrice: trade.dcaPrice,
            currentPrice: currentPrice
          };
        }
      }

      // If within proximity threshold, trigger AI evaluation
      if (triggeredLevel) {
        await this.triggerAIEvaluation(trade, triggeredLevel, priceData);
      }
    } catch (error) {
      console.error(`❌ Error checking trade ${trade.symbol}:`, error.message);
    }
  }

  /**
   * Trigger Premium AI evaluation for a trade
   */
  async triggerAIEvaluation(trade, triggeredLevel, priceData) {
    // Check cooldown - don't spam AI evaluations
    const tradeKey = `${trade.symbol}-${trade.entryTime}`;
    const lastEval = this.lastEvaluations.get(tradeKey);
    const now = Date.now();

    if (lastEval && (now - lastEval) < this.evaluationCooldown) {
      // Still in cooldown
      return;
    }

    // Update last evaluation time
    this.lastEvaluations.set(tradeKey, now);

    console.log(`🚨 AI EVALUATION TRIGGERED for ${trade.symbol}`);
    console.log(`   Level: ${triggeredLevel.type}`);
    console.log(`   Distance: ${triggeredLevel.distance.toFixed(2)}%`);
    console.log(`   Current Price: $${triggeredLevel.currentPrice.toFixed(6)}`);
    console.log(`   Target Price: $${triggeredLevel.targetPrice.toFixed(6)}`);

    try {
      // Call Premium AI for deep evaluation
      const aiEvaluation = await this.evaluateTradeWithPremiumAI(trade, triggeredLevel, priceData);

      if (aiEvaluation) {
        // Log and notify
        await this.handleAIRecommendation(trade, aiEvaluation, triggeredLevel);
      }
    } catch (error) {
      console.error(`❌ Error in AI evaluation for ${trade.symbol}:`, error.message);
    }
  }

  /**
   * Evaluate trade with Premium AI (DeepSeek R1)
   */
  async evaluateTradeWithPremiumAI(trade, triggeredLevel, priceData) {
    const axios = require('axios');
    const apiKey = config.PREMIUM_API_KEY;
    const model = config.AI_MODEL || 'deepseek/deepseek-r1';

    if (!apiKey) {
      console.log('⚠️ Premium API key not set, skipping AI evaluation');
      return null;
    }

    const currentPrice = priceData.price;
    const pnlPercent = ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100;

    const prompt = `You are a professional crypto trading advisor. Analyze this OPEN TRADE and provide actionable recommendations.

**TRADE DETAILS:**
- Symbol: ${trade.symbol}
- Entry Price: $${trade.entryPrice.toFixed(6)}
- Current Price: $${currentPrice.toFixed(6)}
- Position Size: ${trade.amount} ${trade.symbol}
- P/L: ${pnlPercent > 0 ? '+' : ''}${pnlPercent.toFixed(2)}%

**CURRENT LEVELS:**
- Stop Loss: ${trade.stopLoss}% (Price: $${(trade.entryPrice * (1 - trade.stopLoss / 100)).toFixed(6)})
- Take Profit: ${trade.takeProfit}% (Price: $${(trade.entryPrice * (1 + trade.takeProfit / 100)).toFixed(6)})
${trade.dcaPrice ? `- DCA Price: $${trade.dcaPrice.toFixed(6)}` : ''}

**PROXIMITY ALERT:**
Price is within ${triggeredLevel.distance.toFixed(2)}% of ${triggeredLevel.type} level!
- Target: $${triggeredLevel.targetPrice.toFixed(6)}
- Current: $${triggeredLevel.currentPrice.toFixed(6)}

**MARKET CONTEXT:**
- 24h Change: ${priceData.priceChange24h?.toFixed(2) || 'N/A'}%
- 24h Volume: $${priceData.volume24h ? (priceData.volume24h / 1000000).toFixed(2) + 'M' : 'N/A'}

**YOUR TASK:**
Provide a JSON response with your recommendations:

{
  "action": "KEEP" | "DCA" | "ADJUST_SL" | "ADJUST_TP" | "CLOSE" | "MODIFY",
  "reasoning": "Brief explanation of why",
  "recommendations": {
    "newStopLoss": <number or null>,  // New SL % if adjusting
    "newTakeProfit": <number or null>, // New TP % if adjusting
    "dcaAmount": <number or null>,     // DCA amount if adding position
    "dcaPrice": <number or null>       // New DCA price if adjusting
  },
  "urgency": "LOW" | "MEDIUM" | "HIGH",
  "confidence": <0-100>
}

Consider:
1. Current market momentum
2. Risk/reward ratio
3. Position P/L
4. Proximity to key level
5. Market volatility

Respond ONLY with valid JSON.`;

    try {
      const response = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: model,
          messages: [
            {
              role: 'system',
              content: 'You are a professional crypto trading advisor. Respond ONLY with valid JSON.'
            },
            {
              role: 'user',
              content: prompt
            }
          ]
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com/your-repo',
            'X-Title': 'Crypto Trading Bot'
          },
          timeout: 120000 // 2 minutes for R1 model
        }
      );

      const aiResponse = response.data.choices[0].message.content;
      
      // Try to extract JSON from response (handle R1's thinking tags)
      let jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const evaluation = JSON.parse(jsonMatch[0]);
        console.log(`✅ AI Evaluation received: ${evaluation.action} (${evaluation.confidence}% confidence)`);
        return evaluation;
      }

      console.log('⚠️ Could not parse AI response');
      return null;
    } catch (error) {
      console.error('❌ Error calling Premium AI:', error.message);
      return null;
    }
  }

  /**
   * Handle AI recommendation
   */
  async handleAIRecommendation(trade, aiEvaluation, triggeredLevel) {
    const message = `🤖 **TRADE EVALUATION: ${trade.symbol}**\n\n` +
      `📊 **Triggered Level:** ${triggeredLevel.type}\n` +
      `📍 **Distance:** ${triggeredLevel.distance.toFixed(2)}%\n\n` +
      `🎯 **AI Recommendation:** ${aiEvaluation.action}\n` +
      `💡 **Reasoning:** ${aiEvaluation.reasoning}\n` +
      `⚡ **Urgency:** ${aiEvaluation.urgency}\n` +
      `📈 **Confidence:** ${aiEvaluation.confidence}%\n\n`;

    let details = '';
    const recs = aiEvaluation.recommendations;

    if (recs.newStopLoss) {
      details += `• New Stop Loss: ${recs.newStopLoss}%\n`;
    }
    if (recs.newTakeProfit) {
      details += `• New Take Profit: ${recs.newTakeProfit}%\n`;
    }
    if (recs.dcaAmount) {
      details += `• DCA Amount: ${recs.dcaAmount} ${trade.symbol}\n`;
    }
    if (recs.dcaPrice) {
      details += `• DCA Price: $${recs.dcaPrice.toFixed(6)}\n`;
    }

    if (details) {
      await sendTelegramMessage(message + `**📋 Recommendations:**\n${details}`);
    } else {
      await sendTelegramMessage(message);
    }

    // Store evaluation in history (optional - for analytics)
    if (this.bot && this.bot.tradeEvaluations) {
      this.bot.tradeEvaluations.push({
        symbol: trade.symbol,
        timestamp: new Date(),
        triggeredLevel: triggeredLevel.type,
        aiEvaluation: aiEvaluation
      });
    }
  }
}

module.exports = new TradeMonitoringService();

