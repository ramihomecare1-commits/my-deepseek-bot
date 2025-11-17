# 🔥 HYBRID API Setup Guide

## Best of Both Worlds: Gemini (FREE) + DeepSeek R1 (PREMIUM)

This is the **optimal setup** for your two-tier monitoring system!

### Why Hybrid Mode?

✅ **FREE monitoring** - Gemini Flash monitors every minute (completely free!)  
✅ **BEST confirmations** - DeepSeek R1 only when needed (pay per use, but it's the best!)  
✅ **Cost efficient** - Only pay for high-confidence opportunities  
✅ **High quality** - Get Google's speed with DeepSeek's reasoning power

## 🎯 How It Works

```
Every Minute:
├─ Gemini Flash (FREE) scans 20 coins
├─ Detects volatility > 3%
└─ If opportunity found (confidence ≥ 70%)
    ├─ 🚨 Escalate to DeepSeek R1 (PREMIUM)
    ├─ R1 analyzes deeply ($0.02-0.05)
    └─ ✅ Confirmed → Execute trade
        or
        ❌ Rejected → Store for learning
```

## 🔑 Setup Instructions

### Step 1: Get Your Gemini API Key (FREE)

1. Go to: https://aistudio.google.com/app/apikey
2. Sign in with your Google account
3. Click "Create API Key"
4. Copy your key (starts with `AIza...`)

### Step 2: Get Your OpenRouter API Key

1. Go to: https://openrouter.ai/keys
2. Sign up / login
3. Create a new API key
4. Copy your key (starts with `sk-or-v1-...`)
5. Add $1-5 credits (only charged when R1 is called)

### Step 3: Set BOTH Environment Variables

```bash
# Set Gemini key for FREE monitoring
export GEMINI_API_KEY=AIza_your_gemini_key_here

# Set OpenRouter key for PREMIUM confirmations
export OPENROUTER_API_KEY=sk-or-v1-your_openrouter_key_here
```

**For permanent setup:**
```bash
echo 'export GEMINI_API_KEY=AIza_your_gemini_key_here' >> ~/.zshrc
echo 'export OPENROUTER_API_KEY=sk-or-v1-your_openrouter_key_here' >> ~/.zshrc
source ~/.zshrc
```

### Step 4: Verify Your Setup

When you start the bot, you should see:

```
🤖 Two-Tier AI Monitoring:
   Monitoring: ENABLED ✅
   Mode: HYBRID (Gemini + DeepSeek) 🔥

   📊 FREE TIER (Monitoring every minute):
      Model: gemini-1.5-flash
      API: GEMINI (Google)
      Key: ✅ Set
      Cost: FREE! 🎉

   💎 PREMIUM TIER (Confirmations only):
      Model: deepseek/deepseek-r1
      API: OPENROUTER (OpenRouter)
      Key: ✅ Set
      Cost: ~$0.02-0.05 per call

   ⚙️  Settings:
      Interval: 60s
      Escalation: 70% confidence
      Volatility: 3.0% trigger
```

## 💰 Cost Breakdown

### Without Hybrid (OpenRouter Only):
- Monitoring: 20 coins/min × 60 min × $0.001 = **$1.20/hour**
- Confirmations: 5 calls/hour × $0.04 = **$0.20/hour**
- **Total: ~$1.40/hour** = **$33.60/day** 😱

### With Hybrid (Gemini + DeepSeek R1):
- Monitoring: **FREE!** (Gemini Flash) 🎉
- Confirmations: 5 calls/hour × $0.04 = **$0.20/hour**
- **Total: ~$0.20/hour** = **$4.80/day** ✨

### Savings: **85% cost reduction!** 🚀

## 📱 What You'll See in Telegram

**When Free Tier Detects Opportunity:**
```
🚨 AI ESCALATION ALERT

📊 Coin: BTC
🤖 Free AI (gemini-1.5-flash) detected opportunity
📈 Signal: OPPORTUNITY
💪 Confidence: 78%
📝 Reason: High volatility spike with strong volume

⏳ Escalating to Premium AI (deepseek/deepseek-r1) for confirmation...
```

**When Premium Tier Decides:**
```
✅ PREMIUM AI DECISION: CONFIRMED

📊 Coin: BTC
🎯 Action: BUY
💪 Premium Confidence: 85%
📝 Premium Analysis: Strong breakout pattern confirmed with 
     institutional volume. Support level holding at $94,500.
     Momentum indicators aligned.

🛡️ Stop Loss: 5%
🎯 Take Profit: 12%

---
🤖 Free AI Initial: OPPORTUNITY (78%)
📝 Free AI Reason: High volatility spike with strong volume
```

## 🚀 Start Your Bot

```bash
npm start
```

The system will automatically:
1. Detect HYBRID mode from your API keys
2. Use Gemini Flash for FREE monitoring every minute
3. Escalate to DeepSeek R1 only when needed (≥70% confidence)
4. Send Telegram alerts for escalations and decisions
5. Execute trades via Bybit API if confirmed

## 📊 Typical Usage Pattern

**Per Hour:**
- Gemini Flash calls: ~60 (FREE)
- DeepSeek R1 calls: ~2-5 (only when opportunities found)

**Per Day:**
- Gemini Flash calls: ~1,440 (FREE)
- DeepSeek R1 calls: ~50-120 
- **Cost: ~$1-3 per day** vs $30+ without hybrid!

## ⚙️ Advanced Configuration

### Adjust Escalation Threshold
```bash
# Only escalate when FREE model is 80% confident
export ESCALATION_THRESHOLD=0.80
```

### Adjust Volatility Trigger
```bash
# Only check coins with 5%+ price change
export VOLATILITY_THRESHOLD=5.0
```

### Change Monitoring Interval
```bash
# Monitor every 2 minutes instead of 1
export MONITORING_INTERVAL=120000
```

## 🔧 Troubleshooting

### "Mode: Gemini Only" (HYBRID mode not detected)

**Problem:** Only one API key is set

**Solution:**
```bash
# Check both keys are set
echo $GEMINI_API_KEY
echo $OPENROUTER_API_KEY

# If missing, export both:
export GEMINI_API_KEY=AIza...
export OPENROUTER_API_KEY=sk-or-v1-...
```

### Gemini Rate Limit Error

**Problem:** "Resource has been exhausted"

**Solution:** 
- Gemini Flash: 15 requests/minute
- We monitor 20 coins but make only 1-2 Gemini calls/minute
- You're probably fine, just wait a minute

### DeepSeek R1 Insufficient Credits

**Problem:** "Insufficient credits"

**Solution:**
- Add credits to OpenRouter: https://openrouter.ai/credits
- $5 = ~100-200 R1 calls = several days of monitoring

## 💡 Pro Tips

1. **Start with HYBRID** - Get the best quality at lowest cost
2. **Monitor the logs** - Watch how often R1 is called
3. **Adjust threshold** - Higher threshold = fewer R1 calls = lower cost
4. **Check Gemini limits** - 1,500 free calls per day (we use ~1,440)
5. **Track R1 accuracy** - See if it's worth the cost vs Gemini Pro

## 📈 Upgrade Path

Start here → Monitor costs → Adjust as needed:

1. **HYBRID (Recommended)** - Gemini FREE + DeepSeek R1 premium
2. **All Gemini** - Completely free, slightly lower quality
3. **All OpenRouter** - Highest cost, access to many models
4. **Custom Models** - Set your own models per tier

## 🎯 Next Steps

1. Set both API keys
2. Start the bot: `npm start`
3. Watch for the "HYBRID mode" message
4. Monitor Telegram for alerts
5. Check your OpenRouter usage after 24 hours
6. Adjust thresholds if needed

Enjoy the best of both worlds! 🚀

---

**Questions?**
- Check logs for API errors
- Verify both keys are exported: `env | grep API`
- Test with: `node test-monitoring.js`

