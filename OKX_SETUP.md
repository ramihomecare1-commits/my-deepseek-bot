# OKX Demo Trading Setup Guide

## ✅ What's Been Changed

1. **Removed Bybit completely** - No longer primary or secondary
2. **OKX is now the only exchange** - All trading goes through OKX Demo
3. **Direct connection first** - Tries direct connection, then falls back to proxy if needed
4. **Automatic proxy fallback** - Direct → ScrapeOps → ScraperAPI (if configured)

## 📋 What You Need to Do

### Step 1: Create OKX Demo Account

1. Go to **https://www.okx.com**
2. Sign up for an account (or log in if you have one)
3. Navigate to **Demo Trading** section
4. Create a Demo Trading account
5. You'll get demo funds (usually $100,000 USDT)

### Step 2: Create API Keys

1. Go to **OKX Dashboard** → **API Management**
2. Click **Create API Key**
3. Set the following:
   - **API Key Name**: `Trading Bot` (or any name)
   - **Passphrase**: Create a strong passphrase (you'll need this!)
   - **Permissions**: 
     - ✅ **Read** (required)
     - ✅ **Trade** (required)
   - **IP Restriction**: Leave empty (or add your server IP if you want)
4. **IMPORTANT**: Save these 3 values:
   - **API Key** (starts with something like `abc123...`)
   - **API Secret** (shown only once - copy it immediately!)
   - **Passphrase** (the one you created)

### Step 3: Add Environment Variables

Add these to your Render.com environment variables (or `.env` file if running locally):

```
OKX_API_KEY=your_api_key_here
OKX_API_SECRET=your_api_secret_here
OKX_PASSPHRASE=your_passphrase_here
```

**Important Notes:**
- These are for **Demo Trading** - your API keys are from the Demo Trading account
- The passphrase is the one you created when generating the API key
- Keep these secure - never commit them to git

### Step 4: Test the Connection

1. Deploy/restart your bot
2. Click the **"🔗 Test OKX Connection"** button in the UI
3. You should see:
   - ✅ Configuration status
   - ✅ Balance test (should show your demo USDT balance)
   - ✅ Positions test (should show any open positions)

## 🔄 How It Works

### Connection Strategy:
1. **First attempt**: Direct connection to OKX (fastest)
2. **If direct fails**: Automatically tries ScrapeOps proxy (if configured)
3. **If ScrapeOps fails**: Automatically tries ScraperAPI proxy (if configured)
4. **If all fail**: Shows error with details

### What Gets Executed:
- ✅ **New trades** → Executed on OKX Demo
- ✅ **Take Profit** → Executed on OKX Demo
- ✅ **Stop Loss** → Executed on OKX Demo
- ✅ **DCA (Add Position)** → Executed on OKX Demo
- ✅ **Position syncing** → Fetched from OKX (source of truth)

## 🎯 Trading Pairs

OKX uses the format: `BTC-USDT`, `ETH-USDT`, etc. (with hyphen)

Supported coins:
- BTC, ETH, BNB, SOL, XRP, DOGE, ADA, AVAX, LINK, DOT, MATIC, LTC
- UNI, ATOM, XLM, ETC, XMR, ALGO, FIL, ICP, VET, EOS, XTZ, AAVE
- MKR, GRT, THETA, RUNE, NEO, FTM, TRX, SUI, ARB, OP, TON, SHIB
- HBAR, APT

## ⚠️ Troubleshooting

### "OKX is not configured"
- Check that all 3 environment variables are set: `OKX_API_KEY`, `OKX_API_SECRET`, `OKX_PASSPHRASE`
- Make sure there are no extra spaces or quotes

### "Invalid API key or signature"
- Verify your API key and secret are correct
- Check that your passphrase matches what you set when creating the API key
- Ensure API key has **Read** and **Trade** permissions

### "Symbol not available on OKX"
- The coin might not be supported on OKX
- Check the supported coins list above

### Connection timeouts
- The bot will automatically try proxies if direct connection fails
- Check logs to see which connection method succeeded

## 📝 Notes

- **Demo Trading Only**: All trades execute on OKX Demo account (risk-free)
- **No Real Money**: Demo account uses virtual funds
- **Position Syncing**: OKX is the source of truth for positions, DynamoDB stores metadata
- **Proxy Fallback**: If direct connection is geo-blocked, proxies will be used automatically

## 🚀 Ready to Go!

Once you've added the 3 environment variables and restarted the bot, you're all set! The bot will:
1. Try direct connection first (fastest)
2. Automatically fall back to proxies if needed
3. Execute all trades on OKX Demo account
4. Sync positions from OKX (source of truth)




