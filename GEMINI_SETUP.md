# Gemini API Setup Guide

## ✅ System Now Supports Both APIs!

Your two-tier monitoring system now works with:
- **Gemini API (Google)** - Completely FREE! ✨
- **OpenRouter API** - Pay as you go

## 🔑 Setting Up Your Gemini API Key

### 1. Get Your Gemini API Key

1. Go to: https://aistudio.google.com/app/apikey
2. Sign in with your Google account
3. Click "Create API Key"
4. Copy your key (starts with `AIza...`)

### 2. Set the Environment Variable

```bash
# For current session
export AI_API_KEY=AIza_your_gemini_key_here

# For permanent setup (recommended)
echo 'export AI_API_KEY=AIza_your_gemini_key_here' >> ~/.zshrc
source ~/.zshrc
```

### 3. Verify Your Setup

The system will automatically detect it's a Gemini API key and configure accordingly:

```bash
# When you start the bot, you should see:
🔧 Configuration Status:
   AI API Type: GEMINI (Google)
   AI Model (Premium): gemini-1.5-pro
   AI Key: ENABLED ✅

🤖 Two-Tier AI Monitoring:
   Monitoring: ENABLED ✅
   Free Model: gemini-1.5-flash
   Premium Model: gemini-1.5-pro
```

## 🎯 How It Works with Gemini

### Two-Tier System:

**Tier 1 (Free Monitoring):**
- Model: `gemini-1.5-flash`
- Runs: Every minute
- Cost: **FREE!** 💰
- Purpose: Quick volatility checks
- Rate Limit: 15 requests/minute (generous!)

**Tier 2 (Premium Confirmation):**
- Model: `gemini-1.5-pro`
- Runs: Only when escalated (high confidence opportunities)
- Cost: **FREE!** 💰
- Purpose: Deep analysis and final decision
- Rate Limit: 2 requests/minute

## 💡 Gemini vs OpenRouter

| Feature | Gemini (Google) | OpenRouter |
|---------|----------------|------------|
| Free Tier | ✅ Completely FREE | ❌ Pay per token |
| Rate Limits | 15-60 req/min | Depends on credits |
| Models | Gemini Flash/Pro | DeepSeek R1, many others |
| Setup | Simple, one key | Requires credits |
| Best For | Free monitoring! | Multiple model access |

## 🚀 Testing Your Setup

Run the test script:

```bash
cd /Users/ramiabboud/workspace/my-deepseek-bot
node test-monitoring.js
```

Expected output:
```
🧪 Testing Two-Tier AI Monitoring System

📋 Configuration:
   AI_API_KEY: ✅ Set (AIza...)
   API Type: GEMINI (Google)
   Monitoring Enabled: ✅
   Free Model: gemini-1.5-flash
   Premium Model: gemini-1.5-pro

🔍 Testing free monitoring (gemini-1.5-flash)...
✅ Free model working!
   Signal: OPPORTUNITY
   Confidence: 75%
   Should Escalate: Yes

🚨 Testing premium model escalation (gemini-1.5-pro)...
✅ Premium model working!
   Decision: CONFIRMED
   Action: BUY

🎉 SUCCESS! Your monitoring system is ready to use!

💰 Cost Benefits:
   Gemini Flash: COMPLETELY FREE!
   Gemini Pro: COMPLETELY FREE!
   No costs at all within rate limits! 🎉
```

## 📱 Telegram Notifications

When opportunities are found, you'll receive:

**Escalation Alert:**
```
🚨 AI ESCALATION ALERT

📊 Coin: BTC
🤖 Free AI (gemini-1.5-flash) detected opportunity
📈 Signal: OPPORTUNITY
💪 Confidence: 78%
📝 Reason: High volatility spike with strong volume

⏳ Escalating to Premium AI (gemini-1.5-pro) for confirmation...
```

**Decision Result:**
```
✅ PREMIUM AI DECISION: CONFIRMED

📊 Coin: BTC
🎯 Action: BUY
💪 Premium Confidence: 82%
📝 Premium Analysis: Strong breakout pattern with support
🛡️ Stop Loss: 5%
🎯 Take Profit: 12%

---
🤖 Free AI Initial: OPPORTUNITY (78%)
📝 Free AI Reason: High volatility spike with strong volume
```

## 🎮 Start Your Bot

```bash
npm start
```

The monitoring will automatically:
1. Start every minute
2. Check top 20 coins for volatility
3. Escalate to premium model when needed (≥70% confidence)
4. Send Telegram alerts
5. Execute paper trades if confirmed

## ⚠️ Rate Limits

Gemini is generous but has limits:

- **Flash**: 15 requests/minute, 1,500/day
- **Pro**: 2 requests/minute, 50/day

Our system is optimized:
- Monitors 20 coins/minute = ~1 Flash request
- Only escalates when needed = ~2-5 Pro requests/hour

You're well within limits! 🎉

## 🔧 Troubleshooting

### Error: "API key not valid"
- Get a new key from: https://aistudio.google.com/app/apikey
- Make sure it starts with `AIza`
- Check you exported it: `echo $AI_API_KEY`

### Error: "Resource has been exhausted"
- You've hit rate limits
- Wait a minute and try again
- Flash: 15/min, Pro: 2/min

### Error: "API not enabled"
- Enable Gemini API in Google Cloud Console
- Go to: https://console.cloud.google.com/
- Enable "Generative Language API"

## 💎 Benefits of Using Gemini

✅ **Completely FREE** - No credit card needed!
✅ **Fast responses** - Low latency
✅ **Generous limits** - Enough for continuous monitoring
✅ **Great quality** - Gemini Pro rivals GPT-4
✅ **Simple setup** - Just one API key

Enjoy your FREE AI-powered crypto monitoring! 🚀

