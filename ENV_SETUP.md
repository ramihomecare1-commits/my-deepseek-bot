# Environment Variables Setup

This document explains all the environment variables needed for the crypto scanner bot.

## Required Variables

### AI API Configuration
```bash
# Get your API key from: https://openrouter.ai/keys
API_KEY=your_openrouter_api_key_here
```

**Important:** You can use any of these variable names (the app checks all three):
- `API_KEY` (recommended)
- `AI_API_KEY`
- `OPENROUTER_API_KEY`

### AI Model Selection (Optional)
```bash
# Defaults to: deepseek/deepseek-chat
AI_MODEL=deepseek/deepseek-chat
```

**Model Options:**
- `deepseek/deepseek-chat` - **Recommended** (~$0.14 per million tokens, very cheap)
- `deepseek/deepseek-r1:free` - Free but **very limited** (frequent 429 rate limit errors)
- `anthropic/claude-3-haiku` - Good alternative (~$0.25/$1.25 per million tokens)

**⚠️ Important:** Free models have extremely strict rate limits and will frequently fail with 429 errors.

### Telegram Bot Configuration
```bash
# Create a bot: Talk to @BotFather on Telegram
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz

# Get your chat ID: Talk to @userinfobot on Telegram
TELEGRAM_CHAT_ID=123456789
```

**How to get these:**
1. **Bot Token:** Open Telegram, search for `@BotFather`, send `/newbot`, follow instructions
2. **Chat ID:** Open Telegram, search for `@userinfobot`, send `/start`, it will show your ID

## Optional Variables

### Mock Data Notifications (for testing)
```bash
# Set to 'true' to receive Telegram notifications for test/mock data
ALLOW_MOCK_NOTIFICATIONS=false
```

### CoinMarketCap API
```bash
# Optional: Get your key from https://pro.coinmarketcap.com/signup
COINMARKETCAP_API_KEY=your_coinmarketcap_key_here
```

### CryptoPanic News API
```bash
# Optional: Get your key from https://cryptopanic.com/developers/api/
CRYPTOPANIC_API_KEY=your_cryptopanic_key_here
```

### API Rate Limiting
```bash
# Delay between API requests in milliseconds (default: 1000)
API_DELAY_MS=1000
```

## Setup Instructions

### For Local Development
1. Copy the variables above into a `.env` file in the project root
2. Replace the placeholder values with your actual API keys
3. The app will automatically load these variables

### For Render Deployment
1. Go to your Render dashboard
2. Select your service
3. Go to "Environment" tab
4. Add each variable as a new environment variable
5. Click "Save Changes"
6. Redeploy your service

## Troubleshooting

### AI API Issues (429 Errors)
**Problem:** Getting "Request failed with status code 429"
**Solution:** 
- Switch from the free model to a paid model
- Set `AI_MODEL=deepseek/deepseek-chat` (very cheap)
- The app will retry with exponential backoff, but free models have very tight limits

### Telegram Not Working
**Problem:** Telegram notifications not sending
**Solution:**
1. Run diagnostics: Click "🔧 Diagnostics" button in the UI
2. Verify both `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set
3. Make sure your bot token starts with a number and contains a colon
4. Make sure your chat ID is just numbers (can be negative for groups)

### No AI Calls Being Made
**Problem:** Stats show 0 AI calls
**Solution:**
1. Run diagnostics to verify your API key is set
2. Check if you're hitting rate limits (429 errors)
3. Look at server logs for error messages
4. Consider switching to a paid model for more reliable service

## Current Configuration Status

Run the diagnostics tool in the UI to see your current configuration:
1. Open your app in a browser
2. Click "🔧 Diagnostics" button
3. Review the status of all environment variables and API connectivity

