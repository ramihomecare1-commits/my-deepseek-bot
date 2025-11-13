# 🌍 Bypass Geo-Restrictions for Binance & Exchange APIs

## Problem
Render's data center IPs are blocked by Binance and other exchanges (Error 451).

## ✅ Solution: Use ScraperAPI Proxy

ScraperAPI routes your requests through residential IPs, bypassing geo-blocks.

### Option 1: ScraperAPI (Recommended - FREE Tier Available) ⭐

**Free Tier:**
- 1,000 requests/month FREE
- Perfect for testing
- Automatic IP rotation

**Paid Plans:**
- $49/month = 100,000 requests
- $99/month = 250,000 requests
- Enterprise options available

**Setup:**

1. **Sign up at:** https://www.scraperapi.com/
2. **Get your API key** from the dashboard
3. **Add to Render environment variables:**
   ```
   SCRAPER_API_KEY = your_key_here
   ```
4. **Redeploy** - Binance data will now work!

**How it works:**
- Without ScraperAPI: `Your Bot → Binance` ❌ (Blocked)
- With ScraperAPI: `Your Bot → ScraperAPI → Binance` ✅ (Works!)

---

## Alternative Solutions

### Option 2: Oxylabs (Premium)
- More expensive but very reliable
- $199/month minimum
- Better for high-volume production use
- https://oxylabs.io/

### Option 3: Bright Data (Enterprise)
- Most expensive but best quality
- $500/month+
- Used by Fortune 500 companies
- https://brightdata.com/

### Option 4: Deploy on Your Own Server
- Run the bot on your home/office server
- Free but requires:
  - Static IP
  - 24/7 uptime
  - Port forwarding
  - Security setup

### Option 5: Use CryptoCompare Only
- No geo-restrictions
- Already configured in your bot
- Slightly less rich data than Binance
- Free tier: 100,000 calls/month
- Already working! No proxy needed.

---

## 💰 Cost Comparison

| Solution | Monthly Cost | Setup Time | Data Quality |
|----------|-------------|------------|--------------|
| **ScraperAPI Free** ⭐ | $0 (1K requests) | 5 min | Excellent |
| **ScraperAPI Paid** | $49+ | 5 min | Excellent |
| **CryptoCompare Only** | $0 | 0 min | Very Good |
| **Own Server** | $0 (hardware) | 2-4 hours | Excellent |
| **Oxylabs** | $199+ | 15 min | Excellent |

---

## 🎯 Recommendation

**For your use case (10 coins, hourly scans):**

1. **Start with CryptoCompare** (Already working!)
   - You already have the API key configured
   - No proxy needed
   - Data quality is great for technical analysis
   - FREE!

2. **If you want Binance specifically:**
   - Add ScraperAPI free tier (1,000 requests/month)
   - Each scan = ~10 requests (one per coin)
   - 1,000 requests = 100 scans = 4+ days of hourly scanning
   - Then upgrade to paid if needed

---

## 📊 Current Data Sources (Without Proxy)

Your bot currently uses (in priority order):

1. **CoinMarketCap** - Current prices ✅
2. **CryptoCompare** - Historical data ✅ (Working!)
3. **CoinGecko** - Fallback ⚠️ (Rate limited)
4. **CoinPaprika** - Fallback ⚠️ (Rate limited)
5. **Binance** - Preferred historical ❌ (Geo-blocked)

**Bottom line:** You're already getting good data from CryptoCompare! Binance is optional.

---

## 🚀 Quick Start (ScraperAPI)

1. Go to: https://www.scraperapi.com/signup
2. Sign up (free account)
3. Copy your API key
4. In Render dashboard → Environment → Add:
   ```
   SCRAPER_API_KEY = sk-xxxxxxxxxxxxx
   ```
5. Restart service
6. Check logs for: `ScraperAPI Proxy: ENABLED ✅`
7. Binance data now works!

---

## ❓ FAQ

**Q: Is CryptoCompare data good enough?**
A: Yes! It's excellent for technical analysis. Binance is just slightly more real-time.

**Q: How many requests do I use?**
A: 10 coins × 3 timeframes × 1 scan/hour = ~720 requests/month

**Q: Can I use ScraperAPI free tier?**
A: Yes! 1,000 free requests = ~33 scans = perfect for testing

**Q: Will this slow down my bot?**
A: Slightly (~1-2 seconds per scan), but not noticeable

**Q: Is it legal?**
A: Yes! ScraperAPI is a legitimate service used by thousands of companies.

