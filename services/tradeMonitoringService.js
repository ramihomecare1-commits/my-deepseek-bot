const config = require('../config/config');
const { sendTelegramMessage } = require('./notificationService');
const axios = require('axios');

/**
 * Trade Monitoring Service
 * Monitors open trades and triggers Premium AI evaluation when price approaches key levels
 * (DCA, Stop Loss, Take Profit)
 */
class TradeMonitoringService {
  constructor() {
    this.isRunning = false;
    this.monitorTimer = null;
    this.lastTriggerBySymbol = new Map(); // symbol -> timestamp of last trigger (per-symbol cooldown)
    this.proximityThreshold = config.TRADE_PROXIMITY_THRESHOLD || 1.0; // Default 1%
    this.checkInterval = config.TRADE_CHECK_INTERVAL || 30000; // Default 30 seconds
    // Unified cooldown for ALL triggers (DCA, TP, SL) - 3 hours
    this.evaluationCooldown = 3 * 60 * 60 * 1000; // 3 hours (matches ProfessionalTradingBot)
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
    console.log(`   AI evaluation cooldown: ${this.evaluationCooldown / 3600000}h per symbol (independent for each coin)`);

    // Don't check immediately - wait for first interval to avoid startup issues
    // this.checkTrades(); // Removed to prevent blocking during startup

    // Check at intervals
    this.monitorTimer = setInterval(() => {
      this.checkTrades().catch(err => {
        console.error('❌ Error in trade monitoring check:', err.message);
      });
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
   * NOTE: Trade data is kept in memory only for trigger monitoring (DCA, SL, TP proximity detection)
   * OKX is the source of truth for actual positions and balance
   */
  async checkTrades() {
    if (!this.bot || !this.bot.activeTrades || this.bot.activeTrades.length === 0) {
      return;
    }

    try {
      // Sync with OKX positions first to ensure trigger data matches OKX
      if (this.bot.syncWithOkxPositions) {
        await this.bot.syncWithOkxPositions();
      }

      for (const trade of this.bot.activeTrades) {
        await this.checkTrade(trade);
      }
    } catch (error) {
      console.error('❌ Error checking trades:', error.message);
    }
  }

  /**
   * Fetch current price for a symbol (simple version for monitoring)
   */
  async fetchCurrentPrice(symbol) {
    try {
      // Use MEXC API (free, no key required)
      const response = await axios.get(`https://api.mexc.com/api/v3/ticker/price?symbol=${symbol}USDT`, {
        timeout: 5000
      });

      if (response.data && response.data.price) {
        return {
          price: parseFloat(response.data.price),
          source: 'mexc'
        };
      }
    } catch (error) {
      console.error(`⚠️ Error fetching price for ${symbol}:`, error.message);
    }
    return null;
  }

  /**
   * Check a single trade for proximity to key levels
   */
  async checkTrade(trade) {
    try {
      // Get current price (simple fetch for monitoring)
      const priceData = await this.fetchCurrentPrice(trade.symbol.replace('USDT', ''));
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
    // Check per-symbol cooldown (each coin has independent 3-hour timer)
    const now = Date.now();
    const lastTrigger = this.lastTriggerBySymbol.get(trade.symbol) || 0;
    const elapsedSinceLastTrigger = now - lastTrigger;

    if (lastTrigger > 0 && elapsedSinceLastTrigger < this.evaluationCooldown) {
      // Still in cooldown for this symbol
      const remainingHours = Math.floor((this.evaluationCooldown - elapsedSinceLastTrigger) / 3600000);
      const remainingMinutes = Math.ceil(((this.evaluationCooldown - elapsedSinceLastTrigger) % 3600000) / 60000);
      console.log(`⏱️ [${triggeredLevel.type} TRIGGER] Skipping ${trade.symbol} - cooldown active (${remainingHours}h ${remainingMinutes}m remaining)`);
      return;
    }

    // Update trigger timestamp for this symbol
    this.lastTriggerBySymbol.set(trade.symbol, now);

    console.log(`🚨 [${triggeredLevel.type} TRIGGER] AI EVALUATION TRIGGERED for ${trade.symbol} (3-hour cooldown starts for ${trade.symbol})`);
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
   * Sync trade levels (DCA, TP, SL) with actual orders on OKX
   * This ensures the AI has the absolute latest data
   */
  async syncTradeLevelsWithOkx(trade) {
    const {
      isExchangeTradingEnabled,
      getPreferredExchange,
      getOkxPendingOrders,
      getOkxAlgoOrders,
      OKX_SYMBOL_MAP
    } = require('./exchangeService');

    const exchangeConfig = isExchangeTradingEnabled();
    if (!exchangeConfig.enabled) return;

    const exchange = getPreferredExchange();
    const okxSymbol = OKX_SYMBOL_MAP[trade.symbol];

    if (!okxSymbol || !exchange) return;

    // 1. Fetch Pending Limit Orders (for DCA)
    try {
      const pendingOrders = await getOkxPendingOrders(
        okxSymbol,
        exchange.apiKey,
        exchange.apiSecret,
        exchange.passphrase,
        exchange.baseUrl
      );

      if (pendingOrders.success && pendingOrders.orders) {
        // Find DCA order (limit order in opposite direction of close, or same direction as entry)
        // For Long: Buy Limit below current price
        // For Short: Sell Limit above current price
        const dcaOrder = pendingOrders.orders.find(o => {
          const isBuy = trade.action === 'BUY';
          return o.ordType === 'limit' && (isBuy ? o.side === 'buy' : o.side === 'sell');
        });

        if (dcaOrder) {
          trade.dcaPrice = parseFloat(dcaOrder.px);
          trade.okxDcaOrderId = dcaOrder.ordId;
        } else {
          // If no DCA order found on OKX, clear it from memory
          // But only if we're sure (API call succeeded)
          // trade.dcaPrice = null; // Commented out to be safe, maybe user canceled manually
        }
      }
    } catch (e) {
      console.warn(`⚠️ Failed to fetch pending orders for ${trade.symbol}: ${e.message}`);
    }

    // 2. Fetch Algo Orders (for TP/SL)
    try {
      const algoOrders = await getOkxAlgoOrders(
        okxSymbol,
        'conditional', // TP/SL are usually conditional
        exchange.apiKey,
        exchange.apiSecret,
        exchange.passphrase,
        exchange.baseUrl
      );

      if (algoOrders.success && algoOrders.orders) {
        // Find TP and SL orders
        const activeAlgos = algoOrders.orders.filter(o =>
          o.state === 'live' || o.state === 'effective' || o.state === 'partially_filled'
        );

        let tpOrder = null;
        let slOrder = null;

        for (const order of activeAlgos) {
          // Check for TP
          if (order.tpTriggerPx) {
            tpOrder = order;
            trade.takeProfit = parseFloat(order.tpTriggerPx);
            trade.okxTpAlgoId = order.algoId;
          }

          // Check for SL
          if (order.slTriggerPx) {
            slOrder = order;
            trade.stopLoss = parseFloat(order.slTriggerPx);
            trade.okxSlAlgoId = order.algoId;
          }
        }
      }
    } catch (e) {
      console.warn(`⚠️ Failed to fetch algo orders for ${trade.symbol}: ${e.message}`);
    }
  }

  /**
   * Evaluate trade with Premium AI (DeepSeek R1)
   */
  async evaluateTradeWithPremiumAI(trade, triggeredLevel, priceData) {
    const apiKey = config.PREMIUM_API_KEY;
    const model = config.AI_MODEL || 'deepseek/deepseek-r1';

    if (!apiKey) {
      console.log('⚠️ Premium API key not set, skipping AI evaluation');
      return null;
    }

    const currentPrice = priceData.price;
    const pnlPercent = ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100;

    // SYNC WITH OKX: Ensure AI knows about current Limit (DCA), TP, and SL orders
    // This prevents the AI from suggesting moves that conflict with existing orders
    // or acting on stale data
    try {
      await this.syncTradeLevelsWithOkx(trade);
      console.log(`🔄 ${trade.symbol}: Synced trade levels with OKX before AI evaluation`);
      console.log(`   DCA: $${trade.dcaPrice || 'None'}, TP: $${trade.takeProfit || 'None'}, SL: $${trade.stopLoss || 'None'}`);
    } catch (syncError) {
      console.warn(`⚠️ ${trade.symbol}: Failed to sync levels with OKX, using memory values: ${syncError.message}`);
    }

    const prompt = `You are a professional crypto trading advisor. Analyze this OPEN TRADE and provide actionable recommendations.

**TRADE DETAILS:**
- Symbol: ${trade.symbol}
- Entry Price: $${trade.entryPrice.toFixed(6)}
- Current Price: $${currentPrice.toFixed(6)}
- Position Size: ${trade.amount} ${trade.symbol}
- P/L: ${pnlPercent > 0 ? '+' : ''}${pnlPercent.toFixed(2)}%
- DCA Count: ${trade.dcaCount || 0} / 5 (multi-tier strategy)

**CURRENT TRADE LEVELS:**
- Entry Price: $${trade.entryPrice.toFixed(2)}
- Current Price: $${currentPrice.toFixed(2)}
- Take Profit: $${trade.takeProfit ? trade.takeProfit.toFixed(2) : 'Not set'}
- Stop Loss: $${trade.stopLoss ? trade.stopLoss.toFixed(2) : 'Not set'}
- DCA Price: $${trade.dcaPrice ? trade.dcaPrice.toFixed(2) : 'Not set'}
- Position Size: ${trade.quantity || 'Unknown'}
- Unrealized P/L: ${pnlPercent.toFixed(2)}%

**DCA STRATEGY (5-TIER SYSTEM):**
This bot uses a 5-tier Dollar Cost Averaging strategy:
- Tier 1 (Initial): $10 for BTC, $5 for altcoins
- Tier 2 (DCA 1): $15 for BTC, $7.50 for altcoins
- Tier 3 (DCA 2): $25 for BTC, $12.50 for altcoins
- Tier 4 (DCA 3): $50 for BTC, $25 for altcoins
- Tier 5 (DCA 4): $100 for BTC, $50 for altcoins

Current position is at Tier ${Math.min((trade.dcaCount || 0) + 1, 5)} of 5.
Each DCA execution increases position size and moves to next tier.
DCA orders are placed as LIMIT ORDERS that auto-execute when price hits the level.

**DCA PRICE GUIDELINES:**
When recommending DCA prices, follow these distance rules from entry/average price:
- **BTC LONG positions**: DCA should be 10-15% BELOW entry/average price
- **Altcoin LONG positions**: DCA should be 15-25% BELOW entry/average price
- **BTC SHORT positions**: DCA should be 10-20% ABOVE entry/average price
- **Altcoin SHORT positions**: DCA should be 15-25% ABOVE entry/average price

Example: If BTC entry is $87,000 (LONG), DCA should be around $73,950-$78,300 (10-15% below).
Example: If ADA entry is $0.43 (LONG), DCA should be around $0.32-$0.37 (15-25% below).

**STOP LOSS BEHAVIOR:**
- SL is set as an ALGO ORDER on OKX that will AUTO-CLOSE the position when triggered
- You should NEVER recommend "CLOSE" action when SL is hit - it will close automatically
- If SL is triggered, recommend "KEEP" and explain that SL will handle the exit

**IMPORTANT**: You can see ALL 3 levels (TP, SL, DCA). When updating DCA, ensure it stays between SL and entry price:
- For BUY: stopLoss < dcaPrice < entryPrice < takeProfit
- For SELL: takeProfit < entryPrice < dcaPrice < stopLoss

If you want to move DCA but it would violate this rule, you should ALSO adjust SL to maintain proper spacing.

**TRIGGERED LEVEL:**
- Type: ${triggeredLevel.type}
- Distance: ${triggeredLevel.distance.toFixed(2)}%
- Target Price: $${triggeredLevel.targetPrice.toFixed(6)}
- Current Distance: ${Math.abs(currentPrice - triggeredLevel.targetPrice).toFixed(2)}

**TECHNICAL INDICATORS:**
- Price Source: ${priceData.source || 'MEXC'}
- Current Time: ${new Date().toISOString()}

**YOUR TASK:**
Provide a JSON response with your recommendations:

{
  "action": "KEEP" | "DCA" | "ADJUST_SL" | "ADJUST_TP" | "MODIFY",
  "reasoning": "Brief explanation of why",
  "recommendations": {
    "newStopLoss": <number or null>,  // New SL % if adjusting
    "newTakeProfit": <number or null>, // New TP % if adjusting
    "dcaAmount": <number or null>,     // DCA dollar amount (optional, for immediate execution)
    "dcaPrice": <number or null>       // DCA price level (REQUIRED if action is "DCA") - price where to add position
  },
  "urgency": "LOW" | "MEDIUM" | "HIGH",
  "confidence": <0-100>
}

IMPORTANT RULES:
- If action is "DCA": You MUST provide "dcaPrice" (the price level where to add position, e.g., $14.00)
  * For BUY trades: dcaPrice should be BELOW current price (buy the dip)
  * For SELL trades: dcaPrice should be ABOVE current price (short the rally)
  * dcaPrice is a DOLLAR AMOUNT (price level), NOT a percentage
- If action is "ADJUST_SL" or "ADJUST_TP": Provide newStopLoss or newTakeProfit as percentages
- If action is "MODIFY": Can adjust multiple parameters at once
- NEVER use "CLOSE" action - SL/TP algo orders will auto-execute when triggered

Consider:
1. Current market momentum
2. Risk/reward ratio
3. Position P/L
4. Proximity to key level
5. Market volatility
6. Current DCA tier and remaining capacity

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

      // Helper function to clean and parse JSON
      // WARNING: This function uses regex to fix malformed JSON, which can be fragile.
      // Ideally, the AI model should be prompted to return valid JSON to avoid this.
      const cleanAndParseJSON = (jsonString) => {
        try {
          // First, try direct parsing
          return JSON.parse(jsonString);
        } catch (e) {
          // If that fails, try cleaning common issues
          let cleaned = jsonString.trim();

          // Remove markdown code blocks if present
          cleaned = cleaned.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

          // Try to extract JSON object from text (find the first complete JSON object)
          const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            cleaned = jsonMatch[0];
          }

          // Fix common JSON issues step by step:

          // 1. Remove trailing commas before closing braces/brackets (safest fix)
          cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');

          // 2. Fix unquoted property names (only if they're clearly property names)
          // Match: {property: or ,property: (but not already quoted)
          cleaned = cleaned.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g, (match, prefix, propName, suffix) => {
            // Only fix if it's not already quoted
            if (!match.includes('"')) {
              return `${prefix}"${propName}"${suffix}`;
            }
            return match;
          });

          // 3. Fix single quotes around property names (more careful)
          // Match: 'property': (single quotes around property name)
          cleaned = cleaned.replace(/'([a-zA-Z_][a-zA-Z0-9_]*)':/g, '"$1":');

          // 4. Fix single quotes around string values (be careful not to break escaped quotes)
          // Match: : 'value' (but avoid matching inside already-quoted strings)
          // This is tricky, so we'll do a simple replacement for common cases
          cleaned = cleaned.replace(/:\s*'([^'\\]*(\\.[^'\\]*)*)'/g, ': "$1"');

          try {
            return JSON.parse(cleaned);
          } catch (e2) {
            // Log the problematic JSON for debugging
            console.error('❌ Failed to parse JSON after cleaning.');
            console.error('❌ Original error:', e.message);
            console.error('❌ After cleaning error:', e2.message);
            console.error('📄 Original JSON (first 1000 chars):', jsonString.substring(0, 1000));
            console.error('📄 Cleaned JSON (first 1000 chars):', cleaned.substring(0, 1000));
            console.error('📄 Error position:', e2.message.match(/position (\d+)/)?.[1] || 'unknown');

            // Try to show the problematic area around the error position
            if (e2.message.match(/position (\d+)/)) {
              const errorPos = parseInt(e2.message.match(/position (\d+)/)[1]);
              const start = Math.max(0, errorPos - 50);
              const end = Math.min(cleaned.length, errorPos + 50);
              console.error('📄 Problem area:', cleaned.substring(start, end));
              console.error('   '.padEnd(errorPos - start + 3, ' ') + '^');
            }

            throw e2;
          }
        }
      };

      // Try to extract JSON from response (handle R1's thinking tags)
      let jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const evaluation = cleanAndParseJSON(jsonMatch[0]);
          console.log(`✅ AI Evaluation received: ${evaluation.action} (${evaluation.confidence}% confidence)`);
          return evaluation;
        } catch (parseError) {
          console.error('❌ Failed to parse AI response JSON:', parseError.message);
          console.error('📄 AI Response snippet:', aiResponse.substring(0, 1000));
          return null;
        }
      }

      console.log('⚠️ Could not find JSON object in AI response');
      console.log('📄 AI Response:', aiResponse.substring(0, 500));
      return null;
    } catch (error) {
      console.error('❌ Error calling Premium AI:', error.message);
      if (error.response) {
        console.error('📄 Response data:', JSON.stringify(error.response.data, null, 2).substring(0, 500));
      }
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

    // AUTO-EXECUTE for Bybit demo trading
    const autoExecuteEnabled = config.AUTO_EXECUTE_AI_RECOMMENDATIONS !== false; // Default true for Bybit demo trading

    if (autoExecuteEnabled) {
      console.log(`🚀 AUTO-EXECUTING AI recommendation: ${aiEvaluation.action}`);
      const executed = await this.executeAIRecommendation(trade, aiEvaluation, recs);

      if (executed) {
        details += `\n✅ **AUTO-EXECUTED** by AI\n`;
      } else {
        details += `\n⚠️ **Execution failed** - see logs\n`;
      }
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
        aiEvaluation: aiEvaluation,
        autoExecuted: autoExecuteEnabled
      });
    }
  }

  /**
   * Execute AI recommendation (for Bybit demo trading)
   */
  async executeAIRecommendation(trade, aiEvaluation, recommendations) {
    if (!this.bot || !trade) {
      console.error('❌ Cannot execute - bot or trade not available');
      return false;
    }

    try {
      const action = aiEvaluation.action;

      switch (action) {
        case 'DCA':
          return await this.executeDCA(trade, recommendations);

        case 'ADJUST_SL':
          return await this.adjustStopLoss(trade, recommendations);

        case 'ADJUST_TP':
          return await this.adjustTakeProfit(trade, recommendations);

        case 'MODIFY':
          return await this.modifyTrade(trade, recommendations);

        case 'CLOSE':
          // SL/TP algo orders will auto-close the position - no manual intervention needed
          if (triggeredLevel && triggeredLevel.type === 'STOP_LOSS') {
            console.log(`ℹ️ AI recommended CLOSE for SL trigger, but SL algo order will auto-execute. No action needed.`);
            return true;
          }
          if (triggeredLevel && triggeredLevel.type === 'TAKE_PROFIT') {
            console.log(`ℹ️ AI recommended CLOSE for TP trigger, but TP algo order will auto-execute. No action needed.`);
            return true;
          }
          console.log(`⚠️ AI recommended CLOSE, but manual close not implemented. Use SL/TP algo orders instead.`);
          return false;

        case 'KEEP':
          console.log(`✅ AI recommends KEEP - no action needed for ${trade.symbol}`);
          return true;

        default:
          console.log(`⚠️ Unknown action: ${action}`);
          return false;
      }
    } catch (error) {
      console.error(`❌ Error executing AI recommendation:`, error.message);
      return false;
    }
  }

  /**
   * Execute DCA (add to position)
   * For Bybit demo trading: If only dcaPrice is provided, sets DCA level and existing logic will execute when price hits
   */
  async executeDCA(trade, recommendations) {
    // Find the trade in activeTrades array
    const tradeIndex = this.bot.activeTrades.findIndex(t =>
      (t.id === trade.id || t.tradeId === trade.id) && t.symbol === trade.symbol
    );

    if (tradeIndex === -1) {
      console.error(`❌ Trade ${trade.symbol} not found in active trades`);
      return false;
    }

    const activeTrade = this.bot.activeTrades[tradeIndex];

    // If dcaPrice is provided, update the DCA level and replace DCA order on OKX
    if (recommendations.dcaPrice && recommendations.dcaPrice > 0) {
      const { validateDcaPrice } = require('../utils/riskManagement');

      // VALIDATE DCA price to ensure it's on correct side of SL
      const validation = validateDcaPrice({
        action: activeTrade.action,
        entryPrice: activeTrade.entryPrice,
        stopLoss: activeTrade.stopLoss
      }, recommendations.dcaPrice);

      const newDcaPrice = validation.adjustedPrice;

      if (!validation.valid) {
        console.warn(`⚠️ ${trade.symbol}: AI provided invalid DCA price. ${validation.warning}`);
        console.log(`💰 Adjusted DCA to validated price: $${newDcaPrice.toFixed(2)}`);
      } else {
        console.log(`💰 Updating DCA level for ${trade.symbol}: $${recommendations.dcaPrice.toFixed(2)}`);
      }

      // Cancel old DCA limit order and place new one (like SL/TP updates)
      try {
        const { isExchangeTradingEnabled, getPreferredExchange, getOkxPendingOrders, cancelOkxOrders, executeOkxLimitOrder, OKX_SYMBOL_MAP } = require('../services/exchangeService');
        const exchangeConfig = isExchangeTradingEnabled();

        if (exchangeConfig.enabled && this.bot.cancelTradeAlgoOrders) {
          const exchange = getPreferredExchange();
          const okxSymbol = OKX_SYMBOL_MAP[activeTrade.symbol];

          if (exchange && okxSymbol && activeTrade.okxDcaOrderId) {
            // Cancel old DCA limit order
            console.log(`🔄 Cancelling old DCA limit order...`);
            const cancelResult = await cancelOkxOrders(
              [{ instId: okxSymbol, ordId: activeTrade.okxDcaOrderId }],
              exchange.apiKey,
              exchange.apiSecret,
              exchange.passphrase,
              exchange.baseUrl
            );

            if (cancelResult.success) {
              console.log(`   ✅ Old DCA limit order cancelled`);
              activeTrade.okxDcaOrderId = null;
            } else {
              console.error(`❌ Failed to cancel old DCA order (ID: ${activeTrade.okxDcaOrderId}). Aborting new order placement to prevent duplicates.`);
              return false;
            }
          }

          // Place new DCA limit order at new price
          if (exchange && okxSymbol) {
            console.log(`📝 Placing new DCA limit order at $${newDcaPrice.toFixed(2)}...`);
            const dcaSide = activeTrade.action === 'BUY' ? 'buy' : 'sell';
            const dcaQuantity = activeTrade.quantity * 0.5; // Add 50% more to position

            const dcaResult = await executeOkxLimitOrder(
              okxSymbol,
              dcaSide,
              dcaQuantity,
              newDcaPrice,
              exchange.apiKey,
              exchange.apiSecret,
              exchange.passphrase,
              exchange.baseUrl
            );

            if (dcaResult.success) {
              activeTrade.okxDcaOrderId = dcaResult.orderId;
              console.log(`   ✅ New DCA limit order placed (Order ID: ${dcaResult.orderId})`);
            } else {
              console.warn(`   ⚠️ Failed to place new DCA order: ${dcaResult.error || 'Unknown error'}`);
            }
          }
        }
      } catch (error) {
        console.error(`⚠️ Error updating DCA order on OKX: ${error.message}`);
        // Continue anyway - update happens in memory
      }

      // Update trade values in memory
      activeTrade.addPosition = newDcaPrice;
      activeTrade.dcaPrice = newDcaPrice;

      console.log(`✅ DCA level updated to $${newDcaPrice.toFixed(2)}`);
      return true;
    }

    // If dcaAmount is provided, execute DCA immediately (legacy support)
    if (recommendations.dcaAmount && recommendations.dcaAmount > 0) {
      console.log(`💰 Executing DCA for ${trade.symbol}:`);
      console.log(`   Amount: ${recommendations.dcaAmount}`);
      console.log(`   Current Position: ${activeTrade.quantity || 0}`);

      // Get current price for DCA
      const priceData = await this.fetchCurrentPrice(trade.symbol.replace('USDT', ''));
      if (!priceData) {
        console.error('❌ Could not fetch current price for DCA');
        return false;
      }

      const dcaPrice = priceData.price;
      const dcaAmount = recommendations.dcaAmount;

      // Calculate new average entry price
      const currentQuantity = activeTrade.quantity || 0;
      const avgEntry = activeTrade.averageEntryPrice || activeTrade.entryPrice;
      const currentValue = currentQuantity * avgEntry;
      const dcaQuantity = dcaAmount / dcaPrice;
      const newQuantity = currentQuantity + dcaQuantity;
      const newEntryPrice = (currentValue + dcaAmount) / newQuantity;

      // Update the trade
      activeTrade.quantity = newQuantity;
      activeTrade.averageEntryPrice = newEntryPrice;
      activeTrade.dcaCount = (activeTrade.dcaCount || 0) + 1;
      activeTrade.dcaExecutions = activeTrade.dcaExecutions || [];
      activeTrade.dcaExecutions.push({
        price: dcaPrice,
        amount: dcaAmount,
        quantity: dcaQuantity,
        timestamp: new Date(),
        reasoning: 'AI recommended DCA'
      });

      // Update DCA price if provided
      if (recommendations.dcaPrice) {
        const { validateDcaPrice } = require('../utils/riskManagement');

        // VALIDATE DCA price
        const validation = validateDcaPrice({
          action: activeTrade.action,
          entryPrice: activeTrade.entryPrice,
          stopLoss: activeTrade.stopLoss
        }, recommendations.dcaPrice);

        activeTrade.addPosition = validation.adjustedPrice;
        activeTrade.dcaPrice = validation.adjustedPrice;

        if (!validation.valid) {
          console.warn(`⚠️ ${trade.symbol}: ${validation.warning}`);
        }
      }

      // Save trades
      // Removed: DynamoDB persistence - OKX is the only source of truth

      console.log(`✅ DCA executed successfully`);
      console.log(`   New average entry: $${newEntryPrice.toFixed(2)}`);
      console.log(`   New position size: ${newQuantity.toFixed(4)}`);

      return true;
    }

    // If neither dcaPrice nor dcaAmount is provided, try to calculate a reasonable DCA price
    // For BUY: 10% below current price, For SELL: 10% above current price
    const currentPrice = activeTrade.currentPrice || activeTrade.entryPrice;
    if (currentPrice && currentPrice > 0) {
      const { validateDcaPrice } = require('../utils/riskManagement');

      let proposedDca;
      if (activeTrade.action === 'BUY') {
        proposedDca = currentPrice * 0.90; // 10% below for BUY
      } else {
        proposedDca = currentPrice * 1.10; // 10% above for SELL
      }

      // VALIDATE DCA price to ensure it's on correct side of SL
      const validation = validateDcaPrice({
        action: activeTrade.action,
        entryPrice: activeTrade.entryPrice,
        stopLoss: activeTrade.stopLoss
      }, proposedDca);

      activeTrade.addPosition = validation.adjustedPrice;
      activeTrade.dcaPrice = validation.adjustedPrice;

      if (!validation.valid) {
        console.warn(`⚠️ ${trade.symbol}: ${validation.warning}`);
        console.log(`💰 DCA level set to validated price: $${validation.adjustedPrice.toFixed(2)}`);
      } else {
        console.log(`⚠️ No DCA price specified. Using calculated DCA price: $${validation.adjustedPrice.toFixed(2)} (10% ${activeTrade.action === 'BUY' ? 'below' : 'above'} current price)`);
      }

      // Save trades
      // Removed: DynamoDB persistence - OKX is the only source of truth

      console.log(`✅ DCA level set to $${validation.adjustedPrice.toFixed(2)}. Will execute automatically when price hits this level.`);
      return true;
    }

    console.log('⚠️ No DCA price or amount specified, and could not calculate DCA price. AI should provide dcaPrice (price level).');
    return false;
  }

  /**
   * Adjust stop loss
   */
  async adjustStopLoss(trade, recommendations) {
    if (!recommendations.newStopLoss) {
      console.log('⚠️ No new stop loss specified');
      return false;
    }

    console.log(`🛡️ Adjusting Stop Loss for ${trade.symbol}:`);
    console.log(`   Old SL: ${trade.stopLoss}%`);
    console.log(`   New SL: ${recommendations.newStopLoss}%`);

    // Find the trade
    const tradeIndex = this.bot.activeTrades.findIndex(t =>
      t.symbol === trade.symbol && t.entryTime === trade.entryTime
    );

    if (tradeIndex === -1) {
      console.error('❌ Trade not found');
      return false;
    }

    // Update stop loss
    this.bot.activeTrades[tradeIndex].stopLoss = recommendations.newStopLoss;
    this.bot.activeTrades[tradeIndex].slAdjustments = this.bot.activeTrades[tradeIndex].slAdjustments || [];
    this.bot.activeTrades[tradeIndex].slAdjustments.push({
      oldSL: trade.stopLoss,
      newSL: recommendations.newStopLoss,
      timestamp: new Date(),
      reasoning: 'AI adjustment'
    });

    // Cancel old algo orders and place new ones with updated SL
    // This prevents duplicate orders with different SL levels
    if (this.bot.cancelTradeAlgoOrders && this.bot.placeTradeAlgoOrders) {
      try {
        console.log(`🔄 Cancelling old TP/SL algo orders for ${trade.symbol}...`);
        await this.bot.cancelTradeAlgoOrders(this.bot.activeTrades[tradeIndex]);
        console.log(`✅ Old algo orders cancelled`);

        // Place new algo orders with updated SL
        console.log(`📝 Placing new TP/SL algo orders with updated SL...`);
        await this.bot.placeTradeAlgoOrders(this.bot.activeTrades[tradeIndex]);
        console.log(`✅ New algo orders placed`);
      } catch (error) {
        console.error(`⚠️ Failed to update algo orders: ${error.message}`);
      }
    }

    // Save trades
    // Removed: DynamoDB persistence - OKX is the only source of truth

    console.log(`✅ Stop Loss adjusted successfully`);
    return true;
  }

  /**
   * Adjust take profit
   */
  async adjustTakeProfit(trade, recommendations) {
    if (!recommendations.newTakeProfit) {
      console.log('⚠️ No new take profit specified');
      return false;
    }

    console.log(`🎯 Adjusting Take Profit for ${trade.symbol}:`);
    console.log(`   Old TP: ${trade.takeProfit}%`);
    console.log(`   New TP: ${recommendations.newTakeProfit}%`);

    // Find the trade
    const tradeIndex = this.bot.activeTrades.findIndex(t =>
      t.symbol === trade.symbol && t.entryTime === trade.entryTime
    );

    if (tradeIndex === -1) {
      console.error('❌ Trade not found');
      return false;
    }

    // Update take profit
    this.bot.activeTrades[tradeIndex].takeProfit = recommendations.newTakeProfit;
    this.bot.activeTrades[tradeIndex].tpAdjustments = this.bot.activeTrades[tradeIndex].tpAdjustments || [];
    this.bot.activeTrades[tradeIndex].tpAdjustments.push({
      oldTP: trade.takeProfit,
      newTP: recommendations.newTakeProfit,
      timestamp: new Date(),
      reasoning: 'AI adjustment'
    });

    // Cancel old algo orders and place new ones with updated TP
    // This prevents duplicate orders with different TP levels
    if (this.bot.cancelTradeAlgoOrders && this.bot.placeTradeAlgoOrders) {
      try {
        console.log(`🔄 Cancelling old TP/SL algo orders for ${trade.symbol}...`);
        await this.bot.cancelTradeAlgoOrders(this.bot.activeTrades[tradeIndex]);
        console.log(`✅ Old algo orders cancelled`);

        // Place new algo orders with updated TP
        console.log(`📝 Placing new TP/SL algo orders with updated TP...`);
        await this.bot.placeTradeAlgoOrders(this.bot.activeTrades[tradeIndex]);
        console.log(`✅ New algo orders placed`);
      } catch (error) {
        console.error(`⚠️ Failed to update algo orders: ${error.message}`);
      }
    }

    // Save trades
    // Removed: DynamoDB persistence - OKX is the only source of truth

    console.log(`✅ Take Profit adjusted successfully`);
    return true;
  }

  /**
   * Modify trade (adjust both SL and TP)
   */
  async modifyTrade(trade, recommendations) {
    let success = true;

    if (recommendations.newStopLoss) {
      const slSuccess = await this.adjustStopLoss(trade, recommendations);
      success = success && slSuccess;
    }

    if (recommendations.newTakeProfit) {
      const tpSuccess = await this.adjustTakeProfit(trade, recommendations);
      success = success && tpSuccess;
    }

    if (recommendations.dcaPrice) {
      // Update DCA price
      const tradeIndex = this.bot.activeTrades.findIndex(t =>
        t.symbol === trade.symbol && t.entryTime === trade.entryTime
      );

      if (tradeIndex !== -1) {
        this.bot.activeTrades[tradeIndex].dcaPrice = recommendations.dcaPrice;
        const { saveTrades } = require('./tradePersistenceService');
        await saveTrades(this.bot.activeTrades);
        console.log(`✅ DCA price updated to $${recommendations.dcaPrice.toFixed(6)}`);
      }
    }

    return success;
  }

  /**
   * Close trade early (AI decision)
   */
  async closeTrade(trade, reasoning) {
    console.log(`🚪 Closing trade ${trade.symbol} - AI Decision`);
    console.log(`   Reasoning: ${reasoning}`);

    // Find the trade
    const tradeIndex = this.bot.activeTrades.findIndex(t =>
      t.symbol === trade.symbol && t.entryTime === trade.entryTime
    );

    if (tradeIndex === -1) {
      console.error('❌ Trade not found');
      return false;
    }

    // Get current price
    const priceData = await this.fetchCurrentPrice(trade.symbol.replace('USDT', ''));
    if (!priceData) {
      console.error('❌ Could not fetch current price for closing');
      return false;
    }

    const exitPrice = priceData.price;

    // Close the trade using bot's method
    if (this.bot.closeTrade) {
      await this.bot.closeTrade(trade.symbol, 'AI_DECISION', exitPrice, reasoning);
      console.log(`✅ Trade closed at $${exitPrice.toFixed(6)}`);
      return true;
    } else {
      console.error('❌ Bot closeTrade method not available');
      return false;
    }
  }
}

module.exports = new TradeMonitoringService();

